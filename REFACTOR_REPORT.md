# SPX Ops Dashboard 全链路代码审计与重构报告

## 一、 审计结果

在重构前的审计中，我们发现了以下问题：

1. **首页 GEX PROFILE 残留**：
   - **使用情况**：首页 `app.js` 的 `renderGexUrgencyChart` 仍在渲染，该函数错误地读取了 `dealer_wall_map.near_call_wall / near_put_wall`。
   - **命名混淆**：在 `dealer-wall-engine.js` 中，±500pt 的远端墙被错误地命名为 `near_call_wall` 和 `near_put_wall`。
   - **后果**：导致首页主控区域显示了 7000/7300 等远端墙，混淆了 0DTE 的日内执行。

2. **Flow 字段未拆分与旧格式**：
   - **使用情况**：首页 `ZONE 04` 的资金状态仍在渲染 `P/C：x ｜ Net Premium：x`。
   - **后端缺失**：`flow-behavior-engine.js` 中没有计算和输出 `pc_volume_ratio`、`pc_premium_ratio`、`pc_primary_ratio`、`directional_net_premium`、`flow_quality` 和 `flow_state` 等字段。

3. **LOCKED 状态的 Final Decision Gate 缺失**：
   - **使用情况**：当系统处于 LOCKED 或 WAIT 状态时，首页的 Tab 面板（主做/备选）仍会渲染多单/空单等方向性标签。
   - **后端缺失**：`ab-order-engine.js` 在输出最终状态前，缺少强制降级的 Final Decision Gate 拦截逻辑。

## 二、 修改文件清单

| 文件路径 | 修改内容 | 修改前问题 | 修改后逻辑 |
| --- | --- | --- | --- |
| `apps/api/decision_engine/algorithms/dealer-wall-engine.js` | 替换 `near_call_wall` / `near_put_wall` 为 `far_call_wall` / `far_put_wall` | ±500pt 的远端墙被错误命名为 near，导致前端误用 | 明确将 ±500pt 的墙命名为 far，使其仅用于 Radar 页面背景 |
| `apps/api/decision_engine/algorithms/flow-behavior-engine.js` | 增加 Flow 字段拆分和计算逻辑 | 仅输出单一的 `put_call_ratio` 和 `net_premium` | 输出拆分后的 `pc_volume_ratio`、`pc_premium_ratio`、`pc_primary_ratio`、`directional_net_premium`、`flow_state` 和 `flow_quality` |
| `apps/api/decision_engine/current-signal.js` | 更新对 `flowBehaviorEngine` 的调用 | 未传递新的拆分字段 | 将 `_ff` 中的新字段传递给 `flowBehaviorEngine` |
| `apps/api/decision_engine/algorithms/ab-order-engine.js` | 新增 Final Decision Gate 逻辑 | LOCKED 状态下仍允许传递多空方向和高可信度 | 当状态为 blocked 或 wait 时，强制设置 `allowTrade = false`，`tradeSide = 'NONE'`，并将标签降级为“观察” |
| `apps/web/app.js` | 移除 GEX PROFILE 渲染，更新资金卡片，增加 Tab 面板的 LOCKED 拦截 | 渲染旧的 GEX 图表，显示旧的 P/C 格式，LOCKED 状态下仍显示主做/备选 Tab | 彻底删除 `renderGexUrgencyChart` 的调用，更新 ZONE 04 为新的 Flow 字段展示，LOCKED 状态下隐藏主做/备选 Tab |

## 三、 字段口径表

| 字段名 | 来源 endpoint / engine | 单位 | 用途 | 首页可用 / Radar only | 是否允许 fallback |
| --- | --- | --- | --- | --- | --- |
| `atm` | `atm_trigger_engine` | pt | 首页主控基准线 | 首页可用 | 否 |
| `bull_trigger` / `bear_trigger` | `atm_trigger_engine` | pt | 首页多空触发线 | 首页可用 | 否 |
| `gex_local_call_wall` / `gex_local_put_wall` | `dealer_wall_map` | pt | 首页 GEX 参考（±30pt 内） | 首页可用 | 否 |
| `far_call_wall` / `far_put_wall` | `dealer_wall_map` | pt | 远端背景墙（±500pt） | Radar only | 否 |
| `pc_volume_ratio` | `flow_behavior_engine` | float | 成交量 P/C 比 | 首页可用 | 是 (fallback 到 `put_call_ratio`) |
| `pc_premium_ratio` | `flow_behavior_engine` | float | 权利金 P/C 比 | 首页可用 | 否 |
| `pc_primary_ratio` | `flow_behavior_engine` | float | 优先 P/C 比 | 首页可用 | 是 (fallback 到 `put_call_ratio`) |
| `directional_net_premium` | `flow_behavior_engine` | $ | 方向性净权利金 | 首页可用 | 是 (fallback 到 `net_premium`) |

## 四、 首页渲染路径

1. **ZONE 01 (主控状态)**：读取 `ab_order_engine.status`、`primary_card.direction_label` 等字段。当 `status` 为 LOCKED 时，仅显示“锁仓观察”、“不做 0DTE”。
2. **ZONE 02 (ATM 执行线)**：读取 `atm_trigger_engine` 的 `bull_trigger`、`bear_trigger`、`invalidation_bull`、`invalidation_bear` 等字段。
3. **ZONE 03 (GEX 本地参考)**：仅读取 `dealer_wall_map` 的 `gex_local_call_wall` 和 `gex_local_put_wall`。禁止读取远端墙。
4. **ZONE 04 (资金状态)**：读取 `flow_behavior_engine` 的 `pc_volume_ratio`、`pc_premium_ratio`、`pc_primary_ratio`、`directional_net_premium` 和 `flow_narrative`。
5. **被禁止读取的字段**：`uw_wall_diagnostics.call_wall`、`dealer_wall_map.far_call_wall` 等远端墙字段严禁在首页主控区域渲染。

## 五、 Radar 渲染路径

1. **完整证据展示**：Radar 页面继续渲染 `far_call_wall`、`far_put_wall`、`global_call_gex_cluster`、`gamma_flip` 等远端和全局数据。
2. **Background Only**：远端墙数据仅作为 `background_only`，并在页面上明确标注“仅 Radar 参考，不作日内触发”。
3. **不参与执行**：Radar 页面的任何远端 GEX 数据均不参与首页的 `allow_trade` 或方向判定。

## 六、 Final Decision Gate 规则

1. **LOCKED 时**：
   - 禁用：`allowTrade = false`
   - 禁用方向：`tradeSide = 'NONE'`
   - 禁用标签：`directionalLabel = '观察'`，`momentumLabel = '降级'`
   - 禁用 Tab：首页隐藏“主做”、“备选” Tab，仅显示“盘眼” Tab 的锁仓观察逻辑。
2. **WAIT 时**：
   - 同样执行上述禁用逻辑，强制降级为观察状态。
3. **允许 LONG_READY 条件**：
   - 必须满足 `ab_order_engine.status === 'active'` 且 `tradeSide === 'LONG'`。
4. **允许 SHORT_READY 条件**：
   - 必须满足 `ab_order_engine.status === 'active'` 且 `tradeSide === 'SHORT'`。
