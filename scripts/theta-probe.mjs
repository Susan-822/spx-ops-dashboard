import {
  THETADATA_BASE_URL,
  ThetaLocalError,
  thetaCheckTerminal,
  thetaFetchExpirations,
  thetaFetchIndexPrice,
  thetaFetchOptionChainByExp
} from '../apps/api/integrations/thetadata/theta-local-client.js';
import {
  calculateThetaDealerSummary,
  pickThetaTestExpiration
} from '../apps/api/decision_engine/dealer-conclusion-engine.js';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function probeIndexEndpoint(symbol) {
  try {
    await thetaFetchIndexPrice(symbol);
    return 'pass';
  } catch (error) {
    if (error instanceof ThetaLocalError && error.kind === 'permission') {
      return 'permission_unavailable';
    }
    return 'fail';
  }
}

async function main() {
  const baseUrl = process.env.THETADATA_BASE_URL || THETADATA_BASE_URL;
  const symbol = process.env.THETA_TEST_SYMBOL || 'SPX';
  const requestedExpiration = process.env.THETA_TEST_EXPIRATION || null;
  const terminalStatus = await thetaCheckTerminal(baseUrl);

  const result = {
    theta_terminal_reachable: terminalStatus.reachable,
    base_url: baseUrl,
    permission: {
      stock: 'free_or_unknown',
      options: 'standard_or_unknown',
      index: 'free_or_unavailable',
      rate: 'free_or_unknown'
    },
    index_endpoints: {
      spx_price: 'fail',
      vix_price: 'fail'
    },
    options_endpoints: {
      expirations: 'fail',
      option_chain: 'fail',
      option_detail: 'fail',
      greeks: 'fail',
      open_interest: 'fail',
      iv: 'fail',
      bid_ask: 'fail'
    },
    test_expiration: null,
    sample_fields: {
      strike: false,
      right: false,
      bid: false,
      ask: false,
      iv: false,
      gamma: false,
      open_interest: false
    },
    usable_for_dealer_engine: false,
    missing_fields: [],
    warnings: [],
    sample_counts: {
      strikes: 0,
      calls: 0,
      puts: 0
    }
  };

  if (!terminalStatus.reachable) {
    result.warnings.push(terminalStatus.error || 'theta_terminal_unreachable');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  result.index_endpoints.spx_price = await probeIndexEndpoint('SPX');
  result.index_endpoints.vix_price = await probeIndexEndpoint('VIX');

  let expirations = [];
  try {
    expirations = await thetaFetchExpirations({ symbol, baseUrl });
    result.options_endpoints.expirations = expirations.length > 0 ? 'pass' : 'partial';
  } catch (error) {
    result.options_endpoints.expirations = 'fail';
    result.warnings.push(error.message);
  }

  const testExpiration = pickThetaTestExpiration(expirations, requestedExpiration);
  result.test_expiration = testExpiration;

  if (!testExpiration) {
    result.warnings.push('no_test_expiration_available');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  try {
    const chain = await thetaFetchOptionChainByExp(testExpiration, { symbol, baseUrl });
    result.options_endpoints = {
      ...result.options_endpoints,
      ...chain.endpoint_status
    };

    const summary = calculateThetaDealerSummary({
      ticker: symbol,
      status: 'live',
      spot_source: process.env.THETA_TEST_SPOT ? 'manual_test' : 'unavailable',
      spot: process.env.THETA_TEST_SPOT ?? null,
      test_expiration: testExpiration,
      contracts: chain.contracts,
      warnings: chain.warnings
    });

    result.sample_fields = {
      strike: summary.metadata.sample_fields.strike,
      right: summary.metadata.sample_fields.right,
      bid: summary.metadata.sample_fields.bid,
      ask: summary.metadata.sample_fields.ask,
      iv: summary.metadata.sample_fields.iv,
      gamma: summary.metadata.sample_fields.gamma,
      open_interest: summary.metadata.sample_fields.open_interest
    };
    result.sample_counts = {
      strikes: unique(chain.contracts.map((item) => item.strike)).length,
      calls: chain.contracts.filter((item) => item.right === 'C').length,
      puts: chain.contracts.filter((item) => item.right === 'P').length
    };
    result.missing_fields = summary.quality.missing_fields;
    result.warnings = unique([...result.warnings, ...summary.quality.warnings, ...chain.warnings]);
    result.usable_for_dealer_engine = chain.contracts.length > 0;
  } catch (error) {
    result.warnings.push(error.message);
  }

  console.log(JSON.stringify(result, null, 2));
}

await main();
