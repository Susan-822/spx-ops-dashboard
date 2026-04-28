export function buildDarkpoolLayer({ uwConclusion = {}, darkpoolSummary = {} } = {}) {
  const status = ['bullish', 'bearish', 'neutral'].includes(uwConclusion.darkpool_bias) ? 'live' : 'unavailable';
  const bias = darkpoolSummary.bias || uwConclusion.darkpool_bias || 'unknown';
  const largePrints = darkpoolSummary.large_levels || [];
  const confidence = darkpoolSummary.bias && darkpoolSummary.bias !== 'unknown' ? 'medium' : 'low';
  const summary = darkpoolSummary.plain_chinese || '暗池中性或不可用。';
  return {
    status,
    bias,
    large_prints: largePrints,
    nearest_support: darkpoolSummary.nearest_support ?? null,
    nearest_resistance: darkpoolSummary.nearest_resistance ?? null,
    confidence,
    score: null,
    usable_for_analysis: status !== 'unavailable',
    usable_for_operation: false,
    supports_bullish: bias === 'support' || bias === 'bullish',
    supports_bearish: bias === 'resistance' || bias === 'bearish',
    blocks_operation: false,
    summary_cn: summary,
    evidence_cn: largePrints.slice(0, 3).map((item) => `暗池 ${item.price ?? '--'} / ${item.premium ?? '--'}`),
    missing_fields: status === 'unavailable' ? ['large_prints'] : [],
    current_block: status === 'unavailable' ? '暗池不可用于支撑压力判断。' : '',
    next_fix: status === 'unavailable' ? '聚合 premium > $1M prints。' : '',
    plain_chinese: summary
  };
}
