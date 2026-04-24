# Product Spec

## Goal
spx-ops-dashboard is a read-oriented operations dashboard for SPX-related monitoring. The phase 1 goal is to present a safe, normalized view of source state and recommended posture without any order execution.

## Product boundaries
- Real API architecture is the target design.
- Mock data may exist only as a fallback when a source is unavailable, stale, or unconfigured.
- Frontend reads only `/signals/current`.
- The product must not auto-trade.
- IBKR is out of scope for phase 1.
- Brave API is out of scope.
- MCP must not be installed as part of this project.

## Core output
The primary frontend payload is a normalized JSON signal that includes freshness metadata, source health, source conflicts, and a safe recommendation.

## Safety expectations
- Every source must expose `last_updated`.
- Every source must be checked for staleness before use.
- When source outputs conflict, `recommended_action` must be `wait` or `no_trade`.
