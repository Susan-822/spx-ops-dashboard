/**
 * Capital Flow Reading Engine
 * 
 * 类似 Gemini 的实时资金解读引擎：
 * - 聚合 5m/15m/日内资金变化
 * - 判断资金是否与价格配合
 * - 生成 Gemini 级别的人话解读
 * - 决定 A 单是否可执行
 */

function _fmt(val, prefix = false) {
  if (val == null) return '--';
  const num = Number(val);
  const sign = prefix && num > 0 ? '+' : '';
  if (Math.abs(num) >= 1_000_000) {
    return sign + (num / 1_000_000).toFixed(1) + 'M';
  } else if (Math.abs(num) >= 1_000) {
    return sign + (num / 1_000).toFixed(1) + 'K';
  }
  return sign + num.toFixed(0);
}

export function buildCapitalFlowReading(signal) {
  const fb = signal.flow_behavior_engine || {};
  const uwFlow = signal.uw_normalized?.flow || {};
  const mr = signal.money_read || {};
  const pc = signal.price_contract || {};
  
  // 1. 获取各个窗口的数据
  const netPrem = fb.net_premium ?? null;
  const callPrem = fb.call_premium_abs ?? null;
  const putPrem = fb.put_premium_abs ?? null;
  
  const delta5m = fb.flow_5m_delta ?? null;
  const delta15m = fb.flow_15m_delta ?? null;
  
  const pcVol = fb.pc_volume_ratio ?? null;
  const pcPrem = fb.pc_premium_ratio ?? null;
  
  // 2. 判断资金方向
  const dominantSide = netPrem > 0 ? 'CALL' : netPrem < 0 ? 'PUT' : 'NEUTRAL';
  
  // 3. 价格配合度判断 (Price Validation)
  // 简化版：通过 flow_behavior 里的 behavior 和 flow_state 来推断
  const behavior = fb.behavior || 'neutral';
  let flowVsPriceText = '资金与价格方向待确认。';
  let priceAligned = false;
  
  if (behavior === 'put_squeezed') {
    flowVsPriceText = 'Put 权利金重，但价格没有继续跌破 ATM，下方有托，资金与价格背离。';
    priceAligned = false;
  } else if (behavior === 'call_capped') {
    flowVsPriceText = 'Call 资金流入，但价格未突破上方阻力，上方有压，资金与价格背离。';
    priceAligned = false;
  } else if (behavior === 'put_effective') {
    flowVsPriceText = 'Put 权利金持续扩大，价格同步跌破锁仓区，空头资金和价格同向。';
    priceAligned = true;
  } else if (behavior === 'call_effective') {
    flowVsPriceText = 'Call 资金持续流入，价格同步突破上方阻力，多头资金和价格同向。';
    priceAligned = true;
  } else if (behavior === 'mixed') {
    flowVsPriceText = '多空资金混战，价格在区间内震荡。';
    priceAligned = false;
  }
  
  // 4. 组装人话 (Narrative)
  let headline = '';
  let detail = '';
  
  if (pcVol > 1.2 && callPrem > putPrem) {
    headline = 'Put 成交量多，说明保护盘重；但 Call 权利金更大，说明大资金没有完全转空。';
    detail = '当前不是追 Put 的盘，要看价格能不能跌破 ATM 下沿。';
  } else if (pcVol > 1.2 && putPrem > callPrem) {
    if (behavior === 'put_squeezed') {
      headline = 'Put 偏重，但价格跌不动，说明下方有托，追 Put 风险高。';
      detail = '保护盘 + 做市商吸收，这不是干净空头。';
    } else {
      headline = 'Put 权利金和成交量双高，空头情绪主导。';
      detail = '空头资金压制明显，关注下方支撑是否破位。';
    }
  } else if (pcVol < 0.8 && callPrem > putPrem) {
    if (behavior === 'call_capped') {
      headline = 'Call 偏重，但价格涨不动，说明上方有压，追多风险高。';
      detail = '资金有多头尝试，但被上方卖盘吸收。';
    } else {
      headline = 'Call 权利金和成交量双高，多头情绪主导。';
      detail = '大资金真推方向，关注上方阻力是否突破。';
    }
  } else if (fb.flow_quality === 'DEGRADED') {
    headline = 'Flow 数据降级（窗口数据不足或缓存复用）。';
    detail = '只能参考，不能指挥交易，必须等价格确认。';
  } else {
    headline = '多空资金相对均衡。';
    detail = '等待明显的方向性资金流入。';
  }
  
  // 5. 对交易的影响 (Trade Impact)
  let usableForTrade = false;
  let tradeImpactText = '';
  
  if (fb.flow_quality === 'DEGRADED') {
    usableForTrade = false;
    tradeImpactText = '数据降级，A 单仅显示预案，不可执行。';
  } else if (priceAligned && fb.dual_window_aligned) {
    usableForTrade = true;
    tradeImpactText = '资金和价格同向，5m/15m 趋势一致，A 单条件具备时可执行。';
  } else if (!priceAligned) {
    usableForTrade = false;
    tradeImpactText = '资金与价格背离，A 单仅显示预案，不可执行。';
  } else if (fb.dual_window_conflict) {
    usableForTrade = false;
    tradeImpactText = '5m 和 15m 资金方向冲突，动能不稳，A 单不可执行。';
  } else {
    usableForTrade = false;
    tradeImpactText = '资金动能不足以直接推升价格，等待进一步确认。';
  }
  
  return {
    headline,
    detail,
    five_min_money_in: _fmt(delta5m, true),
    fifteen_min_money_in: _fmt(delta15m, true),
    day_net_money: _fmt(netPrem, true),
    call_premium_total: _fmt(callPrem, false),
    put_premium_total: _fmt(putPrem, false),
    pc_volume_ratio: pcVol != null ? pcVol.toFixed(2) : '--',
    pc_premium_ratio: pcPrem != null ? pcPrem.toFixed(2) : '--',
    flow_vs_price_text: flowVsPriceText,
    trade_impact_text: tradeImpactText,
    usable_for_trade: usableForTrade,
    behavior: behavior
  };
}
