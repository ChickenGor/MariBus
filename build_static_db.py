import pandas as pd
import sqlite3
import zipfile
import io
import requests

STATIC_URLS = {
    "rapid-bus-kl": "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl",
    "rapid-bus-mrtfeeder": "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder",
    "ktmb": "https://api.data.gov.my/gtfs-static/ktmb",
    "mybas-kangar": "https://api.data.gov.my/gtfs-static/mybas-kangar",
    "mybas-alor-setar": "https://api.data.gov.my/gtfs-static/mybas-alor-setar",
    "mybas-kota-bharu": "https://api.data.gov.my/gtfs-static/mybas-kota-bharu",
    "mybas-kuala-terengganu": "https://api.data.gov.my/gtfs-static/mybas-kuala-terengganu",
    "mybas-ipoh": "https://api.data.gov.my/gtfs-static/mybas-ipoh",
    "mybas-seremban-A": "https://api.data.gov.my/gtfs-static/mybas-seremban-a",
    "mybas-seremban-B": "https://api.data.gov.my/gtfs-static/mybas-seremban-b",
    "mybas-melaka": "https://api.data.gov.my/gtfs-static/mybas-melaka",
    "mybas-johor-bahru": "https://api.data.gov.my/gtfs-static/mybas-johor",
    "mybas-kuching": "https://api.data.gov.my/gtfs-static/mybas-kuching"
}

conn = sqlite3.connect('gtfs_static.db')
cursor = conn.cursor()

# 1. Drop old table and create a fresh one explicitly
cursor.execute("DROP TABLE IF EXISTS trip_routes")
cursor.execute("""
    CREATE TABLE trip_routes (
        trip_id TEXT,
        route_id TEXT,
        route_short_name TEXT,
        route_long_name TEXT
    )
""")
conn.commit()

print("Starting National Transit Database Build...\n")

for agency, url in STATIC_URLS.items():
    print(f"Downloading {agency}...")
    try:
        # Increased timeout to 30 seconds to prevent network drops
        response = requests.get(url, timeout=30)
        if response.status_code != 200:
            print(f"  -> Skipped: Server responded with status {response.status_code}")
            continue
            
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            with z.open('routes.txt') as f:
                routes_df = pd.read_csv(f, dtype=str)
                if 'route_short_name' not in routes_df.columns:
                    routes_df['route_short_name'] = ""
                routes_df = routes_df[['route_id', 'route_short_name', 'route_long_name']]
                
            with z.open('trips.txt') as f:
                trips_df = pd.read_csv(f, dtype=str)[['route_id', 'trip_id']]
                
        merged_df = pd.merge(trips_df, routes_df, on='route_id', how='left')
        
        # Save data into our structured table
        merged_df.to_sql('trip_routes', conn, if_exists='append', index=False)
        print(f"  -> Success! Added {len(merged_df)} trips.")
        
    except Exception as e:
        print(f"  -> Error processing {agency}: {e}")

print("\nOptimizing search speeds...")
cursor.execute("CREATE INDEX IF NOT EXISTS idx_trip_id ON trip_routes(trip_id)")
conn.commit()

conn.close()
print("\nDatabase built successfully!")