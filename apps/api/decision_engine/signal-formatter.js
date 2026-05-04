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
// v2: Uses atm_trigger_engine for ATM±5/10 trigger lines (not far GEX walls)
// Three-state output: LONG_CALL / SHORT_PUT / LOCKED
function buildPrimaryCard(signal) {
  const ab  = signal.ab_order_engine     || {};
  const atm = signal.atm_engine          || {};
  const ate = signal.atm_trigger_engine  || {};  // NEW: ATM Trigger Engine
  const gr  = signal.gamma_regime_engine || {};
  const fb  = signal.flow_behavior_engine || {};
  const pc  = signal.price_contract      || {};
  const dw  = signal.dealer_wall_map     || {};
  const pve = signal.price_validation_engine || {};
  const spot    = pc.spot ?? pc.live_price ?? null;
  const spotFmt = spot != null ? `SPX ${fmt(spot, 1)}` : 'SPX --';

  // ── ATM Trigger Lines (from atm_trigger_engine) ──────────────────────────
  const atmVal        = ate.atm          ?? atm.atm ?? null;
  const bull1         = ate.bull_trigger_1 ?? null;  // ATM+5
  const bull2         = ate.bull_trigger_2 ?? null;  // ATM+10
  const bullTgt1      = ate.bull_target_1  ?? null;  // ATM+15
  const bullTgt2      = ate.bull_target_2  ?? null;  // ATM+20
  const bear1         = ate.bear_trigger_1 ?? null;  // ATM-5
  const bear2         = ate.bear_trigger_2 ?? null;  // ATM-10
  const bearTgt1      = ate.bear_target_1  ?? null;  // ATM-15
  const bearTgt2      = ate.bear_target_2  ?? null;  // ATM-20
  const invBull       = ate.invalidation_bull ?? null;  // ATM-10
  const invBear       = ate.invalidation_bear ?? null;  // ATM+10
  const triggerStatus = ate.trigger_status ?? 'locked';
  const spotInLock    = ate.spot_in_lock_zone ?? true;

  // Far walls go to Radar only (never used as homepage triggers)
  const globalCallWall = ate.global_call_wall ?? dw.global_call_gex_cluster ?? null;
  const globalPutWall  = ate.global_put_wall  ?? dw.global_put_gex_cluster  ?? null;

  // ── Determine primary direction (three-state: LONG_CALL / SHORT_PUT / LOCKED) ──
  let direction      = 'LOCKED';
  let directionLabel = '锁仓';
  let directionColor = 'gray';
  let badge          = 'LOCKED';

  // Priority 1: ab_order_engine has a confirmed direction
  if (ab.status !== 'blocked' && ab.plan_a) {
    const planADir = ab.plan_a.direction ?? '';
    if (planADir === 'long' || planADir === 'bullish') {
      direction = 'LONG_CALL'; directionLabel = '做 Call'; directionColor = 'green'; badge = 'LONG_CALL';
    } else if (planADir === 'short' || planADir === 'bearish') {
      direction = 'SHORT_PUT'; directionLabel = '做 Put'; directionColor = 'red'; badge = 'SHORT_PUT';
    }
  }

  // Priority 2: ATM trigger engine confirms direction (only when both trigger + flow align)
  if (direction === 'LOCKED') {
    if (triggerStatus === 'bull_triggered' && fb.behavior === 'call_effective') {
      direction = 'LONG_CALL'; directionLabel = '做 Call'; directionColor = 'green'; badge = 'LONG_CALL';
    } else if (triggerStatus === 'bear_triggered' && fb.behavior === 'put_effective') {
      direction = 'SHORT_PUT'; directionLabel = '做 Put'; directionColor = 'red'; badge = 'SHORT_PUT';
    }
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  const conf = ab.execution_confidence ?? 0;
  let confLabel = '低｜只观察';
  let confColor = 'gray';
  if      (conf >= 70) { confLabel = '高｜可执行';      confColor = 'green'; }
  else if (conf >= 40) { confLabel = '中｜小仓等确认';  confColor = 'amber'; }
  else                 { confLabel = '低｜只观察';       confColor = 'gray';  }

  // ── Build active plan ─────────────────────────────────────────────────────
  const atmStr  = atmVal != null ? String(Math.round(atmVal)) : '--';
  const b1Str   = bull1  != null ? String(Math.round(bull1))  : '--';
  const b2Str   = bull2  != null ? String(Math.round(bull2))  : '--';
  const r1Str   = bear1  != null ? String(Math.round(bear1))  : '--';
  const r2Str   = bear2  != null ? String(Math.round(bear2))  : '--';
  const bt1Str  = bullTgt1 != null ? String(Math.round(bullTgt1)) : '--';
  const bt2Str  = bullTgt2 != null ? String(Math.round(bullTgt2)) : '--';
  const brt1Str = bearTgt1 != null ? String(Math.round(bearTgt1)) : '--';
  const brt2Str = bearTgt2 != null ? String(Math.round(bearTgt2)) : '--';
  const invBullStr = invBull != null ? String(Math.round(invBull)) : '--';
  const invBearStr = invBear != null ? String(Math.round(invBear)) : '--';

  const gammaNote = gr.gamma_regime === 'positive'
    ? `正 Gamma 磁吸，做市商把价格拉回 ${atmStr} ATM，来回割。`
    : gr.gamma_regime === 'negative'
      ? `负 Gamma 放波，方向确认后单边行情概率高。`
      : `等方向确认。`;

  let activePlan = null;
  if (direction === 'LONG_CALL') {
    const abPlan = ab.plan_a ?? null;
    activePlan = {
      state:        '多头预案',
      why:          `价格站上 ${b1Str} 第一触发线，等 ${b2Str} 确认后做多`,
      entry:        abPlan?.entry ?? `${b2Str} 站稳后回踩 8EMA 入场`,
      action:       `做 Call：${b2Str} 站稳确认，目标 ${bt1Str}–${bt2Str}`,
      stop:         abPlan?.stop ?? `${invBullStr} 跌破止损`,
      target:       abPlan?.target ?? `${bt1Str} → ${bt2Str}`,
      forbidden:    `禁止在 ${atmStr} ATM 附近直接追多；禁止在 Put Flow 增强时买 Call`,
      invalidation: `有效跌破 ${invBullStr}，多头预案作废`
    };
  } else if (direction === 'SHORT_PUT') {
    const abPlan = ab.plan_a ?? null;
    activePlan = {
      state:        '空头预案',
      why:          `价格跌破 ${r1Str} 第一触发线，等 ${r2Str} 确认后做空`,
      entry:        abPlan?.entry ?? `${r2Str} 跌破后反抽 8EMA 入场`,
      action:       `做 Put：${r2Str} 跌破确认，目标 ${brt1Str}–${brt2Str}`,
      stop:         abPlan?.stop ?? `${invBearStr} 站上止损`,
      target:       abPlan?.target ?? `${brt1Str} → ${brt2Str}`,
      forbidden:    `禁止在 ${atmStr} ATM 附近直接追空；禁止在 Call Flow 增强时买 Put`,
      invalidation: `有效站上 ${invBearStr}，空头预案作废`
    };
  } else {
    // LOCKED: ATM observation plan
    activePlan = {
      state:        '锁仓观察',
      why:          spotInLock
        ? `价格在 ${r1Str}–${b1Str} ATM 锁仓区内。${gammaNote}`
        : (ate.trigger_label ?? `等 ${b1Str} 站稳或 ${r1Str} 跌破`),
      watch:        `上方 ${b1Str} 能不能站稳 / 下方 ${r1Str} 能不能跌破`,
      wait_long:    `站稳 ${b1Str}（第一触发），等 ${b2Str} 确认，目标 ${bt1Str}–${bt2Str}`,
      wait_short:   `跌破 ${r1Str}（第一触发），等 ${r2Str} 确认，目标 ${brt1Str}–${brt2Str}`,
      forbidden:    `${r1Str}–${b1Str} ATM 锁仓区内禁止买 Call / Put`,
      invalidation: `多头失效线 ${invBullStr} / 空头失效线 ${invBearStr}`,
      confidence:   conf,
      confidence_label: confLabel
    };
    // Fallback to ab_order_engine plan if atm_trigger_engine has no data
    if (!ate.atm && ab.plan_a) {
      activePlan = {
        state: ab.plan_a.state ?? '锁仓观察', why: ab.plan_a.why ?? '--',
        watch: ab.plan_a.watch ?? '--', wait_long: ab.plan_a.wait_long ?? '--',
        wait_short: ab.plan_a.wait_short ?? '--', forbidden: ab.plan_a.forbidden ?? '--',
        invalidation: ab.plan_a.invalidation ?? '--', confidence: conf, confidence_label: confLabel
      };
    }
  }

  const headline    = ab.headline || `${spotFmt} ｜ ${directionLabel} ｜ ${triggerStatus === 'locked' ? 'ATM 附近不做' : (ate.trigger_label ?? '等待条件')}`;
  const subHeadline = activePlan?.state ?? (ab.status === 'blocked' ? (ab.status_cn ?? '等待条件满足') : '');

  return {
    direction, direction_label: directionLabel, direction_color: directionColor, badge,
    headline, sub_headline: subHeadline,
    plan: activePlan,
    plan_b: ab.plan_b ?? null,
    spot, spot_fmt: spotFmt,
    spot_source: pc.spot_source ?? '--',
    spot_status: pc.spot_status ?? 'unknown',
    last_updated: signal.last_updated ?? null,
    uw_live: signal.source_display?.uw?.status === 'live',
    dominant_scene: pve.dominant_scene ?? null,
    scene_warnings: pve.active_scenes ?? [],
    alert_level: pve.alert_level ?? 'normal',
    locked: direction === 'LOCKED',
    locked_reason: ab.blocked_reason ?? null,
    execution_confidence: conf,
    confidence_label: confLabel,
    confidence_color: confColor,
    // ATM trigger context (for frontend rendering)
    trigger_status: triggerStatus,
    trigger_label:  ate.trigger_label ?? null,
    atm:            atmVal,
    atm_fmt:        atmVal != null ? fmt(atmVal) : '--',
    bull_trigger_1: bull1, bull_trigger_1_fmt: bull1 != null ? fmt(bull1) : '--',
    bull_trigger_2: bull2, bull_trigger_2_fmt: bull2 != null ? fmt(bull2) : '--',
    bull_target_1:  bullTgt1, bull_target_1_fmt: bullTgt1 != null ? fmt(bullTgt1) : '--',
    bull_target_2:  bullTgt2, bull_target_2_fmt: bullTgt2 != null ? fmt(bullTgt2) : '--',
    bear_trigger_1: bear1, bear_trigger_1_fmt: bear1 != null ? fmt(bear1) : '--',
    bear_trigger_2: bear2, bear_trigger_2_fmt: bear2 != null ? fmt(bear2) : '--',
    bear_target_1:  bearTgt1, bear_target_1_fmt: bearTgt1 != null ? fmt(bearTgt1) : '--',
    bear_target_2:  bearTgt2, bear_target_2_fmt: bearTgt2 != null ? fmt(bearTgt2) : '--',
    invalidation_bull: invBull, invalidation_bull_fmt: invBull != null ? fmt(invBull) : '--',
    invalidation_bear: invBear, invalidation_bear_fmt: invBear != null ? fmt(invBear) : '--',
    spot_in_lock_zone: spotInLock,
    // Far walls (Radar only — NOT homepage triggers)
    global_call_wall: globalCallWall,
    global_put_wall:  globalPutWall,
    global_call_wall_fmt: globalCallWall != null ? fmt(globalCallWall) : '--',
    global_put_wall_fmt:  globalPutWall  != null ? fmt(globalPutWall)  : '--'
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
// v2: Uses atm_trigger_engine for near-term trigger lines
// bull_trigger / bear_trigger now = ATM±5 (not far GEX walls)
// Far walls go to global_call_wall / global_put_wall (Radar only)
function buildLevels(signal) {
  const atm = signal.atm_engine          || {};
  const ate = signal.atm_trigger_engine  || {};  // NEW
  const dw  = signal.dealer_wall_map     || {};
  const pc  = signal.price_contract      || {};
  const spot       = pc.spot ?? pc.live_price ?? null;
  const atmLevel   = ate.atm ?? atm.atm ?? null;
  const wallStatus = dw.wall_status ?? 'unavailable';

  // ── Near trigger lines (ATM±5/10 from atm_trigger_engine) ─────────────────
  const bull1 = ate.bull_trigger_1 ?? null;  // ATM+5
  const bull2 = ate.bull_trigger_2 ?? null;  // ATM+10
  const bear1 = ate.bear_trigger_1 ?? null;  // ATM-5
  const bear2 = ate.bear_trigger_2 ?? null;  // ATM-10

  // ── Far walls (Radar only, not homepage triggers) ──────────────────────────
  const globalCallWall = ate.global_call_wall ?? dw.global_call_gex_cluster ?? null;
  const globalPutWall  = ate.global_put_wall  ?? dw.global_put_gex_cluster  ?? null;

  // ── Near walls (ATM±50, homepage background only) ─────────────────────────
  const nearCallWall = ate.near_call_wall ?? (wallStatus !== 'unavailable' ? (dw.gex_local_call_wall ?? null) : null);  // homepage: ATM±50 from ate, or ±30pt local
  const nearPutWall  = ate.near_put_wall  ?? (wallStatus !== 'unavailable' ? (dw.gex_local_put_wall  ?? null) : null);  // homepage: ATM±50 from ate, or ±30pt local

  // Gamma flip display
  const gammaFlip  = dw.gamma_flip ?? null;
  const flipFar    = gammaFlip != null && spot != null && Math.abs(gammaFlip - spot) > 200;
  const flipDisplay = flipFar
    ? 'Gamma Flip：远离现价，不参与日内执行。'
    : (gammaFlip != null ? `Gamma Flip ${fmt(gammaFlip)}` : '翻转点不可判断');

  // Life/death line (ATM-10 = invalidation_bull from atm_trigger_engine)
  const lifeDeath = ate.invalidation_bull ?? (!flipFar && gammaFlip != null ? gammaFlip
    : (atmLevel != null ? atmLevel - 10 : null));

  // ── Hint (ATM-relative, not wall-relative) ─────────────────────────────────
  let hint = null;
  const spotInLock = ate.spot_in_lock_zone ?? (
    atmLevel != null && spot != null && Math.abs(spot - atmLevel) <= 5
  );
  if (spotInLock) {
    hint = `${fmt(atmLevel)} ATM 附近不做。等 ${bull1 != null ? fmt(bull1) : '--'} 站稳或 ${bear1 != null ? fmt(bear1) : '--'} 跌破。`;
  } else if (ate.trigger_status === 'bull_watching') {
    hint = `价格在 ${fmt(bull1)} 上方，等 ${fmt(bull2)} 站稳确认多头。`;
  } else if (ate.trigger_status === 'bear_watching') {
    hint = `价格在 ${fmt(bear1)} 下方，等 ${fmt(bear2)} 跌破确认空头。`;
  } else if (ate.trigger_status === 'bull_triggered') {
    hint = `多头确认：${fmt(bull2)} 站稳，目标 ${ate.bull_target_1_fmt ?? '--'}–${ate.bull_target_2_fmt ?? '--'}。`;
  } else if (ate.trigger_status === 'bear_triggered') {
    hint = `空头确认：${fmt(bear2)} 跌破，目标 ${ate.bear_target_1_fmt ?? '--'}–${ate.bear_target_2_fmt ?? '--'}。`;
  }

  return {
    atm: atmLevel,
    atm_fmt: atmLevel != null ? fmt(atmLevel) : '--',

    // ── Near trigger lines (ATM±5/10) — homepage primary ──────────────────
    bull_trigger:       bull1,
    bull_trigger_fmt:   bull1 != null ? fmt(bull1) : 'unavailable',
    bull_trigger_2:     bull2,
    bull_trigger_2_fmt: bull2 != null ? fmt(bull2) : 'unavailable',
    bear_trigger:       bear1,
    bear_trigger_fmt:   bear1 != null ? fmt(bear1) : 'unavailable',
    bear_trigger_2:     bear2,
    bear_trigger_2_fmt: bear2 != null ? fmt(bear2) : 'unavailable',

    // ── Targets ────────────────────────────────────────────────────────────
    bull_target_1: ate.bull_target_1 ?? null,
    bull_target_1_fmt: ate.bull_target_1_fmt ?? '--',
    bull_target_2: ate.bull_target_2 ?? null,
    bull_target_2_fmt: ate.bull_target_2_fmt ?? '--',
    bear_target_1: ate.bear_target_1 ?? null,
    bear_target_1_fmt: ate.bear_target_1_fmt ?? '--',
    bear_target_2: ate.bear_target_2 ?? null,
    bear_target_2_fmt: ate.bear_target_2_fmt ?? '--',

    // ── Invalidation lines ─────────────────────────────────────────────────
    invalidation_bull: ate.invalidation_bull ?? null,
    invalidation_bull_fmt: ate.invalidation_bull_fmt ?? '--',
    invalidation_bear: ate.invalidation_bear ?? null,
    invalidation_bear_fmt: ate.invalidation_bear_fmt ?? '--',

    // ── Lock zone ──────────────────────────────────────────────────────────
    lock_zone: ate.lock_zone ?? null,
    spot_in_lock_zone: spotInLock,

    // ── Life/death line ────────────────────────────────────────────────────
    life_death: lifeDeath,
    life_death_fmt: lifeDeath != null ? fmt(lifeDeath) : '--',

    // ── Gamma flip ─────────────────────────────────────────────────────────
    gamma_flip: gammaFlip,
    gamma_flip_display: flipDisplay,
    gamma_flip_far: flipFar,

    // ── Near walls (ATM±50, homepage background) ───────────────────────────
    near_call_wall: nearCallWall,
    near_put_wall:  nearPutWall,
    near_call_wall_fmt: nearCallWall != null ? fmt(nearCallWall) : '--',
    near_put_wall_fmt:  nearPutWall  != null ? fmt(nearPutWall)  : '--',

    // ── GEX local reference walls (±30pt of spot, homepage GEX card only) ───
    gex_local_call_wall: dw.gex_local_call_wall ?? null,
    gex_local_put_wall:  dw.gex_local_put_wall  ?? null,
    gex_local_call_wall_fmt: dw.gex_local_call_wall != null ? fmt(dw.gex_local_call_wall) : null,
    gex_local_put_wall_fmt:  dw.gex_local_put_wall  != null ? fmt(dw.gex_local_put_wall)  : null,

    // ── Far walls (Radar only) ─────────────────────────────────────────────
    global_call_wall: globalCallWall,
    global_put_wall:  globalPutWall,
    global_call_wall_fmt: globalCallWall != null ? fmt(globalCallWall) : '--',
    global_put_wall_fmt:  globalPutWall  != null ? fmt(globalPutWall)  : '--',

    // Legacy fields (kept for backward compat)
    wall_status: wallStatus,
    wall_errors: dw.wall_errors ?? [],
    global_call_gex_cluster: dw.global_call_gex_cluster ?? null,
    global_put_gex_cluster:  dw.global_put_gex_cluster  ?? null,
    global_gex_clusters:     dw.global_gex_clusters     ?? [],

    hint,
    trigger_status: ate.trigger_status ?? 'unknown',
    trigger_label:  ate.trigger_label  ?? null,
    gamma_note:     ate.gamma_note     ?? null,
    pin_risk: atm.pin_risk ?? null,
    pin_warning: (atm.pin_risk ?? 0) >= 70 ? `ATM ${fmt(atmLevel)} 附近禁止乱买 0DTE` : null
  };
}

// ── Money Read (资金人话) ──────────────────────────────────────────────────────
function buildMoneyRead(signal) {
  const fb = signal.flow_behavior_engine || {};
  const uf = signal.uw_factors || {};
  const ff = uf.flow_factors || {};
  const gr = signal.gamma_regime_engine || {};
  const dw = signal.dealer_wall_map || {};
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
  // ── 做市商路径 ──────────────────────────────────────────────────────────────
  const atmVal  = signal.atm_engine?.atm ?? null;
  const cwVal   = dw.gex_local_call_wall ?? dw.far_call_wall ?? null;  // homepage: ±30pt local, fallback to far
  const pwVal   = dw.gex_local_put_wall  ?? dw.far_put_wall  ?? null;  // homepage: ±30pt local, fallback to far
  const atmFmt  = atmVal != null ? String(Math.round(atmVal))  : '--';
  const cwFmt   = cwVal  != null ? String(Math.round(cwVal))   : '--';
  const pwFmt   = pwVal  != null ? String(Math.round(pwVal))   : '--';
  const gammaRegime = gr.gamma_regime ?? 'unknown';
  let mmPath = '方向不明，等待数据。';
  let mmTalk = '做市商路径不明，等待数据改善。';
  // ── ATM Trigger Engine context for mm_path_card ──────────────────────────
  const ate    = signal.atm_trigger_engine || {};
  // Guard: only use absolute prices (>= 1000 for SPX). Relative offsets (e.g. 5, -5) are invalid.
  const _ateAbsolute = (v) => (v != null && Number.isFinite(Number(v)) && Math.abs(Number(v)) >= 1000) ? String(Math.round(Number(v))) : null;
  const bull1F = ate.bull_trigger_1_fmt ?? _ateAbsolute(ate.bull_trigger_1) ?? '--';
  const bull2F = ate.bull_trigger_2_fmt ?? _ateAbsolute(ate.bull_trigger_2) ?? '--';
  const bear1F = ate.bear_trigger_1_fmt ?? _ateAbsolute(ate.bear_trigger_1) ?? '--';
  const bear2F = ate.bear_trigger_2_fmt ?? _ateAbsolute(ate.bear_trigger_2) ?? '--';
  const bt1F   = ate.bull_target_1_fmt  ?? '--';
  const bt2F   = ate.bull_target_2_fmt  ?? '--';
  const brt1F  = ate.bear_target_1_fmt  ?? '--';
  const brt2F  = ate.bear_target_2_fmt  ?? '--';
  // Far walls (background only)
  const farCallFmt = ate.global_call_wall_fmt ?? (dw.global_call_gex_cluster != null ? String(Math.round(dw.global_call_gex_cluster)) : '--');
  const farPutFmt  = ate.global_put_wall_fmt  ?? (dw.global_put_gex_cluster  != null ? String(Math.round(dw.global_put_gex_cluster))  : '--');
  // 5m+15m dual window narrative
  const dualNarrative = fb.dual_window_narrative ?? null;
  const flow5mLabel   = fb.flow_5m_label  ?? null;
  const flow15mLabel  = fb.flow_15m_label ?? null;

  let mmBullScene = `先看 ${bull1F} / ${bull2F}，不是 ${farCallFmt}。站稳 ${bull2F} 后目标 ${bt1F}–${bt2F}。`;
  let mmBearScene = `先看 ${bear1F} / ${bear2F}，不是 ${farPutFmt}。跌破 ${bear2F} 后目标 ${brt1F}–${brt2F}。`;
  let mmAction    = `${atmFmt} ATM 附近不做，等 ${bull1F} 站稳或 ${bear1F} 跌破。`;
  if (gammaRegime === 'positive') {
    mmPath   = '正 Gamma 吸回 ATM。';
    mmTalk   = `做市商更容易把价格吸回 ${atmFmt} 附近，让 Call 和 Put 都磨损。${atmFmt} 附近不要乱做，等 ${bull1F} 站稳或 ${bear1F} 跌破。`;
    mmAction = `${atmFmt} ATM 附近不做，等 ${bull1F} 站稳或 ${bear1F} 跌破。`;
  } else if (gammaRegime === 'negative') {
    mmPath   = '负 Gamma 放大波动。';
    mmTalk   = `负 Gamma 环境，做市商需要反向对冲，价格波动容易被放大，单边行情概率更高。方向确认后可以跟，但要快进快出。`;
    mmAction = `方向确认后可以跟，但要快进快出，不要在 ${atmFmt} 附近磨。`;
  }
  const mmPathCard = {
    current_path:   mmPath,
    talk:           mmTalk,
    bull_scene:     mmBullScene,
    bear_scene:     mmBearScene,
    current_action: mmAction,
    gamma_regime:   gammaRegime,
    // ATM trigger lines for mm_path_card display
    atm_fmt:        atmFmt,
    bull_trigger_1: bull1F, bull_trigger_2: bull2F,
    bear_trigger_1: bear1F, bear_trigger_2: bear2F,
    bull_target_1:  bt1F,   bull_target_2:  bt2F,
    bear_target_1:  brt1F,  bear_target_2:  brt2F,
    // Far walls (background only, not triggers)
    far_call_wall:  farCallFmt,
    far_put_wall:   farPutFmt,
    far_wall_note:  `远端墙：${farCallFmt} / ${farPutFmt} 只作背景，不作日内触发。`,
    // 5m+15m dual window
    dual_window_narrative: dualNarrative,
    flow_5m_label:  flow5mLabel,
    flow_15m_label: flow15mLabel,
    dual_window_aligned: fb.dual_window_aligned ?? false
  };
  // 做市商会干嘛（资金模块内嵌）
  // v3: mmWhatToDo uses ATM trigger lines (bull1F/bear1F), NOT near_call_wall/near_put_wall
  let mmWhatToDo = `${atmFmt} 附近不做。等上破 ${bull1F} 或下破 ${bear1F}。`;
  if (behavior === 'put_squeezed') {
    mmWhatToDo = `Put 还重，但价格不跌，说明下方有人托。${atmFmt} 附近不追空，等 ${bear2F} 真正跌破确认。`;
  } else if (behavior === 'mixed') {
    mmWhatToDo = `有资金在托，但空头保护盘还没撤。${atmFmt} 附近不做，等 ${bull1F} 站稳或 ${bear1F} 跌破。`;
  } else if (behavior === 'call_effective') {
    mmWhatToDo = `Call 流入有效，但先等 ${bull1F} 站稳、${bull2F} 确认，不要在 ${atmFmt} 附近追多。`;
  } else if (behavior === 'put_effective') {
    mmWhatToDo = `Put 流入有效，但先等 ${bear1F} 跌破、${bear2F} 确认，不要在 ${atmFmt} 附近追空。`;
  } else if (behavior === 'call_capped') {
    mmWhatToDo = `Call 被压制，${bull1F} 是第一关，站不住就不追多。${atmFmt} 附近卖权占优。`;
  }
  return {
    title, body,
    mm_what_to_do: mmWhatToDo,
    mm_path_card: mmPathCard,
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
      if (behavior === 'upper_dispatch' || behavior === 'breakout') {
        title = '上面有人压';
        body  = `${fmt(level)}${lvl2 ? `–${fmt(lvl2)}` : ''} 有大额成交，价格冲到这里站不上说明上面有人压；站稳说明卖压被吃掉。`;
      } else if (behavior === 'lower_brake_zone' || behavior === 'breakdown') {
        title = '下面有人托';
        body  = `${fmt(level)} 有大额成交，价格回踩这里不破说明下面有人托；跌破收不回说明托盘失败。`;
      } else if (behavior === 'cluster_wall') {
        title = '暗盘墙位';
        body  = `${fmt(level)} 附近有强暗盘聚集，价格容易在此来回震荡。`;
      } else {
        title = dp.behavior_cn ?? '暗盘活跃';
        body  = `暗盘区 ${fmt(level)}${prem != null ? `，成交 $${prem.toFixed(1)}M` : ''}。`;
      }
    } else {
      // 非交易时段：只显示位置，不判断动能
      title = '暗盘脚印';
      const parts = clusters.slice(0, 2).map((c) => {
        const lv = c.spx_level ?? null;
        const pr = c.total_premium_millions ?? null;
        const isAbove = spot != null && lv != null && lv > spot;
        const posLabel = isAbove ? '上面压盘位' : '下面托盘位';
        return `${fmt(lv)} ${posLabel}${pr != null ? `（$${pr.toFixed(1)}M）` : ''}`;
      });
      body = (parts.length > 0 ? parts.join('，') + '。' : '') + '等开盘确认。';
    }
  }
  const levelList = clusters.slice(0, 3).map((c) => {
    const lv = c.spx_level ?? null;
    const pr = c.total_premium_millions ?? null;
    const isAbove = spot != null && lv != null && lv > spot;
    let posLabel, posDesc, posDetail;
    if (isMarketHours) {
      posLabel  = c.behavior_cn ?? c.behavior ?? '--';
      posDesc   = c.behavior === 'upper_dispatch' ? '上面有人压' : c.behavior === 'lower_brake_zone' ? '下面有人托' : posLabel;
      posDetail = c.behavior === 'upper_dispatch'
        ? '站不上 = 有人压｜站稳 = 卖压被吃掉'
        : c.behavior === 'lower_brake_zone'
        ? '不破 = 有人托｜跌破收不回 = 托盘失败'
        : posLabel;
    } else {
      posLabel  = isAbove ? '上面压盘位' : '下面托盘位';
      posDesc   = '等开盘确认';
      posDetail = isAbove ? '冲不上 = 有人压｜站稳 = 卖压被吃掉' : '不破 = 有人托｜跌破收不回 = 托盘失败';
    }
    return {
      level: lv,
      level_fmt: lv != null ? fmt(lv) : '--',
      premium_fmt: pr != null ? `$${pr.toFixed(1)}M` : '--',
      behavior: c.behavior ?? 'unknown',
      behavior_cn: c.behavior_cn ?? '--',
      label: posLabel,
      pos_desc: posDesc,
      pos_detail: posDetail,
      is_above_spot: isAbove
    };
  });
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
  const vixSource = vd.vix_source ?? 'FMP';
  const vixSourceStatus = vd.vix_source_status ?? (vix != null ? 'live' : 'limit_reach');
  let riskSentiment, riskColor, commentary;
  if (vix != null) {
    if      (vix > 30) { riskSentiment = '极度恐慌'; riskColor = 'red';   commentary = `VIX ${vix.toFixed(1)} 极度恐慌，IV 溢价高，买 Put 成本极高。`; }
    else if (vix > 20) { riskSentiment = '恐慌';     riskColor = 'amber'; commentary = `VIX ${vix.toFixed(1)} 偏高，市场有恐慌情绪，买方成本上升。`; }
    else if (vix > 15) { riskSentiment = '正常偏高'; riskColor = 'amber'; commentary = `VIX ${vix.toFixed(1)} 正常偏高，可以做买方但需快进快出。`; }
    else               { riskSentiment = '正常';     riskColor = 'green'; commentary = `VIX ${vix.toFixed(1)} 正常，没有恐慌，不支持无脑追 Put。`; }
  } else {
    // VIX 不可用时，不允许显示"正常"
    riskSentiment = '不参与判断';
    riskColor     = 'gray';
    const sourceMsg = vixSourceStatus === 'limit_reach' ? 'FMP 今日超限' : 'VIX 数据不可用';
    commentary    = `${sourceMsg}，VIX 暂不参与主控判断。`;
  }
  return {
    vix, vix_fmt: vix != null ? vix.toFixed(1) : '不可用',
    risk_sentiment: riskSentiment, risk_color: riskColor,
    commentary, status: vix != null ? 'live' : 'missing',
    source: vixSource,
    source_status: vixSourceStatus
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
  const moneyRead = buildMoneyRead(signal);
  return {
    primary_card:  buildPrimaryCard(signal),
    sentiment_bar: buildSentimentBar(signal),
    levels:        buildLevels(signal),
    money_read:    moneyRead,
    mm_path_card:  moneyRead.mm_path_card ?? null,
    darkpool_read: buildDarkpoolRead(signal),
    vol_dashboard: buildVolDashboard(signal),
    vix_dashboard: buildVixDashboard(signal),
    forbidden_bar: buildForbiddenBar(signal),
    data_health:   buildDataHealth(signal),
    strike_battle: buildStrikeBattle(signal),
    vanna_charm:   buildVannaCharmTable(signal)
  };
}
