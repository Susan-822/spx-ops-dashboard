import { ACTIONS } from '../../../packages/shared/src/action-enum.js';

const AVOID = Object.freeze({
  CHASING: 'chasing',
  EARLY_IRON_CONDOR: 'early_iron_condor',
  NAKED_SELL: 'naked_sell',
  MIDDLE_ZONE_COUNTERTREND: 'middle_zone_countertrend',
  SHORT_VOL_BEFORE_EVENT: 'short_vol_before_event',
  TRADE_ON_STALE_DATA: 'trade_on_stale_data'
});

function clampConfidence(value) {
  return Math.max(35, Math.min(92, Math.round(value)));
}

export function runActionEngine({
  normalized,
  marketRegime,
  volatility,
  priceStructure,
  uwFlow,
  eventRisk,
  conflict
}) {
  const avoid = new Set();
  let confidence = conflict.adjusted_confidence;

  if (marketRegime.market_state === 'negative_gamma_expand') {
    confidence -= 6;
    avoid.add(AVOID.CHASING);
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
  }

  if (marketRegime.market_state === 'flip_chop') {
    confidence -= 4;
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
  }

  if (priceStructure.confirmation_status !== 'confirmed') {
    confidence -= 5;
    avoid.add(AVOID.CHASING);
  }

  if (normalized.stale_flags.any_stale) {
    confidence -= 10;
    avoid.add(AVOID.TRADE_ON_STALE_DATA);
  }

  if (eventRisk.risk_gate === 'blocked') {
    confidence -= 8;
    avoid.add(AVOID.SHORT_VOL_BEFORE_EVENT);
    avoid.add(AVOID.EARLY_IRON_CONDOR);
    avoid.add(AVOID.NAKED_SELL);
  }

  if (conflict.theta_tv_conflict) {
    confidence -= 6;
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
  }

  confidence = clampConfidence(confidence);

  let recommended_action = ACTIONS.WAIT;

  if (normalized.stale_flags.any_stale) {
    recommended_action = normalized.stale_flags.theta ? ACTIONS.NO_TRADE : ACTIONS.WAIT;
  } else if (conflict.conflict_level === 'high') {
    recommended_action = ACTIONS.WAIT;
  } else if (eventRisk.risk_gate === 'blocked') {
    recommended_action = ACTIONS.WAIT;
  } else if (uwFlow.uw_signal === 'bullish_flow' && priceStructure.confirmation_status !== 'confirmed') {
    recommended_action = ACTIONS.WAIT;
  } else if (
    confidence >= 70 &&
    volatility.short_vol_allowed &&
    normalized.gamma_regime === 'positive' &&
    normalized.event_risk === 'low' &&
    normalized.iv_state === 'cooling'
  ) {
    recommended_action = ACTIONS.INCOME_OK;
  } else if (priceStructure.price_signal === 'long_pullback_ready' && confidence >= 65) {
    recommended_action = ACTIONS.LONG_ON_PULLBACK;
    avoid.add(AVOID.CHASING);
  } else if (priceStructure.price_signal === 'short_retest_ready' && confidence >= 65) {
    recommended_action = ACTIONS.SHORT_ON_RETEST;
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
  }

  if (recommended_action !== ACTIONS.INCOME_OK) {
    avoid.add(AVOID.EARLY_IRON_CONDOR);
  }

  let invalidation_level = `价格重新失守 flip ${normalized.flip_level}`;
  if (recommended_action === ACTIONS.LONG_ON_PULLBACK) {
    invalidation_level = `回踩跌破 put_wall ${normalized.put_wall}`;
  } else if (recommended_action === ACTIONS.SHORT_ON_RETEST) {
    invalidation_level = `反抽重新站上 call_wall ${normalized.call_wall}`;
  } else if (recommended_action === ACTIONS.INCOME_OK) {
    invalidation_level = `IV 不再回落，或价格跌回 flip ${normalized.flip_level} 下方`;
  }

  return {
    recommended_action,
    avoid_actions: Array.from(avoid),
    invalidation_level,
    confidence_score: confidence
  };
}
