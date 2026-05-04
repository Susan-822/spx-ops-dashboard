# SPX 0DTE 决策系统调研报告：A/B 单算法与外部系统集成

本报告基于当前代码库的深度调研，详细梳理了 A/B 单的计算逻辑、关键线卡片的重构方案，以及未来与 TradingView 和 Telegram 进行集成的最佳实践。

## 一、 A/B 单计算逻辑与关键线卡片重构

### 1. A/B 单算法现状分析

当前系统中，A/B 单（Plan A / Plan B）的核心生成逻辑位于 `ab-order-engine.js`。该引擎通过组合 **Gamma 环境 (Gamma Regime)** 和 **资金流行为 (Flow Behavior)** 两个维度，输出明确的交易预案。

系统通过 `make*Plan` 系列函数生成具体的策略参数（进场、目标、止损、失效条件）：
*   **`makeLongCallPlan`**：用于多头突破（例如：负 Gamma + Call 有效）。
*   **`makeLongPutPlan`**：用于空头突破（例如：负 Gamma + Put 有效）。
*   **`makeBullPutSpreadPlan`**：用于多头价差（例如：正 Gamma + Put 被吸收，做市商不跟空）。
*   **`makeBearCallSpreadPlan`**：用于空头价差（例如：正 Gamma + Call 被压制）。
*   **`makeWaitPlan`**：用于方向不明或多空混战时的观望预案。

**核心决策矩阵示例**：
*   `positive_put_squeezed`（底部背离）：Plan A 为 `Bull Put Spread`，Plan B 为 `Long Call`。
*   `negative_put_effective`（空头动能）：Plan A 为 `Long Put`，Plan B 为 `Bear Call Spread`。

### 2. 关键线卡片重构方案

根据用户需求，主控卡片已经明确输出了多头方向或空头方向。因此，**关键线卡片（Key Levels Card）无需重复方向信息，而是应该专注于当前 A/B 单的执行状态监控**。

**重构设计方向**：
1.  **盘眼居中**：在关键线卡片顶部醒目位置显示当前 ATM（盘眼）。
2.  **状态指示器**：在盘眼下方，直接显示当前 A/B 单的实时状态：
    *   **等待 (Waiting)**：价格尚未触发进场条件，或者资金流向未确认。
    *   **放行 (Triggered/Ready)**：价格已突破触发线，且资金流向（如 5m/15m 双窗口）对齐支持，可执行。
    *   **失效 (Invalidated)**：价格触发了失效线（如跌破多头失效线），预案作废。
3.  **精简显示**：移除原有的多头/空头完整参数块，替换为动态的“当前追踪预案”简报，仅显示与当前活跃 A/B 单相关的最近一条触发线和目标线。

---

## 二、 TradingView 与 Telegram 集成方案

目前代码库中已包含 `tradingview/real.js`、`telegram/real.js` 以及 `tv-sentinel-engine.js` 等基础骨架，且环境变量已配置。后续集成需按以下方案推进。

### 1. TradingView Webhook 集成机制

TradingView 允许通过 Pine Script 的 `alert()` 函数向指定 URL 发送 HTTP POST 请求 [1]。

**通信协议与格式**：
*   **Endpoint**：`POST /webhook/tradingview`
*   **Payload 格式**：TradingView 必须发送合法的 JSON 格式。Pine Script 中虽然没有内置的 JSON 生成函数，但可以通过字符串拼接构建 JSON 字符串，并在 `alert()` 中发送 [2]。如果内容是合法 JSON，TradingView 会自动带上 `Content-Type: application/json` 头 [1]。
*   **安全校验**：Payload 中必须包含与系统环境变量 `TRADINGVIEW_WEBHOOK_SECRET` 匹配的 `secret` 字段。

**推荐的 Pine Script JSON 构建示例**：
```pine
// Pine Script v5/v6 示例
alert_msg = '{"secret": "000d3b57-e521-479c-addd-cc672dec00be", "event_type": "breakout_confirmed", "symbol": "SPX", "timeframe": "1m", "price": ' + str.tostring(close) + ', "side": "bullish"}'
if ta.crossover(close, upper_band)
    alert(alert_msg, alert.freq_once_per_bar_close)
```

**系统内部处理流 (`tv-sentinel-engine.js`)**：
1.  Webhook 接收到 `event_type`（如 `breakout_confirmed`）。
2.  引擎将其映射为内部结构事件（如 `A_LONG_PULLBACK`），并标记哨兵状态为 `triggered` 或 `matched`。
3.  `master-engine.js` 将 TV 哨兵信号与内部 A/B 单逻辑结合，决定最终的 `trade_plan` 状态。

### 2. Telegram Bot 告警推送机制

系统已具备向 Telegram 发送消息的能力，核心逻辑位于 `telegram-plan-alert.js`。

**推送策略与最佳实践**：
*   **异步非阻塞**：Webhook 路由中应使用 `queueMicrotask` 或后台队列发送 Telegram 消息，确保 TradingView Webhook 接口在 3 秒内快速响应 202 Accepted，避免超时 [1]。
*   **去重机制 (Deduplication)**：系统已实现 `telegramAlertDedupeStore.js`。通过构建 `dedupeKey`（包含 Symbol、Timeframe、Event Type、Side 和 Status），防止同一分钟内重复发送相同的告警疲劳轰炸。
*   **格式化输出**：Telegram Bot API 支持 `MarkdownV2` 或 `HTML` 格式 [3]。系统应使用这些格式高亮关键信息（如粗体显示进场价、红色/绿色表情符号区分多空），提升交易员在移动端的阅读体验。

**告警分级 (Alert Levels)**：
系统定义了 L1 到 L4 的告警级别：
*   **L4 (静默)**：数据不一致或环境降级，不发送。
*   **L3 (高优)**：Trade Plan 状态为 `ready`（放行），立即推送执行指令。
*   **L2 (普通)**：Trade Plan 状态为 `waiting`（等待），推送关注列表更新。

---

## 三、 下一步行动建议 (Action Plan)

在不修改代码的前提下，我们已明确了实施路径。后续若需落地，建议按以下步骤进行：

1.  **重构前端 UI**：修改 `app.js` 中的 `renderKeyLevels` 函数，将其从“静态展示多空两边”改为“动态展示当前 A/B 单状态（等待/放行/失效）”。
2.  **完善 TV Webhook 路由**：确保 `/webhook/tradingview` 端点能够正确解析 Pine Script 发送的自定义 JSON，并触发 `tv-sentinel-engine.js` 状态流转。
3.  **配置 Pine Script**：在 TradingView 端编写配套的 Pine Script，严格按照系统定义的 JSON 格式和 `event_type` 触发 Alert。
4.  **激活 Telegram 推送**：解除 `real.js` 中的测试限制，启用基于 MarkdownV2 的正式生产告警模板。

## 参考资料

[1] TradingView Support, "How to configure webhook alerts," TradingView. [Online]. Available: https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/.
[2] TradingView, "Alerts - Pine Script Docs," TradingView. [Online]. Available: https://www.tradingview.com/pine-script-docs/faq/alerts/.
[3] Telegram, "Telegram Bot API," Telegram Core. [Online]. Available: https://core.telegram.org/bots/api.
