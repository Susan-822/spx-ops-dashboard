# UW Reader

## Purpose
UW Reader is responsible for reading the user's already-visible UW page and converting it into structured semantic output for the engine chain.

## Priority order
1. DOM automatic read
2. Automatic screenshot + AI vision fallback
3. Manual screenshot upload as backup

## Hard rules
- Do not store account passwords.
- Do not bypass login, paywalls, or verification.
- Read only the page the user is already logged into and can already see.
- DOM is first priority. If DOM data cannot be extracted reliably, fall back to screenshot.
- Both DOM output and screenshot output must go through the Semantic Mapper.
- The frontend must never parse UW HTML directly.
- Raw DOM and raw HTML are backend-only concerns.
- If UW becomes stale, it must not dominate the trading conclusion.

## Output expectations
UW Reader should emit semantic fields only, such as:
- `uw_flow_bias`
- `uw_dark_pool_bias`
- `uw_dealer_bias`
- semantic advanced greeks meaning
- `last_updated`
- freshness / stale state
- source reliability notes

## Freshness behavior
- DOM read is the preferred fresh path.
- Screenshot fallback is acceptable when DOM is unavailable, but should be marked degraded.
- Manual screenshot upload is emergency backup only.
- If UW is stale or only weakly readable, the master engine must reduce confidence and avoid letting UW drive the final action.
