# SPX Ops Dashboard 最终重构与审计报告

**日期：** 2026-05-05
**目标：** 建立首页唯一数据模型 `home_view_model`，彻底消除所有 raw engine 直读，确保数据流向符合单向数据流架构。

---

## 1. 架构重构：单向数据流

本次重构彻底解决了前端与多个后端计算引擎直接耦合导致的“多脑决策”问题。

**重构前架构（混乱）：**
`frontend renderHome` 直接读取 `atm_trigger_engine`, `flow_behavior_engine`, `ab_order_engine`, `dealer_wall_map` 等，并在前端重新进行业务逻辑判断（如 `isLocked` 的生成位置错误、`unavailable` 字符串判断等）。

**重构后架构（清晰）：**
```text
  UW / FMP / Price Raw Data
          ↓
  各 engine 计算（dealer-wall / atm-trigger / flow-behavior / ab-order）
          ↓
  signal_formatter 汇总（primary_card / levels / money_read）
          ↓
  home_view_model_builder（收口、拦截、降级、四行生成）
          ↓
  frontend renderHome（只读 signal.home_view_model）
```

---

## 2. 核心模块：home_view_model_builder

新建了 `home-view-model-builder.js`，严格遵守“**只做收口+拦截+降级+四行，不重算指标**”的原则。

### 2.1 智能收口与拦截规则
- **状态门控**：当 `ab_order_engine.status` 为 `blocked` / `waiting` 或 `locked=true` 时，强制进入 `LOCKED` 或 `WAIT` 状态，禁止输出方向提示。
- **Flow 降级门控**：当 `flow_quality = DEGRADED` 或 `suspicious_same_window = true` 时，强制禁止方向，禁止输出“动能可信”，并覆盖 `flow_narrative`。
- **PUT_HEAVY_ABSORBED 拦截**：当 Put 偏重但价格不跌时，触发空头动能降级，强制进入 `LOCKED`。
- **远端墙隔离**：远端墙（`far_call_wall` / `far_put_wall`）强制标记为 `radar_only`，彻底禁止进入首页主控。

### 2.2 首页四行生成逻辑
无论在什么状态下，首页四行都必须完整输出：
1. **状态 (status_line)**：`LOCKED｜锁仓` / `LONG_READY｜做多` 等
2. **动作 (action_line)**：受门控保护。LOCKED 时输出“不做 0DTE”；LONG 时输出“做多：[进场]站稳，[确认]确认”。
3. **进场点位 (entry_line)**：**LOCKED 下依然显示**。如果 ATM 缺失，显示具体的断点原因（如 `SPOT_MISSING` 或 `ATM_ROUNDING_FAILED`）。
4. **失效位 (invalidation_line)**：受 ATM 状态影响。

---

## 3. 前端清理与修复清单

共排查并移除了 8 处前端 `raw engine` 直读和多处旧文案残留：

| 位置 | 修复前 | 修复后 |
|---|---|---|
| **ATM 诊断** | 直读 `_ate` / `_pc2` | 读取 `hvm.atm_execution`，诊断原因由后端提供 |
| **Flow 双窗口** | 直读 `ate` / `fb2` | 读取 `hvm.flow` |
| **交易状态** | 直读 `ab` / `pc` | 读取 `hvm.status` |
| **Tab 面板** | 直读 `abEng2` / `ateEng2` | 读取 `hvm.status` 和 `hvm.atm_execution` |
| **Tab 拦截 Bug** | `isLocked` 在 Tab 内容渲染**之后**判断 | 移至渲染前，确保 LOCKED 时完全隐藏主做/备选 |
| **资金人话** | 直读 `ab_order_engine.status` | 读取 `hvm.status.allow_trade` |
| **Flow 统计** | 直读 `fb2.pc_volume_ratio` 等 | 读取 `hvm.flow` |
| **旧文案残留** | “小仓等确认”在 LOCKED 时仍可能出现 | 后端 `hvm.status.confidence_label` 增加 LOCKED 守卫 |

---

## 4. 验收测试结果

执行了 6 组自动化 Mock 验收测试，覆盖 40 个断言，**全部通过 (40/40)**：

1. **LOCKED 场景**：正确输出锁仓状态，无方向提示，LOCKED 下**依然显示** ATM 进场点位和失效位。
2. **LONG_READY 场景**：正确输出做多动作和具体的触发线/确认线。
3. **DEGRADED 场景**：Flow 降级时，正确拦截方向，`flow_narrative` 无“动能可信”残留。
4. **ATM_MISSING 场景**：Spot 缺失时，正确降级，进场点位显示 `ATM 触发线缺失（SPOT_MISSING）`，无 `unavailable` 乱码。
5. **PUT_HEAVY_ABSORBED 场景**：正确识别被吸收状态，强制锁定方向。
6. **FAR_WALL_BLOCKED 场景**：远端墙数据存在时，首页四行中未出现远端墙数值，严格隔离。

### 旧文案清零确认
全局扫描确认以下文案已彻底从首页逻辑中消失：
- `GEX PROFILE` / `Put Wall` / `Call Wall`
- `P/C：` / `Net Premium：`（旧格式）
- `unavailable`
- 在 LOCKED 状态下的 `主做` / `备选` / `多单` / `空单` / `动能可信` / `小仓等确认`

---

**结论：**
SPX Ops Dashboard 的首页数据流向已完全收敛至 `home_view_model`，架构清晰，边界分明，彻底消除了多点判断导致的显示异常和状态冲突。
