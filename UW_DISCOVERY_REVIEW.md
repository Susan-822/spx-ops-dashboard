# UW Discovery URL Quality Review

## Scope

This review only checks public URL quality based on:

- Brave discovery output in `uw_discovery_results.json`
- public page titles and snippets
- public docs pages that can be fetched without login

This review does **not**:

- use the UW API
- read member-only data
- read cookies
- bypass login
- run Playwright
- connect Dashboard

---

## Module Summary

| module | priority | status | summary |
| --- | --- | --- | --- |
| spx_greek_exposure | S | approved | SPX Greek Exposure path is clear, SPX-specific, and appears to have stable parameterized subviews. |
| spy_darkpool_offlit | S | needs_manual_browser_discovery | Brave mostly returned landing pages and API docs; no strong SPY-specific dark-pool data page was confirmed. |
| options_flow_alerts | S | partial | One likely app page exists, but exact SPX/SPY/QQQ flow entry still needs login-state verification. |
| nope | A_phase_2 | partial | NOPE page pattern exists for SPX/SPY, but required fields are not confirmed from public evidence alone. |
| volatility_iv | A_phase_2 | partial | Volatility pages clearly expose IV-related metrics, but term structure still needs browser confirmation. |

---

## 1) spx_greek_exposure

- **status:** approved
- **why:** URL pattern, page title, and Brave snippets all directly match the target module: `GEX`, `DEX`, `Vanna`, `Charm`, `SPX`, `dealer`, `hedging`.
- **public evidence:** Brave snippets explicitly mention `Gamma (GEX)`, `Delta (DEX)`, `Vanna`, `Charm`, strike/exposure views, and SPX-specific routes.

### Final candidate URLs

1. `https://unusualwhales.com/stock/SPX/greek-exposure`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.9`
   - `reason`: SPX 专用 Greek Exposure 主页面，路径和标题都直接命中目标字段，适合作为首选入口。

2. `https://unusualwhales.com/stock/SPX/greek-exposure?tab=Gamma`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.9`
   - `reason`: Gamma 子标签更聚焦 GEX，可优先验证是否能稳定读取 gamma 相关 DOM。

3. `https://unusualwhales.com/stock/SPX/greek-exposure?type=exposure&greek=gamma`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.9`
   - `reason`: 参数化视图更像稳定子页，后续固定 selector 和截图更容易。

**next step:** 先用登录后的本地浏览器确认主页面与 Gamma 子页是否共用同一套 DOM 结构。

---

## 2) spy_darkpool_offlit

- **status:** needs_manual_browser_discovery
- **why:** Brave 返回结果里最靠前的是 API docs、landing pages 和泛化页面，缺少明确的 `SPY dark pool price levels / off-lit ratio` 数据页证据。
- **public evidence:** `dark-pool-scanner` 和 `real-time-dark-pool-feed-access` 更像营销页；`api.unusualwhales.com/docs/...darkpool_recent` 明确属于 API docs，不能用于 DOM Reader。

### Final candidate URLs

1. `https://unusualwhales.com/dark-pool-flow`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `unknown`
   - `confidence`: `0.58`
   - `reason`: 名称最接近真实暗池流页面，但还没证明包含 SPY 专属价位层和 off-lit 比例数据。

2. `https://unusualwhales.com/lp/dark-pool-scanner`
   - `page_type`: `landing_page`
   - `login_required`: `false`
   - `usable_for_dom_reader`: `false`
   - `confidence`: `0.59`
   - `reason`: 这是营销落地页，只能帮助找入口，不能作为最终 DOM 读取页面。

3. `https://unusualwhales.com/lp/real-time-dark-pool-feed-access`
   - `page_type`: `landing_page`
   - `login_required`: `false`
   - `usable_for_dom_reader`: `false`
   - `confidence`: `0.54`
   - `reason`: 同样是营销页，没有足够证据表明可直接读取 SPY 暗池数据。

**next step:** 必须人工登录 UW 页面，在站内确认真正的 `SPY dark pool / off-lit / price levels` 数据页，再定 selector。

### URLs that should not be used

- `https://api.unusualwhales.com/docs/operations/PublicApi.DarkpoolController.darkpool_recent`
  - `page_type`: `api_docs`
  - `reason`: 虽然字段清楚，但这是 API 文档，不属于本次 DOM Reader 路线，而且当前明确禁止调用 UW API。

---

## 3) options_flow_alerts

- **status:** partial
- **why:** `flow/overview` 看起来是最接近真实流数据总览页的入口，另外有公开 docs 可以解释字段，但 Brave 结果里还有很多错误 ticker 或偏营销的页面。
- **public evidence:** `docs.unusualwhales.com/features/2-options-flow` 明确解释了 `Side / Premium / OI / Volume / IV / multileg` 等字段；`flow/overview` 路径最像真实应用页。

### Final candidate URLs

1. `https://unusualwhales.com/flow/overview`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.66`
   - `reason`: 最像实时 flow 总览页，后续在登录态下有机会稳定筛到 SPX/SPY/QQQ。

2. `https://docs.unusualwhales.com/features/2-options-flow`
   - `page_type`: `docs`
   - `login_required`: `false`
   - `usable_for_dom_reader`: `false`
   - `confidence`: `0.67`
   - `reason`: 字段说明最完整，可辅助后续做 selector 和字段映射，但不是读数页面。

3. `https://unusualwhales.com/option-flow-alerts`
   - `page_type`: `unknown`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `false`
   - `confidence`: `0.66`
   - `reason`: 这是 flow alerts 产品入口线索，但更像产品页，不应直接当 Reader 目标页。

**next step:** 先在登录浏览器里确认 `flow/overview` 是否能稳定定位 SPX/SPY/QQQ 的实时流区域；docs 只作为字段释义。

### URLs that should not be used

- `https://unusualwhales.com/stock/API/options-flow-history`
- `https://unusualwhales.com/stock/USEG/options-flow-history`
- `https://unusualwhales.com/stock/MSFT/options-flow-history`
- `https://unusualwhales.com/stock/OPRA/options-flow-history`
- `https://unusualwhales.com/stock/AMZN/options-flow-history`

Reason: 这些是单股票历史页或错误 ticker 命中，不适合当前市场级 `SPX / SPY / QQQ` 流监测入口。

---

## 4) nope

- **status:** partial
- **why:** 公开可确认 `NOPE` 页面模式存在，且 `NOPE = Net Options Pricing Effect` 已被说明文档确认；但 `call delta / put delta / stock volume / divergence / overheat` 还没有在公共证据里完整暴露。
- **public evidence:**
  - `NOPE: A Primer` 文章明确说明 `NOPE is the Net Options Pricing Effect`
  - `/stock/SPX/nope` 与 `/stock/SPY/nope` 页面标题存在
  - 页面标题还出现 `COPE & Flow Ratio`

### Required field check

| field | public evidence status | note |
| --- | --- | --- |
| NOPE | found | 页面标题和文章均明确出现 |
| Net Options Pricing Effect | found | `NOPE: A Primer` 明确给出定义 |
| call delta | not confirmed | 公开 snippet 未直接出现 |
| put delta | not confirmed | 公开 snippet 未直接出现 |
| stock volume | not confirmed | 公开 snippet 未直接出现 |
| divergence / overheat | not confirmed | 公开 snippet 未直接出现 |

### Final candidate URLs

1. `https://unusualwhales.com/stock/SPX/nope`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `unknown`
   - `confidence`: `0.66`
   - `reason`: SPX 专用 NOPE 页面已存在，但核心字段是否可见仍需登录后确认。

2. `https://unusualwhales.com/stock/SPY/nope`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `unknown`
   - `confidence`: `0.65`
   - `reason`: SPY NOPE 页面路径成立，适合作为第二个验证入口，但字段完整性还未证实。

3. `https://unusualwhales.com/news/nope-a-primer`
   - `page_type`: `docs`
   - `login_required`: `false`
   - `usable_for_dom_reader`: `false`
   - `confidence`: `0.68`
   - `reason`: 这篇文章适合确认 NOPE 的概念定义，但不是用于采集的读数页。

**next step:** 人工登录确认 `SPX/SPY NOPE` 页面里是否真的有 `call delta / put delta / stock volume / divergence or overheat` 再决定是否写 Reader。

### URLs that should not be used

- `https://unusualwhales.com/stock/PAY/nope`
- `https://unusualwhales.com/stock/PRI/nope`
- `https://unusualwhales.com/stock/PERF/nope`
- `https://unusualwhales.com/stock/COO/nope`

Reason: 这些页面证明了 `/stock/<ticker>/nope` 路径模式存在，但不是当前 index workflow 的目标页。

---

## 5) volatility_iv

- **status:** partial
- **why:** `SPX/SPY/XSP volatility` 页面路径非常清晰，搜索摘要已明确出现 `IV Rank / IV Percentile / Implied Volatility / Realized Volatility / volatility surfaces / skewness / kurtosis / IVIX`，但 `Term Structure` 仍需要登录页实证。
- **public evidence:** Brave snippet 已明确展示多个核心波动率字段，整体质量高于 `darkpool` 和 `NOPE`。

### Required field check

| field | public evidence status | note |
| --- | --- | --- |
| IV Rank | found | snippet 明确出现 |
| IV Percentile | found | snippet 明确出现 `IV percentiles` |
| Implied Volatility | found | snippet 明确出现 |
| Realized Volatility | found | snippet 明确出现 |
| Term Structure | not confirmed | 查询词命中，但公开摘要未直接写出 |
| Volatility Statistics | found | `skewness / kurtosis / volatility surfaces / IVIX` 可视为统计项证据 |

### Final candidate URLs

1. `https://unusualwhales.com/stock/SPX/volatility`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.87`
   - `reason`: SPX 专用波动率页，公开摘要已显示 IV Rank、IV、Realized Volatility 等核心字段。

2. `https://unusualwhales.com/stock/XSP/volatility`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.87`
   - `reason`: XSP 是 SPX 相关替代入口，若 SPX 页面权限或布局不稳定，可作为补充验证页。

3. `https://unusualwhales.com/stock/SPY/volatility`
   - `page_type`: `data_page`
   - `login_required`: `unknown`
   - `usable_for_dom_reader`: `true`
   - `confidence`: `0.87`
   - `reason`: SPY 波动率页摘要同样完整，适合对照 SPX 页确认同类 DOM 结构。

**next step:** 先在登录页面确认 `term structure` 是否与 IV/realized volatility 同页可见，再决定是否直接接 SPX 单页。

---

## Suggested Integration Order

1. **先接 `spx_greek_exposure`**
   - 理由：URL 质量最高、SPX 定位最准确、字段目标最清楚、子视图路径稳定。

2. **第二接 `volatility_iv`**
   - 理由：已有多个高质量 `data_page`，公开摘要已经覆盖大部分目标字段，只差 `term structure` 的最终确认。

3. **第三接 `options_flow_alerts`**
   - 理由：存在可用入口和完善 docs，但需要人工确认 market-wide flow 页面在登录态下的稳定 DOM。

4. **之后再接 `nope`**
   - 理由：NOPE 页面路径已找到，但 `call delta / put delta / stock volume / divergence` 证据不足，先做会带来二次返工风险。

5. **最后处理 `spy_darkpool_offlit`**
   - 理由：当前 discovery 质量最弱，误命中 landing/api_docs 较多，必须先人工浏览器确认真实数据页。

---

## Modules Requiring Manual Logged-in Page Confirmation

- `spy_darkpool_offlit`
- `options_flow_alerts`
- `nope`
- `volatility_iv` only for `term structure` confirmation

---

## URLs That Cannot Be Used Directly

- `https://api.unusualwhales.com/docs/operations/PublicApi.DarkpoolController.darkpool_recent`
  - API docs，不符合本次禁止调用 UW API 的边界。
- `https://unusualwhales.com/lp/dark-pool-scanner`
  - marketing landing page，不适合做 DOM Reader。
- `https://unusualwhales.com/lp/real-time-dark-pool-feed-access`
  - marketing landing page，不适合做 DOM Reader。
- `https://unusualwhales.com/option-flow-alerts`
  - 更像产品入口页，不是稳定读数页。
- `https://unusualwhales.com/news/nope-a-primer`
  - 只能做概念释义，不是读数页。
- `https://unusualwhales.com/stock/API/options-flow-history`
  - 错误 ticker / 非目标市场级入口。
- `https://unusualwhales.com/stock/PAY/nope` 及其他随机 ticker 的 `.../nope`
  - 只能说明路径模式存在，不是当前 SPX/SPY 工作流目标页。
