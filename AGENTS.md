# AGENTS

## Project
- Project name: spx-ops-dashboard
- Current phase: architecture skeleton and documentation hardening
- This repository must prefer a real API architecture, but mock data may only be used as a fallback when configuration is missing or a source is stale.

## Non-negotiable rules
- Frontend may read only `/signals/current`.
- Do not implement automatic order placement.
- Do not integrate IBKR in phase 1.
- Do not integrate Brave API.
- Do not install MCP.
- Do not expand scope beyond the current requested task.
- Do not add large dependencies unless explicitly approved.

## Data safety rules
- Every normalized source payload must include `last_updated`.
- Every source read must perform a stale check before it is trusted.
- When multiple sources conflict, `recommended_action` must resolve to `wait` or `no_trade`.

## Source-specific rules
- ThetaData must be read in layers; high-frequency full-chain scanning is forbidden.
- UW must flow through a Semantic Mapper. The frontend must never parse UW HTML directly.
- Mock responses must be clearly labeled and must never replace the real architecture plan.

## Agent behavior
- Do not repeat the same explanation in multiple places.
- Do not over-engineer.
- Do not add features that were not requested.
- Do not treat documentation work as permission to change application logic.
