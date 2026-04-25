function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isScenarioSource(normalized = {}) {
  return normalized?.scenario_mode === true || normalized?.fetch_mode === 'mock_scenario' || normalized?.is_mock === true;
}

function capConfidence(value, max = 20) {
  const parsed = toNumber(value);
  if (parsed == null) {
    return max;
  }
  return Math.min(max, parsed);
}

export function runDataCoherenceEngine(normalized = {}) {
  const marketSnapshot = normalized?.market_snapshot || {};
  const dealerConclusion = normalized?.dealer_conclusion || normalized?.theta_dealer_conclusion || {};
  const theta = normalized?.theta || {};
  const spot = toNumber(normalized.external_spot ?? normalized.spot ?? marketSnapshot.spot);
  const flip = toNumber(normalized.flip_level ?? marketSnapshot.flip_level);
  const callWall = toNumber(normalized.call_wall ?? dealerConclusion.call_wall ?? marketSnapshot.call_wall);
  const putWall = toNumber(normalized.put_wall ?? dealerConclusion.put_wall ?? marketSnapshot.put_wall);
  const maxPain = toNumber(normalized.max_pain ?? dealerConclusion.max_pain ?? marketSnapshot.max_pain);
  const emUpper = toNumber(dealerConclusion.expected_move_upper ?? normalized.theta_dealer_conclusion?.expected_move_upper);
  const emLower = toNumber(dealerConclusion.expected_move_lower ?? normalized.theta_dealer_conclusion?.expected_move_lower);
  const expectedMove =
    emUpper != null && emLower != null
      ? Math.abs(emUpper - emLower) / 2
      : null;

  const scenarioSource = isScenarioSource(normalized);
  const spotSource = normalized?.external_spot_source || normalized?.spot_source || marketSnapshot.spot_source || 'unavailable';
  const realSpot = (normalized?.external_spot_is_real === true || normalized?.spot_is_real === true || marketSnapshot?.spot_is_real === true)
    && ['fmp', 'tradingview', 'market_snapshot', 'manual_test'].includes(spotSource);
  const thetaLive = theta.status === 'live';

  let data_mode = scenarioSource ? 'scenario' : 'live';
  let executable = true;
  let trade_permission = 'watch';
  let confidence_cap = null;
  const reasons = [];

  if (scenarioSource) {
    executable = false;
    trade_permission = 'no_trade';
    confidence_cap = 20;
    reasons.push('演示场景｜不可交易');
    if (realSpot) {
      data_mode = 'mixed';
      reasons.push('real_spot_with_scenario_map');
    }
  }

  if (realSpot && scenarioSource) {
    data_mode = 'mixed';
    executable = false;
    trade_permission = 'no_trade';
    confidence_cap = 20;
  }

  if (spot != null && flip != null) {
    const allowedGap = Math.max(150, (expectedMove ?? 0) * 3);
    if (Math.abs(spot - flip) > allowedGap) {
      data_mode = 'conflict';
      executable = false;
      trade_permission = 'no_trade';
      confidence_cap = 20;
      reasons.push('spot_flip_gap_conflict');
    }
  }

  const levels = [flip, callWall, putWall, maxPain].filter((value) => value != null);
  if (spot != null && levels.length > 0) {
    const minLevel = Math.min(...levels);
    const maxLevel = Math.max(...levels);
    const buffer = Math.max(75, (expectedMove ?? 0) * 1.5);
    if (spot < minLevel - buffer || spot > maxLevel + buffer) {
      data_mode = scenarioSource && data_mode === 'mixed' ? 'mixed' : 'conflict';
      executable = false;
      trade_permission = 'no_trade';
      confidence_cap = 20;
      reasons.push('spot_outside_gamma_world');
    }
  }

  if (!thetaLive && normalized?.theta?.status && normalized.theta.status !== 'unavailable') {
    executable = false;
    trade_permission = 'no_trade';
    reasons.push(`theta_${normalized.theta.status}`);
  }

  if (!scenarioSource && thetaLive && data_mode !== 'conflict' && data_mode !== 'mixed') {
    data_mode = 'live';
  }

  return {
    data_mode,
    executable,
    trade_permission,
    confidence_cap,
    scenario: scenarioSource,
    scenario_mode: scenarioSource,
    spot_source: spotSource,
    externalSpot_source: spotSource,
    map_source: scenarioSource ? 'scenario/mock' : thetaLive ? 'theta/live' : 'mixed',
    coherent: executable && data_mode === 'live',
    reasons,
    plain_chinese:
      data_mode === 'mixed'
        ? '真实现价与演示/模拟地图混用，禁止执行。'
        : data_mode === 'conflict'
          ? '现价与 Gamma 地图不在同一价格世界，禁止执行。'
          : scenarioSource
            ? '演示场景｜不可交易。'
            : executable
              ? '数据一致，可继续等待其它门控确认。'
              : '数据不足或冲突，禁止执行。'
  };
}

export const evaluateDataCoherence = runDataCoherenceEngine;

export function applyCoherenceToStrategyCard(card = {}, reasonText = '数据冲突 / 演示场景 / 数据过期 / 缺少关键输入') {
  return {
    ...card,
    entry_condition: '--',
    target_zone: '--',
    invalidation: '--',
    suitable_when: reasonText,
    avoid_when: reasonText
  };
}
