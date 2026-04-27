import { normalizeBias } from './formatters.js';

function alignedCount(values, target) {
  return values.filter((value) => normalizeBias(value) === target).length;
}

export function applyFlowTree(inputs, ctx) {
  const flow = normalizeBias(inputs.uw_conclusion.flow_bias);
  const darkpool = normalizeBias(inputs.uw_conclusion.darkpool_bias);
  const tide = normalizeBias(inputs.uw_conclusion.market_tide);
  const dealer = ctx.dealer_bias;
  const dealerDirection = dealer?.startsWith('bearish') ? 'bearish' : dealer?.startsWith('bullish') ? 'bullish' : 'neutral';
  const values = [flow, darkpool, tide];
  const directional = ['bullish', 'bearish'];

  if (directional.includes(dealerDirection)) {
    const same = alignedCount(values, dealerDirection);
    const opposite = alignedCount(values, dealerDirection === 'bullish' ? 'bearish' : 'bullish');
    if (same === 3) {
      ctx.confidence += 20;
      ctx.trace.push({ step: 7, rule: 'flow_darkpool_tide_align', effect: '+20 confidence' });
    } else if (same === 2 && opposite === 0) {
      ctx.confidence += 10;
      ctx.trace.push({ step: 7, rule: 'two_flow_sources_align', effect: '+10 confidence' });
    } else if (opposite >= 2 || flow === (dealerDirection === 'bullish' ? 'bearish' : 'bullish')) {
      ctx.confidence -= 20;
      ctx.blocked_setups_reason.push('UW 资金与 Dealer 方向冲突，方向单等待。');
      ctx.allowed_setups = ctx.allowed_setups.filter((setup) => !setup.includes(dealerDirection === 'bullish' ? 'long' : 'short'));
      ctx.trace.push({ step: 7, rule: 'flow_dealer_conflict', effect: 'block conflicting direction' });
    }
  } else if (new Set(values.filter((value) => directional.includes(value))).size > 1) {
    ctx.confidence -= 20;
    ctx.trace.push({ step: 7, rule: 'flow_sources_conflict', effect: '-20 confidence' });
  }

  const technicalBias = normalizeBias(inputs.uw_conclusion.trend_bias);
  if (technicalBias === 'bullish' && flow === 'bearish') {
    ctx.wait_reason = '价格创新高但 flow 净流出，等待确认。';
    ctx.final_state_override = 'wait';
    ctx.trace.push({ step: 7, rule: 'price_high_flow_out', effect: 'wait' });
  }
  if (technicalBias === 'bearish' && flow === 'bullish') {
    ctx.wait_reason = '价格创新低但 flow 净流入，等待确认。';
    ctx.final_state_override = 'wait';
    ctx.trace.push({ step: 7, rule: 'price_low_flow_in', effect: 'wait' });
  }

  return ctx;
}
