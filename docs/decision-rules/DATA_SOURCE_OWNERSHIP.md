# Data Source Ownership

Frontend reads only `/signals/current`.

- FMP: SPX spot, market risk, event risk, external spot.
- ThetaData: dealer map, expected move, OI fallback walls, max pain.
- UW: flow, dark pool, market tide, Greek exposure cross-check.
- TradingView: price structure sentinel only.

Raw chains, raw greeks, raw UW data, HTML, tokens, cookies, and credentials
must not be projected to Dashboard, Radar, or Telegram.
