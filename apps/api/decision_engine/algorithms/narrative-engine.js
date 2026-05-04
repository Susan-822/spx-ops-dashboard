/**
 * narrative-engine.js  v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * 纯规则引擎（零 Token 成本）：10 大情景矩阵 + 优先级决策树 + 模板渲染
 *
 * 参考：Gemini 10 大盘面情景映射库（Scenario Matrix）
 *
 * ── 情景分类 ──────────────────────────────────────────────────────────────────
 * 类别一：背离与陷阱（最具实战价值）
 *   S01: PUT_ABSORPTION     — 诱空陷阱（做市商底部承接空头）
 *   S02: CALL_ABSORPTION    — 诱多陷阱（做市商顶部压制多头）
 *
 * 类别二：单边真趋势（资金与价格共振）
 *   S03: TRUE_BEAR          — 真实破位（空头碾压，防线失守）
 *   S04: TRUE_BULL          — 强势逼空（多头爆发，突破确立）
 *
 * 类别三：希腊值主导行情
 *   S05: GAMMA_PINNING      — 正 Gamma 磁吸（平值绞肉机）
 *   S06: GAMMA_FLUSH        — 负 Vanna 螺旋（关键铁底击穿，踩踏）
 *
 * 类别四：数据降级与冲突
 *   S07: FLOW_CONFLICT      — 高频动能打架（5m vs 15m 方向相反）
 *   S08: LIQUIDITY_VOID     — 流动性真空（午盘无序期 / 数据降级）
 *
 * 类别五：趋势反转先兆
 *   S09: VSHAPE_RECOVERY    — 探底深 V 反抽（空头获利了结，抄底资金进场）
 *   S10: NEUTRAL_FADE       — 中性无聊市（资金观望，等待触发）
 *
 * ── 优先级（从高到低）────────────────────────────────────────────────────────
 *   P1: S08 LIQUIDITY_VOID  — 时间真空期 / 数据降级（最高，强制休息）
 *   P2: S06 GAMMA_FLUSH     — 关键铁底击穿 + IV 飙升（极端踩踏）
 *   P3: S01 PUT_ABSORPTION  — 诱空陷阱
 *   P3: S02 CALL_ABSORPTION — 诱多陷阱
 *   P4: S03 TRUE_BEAR       — 真实破位（空头）
 *   P4: S04 TRUE_BULL       — 真实突破（多头）
 *   P5: S09 VSHAPE_RECOVERY — 深 V 反抽先兆
 *   P6: S07 FLOW_CONFLICT   — 高频数据打架
 *   P7: S05 GAMMA_PINNING   — 正 Gamma 磁吸
 *   P8: 背离（BULL/BEAR_DIVERGENCE）
 *   P9: S10 NEUTRAL_FADE    — 兜底
 */

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function _num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function _fmt(v, fallback = '--') { return v != null ? String(v) : fallback; }
function _abs(v) { return v != null ? Math.abs(v) : null; }

// ── 从 signal 中提取标准化上下文 ──────────────────────────────────────────────
function extractContext(signal) {
  const cf   = ((signal.home_view_model || {}).order_plan || {}).capital_flow || {};
  const pp   = ((signal.home_view_model || {}).order_plan || {}).primary_plan || {};
  const hvm  = signal.home_view_model || {};
  const dwm  = signal.dealer_wall_map || {};
  const fb   = signal.flow_behavior_engine || {};
  const atm  = signal.atm_trigger_engine || {};
  const abe  = signal.ab_order_engine || {};

  // ── 资金数据 ──
  const divType       = cf.divergence_type      || '';
  const mktLabel      = cf.market_summary_label || 'NEUTRAL';
  const pcPremRatio   = _num(cf.pc_prem_put_over_call);  // Put/Call 资金比（>1 = 偏空）
  const pcVolRatio    = _num(cf.pc_volume_ratio);
  const callPrem      = cf.day_call   || '--';
  const putPrem       = cf.day_put    || '--';
  const netPrem       = cf.day_net    || '--';
  const netPremNum    = _num(String(netPrem).replace(/[^0-9.\-]/g, '').replace(/M$/, ''));
  // netPremNum 单位：M（百万）
  const flow5m        = cf.flow_5m    || '--';
  const flow15m       = cf.flow_15m   || '--';
  const flow5mNum     = _num(String(flow5m).replace(/[^0-9.\-]/g, ''));
  const flow15mNum    = _num(String(flow15m).replace(/[^0-9.\-]/g, ''));
  const winStatus     = cf.window_status || '';
  const tradeGate     = cf.trade_gate    || 'DEGRADED';
  const gammaState    = cf.gamma_state   || '';
  const invalLine     = cf.invalidation_price_line || null;

  // ── 价格 / GEX 数据 ──
  const spotPrice     = _num(dwm.spot_price)    || _num(fb.spot_price) || null;
  const putWall       = _num(dwm.gex_local_put_wall)  || _num(dwm.put_wall)  || null;
  const callWall      = _num(dwm.gex_local_call_wall) || _num(dwm.call_wall) || null;
  const netGex        = _num(dwm.net_gex)       || null;  // 正 = 正 Gamma
  const ivRank        = _num(fb.iv_rank)        || _num(signal.vol_dashboard?.iv_rank) || null;

  // ── A单预案数据 ──
  const planSide      = pp.side       || '';
  const planState     = pp.plan_state || '';
  const planEntry     = pp.entry;
  const planStop      = pp.stop;
  const planConfirm   = pp.confirm;
  const planTarget1   = pp.target_1;
  const blockedReason = pp.blocked_reason || '';

  // ── 时间（用于 Liquidity Void 判断）──
  const nowHour = new Date().getUTCHours();  // UTC 时间
  // 美东时间 = UTC-4（夏令时）/ UTC-5（冬令时）
  // 午盘无序期：美东 11:30–13:30 = UTC 15:30–17:30
  const nowMin  = new Date().getUTCMinutes();
  const nowDecimal = nowHour + nowMin / 60;  // UTC 小数时间
  // 美东 11:30–13:30 = UTC 15.5–17.5
  const isLunchVoid = (nowDecimal >= 15.5 && nowDecimal <= 17.5);

  // ── 价格状态判断 ──
  // holding_support: 价格在 putWall 上方（做市商仍在承接）
  // broken_down: 价格已跌破 putWall
  // failing_resistance: 价格在 callWall 下方（做市商在压制）
  // broken_up: 价格已突破 callWall
  let priceStatus = 'neutral';
  if (spotPrice != null && putWall != null && callWall != null) {
    if (spotPrice < putWall - 3) priceStatus = 'broken_down';
    else if (spotPrice > callWall + 3) priceStatus = 'broken_up';
    else if (spotPrice <= putWall + 8) priceStatus = 'holding_support';
    else if (spotPrice >= callWall - 8) priceStatus = 'failing_resistance';
    else priceStatus = 'in_range';
  }

  // ── IV 状态 ──
  // IV 飙升：ivRank > 50 或 fb.iv_spike 标志
  const ivSpike = (ivRank != null && ivRank > 50) || fb.iv_spike === true;

  // ── 前期趋势（用于 V-Shape 判断）──
  // 如果前期为空头（netPremNum < -30）但最新 5m 突然转正（flow5mNum > 10）
  const prevBearish = netPremNum != null && netPremNum < -30;
  const sudden5mBull = flow5mNum != null && flow5mNum > 10;

  return {
    divType, mktLabel, pcPremRatio, pcVolRatio,
    callPrem, putPrem, netPrem, netPremNum,
    flow5m, flow15m, flow5mNum, flow15mNum,
    winStatus, tradeGate, gammaState, invalLine,
    spotPrice, putWall, callWall, netGex, ivRank, ivSpike,
    planSide, planState, planEntry, planStop, planConfirm, planTarget1,
    blockedReason, priceStatus, isLunchVoid,
    prevBearish, sudden5mBull,
  };
}

// ── 优先级决策树 ──────────────────────────────────────────────────────────────
function selectScenario(ctx) {
  const {
    pcPremRatio, netPremNum, flow5mNum, flow15mNum,
    priceStatus, gammaState, ivSpike, isLunchVoid,
    tradeGate, winStatus, prevBearish, sudden5mBull,
    putWall, callWall, spotPrice, divType, mktLabel,
  } = ctx;

  // P1: 流动性真空 / 数据降级（最高优先级，强制休息）
  if (isLunchVoid) return 'LIQUIDITY_VOID';
  if (tradeGate === 'FALLBACK' || tradeGate === 'STALE') return 'LIQUIDITY_VOID';

  // P2: 负 Vanna 螺旋（关键铁底击穿 + IV 飙升）
  if (priceStatus === 'broken_down' && ivSpike) return 'GAMMA_FLUSH';

  // P3a: 诱空陷阱（Put 资金碾压 + 价格守住支撑）
  if (pcPremRatio != null && pcPremRatio > 2.5 &&
      (priceStatus === 'holding_support' || priceStatus === 'in_range')) {
    return 'PUT_ABSORPTION';
  }

  // P3b: 诱多陷阱（Call 资金碾压 + 价格攻不破阻力）
  if (pcPremRatio != null && pcPremRatio < 0.4 &&
      (priceStatus === 'failing_resistance' || priceStatus === 'in_range')) {
    return 'CALL_ABSORPTION';
  }

  // P4a: 真实破位（空头）— 净流出 + 5m/15m 同向 + 价格已破位
  if (netPremNum != null && netPremNum < -30 &&
      flow5mNum != null && flow5mNum < 0 &&
      flow15mNum != null && flow15mNum < 0 &&
      priceStatus === 'broken_down') {
    return 'TRUE_BEAR';
  }

  // P4b: 真实突破（多头）— 净流入 + 5m/15m 同向 + 价格已突破
  if (netPremNum != null && netPremNum > 30 &&
      flow5mNum != null && flow5mNum > 0 &&
      flow15mNum != null && flow15mNum > 0 &&
      priceStatus === 'broken_up') {
    return 'TRUE_BULL';
  }

  // P5: 深 V 反抽先兆（前期空头 + 5m 突然转正）
  if (prevBearish && sudden5mBull && priceStatus !== 'broken_down') {
    return 'VSHAPE_RECOVERY';
  }

  // P6: 高频动能打架（5m vs 15m 方向相反）
  if (flow5mNum != null && flow15mNum != null &&
      ((flow5mNum > 5 && flow15mNum < -5) || (flow5mNum < -5 && flow15mNum > 5))) {
    return 'FLOW_CONFLICT';
  }

  // P7: 正 Gamma 磁吸（净 GEX 大幅为正 + 净权利金绝对值小）
  if (gammaState === 'POSITIVE' &&
      (netPremNum == null || Math.abs(netPremNum) < 20)) {
    return 'GAMMA_PINNING';
  }

  // P8: 背离场景
  if (divType === 'BULL_DIVERGENCE' || mktLabel === 'BULL_DIVERGENCE') return 'BULL_DIVERGENCE';
  if (divType === 'BEAR_DIVERGENCE' || mktLabel === 'BEAR_DIVERGENCE') return 'BEAR_DIVERGENCE';
  if (divType === 'QUIET_BULL') return 'QUIET_BULL';
  if (divType === 'QUIET_BEAR') return 'QUIET_BEAR';
  if (divType === 'CONSENSUS_BULL' || mktLabel === 'CONSENSUS_BULL') return 'CONSENSUS_BULL';
  if (divType === 'CONSENSUS_BEAR' || mktLabel === 'CONSENSUS_BEAR') return 'CONSENSUS_BEAR';

  // P9: 兜底
  return 'NEUTRAL_FADE';
}

// ── 执行预案文本生成 ──────────────────────────────────────────────────────────
function buildExecPlan(ctx) {
  const { tradeGate, planSide, planState, planEntry, planStop, planConfirm, planTarget1, blockedReason } = ctx;
  const sideStr = planSide === 'LONG' ? '多头' : planSide === 'SHORT' ? '空头' : '';
  const e = _fmt(planEntry), s = _fmt(planStop), c = _fmt(planConfirm), t = _fmt(planTarget1);

  if (tradeGate === 'PASS' && planState === 'ACTIVE') {
    return `✅ A单可执行（${sideStr}）：进场 ${e}，确认 ${c}，止损 ${s}，目标 ${t}。条件已全部满足，可按计划执行。`;
  }
  if (tradeGate === 'PASS' && planState === 'PENDING') {
    return `🟡 A单等待触发（${sideStr}预案）：进场 ${e}，确认 ${c}，止损 ${s}，目标 ${t}。资金门控已通过，等待价格触发进场条件。`;
  }
  const reasonStr = blockedReason ? `（${blockedReason}）` : '';
  return `⛔ A单暂不执行${reasonStr}：当前仅显示${sideStr}预案（进场 ${e}，确认 ${c}，止损 ${s}）。等待条件改善后再执行。`;
}

// ── 模板渲染 ──────────────────────────────────────────────────────────────────
function renderTemplate(scenario, ctx) {
  const {
    pcPremRatio, pcVolRatio, callPrem, putPrem, netPrem,
    flow5m, flow15m, spotPrice, putWall, callWall,
    planEntry, planStop, planConfirm, planTarget1,
    invalLine, gammaState, ivRank, winStatus,
    prevBearish, sudden5mBull,
  } = ctx;

  const ratioStr   = pcPremRatio != null ? `${Number(pcPremRatio).toFixed(1)}x` : '--';
  const pcVolStr   = pcVolRatio  != null ? Number(pcVolRatio).toFixed(2) : '--';
  const spotStr    = spotPrice   != null ? Number(spotPrice).toFixed(2) : '--';
  const putWallStr = putWall     != null ? String(putWall)  : '--';
  const callWallStr= callWall    != null ? String(callWall) : '--';
  const entryStr   = _fmt(planEntry);
  const stopStr    = _fmt(planStop);
  const confirmStr = _fmt(planConfirm);
  const target1Str = _fmt(planTarget1);

  const execPlan   = buildExecPlan(ctx);
  const invalText  = invalLine
    ? `⊗ 认错条件：${invalLine}`
    : (planStop ? `⊗ 认错条件：实体 K 线跌破并站稳 ${planStop}，多头逻辑失效` : '');

  switch (scenario) {

    // ── S01: 诱空陷阱 ─────────────────────────────────────────────────────────
    case 'PUT_ABSORPTION': return {
      tone: 'warning', color: 'warning',
      headline: `⚠️ 诱空陷阱：空头猛砸但跌不下去，做市商底部承接`,
      detail:
        `资金面上看跌权利金（${putPrem}）高达看涨资金（${callPrem}）的 ${ratioStr}，` +
        `量比 ${pcVolStr} 也显示散户极度悲观。` +
        `但价格死死守住 ${putWallStr} 未破，说明砸盘资金被做市商被动吸筹，空头动能正在被消耗。` +
        `这是典型的"诱空陷阱"——表面上空头在发力，实际上每一笔 Put 都被做市商的对冲买盘吸收了。` +
        `当前位置（${spotStr}）严禁追空！`,
      action_plan: execPlan,
      invalidation: invalLine
        ? `⊗ 认错条件：${invalLine}`
        : `⊗ 认错条件：实体 K 线跌破并站稳 ${putWallStr}，说明做市商放弃抵抗，吸收转化为真跌。`,
    };

    // ── S02: 诱多陷阱 ─────────────────────────────────────────────────────────
    case 'CALL_ABSORPTION': return {
      tone: 'warning', color: 'warning',
      headline: `⚠️ 诱多陷阱：多头狂买但涨不动，主力高位派发`,
      detail:
        `看涨资金（${callPrem}）压倒性领先，量比 ${pcVolStr} 显示散户情绪亢奋。` +
        `但指数在 ${callWallStr} 附近明显滞涨，价格攻不上去。` +
        `这通常是做市商利用散户的 FOMO 情绪提供流动性出货，暗中积累抛压。` +
        `当前位置（${spotStr}）不要摸顶追多！`,
      action_plan: `若实体 K 线跌破 ${putWallStr}，可顺势做空。${execPlan}`,
      invalidation: `⊗ 认错条件：实体 K 线突破并站稳 ${callWallStr}，说明突破确立，空头逻辑失效。`,
    };

    // ── S03: 真实破位（空头）─────────────────────────────────────────────────
    case 'TRUE_BEAR': return {
      tone: 'bearish', color: 'bearish',
      headline: `📉 真实破位：空头资金碾压，防线已全面失守`,
      detail:
        `日内净权利金巨额流出（${netPrem}），看跌资金 ${putPrem} 远超看涨资金 ${callPrem}（资金比 ${ratioStr}）。` +
        `且高频资金（5m: ${flow5m}，15m: ${flow15m}）同步向下，前期承接盘已放弃抵抗。` +
        `吸收已转化为真实的恐慌抛售，价格跌破关键支撑 ${putWallStr}。`,
      action_plan: `顺势逢高做空，切勿在此处接飞刀抄底。目标下看 ${target1Str}。${execPlan}`,
      invalidation: `⊗ 认错条件：价格重新站回 ${putWallStr} 以上并收盘，说明破位失败，空头逻辑失效。`,
    };

    // ── S04: 真实突破（多头）─────────────────────────────────────────────────
    case 'TRUE_BULL': return {
      tone: 'bullish', color: 'bullish',
      headline: `📈 强势突破：多头资金爆发，逼空行情确立`,
      detail:
        `资金如潮水般涌入（净流入 ${netPrem}），看涨资金 ${callPrem} 大幅领先。` +
        `高频动能（5m: ${flow5m}，15m: ${flow15m}）共振向上。` +
        `做市商被迫在现货市场买入对冲（正 Delta 追击），推升指数加速上行，突破关键阻力 ${callWallStr}。`,
      action_plan: `顺势回踩做多。不要轻易猜顶，回踩 ${putWallStr} 不破即是上车点。${execPlan}`,
      invalidation: `⊗ 认错条件：价格跌回 ${callWallStr} 以下，说明突破失败，多头逻辑失效。`,
    };

    // ── S05: 正 Gamma 磁吸 ────────────────────────────────────────────────────
    case 'GAMMA_PINNING': return {
      tone: 'neutral', color: 'neutral',
      headline: `🧲 平值磁吸：正 Gamma 震荡市，多空双杀绞肉机`,
      detail:
        `当前全市场 Gamma 为正，做市商策略变为严格的"高抛低吸"。` +
        `价格被死死钉在 ${putWallStr}–${callWallStr} 区间附近，波动率被无情压制。` +
        `主要目的是收割期权时间价值（Theta），净权利金（${netPrem}）绝对值偏小印证了这一点。`,
      action_plan:
        `放弃单边暴富幻想。仅在边缘位（${callWallStr} 附近空，${putWallStr} 附近多）打游击，` +
        `或者直接空仓休息。${execPlan}`,
      invalidation:
        `⊗ 等待条件：价格实体突破 ${callWallStr}（看多）或跌破 ${putWallStr}（看空），Gamma 磁吸失效。`,
    };

    // ── S06: 负 Vanna 螺旋（踩踏）────────────────────────────────────────────
    case 'GAMMA_FLUSH': return {
      tone: 'bearish', color: 'bearish',
      headline: `🌪️ 恐慌踩踏：关键铁底击穿，做市商反手砸盘`,
      detail:
        `指数跌破 Gamma 零轴界限（${putWallStr}），伴随恐慌情绪升温` +
        (ivRank != null ? `（IV Rank 飙升至 ${ivRank}）` : '') +
        `，触发了做市商的负 Vanna 抛售链条。` +
        `原本的护盘力量已经变成了被动砸盘主力，空头动能将加速释放。`,
      action_plan:
        `极端空头行情开启！只空不多，任何无量反弹都是逃命机会。` +
        `不要在此处抄底，等待 IV 回落、价格重新站回 ${putWallStr} 后再评估。`,
      invalidation:
        `⊗ 认错条件：价格重新站回 ${putWallStr} 以上 + IV 开始回落，踩踏结束信号。`,
    };

    // ── S07: 高频动能打架 ─────────────────────────────────────────────────────
    case 'FLOW_CONFLICT': return {
      tone: 'neutral', color: 'neutral',
      headline: `⛔ 多空分歧：高频数据打架，处于洗盘/变盘期`,
      detail:
        `短期 5 分钟资金（${flow5m}）与中期 15 分钟（${flow15m}）方向相反。` +
        `这意味着短期有获利盘砸盘或散户逆势，主力真实意图不明，盘面极易画门。` +
        `在没有清晰共识之前，任何方向的下注都是赌博。`,
      action_plan:
        `A单仅显示预案，不可执行。管住手，必须等待高频动能重新同向。${execPlan}`,
      invalidation:
        `⊗ 等待条件：5m 与 15m 资金方向一致，且净权利金方向明确。`,
    };

    // ── S08: 流动性真空 ───────────────────────────────────────────────────────
    case 'LIQUIDITY_VOID': return {
      tone: 'neutral', color: 'neutral',
      headline: `💤 流动性低谷：进入午盘无序期或数据降级`,
      detail:
        `核心交易窗口已过（或数据源降级），主力资金休整。` +
        `低成交量下，极少量的单子就能把价格打飞，走势充斥着虚假突破和算法来回双割。` +
        `此时任何技术信号的可信度都大幅下降。`,
      action_plan:
        `强制休息。如果强行入场，必须死守 20 分钟超时离场（Timeout Exit）纪律。` +
        `等待下午 13:30 后流动性恢复再评估。`,
      invalidation:
        `⊗ 等待条件：美东 13:30 后流动性恢复，或数据源重新上线。`,
    };

    // ── S09: 深 V 反抽先兆 ────────────────────────────────────────────────────
    case 'VSHAPE_RECOVERY': return {
      tone: 'bullish', color: 'bullish',
      headline: `🚀 探底反抽：空头获利了结，抄底资金快速进场`,
      detail:
        `此前为空头主导（净流出 ${netPrem}），但最新 5 分钟资金出现猛烈的正向反扑（${flow5m}）。` +
        `如果下方 ${putWallStr} 的支撑位没有跌破，这是反弹即将展开的先兆。` +
        `做市商的对冲买盘可能正在推动价格快速回升。`,
      action_plan:
        `空单立刻止盈。若实体站稳 ${confirmStr}，可尝试轻仓试多，目标 ${target1Str}。${execPlan}`,
      invalidation:
        `⊗ 认错条件：价格再次跌破 ${putWallStr}，说明反弹失败，空头继续主导。`,
    };

    // ── 背离场景（P8）────────────────────────────────────────────────────────
    case 'BULL_DIVERGENCE': return {
      tone: 'bullish', color: 'bullish',
      headline: `⚡ 逼空背离：散户疯狂买 Put，但大资金在悄悄做多`,
      detail:
        `从人数看，量比 ${pcVolStr} 显示散户偏空；` +
        `但从资金量看，Call 权利金（${callPrem}）明显高于 Put 权利金（${putPrem}）。` +
        `这个背离说明：散户在追空，但机构大资金在反向布多。` +
        `永远跟随权利金方向，不跟随人数方向——当前看多。`,
      action_plan: execPlan,
      invalidation: invalText,
    };

    case 'BEAR_DIVERGENCE': return {
      tone: 'bearish', color: 'bearish',
      headline: `⚡ 诱多背离：散户疯狂买 Call，但大资金在悄悄做空`,
      detail:
        `从人数看，量比 ${pcVolStr} 显示散户偏多；` +
        `但从资金量看，Put 权利金（${putPrem}）明显高于 Call 权利金（${callPrem}）。` +
        `这个背离说明：散户在追多，但机构大资金在反向布空。` +
        `永远跟随权利金方向——当前看空。`,
      action_plan: execPlan,
      invalidation: invalText,
    };

    case 'QUIET_BULL': return {
      tone: 'bullish', color: 'bullish',
      headline: `🔍 低调做多：大资金悄悄布多，等价格突破确认`,
      detail:
        `成交量均衡（量比 ${pcVolStr}），但 Call 权利金（${callPrem}）悄悄高于 Put 权利金（${putPrem}）。` +
        `机构在低调布多，还没到散户追进来的时候。等价格突破 ${confirmStr} 确认后再跟进。`,
      action_plan: execPlan,
      invalidation: invalText,
    };

    case 'QUIET_BEAR': return {
      tone: 'bearish', color: 'bearish',
      headline: `🔍 低调做空：大资金悄悄布空，等价格跌破确认`,
      detail:
        `成交量均衡（量比 ${pcVolStr}），但 Put 权利金（${putPrem}）悄悄高于 Call 权利金（${callPrem}）。` +
        `机构在低调布空，等价格跌破 ${stopStr} 确认后再跟进。`,
      action_plan: execPlan,
      invalidation: invalText,
    };

    case 'CONSENSUS_BULL': return {
      tone: 'bullish', color: 'bullish',
      headline: `✅ 多头共识：资金与情绪同向看多，方向明确`,
      detail:
        `Call 权利金（${callPrem}）高于 Put 权利金（${putPrem}），资金方向看多；` +
        `量比 ${pcVolStr} 也偏多，散户情绪与机构资金方向一致。` +
        `短线资金（5m: ${flow5m}，15m: ${flow15m}）` +
        `${winStatus === 'ALIGNED' ? '方向对齐，动能可信。' : '方向尚未完全对齐，等待确认。'}`,
      action_plan: execPlan,
      invalidation: invalText,
    };

    case 'CONSENSUS_BEAR': return {
      tone: 'bearish', color: 'bearish',
      headline: `✅ 空头共识：资金与情绪同向看空，方向明确`,
      detail:
        `Put 权利金（${putPrem}）高于 Call 权利金（${callPrem}），资金方向看空；` +
        `量比 ${pcVolStr} 也偏空，散户情绪与机构资金方向一致。` +
        `短线资金（5m: ${flow5m}，15m: ${flow15m}）` +
        `${winStatus === 'ALIGNED' ? '方向对齐，动能可信。' : '方向尚未完全对齐，等待确认。'}`,
      action_plan: execPlan,
      invalidation: invalText,
    };

    // ── S10: 中性无聊市（兜底）───────────────────────────────────────────────
    default:
    case 'NEUTRAL_FADE': return {
      tone: 'neutral', color: 'neutral',
      headline: `☕ 盘面沉闷：资金观望情绪浓厚，无明确方向`,
      detail:
        `大资金没有明显动作，P/C 比均衡（量比 ${pcVolStr}），净流入（${netPrem}）微弱。` +
        `Call 权利金（${callPrem}）与 Put 权利金（${putPrem}）势均力敌。` +
        `市场在等待宏观消息或特定时间窗口的触发。`,
      action_plan:
        `多看少动，耐心等待资金表态。${execPlan}`,
      invalidation:
        invalText || `⊗ 等待条件：净权利金方向明确，且 5m/15m 资金对齐。`,
    };
  }
}

// ── 主导出函数 ────────────────────────────────────────────────────────────────
export function buildNarrative(signal) {
  try {
    const ctx      = extractContext(signal);
    const scenario = selectScenario(ctx);
    const tmpl     = renderTemplate(scenario, ctx);

    return {
      scenario,                        // 情景 ID（S01–S10 / 背离等）
      primary_narrative: scenario,     // 兼容旧字段名
      tone:              tmpl.tone,
      color:             tmpl.color,
      headline:          tmpl.headline,
      detail:            tmpl.detail,
      action_plan:       tmpl.action_plan,
      invalidation:      tmpl.invalidation,
      // 调试字段（不在前端展示）
      _debug: {
        scenario,
        price_status:  ctx.priceStatus,
        pc_prem_ratio: ctx.pcPremRatio,
        net_prem_num:  ctx.netPremNum,
        flow5m_num:    ctx.flow5mNum,
        flow15m_num:   ctx.flow15mNum,
        gamma_state:   ctx.gammaState,
        iv_spike:      ctx.ivSpike,
        is_lunch_void: ctx.isLunchVoid,
        trade_gate:    ctx.tradeGate,
      }
    };
  } catch (err) {
    return {
      scenario:          'ERROR',
      primary_narrative: 'ERROR',
      tone:              'neutral',
      color:             'neutral',
      headline:          '盘面分析暂时不可用',
      detail:            '数据加载中，请稍后刷新。',
      action_plan:       '等待数据恢复后查看 A单预案。',
      invalidation:      '',
      _debug:            { error: err.message }
    };
  }
}
