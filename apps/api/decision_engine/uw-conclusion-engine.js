export function runUwConclusionEngine({ normalized, uwFlow, volatility }) {
  const sourceItems = Array.isArray(normalized?.source_status) ? normalized.source_status : [];
  const uwDom = sourceItems.find((item) => item.source === 'uw_dom');
  const uwScreenshot = sourceItems.find((item) => item.source === 'uw_screenshot');
  const status =
    uwDom?.state === 'real'
      ? 'live'
      : uwDom?.stale
        ? 'stale'
        : uwDom?.state === 'degraded' || uwScreenshot?.state === 'real'
          ? 'partial'
          : 'unavailable';

  const flow_bias =
    uwFlow?.uw_signal === 'bullish_flow'
      ? 'bullish'
      : uwFlow?.uw_signal === 'bearish_flow'
        ? 'bearish'
        : status === 'unavailable'
          ? 'unavailable'
          : 'mixed';

  const institutional_entry =
    uwFlow?.flow_quality_score >= 75
      ? 'bombing'
      : uwFlow?.flow_quality_score >= 60
        ? 'building'
        : uwFlow?.flow_quality_score > 0
          ? 'none'
          : 'unavailable';

  const darkpool_bias =
    normalized?.uw_dark_pool_bias === 'bullish'
      ? 'support'
      : normalized?.uw_dark_pool_bias === 'bearish'
        ? 'resistance'
        : status === 'unavailable'
          ? 'unavailable'
          : 'neutral';

  const volatility_light =
    volatility?.vol_state === 'contained'
      ? 'green'
      : volatility?.vol_state === 'mixed'
        ? 'yellow'
        : volatility?.vol_state === 'expanding' || volatility?.vol_state === 'event_loaded'
          ? 'red'
          : 'unavailable';

  const market_tide =
    flow_bias === 'bullish'
      ? 'risk_on'
      : flow_bias === 'bearish'
        ? 'risk_off'
        : status === 'unavailable'
          ? 'unavailable'
          : 'mixed';

  const dealer_crosscheck =
    normalized?.gamma_regime === 'positive' && flow_bias === 'bullish'
      ? 'confirm'
      : normalized?.gamma_regime === 'negative' && flow_bias === 'bearish'
        ? 'confirm'
        : flow_bias === 'mixed' || status === 'unavailable'
          ? 'unavailable'
          : 'conflict';

  const plain_chinese =
    status === 'unavailable'
      ? 'UW 不可用，当前无法确认机构 Flow / Dark Pool / 波动配合。'
      : flow_bias === 'bullish'
        ? 'UW 偏多，机构有入场迹象。'
        : flow_bias === 'bearish'
          ? 'UW 偏空，机构卖压更主动。'
          : 'UW 混合，暂不提供明确方向。';

  return {
    source: 'uw',
    status,
    flow_bias,
    institutional_entry,
    darkpool_bias,
    volatility_light,
    market_tide,
    dealer_crosscheck,
    plain_chinese
  };
}
