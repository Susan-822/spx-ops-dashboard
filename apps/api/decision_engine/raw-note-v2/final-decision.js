import { evaluateHealthMatrix } from './health-matrix.js';
import { applyVolatilityTree } from './volatility-tree.js';
import { applyTechnicalTree } from './technical-tree.js';
import { applyDealerTree } from './dealer-tree.js';
import { applyFlowTree } from './flow-tree.js';
import { finalizeAllowedSetups } from './allowed-setups-tree.js';
import { applyTvMatchTree } from './tv-match-tree.js';
import { buildTradePlan } from './trade-plan-tree.js';

const LABELS = Object.freeze({
  blocked: '禁做',
  wait: '等确认',
  invalidated: '作废',
  A_long_candidate: 'A多候选',
  B_long_candidate: 'B多候选',
  A_short_candidate: 'A空候选',
  B_short_candidate: 'B空候选',
  iron_condor_observe: '铁鹰观察',
  actionable: '可执行'
});

function baseDecision() {
  return {
    state: 'wait',
    label: '等确认',
    direction: 'unknown',
    reason: '',
    instruction: '等确认，不追单',
    position_multiplier: 0,
    allowed_setups: [],
    waiting_for: '等待 TV 结构确认。',
    do_not_do: ['不追单', '无结构确认不下单'],
    trade_plan: {
      setup: null,
      entry_zone: null,
      stop_loss: null,
      targets: [],
      invalidation: null,
      ttl_minutes: null
    },
    trace: []
  };
}

function directionFromSetup(setup, dealerBias) {
  if (setup?.includes('long')) return 'bullish';
  if (setup?.includes('short')) return 'bearish';
  if (setup === 'iron_condor_observe') return 'range';
  if (dealerBias === 'range') return 'range';
  if (String(dealerBias).includes('bullish')) return 'bullish';
  if (String(dealerBias).includes('bearish')) return 'bearish';
  return 'mixed';
}

function candidateLabel(setups = []) {
  const first = setups.find((setup) => setup !== 'iron_condor_observe') || setups[0];
  return LABELS[first] || '等确认';
}

export function buildFinalDecision(inputs) {
  const decision = baseDecision();
  const health = evaluateHealthMatrix(inputs);
  decision.trace.push(...health.trace);

  if (health.blocked) {
    return {
      ...decision,
      state: 'blocked',
      label: '禁做',
      reason: health.reason,
      instruction: health.instruction,
      position_multiplier: 0,
      waiting_for: health.reason,
      do_not_do: ['不下单', '不卖波动', '不根据旧 RAW NOTE 操作'],
      trace: decision.trace
    };
  }

  let context = {
    allowed_setups: [
      'A_long_candidate',
      'B_long_candidate',
      'A_short_candidate',
      'B_short_candidate',
      'iron_condor_observe'
    ],
    blocked_setups_reason: [],
    allowed_setups_reason: [],
    position_multiplier: health.position_multiplier,
    confidence: 50,
    data_tier: health.data_tier,
    dealer_bias: 'range',
    direction_blocked: false,
    trace: decision.trace
  };

  if (health.data_tier === 'critical') {
    context.allowed_setups = [];
    context.blocked_setups_reason.push('critical 数据层：禁止方向单。');
  } else if (['partial_gamma', 'no_flow'].includes(health.data_tier)) {
    context.allowed_setups = context.allowed_setups.filter((setup) => !setup.startsWith('A_'));
    context.blocked_setups_reason.push(`${health.data_tier}：禁止 A 单，仓位 0.5。`);
  }

  context = applyVolatilityTree(inputs, context);
  context = applyTechnicalTree(context, inputs);
  context = applyDealerTree(inputs, context);
  context = applyFlowTree(inputs, context);
  context = finalizeAllowedSetups(inputs, context);

  const allowed = context.allowed_setups;
  if (context.final_state === 'blocked') {
    return {
      ...decision,
      state: 'blocked',
      label: '禁做',
      direction: 'unknown',
      reason: context.reason || context.blocked_setups_reason.at(-1) || '确定性过滤阻断。',
      instruction: '禁做，等待结构恢复。',
      position_multiplier: 0,
      allowed_setups: allowed,
      blocked_setups_reason: context.blocked_setups_reason,
      allowed_setups_reason: context.allowed_setups_reason,
      waiting_for: context.reason || '等待通道/数据恢复。',
      do_not_do: ['不追单', '通道阻断时不开新仓'],
      trace: context.trace
    };
  }
  if (allowed.length === 0) {
    return {
      ...decision,
      state: health.data_tier === 'critical' ? 'wait' : 'wait',
      label: '等确认',
      direction: 'unknown',
      reason: context.blocked_setups_reason.at(-1) || '没有 setup 通过确定性过滤。',
      instruction: '观察，不开方向单。',
      position_multiplier: 0,
      allowed_setups: [],
      blocked_setups_reason: context.blocked_setups_reason,
      allowed_setups_reason: context.allowed_setups_reason,
      waiting_for: '等待 UW/TV 条件重新同向。',
      do_not_do: ['不追单', '不做方向单', '不把 ThetaData 当 Dealer 主源'],
      trace: context.trace
    };
  }

  const tv = applyTvMatchTree(inputs, { ...context, final_allowed_setups: allowed });
  if (tv.state === 'invalidated') {
    return {
      ...decision,
      state: 'invalidated',
      label: '作废',
      direction: 'unknown',
      reason: tv.reason,
      instruction: '旧结构作废，回到等待。',
      allowed_setups: allowed,
      blocked_setups_reason: context.blocked_setups_reason,
      allowed_setups_reason: context.allowed_setups_reason,
      do_not_do: ['不追随旧信号', '等待新 TV 结构'],
      trace: tv.trace
    };
  }
  if (tv.state === 'blocked') {
    return {
      ...decision,
      state: 'blocked',
      label: '禁做',
      direction: directionFromSetup(null, context.dealer_bias),
      reason: tv.reason,
      instruction: 'TV 过期，不下单。',
      allowed_setups: allowed,
      blocked_setups_reason: context.blocked_setups_reason,
      allowed_setups_reason: context.allowed_setups_reason,
      waiting_for: '等待新鲜 TV 信号。',
      do_not_do: ['不根据 stale TV 下单'],
      trace: tv.trace
    };
  }
  if (tv.state !== 'actionable') {
    return {
      ...decision,
      state: tv.state === 'wait' ? 'wait' : 'candidate',
      label: tv.state === 'wait' ? '等确认' : candidateLabel(allowed),
      direction: directionFromSetup(allowed[0], context.dealer_bias),
      reason: `UW ${inputs.uw_conclusion.status}，${context.dealer_bias}；TV 未最终匹配。`,
      instruction: '等确认，不追单',
      position_multiplier: 0,
      allowed_setups: allowed,
      blocked_setups_reason: context.blocked_setups_reason,
      allowed_setups_reason: context.allowed_setups_reason,
      waiting_for: '等 TV breakout_confirmed / breakdown_confirmed / pullback_holding / retest_failed 匹配候选。',
      do_not_do: ['不追单', 'TV 未确认不进场'],
      trace: tv.trace
    };
  }

  const tradePlan = buildTradePlan(inputs, tv.matched_setup, context);
  return {
    ...decision,
    state: 'actionable',
    label: '可执行',
    direction: directionFromSetup(tv.matched_setup, context.dealer_bias),
    reason: `UW/Dealer/TV 已匹配 ${tv.matched_setup}。`,
    instruction: `${LABELS[tv.matched_setup] || '候选'} 可执行，按计划和仓位执行。`,
    position_multiplier: context.position_multiplier,
    allowed_setups: allowed,
    blocked_setups_reason: context.blocked_setups_reason,
    allowed_setups_reason: context.allowed_setups_reason,
    waiting_for: '',
    do_not_do: ['不扩大仓位', '失效位触发立即作废', '不自动下单'],
    trade_plan: tradePlan,
    trace: [...tv.trace, { step: 'final_decision', state: 'actionable', setup: tv.matched_setup }]
  };
}
