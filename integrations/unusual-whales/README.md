# Unusual Whales Integration Workspace

This directory contains all Unusual Whales integration artifacts for SPX Ops Lab.

## Structure

- `discovery/`
  - Brave discovery scripts
  - discovery review markdown/json
- `whitelist/`
  - final DOM whitelist markdown/json
- `schemas/`
  - reserved for future UW payload schemas
- `reader/`
  - reserved for future DOM reader code
- `ingest/`
  - reserved for future ingest payload builders or adapters
- `tests/`
  - reserved for future UW-specific tests
- `docs/`
  - decision logic and supporting UW docs

## Current scope

This PR only reorganizes files and fixes paths.

It does **not**:

- add DOM reader code
- add UW API integration
- add cookies, secrets, or tokens
- change Dashboard
- change TradingView
- change `/signals/current`

## Current entry points

Brave discovery files live under:

- `integrations/unusual-whales/discovery/README_BRAVE_UW_DISCOVERY.md`
- `integrations/unusual-whales/discovery/uw_discovery.sh`
- `integrations/unusual-whales/discovery/uw_parse.py`

Whitelist files live under:

- `integrations/unusual-whales/whitelist/UW_DOM_WHITELIST.md`
- `integrations/unusual-whales/whitelist/uw_dom_whitelist.json`

Decision logic doc lives under:

- `integrations/unusual-whales/docs/SYSTEM_DECISION_LOGIC.md`
