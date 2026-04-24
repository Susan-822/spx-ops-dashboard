# Data Sources

## General rules
- Real adapters are the preferred path.
- Mock data is allowed only as fallback.
- Every source must emit `last_updated`.
- Every source must be checked for stale data before use.

## ThetaData
- ThetaData must be read in layers.
- High-frequency full-chain scanning is forbidden.
- The adapter should request only the slices required for the current decision step.

## FMP
- FMP may be used as a secondary reference source.
- Missing configuration must not crash the system.
- Fallback responses must be marked `is_mock=true`.

## TradingView
- TradingView is an input signal source only.
- It must not be treated as an execution trigger.

## UW
- UW must pass through a Semantic Mapper.
- Frontend must never parse UW HTML directly.
- Missing configuration must not crash the system.

## Telegram
- Telegram is notification-only.
- It must not trigger order execution.
