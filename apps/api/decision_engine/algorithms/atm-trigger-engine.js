/**
 * atm-trigger-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ATM Trigger Line Engine for 0DTE SPX Intraday Trading
 *
 * Core design principle:
 *   - Homepage ONLY shows ATM±5/10/15/20 trigger lines (near-term execution)
 *   - Far GEX walls (7200/7000) go to Radar page only (global_gex_cluster)
 *   - Lock zone = ATM±5 ("no man's land" — do NOT trade here)
 *   - Bull trigger 1 = ATM+5 (first confirmation)
 *   - Bull trigger 2 = ATM+10 (full confirmation)
 *   - Bear trigger 1 = ATM-5 (first confirmation)
 *   - Bear trigger 2 = ATM-10 (full confirmation)
 *
 * Outputs:
 *   bull_trigger_1    ATM+5   (第一多头触发线)
 *   bull_trigger_2    ATM+10  (多头确认线)
 *   bull_target_1     ATM+15  (多头目标1)
 *   bull_target_2     ATM+20  (多头目标2)
 *   bear_trigger_1    ATM-5   (第一空头触发线)
 *   bear_trigger_2    ATM-10  (空头确认线)
 *   bear_target_1     ATM-15  (空头目标1)
 *   bear_target_2     ATM-20  (空头目标2)
 *   invalidation_bull ATM-10  (多头失效线)
 *   invalidation_bear ATM+10  (空头失效线)
 *   lock_zone         [ATM-5, ATM+5]  (锁仓区)
 *   near_call_wall    近端 Call Wall（首页用，≤ATM+50）
 *   near_put_wall     近端 Put Wall（首页用，≥ATM-50）
 *   global_call_wall  远端 Call Wall（仅 Radar 页）
 *   global_put_wall   远端 Put Wall（仅 Radar 页）
 *   spot_in_lock_zone boolean
 *   trigger_status    'bull_triggered' | 'bear_triggered' | 'locked' | 'unknown'
 *   trigger_label     人话描述
 */

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(n, d = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return Number(n).toFixed(d);
}

/**
 * Determine if a wall is "near" (within ATM±50) or "far" (>ATM±50)
 * Near walls are shown on homepage; far walls go to Radar only.
 */
// classifyWall: used ONLY for ATM execution line classification (near = within ATM±50pt)
// NOTE: This is NOT used for GEX walls on homepage. GEX walls use gex_local_call_wall (±30pt)
// and far_call_wall (>30pt, Radar only). See dealer-wall-engine.js for GEX layer definitions.
function classifyWall(wallLevel, atm, side) {
  if (wallLevel == null || atm == null) return { near: null, far: wallLevel };
  const dist = Math.abs(wallLevel - atm);
  // 50pt threshold: for ATM execution line classification only
  // (ATM±50 = the range where GEX walls directly affect 0DTE execution)
  const ATM_EXEC_THRESHOLD = 50;
  if (side === 'call') {
    // Call wall must be above ATM
    if (wallLevel <= atm) return { near: null, far: wallLevel };
    return dist <= ATM_EXEC_THRESHOLD ? { near: wallLevel, far: null } : { near: null, far: wallLevel };
  } else {
    // Put wall must be below ATM
    if (wallLevel >= atm) return { near: null, far: wallLevel };
    return dist <= ATM_EXEC_THRESHOLD ? { near: wallLevel, far: null } : { near: null, far: wallLevel };
  }
}

/**
 * Main ATM Trigger Engine
 *
 * @param {object} params
 * @param {number} params.spot           - Current SPX spot price
 * @param {number} params.atm            - ATM strike (nearest 5-pt)
 * @param {number} params.near_call_wall - Near call wall from dealer-wall-engine
 * @param {number} params.near_put_wall  - Near put wall from dealer-wall-engine
 * @param {string} params.gamma_regime   - 'positive' | 'negative' | 'neutral' | 'unknown'
 * @param {number} params.pin_risk       - Pin risk score 0-100
 * @param {string} params.flow_behavior  - Flow behavior from flow-behavior-engine
 * @param {number} params.execution_confidence - Confidence score 0-100
 */
export function buildAtmTriggerEngine({
  spot = null,
  atm = null,
  near_call_wall = null,
  near_put_wall = null,
  gamma_regime = 'unknown',
  pin_risk = 0,
  flow_behavior = 'neutral',
  execution_confidence = 0
} = {}) {
  const spotVal = safeN(spot);
  const atmVal  = safeN(atm);
  // Guard: SPX ATM must be >= 1000. Treat 0 or small values as invalid (non-trading hours).
  const validAtm  = (atmVal  != null && atmVal  >= 1000) ? atmVal  : null;
  const validSpot = (spotVal != null && spotVal >= 1000) ? spotVal : null;
  // Fallback: if atm is null but spot is available, compute ATM from spot
  const effectiveAtm = validAtm ?? (validSpot != null ? Math.round(validSpot / 5) * 5 : null);

  if (effectiveAtm == null) {
    return {
      atm: null,
      bull_trigger_1: null, bull_trigger_2: null,
      bull_target_1: null,  bull_target_2: null,
      bear_trigger_1: null, bear_trigger_2: null,
      bear_target_1: null,  bear_target_2: null,
      invalidation_bull: null, invalidation_bear: null,
      lock_zone: null,
      near_call_wall: null, near_put_wall: null,
      global_call_wall: null, global_put_wall: null,
      spot_in_lock_zone: null,
      trigger_status: 'unknown',
      trigger_label: 'ATM 未知，无法生成触发线',
      trigger_label_cn: 'ATM 未知，无法生成触发线',
      degraded: true
    };
  }

  // ── Core trigger lines (ATM-relative) ─────────────────────────────────────
  const bull_trigger_1 = effectiveAtm + 5;   // 第一多头触发
  const bull_trigger_2 = effectiveAtm + 10;  // 多头确认
  const bull_target_1  = effectiveAtm + 15;  // 多头目标1
  const bull_target_2  = effectiveAtm + 20;  // 多头目标2

  const bear_trigger_1 = effectiveAtm - 5;   // 第一空头触发
  const bear_trigger_2 = effectiveAtm - 10;  // 空头确认
  const bear_target_1  = effectiveAtm - 15;  // 空头目标1
  const bear_target_2  = effectiveAtm - 20;  // 空头目标2

  const invalidation_bull = effectiveAtm - 10;  // 多头失效线（跌破此处多头预案作废）
  const invalidation_bear = effectiveAtm + 10;  // 空头失效线（站上此处空头预案作废）

  const lock_zone = {
    lower: bear_trigger_1,  // ATM-5
    upper: bull_trigger_1,  // ATM+5
    label: `${fmt(bear_trigger_1)}–${fmt(bull_trigger_1)} 锁仓区（ATM±5）`
  };

  // ── Spot position relative to lock zone ───────────────────────────────────
  const spotInLockZone = spotVal != null
    ? (spotVal >= bear_trigger_1 && spotVal <= bull_trigger_1)
    : null;

  const spotAboveBull2 = spotVal != null && spotVal > bull_trigger_2;
  const spotBelowBear2 = spotVal != null && spotVal < bear_trigger_2;
  const spotAboveBull1 = spotVal != null && spotVal > bull_trigger_1;
  const spotBelowBear1 = spotVal != null && spotVal < bear_trigger_1;

  // ── Wall classification: near (homepage) vs far (Radar only) ──────────────
  const callWallClass = classifyWall(near_call_wall, effectiveAtm, 'call');
  const putWallClass  = classifyWall(near_put_wall,  effectiveAtm, 'put');

  const homepageCallWall = callWallClass.near;  // ≤ATM+50 → homepage
  const homepagePutWall  = putWallClass.near;   // ≥ATM-50 → homepage
  const globalCallWall   = callWallClass.far ?? near_call_wall;   // >ATM+50 → Radar only
  const globalPutWall    = putWallClass.far  ?? near_put_wall;    // >ATM-50 → Radar only

  // ── Trigger status ─────────────────────────────────────────────────────────
  let trigger_status = 'locked';
  let trigger_label  = `${fmt(effectiveAtm)} ATM 附近不做，等 ${fmt(bull_trigger_1)} 站稳或 ${fmt(bear_trigger_1)} 跌破`;

  if (spotAboveBull2) {
    trigger_status = 'bull_triggered';
    trigger_label  = `价格 ${fmt(spotVal, 1)} 已突破 ${fmt(bull_trigger_2)} 多头确认线，多头有效`;
  } else if (spotBelowBear2) {
    trigger_status = 'bear_triggered';
    trigger_label  = `价格 ${fmt(spotVal, 1)} 已跌破 ${fmt(bear_trigger_2)} 空头确认线，空头有效`;
  } else if (spotAboveBull1) {
    trigger_status = 'bull_watching';
    trigger_label  = `价格 ${fmt(spotVal, 1)} 在 ${fmt(bull_trigger_1)} 第一触发线上方，等 ${fmt(bull_trigger_2)} 确认`;
  } else if (spotBelowBear1) {
    trigger_status = 'bear_watching';
    trigger_label  = `价格 ${fmt(spotVal, 1)} 在 ${fmt(bear_trigger_1)} 第一触发线下方，等 ${fmt(bear_trigger_2)} 确认`;
  } else if (spotInLockZone) {
    trigger_status = 'locked';
    trigger_label  = `${fmt(effectiveAtm)} ATM 附近不做，等 ${fmt(bull_trigger_1)} 站稳或 ${fmt(bear_trigger_1)} 跌破`;
  }

  // ── Gamma regime overlay ───────────────────────────────────────────────────
  let gammaNote = '';
  if (gamma_regime === 'positive') {
    gammaNote = `正 Gamma 磁吸，价格容易被拉回 ${fmt(effectiveAtm)} ATM，来回割。`;
  } else if (gamma_regime === 'negative') {
    gammaNote = `负 Gamma 放波，方向确认后单边行情概率高，快进快出。`;
  }

  // ── Pin risk overlay ───────────────────────────────────────────────────────
  let pinNote = '';
  if (pin_risk >= 70) {
    pinNote = `ATM 吸附风险高（${pin_risk}/100），${fmt(effectiveAtm)} 附近禁止买 0DTE 方向单。`;
  } else if (pin_risk >= 40) {
    pinNote = `ATM 吸附风险中等（${pin_risk}/100），${fmt(effectiveAtm)} 附近谨慎。`;
  }

  // ── LOCKED 状态完整观察计划 ────────────────────────────────────────────────
  const lockedObservationPlan = {
    state:        '锁仓观察',
    why:          spotInLockZone
      ? `价格在 ${fmt(bear_trigger_1)}–${fmt(bull_trigger_1)} ATM 锁仓区内，${gammaNote || '等方向确认。'}`
      : `${trigger_label}`,
    watch:        `上方 ${fmt(bull_trigger_1)} 能不能站稳 / 下方 ${fmt(bear_trigger_1)} 能不能跌破`,
    wait_long:    `站稳 ${fmt(bull_trigger_1)}（第一触发），等 ${fmt(bull_trigger_2)} 确认，目标 ${fmt(bull_target_1)}–${fmt(bull_target_2)}`,
    wait_short:   `跌破 ${fmt(bear_trigger_1)}（第一触发），等 ${fmt(bear_trigger_2)} 确认，目标 ${fmt(bear_target_1)}–${fmt(bear_target_2)}`,
    forbidden:    `${fmt(bear_trigger_1)}–${fmt(bull_trigger_1)} ATM 锁仓区内禁止买 Call / Put`,
    invalidation: `多头失效线 ${fmt(invalidation_bull)}（跌破此处多头预案作废）/ 空头失效线 ${fmt(invalidation_bear)}（站上此处空头预案作废）`
  };

  // ── Bull / Bear execution plans ────────────────────────────────────────────
  const bullExecutionPlan = {
    state:        '多头预案',
    why:          `价格站上 ${fmt(bull_trigger_1)} 第一触发线，等 ${fmt(bull_trigger_2)} 确认后做多`,
    watch:        `${fmt(bull_trigger_2)} 能否站稳，Call Flow 是否持续`,
    wait_long:    `${fmt(bull_trigger_1)} 站稳 → 等 ${fmt(bull_trigger_2)} 10分钟K线确认 → 进场`,
    wait_short:   `不适用`,
    forbidden:    `禁止在 ${fmt(effectiveAtm)} ATM 附近直接追多；禁止在 Put Flow 增强时买 Call`,
    invalidation: `有效跌破 ${fmt(invalidation_bull)}，多头预案作废`,
    entry:        `${fmt(bull_trigger_2)} 站稳后回踩 8EMA 入场`,
    target:       `${fmt(bull_target_1)} → ${fmt(bull_target_2)}`,
    stop:         `${fmt(invalidation_bull)} 跌破止损`
  };

  const bearExecutionPlan = {
    state:        '空头预案',
    why:          `价格跌破 ${fmt(bear_trigger_1)} 第一触发线，等 ${fmt(bear_trigger_2)} 确认后做空`,
    watch:        `${fmt(bear_trigger_2)} 能否跌破，Put Flow 是否持续`,
    wait_long:    `不适用`,
    wait_short:   `${fmt(bear_trigger_1)} 跌破 → 等 ${fmt(bear_trigger_2)} 10分钟K线确认 → 进场`,
    forbidden:    `禁止在 ${fmt(effectiveAtm)} ATM 附近直接追空；禁止在 Call Flow 增强时买 Put`,
    invalidation: `有效站上 ${fmt(invalidation_bear)}，空头预案作废`,
    entry:        `${fmt(bear_trigger_2)} 跌破后反抽 8EMA 入场`,
    target:       `${fmt(bear_target_1)} → ${fmt(bear_target_2)}`,
    stop:         `${fmt(invalidation_bear)} 站上止损`
  };

  return {
    // Core ATM
    atm: effectiveAtm,
    atm_fmt: fmt(effectiveAtm),

    // Bull trigger lines
    bull_trigger_1,
    bull_trigger_2,
    bull_target_1,
    bull_target_2,
    bull_trigger_1_fmt: fmt(bull_trigger_1),
    bull_trigger_2_fmt: fmt(bull_trigger_2),
    bull_target_1_fmt:  fmt(bull_target_1),
    bull_target_2_fmt:  fmt(bull_target_2),

    // Bear trigger lines
    bear_trigger_1,
    bear_trigger_2,
    bear_target_1,
    bear_target_2,
    bear_trigger_1_fmt: fmt(bear_trigger_1),
    bear_trigger_2_fmt: fmt(bear_trigger_2),
    bear_target_1_fmt:  fmt(bear_target_1),
    bear_target_2_fmt:  fmt(bear_target_2),

    // Invalidation lines
    invalidation_bull,
    invalidation_bear,
    invalidation_bull_fmt: fmt(invalidation_bull),
    invalidation_bear_fmt: fmt(invalidation_bear),

    // Lock zone
    lock_zone,
    spot_in_lock_zone: spotInLockZone,

    // Wall classification
    near_call_wall:   homepageCallWall,   // homepage only (≤ATM+50)
    near_put_wall:    homepagePutWall,    // homepage only (≥ATM-50)
    global_call_wall: globalCallWall,     // Radar page only
    global_put_wall:  globalPutWall,      // Radar page only
    near_call_wall_fmt: homepageCallWall != null ? fmt(homepageCallWall) : 'unavailable',
    near_put_wall_fmt:  homepagePutWall  != null ? fmt(homepagePutWall)  : 'unavailable',
    global_call_wall_fmt: globalCallWall != null ? fmt(globalCallWall) : '--',
    global_put_wall_fmt:  globalPutWall  != null ? fmt(globalPutWall)  : '--',

    // Status
    trigger_status,
    trigger_label,
    gamma_note: gammaNote || null,
    pin_note:   pinNote   || null,

    // Execution plans
    locked_observation_plan: lockedObservationPlan,
    bull_execution_plan: bullExecutionPlan,
    bear_execution_plan: bearExecutionPlan,

    // Spot context
    spot: spotVal,
    spot_above_bull1: spotAboveBull1,
    spot_above_bull2: spotAboveBull2,
    spot_below_bear1: spotBelowBear1,
    spot_below_bear2: spotBelowBear2,

    degraded: false
  };
}
