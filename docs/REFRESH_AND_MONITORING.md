# Refresh And Monitoring

## System principle
The system must combine timed refresh, event-triggered refresh, and stale/down evaluation. Every source must publish enough timing metadata for the frontend and master engine to judge whether it is still trustworthy.

## Source status model
Each source should resolve into one of these states:
- `real`
- `mock`
- `delayed`
- `degraded`
- `down`

## Refresh matrix
| Source | Fetch mode | Default refresh | Event triggers | stale_threshold | down_threshold |
|---|---|---:|---|---:|---:|
| ThetaData | layered_poll | 15s | near flip / near wall / action candidate | 45s | 3m |
| TradingView | webhook_event | passive + 30s light freshness check | breakout / breakdown / pullback / invalidation webhook | 3m | 10m |
| FMP | low_frequency_poll | 5m | macro window / earnings window / risk gate escalation | 15m | 60m |
| UW DOM | dom_read | 60-180s | manual refresh / user focus / flow quality change | 5m | 15m |
| UW screenshot | vision_fallback | 10-15m | DOM unavailable / manual refresh / vision recheck | 20m | 45m |
| Telegram | event_push | event-driven | action change / stale alert / conflict alert | 15m | 60m |
| Dashboard | light_poll | 15s | visibility change / scenario change / manual refresh | 60s | 3m |

## Practical rules
- ThetaData must be read in layers, not by high-frequency full-chain scan.
- TradingView should primarily enter through webhook events.
- FMP should be low-frequency, but event windows should tighten checks.
- UW DOM is the first-priority read path.
- UW screenshot is fallback and should be marked degraded.
- Telegram is event-triggered only; it should not poll aggressively.
- Dashboard should refresh lightly and display stale/degraded/down states clearly.

## Frontend expectations
The frontend should:
- gray out stale or delayed modules
- surface conflict at the top
- surface no-trade and stale reasons clearly
- show source states in the bottom status strip
- never pretend mock data is real
