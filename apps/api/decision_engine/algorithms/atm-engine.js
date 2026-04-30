/**
 * atm-engine.js
 *
 * ATM (At-The-Money) Strike Identification Engine
 *
 * Computes:
 *  - Current ATM strike (nearest 5-pt and 10-pt)
 *  - ATM trend (up/down/flat) based on recent ATM history
 *  - Meaning of ATM movement for market direction
 *  - Pin risk (probability of price being pinned to ATM at expiry)
 */

import { validateSpxPrice } from './price-contract.js';

/**
 * Round to nearest N points
 */
function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Determine ATM trend from history array
 * @param {number[]} history - array of recent ATM values (oldest first)
 */
function calcAtmTrend(history = []) {
  if (history.length < 2) return 'flat';
  const recent = history.slice(-3);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

/**
 * Calculate pin risk score (0–100)
 * Higher = more likely price pins to ATM at expiry
 */
function calcPinRisk({ spot, atm, net_gex = 0, time_to_close_minutes = 390 }) {
  if (spot == null || atm == null) return 0;
  const distancePts = Math.abs(spot - atm);
  // Distance component: closer to ATM = higher pin risk
  const distanceScore = Math.max(0, 100 - distancePts * 4);
  // GEX component: higher positive GEX = stronger pin
  const gexScore = net_gex > 0 ? Math.min(40, net_gex / 100000 * 10) : 0;
  // Time component: later in day = higher pin risk
  const timeScore = Math.max(0, 30 - time_to_close_minutes / 13);
  return Math.min(100, Math.round(distanceScore * 0.5 + gexScore + timeScore));
}

/**
 * Main ATM engine
 */
export function buildAtmEngine({
  spot_price = null,
  previous_atm = null,
  atm_history = [],
  net_gex = 0,
  time_to_close_minutes = 390
} = {}) {
  const spot = validateSpxPrice(spot_price);

  if (spot == null) {
    return {
      atm: null,
      atm_5: null,
      atm_10: null,
      previous_atm: null,
      atm_trend: 'unknown',
      atm_change: null,
      meaning: 'SPX 实时价格未接入，无法计算 ATM',
      meaning_cn: 'SPX 实时价格未接入，无法计算盘眼',
      pin_risk: 0,
      distance_to_atm: null,
      mid_zone: null,
      degraded: true
    };
  }

  const atm5 = roundToNearest(spot, 5);
  const atm10 = roundToNearest(spot, 10);
  const atm = atm5; // Primary ATM is 5-point

  // ATM trend
  const history = [...atm_history, atm];
  const trend = calcAtmTrend(history);
  const prevAtm = previous_atm ?? (atm_history.length > 0 ? atm_history[atm_history.length - 1] : null);
  const atmChange = prevAtm != null ? atm - prevAtm : null;

  // Meaning
  let meaning = 'flat';
  let meaning_cn = '盘眼未移动，中轴绞肉区间';

  if (trend === 'up') {
    meaning = 'bullish_recovery';
    meaning_cn = '盘眼上移，多头修复中';
  } else if (trend === 'down') {
    meaning = 'bearish_pressure';
    meaning_cn = '盘眼下移，空头增强';
  }

  // Consecutive trend detection
  if (atm_history.length >= 3) {
    const last3 = atm_history.slice(-3);
    const allUp = last3.every((v, i) => i === 0 || v > last3[i - 1]);
    const allDown = last3.every((v, i) => i === 0 || v < last3[i - 1]);
    if (allUp) {
      meaning = 'put_paused';
      meaning_cn = '盘眼连续上移，Put 动能暂停';
    } else if (allDown) {
      meaning = 'call_paused';
      meaning_cn = '盘眼连续下移，Call 动能暂停';
    }
  }

  const distanceToAtm = Math.abs(spot - atm);
  const pinRisk = calcPinRisk({ spot, atm, net_gex, time_to_close_minutes });

  // Mid zone: ATM ± 5 is the "no man's land" for 0DTE buyers
  const midZone = {
    lower: atm - 5,
    upper: atm + 5,
    in_zone: distanceToAtm <= 5,
    label: distanceToAtm <= 5 ? '当前在 ATM 中轴禁做区' : '当前在 ATM 中轴区外'
  };

  return {
    atm,
    atm_5: atm5,
    atm_10: atm10,
    previous_atm: prevAtm,
    atm_trend: trend,
    atm_change: atmChange,
    meaning,
    meaning_cn,
    pin_risk: pinRisk,
    pin_risk_label: pinRisk >= 70 ? '高吸附风险，禁止 ATM 附近买 0DTE' : pinRisk >= 40 ? '中等吸附风险' : '低吸附风险',
    distance_to_atm: distanceToAtm,
    mid_zone: midZone,
    degraded: false
  };
}
