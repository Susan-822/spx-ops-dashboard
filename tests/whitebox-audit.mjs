/**
 * SPX 0DTE Command Console — 白盒审计测试套件
 * 覆盖：数据管道清洗、状态机路由、UI 规范验收
 */

import { runMarketRegimeEngine, REGIME } from '../apps/api/decision_engine/algorithms/market-regime-engine.js';
import { FlowRecentQueue } from '../apps/api/scheduler/flow-recent-queue.js';
import { evaluate0dteMicrostructure, buildMicrostructureRead } from '../apps/api/decision_engine/algorithms/microstructure-validation-engine.js';

let passed = 0;
let failed = 0;
const results = [];

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
    results.push({ name, status: 'PASS', detail });
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
    results.push({ name, status: 'FAIL', detail });
  }
}

function warn(name, condition, detail = '') {
  if (!condition) {
    console.warn(`  ⚠️  WARN: ${name}${detail ? ' — ' + detail : ''}`);
    results.push({ name, status: 'WARN', detail });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 阶段一：底层数据管道审计
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  阶段一：底层数据管道审计                              ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// ── 测试用例 1：伪装抛压测试（The Volume Trap Test）──────────────────────────
console.log('【TC-1】伪装抛压测试 — 50 笔订单，Call 总量 $200M 但 90% 砸盘卖出');

// 构造 50 笔 mock flow_recent 数据
// Call 总量 $200M：45 笔 bid_side（Hit the Bid，卖出 Call）+ 5 笔 ask_side
// Put 总量 $10M：10 笔 ask_side（Hit the Ask，买入 Put）
const mockFlowRows = [];
// 45 笔 Call bid_side（机构卖出 Call，看空）
for (let i = 0; i < 45; i++) {
  mockFlowRows.push({
    id: `call-bid-${i}`,
    option_type: 'call',
    tags: ['bid_side'],
    premium: 4_000_000,   // $4M/笔，45笔 = $180M
    underlying_price: 7255,
    strike: 7260,
    expiry: '2026-05-06',
    executed_at: new Date(Date.now() - (50 - i) * 700).toISOString(),
  });
}
// 5 笔 Call ask_side（买入 Call）
for (let i = 0; i < 5; i++) {
  mockFlowRows.push({
    id: `call-ask-${i}`,
    option_type: 'call',
    tags: ['ask_side'],
    premium: 4_000_000,   // $4M/笔，5笔 = $20M
    underlying_price: 7255,
    strike: 7260,
    expiry: '2026-05-06',
    executed_at: new Date(Date.now() - (5 - i) * 700).toISOString(),
  });
}
// 10 笔 Put ask_side（买入 Put，看空）
for (let i = 0; i < 10; i++) {
  mockFlowRows.push({
    id: `put-ask-${i}`,
    option_type: 'put',
    tags: ['ask_side'],
    premium: 1_000_000,   // $1M/笔，10笔 = $10M
    underlying_price: 7255,
    strike: 7250,
    expiry: '2026-05-06',
    executed_at: new Date(Date.now() - (10 - i) * 700).toISOString(),
  });
}

// 通过 microstructure-validation-engine 处理
const msRaw = evaluate0dteMicrostructure({
  flowRecentTicks: mockFlowRows,
  greekRows: [],
  netGex: 173000,
  spotPrice: 7255,
  ifvgBreached: false,
  windowMs: 300_000,
});
const msResult = buildMicrostructureRead(msRaw);

console.log(`  Raw data: Call Total = $200M (90% bid_side), Put Total = $10M (ask_side)`);
console.log(`  true_net_flow_m = ${msResult.true_net_flow_m}`);
console.log(`  flow_direction = ${msResult.flow_direction}`);
console.log(`  tick_count = ${msResult.tick_count}, noise_count = ${msResult.noise_count}`);

// 预期：true_net_flow 应为深负值（Call bid_side 净卖出 $180M - Call ask_side $20M - Put ask_side $10M = -$170M）
assert('TC-1a: true_net_flow 为深负值（< -100M）',
  msResult.true_net_flow_m != null && parseFloat(msResult.true_net_flow_m) < -100,
  `actual=${parseFloat(msResult.true_net_flow_m).toFixed(1)}M`
);
assert('TC-1b: flow_direction 为 BEARISH（不是 BULLISH）',
  msResult.flow_direction === 'BEARISH',
  `actual=${msResult.flow_direction}`
);
assert('TC-1c: tick_count = 60（有效逐笔数，排除无方向噪音）',
  msResult.tick_count === 60,
  `actual=${msResult.tick_count} (raw status=${msRaw.status})`
);

// 关键：验证旧逻辑（总量比较）是否已被剔除
// 如果 microstructure 引擎还在用 callTotal > putTotal 判断多空，这里会暴露
warn('TC-1d: 确认 microstructure 不使用 callTotal/putTotal 比较',
  msResult.flow_direction !== 'BULLISH',
  '若为 BULLISH 说明残留总量陷阱逻辑！'
);

// ── 测试用例 2：内存队列堆叠测试（Queue Stacking Test）──────────────────────
console.log('\n【TC-2】内存队列堆叠测试 — 3 次 API 请求（每次 50 条），验证去重和堆叠');

const queue = new FlowRecentQueue({ maxAge: 300, maxSize: 2000 });

// 第 1 批：50 条，时间戳 t=0 到 t=34.3s（0.7s 间隔）
const batch1 = Array.from({ length: 50 }, (_, i) => ({
  id: `batch1-${i}`,
  option_type: 'call',
  tags: ['ask_side'],
  premium: 100_000,
  underlying_price: 7255,
  executed_at: new Date(Date.now() - 100_000 + i * 700).toISOString(),
}));

// 第 2 批：50 条，与第 1 批有 10 条重叠（overlap 测试）
const batch2 = Array.from({ length: 50 }, (_, i) => ({
  id: i < 10 ? `batch1-${40 + i}` : `batch2-${i - 10}`,  // 前 10 条重复 batch1 的 id
  option_type: 'call',
  tags: ['ask_side'],
  premium: 100_000,
  underlying_price: 7255,
  executed_at: new Date(Date.now() - 65_000 + i * 700).toISOString(),
}));

// 第 3 批：50 条，全新数据
const batch3 = Array.from({ length: 50 }, (_, i) => ({
  id: `batch3-${i}`,
  option_type: 'call',
  tags: ['ask_side'],
  premium: 100_000,
  underlying_price: 7255,
  executed_at: new Date(Date.now() - 30_000 + i * 700).toISOString(),
}));

queue.append(batch1);
const sizeAfterBatch1 = queue.size;
queue.append(batch2);
const sizeAfterBatch2 = queue.size;
queue.append(batch3);
const sizeAfterBatch3 = queue.size;

console.log(`  Batch1: 50 条 → queue size = ${sizeAfterBatch1}`);
console.log(`  Batch2: 50 条（含 10 条重复 id）→ queue size = ${sizeAfterBatch2}`);
console.log(`  Batch3: 50 条（全新）→ queue size = ${sizeAfterBatch3}`);

assert('TC-2a: Batch1 后 queue size = 50',
  sizeAfterBatch1 === 50,
  `actual=${sizeAfterBatch1}`
);
assert('TC-2b: Batch2 后 queue size = 90（去重 10 条重复）',
  sizeAfterBatch2 === 90,
  `actual=${sizeAfterBatch2}`
);
assert('TC-2c: Batch3 后 queue size = 140（全部追加，不覆盖）',
  sizeAfterBatch3 === 140,
  `actual=${sizeAfterBatch3}`
);
assert('TC-2d: 队列不是被后 50 条覆盖（size > 50）',
  sizeAfterBatch3 > 50,
  `actual=${sizeAfterBatch3}`
);

// ═══════════════════════════════════════════════════════════════════════════════
// 阶段二：状态机路由审计
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  阶段二：状态机路由审计                                ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// ── 测试用例 3：最高优先级风控覆盖测试（Priority 1 Override）────────────────
console.log('【TC-3】P1 风控覆盖测试 — 真实净流入 +$50M 但 IFVG 触发');

const tc3Result = runMarketRegimeEngine({
  microstructureRead: {
    true_net_flow_m: 50,       // 极度看多
    flow_direction: 'BULLISH',
    status: 'positive_gamma_buy',
    mm_upside_veto: false,
    upside_charm_m: -100,      // 上方 Charm 适中，不触发 P2
    tick_count: 80,
  },
  gammaRegimeEngine: {
    gamma_regime: 'positive',
    net_gex: 173000,
    zero_gamma_level: 7200,
  },
  priceValidation: {
    spot_now: 7240,
    delta_5m: -8,              // 价格大跌
    ifvg_breached: true,       // IFVG 触发！
    wall_status: 'valid',
  },
  flowBehavior: {
    flow_5m: 50_000_000,
    dual_window_aligned: true,
  },
  dealerWallMap: {
    call_wall: 7300,
    put_wall: 7200,
    gex_local_call_wall: 7260,
    gex_local_put_wall: 7245,
    spot_price: 7240,
  },
  volDashboard: { iv30: 14.4, iv_rank: 31 },
  dealerFactors: { net_gex: 173000 },
  spotPrice: 7240,
});

console.log(`  Input: trueNetFlow=+$50M, ifvgBreached=true, spotNow=7240, localPutWall=7245`);
console.log(`  Output: regime=${tc3Result.regime}, priority=${tc3Result.priority}`);
console.log(`  title: ${tc3Result.title}`);
console.log(`  hard_stop_direction: ${tc3Result.hard_stop_direction}`);
console.log(`  allow_trade: ${tc3Result.allow_trade}`);
console.log(`  force_exit: ${tc3Result.force_exit}`);
console.log(`  debug: ${JSON.stringify(tc3Result.debug)}`);

assert('TC-3a: regime = DEFENSE_COLLAPSE（防线崩溃）',
  tc3Result.regime === REGIME.DEFENSE_COLLAPSE,
  `actual=${tc3Result.regime}`
);
assert('TC-3b: priority = 1（最高优先级覆盖 +$50M 看多信号）',
  tc3Result.priority === 1,
  `actual=${tc3Result.priority}`
);
assert('TC-3c: hard_stop_direction = EXIT（强制平仓，不是做空）',
  tc3Result.hard_stop_direction === 'EXIT',
  `actual=${tc3Result.hard_stop_direction}`
);
assert('TC-3d: allow_trade = false（禁止开仓）',
  tc3Result.allow_trade === false,
  `actual=${tc3Result.allow_trade}`
);
assert('TC-3e: force_exit = true（强制平仓指令）',
  tc3Result.force_exit === true,
  `actual=${tc3Result.force_exit}`
);
// 关键：确保 action 中没有"反手做空"的指令
assert('TC-3f: action 中不包含"做空"/"开空"/"空单"指令',
  !tc3Result.action.includes('做空') && !tc3Result.action.includes('开空') && !tc3Result.action.includes('空单'),
  `action="${tc3Result.action}"`
);

// ── 测试用例 4：逻辑冲突熔断测试（Priority 2 Override）──────────────────────
console.log('\n【TC-4】P2 逻辑冲突熔断测试 — 真实净流入 +$30M 但 Charm 极端负值');

const tc4Result = runMarketRegimeEngine({
  microstructureRead: {
    true_net_flow_m: 30,       // 极度看多
    flow_direction: 'BULLISH',
    status: 'positive_gamma_buy',
    mm_upside_veto: true,      // Charm 否决权触发！
    upside_charm_m: -3_500,    // 极端负 Charm（-3.5M，远超 -500K 阈值）
    tick_count: 80,
  },
  gammaRegimeEngine: {
    gamma_regime: 'positive',
    net_gex: 173000,
    zero_gamma_level: 7200,
  },
  priceValidation: {
    spot_now: 7258,
    delta_5m: 3,               // 价格上涨
    ifvg_breached: false,
    wall_status: 'valid',
  },
  flowBehavior: {
    flow_5m: 30_000_000,
    dual_window_aligned: true,
  },
  dealerWallMap: {
    call_wall: 7300,
    put_wall: 7200,
    gex_local_call_wall: 7260,
    gex_local_put_wall: 7250,
    spot_price: 7258,
  },
  volDashboard: { iv30: 14.4, iv_rank: 31 },
  dealerFactors: { net_gex: 173000 },
  spotPrice: 7258,
});

console.log(`  Input: trueNetFlow=+$30M, mm_upside_veto=true, upsideCharm=-3500M`);
console.log(`  Output: regime=${tc4Result.regime}, priority=${tc4Result.priority}`);
console.log(`  title: ${tc4Result.title}`);
console.log(`  allow_trade: ${tc4Result.allow_trade}`);
console.log(`  force_wait: ${tc4Result.force_wait}`);
console.log(`  debug: ${JSON.stringify(tc4Result.debug)}`);

assert('TC-4a: regime = FLOW_CONFLICT（逻辑冲突/神仙打架）',
  tc4Result.regime === REGIME.FLOW_CONFLICT,
  `actual=${tc4Result.regime}`
);
assert('TC-4b: priority = 2（P2 覆盖 +$30M 看多信号）',
  tc4Result.priority === 2,
  `actual=${tc4Result.priority}`
);
assert('TC-4c: allow_trade = false（禁止开仓）',
  tc4Result.allow_trade === false,
  `actual=${tc4Result.allow_trade}`
);
assert('TC-4d: force_wait = true（强制等待）',
  tc4Result.force_wait === true,
  `actual=${tc4Result.force_wait}`
);
// 关键：确保没有输出 A单预案
assert('TC-4e: 没有 force_long 指令（Charm 否决权生效）',
  !tc4Result.force_long,
  `force_long=${tc4Result.force_long}`
);

// ── 测试用例 5：绞肉机模式触发测试（Grinder Mode）──────────────────────────
console.log('\n【TC-5】绞肉机模式触发测试 — 高 GEX + 资金停滞 + 价格横盘');

const tc5Result = runMarketRegimeEngine({
  microstructureRead: {
    true_net_flow_m: 0.5,      // 资金流停滞
    flow_direction: 'FLAT',
    status: 'positive_gamma_wait',
    mm_upside_veto: false,
    upside_charm_m: -200,
    tick_count: 50,
  },
  gammaRegimeEngine: {
    gamma_regime: 'positive',
    net_gex: 173000,           // 极高正 Gamma
    zero_gamma_level: 7200,
  },
  priceValidation: {
    spot_now: 7252,
    delta_5m: 0.2,             // 价格横盘
    ifvg_breached: false,
    wall_status: 'valid',
  },
  flowBehavior: {
    flow_5m: 500_000,
    dual_window_aligned: false,
  },
  dealerWallMap: {
    call_wall: 7300,
    put_wall: 7200,
    gex_local_call_wall: 7260,
    gex_local_put_wall: 7245,
    spot_price: 7252,
  },
  volDashboard: { iv30: 14.4, iv_rank: 31 },
  dealerFactors: { net_gex: 173000 },
  spotPrice: 7252,
});

console.log(`  Input: trueNetFlow=+$0.5M(停滞), netGex=173K(极高), delta5m=+0.2(横盘)`);
console.log(`  Output: regime=${tc5Result.regime}, priority=${tc5Result.priority}`);
console.log(`  title: ${tc5Result.title}`);
console.log(`  allow_trade: ${tc5Result.allow_trade}`);
console.log(`  debug: ${JSON.stringify(tc5Result.debug)}`);

assert('TC-5a: regime = GRINDER（绞肉机模式）',
  tc5Result.regime === REGIME.GRINDER,
  `actual=${tc5Result.regime}`
);
assert('TC-5b: allow_trade = false（禁止开仓）',
  tc5Result.allow_trade === false,
  `actual=${tc5Result.allow_trade}`
);
assert('TC-5c: title 包含"绞肉机"',
  tc5Result.title && tc5Result.title.includes('绞肉机'),
  `actual="${tc5Result.title}"`
);
assert('TC-5d: action 包含"管住手"或"空仓"',
  tc5Result.action && (tc5Result.action.includes('管住手') || tc5Result.action.includes('空仓')),
  `actual="${tc5Result.action?.substring(0, 40)}..."`
);

// ── 测试用例 6：机构扫货触发测试（Institutional Buy）────────────────────────
console.log('\n【TC-6】机构扫货触发测试 — 真实强多头流 + 无 Charm 否决 + 价格上涨');

const tc6Result = runMarketRegimeEngine({
  microstructureRead: {
    true_net_flow_m: 15,       // 强多头流
    flow_direction: 'BULLISH',
    status: 'positive_gamma_buy',
    mm_upside_veto: false,     // 无 Charm 否决
    upside_charm_m: -100,      // 轻微 Charm，不触发否决
    tick_count: 120,
  },
  gammaRegimeEngine: {
    gamma_regime: 'positive',
    net_gex: 80000,
    zero_gamma_level: 7200,
  },
  priceValidation: {
    spot_now: 7262,
    delta_5m: 5,               // 价格明显上涨
    ifvg_breached: false,
    wall_status: 'valid',
  },
  flowBehavior: {
    flow_5m: 15_000_000,
    dual_window_aligned: true,
  },
  dealerWallMap: {
    call_wall: 7300,
    put_wall: 7200,
    gex_local_call_wall: 7270,
    gex_local_put_wall: 7255,
    spot_price: 7262,
  },
  volDashboard: { iv30: 14.4, iv_rank: 31 },
  dealerFactors: { net_gex: 80000 },
  spotPrice: 7262,
});

console.log(`  Input: trueNetFlow=+$15M, mm_upside_veto=false, delta5m=+5`);
console.log(`  Output: regime=${tc6Result.regime}, priority=${tc6Result.priority}`);
console.log(`  title: ${tc6Result.title}`);
console.log(`  allow_trade: ${tc6Result.allow_trade}`);
console.log(`  force_long: ${tc6Result.force_long}`);

assert('TC-6a: regime = INSTITUTIONAL_BUY（机构扫货）',
  tc6Result.regime === REGIME.INSTITUTIONAL_BUY,
  `actual=${tc6Result.regime}`
);
assert('TC-6b: allow_trade = true（允许开仓）',
  tc6Result.allow_trade === true,
  `actual=${tc6Result.allow_trade}`
);
assert('TC-6c: force_long = true（多头方向）',
  tc6Result.force_long === true,
  `actual=${tc6Result.force_long}`
);

// ═══════════════════════════════════════════════════════════════════════════════
// 阶段三：UI 规范验收（代码层面）
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  阶段三：UI 规范验收（代码层面）                       ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

import { readFileSync } from 'fs';
const appJs = readFileSync('/home/ubuntu/spx-ops-dashboard/apps/web/app.js', 'utf8');
const stylesCss = readFileSync('/home/ubuntu/spx-ops-dashboard/apps/web/styles.css', 'utf8');

// ── 测试用例 7：无图表组件验证 ────────────────────────────────────────────────
console.log('【TC-7】UI 纯文本验证 — 确认无 Chart.js / Canvas 图表组件');

const hasChartJs = appJs.includes('Chart(') || appJs.includes('new Chart') || appJs.includes('chartjs');
const hasCanvas  = (appJs.match(/<canvas/g) || []).length;
const hasD3      = appJs.includes('d3.') || appJs.includes("require('d3')");

console.log(`  Chart.js 实例: ${hasChartJs ? '⚠️ 存在' : '✅ 无'}`);
console.log(`  <canvas> 元素: ${hasCanvas} 个`);
console.log(`  D3.js 引用: ${hasD3 ? '⚠️ 存在' : '✅ 无'}`);

assert('TC-7a: 无 Chart.js 图表实例',
  !hasChartJs,
  'Chart.js 图表会破坏纯文本 White Glass 风格'
);
assert('TC-7b: 无 D3.js 引用',
  !hasD3,
  'D3.js 会引入复杂可视化组件'
);

// ── 测试用例 8：White Glass 风格验证 ─────────────────────────────────────────
console.log('\n【TC-8】White Glass Lab 风格验证 — 确认无暗黑主题残留');

const hasDarkTheme = stylesCss.includes('background: #0') || 
                     stylesCss.includes('background:#0') ||
                     stylesCss.includes('background-color: #0') ||
                     stylesCss.includes('color: #0f0') ||   // 骇客绿
                     stylesCss.includes('color:#0f0');
const hasWhiteGlass = stylesCss.includes('rgba(255, 255, 255') || 
                      stylesCss.includes('rgba(255,255,255') ||
                      stylesCss.includes('#ffffff') ||
                      stylesCss.includes('white');

console.log(`  暗黑主题残留: ${hasDarkTheme ? '⚠️ 存在' : '✅ 无'}`);
console.log(`  White Glass 样式: ${hasWhiteGlass ? '✅ 存在' : '⚠️ 缺失'}`);

assert('TC-8a: 无暗黑/骇客主题 CSS 残留',
  !hasDarkTheme,
  '检测到暗色背景或骇客绿色'
);
assert('TC-8b: White Glass 风格样式存在',
  hasWhiteGlass,
  '缺少白色/透明玻璃样式'
);

// ── 测试用例 9：market_regime_read 渲染代码存在 ───────────────────────────────
console.log('\n【TC-9】market_regime_read 前端渲染代码验证');

const hasRegimeRender = appJs.includes('market_regime_read') || appJs.includes('regime_read');
const hasNarrCard     = appJs.includes('narr-regime-title') || appJs.includes('narr-critical');
const hasTrueFlow     = appJs.includes('true_flow_fmt') || appJs.includes('trueFlow');
const hasAlgoWall     = appJs.includes('algo_resistance') || appJs.includes('algo-wall');
const hasHardStop     = appJs.includes('hard_stop') || appJs.includes('hardStop');

console.log(`  market_regime_read 渲染: ${hasRegimeRender ? '✅' : '❌'}`);
console.log(`  narr-regime-title CSS 类: ${hasNarrCard ? '✅' : '❌'}`);
console.log(`  true_flow_fmt 渲染: ${hasTrueFlow ? '✅' : '❌'}`);
console.log(`  algo_resistance/algo-wall 渲染: ${hasAlgoWall ? '✅' : '❌'}`);
console.log(`  hard_stop 渲染: ${hasHardStop ? '✅' : '❌'}`);

assert('TC-9a: market_regime_read 渲染代码存在',
  hasRegimeRender,
  '前端未接入 market_regime_read'
);
assert('TC-9b: narr-regime-title CSS 类存在',
  hasNarrCard,
  '缺少状态机标题样式'
);
assert('TC-9c: true_flow_fmt 渲染代码存在',
  hasTrueFlow,
  '前端未显示真实净流向'
);
assert('TC-9d: algo_resistance/algo-wall 渲染代码存在',
  hasAlgoWall,
  '前端未显示机器盖子/垫子'
);
assert('TC-9e: hard_stop 渲染代码存在',
  hasHardStop,
  '前端未显示绝对风控红线'
);

// ═══════════════════════════════════════════════════════════════════════════════
// 总结
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  审计总结                                              ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

console.log(`  总计: ${passed + failed} 个测试用例`);
console.log(`  ✅ PASS: ${passed}`);
console.log(`  ❌ FAIL: ${failed}`);

const failedTests = results.filter(r => r.status === 'FAIL');
if (failedTests.length > 0) {
  console.log('\n  需要修复的问题：');
  failedTests.forEach(t => console.log(`    - ${t.name}: ${t.detail}`));
}

const warnTests = results.filter(r => r.status === 'WARN');
if (warnTests.length > 0) {
  console.log('\n  警告（需关注）：');
  warnTests.forEach(t => console.log(`    ⚠️ ${t.name}: ${t.detail}`));
}

process.exit(failed > 0 ? 1 : 0);
