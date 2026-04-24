import { getMockScenario } from './mock-scenarios.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';
import { getTradingViewSnapshot } from '../storage/tradingview-snapshot.js';
import { getFmpSnapshot } from '../adapters/fmp/index.js';

function applyTradingViewSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  return {
    ...baseScenario,
    timeframe: snapshot.timeframe || baseScenario.timeframe,
    last_updated: {
      ...baseScenario.last_updated,
      tradingview: snapshot.last_updated || baseScenario.last_updated.tradingview
    },
    tv_structure_event: snapshot.tv_structure_event || baseScenario.tv_structure_event,
    tradingview_snapshot: snapshot
  };
}

function applyFmpSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      fmp: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp
    },
    fmp_snapshot: snapshot,
    event_risk:
      snapshot.event_risk === 'high' || snapshot.event_risk === 'medium'
        ? snapshot.event_risk
        : baseScenario.event_risk,
    event_note: snapshot.event_note || baseScenario.event_note,
    fmp_signal: snapshot.fmp_signal || baseScenario.fmp_signal
  };
}

export async function getCurrentSignal(requestedScenario, options = {}) {
  const scenario = getMockScenario(requestedScenario);
  const snapshot = getTradingViewSnapshot();
  const fmpSnapshot = await getFmpSnapshot(options.fmp);
  const enrichedScenario = applyFmpSnapshot(applyTradingViewSnapshot(scenario, snapshot), fmpSnapshot);
  const normalized = normalizeMockScenario(enrichedScenario);
  return runMasterEngine(normalized);
}
