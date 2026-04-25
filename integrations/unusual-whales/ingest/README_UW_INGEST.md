# UW Ingest

This directory now contains the local runtime modules for the planned UW ingest chain.

Current scope:

- validate a curated UW summary payload
- enforce `UW_INGEST_SECRET`
- reject raw HTML / cookie / token / member-table style payloads
- write the accepted summary into `uwSnapshotStore`
- support memory / file / redis-like adapter modes
- compute stale state without breaking later consumers

This directory still does **not**:

- expose an actual web server route
- wire into existing backend routing
- bypass login
- accept raw member-page HTML
- accept cookies or account secrets

Implemented local modules:

- `ingest-contract.json`
- `json-schema.js`
- `uw-summary-schema.js`
- `uw-snapshot-store.js`
- `uw-ingest.js`

Planned chain:

1. local DOM reader produces curated UW snapshots
2. snapshots are validated against schemas under `../schemas/`
3. curated payload is posted to `/ingest/uw`
4. UW snapshot store persists the normalized snapshot
5. normalized UW data is later merged into `/signals/current`

Security constraints:

- do not submit cookies, session data, or raw member HTML
- do not submit screenshots containing account-sensitive content
- only curated summary payloads should cross the ingest boundary
