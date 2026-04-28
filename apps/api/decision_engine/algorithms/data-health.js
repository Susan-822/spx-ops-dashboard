export function buildDataHealthConclusion({ sourceDisplay = {} } = {}) {
  const values = Object.values(sourceDisplay || {});
  const hasMock = values.some((source) => source.status === 'mock');
  const hasError = values.some((source) => source.status === 'error');
  const hasLive = values.some((source) => source.status === 'live');
  const hasPartial = values.some((source) => source.status === 'partial');
  const status = hasMock || hasError ? 'partial' : hasLive && hasPartial ? 'partial' : hasLive ? 'live' : 'unavailable';

  return {
    status,
    bias: 'unknown',
    confidence: hasLive ? 'medium' : 'low',
    score: null,
    usable_for_analysis: hasLive || hasPartial,
    usable_for_operation: false,
    supports_bullish: false,
    supports_bearish: false,
    blocks_operation: hasMock || hasError,
    summary_cn: hasMock ? '数据质量：检测到 mock 源，禁止操作。' : '数据质量：部分数据可用于分析。',
    evidence_cn: values.map((source) => `${source.status}:${source.reason || ''}`).filter(Boolean),
    missing_fields: [],
    current_block: hasMock ? 'mock source' : '',
    next_fix: '结构化每一层 missing_fields。'
  };
}
