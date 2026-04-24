export const ACTIONS = Object.freeze({
  WAIT: 'wait',
  NO_TRADE: 'no_trade',
  LONG_ON_PULLBACK: 'long_on_pullback',
  SHORT_ON_RETEST: 'short_on_retest',
  INCOME_OK: 'income_ok'
});

export const ActionEnum = ACTIONS;
export const ActionValues = Object.freeze(Object.values(ACTIONS));
