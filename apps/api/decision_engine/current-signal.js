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
    day_change_percent: snapshot.day_change_percent ?? null
  };
}

function applyThetaSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const dealerConclusion = buildDealerConclusionEngine({
    thetaSnapshot: snapshot,
    externalSpot: baseScenario.spot
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

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      theta: lastUpdate,
      theta_full_chain: lastUpdate
    },
    gamma_regime: gammaRegime,
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
  const scenario = getMockScenario(requestedScenario);
  const snapshot = await getTradingViewSnapshot();
  const thetaSnapshot = await getThetaSnapshot();
  const fmpSnapshot = await getFmpSnapshot(options.fmp);
  const enrichedScenario = applyThetaSnapshot(
    applyFmpPriceSnapshot(
      applyFmpEventSnapshot(
        applyTradingViewSnapshot(scenario, snapshot),
        fmpSnapshot.event
      ),
      fmpSnapshot.price
    ),
    thetaSnapshot
  );
  const normalized = normalizeMockScenario(enrichedScenario);
  return runMasterEngine(normalized);
}
