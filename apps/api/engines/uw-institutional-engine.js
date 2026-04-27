function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function runUwInstitutionalEngine({ provider = {}, flowFactors = {}, tvSentinel = {} } = {}) {
  if (!['live', 'partial', 'stale'].includes(provider.status) || flowFactors.direction === 'none') {
    return {
      state: 'unavailable',
      direction: 'none',
      score: 0,
      quality: 'unavailable',
      evidence: [],
      supports_main_plan: false,
      plain_chinese: 'UW flow 不可用，不能判断机构入场。'
    };
  }

  const sweepCount = num(flowFactors.sweep_count_5m) || 0;
  const largeCount = num(flowFactors.large_trade_count_5m) || 0;
  const netPremium = num(flowFactors.net_premium_5m) || 0;
  const score = Math.max(0, Math.min(100, Math.round(Math.abs(netPremium) / 100000 + sweepCount * 8 + largeCount * 6)));
  const state = score >= 70 ? 'bombing' : score >= 35 ? 'building' : 'none';
  const direction = flowFactors.direction || 'mixed';
  const quality = sweepCount >= 3 ? 'aggressive' : largeCount > 0 ? 'hedge' : 'unclear';
  const tvDirection = tvSentinel.direction || tvSentinel.side || 'mixed';
  const supportsMainPlan = ['bullish', 'bearish'].includes(direction) && direction === tvDirection;
  const evidence = [
    `net_premium_5m=${netPremium}`,
    `sweep_count_5m=${sweepCount}`,
    `large_trade_count_5m=${largeCount}`
  ];

  return {
    state,
    direction,
    score,
    quality,
    evidence,
    supports_main_plan: supportsMainPlan,
    plain_chinese:
      state === 'bombing'
        ? `UW 机构流 ${direction} 连续轰炸，只能作为确认，不能单独入场。`
        : state === 'building'
          ? `UW 机构流 ${direction} 正在形成，等待价格确认。`
          : 'UW 机构流未形成连续入场。'
  };
}
