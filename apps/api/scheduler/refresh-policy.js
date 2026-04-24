const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const SOURCE_REFRESH_POLICIES = Object.freeze({
  theta: {
    source: 'theta',
    label: 'ThetaData',
    fetch_mode: 'layered_poll',
    default_refresh_ms: 15 * SECOND,
    stale_threshold_ms: 45 * SECOND,
    down_threshold_ms: 3 * MINUTE,
    event_triggers: [
      'spot_near_flip',
      'spot_near_call_wall',
      'spot_near_put_wall',
      'action_candidate'
    ]
  },
  tradingview: {
    source: 'tradingview',
    label: 'TradingView',
    fetch_mode: 'webhook_event',
    default_refresh_ms: 30 * SECOND,
    stale_threshold_ms: 3 * MINUTE,
    down_threshold_ms: 10 * MINUTE,
    event_triggers: [
      'webhook_breakout',
      'webhook_breakdown',
      'webhook_pullback',
      'webhook_invalidation'
    ]
  },
  fmp: {
    source: 'fmp',
    label: 'FMP',
    fetch_mode: 'low_frequency_poll',
    default_refresh_ms: 5 * MINUTE,
    stale_threshold_ms: 15 * MINUTE,
    down_threshold_ms: 60 * MINUTE,
    event_triggers: [
      'macro_event_window',
      'earnings_window',
      'risk_gate_escalation'
    ]
  },
  uw_dom: {
    source: 'uw_dom',
    label: 'UW DOM',
    fetch_mode: 'dom_read',
    default_refresh_ms: 2 * MINUTE,
    stale_threshold_ms: 5 * MINUTE,
    down_threshold_ms: 15 * MINUTE,
    event_triggers: [
      'user_focus_on_uw_tab',
      'manual_refresh',
      'flow_quality_drop'
    ]
  },
  uw_screenshot: {
    source: 'uw_screenshot',
    label: 'UW Screenshot',
    fetch_mode: 'vision_fallback',
    default_refresh_ms: 12 * MINUTE,
    stale_threshold_ms: 20 * MINUTE,
    down_threshold_ms: 45 * MINUTE,
    event_triggers: [
      'dom_unavailable',
      'manual_refresh',
      'vision_recheck'
    ]
  },
  telegram: {
    source: 'telegram',
    label: 'Telegram',
    fetch_mode: 'event_push',
    default_refresh_ms: 0,
    stale_threshold_ms: 15 * MINUTE,
    down_threshold_ms: 60 * MINUTE,
    event_triggers: ['recommended_action_change', 'stale_alert', 'conflict_alert']
  },
  dashboard: {
    source: 'dashboard',
    label: 'Dashboard',
    fetch_mode: 'light_poll',
    default_refresh_ms: 15 * SECOND,
    stale_threshold_ms: 60 * SECOND,
    down_threshold_ms: 3 * MINUTE,
    event_triggers: ['visibility_change', 'scenario_change', 'manual_refresh']
  }
});

export function getSourcePolicy(source) {
  return SOURCE_REFRESH_POLICIES[source] ?? null;
}

export function listSourcePolicies() {
  return Object.values(SOURCE_REFRESH_POLICIES);
}

