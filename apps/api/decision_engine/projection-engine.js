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

export function buildProjectionEngine({
  fmpConclusion,
  dealerConclusion,
  uwConclusion,
  commandEnvironment,
  tvSentinel,
  tradePlan,
  dataHealth,
  conflictResolver
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
    premarket_summary: premarket,
    intraday_summary: intraday,
    breaking_summary: breaking,
    trade_plan_summary: tradePlanSummary
  };
}
