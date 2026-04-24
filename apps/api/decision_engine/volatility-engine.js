export function runVolatilityEngine({ iv_state, gamma_regime, event_risk, uw_dealer_bias }) {
  const shortVolAllowed =
    iv_state === 'cooling' &&
    gamma_regime === 'positive' &&
    event_risk === 'low' &&
    uw_dealer_bias !== 'defensive';

  let vol_state = 'mixed';
  if (event_risk === 'high') {
    vol_state = 'event_loaded';
  } else if (gamma_regime === 'negative' || iv_state === 'elevated') {
    vol_state = 'expanding';
  } else if (shortVolAllowed) {
    vol_state = 'contained';
  }

  return {
    vol_state,
    short_vol_allowed: shortVolAllowed,
    income_allowed_reason: shortVolAllowed
      ? 'IV 回落、正 Gamma、无事件风险，卖波动率环境才算勉强打开。'
      : '当前不满足正 Gamma、IV 回落、低事件风险的同时成立条件。'
  };
}
