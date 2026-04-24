const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const SOURCE_REFRESH_POLICIES = Object.freeze({
  dashboard: {
    source: 'dashboard',
    label: 'Dashboard',
    fetch_mode: 'light_poll',
    default_refresh_ms: 5 * SECOND,
    stale_threshold_ms: 15 * SECOND,
    down_threshold_ms: 60 * SECOND,
    event_triggers: ['visibility_change', 'scenario_change', 'manual_refresh']
  },
  tradingview: {
    source: 'tradingview',
    label: 'TradingView',
    fetch_mode: 'webhook_event',
    default_refresh_ms: 0,
    stale_threshold_ms: 5 * MINUTE,
    down_threshold_ms: 15 * MINUTE,
    event_triggers: ['webhook_breakout', 'webhook_breakdown', 'webhook_pullback', 'webhook_invalidation']
  },
  theta_core: {
    source: 'theta_core',
    label: 'ThetaData Core',
    fetch_mode: 'layered_poll',
    default_refresh_ms: 30 * SECOND,
    stale_threshold_ms: 30 * SECOND,
    down_threshold_ms: 5 * MINUTE,
    event_triggers: ['spot_near_flip', 'spot_near_call_wall', 'spot_near_put_wall', 'manual_refresh']
  },
  theta_full_chain: {
    source: 'theta_full_chain',
    label: 'ThetaData Full Chain',
    fetch_mode: 'layered_scan',
    default_refresh_ms: 3 * MINUTE,
    stale_threshold_ms: 5 * MINUTE,
    down_threshold_ms: 15 * MINUTE,
    event_triggers: ['home_needs_recalc', 'manual_refresh']
  },
  fmp_event: {
    source: 'fmp_event',
    label: 'FMP Event',
    fetch_mode: 'low_frequency_poll',
    default_refresh_ms: 120 * SECOND,
    stale_threshold_ms: 10 * MINUTE,
    down_threshold_ms: 30 * MINUTE,
    event_triggers: ['macro_event_window', 'earnings_window', 'risk_gate_escalation']
  },
  fmp_price: {
    source: 'fmp_price',
    label: 'FMP Price',
    fetch_mode: 'quote_short_poll',
    default_refresh_ms: 60 * SECOND,
    stale_threshold_ms: 2 * MINUTE,
    down_threshold_ms: 10 * MINUTE,
    event_triggers: ['price_refresh', 'manual_refresh', 'spot_unavailable']
  },
  uw_dom: {
    source: 'uw_dom',
    label: 'UW DOM',
    fetch_mode: 'dom_read',
    default_refresh_ms: 120 * SECOND,
    stale_threshold_ms: 5 * MINUTE,
    down_threshold_ms: 10 * MINUTE,
    event_triggers: ['tv_key_event', 'manual_refresh', 'user_focus_on_uw_tab']
  },
  uw_screenshot: {
    source: 'uw_screenshot',
    label: 'UW Screenshot',
    fetch_mode: 'vision_fallback',
    default_refresh_ms: 12 * MINUTE,
    stale_threshold_ms: 15 * MINUTE,
    down_threshold_ms: 30 * MINUTE,
    event_triggers: ['dom_unavailable', 'tv_key_event', 'manual_refresh']
  },
  scheduler_health: {
    source: 'scheduler_health',
    label: 'Scheduler / Health',
    fetch_mode: 'health_poll',
    default_refresh_ms: 30 * SECOND,
    stale_threshold_ms: 60 * SECOND,
    down_threshold_ms: 3 * MINUTE,
    event_triggers: ['fixed_check']
  },
  telegram: {
    source: 'telegram',
    label: 'Telegram',
    fetch_mode: 'event_push',
    default_refresh_ms: 0,
    stale_threshold_ms: 10 * MINUTE,
    down_threshold_ms: 30 * MINUTE,
    event_triggers: ['recommended_action_change', 'stale_alert', 'conflict_alert', 'high_risk_alert']
  }
});

export function getSourcePolicy(source) {
  return SOURCE_REFRESH_POLICIES[source] ?? null;
}

export function listSourcePolicies() {
  return Object.values(SOURCE_REFRESH_POLICIES);
}
