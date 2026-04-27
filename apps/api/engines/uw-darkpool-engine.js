export function runUwDarkpoolEngine({ darkpoolFactors = {}, provider = {} } = {}) {
  if (!['live', 'partial', 'stale'].includes(provider.status)) {
    return {
      bias: 'unavailable',
      nearest_support: null,
      nearest_resistance: null,
      plain_chinese: 'Dark Pool 数据不可用。'
    };
  }

  return {
    bias: darkpoolFactors.darkpool_bias === 'unknown' ? 'neutral' : darkpoolFactors.darkpool_bias || 'unavailable',
    nearest_support: darkpoolFactors.nearest_support ?? null,
    nearest_resistance: darkpoolFactors.nearest_resistance ?? null,
    plain_chinese:
      darkpoolFactors.darkpool_bias === 'support'
        ? '暗池下方承接更近，追空需降权。'
        : darkpoolFactors.darkpool_bias === 'resistance'
          ? '暗池上方压力更近，追多需降权。'
          : '暗池未给出明确支撑/压力偏向。'
  };
}
