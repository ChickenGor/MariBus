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

## Revised delivery roadmap

The delivery order below replaces the earlier sequence. It intentionally delays a React Native rewrite and a map-provider migration: neither fixes the current A-to-B journey quality problem.

### Phase 0 — Measure and protect routing quality (now, about one week)

1. Freeze new map/editor features while the planner is stabilised.
2. Create a Klang Valley regression catalogue of 30–50 real journeys, including the PFCC Tower 4&5 lobby → Lotus's Puchong example, short walks, buses, rail, transfers, and inaccessible routes.
3. Record the expected best option, total time, walking time, transfers, and the evidence source (operator timetable, actual trip, or a trusted competitor for comparison only).
4. Audit every GTFS feed with a validator before it enters routing; flag invalid stop locations, malformed times, duplicate trips, missing shapes, and stale feeds.
5. Define launch measurements: successful search rate, p95 response time, itinerary mismatch rate, and the percentage of searches where walking beats transit.

**Exit gate:** MariBus has a repeatable way to prove that a routing change improves, rather than accidentally worsens, its important journeys.

### Phase 1 — Build and validate OTP privately (one to two weeks)

1. Build an OpenTripPlanner graph locally from the audited Klang Valley GTFS feeds and Malaysian OSM data already in `otp/`.
2. Run the regression catalogue against OTP and inspect complete walk → transit → walk itineraries.
3. Fix data/configuration issues first: stop snapping, walk speed, transfer time, boarding cost, service calendars, and route shapes.
4. Keep the current production planner untouched while these results are compared.

**Exit gate:** OTP returns sensible results for the catalogue and does not select a slower transit journey when walking is genuinely faster.

### Phase 2 — Operate OTP safely in production (one to two weeks)

1. Deploy the MariBus API and OTP in the same low-latency region, with enough memory for graph building and serving (normally at least 8 GB for the builder).
2. Separate graph building from the live router. Download and validate new data, build a candidate graph, run canary journeys, then atomically swap it into service only when it passes.
3. Keep the previous graph for immediate rollback.
4. Configure `OTP_GRAPHQL_URL` only after the production health check and canary queries pass.

**Exit gate:** normal route searches have a p95 response time below 1.5 seconds; a Google fallback appears within three seconds if OTP fails.

### Phase 3 — One reliable planner pipeline (one to two weeks)

```text
Rider app → MariBus API → OTP → MariBus ranker → rider app
                         └→ Google fallback only when OTP is unavailable
```

1. Give OTP, the fallback, and the app one shared journey-result format.
2. Make OTP the only normal A-to-B decision engine; do not mix local approximations and Google results in the same recommendation without labelling them.
3. Treat live vehicle positions as map/status information until trustworthy trip updates are available; positions alone must not rewrite ETA or routing.
4. Rank OTP alternatives for fastest, less walking, fewer transfers, covered route, avoid stairs, and wheelchair-friendly.

**Exit gate:** every option clearly says whether it is scheduled, live, stale, or fallback, and its total time includes walking, waiting, transfers, and riding.

### Phase 4 — Simplify the rider experience (one to two weeks)

1. Make the opening screen map-first with one clear “Where to?” action.
2. Keep destination search as a full-screen task, then return to one clean list of journey options.
3. Present walking and transit alternatives separately; show why the recommended choice won.
4. Make route detail map-first, with a compact timeline for walk, wait, board, transfer, alight, and final walk.
5. Add regression checks for the end-to-end search and selected-route flows before each release.

**Exit gate:** a rider can search, compare, understand, and start a journey without entering the path-editor flow.

### Phase 5 — Local walking-network overlay (after OTP is trusted, two to four weeks)

1. Decide each path's status: public/permanent/verifiable paths should be contributed upstream to OpenStreetMap where appropriate; private, temporary, indoor, or uncertain paths remain a MariBus overlay.
2. Store the overlay in PostGIS with revisions, reports, and a clear access policy.
3. Feed approved overlay paths into a tested OTP graph-build workflow; they must change a real OTP itinerary, not only draw a line on the map.
4. Before public release, change broad public editing into submit/review/publish with audit history and abuse controls.

**Exit gate:** a verified shortcut demonstrably improves a controlled A-to-B OTP journey and has a rollback path if it is wrong.

### Phase 6 — App delivery: web first, native only when it adds value

| Audience | Recommended delivery | Why |
|---|---|---|
| Android now | Keep the existing Capacitor Android wrapper | It reuses the working web application and does not require a React Native rewrite. |
| iPhone now | Keep the responsive web app/PWA as the supported fallback | Riders can use it in Safari and add it to their Home Screen without MariBus shipping a native iOS app. |
| iPhone later | Add a Capacitor iOS wrapper after obtaining an Apple Developer account | It preserves one codebase and enables App Store distribution. |
| React Native | Reconsider only if a later product need requires substantially native features, such as robust background navigation, offline maps, or deep platform integrations | A rewrite now would delay the journey-planner work without improving route quality. |

There is no need to migrate to React Native now. The web application should remain the canonical product even after Android and, later, iOS wrappers exist. This gives iPhone users a usable service immediately and lets all platforms benefit from the same routing fixes.

**Exit gate:** the same production API and route results work in the browser, Android wrapper, and any later iOS wrapper.

### Phase 7 — Scale, maps, and nationwide expansion (after the above)

1. Add additional Malaysian feeds only after Klang Valley quality is consistently good.
2. Add cost dashboards, caching, alerts, and failure monitoring.
3. Evaluate MapLibre plus managed OSM vector tiles for the normal map only after its data/style quality has been measured. Keep Google Places and optional satellite imagery where they genuinely help.
4. Do not use the public `tile.openstreetmap.org` service directly for production rider traffic.

## Immediate next step

Start **Phase 0**: create the routing regression catalogue and GTFS audit report, then use them to validate the local OTP graph. Do not begin a React Native migration or change the production routing engine until that evidence exists.
