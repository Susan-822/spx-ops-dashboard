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
| Dashboard `/signals/current` | `light_poll` | 5s | visibility change / scenario change / manual refresh | 15s | 60s |
| TradingView | `webhook_event` | no polling | breakout / breakdown / pullback / invalidation webhook | event-driven freshness | 15m |
| ThetaData core summary | `layered_poll` | 30s | near flip / near wall / manual refresh | 30s | 5m |
| ThetaData full chain | `layered_scan` | 2-5m (current default 3m) | home needs recalc / manual refresh | 5m | 15m |
| FMP event/news | `low_frequency_poll` | 60-300s (current default 120s) | macro window / earnings window / risk gate escalation | 10m | 30m |
| UW DOM | `dom_read` | 60-180s (current default 120s) | TV key event / manual refresh / user focus | 5m | 10m |
| UW screenshot | `vision_fallback` | 10-15m (current default 12m) | DOM unavailable / TV key event / manual refresh | 15m | 30m |
| Scheduler / Health | `health_poll` | 30s | fixed check | 60s | 3m |
| Telegram | `event_push` | no fixed polling | action change / stale alert / conflict alert / high-risk alert | event-driven freshness | 30m |

## Practical rules
- ThetaData must be read in layers, not by high-frequency full-chain scan.
- TradingView should primarily enter through webhook events.
- FMP should be low-frequency, but event windows should tighten checks.
- UW DOM is the first-priority read path.
- UW screenshot is fallback and should be marked degraded when it replaces DOM.
- Telegram is event-triggered only; it should not poll aggressively.
- Dashboard should refresh lightly and display stale/degraded/down states clearly.

## Frontend expectations
The frontend should:
- gray out stale or delayed modules
- surface conflict at the top
- surface no-trade and stale reasons clearly
- show source states in the bottom status strip
- never pretend mock data is real
