import { ACTIONS } from '../../../packages/shared/src/action-enum.js';

const AVOID_TEXT = Object.freeze({
  chasing: '不追高',
  early_iron_condor: '不提前铁鹰',
  naked_sell: '不裸卖',
  middle_zone_countertrend: '不在中间区域逆势抢单',
  short_vol_before_event: '事件前不卖波动率',
  trade_on_stale_data: '不用陈旧数据下判断'
});

function marketStatusText({ normalized, marketRegime, priceStructure, eventRisk, conflict, stale_flags }) {
  if (stale_flags.any_stale) {
    return '关键数据已经过期，这一轮判断只可参考，不能直接执行。';
  }

  if (eventRisk.risk_gate === 'blocked') {
    return '事件风险压在头上，哪怕结构不坏，也先不要做卖波动率和提前布局。';
  }

  if (conflict.theta_tv_conflict || conflict.conflict_level === 'high') {
    return '期权定位和价格结构没有站到同一边，当前最合理的是观望。';
  }

  if (marketRegime.market_state === 'negative_gamma_expand') {
    return '负 Gamma 下价格更容易扩张，先等回踩稳定而不是追着波动跑。';
  }

  if (marketRegime.market_state === 'flip_chop') {
    return '价格贴着关键翻转位来回拉扯，方向胜率不够高。';
  }

  if (priceStructure.price_signal === 'long_pullback_ready') {
    return '价格突破后仍在高位，暂不追，等回踩不破再考虑多。';
  }

  if (priceStructure.price_signal === 'short_retest_ready') {
    return '价格跌破后若反抽不过关键位，才考虑按计划偏空。';
  }

  if (normalized.gamma_regime === 'positive') {
    return '正 Gamma 让波动相对收敛，优先等结构与波动率同时配合。';
  }

  return '当前没有足够优势，先观察。';
}

function dealerBehaviorText({ uwFlow, normalized }) {
  if (normalized.uw_dealer_bias === 'supportive' || normalized.uw_dealer_bias === 'stabilizing') {
    return '主力偏承接，回落更容易被接住，但仍需价格确认。';
  }

  if (normalized.uw_dealer_bias === 'defensive') {
    return '主力更偏防守，追价容易吃到反向波动。';
  }

  return uwFlow.dealer_behavior;
}

function userActionText({ recommended_action, conflict, stale_flags, priceStructure }) {
  if (stale_flags.any_stale) {
    return '先停手，等数据恢复新鲜后再看。';
  }

  if (conflict.theta_tv_conflict || conflict.conflict_level === 'high') {
    return '逻辑冲突，观望';
  }

  if (recommended_action === ACTIONS.NO_TRADE) {
    return '现在不交易，先解决数据质量问题。';
  }
  if (recommended_action === ACTIONS.INCOME_OK) {
    return '可以小心观察收入型策略，但只在波动继续回落时考虑。';
  }
  if (recommended_action === ACTIONS.LONG_ON_PULLBACK) {
    return '等回踩不破再多，不追涨。';
  }
  if (recommended_action === ACTIONS.SHORT_ON_RETEST) {
    return '等反抽受阻再空，不提前下手。';
  }
  if (recommended_action === ACTIONS.WAIT && priceStructure.confirmation_status === 'confirmed') {
    return '指挥部环境已形成，但仍只允许等待 TV 哨兵触发后的执行计划。';
  }
  if (priceStructure.confirmation_status !== 'confirmed') {
    return '结构还没确认，先等价格把方向走出来。';
  }

  return '先观察，别急着进场。';
}

export function runPlainLanguageEngine({ recommended_action, conflict, stale_flags, engines }) {
  const avoidText = engines.action.avoid_actions
    .map((item) => AVOID_TEXT[item])
    .filter(Boolean);

  return {
    market_status: marketStatusText({
      normalized: engines.normalized,
      marketRegime: engines.marketRegime,
      priceStructure: engines.priceStructure,
      eventRisk: engines.eventRisk,
      conflict,
      stale_flags
    }),
    dealer_behavior: dealerBehaviorText({
      uwFlow: engines.uwFlow,
      normalized: engines.normalized
    }),
    user_action: userActionText({
      recommended_action,
      conflict,
      stale_flags,
      priceStructure: engines.priceStructure
    }),
    avoid: avoidText.length > 0
      ? `${Array.from(new Set(avoidText)).join('；')}。`
      : '当前没有额外禁做事项。',
    invalidation: engines.action.invalidation_level
  };
}
