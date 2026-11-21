# OSM station and walking audit — phase 1

## Purpose

This is a verification shortlist for MariBus's future walking and station
intelligence. It is not route data used by the app yet. Every item must be
checked in OpenStreetMap and against the real place before it is promoted to a
curated MariBus walking connection.

MariBus will continue to use Google Maps as its displayed basemap. OSM will
first improve station entrances, pedestrian connections, stop aliases and
walking instructions.

## First audit area

The first group follows locations that already occur in MariBus searches and
journey examples. It keeps the work small enough to verify properly while
covering rail, BRT, bus and interchange behaviour.

| Priority | Place / interchange | Why audit it first | Verify in OSM |
| --- | --- | --- | --- |
| 1 | LRT Pusat Bandar Puchong | Frequent boarding point in current routes | Station entrances, platform access, crossings, nearby Smart Selangor stops |
| 2 | LRT Taman Perindustrian Puchong | Frequent transfer / boarding point | Entrances, crossings, bus-bay positions, walking links |
| 3 | Bandar Puteri / Puchong corridor | High-value walk-to-rail connection | Sidewalk continuity, bridges and safe crossings |
| 4 | Sunway Pyramid and nearby stops | Large pedestrian destination | Mall entrances, BRT/bus stops, covered paths |
| 5 | Sunway Lagoon BRT | Station-to-destination guidance | Station entrances, platforms and pedestrian links |
| 6 | LRT USJ 7 | Rail / BRT interchange | Exact interchange paths, ramps and entrances |
| 7 | LRT SS15 | Dense pedestrian area | Stop aliases, crossings and footpaths |
| 8 | LRT Subang Jaya | Major rail interchange | KTM/LRT connections, entrances and platform access |
| 9 | LRT Kelana Jaya | Major rail station | Bus bays, station entrances and crossing paths |
| 10 | LRT Ara Damansara | Common route endpoint | Entrances and nearby bus-stop positions |
| 11 | MRT TRX / The Exchange TRX | Complex station-to-mall route | Mall entrances, underground/above-ground access, pedestrian connectors |
| 12 | KL Sentral | Large multi-operator interchange | Platform links, station entrances, bus bays and walking connectors |

## Capture for every place

Record the following only after checking the map and, where possible, the real
location:

- MariBus / GTFS stop name and stop ID
- OSM object URL and object ID (node, way or relation)
- Common search aliases riders use
- Entrance coordinates and entrance label, such as `Entrance B`
- Platform, bus bay or concourse information when available
- Pedestrian connection geometry: sidewalk, crossing, bridge, covered walkway
  or mall access path
- Accessibility information: lift, ramp, stairs or wheelchair access
- Confidence: `verified`, `needs field check`, or `do not use`
- Last checked date and source notes

## OSM tags to inspect

Start with these tags and their nearby connected ways:

- `public_transport=station`, `public_transport=platform`, `public_transport=stop_position`
- `railway=station`, `railway=halt`, `railway=platform`
- `highway=footway`, `highway=pedestrian`, `highway=steps`, `highway=crossing`
- `entrance=*`, `railway:platform=*`, `bus=*`, `covered=*`
- `wheelchair=*`, `incline=*`, `ramp=*`, `bridge=*`, `tunnel=*`

## Promotion rule

Do not expose a connector to riders just because it exists in OSM. Promote it
to MariBus only when it has:

1. a clear start and end point;
2. a verified relationship to the intended GTFS stop or station entrance;
3. a safe pedestrian path or an explicit warning; and
4. a useful rider-facing instruction, for example: “Use Entrance B, then walk
   4 min via the covered walkway to Sunway Pyramid.”

## Next audit output

The first implementation dataset should contain at most 10 verified
connections. Store those as curated GeoJSON/JSON, with OSM attribution and a
last-checked date. This keeps the first release correct and easy to review
before importing broader OSM data.
