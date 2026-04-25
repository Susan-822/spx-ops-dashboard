const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const whitelistPath = path.join(
  __dirname,
  "..",
  "whitelist",
  "uw_dom_whitelist.json",
);

test("uw whitelist integration order is fixed", () => {
  const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf8"));
  const order = whitelist.integration_order.map((item) => item.module);

  assert.deepEqual(order, [
    "spx_greek_exposure",
    "volatility_iv",
    "options_flow_alerts",
    "spy_darkpool_offlit",
    "nope",
  ]);
});

test("uw whitelist approved_for_dom_poc only contains spx_greek_exposure", () => {
  const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf8"));
  const modules = [
    ...new Set(whitelist.approved_for_dom_poc.map((item) => item.module)),
  ];

  assert.deepEqual(modules, ["spx_greek_exposure"]);
});

test("uw whitelist module fields only use allowed modules", () => {
  const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf8"));
  const allowed = new Set([
    "spx_greek_exposure",
    "volatility_iv",
    "options_flow_alerts",
    "spy_darkpool_offlit",
    "nope",
  ]);

  for (const section of [
    "approved_for_dom_poc",
    "needs_manual_login_confirmation",
    "rejected",
  ]) {
    for (const item of whitelist[section]) {
      assert.equal(allowed.has(item.module), true, `unexpected module: ${item.module}`);
    }
  }
});
