function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function createScenario(definition) {
  const timestamp = new Date().toISOString();

  return {
    timestamp,
    symbol: 'SPX',
    timeframe: '1D',
    is_mock: true,
    fetch_mode: 'mock_scenario',
    uw_fetch_path: definition.uw_fetch_path ?? 'dom',
    last_updated: {
      theta: isoSecondsAgo(definition.last_updated_seconds?.theta ?? 15),
      theta_full_chain: isoMinutesAgo(definition.last_updated_minutes?.theta_full_chain ?? 3),
      tradingview: isoSecondsAgo(definition.last_updated_seconds?.tradingview ?? 30),
      uw: isoSecondsAgo(definition.last_updated_seconds?.uw ?? 90),
      fmp: isoSecondsAgo(definition.last_updated_seconds?.fmp ?? 120),
      scheduler_health: isoSecondsAgo(definition.last_updated_seconds?.scheduler_health ?? 30)
    },
    ...definition
  };
}

const SCENARIO_DEFINITIONS = Object.freeze({
  negative_gamma_wait_pullback: {
    scenario: 'negative_gamma_wait_pullback',
    gamma_regime: 'negative',
    spot: 5252,
    flip_level: 5285,
    call_wall: 5320,
    put_wall: 5225,
    max_pain: 5275,
    iv_state: 'elevated',
    event_risk: 'low',
    event_note: '无重大事件，但负 Gamma 下波动更容易被放大。',
    theta_signal: 'bearish_pressure',
    fmp_signal: 'clear',
    tv_structure_event: 'pullback_not_confirmed',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'defensive',
    uw_fetch_path: 'dom',
    advanced_greeks: {
      vanna: 'negative',
      charm: 'negative'
    }
  },
  positive_gamma_income_watch: {
    scenario: 'positive_gamma_income_watch',
    gamma_regime: 'positive',
    spot: 5312,
    flip_level: 5286,
    call_wall: 5338,
    put_wall: 5270,
    max_pain: 5308,
    iv_state: 'cooling',
    event_risk: 'low',
    event_note: '事件日历偏空，若波动继续回落才考虑收入型策略。',
    theta_signal: 'income_supportive',
    fmp_signal: 'clear',
    tv_structure_event: 'range_holding',
    uw_flow_bias: 'neutral',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'stabilizing',
    uw_fetch_path: 'dom',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },
  flip_conflict_wait: {
    scenario: 'flip_conflict_wait',
    gamma_regime: 'critical',
    spot: 5281,
    flip_level: 5280,
    call_wall: 5310,
    put_wall: 5258,
    max_pain: 5280,
    iv_state: 'mixed',
    event_risk: 'low',
    event_note: '价格贴着 flip 震荡，方向信号容易来回打架。',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakdown_confirmed',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'supportive',
    uw_fetch_path: 'dom',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'flat'
    }
  },
  theta_stale_no_trade: {
    scenario: 'theta_stale_no_trade',
    gamma_regime: 'positive',
    spot: 5304,
    flip_level: 5282,
    call_wall: 5330,
    put_wall: 5272,
    max_pain: 5298,
    iv_state: 'cooling',
    event_risk: 'low',
    event_note: '结构看起来不差，但 ThetaData 已明显过期。',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    uw_fetch_path: 'dom',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    },
    last_updated_seconds: {
      theta: 70
    }
  },
  fmp_event_no_short_vol: {
    scenario: 'fmp_event_no_short_vol',
    gamma_regime: 'positive',
    spot: 5300,
    flip_level: 5288,
    call_wall: 5335,
    put_wall: 5278,
    max_pain: 5304,
    iv_state: 'cooling',
    event_risk: 'high',
    event_note: 'FMP 事件风险很高，卖波动率与铁鹰都要先关掉。',
    theta_signal: 'income_supportive',
    fmp_signal: 'event_risk_high',
    tv_structure_event: 'range_holding',
    uw_flow_bias: 'neutral',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'stabilizing',
    uw_fetch_path: 'dom',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },
  uw_call_strong_unconfirmed: {
    scenario: 'uw_call_strong_unconfirmed',
    gamma_regime: 'positive',
    spot: 5298,
    flip_level: 5289,
    call_wall: 5332,
    put_wall: 5274,
    max_pain: 5302,
    iv_state: 'mixed',
    event_risk: 'low',
    event_note: 'UW 明显偏多，但价格还没有走出确认结构。',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_probe_unconfirmed',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    uw_fetch_path: 'screenshot',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },
  breakout_pullback_pending: {
    scenario: 'breakout_pullback_pending',
    gamma_regime: 'positive',
    spot: 5318,
    flip_level: 5290,
    call_wall: 5342,
    put_wall: 5280,
    max_pain: 5310,
    iv_state: 'normal',
    event_risk: 'low',
    event_note: '价格上破后仍保持强势，但更适合等回踩不破再接。',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    uw_fetch_path: 'dom',
    advanced_greeks: {
      vanna: 'positive',
      charm: 'positive'
    }
  },

  // ── 验收测试专用场景（E2E Test Scenarios） ─────────────────────────────────

  // T1: 震荡锁仓 — 正 Gamma + 微弱 flow，价格在 ATM 锁仓区内
  // 断言：主控卡片 LOCKED，做市商路径 atm_fmt=7260，plan.direction=null
  e2e_test_locked: {
    scenario: 'e2e_test_locked',
    gamma_regime: 'positive',
    spot: 7258,
    flip_level: 7220,
    call_wall: 7300,
    put_wall: 7200,
    max_pain: 7260,
    iv_state: 'normal',
    event_risk: 'low',
    event_note: '无重大事件，正 Gamma 磁吸，价格在 ATM 锁仓区内震荡。',
    theta_signal: 'income_supportive',
    fmp_signal: 'clear',
    tv_structure_event: 'range_holding',
    uw_flow_bias: 'neutral',
    uw_dark_pool_bias: 'neutral',
    uw_dealer_bias: 'stabilizing',
    uw_fetch_path: 'dom',
    advanced_greeks: { vanna: 'positive', charm: 'flat' },
    // [验收测试] 精确注入 flow_factors：微弱震荡，net_premium 接近 0
    mock_flow_factors: {
      net_premium_5m: 800000,       // +$0.8M，远低于 5M 阈值，不触发 isBullishFlow
      call_premium_5m: 45000000,    // $45M Call
      put_premium_5m: -44200000,    // $44.2M Put
      put_call_ratio: 0.98,         // 接近 1，无明确方向
      net_premium: 800000,
      directional_net_premium: 800000
    }
  },

  // T2: 逼空多头 — 正 Gamma + 强 Call Flow(+12M)，价格突破锁仓区
  // 断言：主控卡片 LONG_CALL/LONG_READY，A单方向 BULLISH，atm_fmt=7265
  e2e_test_bull: {
    scenario: 'e2e_test_bull',
    gamma_regime: 'positive',
    spot: 7267,
    flip_level: 7220,
    call_wall: 7300,
    put_wall: 7200,
    max_pain: 7260,
    iv_state: 'cooling',
    event_risk: 'low',
    event_note: '机构扫货，Call Flow 强劲，价格突破 7265 锁仓上沿。',
    theta_signal: 'bullish_pullback',
    fmp_signal: 'clear',
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    uw_flow_bias: 'bullish',
    uw_dark_pool_bias: 'bullish',
    uw_dealer_bias: 'supportive',
    uw_fetch_path: 'dom',
    advanced_greeks: { vanna: 'positive', charm: 'positive' },
    // [验收测试] 精确注入 flow_factors：强 Call Flow，净流入 +$12M
    mock_flow_factors: {
      net_premium_5m: 12000000,     // +$12M，远超 5M 阈值，触发 isBullishFlow
      call_premium_5m: 108000000,   // $108M Call（机构扫货）
      put_premium_5m: -24000000,    // $24M Put
      put_call_ratio: 0.22,         // P/C 极低，机构筹码
      net_premium: 12000000,
      directional_net_premium: 12000000
    }
  },

  // T3: Gamma 倒转暴跌 — 负 Gamma + 强 Put Flow(-15M)，价格跌破支撑
  // 断言：主控卡片 SHORT_PUT，A单方向 BEARISH，做市商路径显示负 Gamma 放波
  e2e_test_bear: {
    scenario: 'e2e_test_bear',
    gamma_regime: 'negative',
    spot: 7198,
    flip_level: 7220,
    call_wall: 7280,
    put_wall: 7150,
    max_pain: 7220,
    iv_state: 'elevated',
    event_risk: 'low',
    event_note: '负 Gamma 放波，价格跌破 Gamma Flip 7220，空头单边行情。',
    theta_signal: 'bearish_pressure',
    fmp_signal: 'clear',
    tv_structure_event: 'breakdown_confirmed',
    uw_flow_bias: 'bearish',
    uw_dark_pool_bias: 'bearish',
    uw_dealer_bias: 'defensive',
    uw_fetch_path: 'dom',
    advanced_greeks: { vanna: 'negative', charm: 'negative' },
    // [验收测试] 精确注入 flow_factors：强 Put Flow，净流出 -$15M
    mock_flow_factors: {
      net_premium_5m: -15000000,    // -$15M，远超 -5M 阈值，触发 isBearishFlow
      call_premium_5m: 18000000,    // $18M Call
      put_premium_5m: -33000000,    // $33M Put（机构砸盘）
      put_call_ratio: 1.83,         // P/C > 1.5，空头信号
      net_premium: -15000000,
      directional_net_premium: -15000000
    },
    // [验收测试] 精确注入 spot 和 gamma_flip，强制 gamma_regime=negative
    mock_spot: 7198,          // 跌破 Gamma Flip 7220，触发负 Gamma
    mock_gamma_flip: 7220,    // Gamma Flip 锚点
    mock_darkpool_state: null  // 中性暗池，不触发 lower_brake_zone 吸收
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
