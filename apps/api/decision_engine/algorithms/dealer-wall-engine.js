import { numberOrNull } from './safe-number.js';

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function valueFor(row = {}, keys = []) {
  for (const key of keys) {
    const value = numberOrNull(row[key]);
    if (value != null) return value;
  }
  return null;
}

function gammaValue(row = {}) {
  const call = valueFor(row, ['call_gamma_oi', 'call_gex_oi', 'call_gamma', 'call_gex']) ?? 0;
  const put  = valueFor(row, ['put_gamma_oi',  'put_gex_oi',  'put_gamma',  'put_gex'])  ?? 0;
  return call + put;
}

function pct(value) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(3));
}

function nearestWall({ spot, callWall, putWall }) {
  const candidates = [
    callWall != null ? { side: 'upper', level: callWall, distance: Math.abs(callWall - spot) } : null,
    putWall  != null ? { side: 'lower', level: putWall,  distance: Math.abs(spot - putWall)  } : null
  ].filter(Boolean);
  return candidates.sort((a, b) => a.distance - b.distance)[0] || { side: 'unknown', level: null };
}

function gammaFlip(sortedRows = []) {
  const points = sortedRows
    .map((row) => ({
      strike: numberOrNull(row.strike ?? row.price ?? row.level),
      gamma:  gammaValue(row)
    }))
    .filter((item) => item.strike != null && item.gamma != null)
    .sort((a, b) => a.strike - b.strike);

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (prev.gamma === 0) return { level: prev.strike, confidence: 'high' };
    if ((prev.gamma < 0 && next.gamma > 0) || (prev.gamma > 0 && next.gamma < 0)) {
      const level = prev.strike + (0 - prev.gamma) * (next.strike - prev.strike) / (next.gamma - prev.gamma);
      return { level: Number(level.toFixed(2)), confidence: 'high' };
    }
  }
  const closest = points.sort((a, b) => Math.abs(a.gamma) - Math.abs(b.gamma))[0];
  return closest
    ? { level: closest.strike, confidence: 'low_confidence_flip' }
    : { level: null, confidence: 'unavailable' };
}

// Layer 2: GEX local reference wall — within ±30pt of spot
// Used for homepage GEX card (informational only, NOT execution trigger)
// Returns null if no significant GEX strike within ±30pt
function findGexLocalCallWall(allRows, spot) {
  if (spot == null || allRows.length === 0) return null;
  const LOCAL_RANGE = 30;
  const candidates = allRows
    .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
    .filter((row) => row.strike != null && row.strike > spot && row.strike <= spot + LOCAL_RANGE);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    Math.abs(valueFor(b, ['call_gex', 'call_gamma_oi', 'call_gex_oi', 'call_gamma']) ?? 0)
    - Math.abs(valueFor(a, ['call_gex', 'call_gamma_oi', 'call_gex_oi', 'call_gamma']) ?? 0)
  );
  return candidates[0]?.strike ?? null;
}
function findGexLocalPutWall(allRows, spot) {
  if (spot == null || allRows.length === 0) return null;
  const LOCAL_RANGE = 30;
  const candidates = allRows
    .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
    .filter((row) => row.strike != null && row.strike < spot && row.strike >= spot - LOCAL_RANGE);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    Math.abs(valueFor(b, ['put_gex', 'put_gamma_oi', 'put_gex_oi', 'put_gamma']) ?? 0)
    - Math.abs(valueFor(a, ['put_gex', 'put_gamma_oi', 'put_gex_oi', 'put_gamma']) ?? 0)
  );
  return candidates[0]?.strike ?? null;
}
// P1-2 fix: near call wall = strictly above spot, within [spot+5, spot+500]
function findNearCallWall(allRows, spot) {
  if (spot == null || allRows.length === 0) return null;
  const candidates = allRows
    .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
    .filter((row) => row.strike != null && row.strike > spot + 5 && row.strike <= spot + 500);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    Math.abs(valueFor(b, ['call_gex', 'call_gamma_oi', 'call_gex_oi', 'call_gamma']) ?? 0)
    - Math.abs(valueFor(a, ['call_gex', 'call_gamma_oi', 'call_gex_oi', 'call_gamma']) ?? 0)
  );
  return candidates[0]?.strike ?? null;
}

// P1-2 fix: near put wall = strictly below spot, within [spot-500, spot-5]
function findNearPutWall(allRows, spot) {
  if (spot == null || allRows.length === 0) return null;
  const candidates = allRows
    .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
    .filter((row) => row.strike != null && row.strike < spot - 5 && row.strike >= spot - 500);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    Math.abs(valueFor(b, ['put_gex', 'put_gamma_oi', 'put_gex_oi', 'put_gamma']) ?? 0)
    - Math.abs(valueFor(a, ['put_gex', 'put_gamma_oi', 'put_gex_oi', 'put_gamma']) ?? 0)
  );
  return candidates[0]?.strike ?? null;
}

// Global GEX clusters — for Radar page only, NOT homepage walls
function findGlobalGexClusters(allRows) {
  if (!allRows.length) return [];
  return [...allRows]
    .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
    .filter((row) => row.strike != null)
    .sort((a, b) =>
      Math.abs(valueFor(b, ['net_gex', 'call_gex', 'put_gex']) ?? 0)
      - Math.abs(valueFor(a, ['net_gex', 'call_gex', 'put_gex']) ?? 0)
    )
    .slice(0, 5)
    .map((row) => ({
      strike:   row.strike,
      net_gex:  valueFor(row, ['net_gex'])  ?? null,
      call_gex: valueFor(row, ['call_gex']) ?? null,
      put_gex:  valueFor(row, ['put_gex'])  ?? null
    }));
}

export function buildDealerWallMap({
  dealer = {},
  spot_price = null,
  gex_rows = null   // P1-3 fix: accept gex_by_strike rows directly
} = {}) {
  const spot = numberOrNull(spot_price ?? dealer.spot_price);

  // Prefer gex_rows (from uw_factors.dealer_factors.gex_by_strike) over dealer.spot_gex_rows
  const allRows = rows(gex_rows).length > 0 ? rows(gex_rows) : rows(dealer.spot_gex_rows);

  // Usable rows: within ±15% of spot (for gamma flip calculation)
  const usableRows = spot == null
    ? []
    : allRows
      .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
      .filter((row) => row.strike != null && Math.abs(row.strike - spot) / spot <= 0.15);

  // P1-2 fix: near walls based on spot position (±500pt, for far background)
  const nearCallWall = findNearCallWall(allRows, spot);
  const nearPutWall  = findNearPutWall(allRows, spot);
  // Layer 2: GEX local reference walls (±30pt, homepage GEX card only)
  const gexLocalCallWall = findGexLocalCallWall(allRows, spot);
  const gexLocalPutWall  = findGexLocalPutWall(allRows, spot);

  // Global GEX clusters (Radar page only, NOT homepage walls)
  const globalGexClusters = findGlobalGexClusters(allRows);

  // Wall validation
  const callWallValid = nearCallWall != null && spot != null && nearCallWall > spot;
  const putWallValid  = nearPutWall  != null && spot != null && nearPutWall  < spot;
  const wallStatus = spot == null
    ? 'unavailable'
    : (callWallValid && putWallValid)
      ? 'valid'
      : (!callWallValid && !putWallValid)
        ? 'unavailable'
        : 'partial';
  const wallErrors = [
    spot == null ? 'spot_missing' : null,
    !callWallValid && spot != null ? 'no_near_call_wall_above_spot' : null,
    !putWallValid  && spot != null ? 'no_near_put_wall_below_spot'  : null
  ].filter(Boolean);

  const flip = gammaFlip(usableRows);

  // Gamma flip distance check
  const flipDistancePt = spot != null && flip.level != null ? Math.abs(spot - flip.level) : null;
  const flipFarFromSpot = flipDistancePt != null && flipDistancePt > 200;

  const regime = spot != null && flip.level != null && spot > flip.level
    ? 'positive_gamma_magnet'
    : spot != null && flip.level != null
      ? 'negative_gamma_slide'
      : 'unknown';

  const nearest = spot != null ? nearestWall({ spot, callWall: nearCallWall, putWall: nearPutWall }) : { side: 'unknown', level: null };
  const rowsUsed = usableRows.length;

  // P0 fix: Gamma flip display text — don't say "现价在翻转点上方" when flip is far or unavailable
  let flipDisplayText;
  if (flip.level == null || flip.confidence === 'unavailable') {
    flipDisplayText = 'Gamma Flip 暂不可判断';
  } else if (flipFarFromSpot) {
    flipDisplayText = `Gamma Flip ${flip.level} 远离现价（距离 ${flipDistancePt?.toFixed(0)} pt），不参与日内执行`;
  } else if (regime === 'positive_gamma_magnet') {
    flipDisplayText = `现价 ${spot} 在 Flip ${flip.level} 上方，正 Gamma 磁吸区`;
  } else {
    flipDisplayText = `现价 ${spot} 在 Flip ${flip.level} 下方，负 Gamma 放波区`;
  }

  return {
    spot_price: spot,
    rows_used: rowsUsed,
    // Layer 3: far background walls (±500pt, Radar only — NOT homepage execution)
    call_wall:      nearCallWall,
    put_wall:       nearPutWall,
    near_call_wall: nearCallWall,
    near_put_wall:  nearPutWall,
    // Layer 2: GEX local reference walls (±30pt, homepage GEX card informational only)
    gex_local_call_wall: gexLocalCallWall,
    gex_local_put_wall:  gexLocalPutWall,
    // Legacy aliases
    upper_barrier: nearCallWall,
    lower_barrier: nearPutWall,
    // Wall validation
    wall_status:     wallStatus,
    wall_errors:     wallErrors,
    call_wall_valid: callWallValid,
    put_wall_valid:  putWallValid,
    // Global GEX clusters (Radar page only)
    global_gex_clusters:      globalGexClusters,
    global_call_gex_cluster:  globalGexClusters.find((c) => (c.call_gex ?? 0) > 0)?.strike ?? null,
    global_put_gex_cluster:   globalGexClusters.find((c) => (c.put_gex  ?? 0) < 0)?.strike ?? null,
    // Gamma flip
    gamma_flip:          flip.level,
    flip_confidence:     flip.confidence,
    flip_distance_pt:    flipDistancePt,
    flip_far_from_spot:  flipFarFromSpot,
    flip_display_text:   flipDisplayText,
    // Nearest wall
    nearest_wall:      nearest.level,
    nearest_wall_side: nearest.side,
    // Distance metrics
    distance_to_call_wall_pct: spot != null && nearCallWall != null ? pct((nearCallWall - spot) / spot * 100) : null,
    distance_to_put_wall_pct:  spot != null && nearPutWall  != null ? pct((spot - nearPutWall)  / spot * 100) : null,
    distance_to_flip_pct: spot != null && flip.level != null ? pct((spot - flip.level) / spot * 100) : null,
    regime,
    regime_cn: regime === 'positive_gamma_magnet'
      ? '当前在 Flip 上方，偏正 Gamma 磁吸区，容易震荡和均值回归。'
      : regime === 'negative_gamma_slide'
        ? '当前在 Flip 下方，偏负 Gamma 放波区，容易单边加速。'
        : 'Gamma Flip 暂不能确认。',
    confidence: rowsUsed > 0 && nearCallWall != null && nearPutWall != null && flip.level != null
      ? flip.confidence
      : 'unavailable',
    summary_cn: rowsUsed > 0 && nearCallWall != null && nearPutWall != null
      ? `近端 Call Wall ${nearCallWall}（上方），近端 Put Wall ${nearPutWall}（下方），Flip ${flip.level ?? '--'}。`
      : rowsUsed > 0
        ? `GEX 数据 ${rowsUsed} 行，但现价附近未找到有效近端墙位。`
        : 'GEX 数据不足，无法计算墙位。',
    action_cn: wallStatus === 'valid'
      ? '墙位校验通过，可参考 Call Wall / Put Wall 执行。'
      : wallStatus === 'partial'
        ? '仅单侧墙位有效，执行时注意方向。'
        : '墙位校验失败，首页不显示墙位数字。'
  };
}
