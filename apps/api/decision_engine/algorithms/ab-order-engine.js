/**
 * ab-order-engine.js  — L2.5 Institutional A/B Order Generator
 *
 * Generates two execution plans in precise trading language:
 *   action_now   — 【现在】当前应做什么
 *   wait_long    — 【等多】触发做多的条件
 *   wait_short   — 【等空】触发做空的条件
 *   forbidden    — 【禁做】绝对禁止的操作
 *   invalidation — 【失效】预案作废条件
 *   tp1 / tp2    — 【目标】获利了结位
 *
 * Inputs:
 *   spot_price, atm, gamma_flip, call_wall, put_wall
 *   gamma_regime: 'positive' | 'negative' | 'transition'
 *   flow_behavior: 'put_effective' | 'put_squeezed' | 'call_effective' | 'call_capped' | 'mixed'
 *   execution_confidence: 0–100
 *   pin_risk: 0–100
 *   darkpool_conclusion: { behavior, behavior_cn, spx_level, tier } (optional)
 *   net_premium_millions: number (optional)
 *   acceleration_15m: number (optional, 15-min flow delta in millions)
 */

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v, d = 0) {
  if (v == null) return '--';
  return Number(v.toFixed(d)).toString();
}

function spreadWidth(base, w = 10) {
  return base != null ? base + w : null;
}

// ── Plan builders ─────────────────────────────────────────────────────────────

function makeLongCallPlan({ atm, call_wall, gamma_flip, expiry, dp }) {
  const buyStrike = atm != null ? atm + 5 : null;
  const dpCtx = dp?.behavior === 'breakout' ? `（暗盘 ${fmt(dp.spx_level)} 突破确认）` : '';
  return {
    direction: 'BULLISH',
    direction_cn: '多头方向单',
    instrument: `Long Call ${fmt(buyStrike)} (${expiry})`,
    action_now:   `观望，不追高`,
    wait_long:    `现价站稳 ${fmt(gamma_flip ?? atm)} 上方，且 Call Flow 持续净流入${dpCtx}`,
    wait_short:   `不适用`,
    forbidden:    `禁止在 ${fmt(atm)} ATM 附近直接追入；禁止在 Put Flow 增强时买 Call`,
    invalidation: `现价有效跌破 ${fmt(gamma_flip ?? (atm != null ? atm - 10 : null))}，或 Put Flow 重新主导`,
    tp1:          fmt(call_wall != null ? call_wall - 5 : (atm != null ? atm + 15 : null)),
    tp2:          fmt(call_wall ?? (atm != null ? atm + 25 : null)),
    rationale:    `负 Gamma 放波，Call Flow 有效，突破 Gamma Flip 可触发做市商对冲加速`
  };
}

function makeLongPutPlan({ atm, put_wall, gamma_flip, expiry, dp }) {
  const buyStrike = atm != null ? atm - 5 : null;
  const dpCtx = dp?.behavior === 'breakdown' ? `（暗盘 ${fmt(dp.spx_level)} 破位确认）` : '';
  return {
    direction: 'BEARISH',
    direction_cn: '空头方向单',
    instrument: `Long Put ${fmt(buyStrike)} (${expiry})`,
    action_now:   `观望，等待跌破确认`,
    wait_long:    `不适用`,
    wait_short:   `现价有效跌破 ${fmt(gamma_flip ?? atm)}，Put Flow 持续净流入${dpCtx}`,
    forbidden:    `禁止在 ${fmt(atm)} ATM 上方做空；禁止在 Call Flow 增强时买 Put`,
    invalidation: `现价收复 ${fmt(gamma_flip ?? (atm != null ? atm + 10 : null))}，或 Call Flow 转强`,
    tp1:          fmt(put_wall != null ? put_wall + 5 : (atm != null ? atm - 15 : null)),
    tp2:          fmt(put_wall ?? (atm != null ? atm - 25 : null)),
    rationale:    `负 Gamma 放波，Put Flow 有效，做市商被迫对冲加速下行`
  };
}

function makeBullPutSpreadPlan({ put_wall, atm, gamma_flip, expiry, dp }) {
  if (put_wall == null) return null;
  const sellStrike = put_wall - 5;
  const buyStrike  = put_wall - 15;
  const dpCtx = dp?.behavior === 'support' ? `（暗盘 ${fmt(dp.spx_level)} 承接确认）` : '';
  return {
    direction: 'BULLISH',
    direction_cn: '多头价差单',
    instrument: `Bull Put Spread ${fmt(sellStrike)}/${fmt(buyStrike)} (${expiry})`,
    action_now:   `等待 Put Wall 吸收确认后入场`,
    wait_long:    `现价站稳 ${fmt(put_wall)} 上方，Put Flow 不再增强${dpCtx}`,
    wait_short:   `不适用`,
    forbidden:    `禁止在 Put Flow 持续增强时卖 Put Spread；禁止在 ${fmt(put_wall)} 破位后入场`,
    invalidation: `现价有效跌破 ${fmt(put_wall)}，Put Flow 继续增强`,
    tp1:          `权利金收回 50%`,
    tp2:          `权利金收回 80% 或到期`,
    rationale:    `Put Flow 被 Put Wall 吸收，正 Gamma 阻尼，做市商不跟空`
  };
}

function makeBearCallSpreadPlan({ call_wall, atm, expiry, dp }) {
  if (call_wall == null) return null;
  const sellStrike = call_wall + 5;
  const buyStrike  = call_wall + 15;
  const dpCtx = dp?.behavior === 'resistance' ? `（暗盘 ${fmt(dp.spx_level)} 派发确认）` : '';
  return {
    direction: 'BEARISH',
    direction_cn: '空头价差单',
    instrument: `Bear Call Spread ${fmt(sellStrike)}/${fmt(buyStrike)} (${expiry})`,
    action_now:   `等待 Call Wall 压制确认后入场`,
    wait_long:    `不适用`,
    wait_short:   `现价接近 Call Wall ${fmt(call_wall)} 且 Call Flow 减弱${dpCtx}`,
    forbidden:    `禁止在 Call Flow 持续增强时卖 Call Spread；禁止在 ${fmt(call_wall)} 突破后入场`,
    invalidation: `现价有效突破 ${fmt(call_wall)}，Call Flow 持续增强`,
    tp1:          `权利金收回 50%`,
    tp2:          `权利金收回 80% 或到期`,
    rationale:    `Call Wall 压制，正 Gamma 阻尼，做市商不跟多`
  };
}

function makeWaitPlan({ reason }) {
  return {
    direction: 'WAIT',
    direction_cn: '等待确认',
    instrument:   `观望`,
    action_now:   `不操作，等待信号明确`,
    wait_long:    `等待 Gamma 环境明确后重新评估`,
    wait_short:   `等待 Gamma 环境明确后重新评估`,
    forbidden:    `禁止在当前不明确环境中开仓`,
    invalidation: `N/A`,
    tp1:          `N/A`,
    tp2:          `N/A`,
    rationale:    reason || `Gamma 环境或资金行为不明确`
  };
}

// ── Headline generator ────────────────────────────────────────────────────────
function buildHeadline({ gamma_regime, flow_behavior, gamma_flip, call_wall, put_wall,
                          net_premium_millions, acceleration_15m, dp }) {
  const flowStr = net_premium_millions != null
    ? (net_premium_millions >= 0
        ? `净多头流入 $${Math.abs(net_premium_millions).toFixed(1)}M`
        : `净空头流入 $${Math.abs(net_premium_millions).toFixed(1)}M`)
    : '资金流向待接入';
  const accelStr = acceleration_15m != null
    ? ` | 15分钟加速度 ${acceleration_15m > 0 ? '+' : ''}${acceleration_15m.toFixed(1)}M`
    : '';
  const dpStr = dp?.behavior && dp.behavior !== 'unknown'
    ? ` | 暗盘 ${fmt(dp.spx_level)} ${dp.behavior_cn ?? dp.behavior}`
    : '';

  const map = {
    'positive_put_squeezed':  `【底部背离确立】正 Gamma 阻尼 + Put 被吸收。${flowStr}${accelStr}${dpStr}。Put Wall ${fmt(put_wall)} 下方禁做空。`,
    'negative_put_effective': `【空头动能确认】负 Gamma 放波 + Put Flow 有效。${flowStr}${accelStr}${dpStr}。等跌破 ${fmt(gamma_flip)} 后顺势做空。`,
    'positive_call_capped':   `【震荡夹击区】正 Gamma 控波 + Call 被压制。${flowStr}${accelStr}${dpStr}。区间 ${fmt(put_wall)}–${fmt(call_wall)} 内卖权占优。`,
    'negative_call_effective':`【多头突破预案】负 Gamma 放波 + Call Flow 有效。${flowStr}${accelStr}${dpStr}。等有效突破 ${fmt(call_wall)} 后追多。`,
    'positive_call_effective':`【正 Gamma 突破信号】Call Flow 有效但正 Gamma 阻尼。${flowStr}${accelStr}。谨慎追多，等 ${fmt(call_wall)} 突破确认。`,
    'negative_put_squeezed':  `【空头陷阱警告】负 Gamma 环境中 Put 被吸收。${flowStr}${accelStr}。空头可能被轧，等待方向确认。`
  };
  return map[`${gamma_regime}_${flow_behavior}`]
    || `【等待确认】Gamma 环境或资金行为不明确。${flowStr}${accelStr}。`;
}

// ── Main engine ───────────────────────────────────────────────────────────────
export function buildAbOrderEngine({
  spot_price = null,
  atm = null,
  gamma_flip = null,
  call_wall = null,
  put_wall = null,
  gamma_regime = 'unknown',
  flow_behavior = 'neutral',
  execution_confidence = 0,
  pin_risk = 0,
  expiry = '0DTE',
  degraded = false,
  darkpool_conclusion = null,
  net_premium_millions = null,
  acceleration_15m = null,
  // P2: price_validation_engine dominant scene injection
  dominant_scene = null,
  alert_level = 'normal'
} = {}) {
  const spot = safeN(spot_price);
  const dp   = darkpool_conclusion || {};

  // ── Safety gates ───────────────────────────────────────────────────────────
  if (degraded || spot == null) {
    return {
      status: 'blocked', status_cn: 'SPX 价格未接入，不生成预案',
      plan_a: null, plan_b: null,
      headline: '【系统降级】非交易时段 / SPX 价格数据不可用，禁止开仓。',
      blocked_reason: 'SPX 价格数据降级', execution_confidence
    };
  }
  if (execution_confidence < 40) {
    const _isColdStart = execution_confidence === 0;
    const _blockedMsg = _isColdStart
      ? '【冷启动锁定】非交易时段 / 价格历史不足，禁止开仓。开盘后约 10 分钟自动解锁。'
      : `【置信度不足】当前置信度 ${execution_confidence}/100，低于执行阈值 40，等待数据改善后解锁。`;
    return {
      status: 'blocked',
      status_cn: _isColdStart ? '冷启动 / 非交易时段，禁止开仓' : `执行置信度不足 (${execution_confidence}/100)，不生成预案`,
      plan_a: null, plan_b: null,
      headline: _blockedMsg,
      blocked_reason: _isColdStart ? 'cold_start_or_off_hours' : `置信度 ${execution_confidence}/100 < 40`,
      execution_confidence
    };
  }

  const pinWarning = pin_risk >= 70
    ? `⚠ ATM 吸附风险高 (${pin_risk}/100)，禁止在 ${fmt(atm)} ATM 附近买 0DTE 方向单`
    : null;

  // P2: dominant_scene overlay — injects scene-specific warnings into plan
  const sceneOverlay = (() => {
    if (!dominant_scene) return null;
    const overlays = {
      call_capped: {
        headline_suffix: '【Call 被压警告】资金偏多但价格不涨，上方强阻力确认。',
        forbidden_suffix: '禁止在 Call 被压确认前追多；资金流入但价格不涨是假突破信号。',
        invalidation_suffix: '如果 Call 被压场景持续，多头预案全部失效。'
      },
      put_squeezed: {
        headline_suffix: '【Put 被绞警告】空头情绪极端但价格不跌， Gamma Squeeze 风险高。',
        forbidden_suffix: '禁止在 Put 被绞确认前追空；空头可能被轧。',
        invalidation_suffix: '如果 Put 被绞场景持续，空头预案全部失效。'
      },
      absorption_failed: {
        headline_suffix: '【暗盘承接失败警告】机构入场但价格继续下跌，下行风险未解除。',
        forbidden_suffix: '禁止在承接失败确认后强行做多；暗盘承接失败是重要危险信号。',
        invalidation_suffix: '承接失败场景持续时，多头预案全部失效。'
      },
      bottom_absorption: {
        headline_suffix: '【底部承接信号】机构在底部吸笹，反弹概率高。',
        forbidden_suffix: '禁止在底部承接确认前追空；暗盘承接是反弹前兆。',
        invalidation_suffix: '如果价格有效跌破暗盘支撑，承接预案失效。'
      },
      positive_gamma_pin: {
        headline_suffix: '【正 Gamma 磁吸警告】价格将被钉住，禁做 0DTE 方向单。',
        forbidden_suffix: '禁止买任何 0DTE 方向单；正 Gamma 磁吸环境中 0DTE 为负期望值交易。',
        invalidation_suffix: '正 Gamma 磁吸场景持续时，所有 0DTE 方向预案全部失效。'
      },
      flow_divergence: {
        headline_suffix: '【资金背离警告】资金方向与价格走势相反，当前趋势可能是假突破。',
        forbidden_suffix: '禁止在资金背离确认前追单；资金背离是假突破的重要警告。',
        invalidation_suffix: '资金背离场景持续时，追单预案全部失效。'
      }
    };
    return overlays[dominant_scene] ?? null;
  })();

  const headline = buildHeadline({
    gamma_regime, flow_behavior, gamma_flip, call_wall, put_wall,
    net_premium_millions, acceleration_15m, dp
  });

  let plan_a = null;
  let plan_b = null;
  let judgment = '';

  // ── Scenario Matrix ────────────────────────────────────────────────────────
  if (gamma_regime === 'positive' && flow_behavior === 'put_squeezed') {
    judgment = '底部背离确立。Put Flow 被 Put Wall 吸收，正 Gamma 阻尼，做市商不跟空。';
    plan_a = makeBullPutSpreadPlan({ put_wall, atm, gamma_flip, expiry, dp });
    plan_b = { ...makeLongCallPlan({ atm, call_wall, gamma_flip, expiry, dp }),
      direction_cn: '多头方向单（确认后）',
      action_now: `等 Put Wall 吸收反弹确认后考虑 Call` };
  }
  else if (gamma_regime === 'negative' && flow_behavior === 'put_effective') {
    judgment = '空头动能确认。负 Gamma 放波，Put Flow 有效，做市商被迫对冲加速下行。';
    plan_a = makeLongPutPlan({ atm, put_wall, gamma_flip, expiry, dp });
    plan_b = makeBearCallSpreadPlan({ call_wall, atm, expiry, dp });
  }
  else if (gamma_regime === 'positive' && flow_behavior === 'call_capped') {
    judgment = '正 Gamma 震荡区，Call 被 Call Wall 压制，当前为双向卖权环境。';
    plan_a = makeBearCallSpreadPlan({ call_wall, atm, expiry, dp });
    plan_b = makeBullPutSpreadPlan({ put_wall, atm, gamma_flip, expiry, dp });
  }
  else if (gamma_regime === 'negative' && flow_behavior === 'call_effective') {
    judgment = '负 Gamma 放波，Call Flow 有效，突破 Call Wall 可能触发 Gamma Squeeze。';
    plan_a = makeLongCallPlan({ atm, call_wall, gamma_flip, expiry, dp });
    plan_b = {
      direction: 'BULLISH', direction_cn: '多头价差单（控成本）',
      instrument: `Bull Call Spread ${fmt(call_wall)}/${fmt(spreadWidth(call_wall, 15))} (${expiry})`,
      action_now:   `等突破 ${fmt(call_wall)} 后入场`,
      wait_long:    `现价有效突破 ${fmt(call_wall)} 后回踩不破`,
      wait_short:   `不适用`,
      forbidden:    `禁止在 ${fmt(call_wall)} 未突破前追入`,
      invalidation: `现价跌破 ${fmt(gamma_flip ?? atm)}`,
      tp1:          fmt(call_wall != null ? call_wall + 10 : null),
      tp2:          fmt(call_wall != null ? call_wall + 20 : null),
      rationale:    `控制成本，限制风险，适合突破确认后追入`
    };
  }
  else if (gamma_regime === 'positive' && flow_behavior === 'call_effective') {
    judgment = '正 Gamma 环境中 Call Flow 有效，但阻尼效应可能限制涨幅，谨慎追多。';
    plan_a = makeBearCallSpreadPlan({ call_wall, atm, expiry, dp });
    plan_b = makeBullPutSpreadPlan({ put_wall, atm, gamma_flip, expiry, dp });
  }
  else if (gamma_regime === 'negative' && flow_behavior === 'put_squeezed') {
    judgment = '负 Gamma 环境中 Put 被吸收，空头陷阱警告，等待方向确认。';
    plan_a = makeWaitPlan({ reason: '负 Gamma + Put 被绞，空头陷阱风险高，等待方向明确' });
    plan_b = makeLongCallPlan({ atm, call_wall, gamma_flip, expiry, dp });
  }
  else {
    judgment = '当前 Gamma 环境或资金行为不明确，不生成方向性预案。';
    plan_a = makeWaitPlan({ reason: 'Gamma 环境或资金行为不明确' });
    plan_b = null;
  }

  const doNotRules = [
    '不在没有【等多】/【等空】触发条件时下单',
    '不根据单一信号开仓',
    '不在 ATM 中轴区内追单',
    '不在【失效】条件触发后继续持仓'
  ];

  // P2: Apply scene overlay to plans
  const applyOverlay = (plan) => {
    if (!plan || !sceneOverlay) return plan;
    return {
      ...plan,
      forbidden: plan.forbidden
        ? `${plan.forbidden}；${sceneOverlay.forbidden_suffix}`
        : sceneOverlay.forbidden_suffix,
      invalidation: plan.invalidation
        ? `${plan.invalidation}；${sceneOverlay.invalidation_suffix}`
        : sceneOverlay.invalidation_suffix
    };
  };

  const finalHeadline = sceneOverlay
    ? `${headline} ${sceneOverlay.headline_suffix}`
    : headline;

  return {
    status: plan_a?.direction !== 'WAIT' ? 'ready' : 'waiting',
    status_cn: plan_a?.direction !== 'WAIT' ? '预案已生成' : '等待确认',
    headline: finalHeadline,
    judgment,
    pin_warning: pinWarning,
    execution_confidence,
    plan_a: plan_a ? { ...applyOverlay(plan_a), expiry, execution_confidence, do_not: doNotRules } : null,
    plan_b: plan_b ? { ...applyOverlay(plan_b), expiry, execution_confidence, do_not: doNotRules.slice(0, 3) } : null,
    scenario: `${gamma_regime}_${flow_behavior}`,
    gamma_regime,
    flow_behavior,
    // P2: dominant scene context
    dominant_scene,
    alert_level,
    scene_overlay_applied: sceneOverlay != null,
    darkpool_context: dp?.behavior ? {
      behavior: dp.behavior,
      behavior_cn: dp.behavior_cn,
      spx_level: dp.spx_level,
      tier: dp.tier
    } : null
  };
}
