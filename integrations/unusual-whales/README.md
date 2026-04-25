# Unusual Whales Integration Workspace

This directory owns the complete staged Unusual Whales integration chain for SPX Ops Lab:

Brave Discovery
-> UW Whitelist
-> local DOM Reader
-> UW Summary Schema
-> POST /ingest/uw
-> UW Snapshot Store
-> Normalizer
-> merge into `/signals/current`
-> later consumed by `command_environment`

This chain must be implemented in phases.  
This workspace is the single place where all UW-related artifacts should live.

## Directory structure

- `discovery/`
  - Brave discovery scripts
  - discovery review markdown/json
- `whitelist/`
  - final DOM whitelist markdown/json
- `schemas/`
  - UW summary and snapshot schemas
- `reader/`
  - DOM reader documentation only for now
- `ingest/`
  - ingest contract and runtime helpers
- `normalizer/`
  - UW summary validation and normalization helpers
- `tests/`
  - UW-specific validation and runtime tests
- `docs/`
  - decision logic, integration plan, and security boundaries

## Current scope

This PR now covers the first maintainable UW integration layers inside the UW workspace:

- discovery artifacts
- review and whitelist artifacts
- Reader POC scaffolding for `spx_greek_exposure` and `volatility_iv`
- summary/snapshot schemas
- local ingest contract and snapshot-store modules
- UW-to-signals merge helper modules
- UW-specific tests

It still does **not**:

- add UW API integration
- add cookies, secrets, or tokens
- add raw member-page HTML
- change Dashboard UI
- change TradingView
- change FMP
- change `/signals/current` top-level schema
- wire the new UW modules into an existing production backend route automatically

## Current entry points

Discovery phase files live under:

- `integrations/unusual-whales/discovery/README_BRAVE_UW_DISCOVERY.md`
- `integrations/unusual-whales/discovery/uw_discovery.sh`
- `integrations/unusual-whales/discovery/uw_parse.py`
- `integrations/unusual-whales/discovery/UW_DISCOVERY_REVIEW.md`
- `integrations/unusual-whales/discovery/uw_discovery_review.json`

Whitelist phase files live under:

- `integrations/unusual-whales/whitelist/UW_DOM_WHITELIST.md`
- `integrations/unusual-whales/whitelist/uw_dom_whitelist.json`

Decision and planning docs live under:

- `integrations/unusual-whales/docs/SYSTEM_DECISION_LOGIC.md`
- `integrations/unusual-whales/docs/UW_INTEGRATION_PLAN.md`
- `integrations/unusual-whales/docs/UW_SECURITY_BOUNDARIES.md`

Reader and ingest runtime live under:

- `integrations/unusual-whales/reader/`
- `integrations/unusual-whales/ingest/`
- `integrations/unusual-whales/normalizer/`

## Current status

### 已完成

1. Brave Discovery 第一版。
2. UW Discovery Review。
3. UW DOM Whitelist。
4. module 名称清理。
5. “否” 已清除。
6. `integration_order` 已固定：
   - `spx_greek_exposure`
   - `volatility_iv`
   - `options_flow_alerts`
   - `spy_darkpool_offlit`
   - `nope`
7. raw Brave 结果已排除。
8. `SYSTEM_DECISION_LOGIC.md` 已恢复。
9. 第一批 Reader POC scaffold 已建立：
   - `spx_greek_exposure`
   - `volatility_iv`
10. UW Summary / snapshot schema 已建立。
11. `/ingest/uw` contract 与本地校验模块已建立。
12. `uwSnapshotStore` memory/file/redis adapter 接口已建立。
13. UW merge helper 已建立，用于后续合并进 `/signals/current`。
14. UW 测试集已建立，可验证 discovery / whitelist / reader safety / ingest / stale / merge 规则。

### 当前未完成

1. UW DOM Reader 仍处于 POC 阶段，尚未覆盖完整 UW 模块。
2. UW Greek Exposure 真实字段尚未在本仓库内由真实登录浏览器抓取并清洗。
3. `call_charm` / `call_delta` / `call_gamma` / `call_vanna` / `put_*` 尚未形成 `dealer_snapshot`。
4. Volatility 页面字段尚未由真实登录浏览器确认。
5. Options Flow 尚未读取。
6. Dark Pool / Off-Lit DOM 页面尚未确认。
7. NOPE / Market Tide 尚未读取。
8. `/ingest/uw` 尚未接入现有后端服务。
9. `uwSnapshotStore` 尚未接入现有生产存储。
10. UW 尚未合并进仓库现有 `/signals/current` 运行链路。
11. `command_environment` 尚未使用 UW 数据。

## Important boundary

Do **not** claim that the system already has live UW data.  
At this stage, the workspace contains discovery / review / whitelist outputs plus local POC and contract modules, but it does not prove that real-time UW fields have been captured from a logged-in browser in this repository.
