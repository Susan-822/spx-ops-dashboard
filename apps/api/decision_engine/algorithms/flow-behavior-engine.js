/**
 * flow-behavior-engine.js
 *
 * Flow Behavior Classification Engine (v2 — 5m+15m Dual Window)
 *
 * Classifies current flow into one of 6 behaviors:
 *  1. put_effective   — Put flow is real, bearish momentum confirmed
 *  2. put_squeezed    — Put flow exists but being absorbed/squeezed by support
 *  3. call_effective  — Call flow is real, bullish momentum confirmed
 *  4. call_capped     — Call flow exists but being capped by resistance
 *  5. mixed           — Conflicting signals, no clear direction
 *  6. neutral         — No significant flow detected
 *
 * v2 additions:
 *  - flow_5m_direction:  Short-term momentum (last 5 minutes of net_prem queue)
 *  - flow_15m_direction: Trend confirmation (last 15 minutes of net_prem queue)
 *  - dual_window_aligned: true when 5m and 15m agree (boosts confidence)
 *  - dual_window_label:  Human-readable dual window status
 *  - flow_5m_delta:      Net premium change in last 5 minutes
 *  - flow_15m_delta:     Net premium change in last 15 minutes
 *
 * Confidence boost rules:
 *  - 5m and 15m both bullish → +1 confidence tier
 *  - 5m and 15m both bearish → +1 confidence tier
 *  - 5m and 15m disagree → downgrade to 'medium' max
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
 * Compute flow direction from a time-series queue within a time window.
 * @param {Array} queue - Array of { net_premium, ts } objects (oldest first)
 * @param {number} windowMs - Time window in milliseconds
 * @returns {{ direction: 'bullish'|'bearish'|'flat'|'unknown', delta: number|null, label: string }}
 */
function computeWindowDirection(queue, windowMs) {
  if (!Array.isArray(queue) || queue.length < 2) {
    return { direction: 'unknown', delta: null, label: '数据不足' };
  }

  const now = Date.now();
  const cutoff = now - windowMs;

  // Filter entries within the window
  const inWindow = queue.filter((e) => {
    const ts = typeof e.ts === 'number' ? e.ts : Date.parse(e.ts);
    return ts >= cutoff;
  });

  if (inWindow.length < 2) {
    // Try to use oldest available entry as baseline
    const oldest = queue[0];
    const latest = queue[queue.length - 1];
    const oldestPrem = safeNumber(oldest?.net_premium);
    const latestPrem = safeNumber(latest?.net_premium);
    if (oldestPrem == null || latestPrem == null) {
      return { direction: 'unknown', delta: null, label: '数据不足', is_fallback: true };
    }
    const delta = latestPrem - oldestPrem;
    const deltaM = safeMillions(delta);
    const sign = delta >= 0 ? '+' : '';
    const windowLabel = windowMs === 5 * 60 * 1000 ? '5m' : '15m';
    // Phase 4 fix: mark fallback data explicitly to prevent misleading display
    return {
      direction: delta > 5_000_000 ? 'bullish' : delta < -5_000_000 ? 'bearish' : 'flat',
      delta,
      delta_millions: deltaM,
      is_fallback: true,  // Phase 4: 窗口内数据不足，使用全量历史推算
      label: `${sign}$${deltaM != null ? Math.abs(deltaM).toFixed(0) : '--'}M/${windowLabel}（历史推算）`
    };
  }

  const first = safeNumber(inWindow[0].net_premium);
  const last  = safeNumber(inWindow[inWindow.length - 1].net_premium);

  if (first == null || last == null) {
    return { direction: 'unknown', delta: null, label: '数据异常' };
  }

  const delta = last - first;
  const deltaM = safeMillions(delta);
  const sign = delta >= 0 ? '+' : '';
  const windowLabel = windowMs === 5 * 60 * 1000 ? '5m' : '15m';
  const label = `${sign}$${deltaM != null ? Math.abs(deltaM).toFixed(0) : '--'}M/${windowLabel}`;

  // Threshold: $5M for 5m window, $15M for 15m window
  const threshold = windowMs <= 5 * 60 * 1000 ? 5_000_000 : 15_000_000;
  const direction = delta > threshold ? 'bullish' : delta < -threshold ? 'bearish' : 'flat';

  return { direction, delta, delta_millions: deltaM, label, is_fallback: false };
}

/**
 * Classify flow behavior based on premium, ratio, and wall context
 */
function classifyFlowBehavior({
  net_premium,
  call_premium,
  put_premium,
  put_call_ratio,
  pc_volume_ratio = null,
  pc_premium_ratio = null,
  pc_primary_ratio = null,
  directional_net_premium = null,
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
  const pcVol = safeNumber(pc_volume_ratio);
  const pcPremRatio = safeNumber(pc_premium_ratio);
  const pcPrimary = safeNumber(pc_primary_ratio) ?? pcRatio;
  const dirNetPrem = safeNumber(directional_net_premium) ?? netPrem;

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
 * Compute 15-minute net premium acceleration (legacy, kept for compatibility)
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
 * Main Flow Behavior Engine (v2 — 5m+15m Dual Window)
 *
 * @param {object} params
 * @param {number} params.net_premium      - Current net premium (5m snapshot)
 * @param {number} params.call_premium     - Current call premium
 * @param {number} params.put_premium      - Current put premium
 * @param {number} params.put_call_ratio   - P/C ratio
 * @param {Array}  params.prem_ticks       - Legacy prem ticks (for backward compat)
 * @param {Array}  params.premium_queue    - New: time-series queue from PremiumAccelerationQueue
 *                                           Each entry: { net_premium, call_premium, put_premium, ts }
 * @param {string} params.gamma_regime     - 'positive' | 'negative' | 'neutral' | 'unknown'
 * @param {string} params.spot_position    - Spot position relative to gamma flip
 * @param {string} params.darkpool_state   - Darkpool state
 * @param {number} params.put_wall         - Near put wall
 * @param {number} params.call_wall        - Near call wall
 * @param {number} params.spot_price       - Current SPX spot price
 */
export function buildFlowBehaviorEngine({
  net_premium = null,
  call_premium = null,
  put_premium = null,
  put_call_ratio = null,
  pc_volume_ratio = null,
  pc_premium_ratio = null,
  pc_primary_ratio = null,
  directional_net_premium = null,
  prem_ticks = [],
  premium_queue = [],   // NEW: time-series queue for 5m/15m window computation
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
  const pcVol = safeNumber(pc_volume_ratio);
  const pcPremRatio = safeNumber(pc_premium_ratio);
  const pcPrimary = safeNumber(pc_primary_ratio) ?? pcRatio;
  const dirNetPrem = safeNumber(directional_net_premium) ?? netPrem;
  const spot = safeNumber(spot_price);

  // ── 5m + 15m Dual Window Flow Direction ────────────────────────────────────
  // Use premium_queue if available (from PremiumAccelerationQueue._queue)
  // Fall back to prem_ticks for legacy compatibility
  const queueForWindows = premium_queue.length > 0 ? premium_queue : prem_ticks.map((t) => ({
    net_premium: t.net_premium,
    ts: typeof t.timestamp === 'number' ? t.timestamp : Date.parse(t.timestamp)
  }));

  const flow5m  = computeWindowDirection(queueForWindows, 5  * 60 * 1000);
  const flow15m = computeWindowDirection(queueForWindows, 15 * 60 * 1000);

  // Dual window alignment
  const bothKnown = flow5m.direction !== 'unknown' && flow15m.direction !== 'unknown';
  const dualAligned = bothKnown && flow5m.direction === flow15m.direction && flow5m.direction !== 'flat';
  const dualConflict = bothKnown && flow5m.direction !== 'flat' && flow15m.direction !== 'flat'
    && flow5m.direction !== flow15m.direction;

  let dualWindowLabel = '双窗口数据不足';
  if (bothKnown) {
    if (dualAligned) {
      dualWindowLabel = `5m ${flow5m.label} + 15m ${flow15m.label} 一致 → 方向可信`;
    } else if (dualConflict) {
      dualWindowLabel = `5m ${flow5m.label} 与 15m ${flow15m.label} 冲突 → 方向降级`;
    } else {
      dualWindowLabel = `5m ${flow5m.label} / 15m ${flow15m.label}`;
    }
  }

  // ── Classify behavior ──────────────────────────────────────────────────────
  const { behavior, confidence: rawConfidence, reason } = classifyFlowBehavior({
    net_premium: netPrem,
    call_premium: callPrem,
    put_premium: putPrem,
    put_call_ratio: pcRatio,
    pc_volume_ratio: pcVol,
    pc_premium_ratio: pcPremRatio,
    pc_primary_ratio: pcPrimary,
    directional_net_premium: dirNetPrem,
    gamma_regime,
    spot_position,
    darkpool_state,
    put_wall,
    call_wall,
    spot
  });

  // ── Confidence adjustment based on dual window ─────────────────────────────
  let confidence = rawConfidence;
  if (dualAligned) {
    // Boost: both windows agree
    if (confidence === 'low') confidence = 'medium';
    else if (confidence === 'medium') confidence = 'high';
  } else if (dualConflict) {
    // Downgrade: windows conflict
    if (confidence === 'high') confidence = 'medium';
  }

  // ── 15-minute acceleration (legacy) ───────────────────────────────────────
  const acceleration = calcPremAcceleration(prem_ticks);

  // ── P/C ratio extremes ─────────────────────────────────────────────────────
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

  // ── Flow aggression score (0–100) ──────────────────────────────────────────
  let aggressionScore = 0;
  if (netPrem != null) {
    const absM = Math.abs(netPrem) / 1_000_000;
    aggressionScore += Math.min(50, absM * 2);
  }
  if (acceleration.is_accelerating) aggressionScore += 20;
  if (pcExtreme.extreme) aggressionScore += 15;
  if (dualAligned) aggressionScore += 15;  // Bonus for dual window alignment
  aggressionScore = Math.min(100, Math.round(aggressionScore));

  // ── Behavior labels ────────────────────────────────────────────────────────
  const behaviorLabels = {
    put_effective: { label: 'Put 有效', label_en: 'PUT EFFECTIVE', color: 'red', icon: '⬇' },
    put_squeezed: { label: 'Put 被绞', label_en: 'PUT SQUEEZED', color: 'amber', icon: '⚡' },
    call_effective: { label: 'Call 有效', label_en: 'CALL EFFECTIVE', color: 'green', icon: '⬆' },
    call_capped: { label: 'Call 被压', label_en: 'CALL CAPPED', color: 'amber', icon: '⚡' },
    mixed: { label: '多空混战', label_en: 'MIXED', color: 'violet', icon: '↔' },
    neutral: { label: '无明显资金流', label_en: 'NEUTRAL', color: 'gray', icon: '—' }
  };

  const behaviorMeta = behaviorLabels[behavior] || behaviorLabels.neutral;

  // ── Prohibit direction based on behavior ───────────────────────────────────
  const prohibit = {
    put_effective: 'CALL',
    put_squeezed: 'PUT',
    call_effective: 'PUT',
    call_capped: 'CALL',
    mixed: 'BOTH',
    neutral: null
  }[behavior] ?? null;

  // ── Dual window narrative ──────────────────────────────────────────────────
  // Phase 3 fix: when behavior === 'put_squeezed', NEVER output "空头动能可信"
  // because put_squeezed means the bearish flow is being absorbed (positive gamma / darkpool)
  // ── DEGRADED guard: 5m delta === 15m delta 说明窗口数据相同（缓存复用），不可信 ──
  const _isDegraded = flow5m.is_fallback || flow15m.is_fallback ||
    (flow5m.delta != null && flow15m.delta != null && flow5m.delta === flow15m.delta);
  let dualWindowNarrative = '';
  if (_isDegraded) {
    // DEGRADED: 禁止输出"动能可信"，强制降级
    dualWindowNarrative = `Flow 数据降级（窗口数据不足或缓存复用），方向降级，等确认。`;
  } else if (behavior === 'put_squeezed' && dualAligned && flow5m.direction === 'bearish') {
    // Put flow heavy but being absorbed — downgrade bearish narrative
    dualWindowNarrative = `Put 很重（${flow5m.label} / ${flow15m.label}），但动能被吸收（${reason || '正 Gamma / 暗池承接'}），空头动能降级，LOCKED。`;
  } else if (dualAligned && flow5m.direction === 'bullish') {
    dualWindowNarrative = `5m+15m 双窗口同步偏多（${flow5m.label} / ${flow15m.label}），多头动能可信。`;
  } else if (dualAligned && flow5m.direction === 'bearish') {
    dualWindowNarrative = `5m+15m 双窗口同步偏空（${flow5m.label} / ${flow15m.label}），空头动能可信。`;
  } else if (dualConflict) {
    dualWindowNarrative = `5m 和 15m 方向冲突（${flow5m.label} vs ${flow15m.label}），方向降级，等确认。`;
  } else if (bothKnown) {
    dualWindowNarrative = `5m ${flow5m.label} / 15m ${flow15m.label}，方向待确认。`;
  }

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
    directional_net_premium: dirNetPrem,
    call_premium_abs: callPrem != null ? Math.abs(callPrem) : null,
    put_premium_abs: putPrem != null ? Math.abs(putPrem) : null,
    put_call_ratio: pcRatio,
    pc_volume_ratio: pcVol,
    pc_premium_ratio: pcPremRatio,
    pc_primary_ratio: pcPrimary,
    flow_state: behavior === 'put_squeezed' ? 'PUT_HEAVY_ABSORBED' : behavior.toUpperCase(),
    flow_quality: _isDegraded ? 'DEGRADED' : 'NORMAL',
    homepage_allow_direction: !_isDegraded,  // false when DEGRADED — frontend must not show direction
    flow_narrative: _isDegraded ? 'Flow 数据降级，方向降级，等确认。' : (behavior === 'put_squeezed' ? 'Put 偏重，但跌不动，空头动能降级，LOCKED。' : dualWindowNarrative),

    // ── NEW: 5m + 15m Dual Window ──────────────────────────────────────────
    flow_5m_direction:  flow5m.direction,
    flow_5m_delta:      flow5m.delta,
    flow_5m_delta_millions: flow5m.delta_millions,
    flow_5m_label:      flow5m.label,
    flow_15m_direction: flow15m.direction,
    flow_15m_delta:     flow15m.delta,
    flow_15m_delta_millions: flow15m.delta_millions,
    flow_15m_label:     flow15m.label,
    dual_window_aligned: dualAligned,
    dual_window_conflict: dualConflict,
    dual_window_label:  dualWindowLabel,
    dual_window_narrative: dualWindowNarrative || null,
    // Phase 3 fix: explicit flag for frontend LOCKED display
    put_squeezed_locked: behavior === 'put_squeezed' && dualAligned && flow5m.direction === 'bearish',
    queue_size: queueForWindows.length,
    // Phase 4 fix: detect suspicious same-value windows (cache reuse or fallback bug)
    suspicious_same_window: (
      flow5m.delta != null && flow15m.delta != null &&
      flow5m.delta === flow15m.delta
    ) || (flow5m.is_fallback === true || flow15m.is_fallback === true),
    flow_5m_is_fallback:  flow5m.is_fallback  ?? false,
    flow_15m_is_fallback: flow15m.is_fallback ?? false,

    // Acceleration (legacy)
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
