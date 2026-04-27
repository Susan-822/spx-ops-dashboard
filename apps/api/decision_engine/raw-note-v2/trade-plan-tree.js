import { formatLevel } from './formatters.js';

export function generateTradePlan({ setup, inputs }) {
  const uw = inputs.uw_conclusion;
  const spot = inputs.fmp_conclusion.spot;
  const bullish = setup === 'A_long_candidate' || setup === 'B_long_candidate';
  const bearish = setup === 'A_short_candidate' || setup === 'B_short_candidate';
  if (!bullish && !bearish) {
    return {
      setup: null,
      entry_zone: null,
      stop_loss: null,
      targets: [],
      invalidation: null,
      ttl_minutes: null
    };
  }
  const entry = bullish
    ? `${formatLevel(spot)} 上方回踩守住`
    : `${formatLevel(spot)} 下方反抽失败`;
  const stop = bullish ? uw.put_wall : uw.call_wall;
  const target = bullish ? uw.call_wall : uw.put_wall;
  return {
    setup,
    entry_zone: entry,
    stop_loss: stop == null ? null : formatLevel(stop),
    targets: target == null ? [] : [formatLevel(target)],
    invalidation: stop == null ? null : `${bullish ? '跌破' : '站回'} ${formatLevel(stop)}`,
    ttl_minutes: 30
  };
}

export function buildTradePlan(inputs, setup) {
  return generateTradePlan({ setup, inputs });
}
