# UW DOM Whitelist

## Scope

This whitelist is generated only from:

- `UW_DISCOVERY_REVIEW.md`
- `uw_discovery_review.json`

This step does **not**:

- rerun Brave discovery
- use the UW API
- read member-only UW data
- read cookies
- run Playwright
- change Dashboard
- change backend
- change UI

All module names are kept exactly as:

- `spx_greek_exposure`
- `spy_darkpool_offlit`
- `options_flow_alerts`
- `nope`
- `volatility_iv`

No Chinese module alias is used. In particular, `nope` remains `nope`.

---

## Final Integration Order

1. `spx_greek_exposure`
   - Greek Exposure is the main Gamma / Dealer map.
2. `volatility_iv`
   - Volatility is used for iron condor / short vol permission.
3. `options_flow_alerts`
   - Flow is the active money / directional thrust layer.
4. `spy_darkpool_offlit`
   - Dark Pool still needs manual logged-in page confirmation.
5. `nope`
   - NOPE is only an overheat / divergence assist layer.

---

## A. approved_for_dom_poc

Only the first DOM POC batch is allowed here:

### module: `spx_greek_exposure`

Required visible fields for first DOM POC:

- GEX
- DEX
- Vanna
- Charm
- Gamma by strike
- Expiry breakdown
- zero gamma / flip
- last update

#### 1) `https://unusualwhales.com/stock/SPX/greek-exposure`

- `module`: `spx_greek_exposure`
- `page_type`: `data_page`
- `confidence`: `0.9`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `approved_for_dom_poc`
- `reason`: SPX Greek Exposure 主页面是当前最明确、最稳定、最贴近 Gamma / Dealer 地图目标的数据页。
- `required_visible_fields`: `GEX, DEX, Vanna, Charm, Gamma by strike, Expiry breakdown, zero gamma / flip, last update`
- `next_action`: 登录 UW 后先确认主页面的 summary 区和 strike / expiry 结构稳定可见。

#### 2) `https://unusualwhales.com/stock/SPX/greek-exposure?tab=Gamma`

- `module`: `spx_greek_exposure`
- `page_type`: `data_page`
- `confidence`: `0.9`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `approved_for_dom_poc`
- `reason`: Gamma tab 能更直接聚焦 GEX 和 gamma by strike，是首批 DOM POC 的高价值子视图。
- `required_visible_fields`: `GEX, Gamma by strike, zero gamma / flip, last update`
- `next_action`: 登录后确认 tab 切换能保留稳定 DOM，避免 selector 因前端 tab 状态变化而失效。

#### 3) `https://unusualwhales.com/stock/SPX/greek-exposure?type=exposure&greek=gamma`

- `module`: `spx_greek_exposure`
- `page_type`: `data_page`
- `confidence`: `0.9`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `approved_for_dom_poc`
- `reason`: 参数化 gamma 视图最适合做固定入口的 DOM POC 备用页。
- `required_visible_fields`: `GEX, Gamma by strike, Expiry breakdown, zero gamma / flip, last update`
- `next_action`: 登录后确认 query 视图可直达目标模块，并确认其与主页面复用同一 DOM 结构。

---

## B. needs_manual_login_confirmation

These URLs are worth keeping, but must be manually confirmed in a logged-in UW browser before any DOM Reader work.

### module: `volatility_iv`

Required visible fields:

- IV Rank
- IV Percentile
- Implied Volatility
- Realized Volatility
- Term Structure
- Volatility Statistics

#### 1) `https://unusualwhales.com/stock/SPX/volatility`

- `module`: `volatility_iv`
- `page_type`: `data_page`
- `confidence`: `0.87`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `needs_manual_login_confirmation`
- `reason`: SPX volatility 页面质量高，但 `Term Structure` 的同页可见性还需要登录态确认。
- `required_visible_fields`: `IV Rank, IV Percentile, Implied Volatility, Realized Volatility, Term Structure, Volatility Statistics`
- `next_action`: 登录后确认 SPX volatility 页面上同时存在 term structure 与 volatility statistics 分区。

#### 2) `https://unusualwhales.com/stock/XSP/volatility`

- `module`: `volatility_iv`
- `page_type`: `data_page`
- `confidence`: `0.87`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `needs_manual_login_confirmation`
- `reason`: XSP 可作为 SPX 的备用波动率入口，但字段覆盖仍需在登录页逐项核实。
- `required_visible_fields`: `IV Rank, IV Percentile, Implied Volatility, Realized Volatility, Term Structure, Volatility Statistics`
- `next_action`: 登录后检查 XSP 页面与 SPX volatility 共享同类布局与字段分区。

#### 3) `https://unusualwhales.com/stock/SPY/volatility`

- `module`: `volatility_iv`
- `page_type`: `data_page`
- `confidence`: `0.87`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `needs_manual_login_confirmation`
- `reason`: SPY volatility 适合做对照页，但还未最终确认 term structure 和统计区块在公开路径下的可见性。
- `required_visible_fields`: `IV Rank, IV Percentile, Implied Volatility, Realized Volatility, Term Structure, Volatility Statistics`
- `next_action`: 登录后确认 SPY volatility 可作为 SPX volatility 的 DOM 对照模板。

### module: `options_flow_alerts`

Required visible fields:

- premium
- ask side / bid side
- volume
- open interest
- IV
- repeated hits / sweep / floor / multileg labels

#### 4) `https://unusualwhales.com/flow/overview`

- `module`: `options_flow_alerts`
- `page_type`: `data_page`
- `confidence`: `0.66`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `true`
- `status`: `needs_manual_login_confirmation`
- `reason`: 这是最接近市场级 Flow 总览页的候选，但仍需登录后确认其能稳定聚焦 SPX / SPY / QQQ。
- `required_visible_fields`: `premium, ask side, bid side, volume, open interest, IV, repeated hits / sweep / floor / multileg`
- `next_action`: 登录后先确认 flow/overview 是市场级 flow 主入口，并检查目标列默认可见。

### module: `spy_darkpool_offlit`

Required visible fields:

- dark pool price levels
- support / resistance
- off-lit ratio
- recent large prints
- last update

#### 5) `https://unusualwhales.com/dark-pool-flow`

- `module`: `spy_darkpool_offlit`
- `page_type`: `data_page`
- `confidence`: `0.58`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `unknown`
- `status`: `needs_manual_login_confirmation`
- `reason`: 名称最接近真实暗池流页面，但目前仍未确认其提供 SPY 专属 dark pool / off-lit 数据区。
- `required_visible_fields`: `dark pool price levels, support / resistance, off-lit ratio, recent large prints, last update`
- `next_action`: 登录后人工确认 dark-pool-flow 可切换到 SPY，并暴露价位层与 off-lit 结构。

### module: `nope`

Required visible fields:

- NOPE
- Net Options Pricing Effect
- call delta
- put delta
- stock volume
- divergence / overheat

#### 6) `https://unusualwhales.com/stock/SPX/nope`

- `module`: `nope`
- `page_type`: `data_page`
- `confidence`: `0.65`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `unknown`
- `status`: `needs_manual_login_confirmation`
- `reason`: SPX NOPE 页面路径成立，但核心字段齐全度只能在登录后人工确认。
- `required_visible_fields`: `NOPE, Net Options Pricing Effect, call delta, put delta, stock volume, divergence / overheat`
- `next_action`: 登录后先验证 SPX/nope 页面存在数值型 NOPE、call delta、put delta 与 stock volume 区块。

#### 7) `https://unusualwhales.com/stock/SPY/nope`

- `module`: `nope`
- `page_type`: `data_page`
- `confidence`: `0.65`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `unknown`
- `status`: `needs_manual_login_confirmation`
- `reason`: SPY NOPE 可作为 SPX 的对照页，但字段完整性仍未确认。
- `required_visible_fields`: `NOPE, Net Options Pricing Effect, call delta, put delta, stock volume, divergence / overheat`
- `next_action`: 登录后确认 SPY/nope 页面与 SPX/nope 共用同类结构和字段面板。

---

## C. rejected

These URLs are explicitly rejected.

### rejected patterns

- `https://api.unusualwhales.com/docs/*`
- `https://unusualwhales.com/lp/*`
- `https://unusualwhales.com/news/nope-a-primer`
- random ticker NOPE pages such as `PAY / PRI / PERF / COO`
- single-stock historical `options-flow-history` pages such as `API / USEG / MSFT / OPRA / AMZN`

### rejected URLs

#### 1) `https://api.unusualwhales.com/docs/operations/PublicApi.DarkpoolController.darkpool_recent`

- `module`: `spy_darkpool_offlit`
- `page_type`: `api_docs`
- `confidence`: `0.6`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: API docs 明确不走 DOM Reader，而且本任务禁止调用 UW API。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 2) `https://unusualwhales.com/lp/dark-pool-scanner`

- `module`: `spy_darkpool_offlit`
- `page_type`: `landing_page`
- `confidence`: `0.59`
- `login_required`: `false`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: landing page 不是数据页，不应进入 DOM 白名单。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 3) `https://unusualwhales.com/lp/real-time-dark-pool-feed-access`

- `module`: `spy_darkpool_offlit`
- `page_type`: `landing_page`
- `confidence`: `0.54`
- `login_required`: `false`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: marketing 页面不是数据采集目标页。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 4) `https://unusualwhales.com/news/nope-a-primer`

- `module`: `nope`
- `page_type`: `docs`
- `confidence`: `0.68`
- `login_required`: `false`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: news article 只适合概念说明，不是数据页。
- `required_visible_fields`: `[]`
- `next_action`: 保留为背景说明，不进 DOM 白名单。

#### 5) `https://unusualwhales.com/stock/PAY/nope`

- `module`: `nope`
- `page_type`: `data_page`
- `confidence`: `0.64`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 随机 ticker NOPE 页面不属于 SPX/SPY 工作流。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 6) `https://unusualwhales.com/stock/PRI/nope`

- `module`: `nope`
- `page_type`: `data_page`
- `confidence`: `0.64`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 随机 ticker NOPE 页面不属于 SPX/SPY 工作流。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 7) `https://unusualwhales.com/stock/PERF/nope`

- `module`: `nope`
- `page_type`: `data_page`
- `confidence`: `0.64`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 随机 ticker NOPE 页面不属于 SPX/SPY 工作流。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 8) `https://unusualwhales.com/stock/COO/nope`

- `module`: `nope`
- `page_type`: `data_page`
- `confidence`: `0.64`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 随机 ticker NOPE 页面不属于 SPX/SPY 工作流。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 9) `https://unusualwhales.com/stock/API/options-flow-history`

- `module`: `options_flow_alerts`
- `page_type`: `data_page`
- `confidence`: `0.66`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 单股票历史页不是市场级 Flow 入口。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 10) `https://unusualwhales.com/stock/USEG/options-flow-history`

- `module`: `options_flow_alerts`
- `page_type`: `data_page`
- `confidence`: `0.66`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 单股票历史页不是市场级 Flow 入口。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 11) `https://unusualwhales.com/stock/MSFT/options-flow-history`

- `module`: `options_flow_alerts`
- `page_type`: `data_page`
- `confidence`: `0.66`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 单股票历史页不是市场级 Flow 入口。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 12) `https://unusualwhales.com/stock/OPRA/options-flow-history`

- `module`: `options_flow_alerts`
- `page_type`: `data_page`
- `confidence`: `0.66`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 单股票历史页不是市场级 Flow 入口。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

#### 13) `https://unusualwhales.com/stock/AMZN/options-flow-history`

- `module`: `options_flow_alerts`
- `page_type`: `data_page`
- `confidence`: `0.66`
- `login_required`: `unknown`
- `usable_for_dom_reader`: `false`
- `status`: `rejected`
- `reason`: 单股票历史页不是市场级 Flow 入口。
- `required_visible_fields`: `[]`
- `next_action`: 不使用，直接排除。

---

## Raw File Submission Recommendation

Current branch diff still includes:

- `uw_raw_results/raw_*.json`

Recommendation:

- raw discovery files should **not** stay in the main business directory
- add `.gitignore` entry:

```gitignore
uw_raw_results/
```

- for long-term repo history, prefer committing only:
  - review outputs
  - whitelist outputs
  - any final curated manifests

In other words: `uw_raw_results/` does **not** need to be submitted as part of the final curated DOM whitelist deliverable.
