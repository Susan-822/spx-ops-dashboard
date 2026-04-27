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
  signal = {},
  crossAssetProjection = {}
} = {}) {
  const why = [commandCenter.main_reason || '等待更多输入确认。'];
  const supporting = [];
  const conflicting = [];
  const missing = [];
  const invalidation = [];

  addIf(supporting, uwProvider.status === 'live', `UW API live: ${uwProvider.endpoints_ok?.join(', ') || 'core endpoints ok'}`);
  addIf(supporting, dealerEngine.status === 'live', `Dealer regime ${dealerEngine.regime}, path ${dealerEngine.path_of_least_resistance}`);
  addIf(supporting, dealerEngine.status === 'partial', `UW Dealer partial: wall data ${dealerEngine.upper_wall ?? '--'} / ${dealerEngine.lower_wall ?? '--'}`);
  addIf(supporting, institutionalAlert.state !== 'unavailable' && institutionalAlert.state !== 'none', `Institutional ${institutionalAlert.state} ${institutionalAlert.direction}`);
  addIf(supporting, darkpoolSummary.bias !== 'unavailable', `Dark pool ${darkpoolSummary.bias}`);
  addIf(supporting, marketSentiment.state !== 'unavailable', `Sentiment ${marketSentiment.state}`);
  const zeroGammaProjection = crossAssetProjection?.projected_levels?.find((item) => item.type === 'zero_gamma' && item.es_equiv != null);
  const callWallProjection = crossAssetProjection?.projected_levels?.find((item) => item.type === 'call_wall' && item.es_equiv != null);
  addIf(supporting, Boolean(zeroGammaProjection), `SPX Zero Gamma ${zeroGammaProjection?.spx} 对应 ES ${zeroGammaProjection?.es_equiv}。`);

  addIf(conflicting, signal?.flow_validation?.conflict === true, signal?.flow_validation?.plain_chinese || 'Flow validation conflict.');
  const legacyPriceMapConflict = /price_map_conflict|价格地图冲突|mock/i.test(
    `${signal?.conflict_resolver?.plain_chinese || ''} ${(signal?.conflict_resolver?.conflicts || []).join(' ')}`
  );
  addIf(
    conflicting,
    signal?.conflict_resolver?.action === 'block' && !(signal?.uw_price_map_active && legacyPriceMapConflict),
    signal?.conflict_resolver?.plain_chinese || 'Data conflict blocks execution.'
  );
  addIf(conflicting, institutionalAlert.direction === 'bullish' && signal?.tv_sentinel?.direction === 'bearish', 'Flow bullish 但 TV bearish。');
  addIf(conflicting, institutionalAlert.direction === 'bearish' && signal?.tv_sentinel?.direction === 'bullish', 'Flow bearish 但 TV bullish。');
  addIf(conflicting, Boolean(callWallProjection), `SPX Call Wall ${callWallProjection?.spx} 对应 ES ${callWallProjection?.es_equiv}，上方空间需降权。`);

  addIf(missing, uwProvider.status !== 'live', `UW ${uwProvider.status || 'unavailable'}`);
  addIf(missing, dealerEngine.status === 'unavailable', 'UW Dealer 因子未进入 conclusion。');
  addIf(missing, dealerEngine.status === 'partial', 'UW Greeks 部分可读，Dealer 置信度降级。');
  addIf(missing, signal?.tv_sentinel?.matched_allowed_setup !== true, 'TV matched setup missing');
  addIf(missing, !signal?.trade_plan?.entry_zone || signal.trade_plan.entry_zone.text === '--', '等待 TV 后生成入场。');
  addIf(missing, !signal?.trade_plan?.stop_loss || signal.trade_plan.stop_loss.text === '--', '等待 TV 后生成止损。');
  addIf(missing, !Array.isArray(signal?.trade_plan?.targets) || signal.trade_plan.targets.every((target) => target.level == null), '等待 TV 后生成目标。');
  addIf(missing, !signal?.trade_plan?.invalidation || signal.trade_plan.invalidation.text === '--', '等待 TV 后生成作废条件。');
  addIf(missing, crossAssetProjection?.status === 'partial', 'ES/SPY live price missing for complete projection');
  addIf(missing, crossAssetProjection?.status === 'unavailable', 'cross asset projection unavailable');

  invalidation.push('TV 结构 stale 或反向 invalidated。');
  invalidation.push('Flow 与价格方向背离扩大。');
  invalidation.push('Theta / UW / FMP 任一核心源进入 error 或 stale。');
  invalidation.push('入场、止损、目标、作废任一硬字段缺失。');
  if (zeroGammaProjection?.es_equiv != null) {
    invalidation.push(`ES 跌破 Zero Gamma 等效价 ${zeroGammaProjection.es_equiv} 并 3m 收不回。`);
  }

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
