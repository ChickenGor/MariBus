# MariBus routing regression catalogue

## Purpose

This catalogue is the acceptance test for journey quality. Every routing-engine, GTFS, OSM, walking-network, or ranking change must be checked against it before release.

The initial entries live in `tests/fixtures/journey-regression.json`. They are deliberately marked `needs_field_verification` until a MariBus tester confirms the actual origin, destination, travel time, and practical route. A result from Google Maps, Moovit, Transit, or another app is useful comparison evidence, but is not itself the truth.

## How to add a verified journey

1. Choose an origin and destination a rider can identify in the real world.
2. Capture exact latitude/longitude at the entrance, lobby, station gate, or bus stop that matters. Do not use only a broad mall/place pin when an entrance changes the result.
3. Test at a stated local departure time and day type (weekday, Saturday, Sunday/holiday).
4. Record the practical expected journey: walking to the boarding stop, every vehicle, transfers, final walk, total duration, and what makes it preferable.
5. Mark it `verified` only after a field check or authoritative operator timetable check. Use `blocked` where a timetable/feed/data problem prevents a fair expected result.

## Required coverage before OTP production cutover

| Category | Minimum verified cases |
|---|---:|
| Direct bus or rail | 6 |
| One transfer | 8 |
| Two or more transfers | 6 |
| Walking should win | 5 |
| Walking shortcut/entrance matters | 5 |
| Accessibility/avoid-stairs | 3 |
| Disrupted, no-service, or late-night | 3 |
| **Total** | **36** |

## Pass criteria

- An itinerary contains the full walk → transit → transfer → final-walk sequence where applicable.
- It does not prefer a slower option without a clear rider preference that explains it.
- Boarding/alighting stops are practical, not merely the closest straight-line points.
- The returned route is scheduled for the requested service day/time.
- Estimated total duration is within the agreed tolerance after data freshness and wait-time differences are considered.
- Every failure is recorded with a reproducible request and classified as feed, OSM, OTP configuration, ranker, or UI issue.

## Running the catalogue validation

```powershell
npm run test:journey-regression
```

This first test validates catalogue quality and coverage. The next implementation step will add an OTP runner that sends every verified case to the local OTP GraphQL endpoint and records results without calling Google.
