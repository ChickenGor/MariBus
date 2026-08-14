import csv
import gzip
import io
import os
import sqlite3
import tempfile
import shutil
import zipfile

import requests

from app import API_URLS


STATIC_URLS = {
    agency: url.replace("gtfs-realtime/vehicle-position", "gtfs-static").split("?")[0]
    + ("?" + url.split("?", 1)[1] if "?" in url else "")
    for agency, url in API_URLS.items()
}
# Providers whose static endpoint does not use the realtime provider path.
STATIC_URLS.update({
    "ktmb": "https://api.data.gov.my/gtfs-static/ktmb",
})

SCHEMAS = {
    "routes": ["route_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
    "trips": ["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"],
    "stops": ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station", "wheelchair_boarding"],
    "stop_times": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    "shapes": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
    "calendar": ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
    "calendar_dates": ["service_id", "date", "exception_type"],
}

REAL_COLUMNS = {"stop_lat", "stop_lon", "shape_pt_lat", "shape_pt_lon", "shape_dist_traveled"}
INTEGER_COLUMNS = {
    "route_type", "direction_id", "stop_sequence", "pickup_type", "drop_off_type",
    "shape_pt_sequence", "location_type", "wheelchair_boarding", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday", "exception_type",
}


def create_tables(connection):
    for table, columns in SCHEMAS.items():
        connection.execute(f"DROP TABLE IF EXISTS {table}")
        definitions = ["agency_id TEXT"]
        for column in columns:
            column_type = "REAL" if column in REAL_COLUMNS else "INTEGER" if column in INTEGER_COLUMNS else "TEXT"
            definitions.append(f"{column} {column_type}")
        definitions = ", ".join(definitions)
        connection.execute(f"CREATE TABLE {table} ({definitions})")
    connection.execute("DROP TABLE IF EXISTS trip_routes")
    connection.execute("""CREATE TABLE trip_routes (
        agency_id TEXT, trip_id TEXT, route_id TEXT,
        route_short_name TEXT, route_long_name TEXT
    )""")


def import_csv(connection, archive, agency, table):
    filename = f"{table}.txt"
    if filename not in archive.namelist():
        return 0
    with archive.open(filename) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
        columns = SCHEMAS[table]
        placeholders = ",".join("?" for _ in range(len(columns) + 1))
        query = f"INSERT INTO {table} (agency_id,{','.join(columns)}) VALUES ({placeholders})"
        batch = []
        count = 0
        for row in reader:
            batch.append([agency] + [row.get(column, "") for column in columns])
            if len(batch) == 5000:
                connection.executemany(query, batch)
                count += len(batch)
                batch.clear()
        if batch:
            connection.executemany(query, batch)
            count += len(batch)
        return count


def main():
    database_path = os.path.join(os.path.dirname(__file__), "gtfs_static.db")
    fd, temporary_path = tempfile.mkstemp(prefix="maribus-", suffix=".db", dir=os.path.dirname(database_path))
    os.close(fd)
    try:
        connection = sqlite3.connect(temporary_path)
        create_tables(connection)
        imported_totals = {table: 0 for table in SCHEMAS}
        for agency, url in STATIC_URLS.items():
            print(f"Downloading {agency}...")
            try:
                response = requests.get(url, timeout=60)
                response.raise_for_status()
                with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                    counts = {table: import_csv(connection, archive, agency, table) for table in SCHEMAS}
                for table, count in counts.items():
                    imported_totals[table] += count
                connection.commit()
                print("  " + ", ".join(f"{name}={count}" for name, count in counts.items() if count))
            except Exception as error:
                connection.rollback()
                print(f"  skipped: {error}")

        if not imported_totals["routes"] or not imported_totals["trips"] or not imported_totals["stops"]:
            raise RuntimeError("No usable GTFS feeds were downloaded; the existing database was preserved")

        connection.execute("""INSERT INTO trip_routes
            SELECT t.agency_id, t.trip_id, t.route_id, r.route_short_name, r.route_long_name
            FROM trips t JOIN routes r ON r.agency_id=t.agency_id AND r.route_id=t.route_id""")
        indexes = [
            "CREATE INDEX idx_trip_routes_trip ON trip_routes(agency_id, trip_id)",
            "CREATE INDEX idx_trip_routes_route ON trip_routes(agency_id, route_id)",
            "CREATE INDEX idx_stops_location ON stops(agency_id, stop_lat, stop_lon)",
            "CREATE INDEX idx_stop_times_stop ON stop_times(agency_id, stop_id)",
            "CREATE INDEX idx_stop_times_trip ON stop_times(agency_id, trip_id, stop_sequence)",
            "CREATE INDEX idx_trips_route ON trips(agency_id, route_id, direction_id)",
            "CREATE INDEX idx_shapes ON shapes(agency_id, shape_id, shape_pt_sequence)",
        ]
        for statement in indexes:
            connection.execute(statement)
        connection.commit()
        connection.close()
        os.replace(temporary_path, database_path)
        packaged_path = database_path + ".gz"
        packaged_temporary_path = packaged_path + ".tmp"
        with open(database_path, "rb") as source, gzip.open(packaged_temporary_path, "wb", compresslevel=9) as destination:
            shutil.copyfileobj(source, destination)
        os.replace(packaged_temporary_path, packaged_path)
        print(f"Database built successfully: {database_path}")
        print(f"Deployment package built successfully: {packaged_path}")
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


if __name__ == "__main__":
    main()
