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

function buildStrategyCards({ normalized, action, volatility, marketRegime }) {
  const bullTarget = `${normalized.max_pain} -> ${normalized.call_wall}`;
  const bearTarget = `${normalized.put_wall} -> ${normalized.max_pain}`;
  const ironRange = `${normalized.put_wall} - ${normalized.call_wall}`;

  return [
    {
      strategy_name: '单腿',
      suitable_when: action.recommended_action === 'long_on_pullback' || action.recommended_action === 'short_on_retest'
        ? '方向已经被确认，且回踩/反抽位置清晰。'
        : '仅在强确认趋势里才考虑，当前不是优先方案。',
      entry_condition: action.recommended_action === 'long_on_pullback'
        ? `价格回踩不破 flip ${normalized.flip_level}`
        : action.recommended_action === 'short_on_retest'
          ? `价格反抽不过 call_wall ${normalized.call_wall}`
          : '等待结构确认后再决定。',
      target_zone: action.recommended_action === 'short_on_retest' ? bearTarget : bullTarget,
      invalidation: action.invalidation_level,
      avoid_when: '数据 stale、冲突过高、或事件风险抬升时不要做。'
    },
    {
      strategy_name: '看涨价差',
      suitable_when: normalized.gamma_regime === 'positive'
        ? '正 Gamma 且价格回踩后仍守住关键位。'
        : '只有当结构明确转强后才考虑。',
      entry_condition: `回踩 flip ${normalized.flip_level} 上方并重新企稳。`,
      target_zone: bullTarget,
      invalidation: `跌破 put_wall ${normalized.put_wall}`,
      avoid_when: '负 Gamma 扩张或 UW/价格不同步时不要提前做。'
    },
    {
      strategy_name: '看跌价差',
      suitable_when: normalized.gamma_regime === 'negative'
        ? '负 Gamma 且价格反抽不过关键压力。'
        : '只有在结构明确转弱时才考虑。',
      entry_condition: `反抽不过 call_wall ${normalized.call_wall} 或 flip ${normalized.flip_level}`,
      target_zone: bearTarget,
      invalidation: `重新站回 call_wall ${normalized.call_wall}`,
      avoid_when: '正 Gamma 护盘或主力明显承接时避免。'
    },
    {
      strategy_name: '铁鹰',
      suitable_when: action.recommended_action === 'income_ok'
        ? '正 Gamma、IV 回落、无事件风险，且区间还在。'
        : '当前不满足安全卖波动率窗口。',
      entry_condition: `仅在价格继续围绕 max_pain ${normalized.max_pain} 附近钉住时考虑。`,
      target_zone: ironRange,
      invalidation: '事件风险升高、价格离开区间、或 IV 重新抬头。',
      avoid_when: '事件日前、数据过期时、或冲突升高时禁止提前做。'
    },
    {
      strategy_name: '观望',
      suitable_when: action.recommended_action === 'wait' || action.recommended_action === 'no_trade'
        ? '当前最优解就是少动。'
        : '即使有计划动作，也应先等更好位置。',
      entry_condition: '不满足结构、确认、或风险条件时直接空仓。',
      target_zone: marketRegime.market_state === 'flip_chop' ? '等待离开 flip 区域' : '等待更优位置',
      invalidation: '当冲突下降、结构确认、且数据新鲜时再重新评估。',
      avoid_when: '不要因为无聊交易，尤其不要在中间区域逆势硬做。'
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
    stale_flags: normalized.stale_flags,
    tv_confirmation: priceStructure.confirmation_status
  });
  const action = runActionEngine({
    normalized,
    marketRegime,
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
    data_timestamp: normalized.data_timestamp,
    received_at: normalized.received_at,
    generated_at: new Date().toISOString(),
    latency_ms: normalized.latency_ms,
    stale_reason: normalized.stale_reason,
    fetch_mode: normalized.fetch_mode,
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
      max_pain: normalized.max_pain,
      distance_to_flip: gammaWall.distance_to_flip,
      distance_to_call_wall: gammaWall.distance_to_call_wall,
      distance_to_put_wall: gammaWall.distance_to_put_wall,
      spot_position: gammaWall.wall_position
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
    strategy_cards: buildStrategyCards({
      normalized,
      action,
      volatility,
      marketRegime
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
