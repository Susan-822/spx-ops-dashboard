function line(label, value) {
  return `${label}：${value == null || value === '' ? '--' : value}`;
}

export function buildCommandProjection({
  fmpConclusion = {},
  externalSpot = {},
  dealerConclusion = {},
  uwConclusion = {},
  uwDealerGreeks = {},
  dealerPath = {},
  volumePressure = {},
  channelShape = {},
  volatilityActivation = {},
  marketSentiment = {},
  institutionalEntryAlert = {},
  tvSentinel = {},
  conflictResolver = {},
  commandEnvironment = {},
  tradePlan = {},
  dataSources = {},
  degradation = {},
  flowPriceDivergence = {}
} = {}) {
  const expectedMove = dealerConclusion.expected_move_upper != null && dealerConclusion.expected_move_lower != null
    ? `${dealerConclusion.expected_move_lower} - ${dealerConclusion.expected_move_upper}`
    : '--';
  const availableItems = [
    externalSpot.status === 'real' ? 'FMP 现价真实' : null,
    fmpConclusion.event_risk === 'normal' ? '事件风险正常' : null,
    expectedMove !== '--' ? 'Expected Move 可展示' : null
  ].filter(Boolean);
  const limits = [
    dealerConclusion.status !== 'live' ? 'ThetaData Gamma 不完整，Dealer 地图不可执行' : null,
    uwConclusion.status !== 'live' ? 'UW 资金行为不可用或不完整' : null,
    uwDealerGreeks.status !== 'live' ? 'UW Greek Exposure 不可用' : null,
    tvSentinel.matched_allowed_setup !== true ? 'TV 未确认结构' : null,
    tradePlan?.stop_loss?.level === 0 || tradePlan?.stop_loss?.text === '--' ? '止损未满足 ready 硬门槛' : null
  ].filter(Boolean);
  const action = tradePlan.status === 'ready' ? tradePlan.title : '禁做 / 等确认';
  const reason = limits.length > 0
    ? limits.slice(0, 3).join('；')
    : tradePlan.plain_chinese || commandEnvironment.reason || '等待价格哨兵。';
  const rawNote = [
    `【数据状态】${dataSources?.summary?.label || 'BLOCKED'}`,
    line('数据健康度', dataSources?.summary?.plain_chinese || '关键源不可执行或存在阻断，禁止交易。'),
    line('FMP', `${dataSources?.fmp?.status || externalSpot.status || 'unavailable'} · ${dataSources?.fmp?.age_label || 'unavailable'}`),
    line('ThetaData', `${dataSources?.theta?.status || dealerConclusion.status || 'unavailable'}${dataSources?.theta?.gamma_status === 'incomplete' ? '，Gamma 不完整' : ''}`),
    line('UW', dataSources?.uw?.status || uwConclusion.status || 'unavailable'),
    line('TV', dataSources?.tv?.status || tvSentinel.status || 'waiting'),
    '',
    '【交互判断】',
    line('✓ 可用项', availableItems.join('；') || '暂无核心可用项'),
    line('✗ 限制项', limits.slice(0, 4).join('；') || '--'),
    line('→ 冲突', (conflictResolver.conflicts || []).join('；') || flowPriceDivergence.plain_chinese || '无真实价格冲突，但关键源不完整'),
    line('→ 降级方案', degradation.plain_chinese || '不可降级，全部禁止'),
    '',
    '【结论】',
    action,
    '',
    '【原因】',
    reason,
    '',
    '【我现在该做什么】',
    tradePlan.wait_conditions?.[0]?.text || '等待 TV 结构信号，不提前交易。'
  ].join('\n');

  return {
    s_level_summary: rawNote,
    raw_note: rawNote,
    one_line_instruction: action,
    radar_sections: {
      total: {
        environment: commandEnvironment.state,
        action: tradePlan.status
      },
      price_channel: {
        fmp_spot: externalSpot,
        volume_pressure: volumePressure,
        channel_shape: channelShape
      },
      volatility: volatilityActivation,
      dealer: {
        theta: dealerConclusion.status,
        dealer_path: dealerPath
      },
      uw: {
        conclusion: uwConclusion,
        dealer_greeks: uwDealerGreeks
      },
      tv_sentinel: tvSentinel,
      conflicts: conflictResolver
    }
  };
}
