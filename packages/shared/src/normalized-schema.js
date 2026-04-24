import { ACTIONS } from './action-enum.js';

export const NORMALIZED_SIGNAL_VERSION = '0.3.0';

export function createNormalizedSignal(partial = {}) {
  const now = new Date().toISOString();

  return {
    schema_version: NORMALIZED_SIGNAL_VERSION,
    timestamp: partial.timestamp ?? now,
    data_timestamp: partial.data_timestamp ?? now,
    received_at: partial.received_at ?? now,
    generated_at: partial.generated_at ?? now,
    latency_ms: partial.latency_ms ?? 0,
    stale_reason: partial.stale_reason ?? [],
    is_mock: partial.is_mock ?? true,
    fetch_mode: partial.fetch_mode ?? 'mock_scenario',
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
      conflict_points: [],
      adjusted_confidence: 50,
      theta_tv_conflict: false
    },
    plain_language: {
      market_status: partial.plain_language?.market_status ?? '暂时没有足够优势，先观察。',
      dealer_behavior: partial.plain_language?.dealer_behavior ?? '主力行为暂不明显。',
      user_action: partial.plain_language?.user_action ?? '先等待更清晰的确认。',
      avoid: partial.plain_language?.avoid ?? '避免在中间区域硬做逆势。',
      invalidation: partial.plain_language?.invalidation ?? '若关键位被破坏，本次思路失效。'
    },
    recommended_action: partial.recommended_action ?? ACTIONS.WAIT,
    avoid_actions: partial.avoid_actions ?? [],
    invalidation_level: partial.invalidation_level ?? 'N/A',
    confidence_score: partial.confidence_score ?? 50,
    strategy_cards: partial.strategy_cards ?? [],
    engines: partial.engines ?? {},
    notes: partial.notes ?? []
  };
}
