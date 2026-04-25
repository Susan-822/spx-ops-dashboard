const { validateUwSummaryPayload } = require("./uw-summary-schema");

const RAW_HTML_PATTERN = /<html|<body|<table|<tr|<td|<div|<!doctype html/i;
const COOKIE_PATTERN = /cookie|sessionid=|session=|x-access-token|authorization:\s*bearer/i;

function containsForbiddenRawContent(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === "string") {
    return RAW_HTML_PATTERN.test(value) || COOKIE_PATTERN.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenRawContent(item));
  }

  if (typeof value === "object") {
    return Object.values(value).some((item) => containsForbiddenRawContent(item));
  }

  return false;
}

async function ingestUwSummary({
  secret,
  env = process.env,
  payload,
  store,
  now = new Date(),
  expectedSecret,
}) {
  const configuredSecret = expectedSecret ?? env.UW_INGEST_SECRET;

  if (!configuredSecret) {
    throw new Error("UW_INGEST_SECRET is not configured");
  }

  if (secret !== configuredSecret) {
    throw new Error("Invalid UW_INGEST_SECRET");
  }

  rejectRawArtifacts(payload);

  const validation = validateUwSummaryPayload(payload);
  if (!validation.ok) {
    throw new Error(`Invalid UW summary payload: ${validation.errors.join("; ")}`);
  }

  await store.set(payload, now);

  return {
    ok: true,
    status: 202,
    accepted: true,
  };
}

function rejectRawArtifacts(payload) {
  if (containsForbiddenRawContent(payload)) {
    const serialized = JSON.stringify(payload);
    if (/<html|<body|<table|<!doctype html/i.test(serialized)) {
      throw new Error("Payload contains forbidden raw HTML");
    }
    if (/cookie|sessionid=|x-access-token|authorization:\s*bearer/i.test(serialized)) {
      throw new Error("Payload contains forbidden cookie/token content");
    }
    throw new Error("Payload contains forbidden raw artifacts");
  }
}

module.exports = {
  ingestUwSummary,
  containsForbiddenRawContent,
  rejectRawArtifacts,
  validateUwSummaryPayload,
};
