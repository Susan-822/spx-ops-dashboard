/**
 * signal-formatter.js
 *
 * Builds structured UI-ready fields for /signals/current:
 *   primary_card     — main trading instruction card (LONG_CALL / SHORT_PUT / LOCKED)
 *   sentiment_bar    — market sentiment 0-100 (bearish=0, bullish=100)
 *   levels           — ATM, bull_trigger, bear_trigger, life_death
 *   money_read       — flow narrative (资金人话)
 *   darkpool_read    — dark pool narrative (暗盘人话)
 *   vol_dashboard    — IV/IV30/IV Rank gauge
 *   vix_dashboard    — VIX gauge
 *   forbidden_bar    — bottom warning strip
 *   data_health      — per-source LIVE/PARTIAL/MISSING/COLD_START status
 *   strike_battle    — key strike GEX table
 *   vanna_charm      — Vanna/Charm table
 */

function fmt(n, decimals = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return Number(n).toFixed(decimals);
}

// ── Primary Action Card ────────────────────────────────────────────────────────
function buildPrimaryCard(signal) {
  const ab  = signal.ab_order_engine || {};
  const atm = signal.atm_engine || {};
  const gr  = signal.gamma_regime_engine || {};
  const fb  = signal.flow_behavior_engine || {};
  const pc  = signal.price_contract || {};
  const dw  = signal.dealer_wall_map || {};
  const pve = signal.price_validation_engine || {};

  const spot    = pc.spot ?? pc.live_price ?? null;
  const spotFmt = spot != null ? `SPX ${fmt(spot, 1)}` : 'SPX --';

  // Determine primary direction
  let direction      = 'LOCKED';
  let directionLabel = '锁仓';
  let directionColor = 'gray';
  let badge          = 'LOCKED';

  if (ab.status !== 'blocked' && ab.plan_a) {
    const planADir = ab.plan_a.direction ?? '';
    if (planADir === 'long' || planADir === 'bullish' || fb.behavior === 'call_effective') {
      direction = 'LONG_CALL'; directionLabel = '做 Call'; directionColor = 'green'; badge = 'LONG_CALL';
    } else if (planADir === 'short' || planADir === 'bearish' || fb.behavior === 'put_effective') {
      direction = 'SHORT_PUT'; directionLabel = '做 Put'; directionColor = 'red'; badge = 'SHORT_PUT';
    }
  }

  const headline    = ab.headline || `${spotFmt} ｜ 锁仓 ｜ ${ab.blocked_reason ?? '等待条件'}`;
  const subHeadline = ab.plan_a?.summary || (ab.status === 'blocked' ? (ab.status_cn ?? '等待条件满足') : '');

  const plan = ab.plan_a ? {
    state:        ab.plan_a.state        ?? '--',
    why:          ab.plan_a.why          ?? '--',
    entry:        ab.plan_a.entry        ?? '--',
    action:       ab.plan_a.action       ?? '--',
    stop:         ab.plan_a.stop         ?? '--',
    target:       ab.plan_a.target       ?? '--',
    forbidden:    ab.plan_a.forbidden    ?? '--',
    invalidation: ab.plan_a.invalidation ?? '--'
  } : null;

  return {
    direction, direction_label: directionLabel, direction_color: directionColor, badge,
    headline, sub_headline: subHeadline,
    plan, plan_b: ab.plan_b ?? null,
    spot, spot_fmt: spotFmt,
    spot_source: pc.spot_source ?? '--',
    spot_status: pc.spot_status ?? 'unknown',
    last_updated: signal.last_updated ?? null,
    uw_live: signal.source_display?.uw?.status === 'live',
    dominant_scene: pve.dominant_scene ?? null,
    scene_warnings: pve.active_scenes ?? [],
    alert_level: pve.alert_level ?? 'normal',
    locked: ab.status === 'blocked',
    locked_reason: ab.blocked_reason ?? null
  };
}

// ── Sentiment Bar ──────────────────────────────────────────────────────────────
function buildSentimentBar(signal) {
  const fb = signal.flow_behavior_engine || {};
  const gr = signal.gamma_regime_engine  || {};

  let score = 50;
  const behavior = fb.behavior ?? 'neutral';
  const pcRatio  = fb.put_call_ratio ?? null;

  if (behavior === 'put_effective')  score = 30;
  else if (behavior === 'put_squeezed')   score = 40;
  else if (behavior === 'call_effective') score = 70;
  else if (behavior === 'call_capped')    score = 60;
  else if (behavior === 'mixed')          score = 45;

  if (pcRatio != null) {
    if (pcRatio > 1.8)      score = Math.max(score - 15, 10);
    else if (pcRatio > 1.5) score = Math.max(score - 8,  20);
    else if (pcRatio < 0.5) score = Math.min(score + 15, 90);
    else if (pcRatio < 0.8) score = Math.min(score + 8,  80);
  }
  if (gr.gamma_regime === 'positive') score = Math.round(score * 0.9 + 50 * 0.1);
  score = Math.round(Math.max(0, Math.min(100, score)));

  let label = '中性'; let color = 'gray';
  if      (score >= 75) { label = '偏多 (多头)'; color = 'red'; }
  else if (score >= 60) { label = '偏多';         color = 'amber'; }
  else if (score >= 45) { label = '中性偏多';     color = 'gray'; }
  else if (score >= 35) { label = '中性偏空';     color = 'gray'; }
  else if (score >= 20) { label = '偏空';         color = 'green'; }
  else                  { label = '偏空 (空头)';  color = 'green'; }

  const subMap = {
    put_squeezed:   'Put 仍然重，但价格没有继续跌，不能追最低点。',
    put_effective:  'Put Flow 有效，空头动能未被吸收。',
    call_effective: 'Call Flow 有效，多头动能确认。',
    mixed:          '资金偏多但 Put 仍重，方向降级。'
  };
  const sub = subMap[behavior] ?? '无明显资金流方向。';

  return {
    score, label, color, sub,
    put_call_ratio: pcRatio != null ? Number(pcRatio.toFixed(2)) : null,
    net_premium_millions: fb.net_premium_millions ?? null,
    behavior, behavior_label: fb.behavior_label ?? label,
    gamma_regime: gr.gamma_regime ?? 'unknown'
  };
}

// ── Key Levels ─────────────────────────────────────────────────────────────────
function buildLevels(signal) {
  const atm = signal.atm_engine      || {};
  const dw  = signal.dealer_wall_map || {};
  const pc  = signal.price_contract  || {};

  const spot       = pc.spot ?? pc.live_price ?? null;
  const atmLevel   = atm.atm ?? null;
  const wallStatus = dw.wall_status ?? 'unavailable';

  // Near walls (already filtered by spot in dealer-wall-engine)
  const nearCallWall = wallStatus !== 'unavailable' ? (dw.near_call_wall ?? null) : null;
  const nearPutWall  = wallStatus !== 'unavailable' ? (dw.near_put_wall  ?? null) : null;

  // Gamma flip display
  const gammaFlip  = dw.gamma_flip ?? null;
  const flipFar    = gammaFlip != null && spot != null && Math.abs(gammaFlip - spot) > 200;
  const flipDisplay = flipFar
    ? 'Gamma Flip：远离现价，不参与日内执行。'
    : (gammaFlip != null ? `Gamma Flip ${fmt(gammaFlip)}` : '翻转点不可判断');

  // Life/death line
  const lifeDeath = !flipFar && gammaFlip != null ? gammaFlip
    : (atmLevel != null ? atmLevel - 20 : null);

  // Hint
  let hint = null;
  if (atmLevel != null && spot != null && Math.abs(spot - atmLevel) <= 5) {
    hint = `${fmt(atmLevel)} ATM 附近不要乱做，等价格离开 ATM 区后再判断。`;
  } else if (nearPutWall != null) {
    hint = `跌破 ${fmt(nearPutWall)} 才算空头更主动。`;
  }

  return {
    atm: atmLevel,
    atm_fmt: atmLevel != null ? fmt(atmLevel) : '--',
    bull_trigger: nearCallWall,
    bull_trigger_fmt: nearCallWall != null ? fmt(nearCallWall) : 'unavailable',
    bear_trigger: nearPutWall,
    bear_trigger_fmt: nearPutWall != null ? fmt(nearPutWall) : 'unavailable',
    life_death: lifeDeath,
    life_death_fmt: lifeDeath != null ? fmt(lifeDeath) : '--',
    gamma_flip: gammaFlip,
    gamma_flip_display: flipDisplay,
    gamma_flip_far: flipFar,
    near_call_wall: nearCallWall,
    near_put_wall:  nearPutWall,
    wall_status: wallStatus,
    wall_errors: dw.wall_errors ?? [],
    global_call_gex_cluster: dw.global_call_gex_cluster ?? null,
    global_put_gex_cluster:  dw.global_put_gex_cluster  ?? null,
    global_gex_clusters:     dw.global_gex_clusters     ?? [],
    hint,
    pin_risk: atm.pin_risk ?? null,
    pin_warning: (atm.pin_risk ?? 0) >= 70 ? `ATM ${fmt(atmLevel)} 附近禁止乱买 0DTE` : null
  };
}

// ── Money Read (资金人话) ──────────────────────────────────────────────────────
function buildMoneyRead(signal) {
  const fb = signal.flow_behavior_engine || {};
  const uf = signal.uw_factors || {};
  const ff = uf.flow_factors || {};

  const behavior  = fb.behavior ?? 'neutral';
  const netPremM  = fb.net_premium_millions ?? null;
  const pcRatio   = fb.put_call_ratio ?? null;
  const callPremM = ff.call_premium_5m != null ? Number((ff.call_premium_5m / 1_000_000).toFixed(1)) : null;
  const putPremM  = ff.put_premium_5m  != null ? Number((ff.put_premium_5m  / 1_000_000).toFixed(1)) : null;

  const titleMap = {
    put_effective:  '偏空且有效',
    put_squeezed:   '偏空但有托盘',
    call_effective: '偏多但 Put 仍重',
    call_capped:    '偏多但受压',
    mixed:          '多空混战',
    neutral:        '无明显方向'
  };
  const title = titleMap[behavior] ?? '无明显方向';

  let body = fb.reason ?? '资金流向信号不足。';
  if (behavior === 'put_squeezed') {
    body = 'Put 仍然重，但价格没有继续跌，不能追最低点。';
  } else if (behavior === 'mixed') {
    const ap = putPremM != null ? Math.abs(putPremM).toFixed(1) : '--';
    const ac = callPremM != null ? Math.abs(callPremM).toFixed(1) : '--';
    body = `资金偏多但 Put 仍重（Put ${ap}M > Call ${ac}M），方向降级。`;
  }

  return {
    title, body,
    put_call_ratio: pcRatio != null ? Number(pcRatio.toFixed(2)) : null,
    net_premium_fmt: netPremM != null ? (netPremM >= 0 ? '+' : '') + netPremM.toFixed(1) + 'M' : '--',
    call_premium_fmt: callPremM != null ? '+' + Math.abs(callPremM).toFixed(1) + 'M' : '--',
    put_premium_fmt:  putPremM  != null ? '+' + Math.abs(putPremM).toFixed(1)  + 'M' : '--',
    behavior, behavior_label: fb.behavior_label ?? title
  };
}

// ── Darkpool Read (暗盘人话) ───────────────────────────────────────────────────
function buildDarkpoolRead(signal) {
  const dp  = signal.darkpool_behavior_engine || {};
  const pc  = signal.price_contract || {};
  const isMarketHours = _isMarketHours();

  const clusters = dp.clusters ?? [];
  const behavior = dp.behavior ?? 'unknown';
  const spot     = pc.spot ?? pc.live_price ?? null;

  let title = '暗盘数据不足';
  let body  = '暗盘数据待接入。';

  if (clusters.length > 0) {
    const top   = clusters[0];
    const level = top.spx_level ?? dp.spx_level ?? null;
    const prem  = top.total_premium_millions ?? null;
    const lvl2  = clusters[1]?.spx_level;

    if (isMarketHours) {
      if (behavior === 'breakout' || behavior === 'upper_dispatch') {
        title = '上方派发';
        body  = `${fmt(level)}${lvl2 ? `–${fmt(lvl2)}` : ''} 有大额成交，价格站不回容易被压。`;
      } else if (behavior === 'breakdown' || behavior === 'lower_brake_zone') {
        title = '下方承接';
        body  = `${fmt(level)} 有大额成交，机构可能在底部承接。`;
      } else if (behavior === 'cluster_wall') {
        title = '暗盘墙位';
        body  = `${fmt(level)} 附近有强暗盘聚集，价格容易在此震荡。`;
      } else {
        title = dp.behavior_cn ?? '暗盘活跃';
        body  = `暗盘区 ${fmt(level)}${prem != null ? `，成交 $${prem.toFixed(1)}M` : ''}。`;
      }
    } else {
      const isAbove = spot != null && level != null && level > spot;
      title = isAbove ? '暗盘区在现价上方' : '暗盘区在现价下方';
      body  = `暗盘区 ${fmt(level)}（仅作位置参考，非交易时段不判断动能）。`;
    }
  }

  const levelList = clusters.slice(0, 3).map((c) => ({
    level: c.spx_level ?? null,
    level_fmt: c.spx_level != null ? fmt(c.spx_level) : '--',
    premium_fmt: c.total_premium_millions != null ? `$${c.total_premium_millions.toFixed(1)}M` : '--',
    behavior: c.behavior ?? 'unknown',
    behavior_cn: c.behavior_cn ?? '--',
    label: c.behavior_cn ?? c.behavior ?? '--'
  }));

  return {
    title, body,
    levels: levelList,
    tier: dp.tier ?? 'unknown',
    behavior, behavior_cn: dp.behavior_cn ?? '--',
    is_market_hours: isMarketHours,
    data_quality: dp.data_quality ?? 'unknown'
  };
}

// ── Volatility Dashboard ───────────────────────────────────────────────────────
function buildVolDashboard(signal) {
  const vd = signal.volatility_dashboard || {};
  const uf = signal.uw_factors || {};
  const vf = uf.volatility_factors || {};

  const iv30   = vd.iv30   ?? vf.iv30   ?? null;
  const ivRank = vf.iv_rank ?? vd.vscore ?? null;
  const ivPctRaw = vf.iv_percentile ?? null;
  const ivPct  = ivPctRaw != null ? (ivPctRaw <= 1 ? Math.round(ivPctRaw * 1000) / 10 : ivPctRaw) : null;

  let buyerRisk = '未知'; let buyerRiskColor = 'gray';
  if (iv30 != null) {
    if      (iv30 > 25) { buyerRisk = '高';   buyerRiskColor = 'red'; }
    else if (iv30 > 18) { buyerRisk = '中等'; buyerRiskColor = 'amber'; }
    else                { buyerRisk = '低';   buyerRiskColor = 'green'; }
  }

  let commentary = '期权成本数据待接入。';
  if (iv30 != null && ivRank != null) {
    if      (ivRank < 30) commentary = '期权不算特别贵，可以做买方，但必须快进快出。';
    else if (ivRank < 60) commentary = 'IV 中等，买方有成本压力，优先卖方结构或快进快出。';
    else                  commentary = 'IV 偏高，买方成本高，优先卖方结构。';
  }

  return {
    iv30, iv30_fmt: iv30 != null ? iv30.toFixed(1) + '%' : '--',
    iv_rank: ivRank, iv_rank_fmt: ivRank != null ? ivRank.toFixed(1) : '--',
    iv_percentile: ivPct, iv_percentile_fmt: ivPct != null ? ivPct.toFixed(1) + '%' : '--',
    buyer_risk: buyerRisk, buyer_risk_color: buyerRiskColor,
    commentary, status: iv30 != null ? 'live' : 'missing'
  };
}

// ── VIX Dashboard ──────────────────────────────────────────────────────────────
function buildVixDashboard(signal) {
  const vd  = signal.volatility_dashboard || {};
  const vix = vd.vix ?? null;

  let riskSentiment = '正常'; let riskColor = 'green';
  let commentary = '没有恐慌，不支持脑追 Put。';
  if (vix != null) {
    if      (vix > 30) { riskSentiment = '极度恐慌'; riskColor = 'red';   commentary = `VIX ${vix.toFixed(1)} 极度恐慌，IV 溢价高，买 Put 成本极高。`; }
    else if (vix > 20) { riskSentiment = '恐慌';     riskColor = 'amber'; commentary = `VIX ${vix.toFixed(1)} 偏高，市场有恐慌情绪，买方成本上升。`; }
    else if (vix > 15) { riskSentiment = '正常偏高'; riskColor = 'amber'; commentary = `VIX ${vix.toFixed(1)} 正常偏高，可以做买方但需快进快出。`; }
    else               { riskSentiment = '正常';     riskColor = 'green'; commentary = `VIX ${vix.toFixed(1)} 正常，没有恐慌，不支持脑追 Put。`; }
  }

  return {
    vix, vix_fmt: vix != null ? vix.toFixed(1) : '--',
    risk_sentiment: riskSentiment, risk_color: riskColor,
    commentary, status: vix != null ? 'live' : 'missing',
    source: vix != null ? 'FMP' : 'unavailable',
    source_status: vix != null ? 'live' : 'limit_reach'
  };
}

// ── Data Health ────────────────────────────────────────────────────────────────
function buildDataHealth(signal) {
  const sd  = signal.source_display || {};
  const pc  = signal.price_contract || {};
  const pve = signal.price_validation_engine || {};
  const vd  = signal.volatility_dashboard || {};

  const uwStatus   = sd.uw?.status === 'live' ? 'LIVE' : sd.uw?.status === 'partial' ? 'PARTIAL' : 'MISSING';
  const spotStatus = pc.spot_status === 'live' ? 'LIVE' : pc.spot != null ? 'PARTIAL' : 'MISSING';
  const flowStatus = signal.uw_factors?.flow_factors?.net_premium_5m != null ? 'LIVE' : 'MISSING';
  const gexStatus  = (signal.uw_factors?.dealer_factors?.gex_by_strike?.length ?? 0) > 0 ? 'PARTIAL' : 'MISSING';
  const dpStatus   = (signal.darkpool_behavior_engine?.clusters?.length ?? 0) > 0 ? 'LIVE' : 'MISSING';
  const ivStatus   = signal.uw_factors?.volatility_factors?.iv30 != null ? 'LIVE' : 'MISSING';
  const vixStatus  = vd.vix != null ? 'LIVE' : 'MISSING';
  const pvStatus   = pve.has_enough_history === true ? 'LIVE' : 'COLD_START';

  const weights = { LIVE: 1, PARTIAL: 0.5, COLD_START: 0.3, MISSING: 0 };
  const sources = [uwStatus, spotStatus, flowStatus, gexStatus, dpStatus, ivStatus, vixStatus, pvStatus];
  const score   = Math.round(sources.reduce((s, st) => s + (weights[st] ?? 0), 0) / sources.length * 100);

  const homepageLocked = signal.dealer_wall_map?.wall_status !== 'valid' || pve.has_enough_history !== true;

  return {
    score,
    uw_api:          { status: uwStatus,   label: 'UW API' },
    spot:            { status: spotStatus, label: 'Spot',             source: pc.spot_source ?? '--' },
    flow:            { status: flowStatus, label: 'Flow' },
    gex:             { status: gexStatus,  label: 'GEX',              rows: signal.uw_factors?.dealer_factors?.gex_by_strike?.length ?? 0 },
    dark_pool:       { status: dpStatus,   label: 'Dark Pool' },
    iv:              { status: ivStatus,   label: 'IV' },
    vix:             { status: vixStatus,  label: 'VIX' },
    price_validation:{ status: pvStatus,   label: 'Price Validation',
                       buffer_size: pve.buffer_size ?? 0,
                       cold_start_eta_min: pve.has_enough_history ? 0 : Math.max(0, Math.ceil((10 - (pve.buffer_size ?? 0)))) },
    homepage_locked: homepageLocked,
    homepage_locked_reason: homepageLocked
      ? [
          signal.dealer_wall_map?.wall_status !== 'valid' ? 'Wall 校验未完成' : null,
          pve.has_enough_history !== true ? '价格历史冷启动' : null
        ].filter(Boolean).join(' / ')
      : null
  };
}

// ── Forbidden Bar ──────────────────────────────────────────────────────────────
function buildForbiddenBar(signal) {
  const atm = signal.atm_engine || {};
  const dw  = signal.dealer_wall_map || {};
  const ab  = signal.ab_order_engine || {};
  const gr  = signal.gamma_regime_engine || {};

  const warnings = [];
  if ((atm.pin_risk ?? 0) >= 70) warnings.push(`ATM ${fmt(atm.atm)} 附近禁止乱买 0DTE`);
  if (gr.gamma_regime === 'positive' && (atm.pin_risk ?? 0) >= 60) warnings.push('正 Gamma 磁吸区，0DTE 方向单为负期望值');
  if (dw.wall_status === 'unavailable') warnings.push('墙位校验失败，不显示 Call Wall / Put Wall');
  if (ab.status === 'blocked' && ab.blocked_reason) {
    warnings.push(ab.blocked_reason === 'cold_start_or_off_hours'
      ? '非交易时段 / 价格历史不足，禁止开仓'
      : ab.blocked_reason);
  }

  return { warnings, has_warning: warnings.length > 0, primary_warning: warnings[0] ?? null };
}

// ── Strike Battle Table ────────────────────────────────────────────────────────
function buildStrikeBattle(signal) {
  const gexRows = signal.uw_factors?.dealer_factors?.gex_by_strike ?? [];
  const spot    = signal.price_contract?.spot ?? signal.price_contract?.live_price ?? null;

  if (spot == null || gexRows.length === 0) return { rows: [], status: 'unavailable' };

  const nearRows = gexRows
    .filter((r) => r.strike != null && Math.abs(r.strike - spot) <= 200)
    .sort((a, b) => a.strike - b.strike);

  const strikeCandidates = [-50, -25, 0, 25, 50, 75].map((d) => Math.round(spot / 25) * 25 + d);
  const keyStrikes = [];
  for (const s of strikeCandidates) {
    const row = nearRows.find((r) => Math.abs(r.strike - s) <= 12);
    if (!row) continue;
    const callGex = row.call_gex ?? 0;
    const putGex  = Math.abs(row.put_gex ?? 0);
    const callLevel = callGex > 1 ? '高' : callGex > 0.1 ? '中' : '低';
    const putLevel  = putGex  > 1 ? '高' : putGex  > 0.1 ? '中' : '低';
    let conclusion = '中性';
    if      (row.strike > spot + 50) conclusion = '强压区';
    else if (row.strike > spot + 20) conclusion = '上方压力';
    else if (row.strike > spot - 20) conclusion = '主战场';
    else                             conclusion = '下方目标';
    keyStrikes.push({ strike: row.strike, call_gex_level: callLevel, put_gex_level: putLevel,
      call_gex: row.call_gex, put_gex: row.put_gex, net_gex: row.net_gex, conclusion });
  }

  const mainBattle = keyStrikes.find((r) => r.conclusion === '主战场');
  const upperPressure = keyStrikes.find((r) => r.conclusion === '上方压力');
  const note = mainBattle
    ? `资金主战场在 ${mainBattle.strike}${upperPressure ? `–${upperPressure.strike}` : ''}，未脱离前首页容易锁仓。`
    : 'Strike 数据不足。';

  return { rows: keyStrikes, status: keyStrikes.length > 0 ? 'partial' : 'unavailable', note };
}

// ── Vanna/Charm Table ──────────────────────────────────────────────────────────
function buildVannaCharmTable(signal) {
  const gexRows = signal.uw_factors?.dealer_factors?.gex_by_strike ?? [];
  const spot    = signal.price_contract?.spot ?? signal.price_contract?.live_price ?? null;

  if (spot == null || gexRows.length === 0) return { rows: [], status: 'unavailable' };

  const nearRows = gexRows
    .filter((r) => r.strike != null && Math.abs(r.strike - spot) <= 100)
    .sort((a, b) => a.strike - b.strike)
    .slice(0, 6);

  const rows = nearRows.map((r) => {
    const netVanna = r.net_vanna ?? 0;
    const netCharm = r.net_charm ?? 0;
    let talk = '中性区';
    if      (r.strike > spot + 30) talk = '上方压制';
    else if (r.strike > spot + 10) talk = '上方敏感';
    else if (r.strike < spot - 30) talk = '下方支撑';
    else if (r.strike < spot - 10) talk = '下方敏感';
    else                           talk = '主战场';
    return {
      strike: r.strike,
      net_vanna: netVanna, net_vanna_label: netVanna > 0 ? '正' : netVanna < 0 ? '负' : '中',
      net_charm: netCharm, net_charm_label: netCharm > 0 ? '正' : netCharm < 0 ? '负' : '中',
      talk
    };
  });

  const aboveStrikes = rows.filter((r) => r.strike > spot).map((r) => r.strike).slice(0, 2);
  const note = aboveStrikes.length > 0
    ? `上方 ${aboveStrikes.join('–')} 压制明显，Call 到那里不要追。`
    : 'Vanna/Charm 数据不足。';

  return { rows, status: rows.length > 0 ? 'partial' : 'unavailable', note };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function _isMarketHours() {
  const now = new Date();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 9:30–16:00 ET (EDT) = 13:30–20:00 UTC
  return utcMinutes >= 13 * 60 + 30 && utcMinutes < 20 * 60;
}

// ── Main Export ────────────────────────────────────────────────────────────────
export function buildSignalFormatter(signal) {
  return {
    primary_card:  buildPrimaryCard(signal),
    sentiment_bar: buildSentimentBar(signal),
    levels:        buildLevels(signal),
    money_read:    buildMoneyRead(signal),
    darkpool_read: buildDarkpoolRead(signal),
    vol_dashboard: buildVolDashboard(signal),
    vix_dashboard: buildVixDashboard(signal),
    forbidden_bar: buildForbiddenBar(signal),
    data_health:   buildDataHealth(signal),
    strike_battle: buildStrikeBattle(signal),
    vanna_charm:   buildVannaCharmTable(signal)
  };
}
