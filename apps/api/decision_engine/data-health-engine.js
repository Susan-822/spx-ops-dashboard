function getSourceStatusItems(source_status) {
  if (Array.isArray(source_status)) {
    return source_status;
  }

  if (source_status && typeof source_status === 'object') {
    return Object.values(source_status);
  }

  return [];
}

export function runDataHealthEngine({ stale_flags, source_status, data_coherence, external_spot, external_spot_source }) {
  const items = getSourceStatusItems(source_status);
  const commandCriticalSources = new Set([
    'tradingview',
    'theta_core',
    'theta_full_chain',
    'fmp_event',
    'uw_dom',
    'uw_screenshot'
  ]);
  const commandCriticalDown = items.some(
    (item) => commandCriticalSources.has(item.source) && item.source !== 'tradingview' && item.state === 'down'
  );
  const missingCriticalSources = [];
  const thetaCore = items.find((item) => item.source === 'theta_core');
  const uwDom = items.find((item) => item.source === 'uw_dom');
  const fmpEvent = items.find((item) => item.source === 'fmp_event');

  if (!thetaCore || thetaCore.is_mock || ['mock', 'degraded', 'down'].includes(thetaCore.state)) {
    missingCriticalSources.push('theta');
  }
  if (!uwDom || uwDom.is_mock || ['mock', 'degraded', 'down'].includes(uwDom.state)) {
    missingCriticalSources.push('uw');
  }
  if (!fmpEvent || fmpEvent.is_mock || ['mock', 'degraded', 'down'].includes(fmpEvent.state)) {
    missingCriticalSources.push('fmp');
  }

  const command_inputs_fresh = !stale_flags.theta && !stale_flags.uw && !stale_flags.fmp && !commandCriticalDown;
  const tv_fresh = !stale_flags.tradingview;
  const hard_block = stale_flags.theta || commandCriticalDown;
  const fmpPrice = items.find((item) => item.source === 'fmp_price');
  const thetaLive = Boolean(thetaCore && thetaCore.is_mock === false && thetaCore.state === 'real' && thetaCore.stale !== true);
  const externalSpotReal = Boolean(fmpPrice && fmpPrice.is_mock === false && fmpPrice.state === 'real' && fmpPrice.stale !== true);
  const inferredExternalSpot = {
    source: external_spot_source || (externalSpotReal ? 'fmp' : 'unavailable'),
    is_real: externalSpotReal
  };
  const coherence =
    data_coherence?.status
    || (externalSpotReal && !thetaLive
      ? 'mixed'
      : stale_flags.any_stale
        ? 'stale'
        : thetaCore?.is_mock
          ? 'mock'
          : 'aligned');

  let state = 'healthy';
  if (hard_block) {
    state = 'blocked';
  } else if (!command_inputs_fresh || !tv_fresh || stale_flags.any_stale || ['mixed', 'conflict'].includes(coherence)) {
    state = 'degraded';
  }

  return {
    state,
    allowed: !hard_block,
    executable: !hard_block && missingCriticalSources.length === 0 && !['mixed', 'conflict', 'stale', 'mock'].includes(coherence),
    hard_block,
    command_inputs_fresh,
    tv_fresh,
    any_stale: stale_flags.any_stale,
    missing_inputs: missingCriticalSources,
    coherence,
    external_spot: inferredExternalSpot,
    summary: hard_block
      ? '关键输入异常，禁止执行。'
      : coherence === 'conflict'
        ? data_coherence?.issues?.[0] || '数据冲突｜禁止执行。'
      : coherence === 'mixed'
        ? '真实价格与 scenario/mock 结构混用，禁止执行。'
      : coherence === 'stale'
        ? '数据存在 stale，禁止执行。'
      : coherence === 'mock'
        ? '演示场景｜不可交易。'
      : missingCriticalSources.length > 0
        ? '允许观察，不等于可执行；缺少关键输入，不能 ready。'
      : !command_inputs_fresh
        ? '指挥部关键输入不够新鲜。'
        : !tv_fresh
          ? 'TradingView 仅保留旧事件，不可当新触发。'
          : '关键输入健康。'
  };
}
