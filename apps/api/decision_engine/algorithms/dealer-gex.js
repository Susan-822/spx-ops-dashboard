export function buildDealerGexConclusion({ uwConclusion = {}, diagnostics = {} } = {}) {
  return {
    status: diagnostics.confidence === 'low' ? 'partial' : uwConclusion.status || 'unavailable',
    bias: uwConclusion.gamma_regime || 'unknown',
    confidence: diagnostics.confidence || 'low',
    score: null,
    usable_for_analysis: uwConclusion.status !== 'unavailable',
    usable_for_operation: diagnostics.confidence !== 'low' && uwConclusion.call_wall != null && uwConclusion.put_wall != null,
    supports_bullish: uwConclusion.gamma_regime === 'negative',
    supports_bearish: uwConclusion.gamma_regime === 'negative',
    blocks_operation: diagnostics.confidence === 'low',
    summary_cn: diagnostics.confidence === 'low' ? 'UW GEX strike 区间低可信，墙位不用于交易。' : 'UW GEX 已进入 Dealer/GEX 引擎。',
    evidence_cn: diagnostics.top_net_gex_strikes || [],
    missing_fields: diagnostics.confidence === 'low' ? ['有效 Call Wall', '有效 Put Wall', 'Gamma Flip'] : [],
    current_block: diagnostics.confidence === 'low' ? '墙位低可信，不能用于目标/止损。' : '',
    next_fix: diagnostics.confidence === 'low' ? '确认正确 ticker 和 strike 区间映射。' : ''
  };
}
