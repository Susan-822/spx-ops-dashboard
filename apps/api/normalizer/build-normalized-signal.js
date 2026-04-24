import { createSourceStatus } from '../../../packages/shared/src/source-status.js';

const STALE_WINDOW_MS = 5 * 60 * 1000;

function isStale(timestamp, lastUpdated) {
  const now = new Date(timestamp).getTime();
  const then = new Date(lastUpdated).getTime();
  return Number.isFinite(now) && Number.isFinite(then) ? now - then > STALE_WINDOW_MS : true;
}

function createSourceEntry({ source, signal, last_updated, stale }) {
  return createSourceStatus({
    source,
    configured: false,
    available: !stale,
    is_mock: true,
    stale,
    last_updated,
    message: stale
      ? `${source} mock payload is stale and must not drive trading action.`
      : `${source} mock payload is fresh enough for the closed-loop demo.`
  });
}

export function normalizeMockScenario(rawScenario) {
  const stale_flags = {
    theta: isStale(rawScenario.timestamp, rawScenario.last_updated.theta),
    tradingview: isStale(rawScenario.timestamp, rawScenario.last_updated.tradingview),
    uw: isStale(rawScenario.timestamp, rawScenario.last_updated.uw),
    fmp: isStale(rawScenario.timestamp, rawScenario.last_updated.fmp)
  };

  stale_flags.any_stale = Object.values(stale_flags).some(Boolean);

  const source_status = [
    createSourceEntry({
      source: 'theta',
      signal: rawScenario.theta_signal,
      last_updated: rawScenario.last_updated.theta,
      stale: stale_flags.theta
    }),
    createSourceEntry({
      source: 'tradingview',
      signal: rawScenario.tv_structure_event,
      last_updated: rawScenario.last_updated.tradingview,
      stale: stale_flags.tradingview
    }),
    createSourceEntry({
      source: 'uw',
      signal: rawScenario.uw_flow_bias,
      last_updated: rawScenario.last_updated.uw,
      stale: stale_flags.uw
    }),
    createSourceEntry({
      source: 'fmp',
      signal: rawScenario.fmp_signal,
      last_updated: rawScenario.last_updated.fmp,
      stale: stale_flags.fmp
    })
  ];

  return {
    scenario: rawScenario.scenario,
    timestamp: rawScenario.timestamp,
    is_mock: true,
    symbol: rawScenario.symbol,
    timeframe: rawScenario.timeframe,
    plain_thesis: `Scenario ${rawScenario.scenario} drives the full mock master-engine loop.`,
    last_updated: rawScenario.last_updated,
    stale_flags,
    source_status,
    gamma_regime: rawScenario.gamma_regime,
    spot: rawScenario.spot,
    flip_level: rawScenario.flip_level,
    call_wall: rawScenario.call_wall,
    put_wall: rawScenario.put_wall,
    max_pain: rawScenario.max_pain,
    iv_state: rawScenario.iv_state,
    uw_flow_bias: rawScenario.uw_flow_bias,
    uw_dark_pool_bias: rawScenario.uw_dark_pool_bias,
    uw_dealer_bias: rawScenario.uw_dealer_bias,
    advanced_greeks: rawScenario.advanced_greeks,
    event_risk: rawScenario.event_risk,
    event_note: rawScenario.event_note,
    fmp_signal: rawScenario.fmp_signal,
    theta_signal: rawScenario.theta_signal,
    tv_structure_event: rawScenario.tv_structure_event
  };
}
