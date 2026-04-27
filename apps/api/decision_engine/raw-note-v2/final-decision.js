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
    market_read: '',
    reflection: {
      supporting: [],
      conflicting: [],
      missing: [],
      invalidation: []
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

function buildReflection(inputs, context = {}) {
  const supporting = [];
  const missing = [];
  const invalidation = ['TV 结构反向或 stale。'];
  const spot = inputs.spot_conclusion || { status: 'unavailable' };
  const gex = inputs.gex_engine || { status: 'unavailable' };
  const flow = inputs.flow_aggression_engine || { status: 'unavailable' };
  const darkpool = inputs.darkpool_engine || { status: 'unavailable' };
  const volatility = inputs.volatility_engine || { status: 'unavailable' };
  const basis = inputs.basis_tracker || { status: 'unavailable' };
  const event = inputs.event_conclusion || { risk: 'unknown' };
  if (spot.status !== 'unavailable') supporting.push(spot.plain_chinese);
  if (gex.status !== 'unavailable') supporting.push(gex.plain_chinese);
  if (flow.status !== 'unavailable') supporting.push(flow.plain_chinese);
  if (darkpool.status !== 'unavailable') supporting.push(darkpool.plain_chinese);
  if (volatility.status !== 'unavailable') supporting.push(volatility.plain_chinese);
  if (basis.status !== 'unavailable') supporting.push(basis.plain_chinese);
  if (event.risk !== 'normal') missing.push(event.plain_chinese);
  if (gex.confidence === 'low') missing.push('UW 墙位低可信，暂不用于交易。');
  if (basis.status === 'unavailable') missing.push('Basis 暂不可用，ES 投射降级。');
  return {
    supporting: supporting.filter(Boolean),
    conflicting: context.direction_blocked ? ['Flow 与 Dealer 方向冲突。'] : [],
    missing: missing.filter(Boolean),
    invalidation
  };
}

function buildMarketRead(inputs) {
  return [
    inputs.flow_aggression_engine?.plain_chinese,
    inputs.gex_engine?.plain_chinese,
    inputs.darkpool_engine?.plain_chinese,
    inputs.volatility_engine?.plain_chinese
  ].filter(Boolean).join(' ');
}

function tvWaitingText(direction = 'mixed') {
  if (direction === 'bearish') return '等待 ES 在 UW 投射关键位附近触发 breakdown_confirmed / retest_failed。';
  if (direction === 'bullish') return '等待 ES 在 UW 投射关键位附近触发 breakout_confirmed / pullback_holding。';
  return '等待 ES 在 UW 投射关键位附近触发 breakout_confirmed / pullback_holding / breakdown_confirmed / retest_failed。';
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
      market_read: buildMarketRead(inputs),
      reflection: buildReflection(inputs),
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
  if (inputs.event_conclusion.risk === 'unknown' || inputs.event_conclusion.risk === 'caution') {
    context.allowed_setups = context.allowed_setups.filter((setup) => setup !== 'iron_condor_observe');
    context.blocked_setups_reason.push('事件风险未知/谨慎：禁止铁鹰和卖波。');
    context.position_multiplier = Math.min(context.position_multiplier, 0.5);
  }

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
      market_read: buildMarketRead(inputs),
      reflection: buildReflection(inputs, context),
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
      market_read: buildMarketRead(inputs),
      reflection: buildReflection(inputs, context),
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
      market_read: buildMarketRead(inputs),
      reflection: buildReflection(inputs, context),
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
      market_read: buildMarketRead(inputs),
      reflection: buildReflection(inputs, context),
      trace: tv.trace
    };
  }
  if (tv.state !== 'actionable') {
    return {
      ...decision,
      state: tv.state === 'wait' ? 'wait' : 'candidate',
      label: tv.state === 'wait' ? '等确认' : candidateLabel(allowed),
      direction: directionFromSetup(allowed[0], context.dealer_bias),
      reason: 'UW 给出资金线索，但 TV 尚未在 ES 关键位附近确认。',
      instruction: '等确认，不追单',
      position_multiplier: 0,
      allowed_setups: allowed,
      blocked_setups_reason: context.blocked_setups_reason,
      allowed_setups_reason: context.allowed_setups_reason,
      waiting_for: tvWaitingText(directionFromSetup(allowed[0], context.dealer_bias)),
      do_not_do: ['不追单', '不开铁鹰', '不在中轴提前下单'],
      market_read: buildMarketRead(inputs),
      reflection: buildReflection(inputs, context),
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
    market_read: buildMarketRead(inputs),
    reflection: buildReflection(inputs, context),
    trace: [...tv.trace, { step: 'final_decision', state: 'actionable', setup: tv.matched_setup }]
  };
}
