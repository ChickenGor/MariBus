# MariBus project context

## Architecture

| Location | Responsibility |
| --- | --- |
| `index.html` | Main web UI, journey planning, results, and guidance |
| `static/` | Client scripts and static assets, including the Google Maps adapter |
| `app.py` | Flask app, runtime configuration, and transit API routes |
| `gtfs_agencies/`, `gtfs_static.db` | Transit feed inputs and the static timetable database |
| `otp/` | OpenTripPlanner integration resources |
| `android/`, `www/`, `capacitor.config.json` | Capacitor Android wrapper and web assets |
| `tests/` | Transit, journey regression, and browser smoke checks |

## Design decisions

- The map uses Google Maps. OpenStreetMap work has focused on auditing station access and pedestrian links. See the [station audit](docs/osm-station-audit.md).
- The planner compares MariBus timetable results with Google Transit in one list. The source still determines which details and guidance are available.
- Keep route cards compact. Surface timing, walking, route badges, transfers, and fare where available. Put step-by-step information in Trip details.
- Use route colors for selected map lines and route badges. Use a distinct location marker for the rider.
- Distinguish live vehicle observations from schedule and GPS estimates.

See the [routing regression catalogue](docs/routing-regression-catalogue.md) for journey examples and expected behavior.
