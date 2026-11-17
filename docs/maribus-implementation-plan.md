# MariBus implementation plan

## Goal

Make MariBus a Malaysia-first, door-to-door transit planner. It should select journeys from official schedules, live vehicle data, OpenStreetMap walking links, and MariBus-approved local paths. Google remains useful for place search and optional satellite imagery; it should not be the primary journey-decision engine.

## Target architecture

```text
Rider app
├─ Normal map: MapLibre + managed OSM vector tiles
├─ Satellite view: Google Maps, optional
├─ Destination search: Google Places initially
└─ MariBus API
   ├─ Journey presentation and ranking
   ├─ Live-bus cache
   ├─ Local-path/contribution API
   ├─ User and saved-route API
   └─ Google fallback
      ├─ OpenTripPlanner: OSM + GTFS + GTFS-Realtime + approved paths
      ├─ PostgreSQL + PostGIS: approved spatial data
      └─ Firebase: auth, saved routes, notifications, submissions
```

## Phase 0 — Stabilise current routing

### Work

- Keep Flask, the current Google map, and Google Places while routing is migrated.
- Define one internal journey-result format for OTP, local GTFS, and Google fallback results.
- Stop mixing routing engines without identifying the source in the UI.
- Always compare direct walking against transit, including walking, waiting, transfers, and ride time.

### Acceptance criteria

- A slower transit option is never recommended over a faster walk.
- Every itinerary shows total time from now, waiting time, walking time, transfers, and live/scheduled status.
- Google is only a clear fallback when MariBus routing cannot return an option.

## Phase 1 — Deploy OpenTripPlanner for Klang Valley

### Scope

- Rapid Bus KL
- MRT feeder buses
- Rapid Rail
- KTMB where relevant
- Puchong, PJ, Subang, and Kuala Lumpur first

### Work

1. Prepare OSM and Malaysian GTFS data.
2. Build an OTP graph.
3. Run OTP as a permanent, separate 4–8 GB RAM container/VM in a Singapore-region data centre.
4. Configure `OTP_GRAPHQL_URL` in MariBus production settings.
5. Call `/api/journeys/multimodal` first for every A-to-B search.
6. Use Google Routes only if OTP is unavailable.

### Existing project commands

```powershell
.venv\Scripts\python.exe prepare_otp_data.py --with-osm

docker run --rm `
  -e JAVA_TOOL_OPTIONS=-Xmx6g `
  -v "${PWD}/otp:/var/opentripplanner" `
  docker.io/opentripplanner/opentripplanner:latest --build --save
```

### Acceptance criteria

- OTP returns walk → transit → walk itineraries.
- It evaluates nearby boarding/alighting stops and transfers.
- Normal Klang Valley requests return in under three seconds.
- At least three meaningful alternatives are returned when available.

## Phase 2 — Malaysian transport-data pipeline

### Sources

Use the official `data.gov.my` GTFS feeds for Prasarana, KTMB, and BAS.MY.

| Job | Frequency | Purpose |
|---|---:|---|
| Download GTFS static | Daily, 4am | Schedules, stops, trips and shapes |
| Validate GTFS | Daily | Detect bad times, shapes and duplicates |
| Rebuild OTP graph | Daily/feed change | Apply new schedules and paths |
| Fetch GTFS-Realtime | Every 30 seconds | Vehicle positions |
| Cache live positions | 30–60 seconds | Serve users without source overload |
| Check feed freshness | Every 5 minutes | Detect stale/broken data |

### Rules

- Fetch GTFS-Realtime once in the backend, not from every rider device.
- Label vehicle data as `LIVE`, `SCHEDULED`, `STALE`, or `UNKNOWN`.
- Reject implausible vehicle positions and mismatched trip IDs.
- Preserve raw feed data long enough for debugging.

## Phase 3 — MariBus local walking network

### Supported path types

```text
footpath
covered_walkway
pedestrian_bridge
stairs
escalator
lift
mall_entrance
station_entrance
crossing
unsafe_crossing
restricted_access
```

### Data model

Store approved path data in PostgreSQL + PostGIS:

```text
walking_paths
walking_nodes
place_entrances
accessibility_features
path_reports
path_revisions
contribution_reviews
```

### Contribution workflow

```text
Submit → automatic validation → moderator review → publish → OTP graph update
```

### Safety and release policy

- Private testing may permit broad editing.
- Before release, anyone may submit but only moderators publish, edit, or delete approved paths.
- Keep revision history, contributor attribution, reports, and abuse rate limits.

### Acceptance criteria

- Approved paths improve actual OTP journeys.
- Covered paths can be preferred.
- Wheelchair mode can avoid stairs.
- Riders can see when a path is community verified.

## Phase 4 — Journey ranking

OTP finds valid trips; MariBus ranks them for riders.

```text
score =
  total travel time
  + walking penalty
  + transfer penalty
  + long-wait penalty
  + unreliable-live-data penalty
  + uncovered-walk penalty
  + stairs penalty
  - verified-shortcut benefit
  - live-vehicle confidence benefit
```

### Rider preferences

- Fastest
- Less walking
- Fewer transfers
- Covered route
- Wheelchair-friendly
- Avoid stairs

### Acceptance criteria

- Explain why a route is recommended.
- Never prefer a long wait over a faster walking alternative.
- Show the effect of user preferences clearly.

## Phase 5 — App experience

### Normal rider flow

```text
Open app → map-first home → “Where to?”
→ full-screen destination search → current location as origin
→ route loading → journey options → route detail → guidance
```

### Route options

Show separate sections for:

- Recommended
- Walking
- Public transport alternatives

Each route shows total time, arrival time, walking, waiting, transfers, route badges, and live/scheduled status.

### Route detail

- Map-first layout
- Clear origin and destination markers
- Walking and transit paths
- Large duration and arrival card
- Simple progress/timeline
- `Start guidance` action

### Editor

Keep path contribution in a separate edit mode. It must never block normal route planning.

## Phase 6 — Map migration

### Stage A

Google map, Google Places, Google satellite, OTP routing.

### Stage B

MapLibre plus managed OSM vector tiles as the normal map; Google Places and satellite retained.

### Stage C

Local popular-place search and Google Places fallback only.

Do not use `tile.openstreetmap.org` directly for production traffic. Use a managed vector-tile provider or self-host tiles.

## Phase 7 — Monitoring and cost control

Monitor:

- OTP response time and success rate
- GTFS and GTFS-Realtime freshness
- Google calls per SKU
- Journey failures
- Contribution/moderation queue
- Client errors

Cost controls:

- Cache popular place selections.
- Cache journey results by short origin/destination/time buckets.
- Cache real-time feeds server-side.
- Keep Google Routes as fallback.
- Set Google budget alerts and quotas.
- Make satellite opt-in rather than default.

## Delivery sequence

1. Deploy OTP and configure `OTP_GRAPHQL_URL`.
2. Automate GTFS and real-time ingestion.
3. Route all A-to-B searches through OTP.
4. Add reviewed local walking paths to the routing graph.
5. Complete destination-first search and Transit-style route detail UI.
6. Move the normal map to MapLibre/OSM.
7. Add nationwide feeds after Klang Valley routing is reliable.

## First implementation task

Deploy OpenTripPlanner using Klang Valley GTFS plus OSM data, then configure production `OTP_GRAPHQL_URL`. This is the dependency that turns MariBus from a collection of route fallbacks into a single real multimodal journey planner.
