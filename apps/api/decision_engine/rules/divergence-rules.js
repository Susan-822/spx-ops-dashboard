export function buildFlowPriceDivergence({
  normalized = {},
  uwConclusion = {},
  tvSentinel = {},
  volumePressure = {}
} = {}) {
  if (uwConclusion.status === 'unavailable') {
    return {
      state: 'unavailable',
      action: 'wait',
      plain_chinese: 'UW Flow 不可用，无法判断量价 / Flow 背离。'
    };
  }

  const conflicts = [];
  if (tvSentinel.event_type === 'breakout_confirmed' && volumePressure.direction === 'mixed') {
    conflicts.push('breakout_volume_mixed');
  }
  if (volumePressure.rvol >= 2 && (
    (tvSentinel.direction === 'bullish' && uwConclusion.flow_bias === 'bearish')
    || (tvSentinel.direction === 'bearish' && uwConclusion.flow_bias === 'bullish')
  )) {
    conflicts.push('impulse_against_uw_flow');
  }
  if (normalized?.price_breakout === 'new_high' && uwConclusion.flow_bias === 'bearish') {
    conflicts.push('new_high_bearish_flow');
  }
  if (normalized?.price_breakout === 'new_low' && uwConclusion.flow_bias === 'bullish') {
    conflicts.push('new_low_bullish_flow');
  }

  const serious = conflicts.includes('impulse_against_uw_flow');
  return {
    state: serious ? 'serious' : conflicts.length > 0 ? 'mild' : 'none',
    action: serious ? 'block' : conflicts.length > 0 ? 'wait' : 'allow',
    conflicts,
    plain_chinese:
      serious
        ? '强量比与 UW Flow 反向，禁止 ready。'
        : conflicts.length > 0
          ? '量价 / Flow 有背离，降级等待。'
          : '未发现量价 / Flow 背离。'
  };
}
