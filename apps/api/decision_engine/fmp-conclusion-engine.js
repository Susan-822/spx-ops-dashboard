function getSourceStatus(source_status = [], source) {
  return Array.isArray(source_status)
    ? source_status.find((item) => item.source === source) || null
    : null;
}

function statusFromSource(item) {
  if (!item) return 'unavailable';
  if (item.state === 'down') return 'error';
  if (item.stale || item.state === 'delayed') return 'stale';
  if (item.state === 'degraded') return 'unavailable';
  return item.is_mock ? 'unavailable' : 'live';
}

function deriveMarketBias({ event_risk, fmp_signal, day_change }) {
  if (event_risk === 'blocked' || fmp_signal === 'event_risk_high') {
    return 'risk_off';
  }
  if (typeof day_change === 'number') {
    if (day_change > 0) return 'risk_on';
    if (day_change < 0) return 'risk_off';
  }
  if (fmp_signal === 'clear') {
    return 'mixed';
  }
  return 'unavailable';
}

function deriveEventRiskLevel(eventRisk) {
  if (eventRisk === 'blocked') return 'blocked';
  if (eventRisk === 'caution') return 'caution';
  if (eventRisk === 'open') return 'normal';
  return 'unavailable';
}

export function runFmpConclusionEngine({ normalized, eventRisk }) {
  const eventSource = getSourceStatus(normalized.source_status, 'fmp_event');
  const priceSource = getSourceStatus(normalized.source_status, 'fmp_price');
  const status = statusFromSource(eventSource);
  const unavailableLike = status === 'unavailable' || status === 'stale' || status === 'error';
  const externalSpotSource = normalized.external_spot_source || 'unavailable';
  const priceStatus =
    unavailableLike ? 'unavailable'
    : !priceSource ? 'unavailable'
    : priceSource.state === 'down' ? 'unavailable'
    : priceSource.stale || priceSource.state === 'delayed' ? 'stale'
    : normalized.spot_is_real ? 'valid'
    : priceSource.state === 'degraded' ? 'conflict'
    : 'unavailable';
  const market_bias = unavailableLike
    ? 'unavailable'
    : deriveMarketBias({
        event_risk: deriveEventRiskLevel(eventRisk?.risk_gate),
        fmp_signal: normalized.fmp_signal,
        day_change: normalized.day_change
      });
  const event_risk = unavailableLike ? 'unavailable' : deriveEventRiskLevel(eventRisk?.risk_gate);
  const confidence_score =
    status === 'live' && priceStatus === 'valid' ? 75
    : status === 'live' ? 60
    : status === 'stale' ? 35
    : 20;

  return {
    status,
    market_bias,
    index_sync: 'unavailable',
    vix_signal: 'unavailable',
    event_risk,
    price_status: priceStatus,
    external_spot_source: externalSpotSource,
    confidence_score,
    plain_chinese:
      status === 'live'
        ? event_risk === 'blocked'
          ? 'FMP 事件风险阻断，价格虽可参考，但不允许放宽风险。'
          : priceStatus === 'valid'
            ? 'FMP 提供真实价格与事件风险辅助。'
            : 'FMP 事件风险可参考，但价格侧不完整。'
        : status === 'stale'
          ? 'FMP 结论已过期，只能辅助参考。'
          : 'FMP 当前不可用，只能按其他来源降级判断。'
  };
}
