export function buildFlowAggressionLayer({ uwConclusion = {}, flow = {} } = {}) {
  return {
    status: uwConclusion.flow_available ? 'live' : flow.net_premium_5m != null ? 'partial' : 'unavailable',
    bias: uwConclusion.flow_bias === 'unavailable' ? 'mixed' : uwConclusion.flow_bias,
    aggression: (flow.call_put_ratio != null && isFinite(flow.call_put_ratio)) ? (flow.call_put_ratio > 1.25 ? 'ask_side_attack' : flow.call_put_ratio < 0.8 ? 'bid_side_attack' : 'unknown') : 'unknown',
    net_premium: flow.net_premium_5m ?? null,
    ask_side_pct: null,
    bid_side_pct: null,
    large_trade_count: flow.large_trade_count_5m ?? null,
    confidence: uwConclusion.flow_available ? 'high' : 'low',
    usable_for_analysis: true,
    usable_for_operation: false,
    supports_bullish: uwConclusion.flow_bias === 'bullish',
    supports_bearish: uwConclusion.flow_bias === 'bearish',
    blocks_operation: !uwConclusion.flow_available,
    summary_cn: uwConclusion.flow_available ? `UW Flow ${uwConclusion.flow_bias}。` : 'UW Flow 不足，只做候选参考。',
    evidence_cn: [],
    missing_fields: uwConclusion.flow_available ? [] : ['ask_side_pct', 'bid_side_pct', 'RepeatedHits', '0DTE flow'],
    current_block: uwConclusion.flow_available ? '' : 'Flow aggression 字段未完整晋升。',
    next_fix: uwConclusion.flow_available ? '' : '映射 ask/bid/mid、RepeatedHits、0DTE、多腿比例。',
    plain_chinese: uwConclusion.flow_available ? `UW Flow ${uwConclusion.flow_bias}。` : 'UW Flow 不足，只做候选参考。'
  };
}
