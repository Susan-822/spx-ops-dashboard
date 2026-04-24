import { createSourceStatus, SOURCE_STATE } from '../../../packages/shared/src/source-status.js';
import { getSourcePolicy } from '../scheduler/refresh-policy.js';

function evaluateSourceState({ policy, is_mock, latencyMs }) {
  if (latencyMs >= policy.down_threshold_ms) {
    return SOURCE_STATE.DOWN;
  }
  if (latencyMs >= policy.stale_threshold_ms) {
    return SOURCE_STATE.DELAYED;
  }
  if (is_mock) {
    return SOURCE_STATE.MOCK;
  }
  return SOURCE_STATE.REAL;
}

function createStaleReason(source, stale, latencyMs, thresholdMs) {
  if (!stale) {
    return '';
  }
  return `${source} 超过 stale_threshold ${thresholdMs}ms，当前延迟约 ${latencyMs}ms。`;
}

function pickSourceState({ degraded, is_mock, latencyMs, policy, explicitState, available = true }) {
  if (explicitState) {
    return explicitState;
  }
  if (!available) {
    return SOURCE_STATE.DOWN;
  }
  if (degraded) {
    return SOURCE_STATE.DEGRADED;
  }
  return evaluateSourceState({ policy, is_mock, latencyMs });
}

function createSourceEntry({ source, timestamp, last_updated, degraded = false }) {
  const policy = getSourcePolicy(source);
  const latencyMs = Math.max(0, new Date(timestamp).getTime() - new Date(last_updated).getTime());
  const stale = latencyMs >= policy.stale_threshold_ms;
  const state = degraded
    ? SOURCE_STATE.DEGRADED
    : evaluateSourceState({ policy, is_mock: true, latencyMs });
  const staleReason = createStaleReason(source, stale, latencyMs, policy.stale_threshold_ms);

  return createSourceStatus({
    source,
    configured: false,
    available: state !== SOURCE_STATE.DOWN,
    is_mock: true,
    fetch_mode: policy.fetch_mode,
    stale,
    state,
    last_updated,
    data_timestamp: last_updated,
    received_at: timestamp,
    latency_ms: latencyMs,
    stale_reason: staleReason,
    refresh_interval_ms: policy.default_refresh_ms,
    stale_threshold_ms: policy.stale_threshold_ms,
    down_threshold_ms: policy.down_threshold_ms,
    event_triggers: policy.event_triggers,
    message: degraded
      ? `${source} 当前处于 degraded 模式，结论只能降权参考。`
      : stale
        ? `${source} 当前已 delayed，不能直接主导动作。`
        : `${source} mock 数据已接收，当前可作为 fallback 进入引擎。`
  });
}

function createSourceEntryFromSnapshot({
  source,
  timestamp,
  snapshot,
  fallbackLastUpdated,
  degraded = false
}) {
  const policy = getSourcePolicy(source);
  const lastUpdated = snapshot?.last_updated || snapshot?.data_timestamp || fallbackLastUpdated || timestamp;
  const latencyMs = typeof snapshot?.latency_ms === 'number'
    ? snapshot.latency_ms
    : Math.max(0, new Date(timestamp).getTime() - new Date(lastUpdated).getTime());
  const stale = latencyMs >= policy.stale_threshold_ms;
  const isFallbackMock = Boolean(snapshot?.is_mock) && Boolean(snapshot?.fallback_reason);
  const state = pickSourceState({
    degraded: degraded || isFallbackMock,
    is_mock: snapshot?.is_mock ?? true,
    latencyMs,
    policy,
    available: snapshot?.available ?? true
  });
  const staleReason = snapshot?.stale_reason || createStaleReason(source, stale, latencyMs, policy.stale_threshold_ms);

  return createSourceStatus({
    source,
    configured: snapshot?.configured ?? false,
    available: snapshot?.available ?? state !== SOURCE_STATE.DOWN,
    is_mock: snapshot?.is_mock ?? true,
    fetch_mode: snapshot?.fetch_mode ?? policy.fetch_mode,
    stale,
    state,
    last_updated: lastUpdated,
    data_timestamp: snapshot?.data_timestamp ?? lastUpdated,
    received_at: snapshot?.received_at ?? timestamp,
    latency_ms: latencyMs,
    stale_reason: staleReason,
    refresh_interval_ms: policy.default_refresh_ms,
    stale_threshold_ms: policy.stale_threshold_ms,
    down_threshold_ms: policy.down_threshold_ms,
    event_triggers: policy.event_triggers,
    message: snapshot?.message
      || (degraded
        ? `${source} 当前处于 degraded 模式，结论只能降权参考。`
        : stale
          ? `${source} 当前已 delayed，不能直接主导动作。`
          : `${source} 数据已接收。`)
  });
}

export function normalizeMockScenario(rawScenario) {
  const receivedAt = new Date().toISOString();

  const source_status = [
    createSourceEntry({
      source: 'dashboard',
      timestamp: receivedAt,
      last_updated: receivedAt
    }),
    createSourceEntry({
      source: 'tradingview',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.tradingview
    }),
    createSourceEntry({
      source: 'theta_core',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.theta
    }),
    createSourceEntry({
      source: 'theta_full_chain',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.theta_full_chain ?? rawScenario.last_updated.theta
    }),
    createSourceEntry({
      source: 'fmp',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.fmp
    }),
    createSourceEntry({
      source: 'uw_dom',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.uw,
      degraded: rawScenario.uw_fetch_path === 'screenshot'
    }),
    createSourceEntry({
      source: 'uw_screenshot',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.uw,
      degraded: rawScenario.uw_fetch_path !== 'screenshot'
    }),
    createSourceEntry({
      source: 'scheduler_health',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.scheduler_health ?? rawScenario.last_updated.tradingview
    }),
    createSourceEntry({
      source: 'telegram',
      timestamp: receivedAt,
      last_updated: rawScenario.last_updated.fmp,
      degraded: true
    })
  ];

  const fmpIndex = source_status.findIndex((item) => item.source === 'fmp');
  if (fmpIndex >= 0 && rawScenario.fmp_snapshot) {
    source_status[fmpIndex] = createSourceEntryFromSnapshot({
      source: 'fmp',
      timestamp: receivedAt,
      snapshot: rawScenario.fmp_snapshot,
      fallbackLastUpdated: rawScenario.last_updated.fmp
    });
  }

  const stale_flags = {
    theta: source_status.find((item) => item.source === 'theta_core')?.stale ?? true,
    tradingview: source_status.find((item) => item.source === 'tradingview')?.stale ?? true,
    uw: source_status.find((item) => item.source === 'uw_dom')?.stale ?? true,
    fmp: source_status.find((item) => item.source === 'fmp')?.stale ?? true
  };
  stale_flags.any_stale = Object.values(stale_flags).some(Boolean);

  const stale_reason = source_status.filter((item) => item.stale_reason).map((item) => item.stale_reason);
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
    plain_thesis: `Scenario ${rawScenario.scenario} drives the intraday command-center mock loop.`,
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
    uw_fetch_path: rawScenario.uw_fetch_path,
    advanced_greeks: rawScenario.advanced_greeks,
    event_risk: rawScenario.event_risk,
    event_note: rawScenario.event_note,
    fmp_signal: rawScenario.fmp_signal,
    theta_signal: rawScenario.theta_signal,
    tv_structure_event: rawScenario.tv_structure_event
  };
}
