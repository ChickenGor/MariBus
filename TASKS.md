# MariBus tasks

## Implemented locally

- Combined MariBus and Google Transit journey results into one ranked list.
- Added a compact journey preview with expandable trip details and route framing that includes both endpoints.
- Consolidated the guidance map controls and made End return to the route options.
- Aligned both providers’ result buttons and walking icons and switched MariBus journey times to 12-hour display.
- Removed route outlines from several selected-route and live bus drawing paths and guarded against late route results overwriting the selected map route.

## Pending verification

- Test the latest deployed build on a phone. Confirm route 600 displays without a red edge, rapid selection changes leave one selected route visible, and both providers’ cards match.
- Verify that both endpoint pins fit above the collapsed preview and that End returns to the same trip’s route options.

## Follow-up

- Improve MariBus walking estimates and door-to-door ranking. Use the [routing regression catalogue](docs/routing-regression-catalogue.md) for comparisons.
- Continue station-access checks using the [OpenStreetMap station audit](docs/osm-station-audit.md).
