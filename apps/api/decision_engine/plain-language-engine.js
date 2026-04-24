import { ACTIONS } from '../../../packages/shared/src/action-enum.js';

export function runPlainLanguageEngine({ recommended_action, conflict, stale_flags, engines }) {
  if (stale_flags.any_stale) {
    return {
      market_status: '关键数据存在过期，当前判断不可直接执行。',
      dealer_behavior: engines.uwFlow.dealer_behavior,
      user_action: '数据过期，暂不交易。',
      avoid: '避免依据过期数据做任何入场或卖波动率动作。',
      invalidation: engines.action.invalidation_level
    };
  }

  if (conflict.theta_tv_conflict || conflict.conflict_level === 'high') {
    return {
      market_status: '期权与结构信号互相冲突，当前环境不适合下注。',
      dealer_behavior: engines.uwFlow.dealer_behavior,
      user_action: '逻辑冲突，观望',
      avoid: '避免抢方向，先等冲突下降。',
      invalidation: engines.action.invalidation_level
    };
  }

  let user_action = '继续等待。';
  if (recommended_action === ACTIONS.NO_TRADE) {
    user_action = '不交易，先修复数据质量问题。';
  } else if (recommended_action === ACTIONS.INCOME_OK) {
    user_action = '可以观察 income_ok，但仍要控制尺寸。';
  } else if (recommended_action === ACTIONS.LONG_ON_PULLBACK) {
    user_action = '只在回踩确认后考虑做多，不追高。';
  } else if (recommended_action === ACTIONS.SHORT_ON_RETEST) {
    user_action = '只在反抽确认后考虑做空，不追空。';
  }

  return {
    market_status: `当前市场状态为 ${engines.marketRegime.market_state}，Gamma 偏向 ${engines.normalized.gamma_regime}。`,
    dealer_behavior: engines.uwFlow.dealer_behavior,
    user_action,
    avoid: engines.action.avoid_actions.length > 0 ? `避免：${engines.action.avoid_actions.join(' / ')}` : '暂无额外禁做事项。',
    invalidation: engines.action.invalidation_level
  };
}
