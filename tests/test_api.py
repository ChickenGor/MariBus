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
