# UW DOM Reader

Status: POC scaffolding added for the first batch only.

This directory now contains a **phase-1 DOM Reader POC scaffold** for:

1. `spx_greek_exposure`
2. `volatility_iv`

The current implementation boundary is:

- use a locally logged-in browser profile
- open UW pages with Playwright
- read **visible** page data only
- emit curated summary JSON only

It must **not**:

- call the UW API
- export cookies
- save account credentials
- save raw HTML
- save full member tables
- treat stale / partial / mock data as executable

## Files

- `field-utils.js`
  - helpers for numeric parsing and derived field calculation
- `greek-exposure-poc.js`
  - SPX Greek Exposure page extraction helpers and JSON builder
- `volatility-poc.js`
  - SPX / SPY / XSP volatility extraction helpers and JSON builder
- `run-uw-dom-poc.js`
  - local runner for manual logged-in browser usage

## Output files

When run locally, the POC writes only curated JSON:

- `integrations/unusual-whales/reader/output/uw_greek_exposure_dom_poc.json`
- `integrations/unusual-whales/reader/output/uw_volatility_dom_poc.json`

No raw HTML is written.
No cookie file is written.
No full member table dump is written.

## Required local setup

The local operator must provide:

- a browser executable path
- a local logged-in browser profile path

Suggested environment variables:

```bash
export UW_BROWSER_EXECUTABLE_PATH="/path/to/browser"
export UW_BROWSER_USER_DATA_DIR="/path/to/local/profile"
```

Then run:

```bash
node integrations/unusual-whales/reader/run-uw-dom-poc.js
```

## Current limitation

This is still only a POC scaffold.
It does not claim that live UW data has already been captured in this repository.
