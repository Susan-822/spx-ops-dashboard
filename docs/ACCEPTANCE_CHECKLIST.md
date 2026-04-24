# Acceptance Checklist

## Documentation
- [x] AGENTS and rules define project hard constraints.
- [x] Product and API docs state that real API architecture is preferred.
- [x] Docs state that mock is fallback only.

## Safety
- [x] Docs forbid automatic order placement.
- [x] Docs forbid IBKR in phase 1.
- [x] Docs forbid Brave API.
- [x] Docs forbid MCP installation.
- [x] Docs require `recommended_action` to degrade to `wait` or `no_trade` under conflict.

## Data discipline
- [x] Docs require `last_updated`.
- [x] Docs require stale checks.
- [x] Docs require ThetaData layered reads.
- [x] Docs forbid high-frequency full-chain scans.
- [x] Docs require UW Semantic Mapper.
- [x] Docs forbid frontend UW HTML parsing.

## Agent discipline
- [x] Docs require agents not to repeat explanations.
- [x] Docs require agents not to expand features.
- [x] Docs require agents not to over-engineer.
