import argparse
import os
from pathlib import Path

import requests

from build_static_db import STATIC_URLS


OSM_URL = "https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf"


def download(url, destination):
    temporary = destination.with_suffix(destination.suffix + ".part")
    print(f"Downloading {destination.name}...")
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with temporary.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)
    os.replace(temporary, destination)


def main():
    parser = argparse.ArgumentParser(description="Prepare MariBus GTFS and OpenStreetMap inputs for OpenTripPlanner")
    parser.add_argument("--with-osm", action="store_true", help="Also download the roughly 250 MB Malaysia/Singapore/Brunei OSM extract")
    parser.add_argument("--force", action="store_true", help="Replace existing input downloads")
    args = parser.parse_args()
    target = Path(__file__).resolve().parent / "otp"
    target.mkdir(exist_ok=True)

    for agency, url in STATIC_URLS.items():
        destination = target / f"{agency}-gtfs.zip"
        if args.force or not destination.exists():
            download(url, destination)
        else:
            print(f"Keeping {destination.name}")

    osm_destination = target / "malaysia-singapore-brunei.osm.pbf"
    if args.with_osm and (args.force or not osm_destination.exists()):
        download(OSM_URL, osm_destination)
    elif not osm_destination.exists():
        print("OSM extract not downloaded. Run again with --with-osm before building the OTP graph.")


if __name__ == "__main__":
    main()
