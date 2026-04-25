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
  dataCoherence,
  marketRegime,
  volatility,
  priceStructure,
  eventRisk,
  conflict,
  commandEnvironment,
  allowedSetups,
  tvSentinel,
  tradePlan
}) {
  const avoid = new Set();
  let confidence = conflict.adjusted_confidence;
  const marketState = marketRegime?.market_state || 'unknown';

  if (dataCoherence?.executable === false) {
    confidence = Math.min(confidence, dataCoherence.confidence_cap ?? 20);
  }

  if (marketState === 'negative_gamma_expand') {
    confidence -= 6;
    avoid.add(AVOID.CHASING);
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
  }

  if (marketState === 'flip_chop') {
    confidence -= 4;
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
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

  if (tvSentinel?.status !== 'triggered') {
    avoid.add(AVOID.CHASING);
  }

  if (allowedSetups?.single_leg?.allowed !== true) {
    avoid.add(AVOID.MIDDLE_ZONE_COUNTERTREND);
  }

  if (allowedSetups?.iron_condor?.allowed !== true) {
    avoid.add(AVOID.EARLY_IRON_CONDOR);
  }

  if (volatility.short_vol_allowed !== true) {
    avoid.add(AVOID.SHORT_VOL_BEFORE_EVENT);
  }

  confidence = clampConfidence(
    tradePlan?.confidence_score
      ?? commandEnvironment?.confidence_score
      ?? confidence
  );

  let recommended_action = ACTIONS.WAIT;
  if (normalized.stale_flags.any_stale) {
    recommended_action = normalized.stale_flags.theta ? ACTIONS.NO_TRADE : ACTIONS.WAIT;
  } else if (dataCoherence?.trade_permission === 'no_trade') {
    recommended_action = ACTIONS.NO_TRADE;
  } else if (tradePlan?.recommended_action && Object.values(ACTIONS).includes(tradePlan.recommended_action)) {
    recommended_action = tradePlan.recommended_action;
  } else if (conflict.conflict_level === 'high') {
    recommended_action = ACTIONS.WAIT;
  } else if (eventRisk.risk_gate === 'blocked') {
    recommended_action = ACTIONS.WAIT;
  } else if (priceStructure.confirmation_status !== 'confirmed') {
    recommended_action = ACTIONS.WAIT;
  }

  if (recommended_action !== ACTIONS.INCOME_OK) {
    avoid.add(AVOID.EARLY_IRON_CONDOR);
  }

  const invalidation_level =
    tradePlan?.invalidation_text
    || `价格重新失守 flip ${normalized.flip_level}`;

  return {
    recommended_action,
    avoid_actions: Array.from(avoid),
    invalidation_level,
    confidence_score: confidence
  };
}
