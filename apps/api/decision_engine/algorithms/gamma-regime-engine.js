/**
 * gamma-regime-engine.js
 *
 * Gamma Regime Calculator
 *
 * Core logic:
 *  - Spot > Gamma Flip → Positive Gamma (damper mode, mean-reversion)
 *  - Spot < Gamma Flip → Negative Gamma (accelerator mode, trend-following)
 *  - Net GEX level determines strength of regime
 *
 * Outputs:
 *  - gamma_regime: 'positive' | 'negative' | 'transitional' | 'unknown'
 *  - dealer_mode: 'control_volatility' | 'amplify_volatility' | 'neutral'
 *  - chase_allowed: boolean
 *  - regime_score: 0–100 (higher = more positive gamma)
 *  - Scores: direction_score, gamma_regime_score, pin_risk_score, break_risk_score, execution_confidence
 */

import { validateSpxPrice } from './price-contract.js';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate Direction Score (-100 to +100)
 * Negative = bearish, Positive = bullish
 */
function calcDirectionScore({ atm_trend, spot, atm, put_call_ratio, net_premium, atm_change }) {
  let score = 0;

  // ATM movement component (±30)
  if (atm_trend === 'up') score += 20;
  else if (atm_trend === 'down') score -= 20;
  if (atm_change != null) {
    score += clamp(atm_change * 2, -10, 10);
  }

  // Price relative to ATM (±20)
  if (spot != null && atm != null) {
    const diff = spot - atm;
    score += clamp(diff * 2, -20, 20);
  }

  // Put/Call ratio (±25)
  if (put_call_ratio != null) {
    if (put_call_ratio > 1.8) score -= 25;
    else if (put_call_ratio > 1.5) score -= 15;
    else if (put_call_ratio < 0.7) score += 25;
    else if (put_call_ratio < 1.0) score += 10;
  }

  // Net premium (±25)
  if (net_premium != null) {
    const premM = net_premium / 1_000_000;
    score += clamp(premM / 10, -25, 25);
  }

  return clamp(Math.round(score), -100, 100);
}

/**
 * Calculate Gamma Regime Score (0–100)
 * Higher = more positive gamma (less chase-friendly)
 */
function calcGammaRegimeScore({ net_gex, spot, gamma_flip }) {
  if (net_gex == null) return 50;
  let score = 50;

  // Net GEX level
  if (net_gex > 500_000) score += 30;
  else if (net_gex > 100_000) score += 20;
  else if (net_gex > 0) score += 10;
  else if (net_gex < -500_000) score -= 30;
  else if (net_gex < -100_000) score -= 20;
  else if (net_gex < 0) score -= 10;

  // Spot vs flip
  if (spot != null && gamma_flip != null) {
    const aboveFlip = spot > gamma_flip;
    if (aboveFlip) score += 10;
    else score -= 10;
  }

  return clamp(Math.round(score), 0, 100);
}

/**
 * Calculate Break Risk Score (0–100)
 * Higher = more likely to break a key level
 */
function calcBreakRiskScore({ net_gex, atm_trend, put_call_ratio, spot, gamma_flip }) {
  let score = 30;

  if (net_gex != null && net_gex < 0) score += 25;
  if (atm_trend === 'down') score += 20;
  if (put_call_ratio != null && put_call_ratio > 1.8) score += 15;
  if (spot != null && gamma_flip != null && spot < gamma_flip) score += 10;

  return clamp(Math.round(score), 0, 100);
}

/**
 * Calculate Execution Confidence (0–100)
 * Higher = more confident to execute a trade
 */
function calcExecutionConfidence({
  has_live_price,
  uw_status,
  fmp_status,
  atm_trend,
  net_gex,
  direction_score,
  pin_risk
}) {
  if (!has_live_price) return 0;

  let score = 40;

  // Data quality
  if (fmp_status === 'real') score += 15;
  if (uw_status === 'live') score += 15;
  else if (uw_status === 'partial') score += 5;

  // Signal clarity
  const absDirection = Math.abs(direction_score);
  if (absDirection >= 50) score += 15;
  else if (absDirection >= 30) score += 8;

  // Gamma regime
  if (net_gex != null) {
    if (net_gex < -100_000) score += 10; // negative gamma = clearer trend
    else if (net_gex > 500_000) score -= 5; // very positive gamma = choppy
  }

  // Pin risk penalty
  if (pin_risk >= 70) score -= 20;
  else if (pin_risk >= 40) score -= 10;

  return clamp(Math.round(score), 0, 100);
}

/**
 * Main Gamma Regime Engine
 */
export function buildGammaRegimeEngine({
  spot_price = null,
  gamma_flip = null,
  net_gex = null,
  call_gex = null,
  put_gex = null,
  call_wall = null,
  put_wall = null,
  atm = null,
  atm_trend = 'flat',
  atm_change = null,
  put_call_ratio = null,
  net_premium = null,
  pin_risk = 0,
  uw_status = 'unavailable',
  fmp_status = 'unavailable'
} = {}) {
  const spot = validateSpxPrice(spot_price);
  const flip = safeNumber(gamma_flip);
  const netGex = safeNumber(net_gex);

  // Regime determination
  let gamma_regime = 'unknown';
  let dealer_mode = 'neutral';
  let chase_allowed = false;
  let regime_label = '未知';
  let regime_label_en = 'UNKNOWN';
  let regime_cn = 'Gamma 环境未知，不做判断。';

  if (spot != null && flip != null) {
    if (spot > flip) {
      gamma_regime = 'positive';
      dealer_mode = 'control_volatility';
      chase_allowed = false;
      regime_label = '正 Gamma｜阻尼模式';
      regime_label_en = 'LONG GAMMA';
      regime_cn = '当前在 Flip 上方，正 Gamma 控波动。市场有自带阻尼器，逢高空/逢低多，禁止追单。';
    } else if (spot < flip) {
      gamma_regime = 'negative';
      dealer_mode = 'amplify_volatility';
      chase_allowed = true;
      regime_label = '负 Gamma｜核爆模式';
      regime_label_en = 'SHORT GAMMA';
      regime_cn = '当前在 Flip 下方，负 Gamma 放波动。市场进入加速器模式，允许顺势追单，但需确认方向。';
    } else {
      gamma_regime = 'transitional';
      dealer_mode = 'neutral';
      chase_allowed = false;
      regime_label = '变盘临界';
      regime_label_en = 'TRANSITIONAL';
      regime_cn = '当前在 Flip 附近，变盘临界区，不追单，等方向确认。';
    }
  } else if (netGex != null) {
    // Fallback: use net GEX without flip level
    if (netGex > 100_000) {
      gamma_regime = 'positive';
      dealer_mode = 'control_volatility';
      regime_label = '正 Gamma（无 Flip 确认）';
      regime_label_en = 'LONG GAMMA (est.)';
      regime_cn = 'Net GEX 为正，估计正 Gamma 环境，但缺 Flip 确认。';
    } else if (netGex < -100_000) {
      gamma_regime = 'negative';
      dealer_mode = 'amplify_volatility';
      chase_allowed = true;
      regime_label = '负 Gamma（无 Flip 确认）';
      regime_label_en = 'SHORT GAMMA (est.)';
      regime_cn = 'Net GEX 为负，估计负 Gamma 环境，但缺 Flip 确认。';
    } else {
      gamma_regime = 'transitional';
      regime_label = '变盘临界（Net GEX 接近 0）';
      regime_label_en = 'NEAR ZERO GEX';
      regime_cn = 'Net GEX 接近 0，容易变盘，不追单。';
    }
  }

  // Spot-to-wall context
  let spot_position = 'unknown';
  let spot_position_cn = '位置未知';
  if (spot != null) {
    if (call_wall != null && spot >= call_wall) {
      spot_position = 'above_call_wall';
      spot_position_cn = `突破 Call Wall ${call_wall} 上方`;
    } else if (put_wall != null && spot <= put_wall) {
      spot_position = 'below_put_wall';
      spot_position_cn = `跌破 Put Wall ${put_wall} 下方`;
    } else if (flip != null && spot > flip) {
      spot_position = 'above_flip_below_call_wall';
      spot_position_cn = `Flip ${flip} 上方，Call Wall ${call_wall ?? '--'} 下方`;
    } else if (flip != null && spot < flip) {
      spot_position = 'below_flip_above_put_wall';
      spot_position_cn = `Flip ${flip} 下方，Put Wall ${put_wall ?? '--'} 上方`;
    } else {
      spot_position = 'between_walls';
      spot_position_cn = '墙内震荡区';
    }
  }

  // Scores
  const directionScore = calcDirectionScore({ atm_trend, spot, atm, put_call_ratio, net_premium, atm_change });
  const gammaRegimeScore = calcGammaRegimeScore({ net_gex: netGex, spot, gamma_flip: flip });
  const breakRiskScore = calcBreakRiskScore({ net_gex: netGex, atm_trend, put_call_ratio, spot, gamma_flip: flip });
  const executionConfidence = calcExecutionConfidence({
    has_live_price: spot != null,
    uw_status,
    fmp_status,
    atm_trend,
    net_gex: netGex,
    direction_score: directionScore,
    pin_risk
  });

  // Distance to flip
  const distanceToFlip = spot != null && flip != null
    ? Number((spot - flip).toFixed(2))
    : null;

  return {
    gamma_regime,
    dealer_mode,
    chase_allowed,
    regime_label,
    regime_label_en,
    regime_cn,
    spot_position,
    spot_position_cn,

    // Key levels
    gamma_flip: flip,
    call_wall,
    put_wall,
    net_gex: netGex,
    call_gex: safeNumber(call_gex),
    put_gex: safeNumber(put_gex),
    distance_to_flip: distanceToFlip,
    distance_to_flip_label: distanceToFlip != null
      ? distanceToFlip > 0
        ? `+${distanceToFlip} pts (Flip 上方)`
        : `${distanceToFlip} pts (Flip 下方)`
      : null,

    // Scores
    scores: {
      direction: directionScore,
      gamma_regime: gammaRegimeScore,
      break_risk: breakRiskScore,
      execution_confidence: executionConfidence
    },

    // Action guidance
    action_cn: gamma_regime === 'positive'
      ? '正 Gamma 阻尼区：禁止追单，等回踩或突破确认后再操作。'
      : gamma_regime === 'negative'
        ? '负 Gamma 放波区：允许顺势追单，但必须有明确触发和止损。'
        : 'Gamma 环境不明确：观望，等待方向确认。',

    degraded: spot == null
  };
}
