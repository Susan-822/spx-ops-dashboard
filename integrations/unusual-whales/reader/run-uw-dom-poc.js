#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  buildGreekExposurePoc,
  DEFAULT_GREEK_POC_OUTPUT,
} = require("./greek-exposure-poc");
const {
  buildVolatilityPoc,
  DEFAULT_VOLATILITY_POC_OUTPUT,
} = require("./volatility-poc");

const OUTPUT_DIR = path.join(__dirname, "output");
const GREEK_OUTPUT = path.join(OUTPUT_DIR, "uw_greek_exposure_dom_poc.json");
const VOL_OUTPUT = path.join(OUTPUT_DIR, "uw_volatility_dom_poc.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadOptionalJson(filePath) {
  if (!filePath) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const greekVisibleFields = loadOptionalJson(process.env.UW_GREEK_VISIBLE_FIELDS_FILE);
  const volatilityVisibleFields = loadOptionalJson(process.env.UW_VOL_VISIBLE_FIELDS_FILE);

  const greek = buildGreekExposurePoc({
    pageUrl: process.env.UW_GREEK_PAGE_URL || "https://unusualwhales.com/stock/SPX/greek-exposure",
    visibleFields: greekVisibleFields || DEFAULT_GREEK_POC_OUTPUT.raw_visible_fields,
  });
  const volatility = buildVolatilityPoc({
    visibleFields: volatilityVisibleFields || {},
  });

  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(GREEK_OUTPUT, JSON.stringify(greek, null, 2));
  fs.writeFileSync(VOL_OUTPUT, JSON.stringify(volatility, null, 2));

  console.log(`Wrote ${GREEK_OUTPUT}`);
  console.log(`Wrote ${VOL_OUTPUT}`);
}

if (require.main === module) {
  main();
}
