# Archived Files Report

A file is treated as archived when it exists in at least one scanned git ref
but is absent from the baseline ref `origin/main`.

- Baseline ref: `origin/main`
- Scanned refs: `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea`, `origin/cursor/uw-brave-discovery-72a4`
- Excluded prefixes: `node_modules/`
- Archived file count: **126**

## Summary by top-level directory

| Directory | Files |
| --- | ---: |
| `.cursor` | 4 |
| `.env.example` | 1 |
| `.gitignore` | 1 |
| `AGENTS.md` | 1 |
| `SYSTEM_DECISION_LOGIC.md` | 1 |
| `apps` | 50 |
| `deliverables` | 14 |
| `docs` | 11 |
| `integrations` | 37 |
| `package-lock.json` | 1 |
| `package.json` | 1 |
| `packages` | 3 |
| `render.yaml` | 1 |

## Archived files

| File | Present in refs |
| --- | --- |
| `.cursor/rules/00-project-rules.mdc` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `.cursor/rules/01-agent-behavior.mdc` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `.cursor/rules/02-no-overengineering.mdc` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `.cursor/rules/03-trading-safety.mdc` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `.env.example` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `.gitignore` | `origin/cursor/uw-brave-discovery-72a4` |
| `AGENTS.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `SYSTEM_DECISION_LOGIC.md` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/fmp/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/fmp/mock.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/fmp/real.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/telegram/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/telegram/mock.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/telegram/real.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/theta/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/theta/mock.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/theta/real.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/tradingview/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/tradingview/mock.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/tradingview/real.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/uw/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/uw/mock.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/adapters/uw/real.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/alerts/build-alert-message.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/alerts/telegram-plan-alert.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/action-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/allowed-setups-engine.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/command-environment-engine.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/conflict-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/current-signal.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/data-health-engine.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/event-risk-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/gamma-wall-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/market-regime-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/market-sentiment-engine.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/master-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/mock-scenarios.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/plain-language-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/price-structure-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/trade-plan-builder.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/tv-sentinel-engine.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/uw-dealer-flow-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/decision_engine/volatility-engine.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/logs/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/normalizer/build-normalized-signal.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/routes/helpers.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/routes/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/scheduler/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/scheduler/refresh-policy.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/server.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/state/telegramAlertDedupeStore.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/state/tvSnapshotStore.js` | `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/storage/index.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/storage/tradingview-snapshot.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/api/tests/api.test.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/web/app.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/web/index.html` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `apps/web/styles.css` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/spx-ui-source.zip` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/README.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/app.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/index.html` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/breakout_pullback_pending.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/flip_conflict_wait.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/fmp_event_no_short_vol.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/negative_gamma_wait_pullback.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/positive_gamma_income_watch.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/theta_stale_no_trade.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/mock-data/scenarios/uw_call_strong_unconfirmed.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/package.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/server.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `deliverables/ui-source/styles.css` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/ACCEPTANCE_CHECKLIST.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/API_CONTRACT.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/CURSOR_FIRST_TASK.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/DATA_SOURCES.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/DECISION_ENGINE.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/PRODUCT_SPEC.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/REFRESH_AND_MONITORING.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/RUNBOOK.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/UW_READER.md` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/screenshots/dashboard-home.png` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `docs/screenshots/dashboard-radar.png` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `integrations/unusual-whales/.env.uw.example` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/README.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/discovery/README_BRAVE_UW_DISCOVERY.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/discovery/UW_DISCOVERY_REVIEW.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/discovery/uw_discovery.sh` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/discovery/uw_discovery_review.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/discovery/uw_parse.py` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/docs/SYSTEM_DECISION_LOGIC.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/docs/UW_INTEGRATION_PLAN.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/docs/UW_SECURITY_BOUNDARIES.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/ingest/README_UW_INGEST.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/ingest/ingest-contract.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/ingest/json-schema.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/ingest/uw-ingest.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/ingest/uw-snapshot-store.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/ingest/uw-summary-schema.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/normalizer/uw-summary-normalizer.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/README_UW_DOM_READER.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/field-utils.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/greek-exposure-poc.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/output/uw_greek_exposure_dom_poc.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/output/uw_volatility_dom_poc.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/run-uw-dom-poc.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/reader/volatility-poc.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/schemas/uw_darkpool_snapshot.schema.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/schemas/uw_dealer_snapshot.schema.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/schemas/uw_flow_snapshot.schema.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/schemas/uw_sentiment_snapshot.schema.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/schemas/uw_summary.schema.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/schemas/uw_volatility_snapshot.schema.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/signals/merge-uw-into-signals-current.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/tests/uw_discovery.test.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/tests/uw_reader_ingest_signals.test.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/tests/uw_schema.test.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/tests/uw_whitelist.test.js` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/whitelist/UW_DOM_WHITELIST.md` | `origin/cursor/uw-brave-discovery-72a4` |
| `integrations/unusual-whales/whitelist/uw_dom_whitelist.json` | `origin/cursor/uw-brave-discovery-72a4` |
| `package-lock.json` | `origin/cursor/project-rules-scaffold-44ea`, `origin/cursor/uw-brave-discovery-72a4` |
| `package.json` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea`, `origin/cursor/uw-brave-discovery-72a4` |
| `packages/shared/src/action-enum.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `packages/shared/src/normalized-schema.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `packages/shared/src/source-status.js` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
| `render.yaml` | `origin/cursor/fmp-risk-gate-3da9`, `origin/cursor/fmp-ui-safe-merge-3da9`, `origin/cursor/project-rules-scaffold-44ea` |
