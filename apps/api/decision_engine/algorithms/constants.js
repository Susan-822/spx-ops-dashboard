export const ALGORITHM_THRESHOLDS = Object.freeze({
  gex: {
    high_confidence_min_rows: 5,
    strike_filter_spot_pct: 0.15,
    strike_filter_max_pain_pct: 0.2
  },
  flow: {
    ask_side_attack_ratio: 1.25,
    bid_side_attack_ratio: 0.8,
    large_trade_premium: 100000
  },
  darkpool: {
    large_print_premium: 1000000
  },
  sentiment: {
    risk_on_score: 60,
    risk_off_score: -60
  },
  volatility: {
    elevated_iv_rank: 70,
    panic_iv_rank: 85
  }
});
