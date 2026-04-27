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
  tradePlan = {}
} = {}) {
  const expectedMove = dealerConclusion.expected_move_upper != null && dealerConclusion.expected_move_lower != null
    ? `${dealerConclusion.expected_move_lower} - ${dealerConclusion.expected_move_upper}`
    : '--';
  const missing = [
    dealerConclusion.status !== 'live' ? 'Theta Gamma live' : null,
    uwDealerGreeks.status !== 'live' ? 'UW Greek Exposure live' : null,
    tvSentinel.matched_allowed_setup !== true ? 'TV matched setup' : null
  ].filter(Boolean);

  return {
    s_level_summary: [
      '【总判断】',
      line('环境', commandEnvironment.plain_chinese || commandEnvironment.reason),
      line('动作', tradePlan.plain_chinese || '等待'),
      '',
      '【量价 / 通道】',
      line('FMP spot', `${externalSpot.source || 'unavailable'} ${externalSpot.status || 'unavailable'} ${externalSpot.spot ?? '--'}`),
      line('量比', `${volumePressure.level} / ${volumePressure.rvol ?? '--'}`),
      line('通道形态', channelShape.shape),
      line('推动方向', volumePressure.direction),
      '',
      '【波动】',
      line('Expected Move', expectedMove),
      line('波动状态', volatilityActivation.state),
      line('允许', (volatilityActivation.allow || []).join(', ') || '--'),
      line('禁止', (volatilityActivation.block || []).join(', ') || '--'),
      '',
      '【Dealer】',
      line('ThetaData', dealerConclusion.status),
      line('Gamma', dealerConclusion.gamma_regime),
      line('Call Wall', dealerConclusion.call_wall),
      line('Put Wall', dealerConclusion.put_wall),
      line('Max Pain', dealerConclusion.max_pain),
      line('Zero Gamma', dealerConclusion.zero_gamma),
      line('Dealer Path', dealerPath.path),
      '',
      '【UW】',
      line('Flow', uwConclusion.flow_bias),
      line('Dark Pool', uwConclusion.darkpool_bias),
      line('Market Tide', uwConclusion.market_tide),
      line('Greek Exposure', uwDealerGreeks.status),
      line('Vanna', uwDealerGreeks.net_vanna_bias),
      line('Charm', uwDealerGreeks.net_charm_bias),
      line('Delta', uwDealerGreeks.net_delta_bias),
      line('Dealer cross-check', uwDealerGreeks.dealer_crosscheck),
      '',
      '【TV 哨兵】',
      line('结构', tvSentinel.event_type || tvSentinel.tv_signal),
      line('是否 matched', tvSentinel.matched_allowed_setup === true ? 'YES' : 'NO'),
      '',
      '【冲突】',
      line('缺什么', missing.join(', ') || '--'),
      line('冲突什么', (conflictResolver.conflicts || []).join('；') || '--'),
      line('为什么不能 ready', tradePlan.status === 'ready' ? '--' : tradePlan.plain_chinese || commandEnvironment.reason),
      '',
      '【我现在该做什么】',
      line('一句话指令', tradePlan.status === 'ready' ? tradePlan.title : '禁做 / 等确认')
    ].join('\n'),
    one_line_instruction: tradePlan.status === 'ready' ? tradePlan.title : '禁做 / 等确认',
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
