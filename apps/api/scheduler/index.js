import { listSourcePolicies } from './refresh-policy.js';
import { getAdaptiveScheduler } from './adaptive-refresh-scheduler.js';
import { getAdaptiveSchedulerMode, getUwQuotaState } from './live-refresh-scheduler.js';

export function createSchedulerState() {
  const adaptiveScheduler = getAdaptiveScheduler();
  const adaptiveState = adaptiveScheduler ? adaptiveScheduler.getState() : null;
  const quotaState = getUwQuotaState ? getUwQuotaState() : {};
  const modeState  = getAdaptiveSchedulerMode ? getAdaptiveSchedulerMode() : { mode: 'normal' };

  return {
    enabled: true,
    mode: adaptiveState?.mode ?? modeState.mode ?? 'normal',
    is_mock: false,
    jobs: listSourcePolicies().map((policy) => ({
      source: policy.source,
      fetch_mode: policy.fetch_mode,
      default_refresh_ms: policy.default_refresh_ms,
      stale_threshold_ms: policy.stale_threshold_ms,
      down_threshold_ms: policy.down_threshold_ms,
      event_triggers: policy.event_triggers
    })),
    message: 'Adaptive UW scheduler active. Mode: ' + (adaptiveState?.mode ?? modeState.mode ?? 'normal'),
    adaptive_uw: adaptiveState
      ? {
          mode:         adaptiveState.mode,
          turbo_reason: adaptiveState.turbo_reason,
          turbo_until:  adaptiveState.turbo_until,
          quota:        adaptiveState.quota,
          endpoints:    adaptiveState.endpoints,
        }
      : {
          mode:  modeState.mode,
          quota: quotaState,
        },
  };
}
