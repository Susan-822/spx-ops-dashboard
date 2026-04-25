import { getMockScenario } from './mock-scenarios.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';
import { getTradingViewSnapshot } from '../storage/tradingview-snapshot.js';
import { getThetaSnapshot } from '../storage/theta-snapshot.js';
import { getFmpSnapshot } from '../adapters/fmp/index.js';
import {
  buildDealerConclusionEngine,
  deriveThetaExecutionConstraint,
  deriveThetaSignalFromSnapshot,
  mapThetaSnapshotToSourceStatus
} from './dealer-conclusion-engine.js';

function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
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
  const callWall = dealerConclusion.call_wall ?? baseScenario.call_wall;
  const putWall = dealerConclusion.put_wall ?? baseScenario.put_wall;
  const maxPain = dealerConclusion.max_pain ?? baseScenario.max_pain;
  const gammaRegime = dealerConclusion.gamma_regime !== 'unknown'
    ? dealerConclusion.gamma_regime
    : baseScenario.gamma_regime;
  const thetaSignal = deriveThetaSignalFromSnapshot(snapshot) || baseScenario.theta_signal;
  const lastUpdate = snapshot.last_update || snapshot.last_updated || baseScenario.last_updated.theta;
  const shouldAdoptThetaSpot =
    baseScenario.scenario_mode !== true
    && hasFiniteNumber(snapshot.spot)
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
    external_spot: baseScenario.external_spot ?? (hasFiniteNumber(snapshot.spot) ? Number(snapshot.spot) : null),
    external_spot_source: baseScenario.external_spot_source ?? snapshot.spot_source ?? null,
    external_spot_last_updated: baseScenario.external_spot_last_updated ?? lastUpdate,
    external_spot_is_real: baseScenario.external_spot_is_real ?? hasFiniteNumber(snapshot.spot),
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
  return runMasterEngine(normalized);
}
