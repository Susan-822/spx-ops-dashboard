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
  const put = valueFor(row, ['put_gamma_oi', 'put_gex_oi', 'put_gamma', 'put_gex']) ?? 0;
  return call + put;
}

function pct(value) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(3));
}

function nearestWall({ spot, callWall, putWall }) {
  const candidates = [
    callWall != null ? { side: 'upper', level: callWall, distance: Math.abs(callWall - spot) } : null,
    putWall != null ? { side: 'lower', level: putWall, distance: Math.abs(spot - putWall) } : null
  ].filter(Boolean);
  return candidates.sort((a, b) => a.distance - b.distance)[0] || { side: 'unknown', level: null };
}

function gammaFlip(sortedRows = []) {
  const points = sortedRows
    .map((row) => ({ strike: numberOrNull(row.strike ?? row.price ?? row.level), gamma: gammaValue(row) }))
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
  return closest ? { level: closest.strike, confidence: 'low_confidence_flip' } : { level: null, confidence: 'unavailable' };
}

export function buildDealerWallMap({ dealer = {}, spot_price = null } = {}) {
  const spot = numberOrNull(spot_price ?? dealer.spot_price);
  const allRows = rows(dealer.spot_gex_rows);
  const usableRows = spot == null
    ? []
    : allRows
      .map((row) => ({ ...row, strike: numberOrNull(row.strike ?? row.price ?? row.level) }))
      .filter((row) => row.strike != null && Math.abs(row.strike - spot) / spot <= 0.15);
  const upperRows = usableRows.filter((row) => row.strike >= spot);
  const lowerRows = usableRows.filter((row) => row.strike <= spot);
  const callRow = [...upperRows].sort((a, b) =>
    (valueFor(b, ['call_gamma_oi', 'call_gex_oi', 'call_gamma', 'call_gex']) ?? 0)
    - (valueFor(a, ['call_gamma_oi', 'call_gex_oi', 'call_gamma', 'call_gex']) ?? 0)
  )[0];
  const putRow = [...lowerRows].sort((a, b) =>
    Math.abs(valueFor(b, ['put_gamma_oi', 'put_gex_oi', 'put_gamma', 'put_gex']) ?? 0)
    - Math.abs(valueFor(a, ['put_gamma_oi', 'put_gex_oi', 'put_gamma', 'put_gex']) ?? 0)
  )[0];
  const callWall = callRow?.strike ?? null;
  const putWall = putRow?.strike ?? null;
  const flip = gammaFlip(usableRows);
  const regime = spot != null && flip.level != null && spot > flip.level ? 'positive_gamma_magnet' : spot != null && flip.level != null ? 'negative_gamma_slide' : 'unknown';
  const nearest = spot != null ? nearestWall({ spot, callWall, putWall }) : { side: 'unknown', level: null };
  const rowsUsed = usableRows.length;
  return {
    spot_price: spot,
    rows_used: rowsUsed,
    call_wall: callWall,
    put_wall: putWall,
    upper_barrier: callWall,
    lower_barrier: putWall,
    gamma_flip: flip.level,
    nearest_wall: nearest.level,
    nearest_wall_side: nearest.side,
    distance_to_call_wall_pct: spot != null && callWall != null ? pct((callWall - spot) / spot * 100) : null,
    distance_to_put_wall_pct: spot != null && putWall != null ? pct((spot - putWall) / spot * 100) : null,
    distance_to_flip_pct: spot != null && flip.level != null ? pct((spot - flip.level) / spot * 100) : null,
    regime,
    regime_cn: regime === 'positive_gamma_magnet'
      ? '当前在 Flip 上方，偏正 Gamma 磁吸区，容易震荡和均值回归。'
      : regime === 'negative_gamma_slide'
        ? '当前在 Flip 下方，偏负 Gamma 放波区，容易单边加速。'
        : 'Gamma Flip 暂不能确认。',
    confidence: rowsUsed > 0 && callWall != null && putWall != null && flip.level != null ? flip.confidence : 'unavailable',
    summary_cn: rowsUsed > 0
      ? `Dealer 已完成压缩：上方 Call Wall 约 ${callWall ?? '--'}，下方 Put Wall 约 ${putWall ?? '--'}，Flip 约 ${flip.level ?? '--'}，当前价格处于两墙之间。`
      : 'Dealer 现价附近 rows 不足，不能压缩墙位。',
    action_cn: rowsUsed > 0
      ? '当前不是单边发车区，更像墙位夹击震荡区；不追高，不追空。'
      : '先修 Dealer 抓取窗口 / 分页，再压缩墙位。'
  };
}
