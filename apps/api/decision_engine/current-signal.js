import { getMockScenario } from './mock-scenarios.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';
import { getTradingViewSnapshot } from '../storage/tradingview-snapshot.js';
import { getThetaSnapshot } from '../storage/theta-snapshot.js';
import { getUwSourceStatus, readUwSnapshot } from '../state/uwSnapshotStore.js';
import { getFmpSnapshot } from '../adapters/fmp/index.js';
import { normalizeUwSummary } from '../../../integrations/unusual-whales/normalizer/uw-summary-normalizer.js';
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
  const uwSnapshot = await readUwSnapshot();
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

  const normalizedUw = normalizeUwSummary(uwSnapshot).uw;
  const uwSourceStatus = getUwSourceStatus(uwSnapshot);
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

  const uwLastUpdate = uwSourceStatus.last_update || signal.received_at || new Date().toISOString();
  const sourceStatus = Array.isArray(signal.source_status)
    ? [
        ...signal.source_status.filter((item) => item.source !== 'uw'),
        {
          source: 'uw',
          configured: uwSnapshot != null,
          available: uwExecutionConstraint.available,
          is_mock: uwConclusion.status === 'unavailable',
          fetch_mode: 'ingest_push',
          stale: uwSourceStatus.stale === true,
          state: uwSourceStatus.state || 'unavailable',
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

  return {
    ...signal,
    source_status: sourceStatus,
    uw: normalizedUw,
    uw_conclusion: uwConclusion,
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
      uw_ready: uwExecutionConstraint.executable
    }
  };
}
