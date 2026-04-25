function buildUnavailableConclusion(status, reason) {
  return {
    source: 'uw',
    status,
    flow_bias: 'unavailable',
    institutional_entry: 'unavailable',
    darkpool_bias: 'unavailable',
    volatility_light: 'unavailable',
    market_tide: 'unavailable',
    dealer_crosscheck: 'unavailable',
    plain_chinese: reason
  };
}

export function runUwConclusionEngine({ normalized }) {
  const uw = normalized?.uw || null;
  const status = String(uw?.status || 'unavailable').toLowerCase();

  if (status === 'unavailable') {
    return buildUnavailableConclusion('unavailable', 'UW 不可用，当前无法确认机构 Flow / Dark Pool / 波动配合。');
  }

  if (status === 'stale') {
    return buildUnavailableConclusion('stale', 'UW 已 stale，只能观察，不可执行。');
  }

  if (status === 'error') {
    return buildUnavailableConclusion('error', 'UW 读取异常，当前不可用于执行判断。');
  }

  const flow_bias = uw?.flow?.flow_bias || 'unavailable';
  const institutional_entry = uw?.flow?.institutional_entry || 'unavailable';
  const darkpool_bias = uw?.darkpool?.darkpool_bias || 'unavailable';
  const volatility_light = uw?.volatility?.volatility_light || 'unavailable';
  const market_tide = uw?.sentiment?.market_tide || 'unavailable';
  const dealer_crosscheck = uw?.dealer_crosscheck?.state || 'unavailable';

  const plain_chinese =
    status === 'partial'
      ? 'UW 部分可读，只展示已读字段，不可放行执行。'
      : flow_bias === 'bullish'
        ? 'UW 偏多，机构 Flow 与市场情绪支持多头观察。'
        : flow_bias === 'bearish'
          ? 'UW 偏空，机构 Flow 与市场情绪支持空头观察。'
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
