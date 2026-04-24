import { getMockScenario } from './mock-scenarios.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';

export async function getCurrentSignal(requestedScenario) {
  const scenario = getMockScenario(requestedScenario);
  const normalized = normalizeMockScenario(scenario);
  return runMasterEngine(normalized);
}
