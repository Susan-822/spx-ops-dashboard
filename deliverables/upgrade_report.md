# SPX Ops Dashboard — L2.5 机构级升级交付报告

**提交版本**: `298534a`  
**部署地址**: https://spxopslab.onrender.com  
**部署平台**: Render (Auto-Deploy from GitHub main)  
**交付日期**: 2026-04-30

---

## 一、本次升级完成内容总览

| 模块 | 状态 | 说明 |
|------|------|------|
| P0 价格安全层 | ✅ 完成 | SPX 现价与 SPY 暗池映射价彻底隔离 |
| ATM 识别引擎 | ✅ 完成 | 新增文件 `atm-engine.js` |
| Gamma Regime 引擎 | ✅ 完成 | 新增文件 `gamma-regime-engine.js` |
| Flow 行为四分类引擎 | ✅ 完成 | 新增文件 `flow-behavior-engine.js` |
| A/B 单自动生成引擎 | ✅ 完成 | 新增文件 `ab-order-engine.js` |
| 数据调度器激活 | ✅ 完成 | `live-refresh-scheduler.js` 真实数据轮询 |
| 执行门控修复 | ✅ 完成 | `command-environment-engine.js` 逻辑缺陷修复 |
| HUD 前端四大战区 | ✅ 完成 | `app.js` + `styles.css` 全面升级 |
| GitHub Push | ✅ 完成 | `origin/main` 已更新 |
| Render 部署 | ✅ 触发 | Auto-Deploy 已启动 |

---

## 二、P0 安全修复详情

### 2.1 `price-contract.js`（新增）
**问题**: 系统中 `mapped_spx = SPY × 10` 的暗池映射价可能被误用为 SPX 实时现价，导致决策引擎基于错误价格生成交易指令。

**修复**: 创建硬约束层，强制要求所有进入决策引擎的价格必须通过 `validatePriceContract()` 验证。验证规则：
- 价格必须来源于 FMP 实时 API（`source === 'fmp'`）
- 价格范围必须在 SPX 合理区间（2000–10000）
- 标记 `is_contaminated = true` 时拒绝用于执行计算

### 2.2 `price-trigger-engine.js`（修改）
**问题**: `key_level` 直接使用 `darkpool_gravity.mapped_spx` 作为价格参考，导致 SPY×10 的映射价污染触发逻辑。

**修复**: 注入 `price_contract` 验证，`key_level` 只接受 `price_contract.live_price` 作为基准价格。

### 2.3 `darkpool-gravity-engine.js`（修改）
**问题**: `mapped_spx` 字段没有明确标记其"仅供参考"属性，下游模块可能误用。

**修复**: 在输出中添加 `mapped_spx_is_reference_only: true` 标记，并在注释中明确禁止用于 `spot_price`。

### 2.4 `command-environment-engine.js`（修改）
**问题 1**: `key_support` 变量在 return 块中始终为 `undefined`（赋值在 return 之后）。  
**问题 2**: `dataCoherence` 字段名与上游 `data_coherence` 不一致。

**修复**: 将 `key_support` 的计算移至 return 块之前；统一字段名为 `data_coherence`。

---

## 三、新增 L2.5 引擎详情

### 3.1 ATM 识别引擎 (`atm-engine.js`)
输出字段：
- `atm`: 当前 ATM 行权价（最近的 50 点整数倍）
- `atm_trend`: `rising` / `falling` / `stable`（基于 ATM 与现价距离变化）
- `pin_risk`: 0–100 的吸附风险评分（现价距 ATM < 3 点时触发高风险）
- `magnet_axis`: 做市商磁吸中轴位

### 3.2 Gamma Regime 引擎 (`gamma-regime-engine.js`)
输出字段：
- `gamma_regime`: `positive` / `negative` / `transitional` / `unknown`
- `dealer_mode`: `mean_reversion` / `trend_amplification` / `uncertain`
- `call_wall` / `put_wall` / `gamma_flip`: 关键墙位
- `scores.execution_confidence`: 0–100 执行置信度

判断逻辑：
- **正 Gamma**: 净 GEX > 0，做市商阻尼，均值回归，卖权策略占优
- **负 Gamma**: 净 GEX < 0，做市商放波，趋势加速，买权策略占优
- **过渡区**: |净 GEX| < 阈值，双向谨慎

### 3.3 Flow 行为四分类引擎 (`flow-behavior-engine.js`)
四种行为模式：
| 模式 | 条件 | 含义 |
|------|------|------|
| `put_effective` | Put 净权利金 > 阈值 且 P/C > 1.2 | 空头资金有效流入，下行压力真实 |
| `put_squeezed` | Put 权利金大但价格未跌 | Put 被绞，空头陷阱，反弹风险 |
| `call_effective` | Call 净权利金 > 阈值 且 P/C < 0.8 | 多头资金有效流入，上行动能真实 |
| `call_capped` | Call 权利金大但价格未涨 | Call 被压，多头陷阱，回落风险 |

**核心指标 — 15 分钟加速度**：
- 比较当前 15 分钟净权利金流速与前一周期
- `acceleration_label`: `+$X.XB/15min` 格式
- `is_accelerating`: 当加速度 > 20% 时为 true

### 3.4 A/B 单自动生成引擎 (`ab-order-engine.js`)
基于 Gamma Regime + Flow 行为的矩阵决策：

| Gamma 环境 | Flow 行为 | 预案 A | 预案 B |
|-----------|----------|--------|--------|
| 正 Gamma | Call Effective | Bull Put Spread | Long Call |
| 正 Gamma | Put Squeezed | Bull Put Spread | Fade Put |
| 负 Gamma | Call Effective | Long Call / Call Debit Spread | 突破追多 |
| 负 Gamma | Put Effective | Long Put / Bear Call Spread | 突破追空 |
| 任意 | Mixed | 等待方向确认 | 铁鹰式中性 |

每个预案包含：`instrument`、`entry`、`stop`、`tp1`、`tp2`、`invalid`（失效条件）、`condition`（触发条件）

---

## 四、HUD 前端四大战区

### 战区 01 — Gamma 战场
- Gamma Regime 横幅（正/负/过渡，颜色编码）
- 执行置信度评分（0–100）
- Gamma Flip / Call Wall / Put Wall 三格显示（含距离）
- ATM 磁吸中轴行（蓝色高亮，含吸附风险警告）

### 战区 02 — 执行边界与墙
- 四条关键墙位卡片（Call Wall / Put Wall / 暗盘防线 / Gamma 翻转点）
- 距离实时计算（±2 点内触发狙击状态）
- **屏幕边缘闪烁报警**（红色边框动画，进入狙击状态时激活）

### 战区 03 — 资金微观 X-Ray
- Flow 行为四分类横幅（颜色编码）
- 净权利金 / Call 权利金 / Put 权利金
- **15 分钟加速度**（最核心指标，蓝色边框高亮，大字体）
- P/C 情绪极值（> 1.5 或 < 0.5 时标红）
- 资金侵略性进度条

### 战区 04 — 指令生成器
- 系统判定摘要（蓝/红/琥珀色背景，对应就绪/锁定/等待）
- 执行置信度进度条
- Plan A / Plan B 双卡片（含入场/止损/TP1/TP2/失效条件）
- ATM 吸附警告横幅

---

## 五、数据调度器激活状态

| 数据源 | 轮询间隔 | 状态 |
|--------|---------|------|
| FMP 实时价格 | 2 秒 | ✅ 激活 |
| UW 期权流数据 | 15 秒 | ✅ 激活（受 `UW_POLL_INTERVAL_SECONDS` 控制）|
| UW 暗池数据 | 30 秒 | ✅ 激活 |
| Stale 检测 | 每次请求 | ✅ 激活（超时自动降级）|

---

## 六、线上服务验证

- **服务地址**: https://spxopslab.onrender.com
- **HTTP 状态**: 401（Basic Auth 保护正常工作）
- **响应时间**: ~2 秒（Render Free 冷启动正常）
- **GitHub 最新 commit**: `298534a feat: L2.5 institutional HUD upgrade`

---

## 七、下一步建议（Phase 2 升级路线）

### 优先级 P1（建议 1–2 周内）
1. **接入 UW GEX Profile API**：目前 Gamma Regime 引擎使用 UW 的 `net_gex` 字段，建议接入完整的 GEX Profile 端点以获取每个行权价的 Gamma 敞口分布
2. **ThetaData 接入**：当前 Theta 适配器仍为存根，接入后可获得真实的 0DTE 期权链数据
3. **15 分钟历史窗口缓存**：Flow 加速度计算需要历史数据，建议用 Redis 或内存环形缓冲区存储最近 4 个 15 分钟窗口

### 优先级 P2（建议 2–4 周内）
4. **Telegram 实时推送**：当系统进入狙击状态时，自动推送 Telegram 通知（环境变量已配置）
5. **TradingView Webhook 接收**：利用已配置的 `TRADINGVIEW_WEBHOOK_SECRET` 接收 TradingView 的价格/指标推送
6. **历史回放模式**：添加 `/replay?date=YYYY-MM-DD` 端点，支持复盘历史信号

### 优先级 P3（长期）
7. **多 Symbol 支持**：扩展至 QQQ/IWM/VIX 的同步监控
8. **信号历史数据库**：将每次 `/signals/current` 的输出持久化到 SQLite/PostgreSQL，支持信号质量统计

