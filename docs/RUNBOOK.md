# Runbook

## Operator expectations
- Treat the dashboard as read-only in phase 1.
- Do not expect automatic order placement.
- Do not expect broker execution connectivity.

## Source outage behavior
- If ThetaData, FMP, UW, or Telegram is unconfigured, the system should continue in fallback mode.
- Confirm that fallback payloads are marked `is_mock=true`.
- Confirm that `last_updated` and stale checks are visible in the normalized output.

## Investigation priority
1. Freshness failure
2. Source conflict
3. Adapter configuration gap
4. Mock fallback activation

## Safety reminder
If source outputs conflict, the safe result is `wait` or `no_trade`.
