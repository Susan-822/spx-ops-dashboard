export function runDealerConclusionEngine({ normalized, gammaWall }) {
  const sourceItems = Array.isArray(normalized?.source_status) ? normalized.source_status : [];
  const thetaCore = sourceItems.find((item) => item.source === 'theta_core');
  const thetaChain = sourceItems.find((item) => item.source === 'theta_full_chain');
  const hasRealTheta = thetaCore?.state === 'real' || thetaChain?.state === 'real';
  const hasStaleTheta = thetaCore?.stale === true || thetaChain?.stale === true;
  const status = hasRealTheta ? 'live' : hasStaleTheta ? 'stale' : 'mock';
  const expectedMoveUpper = normalized.call_wall != null ? normalized.call_wall : null;
  const expectedMoveLower = normalized.put_wall != null ? normalized.put_wall : null;

  let dealer_behavior = 'unknown';
  if (normalized.gamma_regime === 'positive') {
    dealer_behavior = 'pin';
  } else if (normalized.gamma_regime === 'negative') {
    dealer_behavior = 'expand';
  } else if (normalized.gamma_regime === 'critical') {
    dealer_behavior = 'mixed';
  }

  let least_resistance_path = 'unknown';
  if (gammaWall.wall_bias === 'bullish') {
    least_resistance_path = 'up';
  } else if (gammaWall.wall_bias === 'bearish') {
    least_resistance_path = 'down';
  } else if (normalized.gamma_regime === 'positive') {
    least_resistance_path = 'range';
  }

  const vanna = normalized.advanced_greeks?.vanna;
  const charm = normalized.advanced_greeks?.charm;
  let vanna_charm_bias = 'unknown';
  if (vanna === 'positive' && charm === 'positive') {
    vanna_charm_bias = 'bullish';
  } else if (vanna === 'negative' && charm === 'negative') {
    vanna_charm_bias = 'bearish';
  } else if (vanna || charm) {
    vanna_charm_bias = 'mixed';
  }

  return {
    source: 'theta',
    status,
    gamma_regime: normalized.gamma_regime || 'unknown',
    dealer_behavior,
    least_resistance_path,
    call_wall: normalized.call_wall ?? null,
    put_wall: normalized.put_wall ?? null,
    max_pain: normalized.max_pain ?? null,
    zero_gamma: normalized.flip_level ?? null,
    expected_move_upper: expectedMoveUpper,
    expected_move_lower: expectedMoveLower,
    vanna_charm_bias,
    plain_chinese:
      status === 'mock'
        ? 'Dealer 地图仍来自 mock/scenario，只能观察，不得直接执行。'
      : normalized.gamma_regime === 'positive'
        ? 'Dealer 偏控波，价格更容易围绕关键位磨盘。'
        : normalized.gamma_regime === 'negative'
          ? 'Dealer 偏放波，路径更容易扩张。'
          : normalized.gamma_regime === 'critical'
            ? 'Dealer 环境接近 Gamma 翻转区，容易拉扯。'
            : 'Dealer 结论暂不清楚。'
  };
}
