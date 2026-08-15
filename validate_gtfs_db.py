import argparse
import gzip
import json
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone

from build_static_db import REQUIRED_ROUTE_AGENCIES, STATIC_URLS


COUNT_TABLES = ("routes", "trips", "stops", "stop_times", "shapes")
DROP_GUARD_TABLES = ("routes", "trips", "stops", "stop_times")
MINIMUM_BASELINE_RATIO = 0.60


def query_value(connection, sql, parameters=()):
    return connection.execute(sql, parameters).fetchone()[0]


def count_metrics(connection, agency):
    return {
        table: query_value(connection, f"SELECT COUNT(*) FROM {table} WHERE agency_id=?", (agency,))
        for table in COUNT_TABLES
    }


def agency_metrics(connection, agency):
    metrics = count_metrics(connection, agency)
    metrics.update({
        "invalid_stop_coordinates": query_value(connection, """
            SELECT COUNT(*) FROM stops
            WHERE agency_id=? AND (stop_lat NOT BETWEEN -90 AND 90 OR stop_lon NOT BETWEEN -180 AND 180)
        """, (agency,)),
    })
    return metrics


def integrity_issues(connection):
    # EXCEPT lets SQLite scan each indexed table once. Correlated joins against
    # stop_times were dramatically slower on the combined national database.
    orphan_trip_agencies = {
        row[0] for row in connection.execute(
            "SELECT agency_id,route_id FROM trips EXCEPT SELECT agency_id,route_id FROM routes"
        )
    }
    orphan_stop_counts = {}
    for agency, _stop_id in connection.execute(
        "SELECT agency_id,stop_id FROM stop_times EXCEPT SELECT agency_id,stop_id FROM stops"
    ):
        orphan_stop_counts[agency] = orphan_stop_counts.get(agency, 0) + 1
    trips_without_times = {}
    for agency, _trip_id in connection.execute(
        "SELECT agency_id,trip_id FROM trips EXCEPT SELECT agency_id,trip_id FROM stop_times"
    ):
        trips_without_times[agency] = trips_without_times.get(agency, 0) + 1
    return orphan_trip_agencies, orphan_stop_counts, trips_without_times


def compressed_database_metrics(path):
    if not os.path.exists(path):
        return None
    fd, temporary_path = tempfile.mkstemp(prefix="maribus-validation-", suffix=".db")
    os.close(fd)
    try:
        with gzip.open(path, "rb") as source, open(temporary_path, "wb") as destination:
            shutil.copyfileobj(source, destination)
        connection = sqlite3.connect(temporary_path)
        try:
            agency_row = connection.execute("SELECT agency_id FROM routes LIMIT 1").fetchone()
            if not agency_row:
                agency_row = connection.execute("SELECT agency_id FROM stops LIMIT 1").fetchone()
            return count_metrics(connection, agency_row[0]) if agency_row else {table: 0 for table in COUNT_TABLES}
        finally:
            connection.close()
    finally:
        os.remove(temporary_path)


def validate(database_path, baseline_directory=None):
    connection = sqlite3.connect(database_path)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database": os.path.basename(database_path),
        "minimum_baseline_ratio": MINIMUM_BASELINE_RATIO,
        "agencies": {},
        "errors": [],
        "warnings": [],
    }
    try:
        orphan_trip_agencies, orphan_stop_counts, trips_without_times = integrity_issues(connection)
        for agency in STATIC_URLS:
            metrics = agency_metrics(connection, agency)
            baseline = compressed_database_metrics(os.path.join(baseline_directory, f"{agency}.db.gz")) if baseline_directory else None
            report["agencies"][agency] = {"metrics": metrics, "baseline": baseline}

            if agency in REQUIRED_ROUTE_AGENCIES:
                for table in DROP_GUARD_TABLES:
                    if metrics[table] <= 0:
                        report["errors"].append(f"{agency}: {table} is empty")
            if metrics["invalid_stop_coordinates"]:
                report["errors"].append(f"{agency}: {metrics['invalid_stop_coordinates']} invalid stop coordinates")
            if agency in orphan_trip_agencies:
                report["errors"].append(f"{agency}: one or more trips reference missing routes")
            if orphan_stop_counts.get(agency):
                report["warnings"].append(
                    f"{agency}: {orphan_stop_counts[agency]} referenced stop IDs are missing from stops.txt"
                )
            if trips_without_times.get(agency):
                report["warnings"].append(
                    f"{agency}: {trips_without_times[agency]} trips contain no stop times"
                )

            if baseline:
                for table in DROP_GUARD_TABLES:
                    old_count = baseline.get(table, 0)
                    if old_count and metrics[table] < old_count * MINIMUM_BASELINE_RATIO:
                        percentage = round((1 - metrics[table] / old_count) * 100)
                        report["errors"].append(
                            f"{agency}: {table} dropped {percentage}% ({old_count:,} to {metrics[table]:,})"
                        )
    finally:
        connection.close()
    report["valid"] = not report["errors"]
    return report


def markdown_report(report):
    status = "PASS" if report["valid"] else "FAIL"
    lines = [
        f"# MariBus GTFS validation: {status}", "",
        f"Generated: {report['generated_at']}", "",
        "| Operator | Routes | Trips | Stops | Stop times | Shapes | Baseline change |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for agency, details in report["agencies"].items():
        metrics, baseline = details["metrics"], details["baseline"]
        changes = []
        if baseline:
            for table in ("routes", "trips", "stops"):
                old = baseline.get(table, 0)
                if old:
                    changes.append(f"{table} {(metrics[table] - old) / old:+.1%}")
        lines.append(
            f"| {agency} | {metrics['routes']:,} | {metrics['trips']:,} | {metrics['stops']:,} | "
            f"{metrics['stop_times']:,} | {metrics['shapes']:,} | {', '.join(changes) or 'n/a'} |"
        )
    for heading, key in (("Errors", "errors"), ("Warnings", "warnings")):
        lines.extend(["", f"## {heading}", ""])
        lines.extend([f"- {message}" for message in report[key]] or ["- None"])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Validate a freshly generated MariBus GTFS database")
    parser.add_argument("--database", default="gtfs_static.db")
    parser.add_argument("--baseline-dir")
    parser.add_argument("--json", dest="json_path")
    parser.add_argument("--markdown", dest="markdown_path")
    args = parser.parse_args()
    report = validate(args.database, args.baseline_dir)
    rendered = markdown_report(report)
    print(rendered)
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as output:
            json.dump(report, output, indent=2)
    if args.markdown_path:
        with open(args.markdown_path, "w", encoding="utf-8") as output:
            output.write(rendered)
    raise SystemExit(0 if report["valid"] else 1)


if __name__ == "__main__":
    main()
