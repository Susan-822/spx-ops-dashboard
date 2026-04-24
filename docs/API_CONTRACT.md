# API Contract

## Primary frontend contract
- The frontend may read only `GET /signals/current` for core intraday decision rendering.
- The frontend must not rely on raw source payloads for decision logic.
- The frontend must never parse raw UW HTML.

## Required `/signals/current` payload
The dashboard-driving payload must expose:
- `schema_version`
- `is_mock`
- `fetch_mode`
- `symbol`
- `data_timestamp`
- `received_at`
- `last_updated`
- `latency_ms`
- `source_status`
- `stale_flags`
- `stale_reason`
- `market_state`
- `gamma_regime`
- `market_snapshot`
- `signals`
- `weights`
- `conflict`
- `plain_language`
- `recommended_action`
- `avoid_actions`
- `invalidation_level`
- `confidence_score`
- `strategy_cards`

## Source status expectations
Each source status item should expose:
- `source`
- `state` (`real` / `mock` / `delayed` / `degraded` / `down`)
- `fetch_mode`
- `last_updated`
- `data_timestamp`
- `received_at`
- `latency_ms`
- `stale_reason`
- availability and mock labeling

## Conflict contract
- `conflict_points` must be an array of human-readable reasons.
- High conflict must degrade the action to `wait`.

## Plain-language contract
`plain_language` must contain:
- `market_status`
- `dealer_behavior`
- `user_action`
- `avoid`
- `invalidation`

These values must be human-readable intraday guidance, not raw enum strings.

## Safety contract
- Real API architecture is preferred.
- Mock is fallback only.
- Stale, conflicting, or degraded inputs must reduce confidence.
- Automatic order placement is forbidden.
