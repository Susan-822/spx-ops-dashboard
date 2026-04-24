# API Contract

## Primary frontend contract
- The frontend may read only `GET /signals/current`.
- The frontend must not rely on any other endpoint for core rendering.
- The frontend must never parse raw UW HTML.

## Required payload expectations
`/signals/current` should provide a normalized payload with at least:
- `last_updated` per source entry
- staleness evaluation per source or equivalent stale decision path
- `recommended_action`
- source status metadata
- explicit mock labeling when fallback is active

## Safety contract
- Real API architecture is preferred.
- Mock payloads are fallback only.
- If source freshness fails or sources conflict, `recommended_action` must be `wait` or `no_trade`.
- Automatic order placement is forbidden.
