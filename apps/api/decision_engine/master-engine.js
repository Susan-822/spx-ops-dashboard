import { createNormalizedSignal } from '../../../packages/shared/src/normalized-schema.js';
import { runMarketRegimeEngine } from './market-regime-engine.js';
import { runGammaWallEngine } from './gamma-wall-engine.js';
import { runVolatilityEngine } from './volatility-engine.js';
import { runPriceStructureEngine } from './price-structure-engine.js';
import { runUwDealerFlowEngine } from './uw-dealer-flow-engine.js';
import { runEventRiskEngine } from './event-risk-engine.js';
import { runConflictEngine } from './conflict-engine.js';
import { runActionEngine } from './action-engine.js';
import { runPlainLanguageEngine } from './plain-language-engine.js';

function createStrategyCards({ normalized, action, volatility, conflict, eventRisk }) {
  return [
    {
      title: '主策略',
      action: action.recommended_action,
      thesis: normalized.plain_thesis,
      confidence_score: action.confidence_score
    },
    {
      title: '波动率约束',
      action: volatility.short_vol_allowed ? 'short_vol_allowed' : 'short_vol_blocked',
      thesis: volatility.income_allowed_reason,
      confidence_score: action.confidence_score
    },
    {
      title: '风险闸门',
      action: conflict.conflict_level === 'high' ? 'conflict_wait' : eventRisk.risk_gate,
      thesis:
        conflict.conflict_level === 'high'
          ? 'Theta 与结构存在明显冲突，优先等待。'
          : eventRisk.event_note,
      confidence_score: Math.max(20, action.confidence_score - 10)
    }
  ];
}

export function runMasterEngine(normalized) {
  const marketRegime = runMarketRegimeEngine(normalized);
  const gammaWall = runGammaWallEngine(normalized);
  const volatility = runVolatilityEngine(normalized);
  const priceStructure = runPriceStructureEngine(normalized);
  const uwFlow = runUwDealerFlowEngine(normalized);
  const eventRisk = runEventRiskEngine(normalized);
  const conflict = runConflictEngine({
    theta_signal: normalized.theta_signal,
    tv_signal: priceStructure.price_signal,
    uw_signal: uwFlow.uw_signal,
    fmp_signal: normalized.fmp_signal,
    stale_flags: normalized.stale_flags
  });
  const action = runActionEngine({
    normalized,
    marketRegime,
    gammaWall,
    volatility,
    priceStructure,
    uwFlow,
    eventRisk,
    conflict
  });

  const plain_language = runPlainLanguageEngine({
    recommended_action: action.recommended_action,
    conflict,
    stale_flags: normalized.stale_flags,
    engines: {
      normalized,
      marketRegime,
      gammaWall,
      volatility,
      priceStructure,
      uwFlow,
      eventRisk,
      conflict,
      action
    }
  });

  return createNormalizedSignal({
    timestamp: normalized.timestamp,
    generated_at: new Date().toISOString(),
    is_mock: true,
    scenario: normalized.scenario,
    symbol: normalized.symbol,
    timeframe: normalized.timeframe,
    last_updated: normalized.last_updated,
    stale_flags: normalized.stale_flags,
    source_status: normalized.source_status,
    market_state: marketRegime.market_state,
    gamma_regime: normalized.gamma_regime,
    market_snapshot: {
      spot: normalized.spot,
      flip_level: normalized.flip_level,
      call_wall: normalized.call_wall,
      put_wall: normalized.put_wall,
      max_pain: normalized.max_pain
    },
    uw_context: {
      flow_bias: normalized.uw_flow_bias,
      dark_pool_bias: normalized.uw_dark_pool_bias,
      dealer_bias: normalized.uw_dealer_bias,
      advanced_greeks: normalized.advanced_greeks
    },
    event_context: {
      event_risk: normalized.event_risk,
      event_note: normalized.event_note
    },
    tv_structure_event: normalized.tv_structure_event,
    signals: {
      theta_signal: normalized.theta_signal,
      tv_signal: priceStructure.price_signal,
      uw_signal: uwFlow.uw_signal,
      fmp_signal: normalized.fmp_signal,
      wall_bias: gammaWall.wall_bias,
      dealer_behavior: uwFlow.dealer_behavior,
      price_confirmation: priceStructure.confirmation_status
    },
    weights: conflict.weights,
    conflict: {
      has_conflict: conflict.has_conflict,
      conflict_level: conflict.conflict_level,
      conflict_points: conflict.conflict_points,
      adjusted_confidence: conflict.adjusted_confidence,
      theta_tv_conflict: conflict.theta_tv_conflict,
      directions: conflict.directions
    },
    plain_language,
    recommended_action: action.recommended_action,
    avoid_actions: action.avoid_actions,
    invalidation_level: action.invalidation_level,
    confidence_score: action.confidence_score,
    strategy_cards: createStrategyCards({
      normalized,
      action,
      volatility,
      conflict,
      eventRisk
    }),
    engines: {
      market_regime: marketRegime,
      gamma_wall: gammaWall,
      volatility,
      price_structure: priceStructure,
      uw_dealer_flow: uwFlow,
      event_risk: eventRisk,
      conflict,
      action
    },
    notes: [
      'Mock master-engine closed loop only.',
      'No real API integration is active.',
      'No automatic order placement exists.'
    ]
  });
}
