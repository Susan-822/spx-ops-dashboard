const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeNumber,
  sumNullable,
  deriveGammaRegime,
  deriveDealerBehavior,
} = require("./field-utils");

function buildGreekExposurePoc({ pageUrl, rawVisibleFields = {}, status = "partial", lastUpdate = null }) {
  const callGamma = normalizeNumber(rawVisibleFields.call_gamma);
  const putGamma = normalizeNumber(rawVisibleFields.put_gamma);
  const callDelta = normalizeNumber(rawVisibleFields.call_delta);
  const putDelta = normalizeNumber(rawVisibleFields.put_delta);
  const callVanna = normalizeNumber(rawVisibleFields.call_vanna);
  const putVanna = normalizeNumber(rawVisibleFields.put_vanna);
  const callCharm = normalizeNumber(rawVisibleFields.call_charm);
  const putCharm = normalizeNumber(rawVisibleFields.put_charm);

  const netGamma = sumNullable(callGamma, putGamma);
  const netDelta = sumNullable(callDelta, putDelta);
  const netVanna = sumNullable(callVanna, putVanna);
  const netCharm = sumNullable(callCharm, putCharm);

  const availableSections = {
      by_strike: Boolean(rawVisibleFields.by_strike),
      by_expiry: Boolean(rawVisibleFields.by_expiry),
      zero_gamma_or_flip: Boolean(rawVisibleFields.zero_gamma_or_flip),
      last_update: Boolean(lastUpdate || rawVisibleFields.last_update),
  };

  const missingFields = [];
  const manualConfirmationNeeded = [];

  for (const field of [
    "call_charm",
    "call_delta",
    "call_gamma",
    "call_vanna",
    "put_charm",
    "put_delta",
    "put_gamma",
    "put_vanna",
  ]) {
    if (normalizeNumber(rawVisibleFields[field]) === null) {
      missingFields.push(field);
    }
  }

  if (!availableSections.by_strike) manualConfirmationNeeded.push("by_strike");
  if (!availableSections.by_expiry) manualConfirmationNeeded.push("by_expiry");
  if (!availableSections.zero_gamma_or_flip) manualConfirmationNeeded.push("zero_gamma_or_flip");
  if (!availableSections.last_update) manualConfirmationNeeded.push("last_update");

  const normalizedStatus =
    missingFields.length === 8 && manualConfirmationNeeded.length === 4
      ? "not_found"
      : status;

  return {
    source: "unusual_whales_dom",
    ticker: "SPX",
    module: "spx_greek_exposure",
    status: normalizedStatus,
    last_update: lastUpdate || rawVisibleFields.last_update || null,
    page_url: pageUrl,
    raw_visible_fields: rawVisibleFields,
    mapped_fields: {
      call_charm: callCharm,
      call_delta: callDelta,
      call_gamma: callGamma,
      call_vanna: callVanna,
      put_charm: putCharm,
      put_delta: putDelta,
      put_gamma: putGamma,
      put_vanna: putVanna,
    },
    derived: {
      net_gamma: netGamma,
      net_delta: netDelta,
      net_vanna: netVanna,
      net_charm: netCharm,
      gamma_regime: deriveGammaRegime(netGamma),
      dealer_behavior: deriveDealerBehavior(netGamma),
    },
    available_sections: availableSections,
    missing_fields: missingFields,
    manual_confirmation_needed: manualConfirmationNeeded,
    notes: [],
  };
}

function getGreekExposureSampleInput() {
  return {
    pageUrl: "https://unusualwhales.com/stock/SPX/greek-exposure",
    rawVisibleFields: {
      call_charm: null,
      call_delta: null,
      call_gamma: null,
      call_vanna: null,
      put_charm: null,
      put_delta: null,
      put_gamma: null,
      put_vanna: null,
      by_strike: false,
      by_expiry: false,
      zero_gamma_or_flip: false,
      last_update: null,
    },
    status: "partial",
    lastUpdate: null,
  };
}

function writeGreekExposurePocOutput(targetPath, input = getGreekExposureSampleInput()) {
  const payload = buildGreekExposurePoc(input);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
  return payload;
}

module.exports = {
  buildGreekExposurePoc,
  summarizeGreekExposure: buildGreekExposurePoc,
  getGreekExposureSampleInput,
  writeGreekExposurePocOutput,
};
