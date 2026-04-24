export function runPriceStructureEngine({ tv_structure_event }) {
  switch (tv_structure_event) {
    case 'breakout_confirmed_pullback_ready':
      return {
        price_signal: 'long_pullback_ready',
        confirmation_status: 'confirmed'
      };
    case 'breakdown_confirmed':
      return {
        price_signal: 'short_retest_ready',
        confirmation_status: 'confirmed'
      };
    case 'breakout_probe_unconfirmed':
      return {
        price_signal: 'bullish_probe',
        confirmation_status: 'unconfirmed'
      };
    case 'range_holding':
      return {
        price_signal: 'range_hold',
        confirmation_status: 'confirmed'
      };
    case 'structure_invalidated':
      return {
        price_signal: 'wait_reset',
        confirmation_status: 'invalidated'
      };
    case 'pullback_not_confirmed':
    default:
      return {
        price_signal: 'wait_pullback',
        confirmation_status: 'unconfirmed'
      };
  }
}
