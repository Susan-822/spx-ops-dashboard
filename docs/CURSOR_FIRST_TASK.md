# Cursor First Task

## First task policy
When starting a new task in this repository:
- Read `AGENTS.md`.
- Read `.cursor/rules/*`.
- Read `docs/*` relevant to the requested area.
- Prefer the smallest compliant change.

## Hard reminders
- Real API architecture first; mock fallback only.
- Frontend reads only `/signals/current`.
- No automatic order placement.
- No IBKR in phase 1.
- No Brave API.
- No MCP installation.
- Require `last_updated` and stale checks.
- ThetaData must be layered; no high-frequency full-chain scans.
- UW must use the Semantic Mapper; frontend must not parse HTML.
- On multi-source conflict, `recommended_action` must be `wait` or `no_trade`.
- Do not repeat explanations, expand scope, or over-engineer.
