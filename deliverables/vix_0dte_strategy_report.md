# VIX 与 SPX 0DTE 日内策略配合调研报告

**日期**：2026-04-30
**作者**：Manus AI

## 1. 当前代码库中 UW API 的 VIX 字段情况

经过对现有代码库的全面梳理，当前系统在处理波动率（Volatility）数据时，主要依赖于 `unusual_whales` (UW) API 以及 `FMP` 作为补充。

### 1.1 UW API 提供的核心波动率字段
在 `uw-api-normalizer.js` 和 `uw-normalizer.js` 中，系统已经对 UW 的波动率端点进行了规范化处理。真实可用的核心字段包括：

*   **`iv_rank`**：包含 `iv_rank_1y`（0-100 范围）和历史收盘价（`prev_close`）。这是衡量当前隐含波动率在过去一年中所处相对位置的关键指标。
*   **`interpolated_iv`**：包含 30 天插值隐含波动率（`volatility`）和对应的百分位（`percentile`）。这是系统计算 `atm_iv` 和 `iv30` 的首选来源。
*   **`realized_volatility`**：实际历史波动率（HV），用于与隐含波动率进行对比（IV/HV Ratio），评估期权定价是“昂贵”还是“便宜”。
*   **`term_structure`**：波动率期限结构，包含不同到期日的 IV 数据，可用于判断结构是前端高企（Front-loaded）还是后端高企（Back-loaded）。

### 1.2 当前系统的 VIX 接入现状
*   **VIX 指数获取**：当前系统主要通过 FMP API 抓取 `^VIX` 的实时报价（在 `volatility-engine.js` 中）。
*   **UW API 的限制**：UW 的 `/volatility` 相关端点提供的是标的资产（如 SPX 或 SPY）自身的隐含波动率（IV30、IV Rank 等），而**不直接提供 VIX 指数本身的实时报价**。
*   **状态降级**：当 FMP 接口超限或不可用时，系统当前会将 VIX 状态标记为 `missing` 或 `limit_reach`，并在主控卡片中提示“VIX 暂不参与主控判断”。

---

## 2. VIX 与 SPX 0DTE 策略的业界最佳实践

在 0DTE（零日到期）期权交易中，VIX 及其衍生指标（如 VIX1D、IV Rank）是决定策略选择、头寸宽度和执行许可的核心过滤器。以下是基于业界实战经验总结的最佳配合逻辑。

### 2.1 VIX 区间（Regime）与 0DTE 策略选择

VIX 的绝对水平直接决定了市场的日内波动范围（Intraday Range）和期权费的昂贵程度。不同的 VIX 区间需要匹配完全不同的 0DTE 策略结构 [1] [2]。

| VIX 区间 | 市场环境描述 | 0DTE 策略偏好 | 触发线 / 锁仓区宽度调整建议 |
| :--- | :--- | :--- | :--- |
| **< 15** | **极度自满 (Zombieland)**<br>市场呈缓慢向上碾压（Grind higher）态势，日内波幅极小（15-25点）。 | **偏向买方 / 窄跨度策略**<br>期权费极度便宜，适合买入单腿（Long Call/Put）或极窄的蝶式期权（10-wide Butterfly）。禁止激进卖空波动率。 | **收窄**<br>ATM±5 点的触发线足够灵敏，因为市场很难出现大幅单边行情。 |
| **15 - 20** | **正常波动 (Goldilocks)**<br>技术分析和供需区间最有效的甜点区。有足够的波动产生利润，但不会轻易击穿防守线。 | **双向均可 / 结构化策略**<br>适合 15-wide 的蝶式期权或在关键 Gamma 墙进行均值回归交易（Fade）。 | **标准**<br>维持 ATM±5/10 的触发和确认线设置。 |
| **20 - 30** | **情绪恐慌 (Elevated)**<br>波动率显著上升，日内波幅扩大至 40-60+ 点，价格容易“超调”（Overshoot）。 | **偏向卖方 / 宽跨度策略**<br>期权费昂贵，买方胜率极低。适合更宽的结构（20-wide Butterfly）或顺势突破策略。 | **放宽**<br>触发线需放宽至 ATM±10/15，以过滤高波动带来的假突破（Fake out）。 |
| **> 30** | **极端混乱 (Chaos)**<br>市场极度不稳定，机械性抛售主导。 | **极宽防守 / 观望**<br>使用 25-wide 以上结构，或直接暂停 0DTE 交易。 | **大幅放宽或禁用**<br>常规触发线失效，应依赖远端大级别 Gamma 墙。 |

### 2.2 Rule of 16：将 VIX 转化为日内预期波动 (Implied Move)

在 0DTE 交易中，交易员通常使用“16法则”（Rule of 16）将年化的 VIX 转化为 SPX 的日内预期波动百分比 [3]。

> **计算公式**：日内预期波动百分比 = VIX ÷ 16

例如：如果当前 VIX 为 16，则 SPX 的日内预期波动为 1%（约 50-60 点）。如果 VIX 升至 24，日内预期波动则扩大至 1.5%。这一规则是动态调整 0DTE 触发线和目标位的数学基础。

### 2.3 VIX 支撑阻力与 SPX 的背离确认

VIX 本身具有技术支撑和阻力位，它与 SPX 的反向关系是 0DTE 日内快进快出的关键确认信号 [2]：
*   **多头确认**：当 SPX 触及日内支撑（如 ATM-5 触发线），且 VIX 同时触及日内阻力并开始回落时，是胜率最高的做多（Long Call）信号。
*   **空头确认**：当 SPX 触及日内阻力，且 VIX 在支撑位企稳反弹时，是做空（Long Put）的绝佳时机。
*   **背离警告**：如果 SPX 创出日内新高，但 VIX 也在同步上涨，这通常是做市商在买入看跌期权对冲，预示着上涨极其脆弱，随时可能发生“抽地毯”（Rug pull）。

### 2.4 IV Rank 与期权定价评估 (Option Cost)

UW API 提供的 `iv_rank` 是决定 0DTE 策略是做买方还是卖方的核心依据 [4]：
*   **高 IV Rank (> 50)**：表明当前隐含波动率高于过去一年的平均水平，期权费昂贵（Expensive）。此时应**避免裸买单腿 0DTE 期权**，因为一旦方向判断失误或波动率回归，IV Crush 会导致权利金迅速归零。此时卖方策略（如 Credit Spreads）更具优势。
*   **低 IV Rank (< 20)**：期权费便宜（Cheap），买方风险收益比极佳。此时适合买入 0DTE Call/Put，利用高 Gamma 特性博取不对称收益。

---

## 3. 结合当前系统架构的改进建议（后续开发思路）

基于上述调研，针对当前系统的 `atm-trigger-engine` 和 `primary_card` 逻辑，建议在未来进行以下深度融合（当前不修改代码）：

1.  **触发线宽度的 VIX 动态调节**：
    当前的 `bull_trigger_1 = ATM + 5` 是硬编码的。未来可引入 VIX 系数：
    *   VIX < 15：维持 ±5 点。
    *   VIX > 20：触发线自动拓宽至 ±10 点，以适应扩大的日内波幅。
2.  **基于 IV Rank 的买方拦截机制 (Buyer Risk Gate)**：
    利用 UW API 的 `iv_rank` 数据。当 `iv_rank > 60` 且 VIX 处于高位时，主控卡片应在 `plan.forbidden` 中明确警告：“当前 IV 溢价极高，禁止裸买 0DTE 单腿，建议采用价差策略”。
3.  **VIX 数据源的降级处理**：
    由于 UW 不直接提供 VIX 报价，系统应继续保留 FMP 获取 VIX 的逻辑。但可以将 UW 提供的 SPX `atm_iv` 或 `iv30` 作为 VIX 的高精度替代品（Proxy），在 FMP 失效时无缝接管 VIX 的分级逻辑。

---
### References
[1] Option Alpha. (2025). VIX1D Explained: 0DTE Intraday Volatility. Retrieved from https://optionalpha.com/learn/vix1d-explained-0dte-intraday-volatility
[2] KASM CAPITAL. (2025). The Proven Method for Trading SPX 0DTE Options. Retrieved from https://substack.com/home/post/p-180991908
[3] SpotGamma. (2023). Rule of 16 / Rule of 7.2. Retrieved from https://support.spotgamma.com/hc/en-us/articles/15414593004563-Rule-of-16-Rule-of-7-2
[4] Unusual Whales. (2025). The 0DTE Feature Explained. Retrieved from https://unusualwhales.com/information/the-0dte-feature-explained
