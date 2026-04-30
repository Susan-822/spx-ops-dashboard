# SPX Ops Dashboard — 生产级七层全链路审计报告

**审计日期**：2026-04-30  
**生产地址**：https://spxopslab.onrender.com  
**生产 build_sha**：`a4febcb460321a89f1255a6a948cc7f022920db2`  
**GitHub main HEAD**：`a4febcb` ✅ 一致  
**审计结论**：系统已完成 L2.5 框架搭建，但尚未进入"真正的盘中执行指挥台"状态。核心瓶颈是 **UW API 真实数据流尚未激活**，导致所有依赖 UW 的算法层（Gamma Regime、Flow 四分类、A/B 单）在生产环境中以降级/等待状态运行。

---

## 第一层：真实数据接入层

### FMP 数据接入

| 项目 | 状态 | 证据 |
|------|------|------|
| FMP API Key | ✅ 已配置 | Render 环境变量 `FMP_API_KEY` 已设置 |
| SPX 现价抓取 | ✅ 真实 HTTP | `apps/api/adapters/fmp/real.js:6` — `FMP_INTRADAY_URL` 真实 fetch |
| VIX 抓取 | ✅ 真实 HTTP | `volatility-engine.js:42` — `https://financialmodelingprep.com/api/v3/quote/%5EVIX` |
| HV20 计算 | ✅ 内存计算 | `volatility-engine.js:_priceHistory[]` 环形缓冲，每次 FMP 价格推入后计算 |
| FMP 降级保护 | ✅ 已实现 | `fmp/index.js` — FMP 失败时返回 `spot_is_real: false`，触发执行门控 |

### UW 数据接入

| 项目 | 状态 | 证据 |
|------|------|------|
| UW API Key | ✅ 已配置 | Render 环境变量 `UW_API_KEY` 已设置 |
| UW_PROVIDER_MODE | **⚠ 待确认** | `uw-api-provider.js:112` — `process.env.UW_PROVIDER_MODE \|\| 'unavailable'`；若 Render 未设置此变量则默认 `unavailable` |
| UW 真实 HTTP fetch | ✅ 已实现 | `uw-api-provider.js:548` — 完整的 `fetch(url, { headers: { Authorization: Bearer } })` 实现 |
| UW adapter `real.js` | ❌ **Stub** | `adapters/uw/real.js` — 仅返回 `available: false`，是一个空骨架，**不参与数据流** |
| UW 实际数据通路 | ✅ 通过 provider | 真实数据通过 `uw-api-provider.js` 的 `fetchUwApiSnapshot()` 获取，不经过 `adapters/uw/real.js` |
| UW 端点覆盖 | ✅ 完整定义 | `UW_API_ENDPOINTS` 定义了 43 个端点，含 `spot_gex`、`options_flow`、`net_prem_ticks`、`darkpool_spy`、`market_tide`、`interpolated_iv` 等 |

### 关键发现：UW_PROVIDER_MODE 环境变量

`uw-api-provider.js:112`：
```js
mode: String(process.env.UW_PROVIDER_MODE || 'unavailable').toLowerCase()
```

**若 Render 的 `UW_PROVIDER_MODE` 未设置为 `api`，系统将以 `unavailable` 模式运行，所有 UW 数据均为空。** 这是当前系统最大的单点风险。

---

## 第二层：数据标准化层

### UW 原始字段 → normalized JSON 映射表

| 原始端点 | normalizer 函数 | 输出字段 | 状态 |
|---------|----------------|---------|------|
| `options_flow` + `flow_recent` + `net_prem_ticks` | `normalizeFlow()` | `call_premium_5m`、`put_premium_5m`、`net_premium_5m`、`call_put_ratio` | ✅ 正确 |
| `spot_gex` | `normalizeDealer()` | `net_gex`、`call_wall`、`put_wall`、`gamma_flip` | ✅ 正确 |
| `spot_gex` | `normalizeDealer()` | `vanna`、`charm`、`delta` | ✅ 字段存在 |
| `darkpool_spy` + `darkpool_spx` | `normalizeDarkpool()` | `levels[]`（price, premium, side） | ✅ 正确 |
| `market_tide` | `normalizeSentiment()` | `net_flow`、`call_flow`、`put_flow` | ✅ 正确 |
| `interpolated_iv` + `iv_rank` | `normalizeVolatility()` | `iv30`、`iv_rank` | ✅ 正确 |

### 关键字段名不一致（P1 问题）

| 问题 | 位置 | 说明 |
|------|------|------|
| `call_put_ratio` vs `put_call_ratio` | `normalizer/uw-api-normalizer.js:145` | normalizer 输出 `call_put_ratio`（Call/Put），但 `flow-behavior-engine` 期望 `put_call_ratio`（Put/Call）。`current-signal.js:2113` 通过手动计算 `put/call` 转换，**逻辑正确但绕了一圈** |
| `net_premium_5m` 字段 | `normalizer/uw-api-normalizer.js:137` | 字段名含 `_5m` 后缀，但实际是全量累计，非 5 分钟窗口 |

---

## 第三层：算法层

### 已实现的算法

| 算法 | 文件 | 完整性 | 说明 |
|------|------|--------|------|
| ATM 识别 | `algorithms/atm-engine.js` | ✅ 完整 | ATM 行权价、趋势、pin_risk 0–100、磁吸中轴 |
| Gamma Regime | `algorithms/gamma-regime-engine.js` | ✅ 完整 | positive/negative/transitional/unknown，含 spot_position 五分类 |
| Flow 四分类 | `algorithms/flow-behavior-engine.js` | ✅ 完整 | put_effective/put_squeezed/call_effective/call_capped + P/C 极值 |
| 暗盘行为 | `algorithms/darkpool-behavior-engine.js` | ✅ 完整 | SPY×10 坐标映射、聚类、承接/派发/突破/破位四分类 |
| A/B 单生成 | `algorithms/ab-order-engine.js` | ✅ 完整 | 六行操盘语言格式，4 种预案（Long Call/Put/Bull Put Spread/Bear Call Spread） |
| 波动率仪表盘 | `algorithms/volatility-engine.js` | ✅ 完整 | VIX/IV30/HV20/Vscore/IV-HV 比率，FMP 真实 HTTP |
| 15分钟加速度 | `algorithms/premium-acceleration-queue.js` | ✅ 完整 | 服务器端环形队列，T-T15 差值，加速度比率 |
| Dealer Wall | `algorithms/dealer-wall-engine.js` | ✅ 已有 | Call Wall/Put Wall/Gamma Flip 计算 |
| Flow-Price 背离 | `rules/divergence-rules.js` | ⚠ 部分 | 仅检测 `tvSentinel` 方向与 UW flow_bias 的冲突，**未检测"价格不涨但 Net Premium 正"的纯价格-流量背离** |
| Charm/Vanna 压力引擎 | 无独立文件 | ❌ **缺失** | `vanna_charm_bias` 字段存在于 `dealer-conclusion-engine.js`，但无独立的 Charm/Vanna 压力判断引擎 |

### 算法数据依赖问题

所有 L2.5 算法（ATM、Gamma Regime、Flow、DarkPool、A/B 单）的输入均来自 `uwApi.uw_factors`。**若 `UW_PROVIDER_MODE` 不为 `api`，所有算法输入为 null，输出为 `unknown`/`WAIT` 状态。**

---

## 第四层：反射逻辑层

| 场景 | 是否实现 | 实现位置 | 说明 |
|------|---------|---------|------|
| Put 高但价格不跌 = Put 被绞 | ✅ | `flow-behavior-engine.js:65` | 检测 `nearPutWall \|\| darkpoolBraking \|\| positiveGamma` |
| Call 高但价格不涨 = Call 被压 | ✅ | `flow-behavior-engine.js:85` | 检测 `nearCallWall` |
| 暗盘放大但价格继续跌 = 承接失败 | ❌ **未实现** | 无 | `darkpool-behavior-engine.js` 只做静态行为分类，无动态价格验证 |
| 正 Gamma + ATM 附近 = 禁做 0DTE | ✅ | `ab-order-engine.js:197` | `pin_risk >= 70` 触发 `pinWarning` 字符串 |
| Net Premium 正但价格不涨 = Call 被压 | ⚠ 部分 | `flow-behavior-engine.js:85` | 只检测 `nearCallWall`，未检测"价格不涨"的动态条件 |
| Flow-Price 背离（量价背离） | ⚠ 部分 | `rules/divergence-rules.js` | 依赖 `tvSentinel`，无 TV 信号时无法触发 |
| P/C > 1.5 = 散户极端恐慌（反向信号） | ✅ | `flow-behavior-engine.js:199` | `pc_extreme` 对象，含 `extreme_bearish` 标签 |
| P/C < 0.5 = 散户极端贪婪（反向信号） | ✅ | `flow-behavior-engine.js:204` | `extreme_bullish` 标签 |
| 负 Gamma 放波 + ATM 附近 = 双向风险 | ✅ | `gamma-regime-engine.js:189` | `negative` regime + `break_risk_score` |
| 暗盘承接 + Flow 转多 = 底部确认 | ⚠ 部分 | `ab-order-engine.js:87` | `darkpool_context.behavior === 'support'` 加入 Plan A 描述，但无独立的"底部三级确认"逻辑 |

**反射逻辑总评**：4/10 完整实现，4/10 部分实现，2/10 未实现。最大缺口是**动态价格验证**（需要价格历史缓冲区来判断"价格不涨/不跌"）。

---

## 第五层：指令层

### `/signals/current` 输出字段覆盖率

| 要求字段 | 实际字段路径 | 状态 |
|---------|------------|------|
| 当前盘型 | `gamma_regime_engine.gamma_regime` + `gamma_regime_engine.action_cn` | ✅ |
| 盘眼/ATM | `atm_engine.atm`、`atm_engine.atm_trend` | ✅ |
| 资金行为 | `flow_behavior_engine.behavior_cn`、`flow_behavior_engine.reason` | ✅ |
| 做市商路径 | `gamma_regime_engine.maker_mode`、`gamma_regime_engine.maker_mode_cn` | ✅ |
| 15分钟加速度 | `flow_behavior_engine.acceleration.delta_label` | ✅ |
| 现在 | `ab_order_engine.plan_a.action_now` | ✅ |
| 等多 | `ab_order_engine.plan_a.wait_long` | ✅ |
| 等空 | `ab_order_engine.plan_a.wait_short` | ✅ |
| 禁做 | `ab_order_engine.plan_a.forbidden` | ✅ |
| 失效 | `ab_order_engine.plan_a.invalidation` | ✅ |
| 目标 | `ab_order_engine.plan_a.tp1`、`tp2` | ✅ |
| Plan A | `ab_order_engine.plan_a` | ✅ |
| Plan B | `ab_order_engine.plan_b` | ✅ |
| 一句话总指令 | `ab_order_engine.headline` | ✅ |
| 暗盘背景 | `ab_order_engine.darkpool_context` | ✅ |
| 波动率仪表盘 | `volatility_dashboard.vix`、`vscore`、`regime` | ✅ |
| GEX Profile（全链） | **❌ 缺失** | 只有 `dealer_wall_map.call_wall/put_wall/gamma_flip` 单值，无完整行权价 GEX 分布 |
| Charm/Vanna 压力量化 | **⚠ 部分** | `uw_factors.dealer_factors.vanna_charm_bias` 存在，但无独立量化输出 |

**指令层总评**：13/15 字段完整，2 项缺失（GEX Profile 全链、Charm/Vanna 独立量化）。

---

## 第六层：前端 UI 映射层

### UI 区块 → JSON 字段映射表

| UI 区块 | 读取的 JSON 字段 | 映射方式 | 状态 |
|---------|----------------|---------|------|
| 顶部指令条（Top Command Strip） | `ab_order_engine.headline`、`ab_order_engine.status` | `renderTopCommandStrip(signal)` | ✅ 直接读取 |
| 价格条（Price Strip） | `spot_conclusion.spot`、`price_sources` | `renderHudPriceStrip(signal)` | ✅ 直接读取 |
| Zone 01 Gamma 战场 | `signal.gamma_regime_engine`、`signal.atm_engine` | `renderHudZoneGamma(signal)` L1329 | ✅ 直接读取 |
| Zone 02 执行边界 | `signal.gamma_regime_engine`、`signal.darkpool_behavior_engine` | `renderHudZoneExecution(signal)` L1397 | ✅ 直接读取 |
| Zone 03 资金 X-Ray | `signal.flow_behavior_engine`、`fb.acceleration` | `renderHudZoneFlow(signal)` L1533 | ✅ 直接读取 |
| Zone 03 情绪条 | `signal.flow_behavior_engine.behavior`、`fb.pc_extreme` | `renderSentimentBar(signal)` | ✅ 直接读取 |
| Zone 04 指令生成器 | `signal.ab_order_engine.plan_a`、`plan_b` | `renderHudZoneCommand(signal)` L1606 | ✅ 直接读取 |
| Zone 05 波动率仪表盘 | `signal.volatility_dashboard` | `renderVolatilityDashboard(signal)` L1821 | ✅ 直接读取 |

### 关键发现：`pickHomepageSignal` 未传递 L2.5 字段

`app.js:121` 的 `pickHomepageSignal()` 函数**不包含** `gamma_regime_engine`、`atm_engine`、`flow_behavior_engine`、`ab_order_engine`、`darkpool_behavior_engine`、`volatility_dashboard` 等字段。

**但这不是 Bug**：`renderHudPanel(signal)` 在 L1907 接收的是**原始 `signal`**（`loadSignal()` 直接返回的 `/signals/current` 完整 JSON），而非 `homepageState()` 处理后的 `home` 对象。`homepageState()` 只用于旧版兼容逻辑（L971）。

**结论**：前端 HUD 四大战区直接读取原始 API 响应，字段映射正确。

---

## 第七层：部署层

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 生产 `/health` 可达 | ✅ HTTP 200 | `{"ok":true,"service":"spx-ops-dashboard-api","mode":"live"}` |
| `is_mock` | ✅ `false` | `/health` 返回 `"is_mock": false` |
| `build_sha` | ✅ `a4febcb` | 与 GitHub `origin/main` HEAD 完全一致 |
| `git_commit` | ✅ `a4febcb` | 同上 |
| 部署分支 | ✅ `main` | Render 配置为 `Susan-822/spx-ops-dashboard` main 分支 |
| 本地 HEAD | ✅ `a4febcb` | `git log --oneline -1` 确认 |
| Auto-Deploy | ✅ 开启 | 每次 push main 自动触发 |
| 服务类型 | ⚠ Free tier | Render Free — 15 分钟无请求后休眠，**冷启动约 30-60 秒**，影响盘中实时性 |

---

## 总评

### 【总评】

系统已完成 L2.5 框架的完整搭建，代码架构清晰，算法逻辑正确，前端 HUD 映射无误，部署状态健康。**但系统当前不能作为"真正的盘中执行指挥台"使用**，原因是：

1. **UW_PROVIDER_MODE 环境变量状态未知**：若未设置为 `api`，所有 UW 数据为空，所有算法以降级状态运行
2. **Render Free Tier 冷启动问题**：15 分钟无请求后休眠，盘中首次访问有 30-60 秒延迟
3. **两项反射逻辑未实现**：暗盘承接失败验证、动态价格-流量背离检测

---

### 【真实数据完成/缺失/错误】

- ✅ **完成**：FMP SPX 现价（真实 HTTP）、FMP VIX（真实 HTTP）、UW 43 个端点定义完整
- ❌ **缺失**：`UW_PROVIDER_MODE=api` 状态未确认；`adapters/uw/real.js` 是空 stub（但不影响数据流）
- ⚠ **风险**：HV20 依赖内存价格历史，服务重启后需重新积累 20 个数据点（约 40 秒）

---

### 【算法完成/缺失/错误】

- ✅ **完成**：ATM 识别、Gamma Regime、Flow 四分类、暗盘行为四分类、A/B 单六行格式、波动率仪表盘、15 分钟加速度队列
- ❌ **缺失**：独立的 Charm/Vanna 压力引擎；GEX Profile 全链热力图（只有单值 Call/Put Wall）
- ⚠ **部分**：`call_put_ratio` vs `put_call_ratio` 字段名绕行计算（逻辑正确，但代码可读性差）

---

### 【反射逻辑完成/缺失/错误】

- ✅ **完成**（4/10）：Put 被绞、Call 被压、P/C 极值反向信号、正 Gamma 禁做 0DTE
- ⚠ **部分**（4/10）：Flow-Price 背离（依赖 TV Sentinel）、底部承接确认（静态描述）、Call 被压动态验证
- ❌ **缺失**（2/10）：暗盘承接失败动态验证、价格不涨/不跌的动态判断（需价格历史缓冲区）

---

### 【A/B 单完成/缺失/错误】

- ✅ **完成**：六行操盘语言（现在/等多/等空/禁做/失效/目标）、四种预案（Long Call/Put/Bull Put Spread/Bear Call Spread）、暗盘背景集成、do_not 四条铁律
- ❌ **缺失**：当 UW 数据不可用时，A/B 单退化为 `WAIT` 预案，无法生成有效指令

---

### 【UI 映射完成/缺失/错误】

- ✅ **完成**：所有 HUD 区块直接读取 `/signals/current` 原始 JSON，无硬编码文本
- ⚠ **注意**：`pickHomepageSignal()` 未包含 L2.5 字段，但 HUD 渲染函数绕过了它，直接使用原始 signal

---

### 【部署完成/缺失/错误】

- ✅ **完成**：build_sha 与 main HEAD 一致，is_mock=false，Auto-Deploy 开启
- ❌ **缺失**：Render Free Tier 冷启动问题（盘中实战需升级到 Starter 或以上）

---

## P0 必须修复（影响系统能否运行）

| 优先级 | 问题 | 修复方案 | 文件 |
|--------|------|---------|------|
| **P0-1** | 确认 `UW_PROVIDER_MODE=api` 是否在 Render 中正确设置 | 在 Render Dashboard → Environment 中确认 `UW_PROVIDER_MODE` 值为 `api` | Render 环境变量 |
| **P0-2** | Render Free Tier 冷启动导致盘中首次访问 30-60 秒延迟 | 升级到 Render Starter ($7/月) 或使用 UptimeRobot 每 5 分钟 ping 一次保持唤醒 | Render 配置 |

---

## P1 下一步（影响系统质量）

| 优先级 | 问题 | 修复方案 |
|--------|------|---------|
| **P1-1** | 暗盘承接失败动态验证缺失 | 在 `darkpool-behavior-engine.js` 中引入价格历史缓冲区，检测"暗盘 support 但价格继续跌 > 5 点"触发 `absorption_failed` |
| **P1-2** | GEX Profile 全链缺失 | 接入 UW `spot_gex_strike_expiry` 端点，构建每个行权价的 GEX 热力图 |
| **P1-3** | `call_put_ratio` 字段名绕行 | 在 `normalizer/uw-api-normalizer.js` 中同时输出 `put_call_ratio`（put/call），消除 `current-signal.js` 中的手动转换 |
| **P1-4** | Charm/Vanna 独立压力引擎 | 新建 `charm-vanna-engine.js`，基于 `dealer_factors.vanna`/`charm` 计算日内 delta hedging 压力方向 |

---

## P2 后续优化

| 优先级 | 问题 | 修复方案 |
|--------|------|---------|
| **P2-1** | Telegram 推送未激活 | 环境变量已配置，在 `ab-order-engine` 输出 `status=ready` 且 `execution_confidence >= 70` 时调用 Telegram Bot API |
| **P2-2** | TradingView Webhook 备援 | 接入 `TRADINGVIEW_WEBHOOK_SECRET`，作为 SPX 价格的第二来源，消除 FMP 单点故障 |
| **P2-3** | HV20 冷启动问题 | 在服务启动时从 FMP 拉取最近 25 天的 SPX 日线数据预填充 `_priceHistory`，消除冷启动后 HV20 为 null 的问题 |

---

## 是否可实盘参考

**当前状态：不可实盘参考。**

原因：
1. `UW_PROVIDER_MODE` 状态未确认，若为 `unavailable`，所有 UW 算法输出为 null/unknown
2. 即使 UW 已接入，反射逻辑层仍有 2 项关键场景（暗盘承接失败、动态价格背离）未实现
3. Render Free Tier 冷启动问题在盘中会导致数据延迟

**达到可参考状态需要完成**：P0-1（确认 UW_PROVIDER_MODE）+ P0-2（解决冷启动）+ P1-1（暗盘承接失败验证）。预计工作量：2-4 小时。
