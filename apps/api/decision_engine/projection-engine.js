function safeText(value, fallback = '--') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function buildUwSafeSummary(uwConclusion = {}) {
  return [
    `状态 ${safeText(uwConclusion.status, 'unavailable')}`,
    `Flow ${safeText(uwConclusion.flow_bias, 'unavailable')}`,
    `机构 ${safeText(uwConclusion.institutional_entry, 'unavailable')}`,
    `波动 ${safeText(uwConclusion.volatility_light, 'unavailable')}`,
    `Dark Pool ${safeText(uwConclusion.darkpool_bias, 'unavailable')}`,
    `Dealer ${safeText(uwConclusion.dealer_crosscheck, 'unavailable')}`
  ].join('；');
}

function buildCompactRealtimeAnalysis({
  dataSources = {},
  degradation = {},
  flowPriceDivergence = {},
  volumePressure = {},
  channelShape = {},
  volatilityActivation = {},
  dealerConclusion = {},
  uwConclusion = {},
  uwDealerGreeks = {},
  tvSentinel = {},
  tradePlan = {}
}) {
  const expectedMove = dealerConclusion.expected_move_lower != null && dealerConclusion.expected_move_upper != null
    ? `${dealerConclusion.expected_move_lower} - ${dealerConclusion.expected_move_upper}`
    : '--';
  const usable = [
    dataSources?.fmp?.status === 'real' ? 'FMP 现价真实' : null,
    dealerConclusion.expected_move_upper != null ? 'Expected Move 可展示' : null
  ].filter(Boolean).slice(0, 2);
  const limits = [
    dealerConclusion.status !== 'live' ? 'UW Dealer 主数据未完整确认，方向计划等待 final_decision' : null,
    uwConclusion.status !== 'live' ? 'UW 资金行为不可用或不可执行' : null,
    tvSentinel.matched_allowed_setup !== true ? 'TV 未确认结构' : null,
    flowPriceDivergence.action !== 'allow' ? flowPriceDivergence.plain_chinese : null
  ].filter(Boolean).slice(0, 3);

  return [
    `【数据状态】${dataSources?.summary?.health === 'red' ? '🔴' : dataSources?.summary?.health === 'yellow' ? '🟡' : '🟢'} ${dataSources?.summary?.label || 'BLOCKED'}`,
    `FMP：${dataSources?.fmp?.status || 'unavailable'} · ${dataSources?.fmp?.age_label || 'unavailable'}`,
    `ThetaData：${dataSources?.theta?.status || 'unavailable'}，Gamma ${dataSources?.theta?.gamma_status || 'unavailable'}`,
    `UW：${dataSources?.uw?.status || 'unavailable'}`,
    `TV：${dataSources?.tv?.status || 'waiting'}`,
    '',
    '【交互判断】',
    `✓ 可用项：${usable.join('；') || '--'}`,
    `✗ 限制项：${limits.join('；') || '--'}`,
    `→ 冲突：${flowPriceDivergence.state && flowPriceDivergence.state !== 'none' ? flowPriceDivergence.plain_chinese : '无真实价格冲突，但关键源不完整'}`,
    `→ 降级方案：${degradation.plain_chinese || '不可降级，全部禁止'}`,
    '',
    `【结论】${tradePlan.direction_label || '禁做 / 等确认'}`,
    `【原因】${tradePlan.plain_chinese || degradation.reason || '缺 Dealer 路径 + 资金验证 + 结构确认'}`,
    `【我现在该做什么】${tradePlan.wait_conditions?.[0]?.text || tradePlan.plain_chinese || '不追单，等 TV 结构确认。'}`,
    '',
    '【TV哨兵】',
    `状态：${tvSentinel.status || 'waiting'}`,
    `等待：${tvSentinel.waiting_for?.[0]?.text || tradePlan.wait_conditions?.[0]?.text || '等待 TV 结构信号，不提前交易。'}`,
    `已等待：${tvSentinel.wait_time_elapsed_min ?? '--'}分钟 / TTL ${tvSentinel.wait_ttl_min ?? '--'}分钟`,
    `是否确认：${tvSentinel.matched_allowed_setup === true ? 'YES' : 'NO'}`,
    '',
    `Expected Move：${expectedMove}`,
    `量比：${volumePressure.level || 'unavailable'}`,
    `通道：${channelShape.shape || 'unavailable'}`,
    `波动：${volatilityActivation.state || 'unavailable'}`,
    `UW Greek：${uwDealerGreeks.status || 'unavailable'}`
  ].join('\n');
}

export function buildProjectionEngine({
  fmpConclusion,
  dealerConclusion,
  uwConclusion,
  commandEnvironment,
  tvSentinel,
  tradePlan,
  dataHealth,
  conflictResolver,
  dataSources,
  degradation,
  flowPriceDivergence,
  volumePressure,
  channelShape,
  volatilityActivation,
  uwDealerGreeks,
  tvSentinel: sLevelTvSentinel,
  tradePlan: sLevelTradePlan
}) {
  const premarket = [
    `FMP：${safeText(fmpConclusion?.plain_chinese, '市场快照待确认。')}`,
    `Dealer：${safeText(dealerConclusion?.plain_chinese, 'Dealer 地图待确认。')}`,
    `UW：${buildUwSafeSummary(uwConclusion)}`,
    `指挥部：${safeText(commandEnvironment?.plain_chinese, '底层环境待确认。')}`
  ].join(' ');

  const intraday = [
    `指挥部：${safeText(commandEnvironment?.plain_chinese, '底层环境待确认。')}`,
    `哨兵：${safeText(tvSentinel?.plain_chinese, 'TV 条件待确认。')}`,
    `计划：${safeText(tradePlan?.plain_chinese, '暂无可执行计划。')}`
  ].join(' ');

  const breaking = [
    `数据：${safeText(dataHealth?.summary, '数据状态待确认。')}`,
    `冲突：${safeText(conflictResolver?.plain_chinese, '暂无明显冲突。')}`,
    `哨兵：${safeText(tvSentinel?.plain_chinese, 'TV 状态待确认。')}`
  ].join(' ');

  const tradePlanSummary = [
    `指挥部：${safeText(commandEnvironment?.plain_chinese, '底层环境待确认。')}`,
    `哨兵：${safeText(tvSentinel?.plain_chinese, 'TV 条件待确认。')}`,
    `交易计划：${safeText(tradePlan?.plain_chinese, '暂无交易计划。')}`
  ].join(' ');

  return {
    dealer_summary: {
      status: safeText(dealerConclusion?.status, 'unavailable'),
      text: safeText(dealerConclusion?.plain_chinese, 'Theta dealer unavailable.'),
      gamma_regime: dealerConclusion?.gamma_regime ?? 'unknown',
      dealer_behavior: dealerConclusion?.dealer_behavior ?? 'unknown',
      least_resistance_path: dealerConclusion?.least_resistance_path ?? 'unknown',
      call_wall: dealerConclusion?.call_wall ?? null,
      put_wall: dealerConclusion?.put_wall ?? null,
      max_pain: dealerConclusion?.max_pain ?? null,
      zero_gamma: dealerConclusion?.zero_gamma ?? null,
      expected_move_upper: dealerConclusion?.expected_move_upper ?? null,
      expected_move_lower: dealerConclusion?.expected_move_lower ?? null
    },
    premarket_summary: premarket,
    intraday_summary: intraday,
    breaking_summary: breaking,
    trade_plan_summary: tradePlanSummary
    ,
    realtime_analysis: buildCompactRealtimeAnalysis({
      dataSources,
      degradation,
      flowPriceDivergence,
      volumePressure,
      channelShape,
      volatilityActivation,
      dealerConclusion,
      uwConclusion,
      uwDealerGreeks,
      tvSentinel: sLevelTvSentinel || tvSentinel,
      tradePlan: sLevelTradePlan || tradePlan
    })
  };
}
