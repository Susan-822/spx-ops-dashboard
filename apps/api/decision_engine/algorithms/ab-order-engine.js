/**
 * ab-order-engine.js  — L2.5 Institutional A/B Order Generator
 *
 * v3: Fully ATM-trigger-based. Far GEX walls (7200/7000) are background only.
 *
 * Inputs:
 *   spot_price, atm, gamma_flip, call_wall, put_wall (far walls, background only)
 *   atm_trigger: { bull_trigger_1, bull_trigger_2, bull_target_1, bull_target_2,
 *                  bear_trigger_1, bear_trigger_2, bear_target_1, bear_target_2,
 *                  invalidation_bull, invalidation_bear }
 *   gamma_regime, flow_behavior, execution_confidence, pin_risk
 *   darkpool_conclusion, net_premium_millions, acceleration_15m
 *   dominant_scene, alert_level
 */
function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmt(v, d = 0) {
  if (v == null) return '--';
  return Number(v.toFixed(d)).toString();
}

// ── ATM Trigger Resolver ──────────────────────────────────────────────────────
function resolveAtmTriggers(atm, atm_trigger) {
  const t = atm_trigger || {};
  const a = safeN(atm);
  return {
    bull1:    safeN(t.bull_trigger_1) ?? (a != null ? a + 5  : null),
    bull2:    safeN(t.bull_trigger_2) ?? (a != null ? a + 10 : null),
    bullTgt1: safeN(t.bull_target_1)  ?? (a != null ? a + 15 : null),
    bullTgt2: safeN(t.bull_target_2)  ?? (a != null ? a + 20 : null),
    bear1:    safeN(t.bear_trigger_1) ?? (a != null ? a - 5  : null),
    bear2:    safeN(t.bear_trigger_2) ?? (a != null ? a - 10 : null),
    bearTgt1: safeN(t.bear_target_1)  ?? (a != null ? a - 15 : null),
    bearTgt2: safeN(t.bear_target_2)  ?? (a != null ? a - 20 : null),
    invBull:  safeN(t.invalidation_bull) ?? (a != null ? a - 10 : null),
    invBear:  safeN(t.invalidation_bear) ?? (a != null ? a + 10 : null),
  };
}

// ── Plan builders ─────────────────────────────────────────────────────────────
function makeLongCallPlan({ atm, atm_trigger, gamma_flip, expiry, dp }) {
  const T = resolveAtmTriggers(atm, atm_trigger);
  const dpCtx = dp && dp.behavior === 'breakout' ? '\uff08\u6697\u76d8 ' + fmt(dp.spx_level) + ' \u7a81\u7834\u786e\u8ba4\uff09' : '';
  return {
    direction: 'BULLISH',
    direction_cn: '\u591a\u5934\u65b9\u5411\u5355',
    instrument: 'Long Call ' + fmt(T.bull1) + ' (' + expiry + ')',
    action_now:   '\u89c2\u671b\uff0c\u7b49 ' + fmt(T.bull1) + ' \u7ad9\u7a33\u540e\u5165\u573a',
    wait_long:    '\u7ad9\u7a33 ' + fmt(T.bull1) + '\uff08\u7b2c\u4e00\u89e6\u53d1\uff09\uff0c\u7b49 ' + fmt(T.bull2) + ' \u786e\u8ba4\uff0cCall Flow \u6301\u7eed\u51c0\u6d41\u5165' + dpCtx,
    wait_short:   '\u4e0d\u9002\u7528',
    forbidden:    '\u7981\u6b62\u5728 ' + fmt(atm) + ' ATM \u9644\u8fd1\u76f4\u63a5\u8ffd\u5165\uff1b\u7981\u6b62\u5728 Put Flow \u589e\u5f3a\u65f6\u4e70 Call',
    invalidation: '\u6709\u6548\u8dcc\u7834 ' + fmt(T.invBull) + '\uff0c\u591a\u5934\u9884\u6848\u4f5c\u5e9f',
    tp1:          fmt(T.bullTgt1),
    tp2:          fmt(T.bullTgt2),
    rationale:    '\u8d1f Gamma \u653e\u6ce2\uff0cCall Flow \u6709\u6548\uff0c\u7ad9\u7a33 ' + fmt(T.bull2) + ' \u540e\u987a\u52bf\u8ffd\u591a'
  };
}

function makeLongPutPlan({ atm, atm_trigger, gamma_flip, expiry, dp }) {
  const T = resolveAtmTriggers(atm, atm_trigger);
  const dpCtx = dp && dp.behavior === 'breakdown' ? '\uff08\u6697\u76d8 ' + fmt(dp.spx_level) + ' \u7834\u4f4d\u786e\u8ba4\uff09' : '';
  return {
    direction: 'BEARISH',
    direction_cn: '\u7a7a\u5934\u65b9\u5411\u5355',
    instrument: 'Long Put ' + fmt(T.bear1) + ' (' + expiry + ')',
    action_now:   '\u89c2\u671b\uff0c\u7b49 ' + fmt(T.bear1) + ' \u8dcc\u7834\u540e\u5165\u573a',
    wait_long:    '\u4e0d\u9002\u7528',
    wait_short:   '\u8dcc\u7834 ' + fmt(T.bear1) + '\uff08\u7b2c\u4e00\u89e6\u53d1\uff09\uff0c\u7b49 ' + fmt(T.bear2) + ' \u786e\u8ba4\uff0cPut Flow \u6301\u7eed\u51c0\u6d41\u5165' + dpCtx,
    forbidden:    '\u7981\u6b62\u5728 ' + fmt(atm) + ' ATM \u4e0a\u65b9\u505a\u7a7a\uff1b\u7981\u6b62\u5728 Call Flow \u589e\u5f3a\u65f6\u4e70 Put',
    invalidation: '\u6709\u6548\u6536\u590d ' + fmt(T.invBear) + '\uff0c\u7a7a\u5934\u9884\u6848\u4f5c\u5e9f',
    tp1:          fmt(T.bearTgt1),
    tp2:          fmt(T.bearTgt2),
    rationale:    '\u8d1f Gamma \u653e\u6ce2\uff0cPut Flow \u6709\u6548\uff0c\u8dcc\u7834 ' + fmt(T.bear2) + ' \u540e\u987a\u52bf\u8ffd\u7a7a'
  };
}

function makeBullPutSpreadPlan({ atm, atm_trigger, put_wall, gamma_flip, expiry, dp }) {
  const T = resolveAtmTriggers(atm, atm_trigger);
  const sellStrike = T.bear1 != null ? T.bear1 - 5 : null;
  const buyStrike  = T.bear1 != null ? T.bear1 - 15 : null;
  const dpCtx = dp && dp.behavior === 'support' ? '\uff08\u6697\u76d8 ' + fmt(dp.spx_level) + ' \u627f\u63a5\u786e\u8ba4\uff09' : '';
  return {
    direction: 'BULLISH',
    direction_cn: '\u591a\u5934\u4ef7\u5dee\u5355',
    instrument: 'Bull Put Spread ' + fmt(sellStrike) + '/' + fmt(buyStrike) + ' (' + expiry + ')',
    action_now:   '\u7b49\u5f85 ' + fmt(T.bear1) + ' \u627f\u63a5\u786e\u8ba4\u540e\u5165\u573a',
    wait_long:    '\u73b0\u4ef7\u7ad9\u7a33 ' + fmt(T.bear1) + ' \u4e0a\u65b9\uff0cPut Flow \u4e0d\u518d\u589e\u5f3a' + dpCtx,
    wait_short:   '\u4e0d\u9002\u7528',
    forbidden:    '\u7981\u6b62\u5728 Put Flow \u6301\u7eed\u589e\u5f3a\u65f6\u5356 Put Spread\uff1b\u7981\u6b62\u5728 ' + fmt(T.bear1) + ' \u7834\u4f4d\u540e\u5165\u573a',
    invalidation: '\u73b0\u4ef7\u6709\u6548\u8dcc\u7834 ' + fmt(T.bear2) + '\uff0cPut Flow \u7ee7\u7eed\u589e\u5f3a',
    tp1:          '\u6743\u5229\u91d1\u6536\u56de 50%',
    tp2:          '\u6743\u5229\u91d1\u6536\u56de 80% \u6216\u5230\u671f',
    rationale:    fmt(T.bear1) + ' \u9644\u8fd1 Put Flow \u88ab\u5438\u6536\uff0c\u6b63 Gamma \u963b\u5c3c\uff0c\u505a\u5e02\u5546\u4e0d\u8ddf\u7a7a'
  };
}

function makeBearCallSpreadPlan({ atm, atm_trigger, call_wall, expiry, dp }) {
  const T = resolveAtmTriggers(atm, atm_trigger);
  const sellStrike = T.bull1 != null ? T.bull1 + 5 : null;
  const buyStrike  = T.bull1 != null ? T.bull1 + 15 : null;
  const dpCtx = dp && dp.behavior === 'resistance' ? '\uff08\u6697\u76d8 ' + fmt(dp.spx_level) + ' \u6d3e\u53d1\u786e\u8ba4\uff09' : '';
  return {
    direction: 'BEARISH',
    direction_cn: '\u7a7a\u5934\u4ef7\u5dee\u5355',
    instrument: 'Bear Call Spread ' + fmt(sellStrike) + '/' + fmt(buyStrike) + ' (' + expiry + ')',
    action_now:   '\u7b49\u5f85 ' + fmt(T.bull1) + ' \u538b\u5236\u786e\u8ba4\u540e\u5165\u573a',
    wait_long:    '\u4e0d\u9002\u7528',
    wait_short:   '\u73b0\u4ef7\u63a5\u8fd1 ' + fmt(T.bull1) + ' \u4e14 Call Flow \u51cf\u5f31' + dpCtx,
    forbidden:    '\u7981\u6b62\u5728 Call Flow \u6301\u7eed\u589e\u5f3a\u65f6\u5356 Call Spread\uff1b\u7981\u6b62\u5728 ' + fmt(T.bull1) + ' \u7a81\u7834\u540e\u5165\u573a',
    invalidation: '\u73b0\u4ef7\u6709\u6548\u7a81\u7834 ' + fmt(T.bull2) + '\uff0cCall Flow \u6301\u7eed\u589e\u5f3a',
    tp1:          '\u6743\u5229\u91d1\u6536\u56de 50%',
    tp2:          '\u6743\u5229\u91d1\u6536\u56de 80% \u6216\u5230\u671f',
    rationale:    fmt(T.bull1) + ' \u9644\u8fd1 Call \u538b\u5236\uff0c\u6b63 Gamma \u963b\u5c3c\uff0c\u505a\u5e02\u5546\u4e0d\u8ddf\u591a'
  };
}

function makeWaitPlan({ reason }) {
  return {
    direction: 'WAIT',
    direction_cn: '\u7b49\u5f85\u786e\u8ba4',
    instrument:   '\u89c2\u671b',
    action_now:   '\u4e0d\u64cd\u4f5c\uff0c\u7b49\u5f85\u4fe1\u53f7\u660e\u786e',
    wait_long:    '\u7b49\u5f85 Gamma \u73af\u5883\u660e\u786e\u540e\u91cd\u65b0\u8bc4\u4f30',
    wait_short:   '\u7b49\u5f85 Gamma \u73af\u5883\u660e\u786e\u540e\u91cd\u65b0\u8bc4\u4f30',
    forbidden:    '\u7981\u6b62\u5728\u5f53\u524d\u4e0d\u660e\u786e\u73af\u5883\u4e2d\u5f00\u4ed3',
    invalidation: 'N/A',
    tp1:          'N/A',
    tp2:          'N/A',
    rationale:    reason || 'Gamma \u73af\u5883\u6216\u8d44\u91d1\u884c\u4e3a\u4e0d\u660e\u786e'
  };
}

// ── Headline generator ────────────────────────────────────────────────────────
function buildHeadline({ gamma_regime, flow_behavior, atm, atm_trigger,
                          net_premium_millions, acceleration_15m, dp }) {
  const T = resolveAtmTriggers(atm, atm_trigger);
  const flowStr = net_premium_millions != null
    ? (net_premium_millions >= 0
        ? '\u51c0\u591a\u5934\u6d41\u5165 $' + Math.abs(net_premium_millions).toFixed(1) + 'M'
        : '\u51c0\u7a7a\u5934\u6d41\u5165 $' + Math.abs(net_premium_millions).toFixed(1) + 'M')
    : '\u8d44\u91d1\u6d41\u5411\u5f85\u63a5\u5165';
  const accelStr = acceleration_15m != null
    ? ' | 15\u5206\u949f\u52a0\u901f\u5ea6 ' + (acceleration_15m > 0 ? '+' : '') + acceleration_15m.toFixed(1) + 'M'
    : '';
  const dpStr = dp && dp.behavior && dp.behavior !== 'unknown'
    ? ' | \u6697\u76d8 ' + fmt(dp.spx_level) + ' ' + (dp.behavior_cn || dp.behavior)
    : '';
  const map = {
    'positive_put_squeezed':  '\u3010\u5e95\u90e8\u80cc\u79bb\u786e\u7acb\u3011\u6b63 Gamma \u963b\u5c3c + Put \u88ab\u5438\u6536\u3002' + flowStr + accelStr + dpStr + '\u3002\u7b49 ' + fmt(T.bear1) + ' \u627f\u63a5\u786e\u8ba4\u540e\u770b\u591a\u3002',
    'negative_put_effective': '\u3010\u7a7a\u5934\u52a8\u80fd\u786e\u8ba4\u3011\u8d1f Gamma \u653e\u6ce2 + Put Flow \u6709\u6548\u3002' + flowStr + accelStr + dpStr + '\u3002\u7b49\u8dcc\u7834 ' + fmt(T.bear1) + ' \u540e\u987a\u52bf\u505a\u7a7a\u3002',
    'positive_call_capped':   '\u3010\u9707\u8361\u5939\u51fb\u533a\u3011\u6b63 Gamma \u63a7\u6ce2 + Call \u88ab\u538b\u5236\u3002' + flowStr + accelStr + dpStr + '\u3002\u533a\u95f4 ' + fmt(T.bear1) + '\u2013' + fmt(T.bull1) + ' \u5185\u5356\u6743\u5360\u4f18\u3002',
    'negative_call_effective':'\u3010\u591a\u5934\u7a81\u7834\u9884\u6848\u3011\u8d1f Gamma \u653e\u6ce2 + Call Flow \u6709\u6548\u3002' + flowStr + accelStr + dpStr + '\u3002\u7b49\u7ad9\u7a33 ' + fmt(T.bull1) + ' \u540e\u8ffd\u591a\u3002',
    'positive_call_effective':'\u3010\u6b63 Gamma \u7a81\u7834\u4fe1\u53f7\u3011Call Flow \u6709\u6548\u4f46\u6b63 Gamma \u963b\u5c3c\u3002' + flowStr + accelStr + '\u3002\u8c28\u614e\u8ffd\u591a\uff0c\u7b49 ' + fmt(T.bull2) + ' \u7ad9\u7a33\u786e\u8ba4\u3002',
    'negative_put_squeezed':  '\u3010\u7a7a\u5934\u9677\u9631\u8b66\u544a\u3011\u8d1f Gamma \u73af\u5883\u4e2d Put \u88ab\u5438\u6536\u3002' + flowStr + accelStr + '\u3002\u7a7a\u5934\u53ef\u80fd\u88ab\u8f67\uff0c\u7b49\u5f85\u65b9\u5411\u786e\u8ba4\u3002'
  };
  return map[gamma_regime + '_' + flow_behavior]
    || '\u3010\u7b49\u5f85\u786e\u8ba4\u3011Gamma \u73af\u5883\u6216\u8d44\u91d1\u884c\u4e3a\u4e0d\u660e\u786e\u3002' + flowStr + accelStr + '\u3002';
}

// ── Main engine ───────────────────────────────────────────────────────────────
export function buildAbOrderEngine({
  spot_price = null,
  atm = null,
  gamma_flip = null,
  call_wall = null,
  put_wall = null,
  atm_trigger = null,
  gamma_regime = 'unknown',
  flow_behavior = 'neutral',
  execution_confidence = 0,
  pin_risk = 0,
  expiry = '0DTE',
  degraded = false,
  darkpool_conclusion = null,
  net_premium_millions = null,
  acceleration_15m = null,
  dominant_scene = null,
  alert_level = 'normal'
} = {}) {
  const spot = safeN(spot_price);
  const dp   = darkpool_conclusion || {};

  // ── Blocked: no price data ────────────────────────────────────────────────
  if (spot == null || atm == null) {
    const _confLabel = execution_confidence === 0 ? '\u4f4e\uff5c\u53ea\u89c2\u5bdf'
      : execution_confidence < 40 ? '\u4f4e\uff5c\u53ea\u89c2\u5bdf (' + execution_confidence + '/100)'
      : execution_confidence < 70 ? '\u4e2d\uff5c\u5c0f\u4ed3\u7b49\u786e\u8ba4 (' + execution_confidence + '/100)'
      : '\u9ad8\uff5c\u53ef\u6267\u884c (' + execution_confidence + '/100)';
    const _atmFmt = atm != null ? String(Math.round(atm)) : '--';
    const _lockedPlan = {
      state:        '\u9501\u4ed3\u89c2\u5bdf',
      why:          '\u73b0\u4ef7\u6570\u636e\u672a\u63a5\u5165\uff08FMP \u8d85\u9650/TV \u672a\u63a8\u9001/UW \u65e0\u73b0\u4ef7\uff09\uff0c\u7b49\u5f85\u6570\u636e\u6062\u590d\u3002',
      watch:        '\u7b49\u5f85\u5f00\u76d8\u540e ATM \u4ef7\u683c\u786e\u8ba4',
      wait_long:    '\u7b49\u5f85\u5f00\u76d8\u540e\u5b9e\u65f6\u6570\u636e\u63a5\u5165',
      wait_short:   '\u7b49\u5f85\u5f00\u76d8\u540e\u5b9e\u65f6\u6570\u636e\u63a5\u5165',
      forbidden:    '\u73b0\u4ef7\u6570\u636e\u7f3a\u5931\uff0c\u7981\u6b62\u5f00\u4ed3',
      invalidation: '\u5f00\u76d8\u540e\u4ef7\u683c\u5386\u53f2\u6ee1 10 \u5206\u949f\u81ea\u52a8\u89e3\u9501',
      confidence:   execution_confidence,
      confidence_label: _confLabel
    };
    return {
      status: 'blocked',
      status_cn: '\u6570\u636e\u4e0d\u53ef\u7528',
      headline: '\u7b49\u5f85\u4ef7\u683c\u6570\u636e\u63a5\u5165',
      judgment: '\u73b0\u4ef7\u6570\u636e\u672a\u63a5\u5165\uff08FMP \u8d85\u9650/TV \u672a\u63a8\u9001/UW \u65e0\u73b0\u4ef7\uff09\uff0c\u7b49\u5f85\u6570\u636e\u6062\u590d\u3002',
      pin_warning: null,
      execution_confidence,
      plan_a: _lockedPlan,
      plan_b: null,
      scenario: 'blocked',
      gamma_regime,
      flow_behavior,
      dominant_scene,
      alert_level,
      scene_overlay_applied: false,
      darkpool_context: null
    };
  }

  // ── Resolve ATM trigger lines ─────────────────────────────────────────────
  const T = resolveAtmTriggers(atm, atm_trigger);

  // ── Low confidence: LOCKED state ─────────────────────────────────────────
  if (execution_confidence < 40) {
    const _confLabel = execution_confidence < 40 ? '\u4f4e\uff5c\u53ea\u89c2\u5bdf (' + execution_confidence + '/100)' : '\u4e2d\uff5c\u5c0f\u4ed3\u7b49\u786e\u8ba4';
    const gammaNote = gamma_regime === 'positive'
      ? '\u6b63 Gamma \u78c1\u5438\uff0c\u505a\u5e02\u5546\u66f4\u5bb9\u6613\u628a\u4ef7\u683c\u62c9\u56de ' + fmt(atm) + ' ATM\uff0c\u8ba9 Call \u548c Put \u90fd\u78e8\u635f\u3002'
      : '\u7f6e\u4fe1\u5ea6\u4e0d\u8db3\uff0c\u7b49\u5f85\u6570\u636e\u6539\u5584\u3002ATM ' + fmt(atm) + ' \u9644\u8fd1\u4e0d\u8981\u4e71\u505a\u3002';
    const _lockedPlan = {
      state:        '\u9501\u4ed3\u89c2\u5bdf',
      why:          gammaNote,
      watch:        '\u4e0a\u65b9 ' + fmt(T.bull1) + ' \u80fd\u4e0d\u80fd\u7ad9\u7a33 / \u4e0b\u65b9 ' + fmt(T.bear1) + ' \u80fd\u4e0d\u80fd\u8dcc\u7834',
      wait_long:    '\u7ad9\u7a33 ' + fmt(T.bull1) + '\uff08\u7b2c\u4e00\u89e6\u53d1\uff09\uff0c\u7b49 ' + fmt(T.bull2) + ' \u786e\u8ba4\uff0c\u76ee\u6807 ' + fmt(T.bullTgt1) + '\u2013' + fmt(T.bullTgt2),
      wait_short:   '\u8dcc\u7834 ' + fmt(T.bear1) + '\uff08\u7b2c\u4e00\u89e6\u53d1\uff09\uff0c\u7b49 ' + fmt(T.bear2) + ' \u786e\u8ba4\uff0c\u76ee\u6807 ' + fmt(T.bearTgt1) + '\u2013' + fmt(T.bearTgt2),
      forbidden:    fmt(T.bear1) + '\u2013' + fmt(T.bull1) + ' ATM \u9501\u4ed3\u533a\u5185\u7981\u6b62\u4e70 Call / Put',
      invalidation: '\u591a\u5934\u5931\u6548\u7ebf ' + fmt(T.invBull) + ' / \u7a7a\u5934\u5931\u6548\u7ebf ' + fmt(T.invBear),
      confidence:   execution_confidence,
      confidence_label: _confLabel
    };
    return {
      status: 'blocked',
      status_cn: '\u53ef\u4fe1\u5ea6\u4f4e\uff0c\u53ea\u89c2\u5bdf (' + execution_confidence + '/100)',
      plan_a: _lockedPlan,
      plan_b: null,
      headline: '\u9501\u4ed3\u89c2\u5bdf\uff5c\u53ef\u4fe1\u5ea6 ' + execution_confidence + '/100 \u4f4e',
      blocked_reason: '\u53ef\u4fe1\u5ea6\u4f4e ' + execution_confidence + '/100',
      execution_confidence,
      atm_triggers: {
        bull1: T.bull1, bull2: T.bull2, bullTgt1: T.bullTgt1, bullTgt2: T.bullTgt2,
        bear1: T.bear1, bear2: T.bear2, bearTgt1: T.bearTgt1, bearTgt2: T.bearTgt2,
        invBull: T.invBull, invBear: T.invBear
      },
      far_call_wall: call_wall,
      far_put_wall: put_wall,
      scenario: gamma_regime + '_' + flow_behavior,
      gamma_regime,
      flow_behavior,
      dominant_scene,
      alert_level,
      scene_overlay_applied: false,
      darkpool_context: null
    };
  }

  const pinWarning = pin_risk >= 70
    ? 'Pin Risk ' + pin_risk + '/100\uff1a\u4ef7\u683c\u88ab\u9489\u4f4f\u98ce\u9669\u9ad8\uff0cATM \u9644\u8fd1 0DTE \u65b9\u5411\u5355\u4e3a\u8d1f\u671f\u671b\u5024\u3002'
    : null;

  // ── Scene overlay ─────────────────────────────────────────────────────────
  const sceneOverlay = (() => {
    if (!dominant_scene) return null;
    const overlays = {
      dark_pool_support: {
        headline_suffix: '\u3010\u6697\u76d8\u627f\u63a5\u4fe1\u53f7\u3011\u673a\u6784\u5728\u5e95\u90e8\u5438\u7b79\uff0c\u53cd\u5f39\u6982\u7387\u9ad8\u3002',
        forbidden_suffix: '\u7981\u6b62\u5728\u5e95\u90e8\u627f\u63a5\u786e\u8ba4\u524d\u8ffd\u7a7a\uff1b\u6697\u76d8\u627f\u63a5\u662f\u53cd\u5f39\u524d\u5146\u3002',
        invalidation_suffix: '\u5982\u679c\u4ef7\u683c\u6709\u6548\u8dcc\u7834\u6697\u76d8\u652f\u6491\uff0c\u627f\u63a5\u9884\u6848\u5931\u6548\u3002'
      },
      positive_gamma_pin: {
        headline_suffix: '\u3010\u6b63 Gamma \u78c1\u5438\u8b66\u544a\u3011\u4ef7\u683c\u5c06\u88ab\u9489\u4f4f\uff0c\u7981\u505a 0DTE \u65b9\u5411\u5355\u3002',
        forbidden_suffix: '\u7981\u6b62\u4e70\u4efb\u4f55 0DTE \u65b9\u5411\u5355\uff1b\u6b63 Gamma \u78c1\u5438\u73af\u5883\u4e2d 0DTE \u4e3a\u8d1f\u671f\u671b\u5024\u4ea4\u6613\u3002',
        invalidation_suffix: '\u6b63 Gamma \u78c1\u5438\u573a\u666f\u6301\u7eed\u65f6\uff0c\u6240\u6709 0DTE \u65b9\u5411\u9884\u6848\u5168\u90e8\u5931\u6548\u3002'
      },
      flow_divergence: {
        headline_suffix: '\u3010\u8d44\u91d1\u80cc\u79bb\u8b66\u544a\u3011\u8d44\u91d1\u65b9\u5411\u4e0e\u4ef7\u683c\u8d70\u52bf\u76f8\u53cd\uff0c\u5f53\u524d\u8d8b\u52bf\u53ef\u80fd\u662f\u5047\u7a81\u7834\u3002',
        forbidden_suffix: '\u7981\u6b62\u5728\u8d44\u91d1\u80cc\u79bb\u786e\u8ba4\u524d\u8ffd\u5355\uff1b\u8d44\u91d1\u80cc\u79bb\u662f\u5047\u7a81\u7834\u7684\u91cd\u8981\u8b66\u544a\u3002',
        invalidation_suffix: '\u8d44\u91d1\u80cc\u79bb\u573a\u666f\u6301\u7eed\u65f6\uff0c\u8ffd\u5355\u9884\u6848\u5168\u90e8\u5931\u6548\u3002'
      }
    };
    return overlays[dominant_scene] || null;
  })();

  const headline = buildHeadline({
    gamma_regime, flow_behavior, atm, atm_trigger,
    net_premium_millions, acceleration_15m, dp
  });

  let plan_a = null;
  let plan_b = null;
  let judgment = '';

  // ── Scenario Matrix ────────────────────────────────────────────────────────
  if (gamma_regime === 'positive' && flow_behavior === 'put_squeezed') {
    judgment = '\u5e95\u90e8\u80cc\u79bb\u786e\u7acb\u3002Put Flow \u88ab ATM \u4e0b\u65b9\u5438\u6536\uff0c\u6b63 Gamma \u963b\u5c3c\uff0c\u505a\u5e02\u5546\u4e0d\u8ddf\u7a7a\u3002';
    plan_a = makeBullPutSpreadPlan({ atm, atm_trigger, put_wall, gamma_flip, expiry, dp });
    plan_b = { ...makeLongCallPlan({ atm, atm_trigger, gamma_flip, expiry, dp }),
      direction_cn: '\u591a\u5934\u65b9\u5411\u5355\uff08\u786e\u8ba4\u540e\uff09',
      action_now: '\u7b49 ' + fmt(T.bear1) + ' \u627f\u63a5\u53cd\u5f39\u786e\u8ba4\u540e\u8003\u8651 Call' };
  }
  else if (gamma_regime === 'negative' && flow_behavior === 'put_effective') {
    judgment = '\u7a7a\u5934\u52a8\u80fd\u786e\u8ba4\u3002\u8d1f Gamma \u653e\u6ce2\uff0cPut Flow \u6709\u6548\uff0c\u505a\u5e02\u5546\u88ab\u8feb\u5bf9\u51b2\u52a0\u901f\u4e0b\u884c\u3002';
    plan_a = makeLongPutPlan({ atm, atm_trigger, gamma_flip, expiry, dp });
    plan_b = makeBearCallSpreadPlan({ atm, atm_trigger, call_wall, expiry, dp });
  }
  else if (gamma_regime === 'positive' && flow_behavior === 'call_capped') {
    judgment = '\u6b63 Gamma \u9707\u8361\u533a\uff0cCall \u88ab ' + fmt(T.bull1) + ' \u9644\u8fd1\u538b\u5236\uff0c\u5f53\u524d\u4e3a\u53cc\u5411\u5356\u6743\u73af\u5883\u3002';
    plan_a = makeBearCallSpreadPlan({ atm, atm_trigger, call_wall, expiry, dp });
    plan_b = makeBullPutSpreadPlan({ atm, atm_trigger, put_wall, gamma_flip, expiry, dp });
  }
  else if (gamma_regime === 'negative' && flow_behavior === 'call_effective') {
    judgment = '\u8d1f Gamma \u653e\u6ce2\uff0cCall Flow \u6709\u6548\uff0c\u7ad9\u7a33 ' + fmt(T.bull1) + ' \u53ef\u80fd\u89e6\u53d1 Gamma Squeeze\u3002';
    plan_a = makeLongCallPlan({ atm, atm_trigger, gamma_flip, expiry, dp });
    plan_b = {
      direction: 'BULLISH', direction_cn: '\u591a\u5934\u4ef7\u5dee\u5355\uff08\u63a7\u6210\u672c\uff09',
      instrument: 'Bull Call Spread ' + fmt(T.bull1) + '/' + fmt(T.bull2) + ' (' + expiry + ')',
      action_now:   '\u7b49\u7ad9\u7a33 ' + fmt(T.bull1) + ' \u540e\u5165\u573a',
      wait_long:    '\u73b0\u4ef7\u6709\u6548\u7ad9\u7a33 ' + fmt(T.bull1) + ' \u540e\u56de\u8e29\u4e0d\u7834',
      wait_short:   '\u4e0d\u9002\u7528',
      forbidden:    '\u7981\u6b62\u5728 ' + fmt(T.bull1) + ' \u672a\u7ad9\u7a33\u524d\u8ffd\u5165',
      invalidation: '\u73b0\u4ef7\u8dcc\u7834 ' + fmt(T.invBull),
      tp1:          fmt(T.bullTgt1),
      tp2:          fmt(T.bullTgt2),
      rationale:    '\u63a7\u5236\u6210\u672c\uff0c\u9650\u5236\u98ce\u9669\uff0c\u9002\u5408\u7a81\u7834\u786e\u8ba4\u540e\u8ffd\u5165'
    };
  }
  else if (gamma_regime === 'positive' && flow_behavior === 'call_effective') {
    judgment = '\u6b63 Gamma \u73af\u5883\u4e2d Call Flow \u6709\u6548\uff0c\u4f46\u963b\u5c3c\u6548\u5e94\u53ef\u80fd\u9650\u5236\u6da8\u5e45\uff0c\u8c28\u614e\u8ffd\u591a\u3002';
    plan_a = makeBearCallSpreadPlan({ atm, atm_trigger, call_wall, expiry, dp });
    plan_b = makeBullPutSpreadPlan({ atm, atm_trigger, put_wall, gamma_flip, expiry, dp });
  }
  else if (gamma_regime === 'negative' && flow_behavior === 'put_squeezed') {
    judgment = '\u8d1f Gamma \u73af\u5883\u4e2d Put \u88ab\u5438\u6536\uff0c\u7a7a\u5934\u9677\u9631\u8b66\u544a\uff0c\u7b49\u5f85\u65b9\u5411\u786e\u8ba4\u3002';
    plan_a = makeWaitPlan({ reason: '\u8d1f Gamma + Put \u88ab\u7ed9\uff0c\u7a7a\u5934\u9677\u9631\u98ce\u9669\u9ad8\uff0c\u7b49\u5f85\u65b9\u5411\u660e\u786e' });
    plan_b = makeLongCallPlan({ atm, atm_trigger, gamma_flip, expiry, dp });
  }
  else {
    judgment = '\u5f53\u524d Gamma \u73af\u5883\u6216\u8d44\u91d1\u884c\u4e3a\u4e0d\u660e\u786e\uff0c\u4e0d\u751f\u6210\u65b9\u5411\u6027\u9884\u6848\u3002';
    plan_a = makeWaitPlan({ reason: 'Gamma \u73af\u5883\u6216\u8d44\u91d1\u884c\u4e3a\u4e0d\u660e\u786e' });
    plan_b = null;
  }

  const doNotRules = [
    '\u4e0d\u5728\u6ca1\u6709\u3010\u7b49\u591a\u3011/\u3010\u7b49\u7a7a\u3011\u89e6\u53d1\u6761\u4ef6\u65f6\u4e0b\u5355',
    '\u4e0d\u6839\u636e\u5355\u4e00\u4fe1\u53f7\u5f00\u4ed3',
    '\u4e0d\u5728 ' + fmt(T.bear1) + '\u2013' + fmt(T.bull1) + ' ATM \u4e2d\u8f74\u533a\u5185\u8ffd\u5355',
    '\u4e0d\u5728\u3010\u5931\u6548\u3011\u6761\u4ef6\u89e6\u53d1\u540e\u7ee7\u7eed\u6301\u4ed3'
  ];

  const applyOverlay = (plan) => {
    if (!plan || !sceneOverlay) return plan;
    return {
      ...plan,
      forbidden: plan.forbidden
        ? plan.forbidden + '\uff1b' + sceneOverlay.forbidden_suffix
        : sceneOverlay.forbidden_suffix,
      invalidation: plan.invalidation
        ? plan.invalidation + '\uff1b' + sceneOverlay.invalidation_suffix
        : sceneOverlay.invalidation_suffix
    };
  };

  const finalHeadline = sceneOverlay
    ? headline + ' ' + sceneOverlay.headline_suffix
    : headline;

  return {
    status: plan_a && plan_a.direction !== 'WAIT' ? 'ready' : 'waiting',
    status_cn: plan_a && plan_a.direction !== 'WAIT' ? '\u9884\u6848\u5df2\u751f\u6210' : '\u7b49\u5f85\u786e\u8ba4',
    headline: finalHeadline,
    judgment,
    pin_warning: pinWarning,
    execution_confidence,
    plan_a: plan_a ? { ...applyOverlay(plan_a), expiry, execution_confidence, do_not: doNotRules } : null,
    plan_b: plan_b ? { ...applyOverlay(plan_b), expiry, execution_confidence, do_not: doNotRules.slice(0, 3) } : null,
    scenario: gamma_regime + '_' + flow_behavior,
    gamma_regime,
    flow_behavior,
    atm_triggers: {
      bull1: T.bull1, bull2: T.bull2, bullTgt1: T.bullTgt1, bullTgt2: T.bullTgt2,
      bear1: T.bear1, bear2: T.bear2, bearTgt1: T.bearTgt1, bearTgt2: T.bearTgt2,
      invBull: T.invBull, invBear: T.invBear
    },
    far_call_wall: call_wall,
    far_put_wall: put_wall,
    dominant_scene,
    alert_level,
    scene_overlay_applied: sceneOverlay != null,
    darkpool_context: dp && dp.behavior ? {
      behavior: dp.behavior,
      behavior_cn: dp.behavior_cn,
      spx_level: dp.spx_level,
      tier: dp.tier
    } : null
  };
}
