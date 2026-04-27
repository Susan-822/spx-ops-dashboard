const API_BASE = 'https://api.unusualwhales.com';

const endpoints = [
  '/api/stock/SPX/spot-exposures/strike',
  '/api/stock/SPX/greek-exposure/strike',
  '/api/stock/SPX/flow-recent',
  '/api/option-trades/flow-alerts?ticker=SPX',
  '/api/stock/SPX/net-prem-ticks',
  '/api/darkpool/recent',
  '/api/market/market-tide',
  '/api/stock/SPX/interpolated-iv',
  '/api/stock/SPX/technical-indicator/VWAP?interval=5min',
  '/api/stock/SPX/technical-indicator/ATR?interval=5min&time_period=14',
  '/api/stock/SPX/technical-indicator/EMA?interval=5min',
  '/api/stock/SPX/max-pain',
  '/api/stock/SPX/oi-per-strike'
];

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function classify(status, payload, rows) {
  if (status === 401 || status === 403) return 'permission_or_header';
  if (status === 404 || status === 422) return 'endpoint_or_parameter';
  if (status >= 400) return 'http_error';
  if (rows.length > 0) return null;
  if (payload && typeof payload === 'object') return 'zero_rows_or_unhandled_response_shape';
  return 'empty_response';
}

async function auditEndpoint(endpoint, apiKey) {
  const url = new URL(endpoint, API_BASE);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    }
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const rows = rowsFromPayload(payload);
  return {
    endpoint,
    http_status: response.status,
    ok: response.ok,
    data_length: rows.length,
    first_item_keys: rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).slice(0, 40) : [],
    error_type: classify(response.status, payload, rows)
  };
}

const apiKey = process.env.UW_API_KEY || '';
if (!apiKey) {
  console.log(JSON.stringify({
    error: 'UW_API_KEY missing in local environment',
    endpoints: endpoints.map((endpoint) => ({
      endpoint,
      http_status: 0,
      ok: false,
      data_length: 0,
      first_item_keys: [],
      error_type: 'missing_local_env'
    }))
  }, null, 2));
  process.exit(0);
}

const results = [];
for (const endpoint of endpoints) {
  try {
    results.push(await auditEndpoint(endpoint, apiKey));
  } catch (error) {
    results.push({
      endpoint,
      http_status: 0,
      ok: false,
      data_length: 0,
      first_item_keys: [],
      error_type: error.name || 'fetch_error'
    });
  }
}

console.log(JSON.stringify(results, null, 2));
