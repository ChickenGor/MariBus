import json
import base64
import gzip
import math
import os
import shutil
import sqlite3
import tempfile
import time
from datetime import datetime
from threading import Lock

import requests
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from google.protobuf.json_format import MessageToDict
from google.transit import gtfs_realtime_pb2


app = Flask(__name__)
CORS(app)

DATABASE_PATH = os.getenv("MARIBUS_DB", os.path.join(os.path.dirname(__file__), "gtfs_static.db"))
PACKAGED_DATABASE_PATH = os.path.join(os.path.dirname(__file__), "gtfs_static.db.gz")
ROUTE_OVERRIDES_PATH = os.getenv("ROUTE_OVERRIDES_PATH", os.path.join(os.path.dirname(__file__), "route_overrides"))
LIVE_CACHE_SECONDS = int(os.getenv("LIVE_CACHE_SECONDS", "20"))
ROUTING_VERSION = "nearby-transfer-v3"

API_URLS = {
    "rapid-bus-kl": "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl",
    "rapid-bus-mrtfeeder": "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder",
    "rapid-bus-penang": "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-penang",
    "ktmb": "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb",
    "mybas-kangar": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kangar",
    "mybas-alor-setar": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-alor-setar",
    "mybas-kota-bharu": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kota-bharu",
    "mybas-kuala-terengganu": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuala-terengganu",
    "mybas-ipoh": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-ipoh",
    "mybas-seremban-A": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-seremban-a",
    "mybas-seremban-B": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-seremban-b",
    "mybas-melaka": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-melaka",
    "mybas-johor-bahru": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor",
    "mybas-kuching": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuching",
}

RAPID_PENANG_FARES = (
    (7, 1.40, 0.70),
    (14, 2.00, 1.00),
    (21, 2.70, 1.40),
    (28, 3.40, 1.70),
    (35, 4.00, 2.00),
    (42, 4.70, 2.40),
    (49, 5.00, 2.50),
)

_live_cache = {}
_road_geometry_cache = {}
_cache_lock = Lock()
_database_lock = Lock()


def point_distance_m(first, second):
    lat1, lon1 = math.radians(first[0]), math.radians(first[1])
    lat2, lon2 = math.radians(second[0]), math.radians(second[1])
    value = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def trip_segment_distance_km(connection, agency, trip_id, from_stop_id, to_stop_id):
    """Approximate travelled distance by following the ordered stops in a GTFS trip."""
    trip = connection.execute(
        "SELECT shape_id FROM trips WHERE agency_id = ? AND trip_id = ?",
        (agency, trip_id),
    ).fetchone()
    endpoint_rows = connection.execute(
        """SELECT stop_id, stop_lat, stop_lon FROM stops
           WHERE agency_id = ? AND stop_id IN (?, ?)""",
        (agency, from_stop_id, to_stop_id),
    ).fetchall()
    endpoints = {row["stop_id"]: (float(row["stop_lat"]), float(row["stop_lon"])) for row in endpoint_rows}
    if trip and trip["shape_id"] and len(endpoints) == 2:
        shape_rows = connection.execute(
            """SELECT shape_pt_lat, shape_pt_lon FROM shapes
               WHERE agency_id = ? AND shape_id = ? ORDER BY CAST(shape_pt_sequence AS INTEGER)""",
            (agency, trip["shape_id"]),
        ).fetchall()
        shape = [(float(row["shape_pt_lat"]), float(row["shape_pt_lon"])) for row in shape_rows]
        if len(shape) >= 2:
            from_index = min(range(len(shape)), key=lambda index: point_distance_m(shape[index], endpoints[from_stop_id]))
            to_index = min(range(from_index, len(shape)), key=lambda index: point_distance_m(shape[index], endpoints[to_stop_id]))
            if to_index > from_index:
                return sum(point_distance_m(first, second) for first, second in zip(shape[from_index:to_index], shape[from_index + 1:to_index + 1])) / 1000
    bounds = connection.execute(
        """SELECT
               MIN(CASE WHEN stop_id = ? THEN CAST(stop_sequence AS INTEGER) END) AS from_sequence,
               MAX(CASE WHEN stop_id = ? THEN CAST(stop_sequence AS INTEGER) END) AS to_sequence
           FROM stop_times WHERE agency_id = ? AND trip_id = ?""",
        (from_stop_id, to_stop_id, agency, trip_id),
    ).fetchone()
    if not bounds or bounds["from_sequence"] is None or bounds["to_sequence"] is None:
        return None
    if bounds["to_sequence"] <= bounds["from_sequence"]:
        return None
    rows = connection.execute(
        """SELECT s.stop_lat, s.stop_lon
           FROM stop_times st JOIN stops s
             ON s.agency_id = st.agency_id AND s.stop_id = st.stop_id
           WHERE st.agency_id = ? AND st.trip_id = ?
             AND CAST(st.stop_sequence AS INTEGER) BETWEEN ? AND ?
           ORDER BY CAST(st.stop_sequence AS INTEGER)""",
        (agency, trip_id, bounds["from_sequence"], bounds["to_sequence"]),
    ).fetchall()
    points = [(float(row["stop_lat"]), float(row["stop_lon"])) for row in rows]
    if len(points) < 2:
        return None
    return sum(point_distance_m(first, second) for first, second in zip(points, points[1:])) / 1000


def estimated_fare_for_distance(agency, distance_km):
    if distance_km is None or distance_km <= 0:
        return None
    if agency == "rapid-bus-penang":
        adult, concession = RAPID_PENANG_FARES[-1][1:]
        for maximum_km, band_adult, band_concession in RAPID_PENANG_FARES:
            if distance_km <= maximum_km:
                adult, concession = band_adult, band_concession
                break
        return {"adult_rm": adult, "concession_rm": concession, "distance_km": round(distance_km, 1), "type": "distance_band", "estimated": True}
    if agency.startswith("mybas-") and agency != "mybas-kuching":
        additional_km = max(0, math.ceil(distance_km - 2))
        adult = 0.94 + additional_km * 0.094
        return {"adult_rm": round(adult, 2), "concession_rm": round(adult / 2, 2), "distance_km": round(distance_km, 1), "type": "stage_bus", "estimated": True}
    return None


def attach_estimated_fares(connection, agency, journeys):
    for journey in journeys:
        segments = []
        if journey.get("legs") and journey.get("transfer_stop"):
            segments = [
                (journey["legs"][0]["trip_id"], journey["from_stop"]["stop_id"], journey["transfer_stop"]["stop_id"]),
                (journey["legs"][1]["trip_id"], journey["transfer_stop"]["board_stop_id"], journey["to_stop"]["stop_id"]),
            ]
        elif journey.get("trip_id"):
            segments = [(journey["trip_id"], journey["from_stop"]["stop_id"], journey["to_stop"]["stop_id"])]
        leg_fares = []
        for trip_id, from_stop_id, to_stop_id in segments:
            distance = trip_segment_distance_km(connection, agency, trip_id, from_stop_id, to_stop_id)
            fare = estimated_fare_for_distance(agency, distance)
            if fare:
                leg_fares.append(fare)
        if leg_fares and len(leg_fares) == len(segments):
            journey["fare"] = {
                "adult_rm": round(sum(item["adult_rm"] for item in leg_fares), 2),
                "concession_rm": round(sum(item["concession_rm"] for item in leg_fares), 2),
                "distance_km": round(sum(item["distance_km"] for item in leg_fares), 1),
                "estimated": True,
                "legs": leg_fares,
            }


def densify_path(points, maximum_gap_m=250):
    if not points:
        return []
    dense = [points[0]]
    for start, end in zip(points, points[1:]):
        segments = max(1, math.ceil(point_distance_m(start, end) / maximum_gap_m))
        for step in range(1, segments + 1):
            ratio = step / segments
            dense.append((
                start[0] + (end[0] - start[0]) * ratio,
                start[1] + (end[1] - start[1]) * ratio,
            ))
    return dense


def load_route_override(agency, route_id, direction_id):
    safe_agency = "".join(character for character in str(agency) if character.isalnum() or character in "-_")
    safe_route = "".join(character for character in str(route_id) if character.isalnum() or character in "-_")
    safe_direction = "".join(character for character in str(direction_id) if character.isalnum() or character in "-_")
    if not safe_agency or not safe_route or not safe_direction:
        return []
    path = os.path.join(ROUTE_OVERRIDES_PATH, safe_agency, f"{safe_route}-{safe_direction}.geojson")
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as source:
            payload = json.load(source)
        geometry = payload.get("geometry") if payload.get("type") == "Feature" else payload
        if payload.get("type") == "FeatureCollection":
            # geojson.io commonly exports a manually traced route as several
            # consecutive LineString features plus optional Point pins.
            lines = []
            for feature in payload.get("features", []):
                feature_geometry = feature.get("geometry", {})
                if feature_geometry.get("type") == "LineString":
                    lines.append(feature_geometry.get("coordinates", []))
                elif feature_geometry.get("type") == "MultiLineString":
                    lines.extend(feature_geometry.get("coordinates", []))
            coordinates = []
            for line in lines:
                if not line:
                    continue
                if coordinates and coordinates[-1] == line[0]:
                    coordinates.extend(line[1:])
                else:
                    coordinates.extend(line)
            geometry = {"type": "LineString", "coordinates": coordinates}
        if not geometry:
            return []
        coordinates = geometry.get("coordinates", [])
        if geometry.get("type") == "MultiLineString":
            coordinates = [point for line in coordinates for point in line]
        if geometry.get("type") != "LineString" and not coordinates:
            return []
        points = []
        for coordinate in coordinates:
            if not isinstance(coordinate, list) or len(coordinate) < 2:
                continue
            lon, lat = float(coordinate[0]), float(coordinate[1])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                points.append({"lat": lat, "lon": lon})
        return points if len(points) >= 2 else []
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        app.logger.exception("Invalid route override: %s", path)
        return []


def db_connection():
    connection = sqlite3.connect(ensure_database_path())
    connection.row_factory = sqlite3.Row
    return connection


def ensure_database_path():
    """Use the local DB in development or unpack the deployment copy once per cold start."""
    global DATABASE_PATH
    if os.path.exists(DATABASE_PATH):
        return DATABASE_PATH
    if not os.path.exists(PACKAGED_DATABASE_PATH):
        return DATABASE_PATH
    with _database_lock:
        if os.path.exists(DATABASE_PATH):
            return DATABASE_PATH
        runtime_path = os.path.join(tempfile.gettempdir(), "maribus-gtfs-static.db")
        packaged_mtime = os.path.getmtime(PACKAGED_DATABASE_PATH)
        if not os.path.exists(runtime_path) or os.path.getmtime(runtime_path) < packaged_mtime:
            temporary_path = runtime_path + ".tmp"
            with gzip.open(PACKAGED_DATABASE_PATH, "rb") as source, open(temporary_path, "wb") as destination:
                shutil.copyfileobj(source, destination)
            os.replace(temporary_path, runtime_path)
        DATABASE_PATH = runtime_path
    return DATABASE_PATH


def table_exists(connection, table_name):
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone() is not None


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def get_route_map(trip_route_pairs, agency):
    """Resolve all vehicles in two queries instead of opening SQLite per vehicle."""
    trip_ids = sorted({trip_id for trip_id, _ in trip_route_pairs if trip_id})
    route_ids = sorted({route_id for _, route_id in trip_route_pairs if route_id})
    result = {}

    with db_connection() as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(trip_routes)")}
        scoped = "agency_id" in columns

        # The expanded GTFS database can provide the public headsign and final stop.
        if trip_ids and table_exists(connection, "trips") and table_exists(connection, "stops"):
            placeholders = ",".join("?" for _ in trip_ids)
            query = f"""SELECT t.trip_id, t.route_id, r.route_short_name, r.route_long_name,
                               t.trip_headsign,
                               (SELECT s.stop_name FROM stop_times st
                                JOIN stops s ON s.agency_id = st.agency_id AND s.stop_id = st.stop_id
                                WHERE st.agency_id = t.agency_id AND st.trip_id = t.trip_id
                                ORDER BY CAST(st.stop_sequence AS INTEGER) DESC LIMIT 1) AS destination_name
                        FROM trips t JOIN routes r
                        ON r.agency_id = t.agency_id AND r.route_id = t.route_id
                        WHERE t.agency_id = ? AND t.trip_id IN ({placeholders})"""
            for row in connection.execute(query, [agency, *trip_ids]):
                result[("trip", row["trip_id"])] = dict(row)

            # Rapid Penang's realtime feed omits the weekday/weekend prefix
            # present in its static trip IDs. Resolve those documented suffix
            # matches without changing the upstream identifiers.
            if agency == "rapid-bus-penang":
                unresolved = [trip_id for trip_id in trip_ids if ("trip", trip_id) not in result]
                if unresolved:
                    static_rows = connection.execute(
                        """SELECT t.trip_id, t.route_id, r.route_short_name, r.route_long_name,
                                  t.trip_headsign
                           FROM trips t JOIN routes r ON r.agency_id=t.agency_id AND r.route_id=t.route_id
                           WHERE t.agency_id=?""",
                        (agency,),
                    ).fetchall()
                    for row in static_rows:
                        static_trip_id = row["trip_id"]
                        realtime_trip_id = next(
                            (candidate for candidate in unresolved if static_trip_id.endswith(candidate)), None
                        )
                        if realtime_trip_id and ("trip", realtime_trip_id) not in result:
                            result[("trip", realtime_trip_id)] = dict(row)

        if trip_ids:
            placeholders = ",".join("?" for _ in trip_ids)
            agency_clause = "agency_id = ? AND " if scoped else ""
            params = ([agency] if scoped else []) + trip_ids
            query = f"""SELECT trip_id, route_id, route_short_name, route_long_name
                        FROM trip_routes WHERE {agency_clause}trip_id IN ({placeholders})"""
            for row in connection.execute(query, params):
                result.setdefault(("trip", row["trip_id"]), dict(row))

        if route_ids:
            placeholders = ",".join("?" for _ in route_ids)
            agency_clause = "agency_id = ? AND " if scoped else ""
            params = ([agency] if scoped else []) + route_ids
            query = f"""SELECT route_id, route_short_name, route_long_name
                        FROM trip_routes WHERE {agency_clause}route_id IN ({placeholders})
                        GROUP BY route_id"""
            for row in connection.execute(query, params):
                result[("route", row["route_id"])] = dict(row)
    return result


def route_info(route_map, trip_id, route_id):
    row = route_map.get(("trip", trip_id)) or route_map.get(("route", route_id))
    if row:
        short_name = row.get("route_short_name")
        return {
            "short_name": short_name if short_name and str(short_name) != "nan" else "Route",
            "long_name": row.get("route_long_name") or "Scheduled service",
            "headsign": row.get("trip_headsign") or row.get("destination_name") or "",
            "destination": row.get("destination_name") or row.get("trip_headsign") or "",
            "route_id": row.get("route_id") or route_id or "",
            "trip_id": row.get("trip_id") or "",
        }
    clean_route = route_id.split("_")[-1] if route_id and "_" in route_id else route_id
    return {
        "short_name": clean_route or "Bus",
        "long_name": "Live dispatched route" if route_id else "Active fleet vehicle",
        "headsign": "",
        "destination": "",
        "route_id": route_id or "",
        "trip_id": "",
    }


@app.get("/api/health")
def health():
    return jsonify({"success": True, "database": os.path.exists(ensure_database_path()), "routing_version": ROUTING_VERSION})


@app.get("/api/config")
def frontend_config():
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    map_id = os.getenv("GOOGLE_MAPS_MAP_ID", "").strip()
    firebase_config = {
        "apiKey": os.getenv("FIREBASE_API_KEY", "").strip(),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", "").strip(),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", "").strip(),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", "").strip(),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", "").strip(),
        "appId": os.getenv("FIREBASE_APP_ID", "").strip(),
    }
    return jsonify({
        "success": True,
        "google_maps_api_key": api_key,
        "google_maps_enabled": bool(api_key),
        "google_maps_map_id": map_id,
        "multimodal_routing_enabled": bool(os.getenv("OTP_GRAPHQL_URL", "").strip()),
        "routing_version": ROUTING_VERSION,
        "firebase_enabled": all(firebase_config.values()),
        "firebase_config": firebase_config,
    })


@app.post("/api/feedback")
def send_feedback():
    if request.form.get("website"):
        return jsonify({"success": True})
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    recipient = os.getenv("FEEDBACK_TO_EMAIL", "").strip()
    sender = os.getenv("FEEDBACK_FROM_EMAIL", "MariBus Feedback <onboarding@resend.dev>").strip()
    if not api_key or not recipient:
        return jsonify({"success": False, "error": "Feedback email is not configured yet."}), 503
    topic = request.form.get("topic", "Other").strip()[:100]
    reply_email = request.form.get("reply_email", "").strip()[:254]
    message = request.form.get("message", "").strip()
    if len(message) < 10 or len(message) > 4000:
        return jsonify({"success": False, "error": "Feedback must contain 10 to 4000 characters."}), 400
    payload = {
        "from": sender,
        "to": [recipient],
        "subject": f"MariBus feedback: {topic}",
        "text": f"Topic: {topic}\nReply email: {reply_email or 'Not provided'}\n\n{message}",
    }
    if reply_email:
        payload["reply_to"] = reply_email
    photo = request.files.get("photo")
    if photo and photo.filename:
        allowed = {"image/jpeg", "image/png", "image/webp", "image/gif"}
        content = photo.read(5 * 1024 * 1024 + 1)
        if photo.mimetype not in allowed or len(content) > 5 * 1024 * 1024:
            return jsonify({"success": False, "error": "Upload a JPG, PNG, WebP or GIF smaller than 5 MB."}), 400
        safe_name = "".join(character for character in photo.filename if character.isalnum() or character in "._-") or "feedback-image"
        payload["attachments"] = [{"filename": safe_name, "content": base64.b64encode(content).decode("ascii")}]
    try:
        response = requests.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=payload, timeout=15)
        response.raise_for_status()
    except requests.RequestException:
        app.logger.exception("Feedback email delivery failed")
        return jsonify({"success": False, "error": "Email delivery failed. Please try again shortly."}), 502
    return jsonify({"success": True})


@app.get("/")
def index():
    return send_file(os.path.join(os.path.dirname(__file__), "index.html"))


PAGE_NAMES = {
    "ad-free", "saved-routes", "notifications", "feedback",
    "share", "rate-us", "about-us", "sign-in",
}


@app.get("/<page_name>")
def app_page(page_name):
    if page_name not in PAGE_NAMES:
        return jsonify({"success": False, "error": "Page not found"}), 404
    return send_file(os.path.join(os.path.dirname(__file__), "pages", f"{page_name}.html"))


@app.get("/api/live-buses")
def get_live_buses():
    agency = request.args.get("agency", "rapid-bus-kl")
    url = API_URLS.get(agency)
    if not url:
        return jsonify({"success": False, "error": "Invalid agency selected"}), 400

    now = time.time()
    with _cache_lock:
        cached = _live_cache.get(agency)
        if cached and now - cached[0] < LIVE_CACHE_SECONDS:
            return jsonify(cached[1])

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(response.content)
        vehicles = [MessageToDict(entity.vehicle) for entity in feed.entity if entity.HasField("vehicle")]
        pairs = [
            (vehicle.get("trip", {}).get("tripId"), vehicle.get("trip", {}).get("routeId"))
            for vehicle in vehicles
        ]
        route_map = get_route_map(pairs, agency)
        for vehicle, (trip_id, route_id) in zip(vehicles, pairs):
            vehicle["route_info"] = route_info(route_map, trip_id, route_id)

        payload = {"success": True, "data": vehicles, "feed_timestamp": feed.header.timestamp or None}
        with _cache_lock:
            _live_cache[agency] = (now, payload)
        return jsonify(payload)
    except requests.RequestException:
        app.logger.exception("Live feed request failed for %s", agency)
        return jsonify({"success": False, "error": "The operator live feed is temporarily unavailable"}), 502
    except Exception:
        app.logger.exception("Unable to process live feed for %s", agency)
        return jsonify({"success": False, "error": "Unable to process the live feed"}), 500


@app.get("/api/stops")
def get_stops():
    agency = request.args.get("agency", "rapid-bus-kl")
    query_text = request.args.get("q", "").strip()
    limit = min(max(request.args.get("limit", 40, type=int), 1), 100)
    latitude = request.args.get("lat", type=float)
    longitude = request.args.get("lng", type=float)
    radius_km = min(max(request.args.get("radius_km", 2.0, type=float), 0.1), 20)

    with db_connection() as connection:
        if not table_exists(connection, "stops"):
            return jsonify({"success": False, "error": "Rebuild gtfs_static.db to enable stops"}), 503

        if query_text:
            rows = connection.execute(
                """SELECT agency_id, stop_id, stop_code, stop_name, stop_lat, stop_lon
                   FROM stops WHERE agency_id = ? AND (stop_name LIKE ? OR stop_code LIKE ?)
                   ORDER BY stop_name LIMIT ?""",
                (agency, f"%{query_text}%", f"%{query_text}%", limit),
            ).fetchall()
        elif latitude is not None and longitude is not None:
            lat_delta = radius_km / 111.0
            lon_delta = radius_km / max(111.0 * math.cos(math.radians(latitude)), 0.01)
            candidates = connection.execute(
                """SELECT agency_id, stop_id, stop_code, stop_name, stop_lat, stop_lon
                   FROM stops WHERE agency_id = ? AND stop_lat BETWEEN ? AND ?
                   AND stop_lon BETWEEN ? AND ?""",
                (agency, latitude - lat_delta, latitude + lat_delta, longitude - lon_delta, longitude + lon_delta),
            ).fetchall()
            rows = []
            for row in candidates:
                stop_lat = float(row["stop_lat"])
                stop_lon = float(row["stop_lon"])
                distance = 6371 * 2 * math.asin(math.sqrt(
                    math.sin(math.radians(stop_lat - latitude) / 2) ** 2
                    + math.cos(math.radians(latitude)) * math.cos(math.radians(stop_lat))
                    * math.sin(math.radians(stop_lon - longitude) / 2) ** 2
                ))
                if distance <= radius_km:
                    item = dict(row)
                    item["distance_m"] = round(distance * 1000)
                    rows.append(item)
            rows.sort(key=lambda row: row["distance_m"])
            return jsonify({"success": True, "data": rows[:limit]})
        else:
            return jsonify({"success": False, "error": "Provide q or lat and lng"}), 400

    return jsonify({"success": True, "data": rows_to_dicts(rows)})


def gtfs_seconds(value):
    try:
        hours, minutes, seconds = map(int, value.split(":"))
        return hours * 3600 + minutes * 60 + seconds
    except (AttributeError, TypeError, ValueError):
        return None


def active_service_ids(connection, agency, service_date):
    """Return GTFS services running on a date, including calendar exceptions."""
    date_text = service_date.strftime("%Y%m%d")
    weekday = service_date.strftime("%A").lower()
    active = {
        row["service_id"]
        for row in connection.execute(
            f"""SELECT service_id FROM calendar WHERE agency_id = ? AND {weekday} = 1
                AND start_date <= ? AND end_date >= ?""",
            (agency, date_text, date_text),
        )
    } if table_exists(connection, "calendar") else set()
    if table_exists(connection, "calendar_dates"):
        for row in connection.execute(
            "SELECT service_id, exception_type FROM calendar_dates WHERE agency_id = ? AND date = ?",
            (agency, date_text),
        ):
            if int(row["exception_type"]) == 1:
                active.add(row["service_id"])
            elif int(row["exception_type"]) == 2:
                active.discard(row["service_id"])
    # Some Malaysian feeds publish a rolling one-day calendar snapshot instead
    # of a long validity range. Permit that repeating schedule for a short
    # window so a database built yesterday can still plan today's journey.
    if not active and table_exists(connection, "calendar"):
        for row in connection.execute("SELECT * FROM calendar WHERE agency_id = ?", (agency,)):
            try:
                start = datetime.strptime(str(row["start_date"]), "%Y%m%d").date()
                end = datetime.strptime(str(row["end_date"]), "%Y%m%d").date()
            except (TypeError, ValueError):
                continue
            if (end - start).days <= 1 and abs((service_date - end).days) <= 14 and int(row[weekday] or 0) == 1:
                active.add(row["service_id"])
    return active


def format_gtfs_seconds(seconds):
    seconds %= 24 * 3600
    return f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}"


def nearby_stops(connection, agency, latitude, longitude, limit=6, radius_km=5):
    lat_delta = radius_km / 111.0
    lon_delta = radius_km / max(111.0 * math.cos(math.radians(latitude)), 0.01)
    rows = connection.execute(
        """SELECT stop_id, stop_code, stop_name, stop_lat, stop_lon FROM stops
           WHERE agency_id = ? AND stop_lat BETWEEN ? AND ? AND stop_lon BETWEEN ? AND ?""",
        (agency, latitude - lat_delta, latitude + lat_delta, longitude - lon_delta, longitude + lon_delta),
    ).fetchall()
    results = []
    for row in rows:
        stop_lat, stop_lon = float(row["stop_lat"]), float(row["stop_lon"])
        distance = 6371 * 2 * math.asin(math.sqrt(
            math.sin(math.radians(stop_lat - latitude) / 2) ** 2
            + math.cos(math.radians(latitude)) * math.cos(math.radians(stop_lat))
            * math.sin(math.radians(stop_lon - longitude) / 2) ** 2
        ))
        if distance <= radius_km:
            item = dict(row)
            item["distance_m"] = round(distance * 1000)
            results.append(item)
    results.sort(key=lambda item: item["distance_m"])
    return results[:limit]


def one_transfer_journeys(connection, agency, origin_map, destination_map, active_services, requested_seconds):
    """Find practical same-stop transfers without requiring a separate routing server."""
    window_start = f"{requested_seconds // 3600:02d}:{(requested_seconds % 3600) // 60:02d}:00"
    window_end_seconds = requested_seconds + 5 * 3600
    window_end = f"{window_end_seconds // 3600:02d}:{(window_end_seconds % 3600) // 60:02d}:59"
    origin_marks = ",".join("?" for _ in origin_map)
    service_marks = ",".join("?" for _ in active_services)
    first_rows = connection.execute(
        f"""SELECT board.stop_id AS origin_stop_id, alight.stop_id AS transfer_stop_id,
                   board.departure_time, alight.arrival_time, t.trip_id, t.trip_headsign, t.direction_id,
                   r.route_id, r.route_short_name, r.route_long_name, r.route_color
            FROM stop_times board JOIN stop_times alight
              ON alight.agency_id=board.agency_id AND alight.trip_id=board.trip_id
              AND CAST(alight.stop_sequence AS INTEGER)>CAST(board.stop_sequence AS INTEGER)
            JOIN trips t ON t.agency_id=board.agency_id AND t.trip_id=board.trip_id
            JOIN routes r ON r.agency_id=t.agency_id AND r.route_id=t.route_id
            WHERE board.agency_id=? AND board.stop_id IN ({origin_marks})
              AND t.service_id IN ({service_marks})
              AND board.departure_time BETWEEN ? AND ?""",
        [agency, *origin_map, *active_services, window_start, window_end],
    ).fetchall()
    first_candidates = []
    for row in first_rows:
        departure = gtfs_seconds(row["departure_time"])
        arrival = gtfs_seconds(row["arrival_time"])
        origin_walk_seconds = math.ceil(origin_map[row["origin_stop_id"]]["distance_m"] / 1.3)
        if departure is None or arrival is None or departure < requested_seconds + origin_walk_seconds or departure > requested_seconds + 4 * 3600:
            continue
        if arrival < departure:
            continue
        item = dict(row)
        item.update({"departure_seconds": departure, "arrival_seconds": arrival})
        first_candidates.append(item)
    # Dense networks can produce every downstream stop for many near-identical
    # trips. Earliest candidates provide useful transfers without an
    # unbounded all-stops comparison.
    first_candidates.sort(key=lambda item: (item["arrival_seconds"], item["departure_seconds"]))
    first_candidates = first_candidates[:300]
    transfer_ids = sorted({item["transfer_stop_id"] for item in first_candidates})
    if not transfer_ids:
        return []

    transfer_stop_marks = ",".join("?" for _ in transfer_ids)
    first_transfer_stops = rows_to_dicts(connection.execute(
        f"SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops WHERE agency_id=? AND stop_id IN ({transfer_stop_marks})",
        [agency, *transfer_ids],
    ).fetchall())
    all_stops = rows_to_dicts(connection.execute(
        "SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops WHERE agency_id=?", (agency,)
    ).fetchall())
    transfer_matches = {}
    for first_stop in first_transfer_stops:
        matches = []
        first_lat, first_lon = float(first_stop["stop_lat"]), float(first_stop["stop_lon"])
        for second_stop in all_stops:
            second_lat, second_lon = float(second_stop["stop_lat"]), float(second_stop["stop_lon"])
            distance = 6371 * 2 * math.asin(math.sqrt(
                math.sin(math.radians(second_lat - first_lat) / 2) ** 2
                + math.cos(math.radians(first_lat)) * math.cos(math.radians(second_lat))
                * math.sin(math.radians(second_lon - first_lon) / 2) ** 2
            )) * 1000
            if distance <= 300:
                matches.append({"stop": second_stop, "distance_m": round(distance)})
        transfer_matches[first_stop["stop_id"]] = matches
    second_board_ids = sorted({match["stop"]["stop_id"] for matches in transfer_matches.values() for match in matches})

    second_rows = []
    destination_marks = ",".join("?" for _ in destination_map)
    # Stay below SQLite's parameter limit while covering larger networks.
    for offset in range(0, len(second_board_ids), 700):
        transfer_chunk = second_board_ids[offset:offset + 700]
        transfer_marks = ",".join("?" for _ in transfer_chunk)
        second_rows.extend(connection.execute(
            f"""SELECT board.stop_id AS transfer_stop_id, alight.stop_id AS destination_stop_id,
                       board.departure_time, alight.arrival_time, t.trip_id, t.trip_headsign, t.direction_id,
                       r.route_id, r.route_short_name, r.route_long_name, r.route_color,
                       ts.stop_name AS transfer_stop_name
                FROM stop_times board JOIN stop_times alight
                  ON alight.agency_id=board.agency_id AND alight.trip_id=board.trip_id
                  AND CAST(alight.stop_sequence AS INTEGER)>CAST(board.stop_sequence AS INTEGER)
                JOIN trips t ON t.agency_id=board.agency_id AND t.trip_id=board.trip_id
                JOIN routes r ON r.agency_id=t.agency_id AND r.route_id=t.route_id
                JOIN stops ts ON ts.agency_id=board.agency_id AND ts.stop_id=board.stop_id
                WHERE board.agency_id=? AND board.stop_id IN ({transfer_marks})
                  AND alight.stop_id IN ({destination_marks}) AND t.service_id IN ({service_marks})
                  AND board.departure_time BETWEEN ? AND ?""",
            [agency, *transfer_chunk, *destination_map, *active_services, window_start, window_end],
        ).fetchall())

    seconds_by_transfer = {}
    for row in second_rows:
        departure = gtfs_seconds(row["departure_time"])
        arrival = gtfs_seconds(row["arrival_time"])
        if departure is None or arrival is None or arrival < departure:
            continue
        item = dict(row)
        item.update({"departure_seconds": departure, "arrival_seconds": arrival})
        seconds_by_transfer.setdefault(row["transfer_stop_id"], []).append(item)
    for candidates in seconds_by_transfer.values():
        candidates.sort(key=lambda item: item["departure_seconds"])

    results, seen = [], set()
    for first in first_candidates:
        for transfer_match in transfer_matches.get(first["transfer_stop_id"], []):
          for second in seconds_by_transfer.get(transfer_match["stop"]["stop_id"], []):
            transfer_wait = second["departure_seconds"] - first["arrival_seconds"]
            transfer_walk_seconds = math.ceil(transfer_match["distance_m"] / 1.3)
            if transfer_wait < 120 + transfer_walk_seconds:
                continue
            if transfer_wait > 60 * 60:
                break
            if first["trip_id"] == second["trip_id"] or first["route_id"] == second["route_id"]:
                continue
            origin = origin_map[first["origin_stop_id"]]
            destination = destination_map[second["destination_stop_id"]]
            signature = (first["trip_id"], second["trip_id"], first["transfer_stop_id"], second["transfer_stop_id"], origin["stop_id"], destination["stop_id"])
            if signature in seen:
                continue
            seen.add(signature)
            walking_distance = origin["distance_m"] + destination["distance_m"] + transfer_match["distance_m"]
            walking_minutes = math.ceil(walking_distance / 78)
            initial_wait = max(0, math.ceil((first["departure_seconds"] - requested_seconds) / 60) - walking_minutes)
            destination_walk_minutes = math.ceil(destination["distance_m"] / 78)
            total_minutes = math.ceil((second["arrival_seconds"] - requested_seconds) / 60) + destination_walk_minutes
            results.append({
                "transfers": 1, "total_minutes": total_minutes, "walk_minutes": walking_minutes,
                "walk_distance_m": walking_distance, "wait_minutes": initial_wait,
                "transfer_wait_minutes": math.ceil(transfer_wait / 60),
                "duration_minutes": math.ceil((second["arrival_seconds"] - first["departure_seconds"]) / 60),
                "departure_time": format_gtfs_seconds(first["departure_seconds"]),
                "arrival_time": format_gtfs_seconds(second["arrival_seconds"]),
                "from_stop": origin, "to_stop": destination,
                "transfer_stop": {
                    "stop_id": first["transfer_stop_id"],
                    "board_stop_id": second["transfer_stop_id"],
                    "stop_name": second["transfer_stop_name"],
                    "walk_distance_m": transfer_match["distance_m"],
                },
                "route_id": first["route_id"], "route_short_name": first["route_short_name"] or "Route",
                "route_color": first["route_color"] or "2563EB", "headsign": second["trip_headsign"] or "",
                "legs": [
                    {"trip_id": first["trip_id"], "direction_id": first["direction_id"], "route_id": first["route_id"], "route_short_name": first["route_short_name"] or "Route", "route_color": first["route_color"] or "2563EB", "headsign": first["trip_headsign"] or "", "departure_time": format_gtfs_seconds(first["departure_seconds"]), "arrival_time": format_gtfs_seconds(first["arrival_seconds"])},
                    {"trip_id": second["trip_id"], "direction_id": second["direction_id"], "route_id": second["route_id"], "route_short_name": second["route_short_name"] or "Route", "route_color": second["route_color"] or "2563EB", "headsign": second["trip_headsign"] or "", "departure_time": format_gtfs_seconds(second["departure_seconds"]), "arrival_time": format_gtfs_seconds(second["arrival_seconds"])},
                ],
            })
    deduplicated = {}
    for item in results:
        key = (
            item["legs"][0]["route_id"], item["legs"][1]["route_id"],
            item["transfer_stop"]["board_stop_id"], item["arrival_time"],
            item["from_stop"]["stop_id"], item["to_stop"]["stop_id"],
        )
        existing = deduplicated.get(key)
        if not existing or item["departure_time"] > existing["departure_time"]:
            deduplicated[key] = item
    results = list(deduplicated.values())
    results.sort(key=lambda item: (item["total_minutes"], item["walk_distance_m"], item["transfer_wait_minutes"]))
    return results[:20]


@app.get("/api/stops/<stop_id>/arrivals")
def get_stop_arrivals(stop_id):
    agency = request.args.get("agency", "rapid-bus-kl")
    limit = min(max(request.args.get("limit", 8, type=int), 1), 30)
    now = datetime.now()
    current_seconds = now.hour * 3600 + now.minute * 60 + now.second

    with db_connection() as connection:
        if not table_exists(connection, "stop_times"):
            return jsonify({"success": False, "error": "Rebuild gtfs_static.db to enable arrivals"}), 503
        active_services = active_service_ids(connection, agency, now.date())
        rows = connection.execute(
            """SELECT st.arrival_time, st.departure_time, st.stop_sequence,
                      t.trip_id, t.service_id, t.trip_headsign, t.direction_id, r.route_id,
                      r.route_short_name, r.route_long_name
               FROM stop_times st
               JOIN trips t ON t.agency_id = st.agency_id AND t.trip_id = st.trip_id
               JOIN routes r ON r.agency_id = t.agency_id AND r.route_id = t.route_id
               WHERE st.agency_id = ? AND st.stop_id = ?""",
            (agency, stop_id),
        ).fetchall()

    arrivals = []
    for row in rows:
        if row["service_id"] not in active_services:
            continue
        seconds = gtfs_seconds(row["arrival_time"] or row["departure_time"])
        if seconds is None:
            continue
        wait_seconds = seconds - current_seconds
        if wait_seconds < -60:
            wait_seconds += 24 * 3600
        if -60 <= wait_seconds <= 24 * 3600:
            item = dict(row)
            item["minutes"] = max(0, math.ceil(wait_seconds / 60))
            item["realtime"] = False
            arrivals.append(item)
    arrivals.sort(key=lambda item: item["minutes"])
    return jsonify({"success": True, "data": arrivals[:limit], "notice": "Scheduled times"})


@app.get("/api/routes/<route_id>")
def get_route(route_id):
    agency = request.args.get("agency", "rapid-bus-kl")
    direction = request.args.get("direction_id")
    requested_trip_id = request.args.get("trip_id", "").strip()
    from_stop = request.args.get("from_stop", "").strip()
    to_stop = request.args.get("to_stop", "").strip()
    with db_connection() as connection:
        if not table_exists(connection, "trips"):
            return jsonify({"success": False, "error": "Rebuild gtfs_static.db to enable route paths"}), 503

        params = [agency, route_id]
        direction_clause = ""
        if requested_trip_id:
            direction_clause = " AND trip_id = ?"
            params.append(requested_trip_id)
        elif direction is not None:
            direction_clause = " AND direction_id = ?"
            params.append(direction)
        trip = connection.execute(
            f"""SELECT trip_id, shape_id, trip_headsign, direction_id FROM trips
                WHERE agency_id = ? AND route_id = ?{direction_clause}
                ORDER BY CASE WHEN shape_id IS NULL OR shape_id = '' THEN 1 ELSE 0 END LIMIT 1""",
            params,
        ).fetchone()
        route = connection.execute(
            """SELECT route_id, route_short_name, route_long_name, route_color
               FROM routes WHERE agency_id = ? AND route_id = ?""",
            (agency, route_id),
        ).fetchone()
        if not trip or not route:
            return jsonify({"success": False, "error": "Route not found"}), 404

        stops = connection.execute(
            """SELECT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, st.stop_sequence
               FROM stop_times st JOIN stops s
               ON s.agency_id = st.agency_id AND s.stop_id = st.stop_id
               WHERE st.agency_id = ? AND st.trip_id = ? ORDER BY st.stop_sequence""",
            (agency, trip["trip_id"]),
        ).fetchall()
        if from_stop and to_stop:
            stop_rows = list(stops)
            origin_index = next((i for i, stop in enumerate(stop_rows) if stop["stop_id"] == from_stop), None)
            destination_index = next((i for i, stop in enumerate(stop_rows) if stop["stop_id"] == to_stop and (origin_index is None or i > origin_index)), None)
            if origin_index is not None and destination_index is not None:
                stops = stop_rows[origin_index:destination_index + 1]
        shape = []
        if not (from_stop and to_stop) and trip["shape_id"] and table_exists(connection, "shapes"):
            shape = connection.execute(
                """SELECT shape_pt_lat AS lat, shape_pt_lon AS lon, shape_pt_sequence AS sequence
                   FROM shapes WHERE agency_id = ? AND shape_id = ? ORDER BY shape_pt_sequence""",
                (agency, trip["shape_id"]),
            ).fetchall()

    geometry_source = "gtfs"
    override_shape = load_route_override(agency, route_id, trip["direction_id"])
    if override_shape:
        shape = override_shape
        geometry_source = "verified-override"

    return jsonify({
        "success": True,
        "data": {
            "route": dict(route), "trip": dict(trip), "stops": rows_to_dicts(stops),
            "shape": rows_to_dicts(shape), "geometry_source": geometry_source,
        },
    })


@app.get("/api/routes/search")
def search_routes():
    agency = request.args.get("agency", "rapid-bus-kl")
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"success": True, "data": []})

    with db_connection() as connection:
        rows = connection.execute(
            """SELECT r.route_id, r.route_short_name, r.route_long_name, r.route_color,
                      t.trip_id, t.trip_headsign, t.direction_id
               FROM routes r JOIN trips t
               ON t.agency_id = r.agency_id AND t.route_id = r.route_id
               WHERE r.agency_id = ? AND (
                    UPPER(r.route_id) = UPPER(?) OR
                    UPPER(r.route_short_name) = UPPER(?) OR
                    UPPER(r.route_long_name) = UPPER(?)
               )
               ORDER BY t.direction_id, t.trip_headsign, t.trip_id""",
            (agency, query, query, query),
        ).fetchall()

    # One representative trip per route and direction is enough to display the
    # correct ordered stop list without mixing inbound and outbound patterns.
    choices = {}
    for row in rows:
        item = dict(row)
        key = (item["route_id"], str(item.get("direction_id") or ""), item.get("trip_headsign") or "")
        choices.setdefault(key, item)
    results = list(choices.values())[:12]
    with db_connection() as connection:
        for item in results:
            endpoints = connection.execute(
                """SELECT s.stop_name FROM stop_times st JOIN stops s
                   ON s.agency_id=st.agency_id AND s.stop_id=st.stop_id
                   WHERE st.agency_id=? AND st.trip_id=?
                   ORDER BY CAST(st.stop_sequence AS INTEGER)""",
                (agency, item["trip_id"]),
            ).fetchall()
            item["origin_name"] = endpoints[0]["stop_name"] if endpoints else ""
            item["destination_name"] = endpoints[-1]["stop_name"] if endpoints else ""
    return jsonify({"success": True, "data": results})


@app.get("/api/routes/<route_id>/road-geometry")
def get_route_road_geometry(route_id):
    agency = request.args.get("agency", "rapid-bus-kl")
    requested_trip_id = request.args.get("trip_id", "").strip()
    direction = request.args.get("direction_id")
    roads_key = os.getenv("GOOGLE_ROADS_API_KEY", "").strip() or os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not roads_key:
        return jsonify({"success": False, "error": "Google Roads API key is not configured"}), 503

    with db_connection() as connection:
        params = [agency, route_id]
        trip_filter = ""
        if requested_trip_id:
            trip_filter = " AND trip_id = ?"
            params.append(requested_trip_id)
        elif direction is not None:
            trip_filter = " AND direction_id = ?"
            params.append(direction)
        trip = connection.execute(
            f"""SELECT trip_id FROM trips WHERE agency_id = ? AND route_id = ?{trip_filter}
                ORDER BY CASE WHEN shape_id IS NULL OR shape_id = '' THEN 1 ELSE 0 END LIMIT 1""",
            params,
        ).fetchone()
        if not trip:
            return jsonify({"success": False, "error": "Route trip not found"}), 404
        rows = connection.execute(
            """SELECT s.stop_lat, s.stop_lon FROM stop_times st JOIN stops s
               ON s.agency_id = st.agency_id AND s.stop_id = st.stop_id
               WHERE st.agency_id = ? AND st.trip_id = ? ORDER BY st.stop_sequence""",
            (agency, trip["trip_id"]),
        ).fetchall()

    stops = [(float(row["stop_lat"]), float(row["stop_lon"])) for row in rows]
    if len(stops) < 2:
        return jsonify({"success": False, "error": "Not enough route stops"}), 422
    cache_key = (agency, route_id, trip["trip_id"])
    cached = _road_geometry_cache.get(cache_key)
    if cached and time.time() - cached["timestamp"] < 7 * 24 * 3600:
        return jsonify({"success": True, "data": cached["points"], "source": "google-roads-cache"})

    dense_points = densify_path(stops)
    chunks = [dense_points[start:start + 90] for start in range(0, len(dense_points) - 1, 89)]
    snapped = []
    try:
        for chunk in chunks:
            response = requests.get(
                "https://roads.googleapis.com/v1/snapToRoads",
                params={
                    "path": "|".join(f"{lat:.7f},{lon:.7f}" for lat, lon in chunk),
                    "interpolate": "true",
                    "key": roads_key,
                },
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise ValueError(payload["error"].get("message", "Road snapping failed"))
            chunk_points = [
                (float(item["location"]["latitude"]), float(item["location"]["longitude"]))
                for item in payload.get("snappedPoints", [])
            ]
            if len(chunk_points) < 2:
                raise ValueError("Roads API returned insufficient geometry")
            if snapped and point_distance_m(snapped[-1], chunk_points[0]) < 5:
                chunk_points = chunk_points[1:]
            snapped.extend(chunk_points)
    except (requests.RequestException, ValueError, KeyError, TypeError):
        app.logger.exception("Google Roads geometry failed for %s/%s", agency, route_id)
        return jsonify({"success": False, "error": "Google Roads could not produce a reliable route"}), 502

    # Fail closed: every official station must remain close to the snapped path,
    # and snapping must not create a route several times longer than the inputs.
    maximum_stop_offset = max(min(point_distance_m(stop, point) for point in snapped) for stop in stops)
    input_length = sum(point_distance_m(a, b) for a, b in zip(dense_points, dense_points[1:]))
    snapped_length = sum(point_distance_m(a, b) for a, b in zip(snapped, snapped[1:]))
    # Bus stops are normally placed beside the served road. A generous
    # tolerance can incorrectly accept a parallel highway, as happens around
    # Gopeng on A34. Prefer an honest station chain over misleading geometry.
    if maximum_stop_offset > 40 or snapped_length > input_length * 1.65:
        return jsonify({
            "success": False,
            "error": "Snapped route failed station validation",
            "maximum_stop_offset_m": round(maximum_stop_offset),
        }), 422

    points = [{"lat": lat, "lon": lon} for lat, lon in snapped]
    _road_geometry_cache[cache_key] = {"timestamp": time.time(), "points": points}
    return jsonify({"success": True, "data": points, "source": "google-roads"})


@app.get("/api/journeys")
def plan_journey():
    agency = request.args.get("agency", "rapid-bus-kl")
    from_stop = request.args.get("from_stop", "").strip()
    to_stop = request.args.get("to_stop", "").strip()
    date_text = request.args.get("date", "").strip()
    departure_text = request.args.get("departure_time", "").strip()
    limit = min(max(request.args.get("limit", 6, type=int), 1), 12)
    if not from_stop or not to_stop or from_stop == to_stop:
        return jsonify({"success": False, "error": "Choose two different stops"}), 400

    try:
        service_date = datetime.strptime(date_text, "%Y-%m-%d").date() if date_text else datetime.now().date()
        if departure_text:
            departure_clock = datetime.strptime(departure_text, "%H:%M")
            requested_seconds = departure_clock.hour * 3600 + departure_clock.minute * 60
        else:
            now = datetime.now()
            requested_seconds = now.hour * 3600 + now.minute * 60 + now.second
    except ValueError:
        return jsonify({"success": False, "error": "Use YYYY-MM-DD and HH:MM formats"}), 400
    window_start = f"{requested_seconds // 3600:02d}:{(requested_seconds % 3600) // 60:02d}:00"
    window_end_seconds = requested_seconds + 5 * 3600
    window_end = f"{window_end_seconds // 3600:02d}:{(window_end_seconds % 3600) // 60:02d}:59"

    with db_connection() as connection:
        if not table_exists(connection, "stop_times"):
            return jsonify({"success": False, "error": "Rebuild gtfs_static.db to enable journeys"}), 503
        stop_rows = connection.execute(
            """SELECT stop_id, stop_name FROM stops
               WHERE agency_id = ? AND stop_id IN (?, ?)""",
            (agency, from_stop, to_stop),
        ).fetchall()
        if len(stop_rows) != 2:
            return jsonify({"success": False, "error": "One or both stops were not found"}), 404
        stop_names = {row["stop_id"]: row["stop_name"] for row in stop_rows}
        active_services = active_service_ids(connection, agency, service_date)
        if not active_services:
            return jsonify({"success": True, "data": [], "notice": "No scheduled service on this date"})

        placeholders = ",".join("?" for _ in active_services)
        rows = connection.execute(
            f"""SELECT t.trip_id, t.service_id, t.trip_headsign, t.direction_id,
                       r.route_id, r.route_short_name, r.route_long_name, r.route_color,
                       origin.departure_time, origin.stop_sequence AS origin_sequence,
                       destination.arrival_time, destination.stop_sequence AS destination_sequence
                FROM stop_times origin
                JOIN stop_times destination ON destination.agency_id = origin.agency_id
                    AND destination.trip_id = origin.trip_id
                    AND CAST(destination.stop_sequence AS INTEGER) > CAST(origin.stop_sequence AS INTEGER)
                JOIN trips t ON t.agency_id = origin.agency_id AND t.trip_id = origin.trip_id
                JOIN routes r ON r.agency_id = t.agency_id AND r.route_id = t.route_id
                WHERE origin.agency_id = ? AND origin.stop_id = ? AND destination.stop_id = ?
                    AND t.service_id IN ({placeholders})
                    AND origin.departure_time BETWEEN ? AND ?""",
            [agency, from_stop, to_stop, *active_services, window_start, window_end],
        ).fetchall()

    journeys = []
    seen = set()
    for row in rows:
        departure_seconds = gtfs_seconds(row["departure_time"])
        arrival_seconds = gtfs_seconds(row["arrival_time"])
        if departure_seconds is None or arrival_seconds is None or arrival_seconds < departure_seconds:
            continue
        wait_seconds = departure_seconds - requested_seconds
        if wait_seconds < 0:
            continue
        signature = (row["route_id"], departure_seconds, arrival_seconds)
        if signature in seen:
            continue
        seen.add(signature)
        journeys.append({
            "trip_id": row["trip_id"],
            "route_id": row["route_id"],
            "route_short_name": row["route_short_name"] or "Route",
            "route_long_name": row["route_long_name"] or "",
            "route_color": row["route_color"] or "2563EB",
            "headsign": row["trip_headsign"] or row["route_long_name"] or "",
            "direction_id": row["direction_id"],
            "departure_time": format_gtfs_seconds(departure_seconds),
            "arrival_time": format_gtfs_seconds(arrival_seconds),
            "wait_minutes": math.ceil(wait_seconds / 60),
            "duration_minutes": math.ceil((arrival_seconds - departure_seconds) / 60),
            "stop_count": int(row["destination_sequence"]) - int(row["origin_sequence"]),
            "from_stop": {"stop_id": from_stop, "stop_name": stop_names[from_stop]},
            "to_stop": {"stop_id": to_stop, "stop_name": stop_names[to_stop]},
            "transfers": 0,
        })
    journeys.sort(key=lambda item: (item["arrival_time"], item["duration_minutes"]))
    return jsonify({
        "success": True,
        "data": journeys[:limit],
        "notice": "Direct scheduled journeys; walking and transfers are coming next",
    })


@app.get("/api/journeys/nearby")
def plan_nearby_journey():
    agency = request.args.get("agency", "rapid-bus-kl")
    coordinates = {
        name: (request.args.get(f"{name}_lat", type=float), request.args.get(f"{name}_lng", type=float))
        for name in ("from", "to")
    }
    if any(lat is None or lon is None for lat, lon in coordinates.values()):
        return jsonify({"success": False, "error": "Origin and destination coordinates are required"}), 400
    date_text = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    time_text = request.args.get("departure_time") or datetime.now().strftime("%H:%M")
    try:
        service_date = datetime.strptime(date_text, "%Y-%m-%d").date()
        clock = datetime.strptime(time_text, "%H:%M")
        requested_seconds = clock.hour * 3600 + clock.minute * 60
    except ValueError:
        return jsonify({"success": False, "error": "Use YYYY-MM-DD and HH:MM formats"}), 400
    window_start = f"{requested_seconds // 3600:02d}:{(requested_seconds % 3600) // 60:02d}:00"
    window_end_seconds = requested_seconds + 5 * 3600
    window_end = f"{window_end_seconds // 3600:02d}:{(window_end_seconds % 3600) // 60:02d}:59"

    with db_connection() as connection:
        # Direct journeys need a wider candidate set than transfers. Dense
        # city areas can have many closer stops from unrelated routes, which
        # previously pushed a valid through-route stop (for example A34) out
        # of the six-stop shortlist and produced an unnecessary transfer.
        origins = nearby_stops(connection, agency, *coordinates["from"], limit=12)
        destinations = nearby_stops(connection, agency, *coordinates["to"], limit=12)
        if not origins:
            return jsonify({"success": True, "data": [], "notice": "No selected-operator stops were found within 5 km of the starting point"})
        if not destinations:
            return jsonify({"success": True, "data": [], "notice": "No selected-operator stops were found within 5 km of the destination"})
        active_services = active_service_ids(connection, agency, service_date)
        if not active_services:
            return jsonify({"success": True, "data": [], "notice": "No scheduled service on this date"})
        origin_map = {item["stop_id"]: item for item in origins}
        destination_map = {item["stop_id"]: item for item in destinations}
        origin_marks = ",".join("?" for _ in origins)
        destination_marks = ",".join("?" for _ in destinations)
        service_marks = ",".join("?" for _ in active_services)
        rows = connection.execute(
            f"""SELECT origin.stop_id AS origin_stop_id, destination.stop_id AS destination_stop_id,
                       origin.departure_time, destination.arrival_time,
                       CAST(destination.stop_sequence AS INTEGER) - CAST(origin.stop_sequence AS INTEGER) AS stop_count,
                       t.trip_id, t.trip_headsign, t.direction_id, r.route_id,
                       r.route_short_name, r.route_long_name, r.route_color
                FROM stop_times origin
                JOIN stop_times destination ON destination.agency_id=origin.agency_id
                  AND destination.trip_id=origin.trip_id
                  AND CAST(destination.stop_sequence AS INTEGER)>CAST(origin.stop_sequence AS INTEGER)
                JOIN trips t ON t.agency_id=origin.agency_id AND t.trip_id=origin.trip_id
                JOIN routes r ON r.agency_id=t.agency_id AND r.route_id=t.route_id
                WHERE origin.agency_id=? AND origin.stop_id IN ({origin_marks})
                  AND destination.stop_id IN ({destination_marks}) AND t.service_id IN ({service_marks})
                  AND origin.departure_time BETWEEN ? AND ?""",
            [agency, *origin_map, *destination_map, *active_services, window_start, window_end],
        ).fetchall()
        transfer_origin_map = {item["stop_id"]: item for item in origins[:6]}
        transfer_destination_map = {item["stop_id"]: item for item in destinations[:6]}
        has_viable_direct = any(
            (gtfs_seconds(row["departure_time"]) or -1) >= requested_seconds
            and (gtfs_seconds(row["arrival_time"]) or -1) >= (gtfs_seconds(row["departure_time"]) or 0)
            for row in rows
        )
        transfer_results = [] if has_viable_direct else one_transfer_journeys(
            connection, agency, transfer_origin_map, transfer_destination_map, active_services, requested_seconds
        )

    journeys, seen = [], set()
    for row in rows:
        departure_seconds = gtfs_seconds(row["departure_time"])
        arrival_seconds = gtfs_seconds(row["arrival_time"])
        origin, destination = origin_map[row["origin_stop_id"]], destination_map[row["destination_stop_id"]]
        origin_walk_minutes = math.ceil(origin["distance_m"] / 78)
        if departure_seconds is None or arrival_seconds is None or departure_seconds < requested_seconds + origin_walk_minutes * 60 or arrival_seconds < departure_seconds:
            continue
        signature = (row["route_id"], departure_seconds, arrival_seconds, origin["stop_id"], destination["stop_id"])
        if signature in seen:
            continue
        seen.add(signature)
        walk_distance = origin["distance_m"] + destination["distance_m"]
        walk_minutes = math.ceil(walk_distance / 78)  # approximately 1.3 metres/second
        wait_minutes = max(0, math.ceil((departure_seconds - requested_seconds) / 60) - origin_walk_minutes)
        ride_minutes = math.ceil((arrival_seconds - departure_seconds) / 60)
        journeys.append({
            "trip_id": row["trip_id"], "route_id": row["route_id"],
            "route_short_name": row["route_short_name"] or "Route",
            "route_long_name": row["route_long_name"] or "", "route_color": row["route_color"] or "2563EB",
            "headsign": row["trip_headsign"] or row["route_long_name"] or "",
            "direction_id": row["direction_id"], "departure_time": format_gtfs_seconds(departure_seconds),
            "arrival_time": format_gtfs_seconds(arrival_seconds), "wait_minutes": wait_minutes,
            "duration_minutes": ride_minutes, "total_minutes": walk_minutes + wait_minutes + ride_minutes,
            "walk_minutes": walk_minutes, "walk_distance_m": walk_distance, "stop_count": int(row["stop_count"]),
            "from_stop": origin, "to_stop": destination, "transfers": 0,
        })
    journeys.extend(transfer_results)
    # Door-to-door ranking: walking is substantially less convenient than
    # waiting or riding, especially when a stop is available beside the user.
    # This avoids suggesting a long walk merely to arrive a few minutes sooner.
    journeys.sort(key=lambda item: (
        item["total_minutes"] + item["walk_minutes"] * 1.5 + item["transfers"] * 8,
        item["walk_minutes"], item["transfers"], item["arrival_time"],
    ))
    journeys = journeys[:8]
    if agency == "rapid-bus-penang" or (agency.startswith("mybas-") and agency != "mybas-kuching"):
        with db_connection() as connection:
            attach_estimated_fares(connection, agency, journeys)
    return jsonify({
        "success": True, "data": journeys,
        "notice": f"Compared {len(origins)} nearby origin stops with {len(destinations)} destination stops, including one transfer",
    })


OTP_PLAN_QUERY = """
query MariBusPlan($from: InputCoordinates!, $to: InputCoordinates!, $date: String!, $time: String!, $numItineraries: Int!) {
  plan(from: $from, to: $to, date: $date, time: $time, numItineraries: $numItineraries,
       maxTransfers: 2, transportModes: [{mode: WALK}, {mode: BUS}, {mode: RAIL}, {mode: SUBWAY}]) {
    messageStrings
    itineraries {
      startTime endTime duration walkDistance numberOfTransfers
      legs {
        mode transitLeg startTime endTime duration distance realTime
        from { name lat lon }
        to { name lat lon }
        route { gtfsId shortName longName color }
        legGeometry { points }
      }
    }
  }
}
"""


def coordinate_argument(name):
    latitude = request.args.get(f"{name}_lat", type=float)
    longitude = request.args.get(f"{name}_lng", type=float)
    if latitude is None or longitude is None or not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        return None
    return {"lat": latitude, "lon": longitude, "address": request.args.get(f"{name}_name", name.title())[:200]}


@app.get("/api/journeys/multimodal")
def plan_multimodal_journey():
    otp_url = os.getenv("OTP_GRAPHQL_URL", "").strip()
    if not otp_url:
        return jsonify({"success": False, "fallback_available": True, "error": "Multimodal routing is not configured"}), 503
    origin = coordinate_argument("from")
    destination = coordinate_argument("to")
    if not origin or not destination:
        return jsonify({"success": False, "error": "Valid origin and destination coordinates are required"}), 400
    date_text = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    time_text = request.args.get("departure_time") or datetime.now().strftime("%H:%M")
    try:
        datetime.strptime(f"{date_text} {time_text}", "%Y-%m-%d %H:%M")
    except ValueError:
        return jsonify({"success": False, "error": "Use YYYY-MM-DD and HH:MM formats"}), 400

    try:
        response = requests.post(
            otp_url,
            json={
                "query": OTP_PLAN_QUERY,
                "operationName": "MariBusPlan",
                "variables": {"from": origin, "to": destination, "date": date_text, "time": time_text, "numItineraries": 6},
            },
            headers={"Content-Type": "application/json", "OTPTimeout": "30000"},
            timeout=35,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("errors"):
            app.logger.error("OTP GraphQL errors: %s", payload["errors"])
            return jsonify({"success": False, "fallback_available": True, "error": "The journey engine rejected the request"}), 502
        plan = payload.get("data", {}).get("plan") or {}
        return jsonify({
            "success": True,
            "engine": "opentripplanner",
            "data": plan.get("itineraries") or [],
            "notice": "; ".join(plan.get("messageStrings") or []),
        })
    except (requests.RequestException, ValueError):
        app.logger.exception("OpenTripPlanner request failed")
        return jsonify({"success": False, "fallback_available": True, "error": "The multimodal journey engine is unavailable"}), 502


if __name__ == "__main__":
    app.run(port=5000, debug=os.getenv("FLASK_DEBUG") == "1")
