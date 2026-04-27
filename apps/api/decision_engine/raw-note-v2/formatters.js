export function formatLevel(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '--';
}

export function normalizeBias(value) {
  if (['bullish', 'bearish', 'neutral', 'unavailable'].includes(value)) return value;
  if (value === 'support' || value === 'risk_on') return 'bullish';
  if (value === 'resistance' || value === 'risk_off') return 'bearish';
  if (value === 'mixed' || value === 'none' || value === 'unknown') return 'neutral';
  return 'unavailable';
}

export function buildThetaConclusion(theta = {}) {
  const callMid = Number(theta.atm_call_mid);
  const putMid = Number(theta.atm_put_mid);
  const hasEm = Number.isFinite(callMid) && Number.isFinite(putMid);
  if (theta.status === 'live' && hasEm) {
    const expectedMove = callMid + putMid;
    const spot = Number(theta.spot);
    return {
      status: 'live',
      role: 'em_auxiliary_only',
      em_available: true,
      expected_move: expectedMove,
      em_upper: Number.isFinite(spot) ? spot + expectedMove : null,
      em_lower: Number.isFinite(spot) ? spot - expectedMove : null,
      atm_call_mid: callMid,
      atm_put_mid: putMid,
      plain_chinese: 'ThetaData 仅用于 Expected Move 辅助。'
    };
  }
  return {
    status: 'disabled',
    role: 'disabled',
    em_available: false,
    expected_move: null,
    plain_chinese: 'ThetaData 暂停使用，系统以 UW API 为主。'
  };
}

export function decisionToTelegram({ final_decision, uw_conclusion = {}, theta_conclusion = {}, price_sources = {} }) {
  const title = final_decision.state === 'wait' ? 'WAIT' : String(final_decision.label || final_decision.state || 'WAIT').toUpperCase();
  const keyLevels = [
    `SPX Call Wall ${formatLevel(uw_conclusion.call_wall)}`,
    `SPX Put Wall ${formatLevel(uw_conclusion.put_wall)}`,
    `Max Pain ${formatLevel(uw_conclusion.max_pain)}`,
    price_sources.es?.status === 'live'
      ? `ES 等效价 ${formatLevel(price_sources.spx_equivalent_from_es?.price)}`
      : `ES/SPY 等效价暂不可用。${price_sources.es?.reason || ''}`.trim()
  ].join('\n');
  const doNot = Array.isArray(final_decision.do_not_do) && final_decision.do_not_do.length > 0
    ? final_decision.do_not_do.join('；')
    : '无结构确认不下单。';
  return [
    `【SPX 指挥台｜${title}】`,
    '',
    `动作：${final_decision.instruction || final_decision.label}`,
    '',
    `盘面：`,
    final_decision.reason || `FMP 真实，UW ${uw_conclusion.status || 'unavailable'}。ThetaData ${theta_conclusion.status || 'disabled'} 仅影响 EM。`,
    '',
    `等什么：`,
    final_decision.waiting_for || '--',
    '',
    `禁做：`,
    doNot,
    '',
    `关键位：`,
    keyLevels,
    '',
    `策略：`,
    final_decision.allowed_setups?.join(' / ') || '--',
    '',
    `失效条件：`,
    final_decision.trade_plan?.invalidation || '--',
    '',
    `仓位：`,
    String(final_decision.position_multiplier ?? 0)
  ].join('\n');
}

export function buildStrategyCards(final_decision = {}) {
  const has = (setup) => Array.isArray(final_decision.allowed_setups) && final_decision.allowed_setups.includes(setup);
  const plan = final_decision.trade_plan || {};
  return [
    {
      strategy_name: '单腿',
      status_text: final_decision.state === 'actionable' && (has('A_long_candidate') || has('A_short_candidate')) ? '可执行' : '等待 / 禁止追单',
      suitable_when: '只在 A 单被 final_decision 放行且 TV 确认时使用。',
      entry_condition: plan.entry_zone || '--',
      target_zone: Array.isArray(plan.targets) && plan.targets.length > 0 ? plan.targets.join(' / ') : '--',
      invalidation: plan.invalidation || '--',
      position: String(final_decision.position_multiplier ?? 0),
      permission: has('A_long_candidate') || has('A_short_candidate') ? 'wait' : 'block'
    },
    {
      strategy_name: '垂直',
      status_text: has('B_long_candidate') || has('B_short_candidate') ? '等待候选' : '等待候选',
      suitable_when: 'B 多/B 空候选来自 final_decision，不单独判断方向。',
      entry_condition: plan.entry_zone || '--',
      target_zone: Array.isArray(plan.targets) && plan.targets.length > 0 ? plan.targets.join(' / ') : '--',
      invalidation: plan.invalidation || '--',
      position: String(final_decision.position_multiplier ?? 0),
      permission: has('B_long_candidate') || has('B_short_candidate') ? 'wait' : 'block'
    },
    {
      strategy_name: '铁鹰',
      status_text: has('iron_condor_observe') ? '观察' : '禁止',
      suitable_when: '仅正 Gamma、低波动、无扩张时观察。',
      entry_condition: '--',
      target_zone: '--',
      invalidation: plan.invalidation || '--',
      position: has('iron_condor_observe') ? String(final_decision.position_multiplier ?? 0) : '0',
      permission: has('iron_condor_observe') ? 'wait' : 'block'
    }
  ];
}
