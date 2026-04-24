import { createSourceStatus, SOURCE_STATE } from '../../../packages/shared/src/source-status.js';
import { getSourcePolicy } from '../scheduler/refresh-policy.js';
import { mapTradingViewEventToStructure } from '../storage/tradingview-snapshot.js';

const FMP_ABNORMAL_SOURCE_MESSAGE = 'FMP 数据异常，事件风险不可确认。';
const FMP_ABNORMAL_EVENT_NOTE = 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。';
const TV_STALE_NOTE = '最近一次 TradingView 结构事件已超过新鲜窗口，仍保留展示，但不作为新触发。';

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

function isFmpAbnormalState({ configured, is_mock, stale, state, available }) {
  if (!configured) {
    return false;
  }

  return (
    is_mock ||
    stale ||
    available === false ||
    state === SOURCE_STATE.DEGRADED ||
    state === SOURCE_STATE.DELAYED ||
    state === SOURCE_STATE.DOWN
  );
}

function isFmpPriceAbnormalState({ configured, is_mock, stale, state, available, price }) {
  if (!configured) {
    return false;
  }

  return (
    is_mock ||
    stale ||
    available === false ||
    state === SOURCE_STATE.DEGRADED ||
    state === SOURCE_STATE.DELAYED ||
    state === SOURCE_STATE.DOWN ||
    !Number.isFinite(Number(price))
  );
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
  const freshnessLatencyMs =
    snapshot?.received_at
      ? Math.max(0, new Date(snapshot.received_at).getTime() - new Date(lastUpdated).getTime())
      : Math.max(0, new Date(timestamp).getTime() - new Date(lastUpdated).getTime());
  const latencyMs = typeof snapshot?.latency_ms === 'number'
    ? Math.max(snapshot.latency_ms, freshnessLatencyMs)
    : freshnessLatencyMs;
  const stale = latencyMs >= policy.stale_threshold_ms;
  const isFallbackMock = Boolean(snapshot?.is_mock) && Boolean(snapshot?.fallback_reason);
  const state = pickSourceState({
    degraded: degraded || isFallbackMock,
    is_mock: snapshot?.is_mock ?? true,
    latencyMs,
    policy,
    available: snapshot?.available ?? true
  });
  const normalizedState =
    source === 'tradingview' && state === SOURCE_STATE.DOWN && stale
      ? SOURCE_STATE.DELAYED
      : state;
  const staleReason = snapshot?.stale_reason || createStaleReason(source, stale, latencyMs, policy.stale_threshold_ms);
  const tradingviewMessage =
    source === 'tradingview' && stale
      ? '最近一次 TradingView 事件已 stale，仍保留展示。'
      : null;
  const isFmpAbnormal = source === 'fmp_event' && isFmpAbnormalState({
    configured: snapshot?.configured ?? false,
    is_mock: snapshot?.is_mock ?? true,
    stale,
    state,
    available: snapshot?.available ?? true
  });
  const isFmpPriceAbnormal = source === 'fmp_price' && isFmpPriceAbnormalState({
    configured: snapshot?.configured ?? false,
    is_mock: snapshot?.is_mock ?? true,
    stale,
    state,
    available: snapshot?.available ?? true,
    price: snapshot?.price
  });

  return createSourceStatus({
    source,
    configured: snapshot?.configured ?? false,
    available: snapshot?.available ?? normalizedState !== SOURCE_STATE.DOWN,
    is_mock: snapshot?.is_mock ?? true,
    fetch_mode: snapshot?.fetch_mode ?? policy.fetch_mode,
    stale,
    state: normalizedState,
    last_updated: lastUpdated,
    data_timestamp: snapshot?.data_timestamp ?? lastUpdated,
    received_at: snapshot?.received_at ?? timestamp,
    latency_ms: latencyMs,
    stale_reason: staleReason,
    refresh_interval_ms: policy.default_refresh_ms,
    stale_threshold_ms: policy.stale_threshold_ms,
    down_threshold_ms: policy.down_threshold_ms,
    event_triggers: policy.event_triggers,
    message: tradingviewMessage
      || (isFmpAbnormal
        ? FMP_ABNORMAL_SOURCE_MESSAGE
        : isFmpPriceAbnormal
          ? 'FMP SPX price unavailable'
          : source === 'tradingview' && stale
            ? '最近一次 TradingView 事件已 stale，仍保留展示。'
            : snapshot?.message
              || (degraded
                ? `${source} 当前处于 degraded 模式，结论只能降权参考。`
                : stale
                  ? `${source} 当前已 delayed，不能直接主导动作。`
                  : `${source} 数据已接收。`))
  });
}

function deriveEventContext(rawScenario, fmpStatus) {
  if (isFmpAbnormalState(fmpStatus ?? {})) {
    return {
      event_risk: 'medium',
      event_note: FMP_ABNORMAL_EVENT_NOTE,
      no_short_vol_window: true,
      trade_permission_adjustment: 'downgrade'
    };
  }

  return {
    event_risk: rawScenario.event_risk,
    event_note: rawScenario.event_note,
    no_short_vol_window: rawScenario.event_risk === 'high' || rawScenario.event_risk === 'medium',
    trade_permission_adjustment: rawScenario.event_risk === 'low' ? 'normal' : 'downgrade'
  };
}

function deriveSpotContext(rawScenario) {
  const priceSnapshot = rawScenario.fmp_price_snapshot;
  if (!priceSnapshot) {
    return {
      spot: rawScenario.spot,
      spot_source: 'mock',
      spot_last_updated: rawScenario.last_updated?.fmp ?? rawScenario.timestamp,
      spot_is_real: false,
      price_health: 'mock'
    };
  }

  const state = String(priceSnapshot.state || '').toLowerCase();
  const priceIsReal =
    priceSnapshot.configured === true
    && priceSnapshot.is_mock === false
    && priceSnapshot.stale === false
    && !['degraded', 'delayed', 'down', 'stale', 'mock'].includes(state)
    && Number.isFinite(Number(priceSnapshot.price));

  if (!priceIsReal) {
    return {
      spot: null,
      spot_source: 'fmp',
      spot_last_updated: priceSnapshot.last_updated || priceSnapshot.data_timestamp || rawScenario.last_updated?.fmp,
      spot_is_real: false,
      price_health: state || (priceSnapshot.stale ? 'stale' : 'degraded')
    };
  }

  return {
    spot: Number(priceSnapshot.price),
    spot_source: 'fmp',
    spot_last_updated: priceSnapshot.last_updated || priceSnapshot.data_timestamp || rawScenario.last_updated?.fmp,
    spot_is_real: true,
    price_health: 'real'
  };
}

function deriveTradingViewContext(rawScenario) {
  const snapshot = rawScenario.tradingview_snapshot;
  if (!snapshot) {
    return {
      tv_structure_event: rawScenario.tv_structure_event,
      tradingview_note: '',
      tradingview_last_updated: rawScenario.last_updated.tradingview
    };
  }

  return {
    tv_structure_event: snapshot.tv_structure_event || mapTradingViewEventToStructure(snapshot.event_type) || rawScenario.tv_structure_event,
    tradingview_note: snapshot.stale ? TV_STALE_NOTE : `最近 TV 事件：${snapshot.event_type || 'unknown_event'}。`,
    tradingview_last_updated: snapshot.last_updated || snapshot.received_at || rawScenario.last_updated.tradingview
  };
}

function appendUniqueNote(notes, note) {
  if (!note) {
    return notes;
  }
  return notes.includes(note) ? notes : [...notes, note];
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
      source: 'fmp_event',
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

  const tradingviewIndex = source_status.findIndex((item) => item.source === 'tradingview');
  if (tradingviewIndex >= 0 && rawScenario.tradingview_snapshot) {
    source_status[tradingviewIndex] = createSourceEntryFromSnapshot({
      source: 'tradingview',
      timestamp: receivedAt,
      snapshot: rawScenario.tradingview_snapshot,
      fallbackLastUpdated: rawScenario.last_updated.tradingview
    });
  }

  const fmpIndex = source_status.findIndex((item) => item.source === 'fmp_event');
  if (fmpIndex >= 0 && rawScenario.fmp_event_snapshot) {
    source_status[fmpIndex] = createSourceEntryFromSnapshot({
      source: 'fmp_event',
      timestamp: receivedAt,
      snapshot: rawScenario.fmp_event_snapshot,
      fallbackLastUpdated: rawScenario.last_updated.fmp
    });
  }

  source_status.splice(5, 0, createSourceEntry({
    source: 'fmp_price',
    timestamp: receivedAt,
    last_updated: rawScenario.last_updated.fmp
  }));

  const fmpPriceIndex = source_status.findIndex((item) => item.source === 'fmp_price');
  if (fmpPriceIndex >= 0 && rawScenario.fmp_price_snapshot) {
    source_status[fmpPriceIndex] = createSourceEntryFromSnapshot({
      source: 'fmp_price',
      timestamp: receivedAt,
      snapshot: rawScenario.fmp_price_snapshot,
      fallbackLastUpdated: rawScenario.last_updated.fmp
    });
  }

  const stale_flags = {
    theta: source_status.find((item) => item.source === 'theta_core')?.stale ?? true,
    tradingview: source_status.find((item) => item.source === 'tradingview')?.stale ?? true,
    uw: source_status.find((item) => item.source === 'uw_dom')?.stale ?? true,
    fmp: source_status.find((item) => item.source === 'fmp_event')?.stale ?? true
  };
  stale_flags.any_stale = Object.values(stale_flags).some(Boolean);

  const stale_reason = source_status.filter((item) => item.stale_reason).map((item) => item.stale_reason);
  const latency_ms = source_status.reduce((max, item) => Math.max(max, item.latency_ms), 0);
  const fmpStatus = source_status.find((item) => item.source === 'fmp_event');
  const eventContext = deriveEventContext(rawScenario, fmpStatus);
  const spotContext = deriveSpotContext(rawScenario);
  const tradingViewContext = deriveTradingViewContext(rawScenario);
  const notes = appendUniqueNote([], tradingViewContext.tradingview_note);

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
    spot: spotContext.spot,
    spot_source: spotContext.spot_source,
    spot_last_updated: spotContext.spot_last_updated,
    spot_is_real: spotContext.spot_is_real,
    price_health: spotContext.price_health,
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
    event_risk: eventContext.event_risk,
    event_note: eventContext.event_note,
    no_short_vol_window: eventContext.no_short_vol_window,
    trade_permission_adjustment: eventContext.trade_permission_adjustment,
    fmp_signal: rawScenario.fmp_signal,
    theta_signal: rawScenario.theta_signal,
    tv_structure_event: tradingViewContext.tv_structure_event,
    tradingview_note: tradingViewContext.tradingview_note,
    notes
  };
}
