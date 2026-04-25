const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseDir = path.resolve(__dirname, '..');
const schemaDir = path.join(baseDir, 'schemas');

const expectedSchemas = [
  'uw_summary.schema.json',
  'uw_dealer_snapshot.schema.json',
  'uw_volatility_snapshot.schema.json',
  'uw_flow_snapshot.schema.json',
  'uw_darkpool_snapshot.schema.json',
  'uw_sentiment_snapshot.schema.json',
];

test('all expected UW schemas exist and are valid JSON', () => {
  for (const filename of expectedSchemas) {
    const filePath = path.join(schemaDir, filename);
    assert.equal(fs.existsSync(filePath), true, `${filename} should exist`);

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);

    assert.equal(typeof parsed, 'object', `${filename} should parse to object`);
    assert.equal(typeof parsed.$schema, 'string', `${filename} should include $schema`);
    assert.equal(typeof parsed.title, 'string', `${filename} should include title`);
    assert.equal(parsed.type, 'object', `${filename} should be object schema`);
  }
});
