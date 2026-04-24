import { ACTIONS } from '../../../packages/shared/src/action-enum.js';

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

export function runActionEngine({
  normalized,
  marketRegime,
  gammaWall,
  volatility,
  priceStructure,
  uwFlow,
  eventRisk,
  conflict
}) {
  const avoid = new Set(eventRisk.blocked_actions);
  let confidence = conflict.adjusted_confidence;

  if (marketRegime.market_state === 'positive_gamma_range') {
    confidence += 8;
  }
  if (marketRegime.market_state === 'negative_gamma_trend') {
    confidence -= 10;
    avoid.add('income_ok');
    avoid.add('iron_condor');
    avoid.add('naked_sell');
    avoid.add('aggressive_dip_buy');
  }
  if (normalized.gamma_regime === 'negative_gamma') {
    confidence -= 12;
  }
  if (priceStructure.confirmation_status === 'confirmed') {
    confidence += 8;
  } else {
    confidence -= 6;
  }
  if (uwFlow.flow_quality_score >= 65) {
    confidence += 5;
  }
  if (gammaWall.wall_bias === 'bullish' || gammaWall.wall_bias === 'bearish') {
    confidence += 4;
  }

  let recommended_action = ACTIONS.WAIT;

  if (normalized.stale_flags.any_stale) {
    recommended_action = normalized.stale_flags.theta ? ACTIONS.NO_TRADE : ACTIONS.WAIT;
    confidence = Math.min(confidence, 25);
    avoid.add('long_on_pullback');
    avoid.add('short_on_retest');
    avoid.add('income_ok');
  } else if (conflict.conflict_level === 'high') {
    recommended_action = ACTIONS.WAIT;
  } else if (eventRisk.risk_gate === 'blocked') {
    recommended_action = ACTIONS.WAIT;
    avoid.add('income_ok');
    avoid.add('iron_condor');
    avoid.add('naked_sell');
  } else if (uwFlow.uw_signal === 'bullish_flow' && priceStructure.confirmation_status !== 'confirmed') {
    recommended_action = ACTIONS.WAIT;
    avoid.add('chase_breakout');
  } else if (
    confidence >= 70 &&
    volatility.short_vol_allowed &&
    normalized.gamma_regime === 'positive_gamma' &&
    normalized.event_risk === 'low' &&
    normalized.iv_state === 'cooling'
  ) {
    recommended_action = ACTIONS.INCOME_OK;
  } else if (priceStructure.price_signal === 'long_pullback_ready' && confidence >= 65) {
    recommended_action = ACTIONS.LONG_ON_PULLBACK;
  } else if (priceStructure.price_signal === 'short_retest_ready' && confidence >= 65) {
    recommended_action = ACTIONS.SHORT_ON_RETEST;
  }

  if (recommended_action !== ACTIONS.INCOME_OK && !volatility.short_vol_allowed) {
    avoid.add('income_ok');
  }
  if (recommended_action !== ACTIONS.LONG_ON_PULLBACK) {
    avoid.add('blind_breakout_chase');
  }
  if (recommended_action === ACTIONS.WAIT && normalized.gamma_regime === 'negative_gamma') {
    confidence = Math.min(confidence, 58);
  }

  let invalidation_level = `失守 flip ${normalized.flip_level}`;
  if (recommended_action === ACTIONS.LONG_ON_PULLBACK) {
    invalidation_level = `跌破 put_wall ${normalized.put_wall}`;
  } else if (recommended_action === ACTIONS.SHORT_ON_RETEST) {
    invalidation_level = `重新站上 call_wall ${normalized.call_wall}`;
  } else if (recommended_action === ACTIONS.INCOME_OK) {
    invalidation_level = `跌回 flip ${normalized.flip_level} 下方或事件风险升高`;
  }

  return {
    recommended_action,
    avoid_actions: Array.from(avoid),
    invalidation_level,
    confidence_score: clamp(confidence)
  };
}
