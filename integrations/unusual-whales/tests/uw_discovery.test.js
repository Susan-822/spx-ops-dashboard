const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const baseDir = path.join(process.cwd(), "integrations", "unusual-whales");
const discoveryDir = path.join(baseDir, "discovery");
const reviewMd = path.join(discoveryDir, "UW_DISCOVERY_REVIEW.md");
const reviewJson = path.join(discoveryDir, "uw_discovery_review.json");
const whitelistMd = path.join(baseDir, "whitelist", "UW_DOM_WHITELIST.md");
const whitelistJson = path.join(baseDir, "whitelist", "uw_dom_whitelist.json");

test("UW discovery curated files exist", () => {
  const expected = [
    "README_BRAVE_UW_DISCOVERY.md",
    "UW_DISCOVERY_REVIEW.md",
    "uw_discovery_review.json",
    "uw_discovery.sh",
    "uw_parse.py",
  ];

  for (const file of expected) {
    assert.equal(fs.existsSync(path.join(discoveryDir, file)), true, `${file} missing`);
  }
});

test("UW review and whitelist files contain no forbidden Chinese alias", () => {
  for (const file of [reviewMd, reviewJson, whitelistMd, whitelistJson]) {
    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("否"), false, `${path.basename(file)} contains forbidden character`);
  }
});

test("UW review JSON only uses allowed modules", () => {
  const allowed = new Set([
    "spx_greek_exposure",
    "volatility_iv",
    "options_flow_alerts",
    "spy_darkpool_offlit",
    "nope",
  ]);

  const review = JSON.parse(fs.readFileSync(reviewJson, "utf8"));
  const modules = review.modules.map((item) => item.module);

  for (const moduleName of modules) {
    assert.equal(allowed.has(moduleName), true, `unexpected module: ${moduleName}`);
  }
});
