import { getMockScenario } from './mock-scenarios.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';
import { getTradingViewSnapshot } from '../storage/tradingview-snapshot.js';
import { getThetaSnapshot } from '../storage/theta-snapshot.js';
import { readUwProvider } from '../state/uwProvider.js';
import { getFmpSnapshot } from '../adapters/fmp/index.js';
import { normalizeUwSummary } from '../../../integrations/unusual-whales/normalizer/uw-summary-normalizer.js';
import { normalizeUwApiSnapshot } from '../normalizer/uw-api-normalizer.js';
import { runUwDealerEngine } from '../engines/uw-dealer-engine.js';
import { runUwInstitutionalEngine } from '../engines/uw-institutional-engine.js';
import { runUwVolatilityEngine } from '../engines/uw-volatility-engine.js';
import { runUwSentimentEngine } from '../engines/uw-sentiment-engine.js';
import { runUwDarkpoolEngine } from '../engines/uw-darkpool-engine.js';
import { runCommandCenterEngine } from '../engines/command-center-engine.js';
import { runReflectionEngine } from '../engines/reflection-engine.js';
import { runTechnicalEngine } from '../engines/technical-engine.js';
import { runHealthMatrixEngine } from '../engines/health-matrix-engine.js';
import { runFlowValidationEngine } from '../engines/flow-validation-engine.js';
import { runSetupSynthesisEngine } from '../engines/setup-synthesis-engine.js';
import { runPositionSizingEngine } from '../engines/position-sizing-engine.js';
import { buildEndpointCoverageReport } from '../engines/endpoint-coverage-engine.js';
import { buildCrossAssetProjection } from './rules/level-projection-rules.js';
import {
  buildDealerConclusionEngine,
  deriveThetaExecutionConstraint,
  deriveThetaSignalFromSnapshot,
  mapThetaSnapshotToSourceStatus
} from './dealer-conclusion-engine.js';
import { runUwConclusionEngine } from './uw-conclusion-engine.js';

function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function permissionEntry(permission, reason = '') {
  return {
    permission: ['allow', 'wait', 'block'].includes(permission) ? permission : 'block',
    reason: reason || ''
  };
}

function hasActionablePlanFields(tradePlan = {}) {
  const hasEntry = tradePlan.entry_zone && tradePlan.entry_zone.text && tradePlan.entry_zone.text !== '--';
  const hasStop = tradePlan.stop_loss && tradePlan.stop_loss.text && tradePlan.stop_loss.text !== '--';
  const hasTarget = Array.isArray(tradePlan.targets) && tradePlan.targets.some((item) => item.level != null);
  const hasInvalidation = tradePlan.invalidation && tradePlan.invalidation.text && tradePlan.invalidation.text !== '--';
  return Boolean(hasEntry && hasStop && hasTarget && hasInvalidation);
}

function buildStrategyPermissions({ signal = {}, institutionalAlert = {}, volatilityActivation = {}, dealerEngine = {}, commandCenter = {} } = {}) {
  const tradePlan = signal.trade_plan || {};
  const tvMatched = signal.tv_sentinel?.matched_allowed_setup === true;
  const tvEvent = signal.tv_sentinel?.event_type || '';
  const actionablePlan = tradePlan.status === 'ready' && hasActionablePlanFields(tradePlan);
  const dataExecutable = signal.data_health?.executable === true && signal.command_environment?.executable === true;
  const flowSupports = ['building', 'bombing'].includes(institutionalAlert.state);
  const directionAdvantage = ['bullish', 'bearish'].includes(commandCenter.direction);
  const greenVol = ['green'].includes(volatilityActivation.light) || ['active', 'strong', 'extreme'].includes(volatilityActivation.strength);
  const yellowVol = volatilityActivation.light === 'yellow';
  const ironBlocked =
    volatilityActivation.light === 'green'
    || ['strong', 'extreme'].includes(volatilityActivation.strength)
    || institutionalAlert.state === 'bombing'
    || (dealerEngine.regime === 'negative_gamma' && dealerEngine.behavior === 'expand')
    || (tvMatched && ['breakout_confirmed', 'breakdown_confirmed'].includes(tvEvent));

  const singleAllow = tvMatched && greenVol && flowSupports && dataExecutable && actionablePlan && dealerEngine.behavior !== 'pin';
  const verticalAllow = tvMatched && directionAdvantage && flowSupports && (yellowVol || greenVol) && dataExecutable && actionablePlan;
  const ironAllow = !ironBlocked
    && tvMatched
    && dealerEngine.regime === 'positive_gamma'
    && dealerEngine.behavior === 'pin'
    && ['red', 'yellow'].includes(volatilityActivation.light)
    && institutionalAlert.state !== 'bombing'
    && signal.market_sentiment?.state !== 'risk_on'
    && signal.market_sentiment?.state !== 'risk_off'
    && dataExecutable
    && actionablePlan;

  const blockedReason = commandCenter.main_reason || '硬门槛未通过，不能放行。';
  return {
    single_leg: permissionEntry(singleAllow ? 'allow' : commandCenter.final_state === 'blocked' ? 'block' : 'wait', singleAllow ? 'TV、波动、机构流与数据健康均支持。' : blockedReason),
    vertical: permissionEntry(verticalAllow ? 'allow' : commandCenter.final_state === 'blocked' ? 'block' : 'wait', verticalAllow ? '方向优势、flow 与波动结构支持。' : blockedReason),
    iron_condor: permissionEntry(ironBlocked ? 'block' : ironAllow ? 'allow' : commandCenter.final_state === 'blocked' ? 'block' : 'wait', ironBlocked ? '波动扩张、机构轰炸、负 Gamma 或突破结构禁止铁鹰。' : ironAllow ? '正 Gamma 控波且无单边轰炸。' : blockedReason)
  };
}

function buildEsProxy() {
  return {
    status: 'unavailable',
    es_price: null,
    spx_equivalent: null,
    basis: null,
    basis_status: 'unknown',
    plain_chinese: 'ES proxy 数据不可用，不能用 FMP 偏向替代。'
  };
}

function buildSessionEngine() {
  return {
    session: 'unknown',
    handoff_state: 'unavailable',
    premarket_bias: 'unknown',
    open_risk: 'unknown',
    plain_chinese: 'Session engine 尚无实时会话输入。'
  };
}

function cleanProductionNotes(notes = [], isMock = false) {
  const safeNotes = Array.isArray(notes) ? notes.filter((note) => typeof note === 'string') : [];
  if (isMock) return safeNotes;
  return safeNotes.filter((note) => !/mock master-engine|no real api integration/i.test(note));
}

function replaceUndefined(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => replaceUndefined(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUndefined(item)]));
  }
  return value;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceStatus(lastUpdated, now = new Date()) {
  if (!lastUpdated) return { status: 'unavailable', age_seconds: null };
  const age = Math.max(0, Math.floor((new Date(now).getTime() - new Date(lastUpdated).getTime()) / 1000));
  return {
    status: age <= 120 ? 'live' : age <= 300 ? 'stale' : 'unavailable',
    age_seconds: Number.isFinite(age) ? age : null
  };
}

function buildProjectionPrices({ signal = {}, normalized = {}, tradingViewSnapshot = null, uwApi = {} } = {}) {
  const spxPrice = numberOrNull(signal.command_inputs?.external_spot?.spot ?? signal.market_snapshot?.spot ?? normalized.external_spot ?? normalized.spot);
  const spxLast = signal.command_inputs?.external_spot?.last_updated || normalized.external_spot_last_updated || normalized.spot_last_updated;
  const spyPrice = numberOrNull(tradingViewSnapshot?.spy_price ?? uwApi.uw_factors?.technical_factors?.spy_price ?? uwApi.uw_raw?.spy_price?.data?.price);
  const esPrice = numberOrNull(tradingViewSnapshot?.es_price ?? tradingViewSnapshot?.futures_price ?? signal.es_proxy?.es_price);
  const spxFresh = priceStatus(spxLast || signal.received_at);
  return {
    spx: {
      price: spxPrice,
      source: signal.command_inputs?.external_spot?.source || normalized.external_spot_source || normalized.spot_source || 'unavailable',
      ...spxFresh
    },
    spy: {
      price: spyPrice,
      source: spyPrice == null ? 'unavailable' : tradingViewSnapshot?.spy_price != null ? 'tradingview' : 'uw',
      status: spyPrice == null ? 'unavailable' : 'live',
      age_seconds: spyPrice == null ? null : 0
    },
    es: {
      price: esPrice,
      source: esPrice == null ? 'unavailable' : 'tradingview',
      status: esPrice == null ? 'unavailable' : 'live',
      age_seconds: esPrice == null ? null : 0
    }
  };
}

function buildProjectionLevels({ signal = {}, dealerEngine = {}, uwApi = {} } = {}) {
  const dealerFactors = uwApi.uw_factors?.dealer_factors || {};
  const volumeOi = uwApi.uw_factors?.volume_oi_factors || {};
  return {
    call_wall: dealerEngine.upper_wall ?? signal.dealer_conclusion?.call_wall ?? signal.market_snapshot?.call_wall ?? null,
    put_wall: dealerEngine.lower_wall ?? signal.dealer_conclusion?.put_wall ?? signal.market_snapshot?.put_wall ?? null,
    zero_gamma: dealerEngine.flip_zone ?? signal.dealer_conclusion?.zero_gamma ?? signal.market_snapshot?.flip_level ?? null,
    max_pain: volumeOi.max_pain ?? signal.dealer_conclusion?.max_pain ?? signal.market_snapshot?.max_pain ?? null,
    em_upper: signal.dealer_conclusion?.expected_move_upper ?? null,
    em_lower: signal.dealer_conclusion?.expected_move_lower ?? null,
    gex_pivots: dealerFactors.gex_pivots || [],
    oi_walls: volumeOi.volume_magnet_candidates || [],
    volume_magnets: volumeOi.volume_wall_candidates || []
  };
}

function buildKeyLevels({ dealerEngine = {}, uwApi = {}, signal = {} } = {}) {
  const dealerFactors = uwApi.uw_factors?.dealer_factors || {};
  const volumeOi = uwApi.uw_factors?.volume_oi_factors || {};
  const source = dealerEngine.status === 'live' || dealerEngine.status === 'partial' ? 'uw' : 'theta';
  const status = (value, fallbackStatus = dealerEngine.status) => value == null ? 'unavailable' : (fallbackStatus || 'partial');
  const callWall = dealerEngine.upper_wall ?? signal.dealer_conclusion?.call_wall ?? null;
  const putWall = dealerEngine.lower_wall ?? signal.dealer_conclusion?.put_wall ?? null;
  const zeroGamma = dealerEngine.flip_zone ?? signal.dealer_conclusion?.zero_gamma ?? null;
  const maxPain = volumeOi.max_pain ?? signal.dealer_conclusion?.max_pain ?? null;

  return {
    source,
    call_wall: { level: callWall, source: source === 'uw' ? 'uw_spot_gex' : 'theta', status: status(callWall) },
    put_wall: { level: putWall, source: source === 'uw' ? 'uw_spot_gex' : 'theta', status: status(putWall) },
    zero_gamma: { level: zeroGamma, source: source === 'uw' ? 'uw_spot_gex' : 'theta', status: status(zeroGamma) },
    max_pain: { level: maxPain, source: source === 'uw' ? 'uw_max_pain' : 'theta', status: status(maxPain, volumeOi.max_pain == null ? 'unavailable' : 'live') },
    gex_pivots: dealerFactors.gex_pivots || [],
    oi_walls: volumeOi.volume_magnet_candidates || [],
    volume_magnets: volumeOi.volume_wall_candidates || [],
    plain_chinese:
      source === 'uw'
        ? `UW Key Levels：Call Wall ${callWall ?? '--'}，Put Wall ${putWall ?? '--'}，Zero Gamma ${zeroGamma ?? '--'}。`
        : 'UW 墙位不可用，Key Levels 回落到 Theta 或 unavailable。'
  };
}

function isFmpRiskDegraded(snapshot) {
  if (!snapshot) {
    return false;
  }

  if (!snapshot.configured) {
    return false;
  }

  const state = String(snapshot.state || '').toLowerCase();
  return (
    snapshot.available === false
    || Boolean(snapshot.fallback_reason)
    || snapshot.stale === true
    || ['degraded', 'delayed', 'down', 'stale'].includes(state)
  );
}

function applyTradingViewSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const mappedStructure = snapshot.tv_structure_event || baseScenario.tv_structure_event;
  const triggerTimestamp = snapshot.last_updated || snapshot.received_at || baseScenario.last_updated.tradingview;

  return {
    ...baseScenario,
    timeframe: snapshot.timeframe || baseScenario.timeframe,
    last_updated: {
      ...baseScenario.last_updated,
      tradingview: triggerTimestamp
    },
    tv_structure_event: mappedStructure,
    tv_last_event_note: snapshot.status === 'stale'
      ? `最近 TradingView 事件 ${snapshot.event_type || mappedStructure} 已 stale，仅作参考。`
      : `最近 TradingView 事件：${snapshot.event_type || mappedStructure}。`,
    tradingview_snapshot: snapshot
  };
}

function applyTradingViewPriceFallback(baseScenario, snapshot) {
  if (!snapshot || hasFiniteNumber(baseScenario.spot) || hasFiniteNumber(baseScenario.external_spot)) {
    return baseScenario;
  }

  if (!hasFiniteNumber(snapshot.price)) {
    return baseScenario;
  }

  return {
    ...baseScenario,
    ...(baseScenario.scenario_mode === true
      ? {}
      : {
          spot: Number(snapshot.price),
          spot_source: 'tradingview',
          spot_last_updated: snapshot.last_updated || snapshot.received_at || baseScenario.last_updated.tradingview,
          spot_is_real: snapshot.is_mock !== true && snapshot.status !== 'stale'
        }),
    external_spot: Number(snapshot.price),
    external_spot_source: 'tradingview',
    external_spot_last_updated: snapshot.last_updated || snapshot.received_at || baseScenario.last_updated.tradingview,
    external_spot_is_real: snapshot.is_mock !== true && snapshot.status !== 'stale'
  };
}

function applyFmpEventSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const degradedRisk = isFmpRiskDegraded(snapshot);

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      fmp: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp
    },
    fmp_event_snapshot: snapshot,
    event_risk: degradedRisk
      ? 'medium'
      : snapshot.event_risk === 'high' || snapshot.event_risk === 'medium'
        ? snapshot.event_risk
        : baseScenario.event_risk,
    event_note: degradedRisk
      ? 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。'
      : snapshot.event_note || baseScenario.event_note,
    no_short_vol_window: degradedRisk
      ? true
      : snapshot.no_short_vol_window ?? baseScenario.no_short_vol_window ?? false,
    trade_permission_adjustment: degradedRisk
      ? 'downgrade'
      : snapshot.trade_permission_adjustment || baseScenario.trade_permission_adjustment || 'normal',
    fmp_signal: degradedRisk
      ? 'event_risk_unknown'
      : snapshot.fmp_signal || baseScenario.fmp_signal
  };
}

function applyFmpPriceSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  if (!snapshot.price_available) {
    return {
      ...baseScenario,
      last_updated: {
        ...baseScenario.last_updated,
        fmp_price: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp_price || null
      },
      fmp_price_snapshot: snapshot,
      day_change: snapshot.day_change ?? baseScenario.day_change ?? null,
      day_change_percent: snapshot.day_change_percent ?? baseScenario.day_change_percent ?? null,
      external_spot: baseScenario.external_spot ?? null,
      external_spot_source: baseScenario.external_spot_source ?? null,
      external_spot_last_updated: baseScenario.external_spot_last_updated ?? null,
      external_spot_is_real: baseScenario.external_spot_is_real ?? false
    };
  }

  const externalSpotPayload = {
    external_spot: snapshot.price,
    external_spot_source: 'fmp',
    external_spot_last_updated: snapshot.last_updated || snapshot.data_timestamp || null,
    external_spot_is_real: Boolean(snapshot.price_available && !snapshot.is_mock)
  };

  if (baseScenario.scenario_mode === true) {
    return {
      ...baseScenario,
      last_updated: {
        ...baseScenario.last_updated,
        fmp_price: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp_price || null
      },
      fmp_price_snapshot: snapshot,
      day_change: snapshot.day_change ?? null,
      day_change_percent: snapshot.day_change_percent ?? null,
      ...externalSpotPayload
    };
  }

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      fmp_price: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp_price || null
    },
    fmp_price_snapshot: snapshot,
    spot: snapshot.price_available ? snapshot.price : null,
    spot_source: snapshot.price_available ? 'fmp' : null,
    spot_last_updated: snapshot.last_updated || snapshot.data_timestamp || null,
    spot_is_real: Boolean(snapshot.price_available && !snapshot.is_mock),
    spot_health: {
      state: snapshot.state || 'unknown',
      is_real: Boolean(snapshot.price_available && !snapshot.is_mock),
      source: snapshot.price_available ? 'fmp' : null
    },
    day_change: snapshot.day_change ?? null,
    day_change_percent: snapshot.day_change_percent ?? null,
    ...externalSpotPayload
  };
}

function applyThetaSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const dealerConclusion = buildDealerConclusionEngine({
    thetaSnapshot: snapshot,
    externalSpot: baseScenario.external_spot ?? baseScenario.spot
  });
  const executionConstraint = deriveThetaExecutionConstraint(dealerConclusion);
  const thetaSourceStatus = mapThetaSnapshotToSourceStatus(snapshot);
  const callWall = dealerConclusion.call_wall ?? null;
  const putWall = dealerConclusion.put_wall ?? null;
  const maxPain = dealerConclusion.max_pain ?? null;
  const gammaRegime = dealerConclusion.gamma_regime || 'unknown';
  const thetaSignal = deriveThetaSignalFromSnapshot(snapshot);
  const lastUpdate = snapshot.last_update || snapshot.last_updated || baseScenario.last_updated.theta;
  const shouldAdoptThetaSpot =
    baseScenario.scenario_mode !== true
    && hasFiniteNumber(snapshot.spot)
    && snapshot.spot_source !== 'manual_test'
    && (
      !hasFiniteNumber(baseScenario.spot)
      || baseScenario.spot_is_real !== true
    );
  const shouldAdoptThetaFlip = baseScenario.scenario_mode !== true && hasFiniteNumber(dealerConclusion.zero_gamma ?? dealerConclusion.max_pain);
  const nextSpot = shouldAdoptThetaSpot ? Number(snapshot.spot) : baseScenario.spot;
  const nextSpotSource = shouldAdoptThetaSpot ? snapshot.spot_source || 'manual_test' : baseScenario.spot_source;
  const nextSpotIsReal = shouldAdoptThetaSpot ? snapshot.spot_source !== 'manual_test' : baseScenario.spot_is_real;
  const nextFlipLevel = shouldAdoptThetaFlip
    ? Number(dealerConclusion.zero_gamma ?? dealerConclusion.max_pain)
    : baseScenario.flip_level;

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      theta: lastUpdate,
      theta_full_chain: lastUpdate
    },
    gamma_regime: gammaRegime,
    spot: nextSpot,
    spot_source: nextSpotSource,
    spot_last_updated: shouldAdoptThetaSpot ? lastUpdate : baseScenario.spot_last_updated,
    spot_is_real: nextSpotIsReal,
    external_spot: baseScenario.external_spot ?? (shouldAdoptThetaSpot ? Number(snapshot.spot) : null),
    external_spot_source: baseScenario.external_spot_source ?? (shouldAdoptThetaSpot ? snapshot.spot_source ?? null : null),
    external_spot_last_updated: baseScenario.external_spot_last_updated ?? (shouldAdoptThetaSpot ? lastUpdate : null),
    external_spot_is_real: baseScenario.external_spot_is_real ?? (shouldAdoptThetaSpot && hasFiniteNumber(snapshot.spot)),
    flip_level: nextFlipLevel,
    call_wall: callWall,
    put_wall: putWall,
    max_pain: maxPain,
    theta_signal: thetaSignal,
    theta_snapshot: snapshot,
    theta_dealer_conclusion: dealerConclusion,
    theta_execution_constraint: executionConstraint,
    theta_source_status: thetaSourceStatus
  };
}

function enrichTradePlanWithProjection(tradePlan = {}, crossAssetProjection = {}, instrument = process.env.TARGET_INSTRUMENT || 'ES') {
  const targetInstrument = ['SPX', 'SPY', 'ES', 'MES'].includes(String(instrument).toUpperCase())
    ? String(instrument).toUpperCase()
    : 'ES';
  const levelSet = targetInstrument === 'SPY'
    ? crossAssetProjection.spy_equivalent_levels
    : targetInstrument === 'SPX'
      ? crossAssetProjection.spx_levels
      : crossAssetProjection.es_equivalent_levels;
  const callWall = levelSet?.call_wall ?? null;
  const putWall = levelSet?.put_wall ?? null;
  const zeroGamma = levelSet?.zero_gamma ?? null;
  const hasProjectedLevels = targetInstrument === 'SPX' || callWall != null || putWall != null || zeroGamma != null;
  const targetLabel = targetInstrument === 'MES' ? 'MES/ES' : targetInstrument;
  const targets = Array.isArray(tradePlan.targets) ? tradePlan.targets : [];

  return {
    ...tradePlan,
    target_instrument: targetInstrument,
    entry_zone: {
      ...(tradePlan.entry_zone || {}),
      low: zeroGamma,
      high: zeroGamma,
      text: hasProjectedLevels && zeroGamma != null
        ? `${targetLabel} 回踩 ${zeroGamma.toFixed(2)} 附近守住后观察。`
        : tradePlan.entry_zone?.text || '--',
      source_level: zeroGamma != null ? {
        spx: crossAssetProjection.spx_levels?.zero_gamma ?? null,
        spy_equiv: crossAssetProjection.spy_equivalent_levels?.zero_gamma ?? null,
        es_equiv: crossAssetProjection.es_equivalent_levels?.zero_gamma ?? null,
        type: 'zero_gamma'
      } : null
    },
    stop_loss: {
      ...(tradePlan.stop_loss || {}),
      level: putWall,
      text: hasProjectedLevels && putWall != null
        ? `${targetLabel} 跌破 ${putWall.toFixed(2)} 且收不回，作废。`
        : tradePlan.stop_loss?.text || '--',
      source_level: putWall != null ? {
        spx: crossAssetProjection.spx_levels?.put_wall ?? null,
        spy_equiv: crossAssetProjection.spy_equivalent_levels?.put_wall ?? null,
        es_equiv: crossAssetProjection.es_equivalent_levels?.put_wall ?? null,
        type: 'put_wall'
      } : null
    },
    targets: targets.map((target, index) => index === 0 && callWall != null ? {
      ...target,
      label: target.label || target.name || 'TP1',
      level: callWall,
      reason: `${targetLabel} ${callWall.toFixed(2)}（SPX Call Wall ${crossAssetProjection.spx_levels?.call_wall ?? '--'} 等效）`,
      source_level: {
        spx: crossAssetProjection.spx_levels?.call_wall ?? null,
        spy_equiv: crossAssetProjection.spy_equivalent_levels?.call_wall ?? null,
        es_equiv: crossAssetProjection.es_equivalent_levels?.call_wall ?? null,
        type: 'call_wall'
      }
    } : target),
    invalidation: {
      ...(tradePlan.invalidation || {}),
      level: putWall,
      text: hasProjectedLevels && putWall != null
        ? `${targetLabel} 跌破下方墙位等效价 ${putWall.toFixed(2)} 后计划失效。`
        : tradePlan.invalidation?.text || '--'
    },
    projection_note: crossAssetProjection.plain_chinese
  };
}

export async function getCurrentSignal(requestedScenario, options = {}) {
  const scenarioMode = typeof requestedScenario === 'string' && requestedScenario.length > 0;
  const scenario = {
    ...getMockScenario(requestedScenario),
    scenario_mode: scenarioMode,
    is_mock: scenarioMode,
    fetch_mode: scenarioMode ? 'mock_scenario' : 'live_fallback'
  };
  const snapshot = await getTradingViewSnapshot();
  const thetaSnapshot = await getThetaSnapshot();
  const {
    snapshot: uwSnapshot,
    sourceStatus: uwSourceStatus,
    provider: uwProvider
  } = await readUwProvider();
  const fmpSnapshot = await getFmpSnapshot(options.fmp);
  const enrichedScenario = applyTradingViewPriceFallback(
    applyFmpPriceSnapshot(
      applyFmpEventSnapshot(
        applyTradingViewSnapshot(scenario, snapshot),
        fmpSnapshot.event
      ),
      fmpSnapshot.price
    ),
    snapshot
  );
  const finalScenario = applyThetaSnapshot(
    enrichedScenario,
    thetaSnapshot
  );
  const normalized = normalizeMockScenario(finalScenario);
  const signal = runMasterEngine(normalized);

  const uwApi = normalizeUwApiSnapshot(uwSnapshot || {});
  const dealerEngine = runUwDealerEngine({
    provider: uwProvider,
    dealerFactors: uwApi.uw_factors.dealer_factors,
    spotGexFactors: uwApi.uw_factors.dealer_factors
  });
  const institutionalAlert = runUwInstitutionalEngine({
    provider: uwProvider,
    flowFactors: uwApi.uw_factors.flow_factors,
    tvSentinel: signal.tv_sentinel
  });
  const volatilityActivation = runUwVolatilityEngine({
    provider: uwProvider,
    volatilityFactors: uwApi.uw_factors.volatility_factors,
    institutionalAlert,
    dealerEngine
  });
  const marketSentiment = runUwSentimentEngine({
    provider: uwProvider,
    sentimentFactors: uwApi.uw_factors.sentiment_factors
  });
  const darkpoolSummary = runUwDarkpoolEngine({
    provider: uwProvider,
    darkpoolFactors: uwApi.uw_factors.darkpool_factors
  });
  const technicalEngine = runTechnicalEngine({
    technicalFactors: uwApi.uw_factors.technical_factors
  });
  const flowValidation = runFlowValidationEngine({
    institutionalAlert,
    darkpoolSummary,
    marketSentiment,
    dealerEngine,
    tvSentinel: signal.tv_sentinel,
    technicalEngine
  });
  const healthMatrix = runHealthMatrixEngine({
    signal,
    uwProvider,
    tvSentinel: signal.tv_sentinel,
    theta: signal.theta,
    dealerEngine
  });
  const setupSynthesis = runSetupSynthesisEngine({
    volatilityActivation,
    institutionalAlert,
    darkpoolSummary,
    marketSentiment,
    dealerEngine,
    technicalEngine
  });
  const projectionPrices = buildProjectionPrices({
    signal,
    normalized,
    tradingViewSnapshot: snapshot,
    uwApi
  });
  const projectionLevels = buildProjectionLevels({
    signal,
    dealerEngine,
    uwApi
  });
  const crossAssetProjection = buildCrossAssetProjection({
    prices: projectionPrices,
    spxLevels: projectionLevels,
    targetInstrument: process.env.TARGET_INSTRUMENT || 'ES'
  });
  const uwEndpointCoverage = buildEndpointCoverageReport(uwProvider.endpoint_coverage || uwSnapshot?.endpoint_coverage || {});
  const coverageInputs = Object.fromEntries(
    Object.entries(uwEndpointCoverage).map(([group, report]) => [group, report.ok || []])
  );
  const normalizedUw = uwProvider.mode === 'api'
    ? {
        source: 'unusual_whales_api',
        status: uwProvider.status,
        last_update: uwProvider.last_update,
        flow: {
          flow_bias: institutionalAlert.direction === 'none' ? 'unavailable' : institutionalAlert.direction,
          institutional_entry: institutionalAlert.state
        },
        darkpool: {
          darkpool_bias: darkpoolSummary.bias === 'unknown' ? 'unavailable' : darkpoolSummary.bias
        },
        volatility: {
          volatility_light: volatilityActivation.light
        },
        sentiment: {
          market_tide: marketSentiment.state
        },
        dealer_crosscheck: {
          state: dealerEngine.status === 'live' ? 'confirm' : 'unavailable'
        },
        quality: {
          data_quality: uwProvider.status,
          missing_fields: [],
          warnings: uwProvider.endpoints_failed || []
        }
      }
    : normalizeUwSummary(uwSnapshot).uw;
  const uwConclusion = runUwConclusionEngine({
    normalized: {
      uw: normalizedUw
    }
  });
  const uwExecutionConstraint = {
    available: !['unavailable', 'error'].includes(uwConclusion.status),
    executable: uwConclusion.status === 'live',
    reason:
      uwConclusion.status === 'live'
        ? ''
        : uwConclusion.status === 'partial'
          ? 'UW partial'
          : uwConclusion.status === 'stale'
            ? 'UW stale'
            : uwConclusion.status === 'error'
              ? 'UW error'
              : 'UW unavailable'
  };
  const safeUwContext = {
    flow_bias: uwConclusion.flow_bias || 'unavailable',
    dark_pool_bias: uwConclusion.darkpool_bias || 'unavailable',
    dealer_bias: uwConclusion.dealer_crosscheck || 'unavailable',
    advanced_greeks: signal.uw_context?.advanced_greeks || {}
  };
  const safeRadarSummary = {
    ...(signal.radar_summary || {}),
    order_flow:
      uwConclusion.status === 'live'
        ? signal.radar_summary?.order_flow
        : `${uwConclusion.status} / 仅参考，不可执行`,
    dealer:
      signal.dealer_conclusion?.status === 'live'
        ? signal.radar_summary?.dealer
        : `${signal.dealer_conclusion?.status || 'unavailable'} / Gamma 不完整，不可执行`,
    dark_pool:
      uwConclusion.status === 'live'
        ? signal.radar_summary?.dark_pool
        : `${uwConclusion.status} / unavailable`,
    plan_alignment: 'blocked / not ready'
  };
  const keyLevels = buildKeyLevels({ dealerEngine, uwApi, signal });
  const uwPriceMapActive = keyLevels.source === 'uw' && ['live', 'partial'].includes(dealerEngine.status);

  const uwLastUpdate = uwProvider.last_update || uwSourceStatus.last_update || signal.received_at || new Date().toISOString();
  const sourceStatus = Array.isArray(signal.source_status)
    ? [
        ...signal.source_status.filter((item) => item.source !== 'uw'),
        {
          source: 'uw',
          configured: uwProvider.mode === 'api' || uwSnapshot != null,
          available: uwExecutionConstraint.available,
          is_mock: false,
          fetch_mode: uwProvider.mode === 'api' ? 'uw_api_cache' : 'ingest_push',
          stale: uwProvider.status === 'stale' || uwSourceStatus.stale === true,
          state: uwProvider.status || uwSourceStatus.state || 'unavailable',
          message: uwSourceStatus.message || uwExecutionConstraint.reason,
          last_updated: uwLastUpdate,
          data_timestamp: uwLastUpdate,
          received_at: signal.received_at,
          latency_ms: 0,
          stale_reason: '',
          refresh_interval_ms: null,
          stale_threshold_ms: null,
          down_threshold_ms: null,
          event_triggers: []
        }
      ]
    : signal.source_status;

  const enrichedSignal = {
    ...signal,
    source_status: sourceStatus,
    uw_endpoint_coverage: uwEndpointCoverage,
    institutional_entry_alert: signal.institutional_entry_alert || {},
    institutional_alert: institutionalAlert,
    uw: normalizedUw,
    uw_conclusion: {
      ...uwConclusion,
      provider_mode: uwProvider.mode
    },
    uw_provider: uwProvider,
    uw_raw: uwApi.uw_raw,
    uw_factors: uwApi.uw_factors,
    dealer_engine: dealerEngine,
    uw_dealer_greeks: uwPriceMapActive
      ? {
          status: dealerEngine.status,
          call_gamma: uwApi.uw_factors?.dealer_factors?.top_call_gamma_strikes?.[0]?.value ?? null,
          put_gamma: uwApi.uw_factors?.dealer_factors?.top_put_gamma_strikes?.[0]?.value ?? null,
          call_vanna: null,
          put_vanna: null,
          call_charm: null,
          put_charm: null,
          call_delta: null,
          put_delta: null,
          net_gamma_bias: dealerEngine.regime === 'positive_gamma' ? 'positive' : dealerEngine.regime === 'negative_gamma' ? 'negative' : 'mixed',
          net_vanna_bias: uwApi.uw_factors?.dealer_factors?.vanna_bias || 'unknown',
          net_charm_bias: uwApi.uw_factors?.dealer_factors?.charm_bias || 'unknown',
          net_delta_bias: uwApi.uw_factors?.dealer_factors?.delta_bias || 'unknown',
          dealer_crosscheck: dealerEngine.status === 'live' ? 'confirm' : 'partial',
          plain_chinese: dealerEngine.status === 'live'
            ? 'UW Greek Exposure live，使用 UW Gamma/Wall 主线。'
            : 'UW Greek Exposure partial，墙位可用，vanna/charm/delta 部分缺失。'
        }
      : signal.uw_dealer_greeks,
    uw_price_map_active: uwPriceMapActive,
    uw_context: safeUwContext,
    radar_summary: safeRadarSummary,
    signals: {
      ...(signal.signals || {}),
      uw_signal: uwConclusion.status === 'live' ? signal.signals?.uw_signal : 'unavailable',
      dealer_behavior: signal.dealer_conclusion?.status === 'live' ? signal.signals?.dealer_behavior : 'unknown'
    },
    projection: {
      ...(signal.projection || {}),
      dealer_summary: {
        ...(signal.projection?.dealer_summary || {}),
        call_wall: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.call_wall : null,
        put_wall: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.put_wall : null,
        max_pain: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.max_pain : null,
        zero_gamma: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.zero_gamma : null
      }
    },
    execution_constraints: {
      ...(signal.execution_constraints || {}),
      uw: uwExecutionConstraint
    },
    trade_plan: {
      ...(signal.trade_plan || {}),
      uw_ready: uwExecutionConstraint.executable,
      position_sizing: signal.trade_plan?.position_sizing || '0仓',
      wait_conditions: signal.trade_plan?.wait_conditions || [{
        type: 'tv_structure_signal',
        text: '等待 TV 结构信号，不提前交易。'
      }],
      ttl_text: signal.trade_plan?.ttl_text || '等待状态无有效交易 TTL。'
    },
    institutional_alert: institutionalAlert,
    volatility_activation: volatilityActivation,
    market_sentiment: marketSentiment,
    darkpool_summary: darkpoolSummary,
    key_levels: keyLevels,
    health_matrix: healthMatrix,
    flow_validation: flowValidation,
    technical_engine: technicalEngine,
    cross_asset_projection: crossAssetProjection,
    allowed_setups: setupSynthesis.allowed_setups,
    allowed_setups_reason: setupSynthesis.allowed_setups_reason,
    blocked_setups_reason: setupSynthesis.blocked_setups_reason,
    tv_match_engine: {
      event_type: signal.tv_sentinel?.event_type || null,
      matched_allowed_setup: signal.tv_sentinel?.matched_allowed_setup === true,
      status: signal.tv_sentinel?.status || 'waiting',
      plain_chinese: signal.tv_sentinel?.plain_chinese || signal.tv_sentinel?.reason || '等待 TV 结构信号。'
    },
    es_proxy: buildEsProxy(),
    session_engine: buildSessionEngine(),
    notes: cleanProductionNotes(signal.notes, signal.is_mock === true)
  };

  const projectedTradePlan = enrichTradePlanWithProjection(enrichedSignal.trade_plan, crossAssetProjection);
  if (uwPriceMapActive) {
    projectedTradePlan.status = projectedTradePlan.status === 'blocked' ? 'wait' : projectedTradePlan.status;
    projectedTradePlan.trigger_status = projectedTradePlan.trigger_status === 'blocked' ? 'waiting' : projectedTradePlan.trigger_status;
    projectedTradePlan.direction_label = projectedTradePlan.direction_label === '禁做' ? '等待' : projectedTradePlan.direction_label;
    projectedTradePlan.conflicts = (projectedTradePlan.conflicts || []).filter((item) => !/ThetaData unavailable|价格地图冲突|price_map_conflict/i.test(String(item)));
    projectedTradePlan.plain_chinese = 'UW Dealer / Wall 数据已接管价格地图；TV 尚未确认结构，0仓等待。';
  }
  enrichedSignal.trade_plan = projectedTradePlan;
  const effectiveDataHealth = uwPriceMapActive
    ? {
        ...(enrichedSignal.data_health || {}),
        executable: true,
        summary: {
          ...(enrichedSignal.data_health?.summary || {}),
          health: 'yellow',
          label: 'WAIT',
          plain_chinese: 'UW wall data live/partial，等待 TV 结构确认。'
        }
      }
    : enrichedSignal.data_health;
  const effectiveConflictResolver = uwPriceMapActive
    ? {
        ...(enrichedSignal.conflict_resolver || {}),
        action: enrichedSignal.tv_sentinel?.status === 'waiting' ? 'wait' : enrichedSignal.conflict_resolver?.action || 'wait',
        conflicts: (enrichedSignal.conflict_resolver?.conflicts || []).filter((item) => !/price_map_conflict/i.test(String(item))),
        plain_chinese: 'UW wall data 已接管旧价格地图，等待 TV 确认。'
      }
    : enrichedSignal.conflict_resolver;

  const commandCenter = runCommandCenterEngine({
    uwProvider,
    dealerEngine,
    institutionalAlert,
    volatilityActivation,
    marketSentiment,
    darkpoolSummary,
    dataHealth: effectiveDataHealth,
    tvSentinel: enrichedSignal.tv_sentinel,
    theta: enrichedSignal.theta,
    tradePlan: enrichedSignal.trade_plan,
    flowPriceDivergence: enrichedSignal.flow_price_divergence,
    conflictResolver: effectiveConflictResolver,
    crossAssetProjection
  });
  const strategyPermissions = buildStrategyPermissions({
    signal: enrichedSignal,
    institutionalAlert,
    volatilityActivation,
    dealerEngine,
    commandCenter
  });
  const positionSizingEngine = runPositionSizingEngine({
    healthMatrix,
    commandCenter,
    volatilityActivation
  });
  const reflection = runReflectionEngine({
    commandCenter,
    uwProvider,
    dealerEngine,
    institutionalAlert,
    volatilityActivation,
    marketSentiment,
    darkpoolSummary,
    tradePlan: projectedTradePlan,
    signal: {
      ...enrichedSignal,
      trade_plan: projectedTradePlan
    },
    crossAssetProjection
  });

  return replaceUndefined({
    ...enrichedSignal,
    trade_plan: projectedTradePlan,
    command_center: commandCenter,
    strategy_permissions: strategyPermissions,
    position_sizing_engine: positionSizingEngine,
    reflection,
    audit_log_ref: null
  });
}
