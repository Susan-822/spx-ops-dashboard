# SPX 0DTE UI Source Package

This package contains only the frontend UI code for the two-page dashboard:
- `/` main trading command page
- `/radar` support radar page

It includes a lightweight local mock server and scenario JSON files so the UI can run without the main backend.

## Run

```bash
npm install
npm run dev
```

Then open:
- http://localhost:3000/
- http://localhost:3000/radar

## Notes
- No real API integrations
- No auto-order placement
- Mock data is loaded from `mock-data/scenarios/*.json`
