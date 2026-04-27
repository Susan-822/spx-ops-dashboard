# S-Level Command Engine

Runtime flow:

Raw Source -> Normalized Snapshot -> Source Conclusion -> Command Inputs -> Data Health -> Conflict Resolver -> Confidence Score -> Command Environment -> Allowed Setups -> TV Sentinel Match -> Trade Plan -> Projection -> Dashboard / Radar / Telegram.

Hard rules:

- FMP real spot is the external spot source.
- TradingView is only a price sentinel.
- ThetaData is the dealer source; partial gamma keeps execution blocked.
- UW can confirm or conflict with dealer context, but cannot make a plan ready by itself.
- Partial, stale, unavailable, and mock data can be displayed but cannot make trade plans ready.
- Dashboard, Radar, and Telegram read conclusions only.
