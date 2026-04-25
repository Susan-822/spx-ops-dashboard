import { buildUwSourceStatus, isUwExecutable } from '../normalizer/uw-summary-normalizer.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export function computeUwSourceStatus(snapshot, staleSeconds, now = new Date()) {
  return buildUwSourceStatus(snapshot, { staleSeconds, now });
}

export function getUwSourceStatus(snapshot, options = {}) {
  return computeUwSourceStatus(snapshot, options.staleSeconds ?? 300, options.now ?? new Date());
}

export function mergeUwIntoSignalsCurrent(baseSignalsCurrent, uwSummaryOrOptions = null, maybeOptions = {}) {
  const options =
    uwSummaryOrOptions &&
    typeof uwSummaryOrOptions === 'object' &&
    !Array.isArray(uwSummaryOrOptions) &&
    ('uwSummary' in uwSummaryOrOptions || 'now' in uwSummaryOrOptions || 'staleSeconds' in uwSummaryOrOptions)
      ? uwSummaryOrOptions
      : {
          uwSummary: uwSummaryOrOptions,
          ...maybeOptions
        };

  const {
    uwSummary = null,
    now = new Date(),
    staleSeconds = Number(process.env.UW_SNAPSHOT_STALE_SECONDS ?? 300)
  } = options;

  const result = clone(baseSignalsCurrent ?? {});
  const sourceStatus = computeUwSourceStatus(uwSummary, staleSeconds, now);
  result.source_status = result.source_status ?? {};
  result.source_status.uw = sourceStatus;
  result.uw = uwSummary ?? null;
  result.execution_constraints = result.execution_constraints ?? {};
  result.execution_constraints.uw = {
    available: sourceStatus.state !== 'unavailable' && sourceStatus.state !== 'error',
    executable: isUwExecutable(sourceStatus, uwSummary),
    reason:
      sourceStatus.state === 'unavailable'
        ? 'UW unavailable'
        : sourceStatus.state === 'error'
          ? 'UW error'
          : sourceStatus.stale
            ? 'UW stale'
            : uwSummary?.status === 'partial'
              ? 'UW partial'
              : ''
  };
  result.trade_plan = result.trade_plan ?? {};
  result.trade_plan.uw_ready = result.execution_constraints.uw.executable;
  return result;
}
