import test from 'node:test';
import assert from 'node:assert/strict';
import { runRawNoteV2 } from '../index.js';

function base(overrides = {}) {
  return {
    fmp_conclusion: { status: 'live', spot_is_real: true, spot: 5300, event_risk: 'normal' },
    uw_conclusion: {
      status: 'live',
      net_gex: -100,
      call_wall: 5350,
      put_wall: 5288,
      zero_gamma: 5310,
      max_pain: 5300,
      gamma_regime: 'negative',
      flow_available: true,
      flow_bias: 'bearish',
      flow_strength: 'strong',
      darkpool_available: true,
      darkpool_bias: 'bearish',
      market_tide: 'bearish',
      rvol: 2.1,
      greeks_available: true,
      dealer_confirm: 'confirm'
    },
    theta_conclusion: { status: 'disabled', role: 'disabled', em_available: false },
    tv_sentinel: { status: 'matched', fresh: true, event_type: 'retest_failed' },
    volatility_activation: { state: 'active' },
    channel_shape: { state: 'expansion_channel' },
    command_environment: { time_to_close_minutes: 120 },
    price_sources: { spx: { price: 5300, status: 'live' } },
    ...overrides
  };
}

test('FMP spot unavailable -> blocked', () => {
  const result = runRawNoteV2(base({ fmp_conclusion: { status: 'live', spot_is_real: false, spot: null, event_risk: 'normal' } }));
  assert.equal(result.final_decision.state, 'blocked');
});

test('event blocked -> blocked', () => {
  const result = runRawNoteV2(base({ fmp_conclusion: { status: 'live', spot_is_real: true, spot: 5300, event_risk: 'blocked' } }));
  assert.equal(result.final_decision.state, 'blocked');
});

test('time_to_close < 15min -> blocked', () => {
  const result = runRawNoteV2(base({ command_environment: { time_to_close_minutes: 10 } }));
  assert.equal(result.final_decision.state, 'blocked');
});

test('UW unavailable -> blocked', () => {
  const result = runRawNoteV2(base({ uw_conclusion: { ...base().uw_conclusion, status: 'unavailable' } }));
  assert.equal(result.final_decision.state, 'blocked');
});

test('UW live + TV waiting -> wait / 0 position', () => {
  const result = runRawNoteV2(base({ tv_sentinel: { status: 'waiting' } }));
  assert.equal(result.final_decision.state, 'wait');
  assert.equal(result.final_decision.position_multiplier, 0);
});

test('UW partial gamma + flow available -> B only / 0.5x before TV', () => {
  const result = runRawNoteV2(base({ uw_conclusion: { ...base().uw_conclusion, greeks_available: false, flow_available: true }, tv_sentinel: { status: 'waiting' } }));
  assert.equal(result.final_decision.state, 'wait');
  assert.deepEqual(result.final_decision.allowed_setups.filter((setup) => setup.startsWith('A_')), []);
  assert.equal(result.final_decision.position_multiplier, 0);
});

test('UW flow bearish + dealer bearish + TV retest_failed -> B_short actionable', () => {
  const result = runRawNoteV2(base());
  assert.equal(result.final_decision.state, 'actionable');
  assert.equal(result.final_decision.trade_plan.setup, 'B_short_candidate');
});

test('volatility inactive removes A setups', () => {
  const result = runRawNoteV2(base({ volatility_activation: { state: 'inactive' }, tv_sentinel: { status: 'waiting' } }));
  assert.ok(!result.final_decision.allowed_setups.some((setup) => setup.startsWith('A_')));
});

test('volatility expansion blocks iron condor', () => {
  const result = runRawNoteV2(base({ volatility_activation: { state: 'expansion' }, tv_sentinel: { status: 'waiting' } }));
  assert.ok(!result.final_decision.allowed_setups.includes('iron_condor_observe'));
});

test('channel chop -> blocked', () => {
  const result = runRawNoteV2(base({ channel_shape: { state: 'chop' } }));
  assert.equal(result.final_decision.state, 'blocked');
});

test('rvol < 1.5 removes A', () => {
  const result = runRawNoteV2(base({ uw_conclusion: { ...base().uw_conclusion, rvol: 1.2 }, tv_sentinel: { status: 'waiting' } }));
  assert.ok(!result.final_decision.allowed_setups.some((setup) => setup.startsWith('A_')));
});

test('flow/dealer conflict -> wait', () => {
  const result = runRawNoteV2(base({ uw_conclusion: { ...base().uw_conclusion, flow_bias: 'bullish', darkpool_bias: 'bullish', market_tide: 'bullish' } }));
  assert.equal(result.final_decision.state, 'wait');
});

test('TV unmatched -> wait', () => {
  const result = runRawNoteV2(base({ tv_sentinel: { status: 'matched', fresh: true, event_type: 'breakout_confirmed' } }));
  assert.equal(result.final_decision.state, 'wait');
});

test('TV stale -> blocked', () => {
  const result = runRawNoteV2(base({ tv_sentinel: { status: 'stale', stale: true } }));
  assert.equal(result.final_decision.state, 'blocked');
});

test('structure_invalidated -> invalidated', () => {
  const result = runRawNoteV2(base({ tv_sentinel: { status: 'invalidated', event_type: 'structure_invalidated', fresh: true } }));
  assert.equal(result.final_decision.state, 'invalidated');
});

test('Theta disabled does not block UW live', () => {
  const result = runRawNoteV2(base({ theta_conclusion: { status: 'disabled', role: 'disabled', em_available: false } }));
  assert.equal(result.final_decision.state, 'actionable');
});

test('final_decision feeds Telegram without contradiction', () => {
  const result = runRawNoteV2(base({ tv_sentinel: { status: 'waiting' } }));
  assert.match(result.telegram_text, /WAIT|等确认/);
  assert.doesNotMatch(result.telegram_text, /BLOCKED.*WAIT|WAIT.*BLOCKED|UW live.*UW unavailable|entry missing|stop missing|target missing/is);
});

test('strategy cards always render even missing trade_plan', () => {
  const result = runRawNoteV2(base({ tv_sentinel: { status: 'waiting' } }));
  assert.deepEqual(result.strategy_cards.map((card) => card.strategy_name), ['单腿', '垂直', '铁鹰']);
  assert.ok(result.strategy_cards.every((card) => card.entry_condition));
});
