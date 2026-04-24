import { listSourcePolicies } from './refresh-policy.js';

export function createSchedulerState() {
  return {
    enabled: true,
    mode: 'design-calibrated-mock',
    is_mock: true,
    jobs: listSourcePolicies().map((policy) => ({
      source: policy.source,
      fetch_mode: policy.fetch_mode,
      default_refresh_ms: policy.default_refresh_ms,
      stale_threshold_ms: policy.stale_threshold_ms,
      down_threshold_ms: policy.down_threshold_ms,
      event_triggers: policy.event_triggers
    })),
    message: 'Scheduler design is calibrated for timed refresh, event-triggered refresh, and stale/down evaluation.'
  };
}
