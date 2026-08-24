import os
import tempfile
import unittest
from unittest.mock import patch

import app as maribus


class MariBusApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_database_path = maribus.DATABASE_PATH
        # Exercise the same lazy per-operator package path used by Vercel,
        # even when a developer has the large unified database locally.
        cls.missing_database = os.path.join(tempfile.gettempdir(), "maribus-test-no-unified.db")
        if os.path.exists(cls.missing_database):
            os.remove(cls.missing_database)
        maribus.DATABASE_PATH = cls.missing_database
        maribus._agency_database_paths.clear()
        maribus._rate_limit_buckets.clear()
        maribus.app.config.update(TESTING=True)
        cls.client = maribus.app.test_client()

    @classmethod
    def tearDownClass(cls):
        maribus.DATABASE_PATH = cls.original_database_path
        if os.path.exists(cls.missing_database):
            os.remove(cls.missing_database)

    def setUp(self):
        maribus._rate_limit_buckets.clear()

    def test_health_reports_packaged_operator_databases(self):
        response = self.client.get("/api/health")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["success"])
        self.assertTrue(payload["database"])
        self.assertIn("mybas-ipoh", payload["packaged_agencies"])
        self.assertIn("rapid-bus-penang", payload["packaged_agencies"])

    def test_readiness_reports_missing_variables_without_secret_values(self):
        environment = {
            "GOOGLE_MAPS_API_KEY": "maps-secret",
            "GOOGLE_ROADS_API_KEY": "",
            "FIREBASE_API_KEY": "firebase-secret",
            "FIREBASE_AUTH_DOMAIN": "",
            "FIREBASE_PROJECT_ID": "",
            "FIREBASE_STORAGE_BUCKET": "",
            "FIREBASE_MESSAGING_SENDER_ID": "",
            "FIREBASE_APP_ID": "",
            "FIREBASE_VAPID_KEY": "",
            "OTP_GRAPHQL_URL": "",
            "RESEND_API_KEY": "resend-secret",
            "FEEDBACK_TO_EMAIL": "",
        }
        with patch.dict(os.environ, environment):
            response = self.client.get("/api/readiness")
        payload = response.get_json()
        response_text = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["ready"])
        self.assertFalse(payload["operational"])
        self.assertTrue(payload["services"]["google_maps"]["configured"])
        self.assertTrue(payload["services"]["road_geometry"]["configured"])
        self.assertFalse(payload["services"]["multimodal_routing"]["required"])
        self.assertIn("FIREBASE_AUTH_DOMAIN", payload["services"]["firebase"]["missing"])
        self.assertNotIn("maps-secret", response_text)
        self.assertNotIn("firebase-secret", response_text)
        self.assertNotIn("resend-secret", response_text)

    def test_readiness_is_ready_when_all_services_are_configured(self):
        environment = {
            "GOOGLE_MAPS_API_KEY": "configured",
            "FIREBASE_API_KEY": "configured",
            "FIREBASE_AUTH_DOMAIN": "configured",
            "FIREBASE_PROJECT_ID": "configured",
            "FIREBASE_STORAGE_BUCKET": "configured",
            "FIREBASE_MESSAGING_SENDER_ID": "configured",
            "FIREBASE_APP_ID": "configured",
            "FIREBASE_VAPID_KEY": "configured",
            "OTP_GRAPHQL_URL": "https://otp.example/graphql",
            "RESEND_API_KEY": "configured",
            "FEEDBACK_TO_EMAIL": "feedback@example.com",
        }
        with patch.dict(os.environ, environment):
            response = self.client.get("/api/readiness")
        self.assertTrue(response.get_json()["ready"])

    def test_readiness_is_operational_without_optional_otp(self):
        environment = {
            "GOOGLE_MAPS_API_KEY": "configured",
            "FIREBASE_API_KEY": "configured",
            "FIREBASE_AUTH_DOMAIN": "configured",
            "FIREBASE_PROJECT_ID": "configured",
            "FIREBASE_STORAGE_BUCKET": "configured",
            "FIREBASE_MESSAGING_SENDER_ID": "configured",
            "FIREBASE_APP_ID": "configured",
            "FIREBASE_VAPID_KEY": "configured",
            "OTP_GRAPHQL_URL": "",
            "RESEND_API_KEY": "configured",
            "FEEDBACK_TO_EMAIL": "feedback@example.com",
        }
        with patch.dict(os.environ, environment):
            response = self.client.get("/api/readiness")
        payload = response.get_json()
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["operational"])
        self.assertFalse(payload["optional_features"]["multimodal_routing"]["configured"])

    def test_default_operator_uses_packaged_database(self):
        response = self.client.get("/api/routes/search", query_string={"q": "T100"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        self.assertFalse(os.path.exists(self.missing_database))

    def test_invalid_operator_is_rejected_without_creating_database(self):
        response = self.client.get("/api/routes/search", query_string={"agency": "not-an-operator", "q": "A34"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["success"])
        self.assertFalse(os.path.exists(self.missing_database))

    def test_ipoh_a34_route_contains_ordered_stops_and_shape(self):
        search = self.client.get("/api/routes/search", query_string={"agency": "mybas-ipoh", "q": "A34"})
        choices = search.get_json()["data"]
        self.assertGreaterEqual(len(choices), 2)
        choice = choices[0]
        response = self.client.get(
            f"/api/routes/{choice['route_id']}",
            query_string={"agency": "mybas-ipoh", "trip_id": choice["trip_id"], "direction_id": choice["direction_id"]},
        )
        data = response.get_json()["data"]
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(data["stops"]), 40)
        self.assertGreaterEqual(len(data["shape"]), 2)
        self.assertNotEqual(data["stops"][0]["stop_id"], data["stops"][-1]["stop_id"])

    def test_rapid_penang_route_is_available(self):
        response = self.client.get("/api/routes/search", query_string={"agency": "rapid-bus-penang", "q": "101"})
        choices = response.get_json()["data"]
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(choices), 2)
        self.assertEqual(choices[0]["route_short_name"], "101")

    def test_estimated_fares_are_monotonic(self):
        short = maribus.estimated_fare_for_distance("rapid-bus-penang", 5)
        long = maribus.estimated_fare_for_distance("rapid-bus-penang", 30)
        mybas = maribus.estimated_fare_for_distance("mybas-ipoh", 12)
        self.assertLess(short["adult_rm"], long["adult_rm"])
        self.assertGreater(mybas["adult_rm"], 0)
        self.assertTrue(mybas["estimated"])

    def test_feedback_validation_does_not_contact_email_provider(self):
        with patch.dict(os.environ, {"RESEND_API_KEY": "", "FEEDBACK_TO_EMAIL": ""}):
            response = self.client.post("/api/feedback", data={"message": "short"})
        self.assertEqual(response.status_code, 503)

    def test_unknown_page_returns_404(self):
        response = self.client.get("/not-a-maribus-page")
        self.assertEqual(response.status_code, 404)

    def test_favicon_is_available_and_cacheable(self):
        response = self.client.get("/favicon.ico")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/svg+xml")
        self.assertIn("max-age=2592000", response.headers["Cache-Control"])
        self.assertIn(b"<svg", response.data)
        response.close()

    def test_privacy_terms_and_account_pages_are_available(self):
        for path in ("/privacy-policy", "/terms", "/account"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_messaging_service_worker_is_root_scoped_and_not_cached(self):
        response = self.client.get("/firebase-messaging-sw.js")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Service-Worker-Allowed"], "/")
        self.assertEqual(response.headers["Cache-Control"], "no-cache")
        self.assertIn(b"firebase.messaging", response.data)

    def test_api_responses_include_security_headers(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
        self.assertIn("geolocation=(self)", response.headers["Permissions-Policy"])

    def test_live_feed_metadata_reports_provenance_and_staleness(self):
        with patch.object(maribus, "LIVE_STALE_SECONDS", 90):
            fresh = maribus.live_feed_metadata(970, 1000)
            stale = maribus.live_feed_metadata(900, 1000)
        self.assertEqual(fresh["source"], "gtfs-realtime-vehicle-positions")
        self.assertEqual(fresh["age_seconds"], 30)
        self.assertFalse(fresh["is_stale"])
        self.assertTrue(stale["is_stale"])

    def test_feedback_rate_limit_returns_retry_after(self):
        maribus._rate_limit_buckets.clear()
        with patch.dict(os.environ, {"RESEND_API_KEY": "", "FEEDBACK_TO_EMAIL": ""}):
            responses = [
                self.client.post("/api/feedback", data={"message": "A valid feedback message"})
                for _ in range(6)
            ]
        self.assertEqual(responses[-1].status_code, 429)
        self.assertGreaterEqual(int(responses[-1].headers["Retry-After"]), 1)

    def test_oversized_feedback_is_rejected(self):
        response = self.client.post(
            "/api/feedback",
            data=b"x" * (maribus.app.config["MAX_CONTENT_LENGTH"] + 1),
            content_type="application/octet-stream",
        )
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
