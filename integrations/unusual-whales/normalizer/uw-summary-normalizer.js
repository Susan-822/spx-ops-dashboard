const FLOW_BIAS = new Set(['bullish', 'bearish', 'mixed', 'unavailable']);
const INSTITUTIONAL_ENTRY = new Set(['none', 'building', 'bombing', 'unavailable']);
const DARKPOOL_BIAS = new Set(['support', 'resistance', 'neutral', 'unavailable']);
const VOLATILITY_LIGHT = new Set(['red', 'yellow', 'green', 'unavailable']);
const MARKET_TIDE = new Set(['risk_on', 'risk_off', 'mixed', 'unavailable']);
const DEALER_CROSSCHECK = new Set(['confirm', 'conflict', 'unavailable']);
const STATUS_VALUES = new Set(['live', 'stale', 'partial', 'unavailable', 'error']);

function pickEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function normalizeWarnings(warnings = []) {
  return Array.isArray(warnings) ? warnings.filter((item) => typeof item === 'string') : [];
}

function normalizeMissingFields(missingFields = []) {
  return Array.isArray(missingFields) ? missingFields.filter((item) => typeof item === 'string') : [];
}

function normalizeStatus(snapshot, { stale = false } = {}) {
  const requestedStatus = String(snapshot?.status || '').toLowerCase();
  if (requestedStatus === 'error') return 'error';
  if (requestedStatus === 'unavailable') return 'unavailable';
  if (stale) return 'stale';
  if (requestedStatus === 'partial') return 'partial';
  if (requestedStatus === 'live') return 'live';
  return 'unavailable';
}

export function normalizeUwSummary(snapshot, { stale = false } = {}) {
  const status = normalizeStatus(snapshot, { stale });
  const unavailableLike = status === 'unavailable' || status === 'stale' || status === 'error';
  const qualityStatus = unavailableLike
    ? status
    : pickEnum(snapshot?.quality?.data_quality, STATUS_VALUES, status === 'partial' ? 'partial' : 'live');

  if (!snapshot) {
    return {
      uw: {
        source: 'unusual_whales',
        status: 'unavailable',
        last_update: null,
        flow: {
          flow_bias: 'unavailable',
          institutional_entry: 'unavailable'
        },
        darkpool: {
          darkpool_bias: 'unavailable'
        },
        volatility: {
          volatility_light: 'unavailable'
        },
        sentiment: {
          market_tide: 'unavailable'
        },
        dealer_crosscheck: {
          state: 'unavailable'
        },
        quality: {
          data_quality: 'unavailable',
          missing_fields: [],
          warnings: ['uw_snapshot_missing']
        }
      }
    };
  }

  return {
    uw: {
      source: 'unusual_whales',
      status,
      last_update: snapshot.last_update ?? null,
      flow: {
        flow_bias: unavailableLike
          ? 'unavailable'
          : pickEnum(snapshot?.flow?.flow_bias, FLOW_BIAS, 'unavailable'),
        institutional_entry: unavailableLike
          ? 'unavailable'
          : pickEnum(snapshot?.flow?.institutional_entry, INSTITUTIONAL_ENTRY, 'unavailable')
      },
      darkpool: {
        darkpool_bias: unavailableLike
          ? 'unavailable'
          : pickEnum(snapshot?.darkpool?.darkpool_bias, DARKPOOL_BIAS, 'unavailable')
      },
      volatility: {
        volatility_light: unavailableLike
          ? 'unavailable'
          : pickEnum(snapshot?.volatility?.volatility_light, VOLATILITY_LIGHT, 'unavailable')
      },
      sentiment: {
        market_tide: unavailableLike
          ? 'unavailable'
          : pickEnum(snapshot?.sentiment?.market_tide, MARKET_TIDE, 'unavailable')
      },
      dealer_crosscheck: {
        state: unavailableLike
          ? 'unavailable'
          : pickEnum(snapshot?.dealer_crosscheck?.state, DEALER_CROSSCHECK, 'unavailable')
      },
      quality: {
        data_quality: qualityStatus,
        missing_fields: normalizeMissingFields(snapshot?.quality?.missing_fields),
        warnings: normalizeWarnings(snapshot?.quality?.warnings)
      }
    }
  };
}

export function buildUwSourceStatus(snapshot, { staleSeconds = 300, now = new Date() } = {}) {
  if (!snapshot) {
    return {
      source: 'unusual_whales',
      state: 'unavailable',
      stale: false,
      last_update: null,
      message: 'UW snapshot unavailable'
    };
  }

  const lastUpdate = snapshot?.last_update ? new Date(snapshot.last_update) : null;
  const stale = !lastUpdate
    || Number.isNaN(lastUpdate.getTime())
    || new Date(now).getTime() - lastUpdate.getTime() > Number(staleSeconds) * 1000;
  const status = normalizeStatus(snapshot, { stale });

  return {
    source: 'unusual_whales',
    state:
      status === 'live'
        ? 'real'
        : status === 'partial' || status === 'stale'
          ? 'delayed'
          : status,
    stale: status === 'stale',
    last_update: snapshot.last_update ?? null,
    message:
      status === 'stale'
        ? 'UW snapshot stale'
        : status === 'partial'
          ? 'UW snapshot partial'
          : status === 'error'
            ? 'UW snapshot error'
            : status === 'unavailable'
              ? 'UW snapshot unavailable'
              : ''
  };
}

export function isUwExecutable(sourceStatus, uwSummary) {
  if (!uwSummary || !sourceStatus) {
    return false;
  }

  if (['unavailable', 'error'].includes(sourceStatus.state)) {
    return false;
  }

  if (sourceStatus.stale) {
    return false;
  }

  return String(uwSummary.status || '').toLowerCase() === 'live'
    && String(uwSummary.quality?.data_quality || '').toLowerCase() === 'live';
}
