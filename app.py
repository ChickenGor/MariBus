from flask import Flask, jsonify, request
from flask_cors import CORS
from google.transit import gtfs_realtime_pb2
from google.protobuf.json_format import MessageToDict
import requests
import sqlite3

app = Flask(__name__)
CORS(app) 

API_URLS = {
    "rapid-bus-kl": "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl",
    "rapid-bus-mrtfeeder": "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder",
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
    "mybas-kuching": "https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuching"
}

def get_route_details(trip_id, route_id=None):
    try:
        conn = sqlite3.connect('gtfs_static.db')
        cursor = conn.cursor()
        
        # 1. Try an exact match on Trip ID
        cursor.execute("SELECT route_short_name, route_long_name FROM trip_routes WHERE trip_id = ?", (trip_id,))
        result = cursor.fetchone()
        
        # 2. Try a partial match on Trip ID (stripping suffixes like _T7)
        if not result and trip_id and "_" in trip_id:
            base_trip_id = trip_id.split("_")[0]
            cursor.execute("SELECT route_short_name, route_long_name FROM trip_routes WHERE trip_id LIKE ?", (f"{base_trip_id}%",))
            result = cursor.fetchone()
            
        # 3. Try to look up by the raw Route ID in the database
        if not result and route_id:
            cursor.execute("SELECT route_short_name, route_long_name FROM trip_routes WHERE route_id = ?", (route_id,))
            result = cursor.fetchone()
            
        conn.close()
        
        # If any of the database lookups succeeded, use that data
        if result:
            short_name = result[0] if result[0] and str(result[0]) != "nan" else "Route"
            return {"short_name": short_name, "long_name": result[1]}
            
        # 4. SMART FALLBACK: If the DB knows absolutely nothing, use the live data's Route ID!
        if route_id:
            # Clean up common system prefixes if they exist (e.g., 'rapid-bus-kl_220' -> '220')
            clean_route = route_id.split("_")[-1] if "_" in route_id else route_id
            return {"short_name": clean_route, "long_name": "Live Dispatched Route"}
            
        return {"short_name": "Bus", "long_name": "Active Fleet Vehicle"}
        
    except Exception as e:
        # Graceful fallback even if the database file is completely missing
        clean_route = route_id.split("_")[-1] if (route_id and "_" in route_id) else (route_id or "Bus")
        return {"short_name": clean_route, "long_name": "Live Dispatched Route"}

@app.route('/api/live-buses', methods=['GET'])
def get_live_buses():
    agency = request.args.get('agency', 'rapid-bus-kl')
    url = API_URLS.get(agency)
    
    if not url:
        return jsonify({"success": False, "error": "Invalid agency selected"}), 400

    try:
        response = requests.get(url, timeout=10)
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(response.content)
        
        bus_data = []
        for entity in feed.entity:
            if entity.HasField('vehicle'):
                vehicle_dict = MessageToDict(entity.vehicle)
                
                # Extract Trip ID and Route ID safely from the proto message
                trip_id = vehicle_dict.get('trip', {}).get('tripId')
                route_id = vehicle_dict.get('trip', {}).get('routeId')
                
                if trip_id or route_id:
                    # Pass both IDs to our upgraded database searcher
                    vehicle_dict['route_info'] = get_route_details(trip_id, route_id)
                else:
                    vehicle_dict['route_info'] = {"short_name": "N/A", "long_name": "No active trip or route assigned"}

                bus_data.append(vehicle_dict)
                
        return jsonify({"success": True, "data": bus_data})
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    print("Starting MariBus Backend Server...")
    app.run(port=5000, debug=True)