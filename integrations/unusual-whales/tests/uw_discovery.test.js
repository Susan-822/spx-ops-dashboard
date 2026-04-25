const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const discoveryDir = path.join(
  process.cwd(),
  "integrations",
  "unusual-whales",
  "discovery",
);

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
