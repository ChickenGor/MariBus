# MariBus

MariBus is a Klang Valley public transport planner with journey options, map guidance, and live bus tracking where data is available.

## Run locally

From the repository root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
$env:GOOGLE_MAPS_API_KEY = 'your-development-key'
.\.venv\Scripts\python.exe app.py
```

Open [localhost:5000](http://localhost:5000). See `.env.example` for optional integrations and set the relevant variables in your shell before launching Flask.

## Project checks

- `npm run test:transit` checks transit utilities.
- `npm run test:journey-regression` checks journey regressions.
- `npm run test:smoke` runs Playwright against the deployed site by default. Set `PLAYWRIGHT_TEST_BASE_URL` to point it at a different environment, such as your running local server.

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the code map and [TASKS.md](TASKS.md) for completed work and open checks.
