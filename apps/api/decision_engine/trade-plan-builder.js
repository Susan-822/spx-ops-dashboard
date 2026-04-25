import { ACTIONS } from '../../../packages/shared/src/action-enum.js';

const SETUP_TO_ACTION = Object.freeze({
  A_LONG_PULLBACK: ACTIONS.LONG_ON_PULLBACK,
  A_SHORT_RETEST: ACTIONS.SHORT_ON_RETEST,
  B_IRON_CONDOR: ACTIONS.INCOME_OK
});

function buildPlanName(setupCode) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return 'A 单｜回踩做多';
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return 'A 单｜反抽做空';
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return 'B 单｜区间铁鹰';
  }
  return '未生成交易计划';
}

function buildTriggerText(setupCode, normalized) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return `价格回踩 flip ${normalized.flip_level} 上方并重新企稳。`;
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return `价格反抽不过 call_wall ${normalized.call_wall}。`;
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return `价格继续围绕 max_pain ${normalized.max_pain} 钉住，且波动继续回落。`;
  }
  return '等待新的价格条件。';
}

function buildTargetText(setupCode, normalized) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return `${normalized.max_pain} -> ${normalized.call_wall}`;
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return `${normalized.put_wall} -> ${normalized.max_pain}`;
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return `${normalized.put_wall} - ${normalized.call_wall}`;
  }
  return '未生成目标位。';
}

function buildInvalidationText(setupCode, normalized) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return `回踩跌破 put_wall ${normalized.put_wall}`;
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return `反抽重新站上 call_wall ${normalized.call_wall}`;
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return `IV 不再回落，或价格离开 ${normalized.put_wall} - ${normalized.call_wall} 区间`;
  }
  return `价格重新失守 flip ${normalized.flip_level}`;
}

export function runTradePlanBuilder({ normalized, commandEnvironment, allowedSetups, tradingviewSentinel }) {
  if (!commandEnvironment?.executable) {
    return {
      has_trade_plan: false,
      triggered_by_tv: false,
      plan_family: null,
      setup_code: null,
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'blocked',
      title: '等待指挥部允许',
      trigger_text: '指挥部环境尚未允许执行。',
      target_text: '未生成目标位。',
      invalidation_text: `价格重新失守 flip ${normalized.flip_level}`
    };
  }

  if (!tradingviewSentinel?.triggered) {
    return {
      has_trade_plan: false,
      triggered_by_tv: false,
      plan_family: null,
      setup_code: null,
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'waiting',
      title: '等待 TradingView 哨兵确认',
      trigger_text: tradingviewSentinel?.reason || '价格条件尚未到位。',
      target_text: '未生成目标位。',
      invalidation_text: `价格重新失守 flip ${normalized.flip_level}`
    };
  }

  const setupCode = tradingviewSentinel.setup_code;
  if (!allowedSetups?.permitted_setup_codes?.includes(setupCode)) {
    return {
      has_trade_plan: false,
      triggered_by_tv: true,
      plan_family: null,
      setup_code: null,
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'not_allowed',
      title: '哨兵触发，但当前 setup 未被允许',
      trigger_text: tradingviewSentinel.reason || '价格条件到位，但当前 setup 不在允许集内。',
      target_text: '未生成目标位。',
      invalidation_text: `价格重新失守 flip ${normalized.flip_level}`
    };
  }

  return {
    has_trade_plan: true,
    triggered_by_tv: true,
    plan_family: setupCode.startsWith('A_') ? 'A' : setupCode.startsWith('B_') ? 'B' : null,
    setup_code: setupCode,
    recommended_action: SETUP_TO_ACTION[setupCode] ?? ACTIONS.WAIT,
    trigger_status: 'triggered',
    title: buildPlanName(setupCode),
    trigger_text: buildTriggerText(setupCode, normalized),
    target_text: buildTargetText(setupCode, normalized),
    invalidation_text: buildInvalidationText(setupCode, normalized)
  };
}
