import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_THETA_BASE_URL = 'http://127.0.0.1:25503';
const DEFAULT_BRIDGE_ENV_PATHS = [
  'C:\\Users\\susan\\Downloads\\bridge\\.env',
  path.resolve(process.cwd(), '.env')
];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    thetaOnly: args.has('--theta-only'),
    uwOnly: args.has('--uw-only'),
    all: args.has('--all'),
    once: args.has('--once')
  };
}

async function readFirstEnvFile() {
  for (const envPath of DEFAULT_BRIDGE_ENV_PATHS) {
    try {
      const raw = await fs.readFile(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
      return envPath;
    } catch {}
  }
  return null;
}

function printEnvStatus(envPath) {
  console.log(`env_file_used=${envPath || 'none'}`);
  console.log(`CLOUD_URL present: ${Boolean(process.env.CLOUD_URL)}`);
  console.log(`DATA_PUSH_API_KEY present: ${Boolean(process.env.DATA_PUSH_API_KEY)}`);
  console.log(`UW_BEARER_TOKEN present: ${Boolean(process.env.UW_BEARER_TOKEN)}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} ${response.status}`);
  }
  return response.json();
}

function pickSelectedExpiration(expirations = []) {
  return expirations[0]?.expiration || expirations[0]?.date || null;
}

function buildThetaPayload({ expirations, selectedExpiration, chainPreview }) {
  return {
    source: 'theta_terminal',
    status: selectedExpiration ? 'partial' : 'unavailable',
    expirations_count: expirations.length,
    selected_expiration: selectedExpiration,
    chain_preview_rows: chainPreview.length,
    generated_at: new Date().toISOString()
  };
}

async function runThetaOnly() {
  const symbol = process.env.THETA_SYMBOL || 'SPXW';
  const baseUrl = process.env.THETA_BASE_URL || DEFAULT_THETA_BASE_URL;
  const expirations = await fetchJson(`${baseUrl}/v3/option/list/expirations?symbol=${encodeURIComponent(symbol)}&format=json`);
  const selectedExpiration = pickSelectedExpiration(expirations.response || expirations);
  let chainPreview = [];
  if (selectedExpiration) {
    try {
      const greeks = await fetchJson(
        `${baseUrl}/v3/option/snapshot/greeks/all?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(selectedExpiration)}&format=json`
      );
      chainPreview = Array.isArray(greeks.response) ? greeks.response.slice(0, 5) : [];
    } catch {
      chainPreview = [];
    }
  }

  const payload = buildThetaPayload({
    expirations: expirations.response || expirations || [],
    selectedExpiration,
    chainPreview
  });

  if (process.env.CLOUD_URL && process.env.DATA_PUSH_API_KEY) {
    const res = await fetch(`${process.env.CLOUD_URL.replace(/\/$/, '')}/ingest/theta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.DATA_PUSH_API_KEY
      },
      body: JSON.stringify(payload)
    });
    console.log(`theta_ingest_status=${res.status}`);
  } else {
    console.log('theta_ingest_status=skipped_missing_cloud_config');
  }

  console.log(JSON.stringify({
    mode: 'theta-only',
    base_url: baseUrl,
    symbol,
    selected_expiration: selectedExpiration,
    chain_preview_rows: chainPreview.length
  }, null, 2));
}

async function runUwOnly() {
  if (!process.env.UW_BEARER_TOKEN) {
    console.log('uw_status=skipped_missing_uw_token');
    return;
  }
  console.log('uw_status=token_present_but_repo_has_no_real_uw_api_client');
}

async function main() {
  const args = parseArgs(process.argv);
  const envPath = await readFirstEnvFile();
  printEnvStatus(envPath);

  if (args.thetaOnly) {
    await runThetaOnly();
    return;
  }

  if (args.uwOnly) {
    await runUwOnly();
    return;
  }

  if (args.all || (!args.thetaOnly && !args.uwOnly)) {
    await runThetaOnly();
    await runUwOnly();
    if (args.once) {
      return;
    }
    return;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
