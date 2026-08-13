# Verified route geometry

Place manually verified GeoJSON route lines here. MariBus loads these files
before GTFS geometry.

File naming:

```text
route_overrides/<agency>/<route_id>-<direction_id>.geojson
```

For A34:

```text
route_overrides/mybas-ipoh/A34-0.geojson
route_overrides/mybas-ipoh/A34-1.geojson
```

Each file must contain a GeoJSON `LineString`, `Feature`, or
`FeatureCollection`. GeoJSON coordinates use `[longitude, latitude]` order.
Trace the complete route from the first station to the last station in the
same direction as the corresponding stop list.

Example:

```json
{
  "type": "Feature",
  "properties": {
    "agency": "mybas-ipoh",
    "route_id": "A34",
    "direction_id": 0,
    "verified": true
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [101.000000, 4.000000],
      [101.001000, 4.001000]
    ]
  }
}
```

Restart Flask after adding or changing an override. The route panel will show
`verified route` when MariBus successfully loads it.
