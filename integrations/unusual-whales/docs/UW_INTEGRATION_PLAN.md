# UW Integration Plan

## Scope

This document describes the staged plan for the Unusual Whales integration chain:

Brave Discovery
-> UW Whitelist
-> local DOM Reader
-> UW Summary Schema
-> POST /ingest/uw
-> UW Snapshot Store
-> Normalizer
-> merge into `/signals/current`
-> feed later `command_environment`

This file is a plan document only. It does **not** claim that live UW data has already been captured.

---

## Current completed work

1. Brave Discovery v1 is completed.
2. UW Discovery Review is completed.
3. UW DOM Whitelist is completed.
4. Module-name cleanup is completed.
5. The forbidden Chinese alias issue has been cleaned.
6. `integration_order` is fixed as:
   - `spx_greek_exposure`
   - `volatility_iv`
   - `options_flow_alerts`
   - `spy_darkpool_offlit`
   - `nope`
7. Raw Brave results are excluded from committed artifacts.
8. `SYSTEM_DECISION_LOGIC.md` has been restored and preserved.

---

## Current incomplete work

1. UW DOM Reader is not implemented yet.
2. UW Greek Exposure real fields have not been extracted and cleaned yet.
3. `call_charm` / `call_delta` / `call_gamma` / `call_vanna` / `put_*` have not been transformed into `dealer_snapshot`.
4. Volatility page fields are not fully confirmed yet.
5. Options Flow has not been read yet.
6. Dark Pool / Off-Lit DOM pages are not fully confirmed yet.
7. NOPE / Market Tide has not been read yet.
8. `/ingest/uw` is not wired into an existing backend route yet.
9. `uwSnapshotStore` is not attached to a production runtime yet.
10. UW data is not merged into the repository's active `/signals/current` runtime yet.
11. `command_environment` is not using UW data yet.

---

## Phase sequence

### Phase 1 - Discovery and whitelist

Status: completed

Outputs:
- `discovery/README_BRAVE_UW_DISCOVERY.md`
- `discovery/UW_DISCOVERY_REVIEW.md`
- `discovery/uw_discovery_review.json`
- `whitelist/UW_DOM_WHITELIST.md`
- `whitelist/uw_dom_whitelist.json`

Goal:
- discover public UW page patterns
- review URL quality
- freeze the initial DOM whitelist

### Phase 2 - DOM Reader design

Status: POC scaffold added, local runtime not validated against a real logged-in session in this repository

Outputs:
- `reader/README_UW_DOM_READER.md`
- `reader/field-utils.js`
- `reader/greek-exposure-poc.js`
- `reader/volatility-poc.js`
- `reader/run-uw-dom-poc.js`
- `reader/output/uw_greek_exposure_dom_poc.json`
- `reader/output/uw_volatility_dom_poc.json`

Goal:
- define how a local logged-in browser session may read visible UW page data
- preserve security boundaries
- avoid storing cookies or raw member HTML

### Phase 3 - Snapshot schemas

Status: first-pass schemas added

Outputs:
- `schemas/uw_summary.schema.json`
- `schemas/uw_dealer_snapshot.schema.json`
- `schemas/uw_volatility_snapshot.schema.json`
- `schemas/uw_flow_snapshot.schema.json`
- `schemas/uw_darkpool_snapshot.schema.json`
- `schemas/uw_sentiment_snapshot.schema.json`

Goal:
- freeze normalized snapshot formats before implementation

### Phase 4 - Ingest contract

Status: local modules added, backend route not wired

Outputs:
- `ingest/README_UW_INGEST.md`
- `ingest/ingest-contract.json`
- `ingest/json-schema.js`
- `ingest/uw-summary-schema.js`
- `ingest/uw-snapshot-store.js`
- `ingest/uw-ingest.js`

Goal:
- define what a local reader may POST into the backend later

### Phase 5 - Store and normalization

Status: local helper modules added, not connected to production runtime

Goal:
- persist UW snapshots
- normalize them into reusable fields
- keep source health and freshness attached

### Phase 6 - Signal merge

Status: helper merge module added, not connected to active runtime

Goal:
- merge normalized UW outputs into `/signals/current`
- keep the top-level `/signals/current` schema stable

### Phase 7 - command_environment use

Status: not started

Goal:
- allow later command logic to consume normalized UW context

---

## Current truth statement

At this time, the repository contains:
- discovery outputs
- review outputs
- whitelist outputs
- planning and boundary docs
- first-pass schemas
- reader POC scaffolding and example JSON outputs
- local ingest/store/normalize/merge helper modules

At this time, the repository does **not** contain:
- confirmed UW live field ingestion from a logged-in local session
- a backend route already exposed at `/ingest/uw`
- production-wired UW snapshot storage
- production-wired normalized UW signal merge

---

## Boundaries

- Do not claim live UW data exists unless the DOM Reader has actually captured and normalized it.
- Do not add Dashboard behavior before normalized UW outputs exist.
- Do not add `/signals/current` top-level schema changes in this planning phase.
- Do not add cookie handling, token storage, or raw member HTML persistence.
