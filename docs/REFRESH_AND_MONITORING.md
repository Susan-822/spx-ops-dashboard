# Refresh And Monitoring

## Freshness rules
- Every source record must include `last_updated`.
- Every read path must check whether the record is stale.
- Stale data must not be silently treated as fresh.

## Monitoring rules
- Fallback activation must be visible.
- Mock responses must remain clearly marked.
- Refresh design should be selective and conservative.

## ThetaData refresh rule
- ThetaData must be read in layers.
- High-frequency full-chain scanning is forbidden.

## Safe degradation
- If a source is stale, unavailable, or conflicting, the system must degrade to `wait` or `no_trade`.
