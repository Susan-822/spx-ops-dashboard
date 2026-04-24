import { getMockScenario } from './mock-scenarios.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';
import { getTradingViewSnapshot } from '../storage/tradingview-snapshot.js';

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

export async function getCurrentSignal(requestedScenario) {
  const scenario = getMockScenario(requestedScenario);
  const snapshot = getTradingViewSnapshot();
  const enrichedScenario = applyTradingViewSnapshot(scenario, snapshot);
  const normalized = normalizeMockScenario(enrichedScenario);
  return runMasterEngine(normalized);
}
