# UW Ingest Placeholder

This directory is reserved for the future `/ingest/uw` contract implementation.

Current status:

- ingest is not implemented
- no runtime code is added in this phase
- no API wiring is added in this phase

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
