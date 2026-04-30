/**
 * flow-behavior-engine.js
 *
 * Flow Behavior Classification Engine
 *
 * Classifies current flow into one of 4 behaviors:
 *  1. put_effective   — Put flow is real, bearish momentum confirmed
 *  2. put_squeezed    — Put flow exists but being absorbed/squeezed by support
 *  3. call_effective  — Call flow is real, bullish momentum confirmed
 *  4. call_capped     — Call flow exists but being capped by resistance
 *  5. mixed           — Conflicting signals, no clear direction
 *  6. neutral         — No significant flow detected
 *
 * Also computes:
 *  - Net Premium 15min acceleration (key institutional signal)
 *  - P/C ratio extreme detection
 *  - Flow aggression score
 */

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeMillions(value) {
  const n = safeNumber(value);
  return n != null ? Number((n / 1_000_000).toFixed(2)) : null;
}

/**
 * Classify flow behavior based on premium, ratio, and wall context
 */
function classifyFlowBehavior({
  net_premium,
  call_premium,
  put_premium,
  put_call_ratio,
  gamma_regime,
  spot_position,
  darkpool_state,
  put_wall,
  call_wall,
  spot
}) {
  const netPrem = safeNumber(net_premium);
  const callPrem = safeNumber(call_premium);
  const putPrem = safeNumber(put_premium);
  const pcRatio = safeNumber(put_call_ratio);

  // No data
  if (netPrem == null && pcRatio == null) {
    return { behavior: 'neutral', confidence: 'low' };
  }

  const isBearishFlow = (netPrem != null && netPrem < -5_000_000) || (pcRatio != null && pcRatio > 1.5);
  const isBullishFlow = (netPrem != null && netPrem > 5_000_000) || (pcRatio != null && pcRatio < 0.8);

  // Put flow classification
  if (isBearishFlow) {
    // Check if being absorbed (squeezed)
    const nearPutWall = spot != null && put_wall != null && Math.abs(spot - put_wall) / spot < 0.005;
    const darkpoolBraking = darkpool_state === 'lower_brake_zone';
    const positiveGamma = gamma_regime === 'positive';

    if (nearPutWall || darkpoolBraking || positiveGamma) {
      return {
        behavior: 'put_squeezed',
        confidence: nearPutWall ? 'high' : 'medium',
        reason: nearPutWall
          ? `Put Flow 撞墙 ${put_wall}，被 Put Wall 吸收`
          : darkpoolBraking
            ? 'Put Flow 遭遇暗池减速区，动能被吸收'
            : '正 Gamma 阻尼，Put Flow 被做市商对冲吸收'
      };
    }

    return {
      behavior: 'put_effective',
      confidence: 'high',
      reason: 'Put Flow 有效，空头动能未被吸收'
    };
  }

  // Call flow classification
  if (isBullishFlow) {
    const nearCallWall = spot != null && call_wall != null && Math.abs(call_wall - spot) / spot < 0.005;

    if (nearCallWall) {
      return {
        behavior: 'call_capped',
        confidence: 'high',
        reason: `Call Flow 遭遇 Call Wall ${call_wall} 压制`
      };
    }

    // P1-1 fix: if put_premium > call_premium AND P/C > 1, downgrade (资金偏多但 Put 仍重)
    const absPut = putPrem != null ? Math.abs(putPrem) : 0;
    const absCall = callPrem != null ? Math.abs(callPrem) : 0;
    if (absPut > absCall && pcRatio != null && pcRatio > 1) {
      return {
        behavior: 'mixed',
        confidence: 'medium',
        reason: `资金偏多但 Put 仍重（Put ${(absPut/1e6).toFixed(1)}M > Call ${(absCall/1e6).toFixed(1)}M，P/C ${pcRatio.toFixed(2)}），方向降级`
      };
    }

    return {
      behavior: 'call_effective',
      confidence: 'high',
      reason: 'Call Flow 有效，多头动能确认'
    };
  }

  // Mixed
  if (callPrem != null && putPrem != null) {
    const ratio = Math.abs(callPrem) / (Math.abs(putPrem) + 1);
    if (ratio > 0.7 && ratio < 1.3) {
      return { behavior: 'mixed', confidence: 'medium', reason: '多空资金对冲，方向不明' };
    }
  }

  return { behavior: 'neutral', confidence: 'low', reason: '资金流向信号不足' };
}

/**
 * Compute 15-minute net premium acceleration
 * @param {Array} prem_ticks - array of { timestamp, net_premium } objects
 */
function calcPremAcceleration(prem_ticks = []) {
  if (!Array.isArray(prem_ticks) || prem_ticks.length < 2) {
    return { acceleration_15m: null, acceleration_label: null, is_accelerating: false };
  }

  const now = Date.now();
  const cutoff15m = now - 15 * 60 * 1000;
  const recent = prem_ticks.filter((t) => {
    const ts = typeof t.timestamp === 'number' ? t.timestamp : Date.parse(t.timestamp);
    return ts >= cutoff15m;
  });

  if (recent.length < 2) {
    return { acceleration_15m: null, acceleration_label: null, is_accelerating: false };
  }

  const first = safeNumber(recent[0].net_premium);
  const last = safeNumber(recent[recent.length - 1].net_premium);
  if (first == null || last == null) {
    return { acceleration_15m: null, acceleration_label: null, is_accelerating: false };
  }

  const delta = last - first;
  const deltaM = safeMillions(delta);
  const isAccelerating = Math.abs(delta) > 20_000_000; // $20M threshold

  let label = null;
  if (deltaM != null) {
    const sign = delta > 0 ? '+' : '';
    label = `${sign}$${deltaM}M / 15min`;
  }

  return {
    acceleration_15m: delta,
    acceleration_15m_millions: deltaM,
    acceleration_label: label,
    is_accelerating: isAccelerating,
    direction: delta > 0 ? 'bullish' : delta < 0 ? 'bearish' : 'flat'
  };
}

/**
 * Main Flow Behavior Engine
 */
export function buildFlowBehaviorEngine({
  net_premium = null,
  call_premium = null,
  put_premium = null,
  put_call_ratio = null,
  prem_ticks = [],
  gamma_regime = 'unknown',
  spot_position = 'unknown',
  darkpool_state = null,
  put_wall = null,
  call_wall = null,
  spot_price = null
} = {}) {
  const netPrem = safeNumber(net_premium);
  const callPrem = safeNumber(call_premium);
  const putPrem = safeNumber(put_premium);
  const pcRatio = safeNumber(put_call_ratio);
  const spot = safeNumber(spot_price);

  // Classify behavior
  const { behavior, confidence, reason } = classifyFlowBehavior({
    net_premium: netPrem,
    call_premium: callPrem,
    put_premium: putPrem,
    put_call_ratio: pcRatio,
    gamma_regime,
    spot_position,
    darkpool_state,
    put_wall,
    call_wall,
    spot
  });

  // 15-minute acceleration
  const acceleration = calcPremAcceleration(prem_ticks);

  // P/C ratio extremes
  const pcExtreme = pcRatio != null
    ? pcRatio > 1.8
      ? { extreme: true, type: 'extreme_bearish', label: `P/C ${pcRatio.toFixed(2)} — 散户极端恐慌`, color: 'red' }
      : pcRatio > 1.5
        ? { extreme: true, type: 'elevated_bearish', label: `P/C ${pcRatio.toFixed(2)} — 偏空`, color: 'amber' }
        : pcRatio < 0.5
          ? { extreme: true, type: 'extreme_bullish', label: `P/C ${pcRatio.toFixed(2)} — 散户极端贪婪`, color: 'red' }
          : pcRatio < 0.8
            ? { extreme: true, type: 'elevated_bullish', label: `P/C ${pcRatio.toFixed(2)} — 偏多`, color: 'green' }
            : { extreme: false, type: 'normal', label: `P/C ${pcRatio.toFixed(2)} — 正常`, color: 'gray' }
    : { extreme: false, type: 'unavailable', label: 'P/C 数据未接入', color: 'gray' };

  // Flow aggression score (0–100)
  let aggressionScore = 0;
  if (netPrem != null) {
    const absM = Math.abs(netPrem) / 1_000_000;
    aggressionScore += Math.min(50, absM * 2);
  }
  if (acceleration.is_accelerating) aggressionScore += 30;
  if (pcExtreme.extreme) aggressionScore += 20;
  aggressionScore = Math.min(100, Math.round(aggressionScore));

  // Behavior labels
  const behaviorLabels = {
    put_effective: { label: 'Put 有效', label_en: 'PUT EFFECTIVE', color: 'red', icon: '⬇' },
    put_squeezed: { label: 'Put 被绞', label_en: 'PUT SQUEEZED', color: 'amber', icon: '⚡' },
    call_effective: { label: 'Call 有效', label_en: 'CALL EFFECTIVE', color: 'green', icon: '⬆' },
    call_capped: { label: 'Call 被压', label_en: 'CALL CAPPED', color: 'amber', icon: '⚡' },
    mixed: { label: '多空混战', label_en: 'MIXED', color: 'violet', icon: '↔' },
    neutral: { label: '无明显资金流', label_en: 'NEUTRAL', color: 'gray', icon: '—' }
  };

  const behaviorMeta = behaviorLabels[behavior] || behaviorLabels.neutral;

  // Prohibit direction based on behavior
  const prohibit = {
    put_effective: 'CALL',
    put_squeezed: 'PUT',
    call_effective: 'PUT',
    call_capped: 'CALL',
    mixed: 'BOTH',
    neutral: null
  }[behavior] ?? null;

  return {
    behavior,
    behavior_label: behaviorMeta.label,
    behavior_label_en: behaviorMeta.label_en,
    behavior_color: behaviorMeta.color,
    behavior_icon: behaviorMeta.icon,
    confidence,
    reason,

    // Raw values
    net_premium: netPrem,
    net_premium_millions: safeMillions(netPrem),
    call_premium: callPrem,
    put_premium: putPrem,
    put_call_ratio: pcRatio,

    // Acceleration
    acceleration,

    // P/C extreme
    pc_extreme: pcExtreme,

    // Aggression
    aggression_score: aggressionScore,
    aggression_label: aggressionScore >= 70 ? '高强度资金行为' : aggressionScore >= 40 ? '中等资金行为' : '低强度资金行为',

    // Action
    prohibit_direction: prohibit,
    action_cn: behavior === 'put_effective'
      ? '禁止抄底 Call。等 Put Flow 减弱或价格触发后再评估。'
      : behavior === 'put_squeezed'
        ? '禁止追 Put。Put 动能被吸收，观察反弹机会。'
        : behavior === 'call_effective'
          ? '禁止追空。等 Call Flow 减弱或价格触发后再评估。'
          : behavior === 'call_capped'
            ? '禁止追多。Call 动能被 Call Wall 压制。'
            : behavior === 'mixed'
              ? '多空混战，不做。等方向确认。'
              : '无明显资金流，不做。等待信号。'
  };
}
