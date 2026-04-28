import { numberOrNull } from './safe-number.js';

export function buildFlowConflict({ flow = {}, dealer_wall_map = {}, darkpool_gravity = {}, spot_price = null } = {}) {
  const contractType = String(flow.contract_type || '').toLowerCase();
  const alertRule = String(flow.alert_rule || '');
  const askPremium = numberOrNull(flow.ask_side_premium ?? flow.total_premium);
  const tradeCount = numberOrNull(flow.trade_count);
  const bearishHits = contractType === 'put' && (askPremium ?? 0) > 0 && /repeated/i.test(alertRule || 'RepeatedHits');
  const flowState = bearishHits ? 'bearish_hits' : 'unknown';
  const lowerBarrier = numberOrNull(dealer_wall_map.lower_barrier);
  const spot = numberOrNull(spot_price ?? dealer_wall_map.spot_price);
  let flowWallState = 'low_confidence_stalling_or_unknown';
  let flowWallStateCn = '低置信：撞墙或未知';
  let conflictCn = 'Put Flow 有动作，但缺 fill sequence，不能判定顺墙击穿。';
  let prohibitDirection = bearishHits ? 'PUT' : '--';
  let prohibitCn = bearishHits ? '禁止追 Put。' : '不根据单一 Flow 信号开仓。';

  if (bearishHits && darkpool_gravity.state === 'lower_brake_zone' && (darkpool_gravity.distance_pct ?? 999) <= 0.5) {
    flowWallState = 'stalling';
    flowWallStateCn = '撞墙';
    conflictCn = 'Put 扫单偏空，但下方暗池减速区距离太近，空头动能可能被吸收。';
    prohibitDirection = 'PUT';
    prohibitCn = '禁止追 Put。';
  } else if (bearishHits && spot != null && lowerBarrier != null && spot < lowerBarrier && flow.fill_sequence_confirmed === true) {
    flowWallState = 'following';
    flowWallStateCn = '顺墙';
    conflictCn = 'Put Flow 击穿下方墙，空头动能增强。';
    prohibitDirection = 'CALL';
    prohibitCn = '禁止抄底 Call。';
  }

  return {
    flow_state: flowState,
    flow_state_cn: bearishHits ? 'Put RepeatedHits，空头资金有动作。' : 'Flow 方向未确认。',
    ask_side_premium: askPremium,
    trade_count: tradeCount,
    flow_wall_state: flowWallState,
    flow_wall_state_cn: flowWallStateCn,
    conflict_cn: conflictCn,
    prohibit_direction: prohibitDirection,
    prohibit_cn: prohibitCn,
    next_price_to_watch: darkpool_gravity.mapped_spx ?? dealer_wall_map.lower_barrier ?? null,
    next_reaction_cn: darkpool_gravity.state === 'lower_brake_zone'
      ? '观察减速区是否吸收反弹，或放量跌破后再评估 Put。'
      : '等待价格靠近 Dealer 墙位或暗池减速区后的反应。'
  };
}
