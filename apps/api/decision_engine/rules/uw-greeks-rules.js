function unavailableGreeks(status = 'unavailable', reason = 'UW Greek Exposure unavailable.') {
  return {
    status,
    call_gamma: null,
    put_gamma: null,
    call_vanna: null,
    put_vanna: null,
    call_charm: null,
    put_charm: null,
    call_delta: null,
    put_delta: null,
    net_gamma_bias: 'unavailable',
    net_vanna_bias: 'unavailable',
    net_charm_bias: 'unavailable',
    net_delta_bias: 'unavailable',
    dealer_crosscheck: 'unavailable',
    plain_chinese: reason
  };
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function biasFromPair(callValue, putValue, positiveLabel, negativeLabel) {
  const call = firstFinite(callValue);
  const put = firstFinite(putValue);
  if (call == null || put == null) {
    return 'unavailable';
  }
  const net = call + put;
  if (net > 0) return positiveLabel;
  if (net < 0) return negativeLabel;
  return 'mixed';
}

function deriveCrosscheck(thetaGamma, uwGamma) {
  if (!['positive', 'negative'].includes(thetaGamma) || !['positive', 'negative'].includes(uwGamma)) {
    return 'unavailable';
  }
  return thetaGamma === uwGamma ? 'confirm' : 'conflict';
}

export function buildUwDealerGreeks({ normalized = {}, uw = normalized.uw || {}, uwConclusion = {}, dealerConclusion = {} } = {}) {
  const status = String(uw?.status || uwConclusion?.status || 'unavailable').toLowerCase();
  if (['unavailable', 'error', 'stale'].includes(status)) {
    return unavailableGreeks(status, status === 'stale' ? 'UW Greek Exposure stale，只能观察。' : 'UW Greek Exposure 不可用，不参与 Dealer 交叉验证。');
  }

  const greeks = uw?.dealer_greeks || uw?.greeks || uw?.greek_exposure || {};
  const call_gamma = firstFinite(greeks.call_gamma, greeks.calls_gamma);
  const put_gamma = firstFinite(greeks.put_gamma, greeks.puts_gamma);
  const call_vanna = firstFinite(greeks.call_vanna, greeks.calls_vanna);
  const put_vanna = firstFinite(greeks.put_vanna, greeks.puts_vanna);
  const call_charm = firstFinite(greeks.call_charm, greeks.calls_charm);
  const put_charm = firstFinite(greeks.put_charm, greeks.puts_charm);
  const call_delta = firstFinite(greeks.call_delta, greeks.calls_delta);
  const put_delta = firstFinite(greeks.put_delta, greeks.puts_delta);

  const net_gamma_bias = greeks.net_gamma_bias || biasFromPair(call_gamma, put_gamma, 'positive', 'negative');
  const net_vanna_bias = greeks.net_vanna_bias || biasFromPair(call_vanna, put_vanna, 'bullish', 'bearish');
  const net_charm_bias = greeks.net_charm_bias || biasFromPair(call_charm, put_charm, 'bullish', 'bearish');
  const net_delta_bias = greeks.net_delta_bias || biasFromPair(call_delta, put_delta, 'bullish', 'bearish');
  const anyGreekBias = [net_gamma_bias, net_vanna_bias, net_charm_bias, net_delta_bias].some((item) => item !== 'unavailable');
  const effectiveStatus = anyGreekBias ? status : 'unavailable';
  const dealer_crosscheck = deriveCrosscheck(dealerConclusion?.gamma_regime, net_gamma_bias);

  return {
    status: effectiveStatus,
    call_gamma,
    put_gamma,
    call_vanna,
    put_vanna,
    call_charm,
    put_charm,
    call_delta,
    put_delta,
    net_gamma_bias,
    net_vanna_bias,
    net_charm_bias,
    net_delta_bias,
    dealer_crosscheck,
    plain_chinese:
      dealer_crosscheck === 'confirm'
        ? 'UW Greek Exposure 与 Theta Gamma 方向一致，提升参考置信度。'
        : dealer_crosscheck === 'conflict'
          ? 'UW Greek Exposure 与 Theta Gamma 冲突，计划必须降级等待。'
          : 'UW Greek Exposure 不完整，不参与放行。'
  };
}
