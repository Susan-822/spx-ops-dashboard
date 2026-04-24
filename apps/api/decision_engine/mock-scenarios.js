function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function createScenario(definition) {
  const timestamp = new Date().toISOString();

  return {
    timestamp,
    symbol: 'SPX',
    timeframe: '1D',
    is_mock: true,
    last_updated: {
      theta: isoMinutesAgo(definition.last_updated_minutes?.theta ?? 1),
      tradingview: isoMinutesAgo(definition.last_updated_minutes?.tradingview ?? 1),
      uw: isoMinutesAgo(definition.last_updated_minutes?.uw ?? 1),
      fmp: isoMinutesAgo(definition.last_updated_minutes?.fmp ?? 1)
    },
    ...definition
  };
}

const SCENARIO_DEFINITIONS = Object.freeze({
  negative_gamma_wait_pullback: {
    scenario: 'negative_gamma_wait_pullback',
    gamma_regime: 'negative_gamma',
    spot: 5252,
    flip_level: 5285,
    call_wall: 5320,
    put_wall: 5225,
    max_pain: 5275,
    iv_state: 'elevated',
    event_risk: 'low',
    event_note: 'No major scheduled event, but tape remains unstable.',
    theta_signal: 'bearish_pressure',
    fmp_signal: 'clear',
    tv_structure_event: 'pullback_not_confirmed',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'defensive',
    advanced_greeks: {
      vanna: 'negative',
      charm: 'negative'
    }
  },
  positive_gamma_income_watch: {
    scenario: 'positive_gamma_income_watch',
    gamma_regime: 'positive_gamma',
    spot: 5312,
    flip_level: 5286,
    call_wall: 5338,
    put_wall: 5270,
    max_pain: 5308,
    iv_state: 'cooling',
    event_risk: 'low',
    event_note: 'Event calendar is light for the next session.',
    theta_signal: 'income_supportive',
    fmp_signal: 'clear',
    tv_structure_event: 'range_holding',
    uw_flow_bias: 'neutral',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'stabilizing',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },
  flip_conflict_wait: {
    scenario: 'flip_conflict_wait',
    gamma_regime: 'mixed_gamma',
    spot: 5281,
    flip_level: 5280,
    call_wall: 5310,
    put_wall: 5258,
    max_pain: 5280,
    iv_state: 'mixed',
    event_risk: 'low',
    event_note: 'Nothing scheduled, but price is pinned near the flip.',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakdown_confirmed',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'supportive',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'flat'
    }
  },
  theta_stale_no_trade: {
    scenario: 'theta_stale_no_trade',
    gamma_regime: 'positive_gamma',
    spot: 5304,
    flip_level: 5282,
    call_wall: 5330,
    put_wall: 5272,
    max_pain: 5298,
    iv_state: 'cooling',
    event_risk: 'low',
    event_note: 'No event issue, but options tape is stale.',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    },
    last_updated_minutes: {
      theta: 20,
      tradingview: 1,
      uw: 1,
      fmp: 1
    }
  },
  fmp_event_no_short_vol: {
    scenario: 'fmp_event_no_short_vol',
    gamma_regime: 'positive_gamma',
    spot: 5300,
    flip_level: 5288,
    call_wall: 5335,
    put_wall: 5278,
    max_pain: 5304,
    iv_state: 'cooling',
    event_risk: 'high',
    event_note: 'High-impact macro event is due before the close.',
    theta_signal: 'income_supportive',
    fmp_signal: 'event_risk_high',
    tv_structure_event: 'range_holding',
    uw_flow_bias: 'neutral',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'stabilizing',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },
  uw_call_strong_unconfirmed: {
    scenario: 'uw_call_strong_unconfirmed',
    gamma_regime: 'positive_gamma',
    spot: 5298,
    flip_level: 5289,
    call_wall: 5332,
    put_wall: 5274,
    max_pain: 5302,
    iv_state: 'mixed',
    event_risk: 'low',
    event_note: 'Flow improved, but structure still needs confirmation.',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_probe_unconfirmed',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },
  breakout_pullback_pending: {
    scenario: 'breakout_pullback_pending',
    gamma_regime: 'positive_gamma',
    spot: 5318,
    flip_level: 5290,
    call_wall: 5342,
    put_wall: 5280,
    max_pain: 5310,
    iv_state: 'normal',
    event_risk: 'low',
    event_note: 'No major event risk and breakout structure remains intact.',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  }
});

export const DEFAULT_SCENARIO = 'negative_gamma_wait_pullback';

export function getScenarioNames() {
  return Object.keys(SCENARIO_DEFINITIONS);
}

export function getMockScenario(requestedScenario) {
  const definition =
    requestedScenario && SCENARIO_DEFINITIONS[requestedScenario]
      ? SCENARIO_DEFINITIONS[requestedScenario]
      : SCENARIO_DEFINITIONS[DEFAULT_SCENARIO];

  return createScenario(definition);
}
