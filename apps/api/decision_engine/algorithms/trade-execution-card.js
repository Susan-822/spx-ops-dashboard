export function buildTradeExecutionCard({
  dealer_wall_map = {},
  darkpool_gravity = {},
  flow_conflict = {},
  volatility_state = {},
  sentiment_state = {},
  operation_layer = {},
  price_trigger = {},
  news_radar = {},
  wall_zone_panel = {},
  control_side = {}
} = {}) {
  const ready = operation_layer.status === 'ready';
  const direction = ['MIXED', 'BULL_DEFENSE'].includes(control_side.side) ? 'CALL_WATCH' : control_side.side === 'BEAR_CONTROL' ? 'PUT_WATCH' : 'NONE';
  const directionCn = direction === 'CALL_WATCH' ? '回踩多头观察' : direction === 'PUT_WATCH' ? '重新评估 Put' : '震荡等待';
  const nextPrice = price_trigger.key_level ?? flow_conflict.next_price_to_watch ?? darkpool_gravity.mapped_spx ?? dealer_wall_map.lower_barrier ?? '--';
  const hasDealerWalls = dealer_wall_map.call_wall != null || dealer_wall_map.put_wall != null || dealer_wall_map.gamma_flip != null;
  const headline = control_side.side === 'BEAR_CONTROL'
    ? '空头控盘增强，等待价格触发后评估 Put。'
    : control_side.side === 'BULL_CONTROL'
      ? '多头控盘增强，等待回踩确认后评估 Call。'
      : ['MIXED', 'BULL_DEFENSE'].includes(control_side.side)
        ? '有 Put 看空线索，但下方 7150 有承接防守，当前不是追空环境。'
        : hasDealerWalls
          ? '当前不是追空环境，价格可能被下方暗池减速区和上方 Gamma 墙夹住。'
          : '下方暗池减速区限制追空，Dealer 墙位尚未生成。';
  const doNot = [
    `不在 ${nextPrice} 上方追 Put。`,
    '不根据单一 Put RepeatedHits 开空。',
    '不在没有入场、止损、TP 时下单。'
  ];
  if (news_radar.news_risk === 'high') doNot.push('新闻风险偏高，不做无计划追单。');
  return {
    status: ready ? 'READY' : 'WAIT',
    status_cn: ready ? '可执行' : '等确认',
    direction,
    direction_cn: directionCn,
    can_trade: ready,
    safety_lock: !ready,
    upper_barrier: dealer_wall_map.call_wall ?? null,
    lower_barrier: dealer_wall_map.put_wall ?? null,
    gamma_flip: dealer_wall_map.gamma_flip ?? null,
    nearest_wall_distance: dealer_wall_map.nearest_wall_distance_pct ?? null,
    flow_state_cn: flow_conflict.flow_state_cn || '资金线索不足',
    prohibit_direction: flow_conflict.prohibit_direction || null,
    next_price_to_watch: nextPrice,
    headline_cn: headline,
    action_cn: price_trigger.next_action_cn || control_side.action_cn || `禁止追 Put；等 ${nextPrice} 附近回踩反应。`,
    why_cn: [
      'Put RepeatedHits 说明空头资金有动作。',
      darkpool_gravity.state === 'lower_brake_zone'
        ? `但下方 ${darkpool_gravity.mapped_spx ?? '--'} 附近存在暗池减速区，距离现价很近，追空容易撞墙。`
        : '但暗池减速区和 Dealer 墙位还需要继续确认。',
      'Dealer 已把 GEX 数据压缩成墙位和 Flip，用于判断震荡还是放波。',
      dealer_wall_map.summary_cn || '当前更像墙位夹击，不是明确单边发车环境。'
    ],
    wait_for_cn: [
      price_trigger.next_action_cn || `等价格回踩 ${nextPrice} 附近后的反应。`,
      price_trigger.bullish_condition_cn || `如果 ${nextPrice} 吸收并反弹，再观察 Call 候选。`,
      price_trigger.bearish_condition_cn || `如果 ${nextPrice} 放量跌破并确认，再重新评估 Put。`,
      '等 Flow 继续同向并完成 0DTE / 多腿过滤。'
    ],
    do_not_cn: doNot,
    trade: {
      instrument: '--',
      entry: ready ? operation_layer.entry || '--' : '--',
      stop: ready ? operation_layer.stop || '--' : '--',
      tp1: ready ? operation_layer.tp1 || '--' : '--',
      tp2: ready ? operation_layer.tp2 || '--' : '--',
      invalid: ready ? operation_layer.invalid || '--' : '--'
    },
    dealer_wall_map,
    darkpool_gravity,
    flow_conflict,
    volatility_state,
    sentiment_state,
    price_trigger,
    news_radar,
    wall_zone_panel,
    control_side
  };
}
