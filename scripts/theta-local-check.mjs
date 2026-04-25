import {
  THETADATA_BASE_URL,
  ThetaLocalError,
  thetaCheckTerminal,
  thetaFetchExpirations,
  thetaFetchIndexPrice,
  thetaFetchOptionChainByExp
} from '../apps/api/integrations/thetadata/theta-local-client.js';
import { pickThetaTestExpiration } from '../apps/api/decision_engine/dealer-conclusion-engine.js';

function bool(value) {
  return value === true;
}

async function tryIndex(symbol, baseUrl) {
  try {
    const row = await thetaFetchIndexPrice(symbol, { baseUrl });
    return bool(row && (row.price != null || row.last != null));
  } catch (error) {
    if (error instanceof ThetaLocalError && error.kind === 'permission') {
      return false;
    }
    return false;
  }
}

async function main() {
  const baseUrl = process.env.THETADATA_BASE_URL || THETADATA_BASE_URL;
  const symbol = process.env.THETA_TEST_SYMBOL || 'SPXW';
  const requestedExpiration = process.env.THETA_TEST_EXPIRATION || null;
  const terminal = await thetaCheckTerminal(baseUrl);

  const result = {
    theta_terminal_reachable: terminal.reachable,
    base_url: baseUrl,
    expirations_count: 0,
    selected_expiration: null,
    chain_rows_count: 0,
    greeks_available: false,
    oi_available: false,
    iv_available: false,
    bid_ask_available: false,
    index_spx_price_available: false,
    index_vix_price_available: false,
    SPXW_OPTIONS_OK: false
  };

  if (!terminal.reachable) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let expirations = [];
  try {
    expirations = await thetaFetchExpirations({
      symbol,
      baseUrl
    });
  } catch {}

  result.expirations_count = expirations.length;
  result.selected_expiration = pickThetaTestExpiration(expirations, requestedExpiration);
  result.index_spx_price_available = await tryIndex('SPX', baseUrl);
  result.index_vix_price_available = await tryIndex('VIX', baseUrl);

  if (!result.selected_expiration) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  try {
    const chain = await thetaFetchOptionChainByExp(result.selected_expiration, {
      symbol,
      baseUrl
    });
    result.chain_rows_count = chain.contracts.length;
    result.greeks_available = chain.contracts.some((item) => item.gamma != null || item.delta != null);
    result.oi_available = chain.contracts.some((item) => item.open_interest != null);
    result.iv_available = chain.contracts.some((item) => item.iv != null);
    result.bid_ask_available = chain.contracts.some((item) => item.bid != null && item.ask != null);
    result.SPXW_OPTIONS_OK = chain.contracts.length > 0;
  } catch {}

  console.log(JSON.stringify(result, null, 2));
}

await main();
