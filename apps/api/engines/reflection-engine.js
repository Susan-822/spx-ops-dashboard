function addIf(collection, condition, value) {
  if (condition) collection.push(value);
}

export function runReflectionEngine({
  uwProvider = {},
  dealerEngine = {},
  institutionalAlert = {},
  volatilityActivation = {},
  marketSentiment = {},
  darkpoolSummary = {},
  commandCenter = {},
  uwFactors = {},
  signal = {}
} = {}) {
  const why = [commandCenter.main_reason || '等待更多输入确认。'];
  const supporting = [];
  const conflicting = [];
  const missing = [];
  const invalidation = [];

  addIf(supporting, uwProvider.status === 'live', `UW API live: ${uwProvider.endpoints_ok?.join(', ') || 'core endpoints ok'}`);
  addIf(supporting, dealerEngine.status === 'live', `Dealer regime ${dealerEngine.regime}, path ${dealerEngine.path_of_least_resistance}`);
  addIf(supporting, institutionalAlert.state !== 'unavailable' && institutionalAlert.state !== 'none', `Institutional ${institutionalAlert.state} ${institutionalAlert.direction}`);
  addIf(supporting, darkpoolSummary.bias !== 'unavailable', `Dark pool ${darkpoolSummary.bias}`);
  addIf(supporting, marketSentiment.state !== 'unavailable', `Sentiment ${marketSentiment.state}`);

  addIf(conflicting, signal?.flow_price_divergence?.action === 'wait', signal?.flow_price_divergence?.plain_chinese || 'Flow 与价格背离。');
  addIf(conflicting, signal?.conflict_resolver?.action === 'block', signal?.conflict_resolver?.plain_chinese || 'Data conflict blocks execution.');
  addIf(conflicting, institutionalAlert.direction === 'bullish' && signal?.tv_sentinel?.direction === 'bearish', 'Flow bullish 但 TV bearish。');
  addIf(conflicting, institutionalAlert.direction === 'bearish' && signal?.tv_sentinel?.direction === 'bullish', 'Flow bearish 但 TV bullish。');

  addIf(missing, uwProvider.status !== 'live', `UW ${uwProvider.status || 'unavailable'}`);
  addIf(missing, dealerEngine.status !== 'live', 'UW dealer factors incomplete');
  addIf(missing, signal?.dealer_conclusion?.status !== 'live', 'Theta dealer 主源未 live');
  addIf(missing, signal?.tv_sentinel?.matched_allowed_setup !== true, 'TV matched setup missing');
  addIf(missing, !signal?.trade_plan?.entry_zone || signal.trade_plan.entry_zone.text === '--', 'entry missing');
  addIf(missing, !signal?.trade_plan?.stop_loss || signal.trade_plan.stop_loss.text === '--', 'stop missing');
  addIf(missing, !Array.isArray(signal?.trade_plan?.targets) || signal.trade_plan.targets.every((target) => target.level == null), 'target missing');
  addIf(missing, !signal?.trade_plan?.invalidation || signal.trade_plan.invalidation.text === '--', 'invalidation missing');

  invalidation.push('TV 结构 stale 或反向 invalidated。');
  invalidation.push('Flow 与价格方向背离扩大。');
  invalidation.push('Theta / UW / FMP 任一核心源进入 error 或 stale。');
  invalidation.push('入场、止损、目标、作废任一硬字段缺失。');

  return {
    why_this_conclusion: why,
    supporting_evidence: supporting,
    conflicting_evidence: conflicting,
    missing_inputs: [...new Set(missing)],
    invalidation_triggers: invalidation,
    confidence_score: commandCenter.confidence_score ?? 0,
    plain_chinese:
      commandCenter.final_state === 'actionable'
        ? '反射结论：核心证据支持执行，但仍需失效条件约束。'
        : `反射结论：${commandCenter.action || '等确认'}，缺口：${[...new Set(missing)].join('；') || '无' }。`
  };
}
