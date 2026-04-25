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
import { runDataHealthEngine } from './data-health-engine.js';
import { runDataCoherenceEngine } from './data-coherence-engine.js';
import { runMarketSentimentEngine } from './market-sentiment-engine.js';
import { runCommandEnvironmentEngine } from './command-environment-engine.js';
import { runAllowedSetupsEngine } from './allowed-setups-engine.js';
import { runTvSentinelEngine } from './tv-sentinel-engine.js';
import { runTradePlanBuilder } from './trade-plan-builder.js';
import { deriveThetaExecutionConstraint } from './dealer-conclusion-engine.js';

function buildDisplaySpotSnapshot(normalized, gammaWall) {
  const hasDisplaySpot =
    normalized.spot !== null
    && normalized.spot !== undefined
    && Number.isFinite(Number(normalized.spot));
  const displaySpot = hasDisplaySpot ? Number(normalized.spot) : null;
  if (displaySpot == null) {
    return {
      spot: null,
      spot_source: normalized.spot_source ?? null,
      spot_last_updated: normalized.spot_last_updated ?? null,
      spot_is_real: normalized.spot_is_real ?? false,
      day_change: normalized.day_change ?? null,
      day_change_percent: normalized.day_change_percent ?? null,
      distance_to_flip: null,
      distance_to_call_wall: null,
      distance_to_put_wall: null,
      spot_position: 'unknown'
    };
  }

  let spotPosition = 'between_walls';
  if (displaySpot >= normalized.call_wall) {
    spotPosition = 'above_call_wall';
  } else if (displaySpot <= normalized.put_wall) {
    spotPosition = 'below_put_wall';
  } else if (displaySpot < normalized.flip_level) {
    spotPosition = 'below_flip';
  } else if (displaySpot > normalized.flip_level) {
    spotPosition = 'above_flip';
  }

  return {
    spot: displaySpot,
    spot_source: normalized.spot_source ?? null,
    spot_last_updated: normalized.spot_last_updated ?? null,
    spot_is_real: normalized.spot_is_real ?? false,
    day_change: normalized.day_change ?? null,
    day_change_percent: normalized.day_change_percent ?? null,
    distance_to_flip: Math.round(displaySpot - normalized.flip_level),
    distance_to_call_wall: Math.round(normalized.call_wall - displaySpot),
    distance_to_put_wall: Math.round(displaySpot - normalized.put_wall),
    spot_position: spotPosition,
    wall_bias: gammaWall.wall_bias
  };
}

function sanitizeStrategyCard(card, reason) {
  return {
    ...card,
    entry_condition: '--',
    target_zone: '--',
    invalidation: '--',
    suitable_when: reason,
    avoid_when: reason
  };
}

function buildStrategyCards({ normalized, action, marketRegime, dataCoherence, commandEnvironment, thetaExecutionConstraint }) {
  const bullTarget = `${normalized.max_pain} -> ${normalized.call_wall}`;
  const bearTarget = `${normalized.put_wall} -> ${normalized.max_pain}`;
  const ironRange = `${normalized.put_wall} - ${normalized.call_wall}`;

  const cards = [
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

  const shouldBlankTargets =
    normalized.is_mock === true
    || dataCoherence?.executable === false
    || commandEnvironment?.executable === false
    || thetaExecutionConstraint?.executable === false;

  if (!shouldBlankTargets) {
    return cards;
  }

  const reason =
    dataCoherence?.reason
    || commandEnvironment?.reason
    || thetaExecutionConstraint?.reason
    || '数据冲突 / 演示场景 / 数据过期 / 缺少关键输入';

  return cards.map((card) => sanitizeStrategyCard(card, reason));
}

function buildRadarSummary({ normalized, priceStructure, uwFlow, eventRisk, action, gammaWall }) {
  const callBuy = normalized.uw_flow_bias === 'bullish' ? 4.2 : 1.6;
  const putBuy = normalized.theta_signal === 'bearish_pressure' ? 4.4 : 1.8;
  const zeroDteCallBuy = normalized.tv_structure_event.includes('breakout') ? 2.1 : 0.8;
  const zeroDtePutBuy = normalized.tv_structure_event.includes('breakdown') ? 2.0 : 0.7;
  const flowBias = callBuy > putBuy ? 'Call强' : putBuy > callBuy ? 'Put强' : '中性';
  const orderFlowExplanation =
    normalized.uw_flow_bias === 'bullish' && priceStructure.confirmation_status !== 'confirmed'
      ? '资金偏多，但价格未确认，不追。'
      : normalized.uw_flow_bias === 'bullish' && priceStructure.confirmation_status === 'confirmed'
        ? '订单流偏多，且价格结构已确认，支持第一页主计划。'
        : normalized.theta_signal === 'bearish_pressure'
          ? 'Put 侧更主动，但是否能做仍要看结构和关键位。'
          : '订单流没有形成足够优势，暂不单独驱动计划。';

  const dealerBehavior =
    normalized.gamma_regime === 'negative'
      ? '放波'
      : normalized.gamma_regime === 'positive' && normalized.uw_dealer_bias === 'supportive'
        ? '控波'
        : normalized.uw_dealer_bias === 'supportive'
          ? '趋势助推'
          : '不清楚';

  const dealerExplanation =
    normalized.gamma_regime === 'negative'
      ? 'Gamma 偏负，Speed/Vomma 风险更高，容易放大波动，禁止提前铁鹰 / 裸卖。'
      : normalized.gamma_regime === 'positive' && normalized.uw_dealer_bias === 'supportive'
        ? 'Gamma 偏正，主力更像在控波和承接，回踩确认比追突破更合适。'
        : '做市商没有给出足够清晰的放波或控波结论。';

  const supportBelow = gammaWall.distance_to_put_wall <= 25 ? '有' : '不明显';
  const resistanceAbove = gammaWall.distance_to_call_wall <= 25 ? '有' : '不明显';
  const darkPoolExplanation = supportBelow === '有'
    ? '下方更像存在承接区，但价格没站稳前仍不能直接抄底。'
    : resistanceAbove === '有'
      ? '上方压力区更近，先别把上冲当成已确认突破。'
      : '暗池区间没有形成足够强的支撑或压力结论。';

  const alignmentStatus =
    action.recommended_action === 'long_on_pullback' || action.recommended_action === 'income_ok'
      ? '支持主计划'
      : action.recommended_action === 'wait' && (normalized.stale_flags.any_stale || eventRisk.risk_gate === 'blocked' || priceStructure.confirmation_status !== 'confirmed')
        ? '部分支持，等确认'
        : action.recommended_action === 'no_trade'
          ? '数据过期，不参与判断'
          : '与主计划冲突，降低等级';

  return {
    order_flow: {
      call_buy_premium: callBuy,
      call_sell_premium: 1.2,
      put_buy_premium: putBuy,
      put_sell_premium: 1.1,
      zero_dte_call_buy_premium: zeroDteCallBuy,
      zero_dte_put_buy_premium: zeroDtePutBuy,
      flow_bias: flowBias,
      flow_quality: priceStructure.confirmation_status === 'confirmed' ? '较好' : '一般',
      aggressor: normalized.uw_flow_bias === 'bullish' ? 'ask-side / sweep' : 'mixed / block',
      explanation: orderFlowExplanation
    },
    dealer: {
      gamma_bias: normalized.gamma_regime,
      vanna_bias: normalized.advanced_greeks?.vanna ?? 'neutral',
      charm_bias: normalized.advanced_greeks?.charm ?? 'neutral',
      vomma_risk: normalized.gamma_regime === 'negative' ? '高' : '中',
      speed_risk: normalized.gamma_regime === 'negative' ? '高' : '中',
      color_decay: normalized.gamma_regime === 'positive' ? '回中轴' : '不明显',
      dealer_behavior: dealerBehavior,
      explanation: dealerExplanation
    },
    dark_pool: {
      support_below: supportBelow,
      resistance_above: resistanceAbove,
      key_levels: [normalized.put_wall, normalized.max_pain, normalized.call_wall],
      distance_to_spot: [gammaWall.distance_to_put_wall, Math.abs(normalized.spot - normalized.max_pain), gammaWall.distance_to_call_wall],
      dark_pool_bias: supportBelow === '有' ? '下方承接' : resistanceAbove === '有' ? '上方压力' : '中性',
      explanation: darkPoolExplanation
    },
    plan_alignment: {
      status: alignmentStatus,
      support_reason: action.recommended_action === 'long_on_pullback'
        ? '订单流、价格结构和关键位地图基本站到同一边。'
        : action.recommended_action === 'income_ok'
          ? '控波环境与区间结构相对一致，但仍需继续确认。'
          : '当前支持度有限。',
      conflict_reason: normalized.stale_flags.any_stale
        ? '数据存在 stale，不允许主导第一页计划。'
        : priceStructure.confirmation_status !== 'confirmed'
          ? '价格未确认，不能把资金偏向直接翻译成执行动作。'
          : eventRisk.risk_gate === 'blocked'
            ? '事件风险窗口压制当前计划。'
            : '没有明显额外冲突。',
      effect_on_action: action.recommended_action === 'wait'
        ? '资金雷达只支持等待，不支持直接追单。'
        : action.recommended_action === 'no_trade'
          ? '资金雷达不参与判断，暂停交易指令。'
          : '资金雷达与第一页主计划大体一致，但仍需按失效条件执行。'
    }
  };
}

export function runMasterEngine(normalized) {
  const dataCoherence = runDataCoherenceEngine(normalized);
  const dataHealth = runDataHealthEngine(normalized, dataCoherence);
  const marketRegime = runMarketRegimeEngine(normalized);
  const gammaWall = runGammaWallEngine(normalized);
  const displaySpotSnapshot = buildDisplaySpotSnapshot(normalized, gammaWall);
  const volatility = runVolatilityEngine(normalized);
  const priceStructure = runPriceStructureEngine(normalized);
  const uwFlow = runUwDealerFlowEngine(normalized);
  const eventRisk = runEventRiskEngine(normalized);
  const marketSentiment = runMarketSentimentEngine({
    gamma_regime: normalized.gamma_regime,
    theta_signal: normalized.theta_signal,
    fmp_signal: normalized.fmp_signal,
    event_risk: normalized.event_risk,
    price_signal: priceStructure.price_signal
  });
  const conflict = runConflictEngine({
    theta_signal: normalized.theta_signal,
    tv_signal: priceStructure.price_signal,
    uw_signal: uwFlow.uw_signal,
    fmp_signal: normalized.fmp_signal,
    stale_flags: normalized.stale_flags,
    tv_confirmation: priceStructure.confirmation_status
  });
  const commandEnvironment = runCommandEnvironmentEngine({
    normalized,
    dataCoherence,
    dataHealth,
    marketRegime,
    gammaWall,
    uwFlow,
    volatility,
    eventRisk,
    marketSentiment,
    conflict
  });
  const allowedSetups = runAllowedSetupsEngine({
    dataHealth,
    commandEnvironment,
    marketRegime,
    eventRisk,
    volatility,
    normalized
  });
  const tvSentinel = runTvSentinelEngine({
    priceStructure,
    tv_structure_event: normalized.tv_structure_event,
    snapshotFresh: normalized.stale_flags.tradingview !== true,
    snapshot: normalized.tradingview_snapshot
  });
  const tradePlan = runTradePlanBuilder({
    normalized,
    commandEnvironment,
    allowedSetups,
    tradingviewSentinel: tvSentinel
  });
  const action = runActionEngine({
    normalized,
    marketRegime,
    volatility,
    priceStructure,
    eventRisk,
    commandEnvironment,
    allowedSetups,
    tvSentinel,
    tradePlan,
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
      dataHealth,
      marketSentiment,
      commandEnvironment,
      allowedSetups,
      tvSentinel,
      tradePlan,
      conflict,
      action
    }
  });

  const radar_summary = buildRadarSummary({
    normalized,
    priceStructure,
    uwFlow,
    eventRisk,
    action,
    gammaWall
  });

  const thetaExecutionConstraint =
    normalized.theta_execution_constraint
    || deriveThetaExecutionConstraint(normalized.theta_dealer_conclusion);
  const projection = {
    dealer_summary: {
      status: normalized.theta_dealer_conclusion?.status || 'unavailable',
      text: normalized.theta_dealer_conclusion?.plain_chinese || 'Theta dealer unavailable.',
      gamma_regime: normalized.theta_dealer_conclusion?.gamma_regime || 'unknown',
      dealer_behavior: normalized.theta_dealer_conclusion?.dealer_behavior || 'unknown',
      least_resistance_path: normalized.theta_dealer_conclusion?.least_resistance_path || 'unknown',
      call_wall: normalized.theta_dealer_conclusion?.call_wall ?? null,
      put_wall: normalized.theta_dealer_conclusion?.put_wall ?? null,
      max_pain: normalized.theta_dealer_conclusion?.max_pain ?? null,
      zero_gamma: normalized.theta_dealer_conclusion?.zero_gamma ?? null,
      expected_move_upper: normalized.theta_dealer_conclusion?.expected_move_upper ?? null,
      expected_move_lower: normalized.theta_dealer_conclusion?.expected_move_lower ?? null
    }
  };

  return createNormalizedSignal({
    timestamp: normalized.timestamp,
    data_timestamp: normalized.data_timestamp,
    received_at: normalized.received_at,
    generated_at: new Date().toISOString(),
    latency_ms: normalized.latency_ms,
    stale_reason: normalized.stale_reason,
    fetch_mode: normalized.fetch_mode,
    is_mock: normalized.is_mock,
    scenario: normalized.scenario,
    symbol: normalized.symbol,
    timeframe: normalized.timeframe,
    last_updated: normalized.last_updated,
    stale_flags: normalized.stale_flags,
    source_status: normalized.source_status,
    market_state: marketRegime.market_state,
    gamma_regime: normalized.gamma_regime,
    market_snapshot: {
      spot: displaySpotSnapshot.spot,
      spot_source: displaySpotSnapshot.spot_source,
      spot_last_updated: displaySpotSnapshot.spot_last_updated,
      spot_is_real: displaySpotSnapshot.spot_is_real,
      day_change: displaySpotSnapshot.day_change,
      day_change_percent: displaySpotSnapshot.day_change_percent,
      flip_level: normalized.flip_level,
      call_wall: normalized.call_wall,
      put_wall: normalized.put_wall,
      max_pain: normalized.max_pain,
      distance_to_flip: displaySpotSnapshot.distance_to_flip,
      distance_to_call_wall: displaySpotSnapshot.distance_to_call_wall,
      distance_to_put_wall: displaySpotSnapshot.distance_to_put_wall,
      spot_position: displaySpotSnapshot.spot_position
    },
    uw_context: {
      flow_bias: normalized.uw_flow_bias,
      dark_pool_bias: normalized.uw_dark_pool_bias,
      dealer_bias: normalized.uw_dealer_bias,
      advanced_greeks: normalized.advanced_greeks
    },
    event_context: {
      event_risk: normalized.event_risk,
      event_note: normalized.event_note,
      no_short_vol_window: normalized.no_short_vol_window ?? false,
      trade_permission_adjustment: normalized.trade_permission_adjustment ?? 'normal'
    },
    theta: normalized.theta,
    dealer_conclusion: normalized.theta_dealer_conclusion,
    radar_summary,
    tv_structure_event: normalized.tv_structure_event,
    signals: {
      theta_signal: normalized.theta_signal,
      tv_signal: tvSentinel.tv_signal,
      uw_signal: uwFlow.uw_signal,
      fmp_signal: normalized.fmp_signal,
      wall_bias: gammaWall.wall_bias,
      dealer_behavior: uwFlow.dealer_behavior,
      price_confirmation: tvSentinel.price_confirmation
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
    data_mode: dataCoherence.data_mode,
    trade_permission: dataCoherence.trade_permission,
    execution_constraints: {
      theta: thetaExecutionConstraint
    },
    command_inputs: {
      external_spot: {
        spot: normalized.external_spot ?? normalized.spot ?? null,
        source:
          (normalized.external_spot ?? normalized.spot) != null
            ? (normalized.spot_source && normalized.spot != null
                ? normalized.spot_source
                : normalized.external_spot_source && normalized.external_spot_source !== 'unavailable'
                  ? normalized.external_spot_source
                  : 'unavailable')
            : 'unavailable',
        is_real:
          (normalized.external_spot ?? normalized.spot) != null
            ? (normalized.spot_source === 'fmp' && normalized.spot != null)
              || (normalized.spot != null && normalized.spot_is_real === true)
              || (normalized.external_spot_source === 'fmp' && normalized.external_spot != null)
              || (normalized.external_spot_is_real === true)
            : false,
        status:
          (normalized.external_spot ?? normalized.spot) != null
            ? (
                (normalized.spot_source === 'fmp' && normalized.spot != null)
                || (normalized.spot != null && normalized.spot_is_real === true)
                || (normalized.external_spot_source === 'fmp' && normalized.external_spot != null)
                || normalized.external_spot_is_real === true
              )
              ? 'real'
              : 'degraded'
            : 'unavailable',
        last_updated:
          normalized.external_spot_last_updated
          || normalized.spot_last_updated
          || null
      },
      dealer: {
        dealer_conclusion: {
          status: normalized.theta_dealer_conclusion?.status || 'unavailable',
          gamma_regime: normalized.theta_dealer_conclusion?.gamma_regime || 'unknown',
          dealer_behavior: normalized.theta_dealer_conclusion?.dealer_behavior || 'unknown',
          least_resistance_path: normalized.theta_dealer_conclusion?.least_resistance_path || 'unknown',
          call_wall: normalized.theta_dealer_conclusion?.call_wall ?? null,
          put_wall: normalized.theta_dealer_conclusion?.put_wall ?? null,
          max_pain: normalized.theta_dealer_conclusion?.max_pain ?? null,
          zero_gamma: normalized.theta_dealer_conclusion?.zero_gamma ?? null,
          expected_move_upper: normalized.theta_dealer_conclusion?.expected_move_upper ?? null,
          expected_move_lower: normalized.theta_dealer_conclusion?.expected_move_lower ?? null
        }
      }
    },
    projection,
    strategy_cards: buildStrategyCards({
      normalized,
      action,
      marketRegime,
      dataCoherence,
      commandEnvironment,
      thetaExecutionConstraint
    }),
    trade_plan: tradePlan,
    engines: {
      market_regime: marketRegime,
      gamma_wall: gammaWall,
      data_coherence: dataCoherence,
      data_health: dataHealth,
      volatility,
      price_structure: priceStructure,
      uw_dealer_flow: uwFlow,
      market_sentiment: marketSentiment,
      command_environment: commandEnvironment,
      allowed_setups: allowedSetups,
      tv_sentinel: tvSentinel,
      trade_plan: tradePlan,
      event_risk: eventRisk,
      conflict,
      action,
      dealer_conclusion: normalized.theta_dealer_conclusion
    },
    notes: [
      normalized.tv_last_event_note
        || normalized.tradingview_note
        || normalized.tradingview_snapshot?.message
        || '最近没有新的 TradingView 结构事件。',
      'Mock master-engine closed loop only.',
      'No real API integration is active.',
      'No automatic order placement exists.'
    ]
  });
}
