# MariBus OpenTripPlanner

This directory contains the checked-in OpenTripPlanner configuration. GTFS, OSM, and generated graph files are intentionally ignored by Git.

1. Prepare official transit and street data from the repository root:

   ```powershell
   .venv\Scripts\python.exe prepare_otp_data.py --with-osm
   ```

2. Build the graph with Docker:

   ```powershell
   docker run --rm -e JAVA_TOOL_OPTIONS=-Xmx6g -v "${PWD}/otp:/var/opentripplanner" docker.io/opentripplanner/opentripplanner:latest --build --save
   ```

3. Start OpenTripPlanner:

   ```powershell
   docker run --rm -p 8080:8080 -e JAVA_TOOL_OPTIONS=-Xmx4g -v "${PWD}/otp:/var/opentripplanner" docker.io/opentripplanner/opentripplanner:latest --load --serve
   ```

4. Start MariBus in another PowerShell window:

   ```powershell
   $env:GOOGLE_MAPS_API_KEY="your-restricted-browser-key"
   $env:OTP_GRAPHQL_URL="http://localhost:8080/otp/gtfs/v1"
   .venv\Scripts\python.exe app.py
   ```

For production, run OTP as its own memory-optimized service and point `OTP_GRAPHQL_URL` at its private GraphQL endpoint.
