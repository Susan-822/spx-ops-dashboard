export function runDataHealthEngine({ stale_flags, source_status, normalized }) {
  const items = Array.isArray(source_status) ? source_status : [];
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

  const command_inputs_fresh = !stale_flags.theta && !stale_flags.uw && !stale_flags.fmp && !commandCriticalDown;
  const tv_fresh = !stale_flags.tradingview;
  const hard_block = stale_flags.theta || commandCriticalDown || normalized?.theta_execution_constraint?.executable === false;

  let state = 'healthy';
  if (hard_block) {
    state = 'blocked';
  } else if (!command_inputs_fresh || !tv_fresh || stale_flags.any_stale) {
    state = 'degraded';
  }

  return {
    state,
    allowed: !hard_block,
    executable: !hard_block,
    hard_block,
    command_inputs_fresh,
    tv_fresh,
    any_stale: stale_flags.any_stale,
    summary: hard_block
      ? '关键输入异常，禁止执行。'
      : !command_inputs_fresh
        ? '指挥部关键输入不够新鲜。'
        : !tv_fresh
          ? 'TradingView 仅保留旧事件，不可当新触发。'
          : '关键输入健康。'
  };
}
