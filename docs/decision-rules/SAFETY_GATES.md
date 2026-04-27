# Safety gates

Hard blocks:
- FMP event risk blocked.
- ThetaData dealer not executable.
- UW dealer greek conflict.
- TradingView stale.
- Mock or mixed price/dealer worlds.
- Invalid entry, stop, invalidation, or TP1.
- `stop_loss=0`.

Partial data:
- May display conclusion fields.
- Must not make `trade_plan.status=ready`.
- Must carry plain-language reason.

Projection:
- Dashboard, Radar, and Telegram read conclusion fields only.
- Raw options chains, raw Greeks, raw UW rows, HTML, cookies, tokens, and credentials never project.
