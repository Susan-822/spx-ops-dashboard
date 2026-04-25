export function runTvSentinelEngine({ priceStructure, snapshotFresh = true }) {
  const confirmation = priceStructure?.confirmation_status || 'unconfirmed';
  const signal = priceStructure?.price_signal || 'wait_pullback';

  if (!snapshotFresh) {
    return {
      status: 'stale',
      triggered: false,
      direction: 'neutral',
      setup_code: null,
      tv_signal: signal,
      price_confirmation: confirmation,
      reason: 'TradingView 事件已过期，只保留参考，不作为新触发。'
    };
  }

  if (confirmation !== 'confirmed') {
    return {
      status: 'waiting',
      triggered: false,
      direction: signal.includes('bullish') || signal.includes('long') ? 'bullish' : signal.includes('short') || signal.includes('bearish') ? 'bearish' : 'neutral',
      setup_code: null,
      tv_signal: signal,
      price_confirmation: confirmation,
      reason: 'TradingView 价格结构尚未确认。'
    };
  }

  if (signal === 'long_pullback_ready') {
    return {
      status: 'triggered',
      triggered: true,
      direction: 'bullish',
      setup_code: 'A_LONG_PULLBACK',
      tv_signal: signal,
      price_confirmation: confirmation,
      reason: 'TradingView 多头结构已到位。'
    };
  }

  if (signal === 'short_retest_ready') {
    return {
      status: 'triggered',
      triggered: true,
      direction: 'bearish',
      setup_code: 'A_SHORT_RETEST',
      tv_signal: signal,
      price_confirmation: confirmation,
      reason: 'TradingView 空头结构已到位。'
    };
  }

  if (signal === 'range_hold') {
    return {
      status: 'triggered',
      triggered: true,
      direction: 'neutral',
      setup_code: 'B_IRON_CONDOR',
      tv_signal: signal,
      price_confirmation: confirmation,
      reason: 'TradingView 区间结构已确认。'
    };
  }

  return {
    status: 'waiting',
    triggered: false,
    direction: 'neutral',
    setup_code: null,
    tv_signal: signal,
    price_confirmation: confirmation,
    reason: 'TradingView 结构已确认，但还未命中可执行的 A/B 单触发。'
  };
}
