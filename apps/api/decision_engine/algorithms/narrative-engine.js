/**
 * narrative-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 纯规则引擎（零 Token 成本）：优先级决策树 + 模板渲染
 * 输出三段连贯中文叙事，替代碎片化的机器标签展示。
 *
 * 架构：
 *   Step 1: 从 signal 中提取关键数值，打标签（Tagging）
 *   Step 2: 优先级决策树，选出"最重要的一个故事"（Priority Selector）
 *   Step 3: 模板渲染，输出三板块人话（Template Rendering）
 *     - 板块A：一句话盘面定调（headline）
 *     - 板块B：底层数据揭秘（detail，带数据填充）
 *     - 板块C：执行预案 + 失效条件（action_plan）
 *
 * 优先级（从高到低）：
 *   P1: ABSORPTION_PUT / ABSORPTION_CALL（做市商吸收，最致命）
 *   P2: TRUE_BEAR / TRUE_BULL（真实破位）
 *   P3: BULL_DIVERGENCE / BEAR_DIVERGENCE（大资金 vs 散户背离）
 *   P4: FLOW_CONFLICT（高频数据打架）
 *   P5: HEAVY_OUTFLOW / HEAVY_INFLOW（资金大出血/大爆发）
 *   P6: POSITIVE_GAMMA_SQUEEZE（正 Gamma 磁吸）
 *   P7: NEUTRAL（无明显趋势）
 */

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function _num(v) { return (v != null && !isNaN(Number(v))) ? Number(v) : null; }
function _fmt(v, fallback = '--') { return v != null ? String(v) : fallback; }

// ── Step 1: 打标签 ────────────────────────────────────────────────────────────
function tagSignal(signal) {
  const cf   = ((signal.home_view_model || {}).order_plan || {}).capital_flow || {};
  const pp   = ((signal.home_view_model || {}).order_plan || {}).primary_plan || {};
  const hvm  = signal.home_view_model || {};
  const dwm  = signal.dealer_wall_map || {};
  const fb   = signal.flow_behavior_engine || {};

  // 提取关键数值
  const divType      = cf.divergence_type   || '';
  const mktLabel     = cf.market_summary_label || 'NEUTRAL';
  const pcPremRatio  = _num(cf.pc_prem_put_over_call);   // Put/Call 资金比
  const pcVolRatio   = _num(cf.pc_volume_ratio);
  const callPrem     = cf.day_call   || '--';
  const putPrem      = cf.day_put    || '--';
  const netPrem      = cf.day_net    || '--';
  const flow5m       = cf.flow_5m    || '--';
  const flow15m      = cf.flow_15m   || '--';
  const winStatus    = cf.window_status || '';
  const gammaState   = cf.gamma_state   || '';
  const tradeGate    = cf.trade_gate    || 'DEGRADED';
  const planSide     = pp.side          || '';
  const planState    = pp.plan_state    || '';
  const planEntry    = pp.entry;
  const planStop     = pp.stop;
  const planConfirm  = pp.confirm;
  const planTarget1  = pp.target_1;
  const blockedReason= pp.blocked_reason || '';
  const spotPrice    = dwm.spot_price    || fb.spot_price || null;
  const putWall      = dwm.gex_local_put_wall  || dwm.put_wall  || null;
  const callWall     = dwm.gex_local_call_wall || dwm.call_wall || null;
  const invalLine    = cf.invalidation_price_line || null;
  const mainStatus   = hvm.main_status || hvm.status || '';

  // 打标签
  const tags = [];

  // P1: 做市商吸收（最致命）
  if (divType === 'PUT_ABSORBED' || mktLabel === 'ABSORPTION') {
    tags.push('ABSORPTION_PUT');
  }
  if (divType === 'CALL_CAPPED' || mktLabel === 'DISTRIBUTION') {
    tags.push('ABSORPTION_CALL');
  }

  // P2: 真实破位（价格已经跌破/突破关键位）
  // 判断：资金比 > 3 且价格已跌破 putWall
  if (pcPremRatio != null && pcPremRatio > 3 && spotPrice != null && putWall != null && spotPrice < putWall - 5) {
    tags.push('TRUE_BEAR');
  }
  if (pcPremRatio != null && pcPremRatio < 0.5 && spotPrice != null && callWall != null && spotPrice > callWall + 5) {
    tags.push('TRUE_BULL');
  }

  // P3: 大资金 vs 散户背离
  if (divType === 'BULL_DIVERGENCE') tags.push('BULL_DIVERGENCE');
  if (divType === 'BEAR_DIVERGENCE') tags.push('BEAR_DIVERGENCE');
  if (divType === 'QUIET_BULL')      tags.push('QUIET_BULL');
  if (divType === 'QUIET_BEAR')      tags.push('QUIET_BEAR');

  // P4: 高频数据打架
  if (winStatus === 'CONFLICT') tags.push('FLOW_CONFLICT');

  // P5: 资金大出血/大爆发（净权利金绝对值极大）
  const netPremNum = _num(String(netPrem).replace(/[^0-9.-]/g, ''));
  if (netPremNum != null && netPremNum < -50) tags.push('HEAVY_OUTFLOW');
  if (netPremNum != null && netPremNum > 50)  tags.push('HEAVY_INFLOW');

  // P6: 正 Gamma 磁吸
  if (gammaState === 'POSITIVE') tags.push('POSITIVE_GAMMA_SQUEEZE');

  // 多空共识
  if (mktLabel === 'CONSENSUS_BULL') tags.push('CONSENSUS_BULL');
  if (mktLabel === 'CONSENSUS_BEAR') tags.push('CONSENSUS_BEAR');

  return {
    tags, divType, mktLabel, pcPremRatio, pcVolRatio,
    callPrem, putPrem, netPrem, flow5m, flow15m,
    winStatus, gammaState, tradeGate, planSide, planState,
    planEntry, planStop, planConfirm, planTarget1,
    blockedReason, spotPrice, putWall, callWall,
    invalLine, mainStatus
  };
}

// ── Step 2: 优先级决策树 ──────────────────────────────────────────────────────
function selectPrimaryNarrative(tags) {
  const P = [
    'ABSORPTION_PUT', 'ABSORPTION_CALL',   // P1
    'TRUE_BEAR', 'TRUE_BULL',              // P2
    'BULL_DIVERGENCE', 'BEAR_DIVERGENCE',  // P3
    'QUIET_BULL', 'QUIET_BEAR',            // P3b
    'FLOW_CONFLICT',                       // P4
    'HEAVY_OUTFLOW', 'HEAVY_INFLOW',       // P5
    'POSITIVE_GAMMA_SQUEEZE',              // P6
    'CONSENSUS_BULL', 'CONSENSUS_BEAR',    // P7
  ];
  for (const p of P) {
    if (tags.includes(p)) return p;
  }
  return 'NEUTRAL';
}

// ── Step 3: 模板渲染 ──────────────────────────────────────────────────────────
function renderNarrative(primaryNarrative, ctx) {
  const {
    pcPremRatio, pcVolRatio, callPrem, putPrem, netPrem,
    flow5m, flow15m, winStatus, gammaState,
    tradeGate, planSide, planState, planEntry, planStop,
    planConfirm, planTarget1, blockedReason, spotPrice,
    putWall, callWall, invalLine
  } = ctx;

  const ratioStr  = pcPremRatio != null ? `${Number(pcPremRatio).toFixed(1)}x` : '--';
  const pcVolStr  = pcVolRatio  != null ? Number(pcVolRatio).toFixed(2) : '--';
  const entryStr  = planEntry   != null ? String(planEntry)  : '--';
  const stopStr   = planStop    != null ? String(planStop)   : '--';
  const confirmStr= planConfirm != null ? String(planConfirm): '--';
  const target1Str= planTarget1 != null ? String(planTarget1): '--';
  const spotStr   = spotPrice   != null ? Number(spotPrice).toFixed(2) : '--';
  const putWallStr= putWall     != null ? String(putWall)    : '--';
  const callWallStr=callWall    != null ? String(callWall)   : '--';

  // 执行预案通用文本
  const execPlan = _buildExecPlan(tradeGate, planSide, planState, entryStr, confirmStr, stopStr, target1Str, blockedReason);

  // 失效条件
  const invalText = invalLine
    ? `⊗ 认错条件：${invalLine}`
    : (planStop ? `⊗ 认错条件：实体 K 线跌破并站稳 ${planStop}，多头逻辑失效` : '');

  switch (primaryNarrative) {

    // ── P1a: 诱空陷阱（做市商承接空头）──────────────────────────────────────
    case 'ABSORPTION_PUT': return {
      tone:       'warning',
      headline:   `⚠️ 诱空陷阱：看跌资金是看涨的 ${ratioStr}，但做市商在底部死扛`,
      detail:     `当前看跌期权的资金规模高达 ${putPrem}，是看涨资金（${callPrem}）的 ${ratioStr}。` +
                  `按人数看，量比也有 ${pcVolStr}，市场情绪极度偏空。` +
                  `但关键是：价格守住了 ${putWallStr} 附近没有跌破，说明做市商正在底部被动承接这波空头砸盘。` +
                  `这是典型的"诱空陷阱"——表面上空头在发力，实际上每一笔 Put 都被做市商的对冲买盘吸收了。` +
                  `当前位置（${spotStr}）严禁追空！`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'warning',
    };

    // ── P1b: 诱多陷阱（做市商承接多头）──────────────────────────────────────
    case 'ABSORPTION_CALL': return {
      tone:       'warning',
      headline:   `⚠️ 诱多陷阱：看涨资金偏重，但做市商在顶部压制`,
      detail:     `当前看涨期权的资金规模 ${callPrem} 偏重，市场情绪偏多。` +
                  `但价格在 ${callWallStr} 附近涨不上去，说明上方有大量做市商卖盘在对冲。` +
                  `这是"诱多陷阱"——多头资金被顶部压制，每一笔 Call 都被做市商的对冲卖盘吸收。` +
                  `当前位置（${spotStr}）严禁追多！`,
      action_plan: execPlan,
      invalidation: invalLine
        ? `⊗ 认错条件：${invalLine}`
        : `⊗ 认错条件：实体 K 线突破并站稳 ${callWallStr}，空头逻辑失效`,
      color:      'warning',
    };

    // ── P2a: 真实破位（空头）────────────────────────────────────────────────
    case 'TRUE_BEAR': return {
      tone:       'bearish',
      headline:   `📉 真实破位：空头资金砸盘，防线已失守`,
      detail:     `净权利金大幅流出（${netPrem}），看跌资金 ${putPrem} 是看涨资金 ${callPrem} 的 ${ratioStr}。` +
                  `更关键的是：价格已经跌破了做市商的关键支撑位 ${putWallStr}，说明做市商放弃了抵抗，` +
                  `之前的"吸收"已经转化为真实下跌。短线资金（5m: ${flow5m}，15m: ${flow15m}）也在印证这个方向。`,
      action_plan: `当前为真实破位行情，顺势思路。等待反弹到前支撑（${putWallStr} 附近）确认变阻力后，可考虑逢高做空。切勿在此处接飞刀抄底。`,
      invalidation: `⊗ 认错条件：价格重新站回 ${putWallStr} 以上并收盘，说明破位失败，空头逻辑失效。`,
      color:      'bearish',
    };

    // ── P2b: 真实突破（多头）────────────────────────────────────────────────
    case 'TRUE_BULL': return {
      tone:       'bullish',
      headline:   `📈 真实突破：多头资金推升，阻力已被突破`,
      detail:     `看涨期权资金 ${callPrem} 偏重，净权利金流入（${netPrem}）。` +
                  `价格已经突破了做市商的关键阻力位 ${callWallStr}，说明做市商的压制被突破，` +
                  `上方空间打开。短线资金（5m: ${flow5m}，15m: ${flow15m}）同向确认。`,
      action_plan: execPlan,
      invalidation: `⊗ 认错条件：价格跌回 ${callWallStr} 以下，说明突破失败，多头逻辑失效。`,
      color:      'bullish',
    };

    // ── P3a: 逼空背离（散户看空，大资金看多）────────────────────────────────
    case 'BULL_DIVERGENCE': return {
      tone:       'bullish',
      headline:   `⚡ 逼空背离：散户疯狂买 Put，但大资金在悄悄做多`,
      detail:     `从人数看，量比 ${pcVolStr} 显示散户偏空；但从资金量看，Call 权利金 ${callPrem} 明显高于 Put 权利金 ${putPrem}。` +
                  `这个背离说明：散户在追空，但机构大资金在反向布多。` +
                  `永远跟随权利金方向，不跟随人数方向——当前看多。`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bullish',
    };

    // ── P3b: 诱多背离（散户看多，大资金看空）────────────────────────────────
    case 'BEAR_DIVERGENCE': return {
      tone:       'bearish',
      headline:   `⚡ 诱多背离：散户疯狂买 Call，但大资金在悄悄做空`,
      detail:     `从人数看，量比 ${pcVolStr} 显示散户偏多；但从资金量看，Put 权利金 ${putPrem} 明显高于 Call 权利金 ${callPrem}。` +
                  `这个背离说明：散户在追多，但机构大资金在反向布空。` +
                  `永远跟随权利金方向——当前看空。`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bearish',
    };

    // ── P3c: 低调做多 ────────────────────────────────────────────────────────
    case 'QUIET_BULL': return {
      tone:       'bullish',
      headline:   `🔍 低调做多：大资金悄悄布多，等价格突破确认`,
      detail:     `成交量均衡（量比 ${pcVolStr}），但 Call 权利金 ${callPrem} 悄悄高于 Put 权利金 ${putPrem}。` +
                  `机构在低调布多，还没到散户追进来的时候。等价格突破 ${confirmStr} 确认后再跟进。`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bullish',
    };

    // ── P3d: 低调做空 ────────────────────────────────────────────────────────
    case 'QUIET_BEAR': return {
      tone:       'bearish',
      headline:   `🔍 低调做空：大资金悄悄布空，等价格跌破确认`,
      detail:     `成交量均衡（量比 ${pcVolStr}），但 Put 权利金 ${putPrem} 悄悄高于 Call 权利金 ${callPrem}。` +
                  `机构在低调布空，等价格跌破 ${stopStr} 确认后再跟进。`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bearish',
    };

    // ── P4: 高频数据打架 ─────────────────────────────────────────────────────
    case 'FLOW_CONFLICT': return {
      tone:       'neutral',
      headline:   `⛔ 多空分歧：高频资金数据打架，建议观望`,
      detail:     `5 分钟资金（${flow5m}）与 15 分钟资金（${flow15m}）方向相反，说明市场正处于多空交战的混沌期。` +
                  `这通常发生在趋势转换或主力洗盘阶段。在没有清晰共识之前，任何方向的下注都是赌博。`,
      action_plan: `A 单预案暂停，等待 5m 和 15m 资金方向重新一致。当两个窗口方向对齐后，再根据 A 单预案执行。`,
      invalidation: `⊗ 等待条件：5m 与 15m 资金方向一致，且净权利金方向明确。`,
      color:      'neutral',
    };

    // ── P5a: 资金大出血 ──────────────────────────────────────────────────────
    case 'HEAVY_OUTFLOW': return {
      tone:       'bearish',
      headline:   `📉 资金大出血：净权利金流出 ${netPrem}，空头主导`,
      detail:     `日内净权利金大幅流出（${netPrem}），看跌资金 ${putPrem} 远超看涨资金 ${callPrem}（资金比 ${ratioStr}）。` +
                  `大资金在系统性减仓或做空。短线资金（5m: ${flow5m}，15m: ${flow15m}）` +
                  `${winStatus === 'ALIGNED' ? '同向确认，空头趋势较为明确。' : '方向尚未完全对齐，注意节奏。'}`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bearish',
    };

    // ── P5b: 资金大爆发 ──────────────────────────────────────────────────────
    case 'HEAVY_INFLOW': return {
      tone:       'bullish',
      headline:   `📈 资金大爆发：净权利金流入 ${netPrem}，多头主导`,
      detail:     `日内净权利金大幅流入（${netPrem}），看涨资金 ${callPrem} 远超看跌资金 ${putPrem}。` +
                  `大资金在系统性做多。短线资金（5m: ${flow5m}，15m: ${flow15m}）` +
                  `${winStatus === 'ALIGNED' ? '同向确认，多头趋势较为明确。' : '方向尚未完全对齐，注意节奏。'}`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bullish',
    };

    // ── P6: 正 Gamma 磁吸 ────────────────────────────────────────────────────
    case 'POSITIVE_GAMMA_SQUEEZE': return {
      tone:       'neutral',
      headline:   `🧲 正 Gamma 磁吸：做市商对冲会压制方向，等突破确认`,
      detail:     `当前处于正 Gamma 环境，做市商的操作逻辑是"高抛低吸"来维持中性，这会对指数起到"波动缓冲器"的作用。` +
                  `价格倾向于被磁吸在关键行权价附近（${putWallStr}–${callWallStr}）震荡，而不是单边趋势。` +
                  `日内净权利金（${netPrem}）` +
                  `${netPrem && String(netPrem).includes('-') ? '偏空，但正 Gamma 环境会压制跌幅。' : '偏多，但正 Gamma 环境会压制涨幅。'}`,
      action_plan: `在正 Gamma 磁吸区间内（${putWallStr}–${callWallStr}）不宜追涨杀跌。等待价格突破区间边界并确认后，再跟随 A 单预案执行。`,
      invalidation: `⊗ 等待条件：价格实体突破 ${callWallStr}（看多）或跌破 ${putWallStr}（看空），Gamma 磁吸失效。`,
      color:      'neutral',
    };

    // ── P7a: 多头共识 ────────────────────────────────────────────────────────
    case 'CONSENSUS_BULL': return {
      tone:       'bullish',
      headline:   `✅ 多头共识：资金与情绪同向看多，方向明确`,
      detail:     `Call 权利金 ${callPrem} 高于 Put 权利金 ${putPrem}，资金方向看多；量比 ${pcVolStr} 也偏多，` +
                  `散户情绪与机构资金方向一致。短线资金（5m: ${flow5m}，15m: ${flow15m}）` +
                  `${winStatus === 'ALIGNED' ? '方向对齐，动能可信。' : '方向尚未完全对齐，等待确认。'}`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bullish',
    };

    // ── P7b: 空头共识 ────────────────────────────────────────────────────────
    case 'CONSENSUS_BEAR': return {
      tone:       'bearish',
      headline:   `✅ 空头共识：资金与情绪同向看空，方向明确`,
      detail:     `Put 权利金 ${putPrem} 高于 Call 权利金 ${callPrem}，资金方向看空；量比 ${pcVolStr} 也偏空，` +
                  `散户情绪与机构资金方向一致。短线资金（5m: ${flow5m}，15m: ${flow15m}）` +
                  `${winStatus === 'ALIGNED' ? '方向对齐，动能可信。' : '方向尚未完全对齐，等待确认。'}`,
      action_plan: execPlan,
      invalidation: invalText,
      color:      'bearish',
    };

    // ── 默认：中性 ───────────────────────────────────────────────────────────
    default: return {
      tone:       'neutral',
      headline:   `📊 多空均衡：等待方向确认`,
      detail:     `当前 Call 权利金 ${callPrem}，Put 权利金 ${putPrem}，净权利金 ${netPrem}，` +
                  `量比 ${pcVolStr}。资金与情绪均未出现明显的方向性信号，` +
                  `短线资金（5m: ${flow5m}，15m: ${flow15m}）方向不明。等待触发条件出现。`,
      action_plan: `暂无明确方向，A 单预案待触发。等待资金方向明确后，根据 A 单预案（进场 ${entryStr}，确认 ${confirmStr}，止损 ${stopStr}）执行。`,
      invalidation: invalText || `⊗ 等待条件：净权利金方向明确，且 5m/15m 资金对齐。`,
      color:      'neutral',
    };
  }
}

// ── 执行预案文本生成 ──────────────────────────────────────────────────────────
function _buildExecPlan(tradeGate, side, planState, entry, confirm, stop, target1, blockedReason) {
  const sideStr = side === 'LONG' ? '多头' : side === 'SHORT' ? '空头' : '';

  if (tradeGate === 'PASS' && planState === 'ACTIVE') {
    return `✅ A 单可执行（${sideStr}）：进场 ${entry}，确认 ${confirm}，止损 ${stop}，目标 ${target1}。条件已全部满足，可按计划执行。`;
  }

  if (tradeGate === 'PASS' && planState === 'PENDING') {
    return `🟡 A 单等待触发（${sideStr}预案）：进场 ${entry}，确认 ${confirm}，止损 ${stop}，目标 ${target1}。资金门控已通过，等待价格触发进场条件。`;
  }

  if (tradeGate === 'DEGRADED' || tradeGate === 'BLOCKED') {
    const reasonStr = blockedReason ? `（${blockedReason}）` : '';
    return `⛔ A 单暂不执行${reasonStr}：当前仅显示${sideStr}预案（进场 ${entry}，确认 ${confirm}，止损 ${stop}）。` +
           `高频数据或做市商结构未达到开仓标准，等待条件改善后再执行。`;
  }

  return `📋 ${sideStr}预案：进场 ${entry}，确认 ${confirm}，止损 ${stop}，目标 ${target1}。`;
}

// ── 主导出函数 ────────────────────────────────────────────────────────────────
export function buildNarrative(signal) {
  try {
    const ctx = tagSignal(signal);
    const primary = selectPrimaryNarrative(ctx.tags);
    const narrative = renderNarrative(primary, ctx);

    return {
      primary_narrative: primary,
      tone:              narrative.tone,
      headline:          narrative.headline,
      detail:            narrative.detail,
      action_plan:       narrative.action_plan,
      invalidation:      narrative.invalidation,
      color:             narrative.color,
      tags:              ctx.tags,
      // 调试用（不在前端展示）
      _debug: {
        all_tags: ctx.tags,
        primary,
        spot: ctx.spotPrice,
        put_wall: ctx.putWall,
        call_wall: ctx.callWall,
      }
    };
  } catch (err) {
    return {
      primary_narrative: 'ERROR',
      tone:              'neutral',
      headline:          '盘面分析暂时不可用',
      detail:            '数据加载中，请稍后刷新。',
      action_plan:       '等待数据恢复后查看 A 单预案。',
      invalidation:      '',
      color:             'neutral',
      tags:              [],
      _debug:            { error: err.message }
    };
  }
}
