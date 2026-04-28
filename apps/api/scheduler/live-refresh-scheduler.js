const REFRESH_INTERVALS = {
  price: 2000,
  uw_flow: 15000,
  darkpool: 30000,
  market_tide: 30000,
  dealer: 60000,
  volatility: 60000,
  news: 1800000
};

const refreshLog = Object.fromEntries(Object.keys(REFRESH_INTERVALS).map((name) => [name, {
  name,
  last_run_at: null,
  last_status: 'waiting',
  message: '等待首次刷新。'
}]));

let started = false;

function markRefresh(name, status = 'ok', message = 'refresh tick') {
  refreshLog[name] = {
    name,
    last_run_at: new Date().toISOString(),
    last_status: status,
    message
  };
}

export function startLiveRefreshScheduler() {
  if (started) return;
  started = true;
  for (const [name, interval] of Object.entries(REFRESH_INTERVALS)) {
    markRefresh(name, 'ok', `${name} refresh scheduled every ${interval}ms`);
    setInterval(() => {
      markRefresh(name, 'ok', `${name} refresh tick`);
    }, interval).unref?.();
  }
}

export function getLiveRefreshLog() {
  return Object.values(refreshLog);
}

export function getLiveRefreshIntervals() {
  return { ...REFRESH_INTERVALS };
}
