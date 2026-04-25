const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const baseDir = path.resolve(__dirname, "..");
const schemaDir = path.join(baseDir, "schemas");

const expectedSchemas = [
  "uw_summary.schema.json",
  "uw_dealer_snapshot.schema.json",
  "uw_volatility_snapshot.schema.json",
  "uw_flow_snapshot.schema.json",
  "uw_darkpool_snapshot.schema.json",
  "uw_sentiment_snapshot.schema.json",
];

test("all expected UW schemas exist and are valid JSON", () => {
  for (const filename of expectedSchemas) {
    const filePath = path.join(schemaDir, filename);
    assert.equal(fs.existsSync(filePath), true, `${filename} should exist`);

    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);

    assert.equal(typeof parsed, "object", `${filename} should parse to object`);
    assert.equal(typeof parsed.$schema, "string", `${filename} should include $schema`);
    assert.equal(typeof parsed.title, "string", `${filename} should include title`);
    assert.equal(parsed.type, "object", `${filename} should be object schema`);
  }
});

test("summary schema is aligned with source and status contract", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(schemaDir, "uw_summary.schema.json"), "utf8"),
  );

  assert.equal(schema.properties.source.const, "unusual_whales_dom");
  assert.deepEqual(schema.properties.status.enum, ["live", "stale", "error", "partial"]);
  assert.equal(schema.properties.dealer.type, "object");
  assert.equal(schema.properties.volatility.type, "object");
});

test("dealer and volatility schemas describe POC output structure", () => {
  const dealer = JSON.parse(
    fs.readFileSync(path.join(schemaDir, "uw_dealer_snapshot.schema.json"), "utf8"),
  );
  const volatility = JSON.parse(
    fs.readFileSync(path.join(schemaDir, "uw_volatility_snapshot.schema.json"), "utf8"),
  );

  assert.equal(dealer.properties.module.const, "spx_greek_exposure");
  assert.ok(dealer.properties.mapped_fields);
  assert.ok(dealer.properties.derived);
  assert.ok(volatility.properties.module.const, "volatility_iv");
  assert.ok(volatility.properties.volatility_activation_candidate);
});
