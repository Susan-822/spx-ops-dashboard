#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BASE_URL = 'http://127.0.0.1:25503';
const DEFAULT_SYMBOL = 'SPXW';

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function pickExpiration(payload) {
  if (!Array.isArray(payload)) {
    return null;
  }
  const item = payload.find((entry) => entry?.expiration) || payload[0];
  return item?.expiration || null;
}

function countRows(payload) {
  if (Array.isArray(payload)) {
    return payload.length;
  }
  if (payload && Array.isArray(payload.response)) {
    return payload.response.length;
  }
  if (payload && Array.isArray(payload.rows)) {
    return payload.rows.length;
  }
  return 0;
}

function anyFieldPresent(payload, fields) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.response)
      ? payload.response
      : Array.isArray(payload?.rows)
        ? payload.rows
        : [];
  return rows.some((row) => fields.some((field) => row?.[field] != null));
}

async function maybeFetch(url) {
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}

function envCandidates() {
  return [
    'C:\\Users\\susan\\Downloads\\bridge\\.env',
    path.join(process.cwd(), '.env')
  ];
}

async function detectEnvFile() {
  for (const candidate of envCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

async function main() {
  const baseUrl = process.env.THETA_BASE_URL || DEFAULT_BASE_URL;
  const symbol = process.env.THETA_OPTION_SYMBOL || DEFAULT_SYMBOL;
  const envFile = await detectEnvFile();

  const output = {
    theta_terminal_reachable: false,
    base_url: baseUrl,
    env_file_used: envFile,
    expirations_count: 0,
    selected_expiration: null,
    chain_rows_count: 0,
    greeks_available: false,
    oi_available: false,
    iv_available: false,
    bid_ask_available: false,
    index_spx_price_available: 'unavailable',
    index_vix_price_available: 'unavailable',
    SPXW_OPTIONS_OK: false
  };

  try {
    const expirations = await fetchJson(
      `${baseUrl}/v3/option/list/expirations?symbol=${encodeURIComponent(symbol)}&format=json`
    );
    output.theta_terminal_reachable = true;
    output.expirations_count = Array.isArray(expirations) ? expirations.length : 0;
    output.selected_expiration = pickExpiration(expirations);

    if (output.selected_expiration) {
      const greeks = await maybeFetch(
        `${baseUrl}/v3/option/snapshot/greeks/all?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(output.selected_expiration)}&format=json`
      );
      output.chain_rows_count = countRows(greeks);
      output.greeks_available = anyFieldPresent(greeks, ['delta', 'gamma', 'theta', 'vega', 'vanna', 'charm']);
      output.oi_available = anyFieldPresent(greeks, ['open_interest', 'oi']);
      output.iv_available = anyFieldPresent(greeks, ['iv', 'implied_volatility']);
      output.bid_ask_available = anyFieldPresent(greeks, ['bid', 'ask']);
      output.SPXW_OPTIONS_OK = output.chain_rows_count > 0;
    }
  } catch (error) {
    output.error = error.message;
  }

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.theta_terminal_reachable ? 0 : 1);
}

main();
