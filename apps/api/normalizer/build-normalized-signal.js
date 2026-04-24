import { createSourceStatus } from '../../../packages/shared/src/source-status.js';

const STALE_WINDOW_MS = 5 * 60 * 1000;

function isStale(timestamp, lastUpdated) {
  const now = new Date(timestamp).getTime();
  const then = new Date(lastUpdated).getTime();
  return Number.isFinite(now) && Number.isFinite(then) ? now - then > STALE_WINDOW_MS : true;
}

function createStaleReason(source, stale, latencyMs) {
  if (!stale) {
    return '';
  }

  return `${source} 数据超过 5 分钟未更新，当前延迟约 ${latencyMs}ms。`;
}

function createSourceEntry({ source, timestamp, last_updated, stale }) {
  const latencyMs = Math.max(0, new Date(timestamp).getTime() - new Date(last_updated).getTime());
  const staleReason = createStaleReason(source, stale, latencyMs);

  return createSourceStatus({
    source,
    configured: false,
    available: !stale,
    is_mock: true,
    fetch_mode: 'mock_scenario',
    stale,
    last_updated,
    data_timestamp: last_updated,
    received_at: timestamp,
    latency_ms: latencyMs,
    stale_reason: staleReason,
    message: stale
      ? `${source} mock 数据已过期，本轮不能直接参与动作判断。`
      : `${source} mock 数据已接收，可进入 mock engine 链路。`
  });
}

export function normalizeMockScenario(rawScenario) {
  const receivedAt = new Date().toISOString();
  const stale_flags = {
    theta: isStale(receivedAt, rawScenario.last_updated.theta),
    tradingview: isStale(receivedAt, rawScenario.last_updated.tradingview),
    uw: isStale(receivedAt, rawScenario.last_updated.uw),
    fmp: isStale(receivedAt, rawScenario.last_updated.fmp)
  };

  stale_flags.any_stale = Object.values(stale_flags).some(Boolean);

  const source_status = [
    createSourceEntry({
      source: 'theta',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.theta,
      stale: stale_flags.theta
    }),
    createSourceEntry({
      source: 'tradingview',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.tradingview,
      stale: stale_flags.tradingview
    }),
    createSourceEntry({
      source: 'uw',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.uw,
      stale: stale_flags.uw
    }),
    createSourceEntry({
      source: 'fmp',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.fmp,
      stale: stale_flags.fmp
    })
  ];

  const stale_reason = source_status.filter((item) => item.stale).map((item) => item.stale_reason);
  const latency_ms = source_status.reduce((max, item) => Math.max(max, item.latency_ms), 0);

  return {
    scenario: rawScenario.scenario,
    timestamp: rawScenario.timestamp,
    data_timestamp: rawScenario.timestamp,
    received_at: receivedAt,
    latency_ms,
    stale_reason,
    fetch_mode: 'mock_scenario',
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
