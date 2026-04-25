import { validateUwSummaryPayload } from './uw-summary-schema.js';

const FORBIDDEN_TOP_LEVEL_KEYS = new Set([
  'html',
  'raw_html',
  'cookie',
  'cookies',
  'token',
  'authorization',
  'bearer',
  'raw_table',
  'raw_rows',
  'raw_visible_fields'
]);

const RAW_HTML_PATTERN = /<html|<body|<table|<tr|<td|<div|<!doctype html/i;
const FORBIDDEN_SECRET_PATTERN = /cookie|cookies|token|authorization|bearer/i;

export function containsForbiddenRawContent(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    return RAW_HTML_PATTERN.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenRawContent(item));
  }

  if (typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => {
      return FORBIDDEN_TOP_LEVEL_KEYS.has(key) || containsForbiddenRawContent(item);
    });
  }

  return false;
}

export function rejectRawArtifacts(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload must be a JSON object');
  }

  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`Payload contains forbidden field: ${key}`);
    }
  }

  const serialized = JSON.stringify(payload);
  if (RAW_HTML_PATTERN.test(serialized)) {
    throw new Error('Payload contains forbidden raw HTML');
  }

  const forbiddenNestedKeys = Object.keys(payload).filter((key) => FORBIDDEN_SECRET_PATTERN.test(key));
  if (forbiddenNestedKeys.length > 0) {
    throw new Error(`Payload contains forbidden field: ${forbiddenNestedKeys[0]}`);
  }
}

export async function ingestUwSummary({
  secret,
  env = process.env,
  payload,
  store,
  now = new Date(),
  expectedSecret
}) {
  const configuredSecret = expectedSecret ?? env.UW_INGEST_SECRET ?? '';

  if (!configuredSecret) {
    throw new Error('UW_INGEST_SECRET is not configured');
  }

  if (secret !== configuredSecret) {
    throw new Error('Invalid UW_INGEST_SECRET');
  }

  rejectRawArtifacts(payload);

  const validation = validateUwSummaryPayload(payload);
  if (!validation.ok) {
    throw new Error(`Invalid UW summary payload: ${validation.errors.join('; ')}`);
  }

  await store.set(payload, now);

  return {
    ok: true,
    status: 202,
    accepted: true
  };
}
