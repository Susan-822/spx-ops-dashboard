# Decision Engine

## Purpose
The decision engine consumes normalized source outputs and produces a safe `recommended_action`.

## Hard rules
- No automatic order placement.
- Recommendations are advisory only in phase 1.
- If any required data is stale, the engine must degrade safely.
- If multiple sources conflict, `recommended_action` must be `wait` or `no_trade`.
- Mock fallback may keep the system running, but it must not be treated as live conviction.

## Inputs
- Normalized source records
- `last_updated`
- stale evaluation
- source conflict signals

## Output
- `recommended_action`
- explanation of stale/conflict state
- normalized status for the frontend
