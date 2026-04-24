import { ACTIONS } from './action-enum.js';

export const NORMALIZED_SIGNAL_VERSION = '0.2.0';

export function createNormalizedSignal(partial = {}) {
  const now = new Date().toISOString();

  return {
    schema_version: NORMALIZED_SIGNAL_VERSION,
    timestamp: partial.timestamp ?? now,
    generated_at: partial.generated_at ?? now,
    is_mock: partial.is_mock ?? true,
    scenario: partial.scenario ?? 'negative_gamma_wait_pullback',
    symbol: partial.symbol ?? 'SPX',
    timeframe: partial.timeframe ?? '1D',
    last_updated: partial.last_updated ?? {},
    stale_flags: partial.stale_flags ?? {
      theta: false,
      tradingview: false,
      uw: false,
      fmp: false,
      any_stale: false
    },
    source_status: partial.source_status ?? [],
    market_state: partial.market_state ?? 'unknown',
    gamma_regime: partial.gamma_regime ?? 'unknown',
    market_snapshot: {
      spot: partial.market_snapshot?.spot ?? null,
      flip_level: partial.market_snapshot?.flip_level ?? null,
      call_wall: partial.market_snapshot?.call_wall ?? null,
      put_wall: partial.market_snapshot?.put_wall ?? null,
      max_pain: partial.market_snapshot?.max_pain ?? null
    },
    uw_context: {
      flow_bias: partial.uw_context?.flow_bias ?? 'neutral',
      dark_pool_bias: partial.uw_context?.dark_pool_bias ?? 'neutral',
      dealer_bias: partial.uw_context?.dealer_bias ?? 'neutral',
      advanced_greeks: partial.uw_context?.advanced_greeks ?? {}
    },
    event_context: {
      event_risk: partial.event_context?.event_risk ?? 'low',
      event_note: partial.event_context?.event_note ?? 'No event risk note.'
    },
    tv_structure_event: partial.tv_structure_event ?? 'unknown',
    signals: partial.signals ?? {},
    weights: partial.weights ?? {
      theta: 0.4,
      tradingview: 0.3,
      uw: 0.2,
      fmp: 0.1
    },
    conflict: partial.conflict ?? {
      has_conflict: false,
      conflict_level: 'low',
      conflict_points: 0,
      adjusted_confidence: 0,
      theta_tv_conflict: false
    },
    plain_language: {
      market_status: partial.plain_language?.market_status ?? '等待更多信号。',
      dealer_behavior: partial.plain_language?.dealer_behavior ?? '主力行为未明。',
      user_action: partial.plain_language?.user_action ?? '先观察。',
      avoid: partial.plain_language?.avoid ?? '避免无计划交易。',
      invalidation: partial.plain_language?.invalidation ?? '失效条件未定义。'
    },
    recommended_action: partial.recommended_action ?? ACTIONS.WAIT,
    avoid_actions: partial.avoid_actions ?? [],
    invalidation_level: partial.invalidation_level ?? 'N/A',
    confidence_score: partial.confidence_score ?? 0,
    strategy_cards: partial.strategy_cards ?? [],
    engines: partial.engines ?? {},
    notes: partial.notes ?? []
  };
}
