# SPX Ops Dashboard 全链路代码审计与重构报告

**版本：** v2.0 全链路重构
**提交：** `4b36fc8`
**日期：** 2026-05-04
**范围：** 全仓库审计 + 一次性系统性重构修复

---

## 一、审计发现的问题

本次审计对 `apps/api/decision_engine/` 和 `apps/web/` 进行了全链路扫描，发现以下三类系统性问题：

### 问题 A：GEX 字段分层命名混乱（根因）

`dealer-wall-engine.js` 中，±500pt 的**远端背景墙**被错误命名为 `near_call_wall` / `near_put_wall`，导致下游所有模块（`atm-trigger-engine.js`、`signal-formatter.js`、`current-signal.js`、`app.js`）均将远端墙误用为近端执行参考。

| 层级 | 正确含义 | 修复前字段名 | 修复后字段名 |
| --- | --- | --- | --- |
| Layer 1 | ATM±5/10pt 触发线 | `bull_trigger_1/2`、`bear_trigger_1/2` | 不变 |
| Layer 2 | GEX 本地参考墙（±30pt） | `gex_local_call_wall` | 不变 |
| Layer 3 | 远端背景墙（±500pt，Radar only） | `near_call_wall` / `near_put_wall` | **`far_call_wall` / `far_put_wall`** |

### 问题 B：Flow 字段未拆分（P/C 单一化）

`flow-behavior-engine.js` 仅输出单一的 `put_call_ratio`，缺少 Volume/Premium/Primary 三路拆分，导致前端无法区分成交量 P/C 和权利金 P/C 的差异，误判方向强度。

| 缺失字段 | 含义 | 修复方式 |
| --- | --- | --- |
| `pc_volume_ratio` | 成交量 P/C 比 | 新增，fallback 到 `put_call_ratio` |
| `pc_premium_ratio` | 权利金 P/C 比 | 新增 |
| `pc_primary_ratio` | 优先 P/C 比（Volume 优先） | 新增，fallback 到 `put_call_ratio` |
| `directional_net_premium` | 方向性净权利金 | 新增，fallback 到 `net_premium` |
| `call_premium_abs` / `put_premium_abs` | Call/Put 绝对权利金 | 新增 |
| `flow_state` | 流向状态枚举 | 新增（如 `PUT_HEAVY_ABSORBED`） |
| `flow_quality` | 数据质量标志 | 新增（`NORMAL` / `DEGRADED`） |
| `flow_narrative` | 人话叙述 | 新增 |

### 问题 C：LOCKED 状态缺少 Final Decision Gate

`ab-order-engine.js` 在 `status === 'blocked'` 或 `status === 'wait'` 时，仍将多空方向和高可信度传递给前端。前端 Tab 面板（主做/备选）在 LOCKED 时仍显示"多单"/"空单"方向性标签，存在误导交易的风险。

---

## 二、修改文件清单

| 文件 | 修改类型 | 核心变更 |
| --- | --- | --- |
| `apps/api/decision_engine/algorithms/dealer-wall-engine.js` | 重命名 | `near_call_wall` → `far_call_wall`，`near_put_wall` → `far_put_wall`（全局替换） |
| `apps/api/decision_engine/algorithms/atm-trigger-engine.js` | 参数更新 | 接受 `far_call_wall` / `far_put_wall` 参数，保留 `near_call_wall` / `near_put_wall` 作为 legacy alias |
| `apps/api/decision_engine/algorithms/flow-behavior-engine.js` | 字段扩展 | 新增 9 个 Flow 字段（见问题 B 表格） |
| `apps/api/decision_engine/algorithms/ab-order-engine.js` | 逻辑新增 | Final Decision Gate：blocked/wait 时强制降级所有方向标签 |
| `apps/api/decision_engine/current-signal.js` | 调用更新 | 向 flowBehaviorEngine 传递新字段；向 atmTriggerEngine 传递 far_call/put_wall |
| `apps/api/decision_engine/signal-formatter.js` | 引用修正 | buildLevels 和 buildMoneyRead 中的 near_call_wall fallback 改为 gex_local_call_wall |
| `apps/web/app.js` | 三处修复 | ① 移除首页 GEX PROFILE 调用；② 资金卡片替换为 Flow 五字段展示；③ LOCKED 时隐藏主做/备选 Tab |
| `apps/web/styles.css` | 样式新增 | 新增 .flow-stats-new、.ptab-locked-notice 等 CSS 规则 |

---

## 三、字段口径表（权威版本）

| 字段名 | 来源 Engine | 单位 | 首页可用 | Radar only | 允许 Fallback |
| --- | --- | --- | --- | --- | --- |
| `atm` | `atm_trigger_engine` | pt | 是 | — | 否 |
| `bull_trigger_1/2` | `atm_trigger_engine` | pt | 是 | — | 否 |
| `bear_trigger_1/2` | `atm_trigger_engine` | pt | 是 | — | 否 |
| `invalidation_bull/bear` | `atm_trigger_engine` | pt | 是 | — | 否 |
| `gex_local_call_wall` | `dealer_wall_map` | pt | 是（±30pt） | — | 否 |
| `gex_local_put_wall` | `dealer_wall_map` | pt | 是（±30pt） | — | 否 |
| `far_call_wall` | `dealer_wall_map` | pt | **禁止** | 是 | 否 |
| `far_put_wall` | `dealer_wall_map` | pt | **禁止** | 是 | 否 |
| `global_call_gex_cluster` | `dealer_wall_map` | pt | **禁止** | 是 | 否 |
| `pc_volume_ratio` | `flow_behavior_engine` | float | 是 | — | 是（→ `put_call_ratio`） |
| `pc_premium_ratio` | `flow_behavior_engine` | float | 是 | — | 否 |
| `pc_primary_ratio` | `flow_behavior_engine` | float | 是 | — | 是（→ `put_call_ratio`） |
| `directional_net_premium` | `flow_behavior_engine` | $ | 是 | — | 是（→ `net_premium`） |
| `flow_state` | `flow_behavior_engine` | enum | 是 | — | 否 |
| `flow_quality` | `flow_behavior_engine` | enum | 是 | — | 否 |
| `flow_narrative` | `flow_behavior_engine` | string | 是 | — | 否 |

---

## 四、Final Decision Gate 规则

当 `ab_order_engine.status` 为 `blocked` 或 `wait` 时，以下字段被强制覆盖：

```
allowTrade       = false
tradeSide        = 'NONE'
directionalLabel = '观察'
momentumLabel    = '降级'
```

前端对应行为：
- 首页 Tab 面板隐藏"主做"和"备选" Tab
- 仅保留"盘眼" Tab，显示锁仓观察内容
- Tab 导航栏显示红色 `LOCKED — 禁止开仓，仅观察` 标签

---

## 五、首页渲染路径（修复后）

```
renderHome(signal)
├── renderHudPanel(signal)
│   ├── ZONE 01 (主控状态)   → ab_order_engine.status / primary_card.direction_label
│   ├── ZONE 02 (ATM 执行线) → atm_trigger_engine.bull_trigger / bear_trigger / invalidation_*
│   ├── ZONE 03 (GEX 本地)   → dealer_wall_map.gex_local_call_wall / gex_local_put_wall (±30pt)
│   └── ZONE 04 (资金状态)   → flow_behavior_engine.pc_volume_ratio / pc_premium_ratio /
│                               pc_primary_ratio / directional_net_premium / flow_narrative
├── 主控卡片
│   └── Tab 面板
│       ├── [LOCKED] → 仅显示盘眼 Tab + LOCKED 提示
│       └── [ACTIVE] → 盘眼 / 主做 / 备选 三 Tab
└── aux-sidebar
    ├── 资金人话 (mr.title / mr.body)
    ├── 暗盘人话 (dr.title / dr.body)
    ├── 波动率仪表盘
    └── VIX 卡片
```

**严禁在首页读取的字段：**
- `dealer_wall_map.far_call_wall` / `far_put_wall`
- `uw_wall_diagnostics.call_wall` / `put_wall`
- `dealer_wall_map.global_call_gex_cluster` / `global_put_gex_cluster`

---

## 六、Git 提交记录

| Commit | 内容 |
| --- | --- |
| `b31caba` | 全链路代码审计与一次性重构修复（GEX分层/Flow拆分/LOCKED状态拦截） |
| `4b36fc8` | 全链路重构第二轮 - 完整 near/far 命名修正、Flow字段拆分、LOCKED Gate、CSS样式 |
