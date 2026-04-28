export function synthesizeUwLayers(layers = {}) {
  const values = Object.values(layers).filter(Boolean);
  const blocksOperation = values.some((item) => item.blocks_operation === true);
  const supportsBullish = values.filter((item) => item.supports_bullish === true).length;
  const supportsBearish = values.filter((item) => item.supports_bearish === true).length;
  const missing = values.flatMap((item) => item.missing_fields || []);

  return {
    status: blocksOperation ? 'partial' : 'live',
    bias: supportsBullish > supportsBearish ? 'bullish' : supportsBearish > supportsBullish ? 'bearish' : 'mixed',
    confidence: values.some((item) => item.confidence === 'low') ? 'low' : 'medium',
    score: supportsBullish - supportsBearish,
    usable_for_analysis: values.some((item) => item.usable_for_analysis),
    usable_for_operation: !blocksOperation && values.every((item) => item.usable_for_operation),
    supports_bullish: supportsBullish > supportsBearish,
    supports_bearish: supportsBearish > supportsBullish,
    blocks_operation: blocksOperation,
    summary_cn: blocksOperation ? 'UW 六层存在操作卡阻断项，只能用于分析。' : 'UW 六层暂无硬阻断。',
    evidence_cn: values.map((item) => item.summary_cn).filter(Boolean),
    missing_fields: [...new Set(missing)],
    current_block: blocksOperation ? values.find((item) => item.blocks_operation)?.current_block || '存在阻断项' : '',
    next_fix: missing.length > 0 ? '优先补齐缺失字段映射。' : ''
  };
}
