import { ACTIONS } from './action-enum.js';

export const NORMALIZED_SIGNAL_VERSION = '0.4.0';

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
      spot_source: partial.market_snapshot?.spot_source ?? 'mock',
      spot_last_updated: partial.market_snapshot?.spot_last_updated ?? null,
      spot_is_real: partial.market_snapshot?.spot_is_real ?? false,
      day_change: partial.market_snapshot?.day_change ?? null,
      day_change_percent: partial.market_snapshot?.day_change_percent ?? null,
      flip_level: partial.market_snapshot?.flip_level ?? null,
      call_wall: partial.market_snapshot?.call_wall ?? null,
      put_wall: partial.market_snapshot?.put_wall ?? null,
      max_pain: partial.market_snapshot?.max_pain ?? null,
      distance_to_flip: partial.market_snapshot?.distance_to_flip ?? null,
      distance_to_call_wall: partial.market_snapshot?.distance_to_call_wall ?? null,
      distance_to_put_wall: partial.market_snapshot?.distance_to_put_wall ?? null,
      spot_position: partial.market_snapshot?.spot_position ?? 'unknown'
    },
    uw_context: {
      flow_bias: partial.uw_context?.flow_bias ?? 'neutral',
      dark_pool_bias: partial.uw_context?.dark_pool_bias ?? 'neutral',
      dealer_bias: partial.uw_context?.dealer_bias ?? 'neutral',
      advanced_greeks: partial.uw_context?.advanced_greeks ?? {}
    },
    event_context: {
      event_risk: partial.event_context?.event_risk ?? 'low',
      event_note: partial.event_context?.event_note ?? 'No event risk note.',
      no_short_vol_window: partial.event_context?.no_short_vol_window ?? false,
      trade_permission_adjustment: partial.event_context?.trade_permission_adjustment ?? 'none'
    },
    radar_summary: {
      order_flow: {
        call_buy_premium: partial.radar_summary?.order_flow?.call_buy_premium ?? 0,
        call_sell_premium: partial.radar_summary?.order_flow?.call_sell_premium ?? 0,
        put_buy_premium: partial.radar_summary?.order_flow?.put_buy_premium ?? 0,
        put_sell_premium: partial.radar_summary?.order_flow?.put_sell_premium ?? 0,
        zero_dte_call_buy_premium: partial.radar_summary?.order_flow?.zero_dte_call_buy_premium ?? 0,
        zero_dte_put_buy_premium: partial.radar_summary?.order_flow?.zero_dte_put_buy_premium ?? 0,
        flow_bias: partial.radar_summary?.order_flow?.flow_bias ?? 'neutral',
        flow_quality: partial.radar_summary?.order_flow?.flow_quality ?? 'mixed',
        aggressor: partial.radar_summary?.order_flow?.aggressor ?? 'mixed',
        explanation: partial.radar_summary?.order_flow?.explanation ?? '订单流尚未形成可执行优势。'
      },
      dealer: {
        gamma_bias: partial.radar_summary?.dealer?.gamma_bias ?? 'neutral',
        vanna_bias: partial.radar_summary?.dealer?.vanna_bias ?? 'neutral',
        charm_bias: partial.radar_summary?.dealer?.charm_bias ?? 'neutral',
        vomma_risk: partial.radar_summary?.dealer?.vomma_risk ?? 'normal',
        speed_risk: partial.radar_summary?.dealer?.speed_risk ?? 'normal',
        color_decay: partial.radar_summary?.dealer?.color_decay ?? 'neutral',
        dealer_behavior: partial.radar_summary?.dealer?.dealer_behavior ?? '不清楚',
        explanation: partial.radar_summary?.dealer?.explanation ?? '做市商行为暂无明确方向。'
      },
      dark_pool: {
        support_below: partial.radar_summary?.dark_pool?.support_below ?? '不明显',
        resistance_above: partial.radar_summary?.dark_pool?.resistance_above ?? '不明显',
        key_levels: partial.radar_summary?.dark_pool?.key_levels ?? [],
        distance_to_spot: partial.radar_summary?.dark_pool?.distance_to_spot ?? [],
        dark_pool_bias: partial.radar_summary?.dark_pool?.dark_pool_bias ?? 'neutral',
        explanation: partial.radar_summary?.dark_pool?.explanation ?? '暗池没有给出足够强的方向支持。'
      },
      plan_alignment: {
        status: partial.radar_summary?.plan_alignment?.status ?? '数据不足，不参与判断',
        support_reason: partial.radar_summary?.plan_alignment?.support_reason ?? '暂无足够支持。',
        conflict_reason: partial.radar_summary?.plan_alignment?.conflict_reason ?? '暂无明显冲突。',
        effect_on_action: partial.radar_summary?.plan_alignment?.effect_on_action ?? '不改变当前主计划。'
      }
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
