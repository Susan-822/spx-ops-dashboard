# 0DTE 日内执行卡片问题调查与修复方案

**调查日期：** 2026-04-30
**调查目标：** 定位首页 A/B 单、资金人话、做市商路径等卡片中远端墙（7200/7000）残留问题，并分析数据未实时更新的根本原因。

---

## 核心问题诊断

### 1. 为什么 UW 实时更新时间戳显示为 "--"？

前端主控卡片右上角的 `UW 实时更新` 时间戳依赖于 API 返回的 `signal.price_contract.last_updated` 字段。
经过代码追踪发现：
- 在后端的 `current-signal.js` 中，`finalOutput` 确实生成了 `last_updated`，但是它被放在了根对象上（`finalOutput.last_updated`）。
- 而前端 `app.js` 的 `renderHome` 函数中，错误地尝试从 `signal.price_contract.last_updated` 读取时间戳，导致获取不到数据而显示 `--`。
- **同时，前端目前缺乏自动轮询机制**。用户需要手动刷新页面才能获取最新数据，这不符合 0DTE 期权时间衰减极快、需要秒级响应的特性。

### 2. 为什么 "资金人话" 卡片仍在提示 7200 / 7000？

在 `signal-formatter.js` 的 `buildMoneyRead` 函数中，文本是硬编码生成的：
- 当前代码：`等 ${cwFmt} 站稳或 ${pwFmt} 跌破`
- 这里的 `cwFmt` 和 `pwFmt` 直接来源于 `near_call_wall` 和 `near_put_wall`。
- 由于 `findNearCallWall` 的搜索范围高达 `spot + 500`，它会把远端的 7200 直接拉过来作为近端墙，导致文本中出现不适合 0DTE 的大跨度点位。

### 3. 为什么 A/B 单（ab_order_engine）的入场条件也是 7000/7200？

在 `ab-order-engine.js` 中，生成方向单预案时：
- `makeLongCallPlan` 的 `tp1` / `tp2` 被硬编码为 `call_wall + 10` 和 `call_wall + 20`。
- `wait_long` 触发条件被硬编码为 `站稳 ${call_wall} 后回踩不破`。
- 整个 `ab_order_engine` 接收的 `call_wall` 参数依然是旧的远端墙，而不是新引入的 `atm_trigger_engine` 生成的 `bull_trigger_1` (ATM+5) 等短线触发线。

---

## 修复方案设计

为了让系统完全适应 0DTE 快进快出的节奏，需要进行以下彻底的重构：

### 修复阶段 1：打通数据流，替换远端墙

1. **重构 `ab-order-engine.js`**：
   - 移除所有对 `call_wall` / `put_wall` 的直接依赖。
   - 引入 `atm_trigger_engine` 的输出（`bull_trigger_1/2`, `bear_trigger_1/2`, `bull_target_1/2` 等）。
   - 将所有 A/B 单的 `wait_long`、`wait_short`、`tp1`、`tp2` 替换为基于 ATM 的动态触发线。

2. **重构 `signal-formatter.js` (资金人话)**：
   - 修改 `buildMoneyRead` 函数。
   - 将 `等 7200 站稳或 7000 跌破` 替换为 `等 ${bull_trigger_1} 站稳或 ${bear_trigger_1} 跌破`。

### 修复阶段 2：实现前端秒级实时刷新

0DTE 期权的时间价值（Theta）衰减极快，且 Gamma 风险随时间非线性增加。手动刷新页面无法捕捉关键的资金流异动（如 5 分钟内 Put Premium 突增）。

1. **修正时间戳读取**：
   - 修改 `app.js`，将 `pc.last_updated` 改为 `signal.last_updated`，恢复 UW 实时时间戳的显示。

2. **引入前端自动轮询 (Auto-Polling)**：
   - 在 `app.js` 中添加 `setInterval` 轮询机制。
   - 读取后端的 `refresh_policy`，根据当前模式（NORMAL / TURBO）动态调整前端的刷新频率。
   - 默认非交易时段 60 秒刷新一次，交易时段 10-15 秒刷新一次，当价格逼近触发线时（TURBO 模式）5 秒刷新一次。
   - 每次刷新后，动态重绘主控卡片、A/B 单卡片和资金人话卡片，无需刷新整个页面。

---

**结论**：上述问题均已定位到具体代码行。这不是数据缺失问题，而是旧逻辑（远端墙）未完全替换为新逻辑（ATM触发线），以及前端缺少自动轮询循环。

**下一步建议**：我们可以立即开始修改代码，先修复远端墙文本残留，再加入前端自动刷新机制。
