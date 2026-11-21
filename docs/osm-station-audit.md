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

## Initial OSM lookup results — 22 November 2026

These are **map-data observations**, not field verification. They must not yet
be displayed as MariBus navigation instructions.

| Place | OSM object | Useful tags found | Audit status / implication |
| --- | --- | --- | --- |
| LRT Pusat Bandar Puchong | [node 7968399666](https://www.openstreetmap.org/node/7968399666) | `public_transport=platform`, `highway=bus_stop`, `ref=SJ735`, `covered=yes`, `shelter=yes`, `tactile_paving=yes`, `wheelchair=yes` | Strong candidate. Match `SJ735` to the MariBus GTFS stop, then verify which station entrance/platform it serves. |
| LRT Perindustrian Puchong | [node 9555752505](https://www.openstreetmap.org/node/9555752505) | `public_transport=platform`, `highway=bus_stop`, `ref=SJ749`, `operator=Rapid Bus`, `shelter=yes`, `tactile_paving=yes`, `wheelchair=yes` | Strong candidate. Confirm GTFS match and walking link to the rail entrance. |
| Sunway Metro/BRT Sunway Lagoon | [node 11862350523](https://www.openstreetmap.org/node/11862350523) | `public_transport=platform`, `highway=bus_stop`, `ref=SJ12`, `route_ref=SJ02`, `departures_board=realtime` | Candidate. OSM currently describes a Smart Selangor/Rapid Bus platform; do not assume it represents the BRT platform without a field check. |
| LRT USJ 7 | [node 4345465572](https://www.openstreetmap.org/node/4345465572) | Name and coordinates found through OSM search; detailed tag fetch needs retry | Candidate pending tag inspection. High priority because rail/BRT interchange walking is valuable. |
| MRT TRX / The Exchange TRX | [way 1226407685](https://www.openstreetmap.org/way/1226407685) | `highway=pedestrian`, `place=square`, named `MRT Plaza (TRX Link)` | Do **not** use as the station. This is a pedestrian plaza/link and proves the station, entrances and mall connector must be mapped as separate objects. |

Source: © OpenStreetMap contributors, available under the Open Database
License (ODbL). The IDs above are saved only for audit and matching purposes;
they are not yet used by the MariBus application.

## GTFS matching pass — draft only

The local MariBus GTFS database was compared with the first three OSM
candidates by name, stop reference and coordinate distance. A close coordinate
match confirms that the records probably describe the same **boarding point**;
it does not confirm the correct station entrance or pedestrian route.

| Candidate | MariBus GTFS record | OSM distance | Result | Next verification |
| --- | --- | --- | --- | --- |
| `SJ735` | `rapid-bus-kl / 1006286 / SJ735 LRT PUSAT BANDAR PUCHONG` | 14.2 m | Strong bus-platform match | Identify the pedestrian route from this platform to rail stop `rapid-rail-kl / SP25 / PUSAT BANDAR PUCHONG`, then field-check the entrance. |
| `SJ749` | `rapid-bus-kl / 1006311 / SJ749 LRT PERINDUSTRIAN PUCHONG` | 8.3 m | Strong bus-platform match | Identify the pedestrian route from this platform to rail stop `rapid-rail-kl / SP26 / TAMAN PERINDUSTRIAN PUCHONG`, then field-check the entrance. |
| `SJ12` / Sunway Lagoon candidate | MariBus has `rapid-bus-kl / 1005838 / STESEN BRT SUNWAY LAGOON` and `rapid-rail-kl / BRT3 / SUNWAY LAGOON` | 83.4 m to the first OSM candidate | Not safe to match automatically | Find the actual BRT platform object and the mall/station pedestrian connector before adding anything. |

### Draft promotion decision

No walking connection is promoted yet. The two Puchong records may become the
first curated connections after their station entrance and pedestrian geometry
are checked. Sunway Lagoon remains an audit target, not an app data source.

## Pedestrian geometry pass — draft only

### Pusat Bandar Puchong / `SJ735`

- OSM maps the rail station as [SP25 Pusat Bandar Puchong](https://www.openstreetmap.org/way/407156819)
  with `wheelchair=yes` and maps the nearby rail platforms separately.
- The surrounding area contains several mapped covered footways and bridges,
  including [way 263459944](https://www.openstreetmap.org/way/263459944) and
  [way 1131261081](https://www.openstreetmap.org/way/1131261081).
- No separately tagged station entrance was found in the audit area.

**Decision:** do not draft rider-facing entrance guidance yet. MariBus may
later use this as a generic “walk to the station concourse” connection only
after a field check identifies the correct entrance.

### Perindustrian Puchong / `SJ749`

- OSM maps the station as [SP26 Taman Perindustrian Puchong](https://www.openstreetmap.org/way/407156821)
  with `wheelchair=yes`.
- The `SJ749` platform candidate is [node 9555752505](https://www.openstreetmap.org/node/9555752505).
- [Entrance A](https://www.openstreetmap.org/node/9924537172) is a mapped
  `railway=subway_entrance` **7.5 m** from the `SJ749` platform candidate.
- Nearby pedestrian ways include covered, wheelchair-tagged footways, such as
  [way 994895104](https://www.openstreetmap.org/way/994895104) and
  [way 1527770928](https://www.openstreetmap.org/way/1527770928).
- Entrance B is about 102 m from that platform candidate, so it is not the
  default recommendation.

**Draft connection (not yet in the app):**

> From SJ749 LRT Perindustrian Puchong, use Entrance A to reach the LRT
> station. Confirm the signed pedestrian path and accessibility on site before
> displaying this instruction to riders.

## Field-check checklist for the first connection

Before promotion, confirm all of the following in person:

1. `SJ749` is the correct boarding/alighting platform for the selected bus
   direction.
2. Entrance A is publicly accessible from that platform.
3. The connecting path is continuous, safe and open during service hours.
4. The route does not require stairs when claiming an accessible connection.
5. The station signage actually identifies the entrance as `A`.

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
