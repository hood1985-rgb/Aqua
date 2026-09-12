#!/usr/bin/env node
/* Tests Aqua's pool chemistry math. Run: node tests/pool.test.js */

"use strict";

const assert = require("assert");
const Pool = require("../pool.js");

function close(a, b, tol = 0.5) {
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);
}

// ---- parameter aliases ----
assert.strictEqual(Pool.parseParam("ph"), "ph");
assert.strictEqual(Pool.parseParam("alkalinity"), "ta");
assert.strictEqual(Pool.parseParam("chlorine"), "fc");
assert.strictEqual(Pool.parseParam("hardness"), "ch");
assert.strictEqual(Pool.parseParam("stabilizer"), "cya");
console.log("[ok] parameter aliases");

// ---- amount formatting ----
assert.strictEqual(Pool.formatAmount(128, "fl oz"), "1 gallon");
assert.strictEqual(Pool.formatAmount(32, "fl oz"), "1 quart");
assert.strictEqual(Pool.formatAmount(16, "oz"), "1 lb");
assert.strictEqual(Pool.formatAmount(8, "fl oz"), "1 cup");
console.log("[ok] amount formatting");

// ---- pH correction: 8.0 -> 7.5 in 10k gal, muriatic acid ----
const ph = Pool.recommendDose("ph", 8.0, 7.5, 10000);
assert.strictEqual(ph.ok, true);
assert.strictEqual(ph.direction, "lower");
close(ph.amount, 30);                    // 12 oz per 0.2 pH, delta 0.5 => 30
assert.strictEqual(ph.unit, "fl oz");
assert.ok(ph.summary.includes("muriatic acid"));
console.log("[ok] pH down: ", ph.summary);

// ---- chlorine: 0 -> 3 ppm, 10k gal, 6% bleach ----
const fc = Pool.recommendDose("fc", 0, 3, 10000, "bleach6");
assert.strictEqual(fc.ok, true);
assert.strictEqual(fc.direction, "raise");
close(fc.amount, 32.0, 1.0);             // 10.67 oz/ppm * 3
assert.strictEqual(fc.unit, "fl oz");
assert.ok(fc.summary.includes("6% liquid bleach"));
console.log("[ok] chlorine up: ", fc.summary);

// ---- chlorine with 12.5% liquid (roughly half the dose) ----
const fc12 = Pool.recommendDose("fc", 0, 3, 10000, "liquid12");
close(fc12.amount, 15.4, 1.0);
console.log("[ok] liquid chlorine dose is smaller: ", fc12.summary);

// ---- alkalinity: 60 -> 90, 10k gal ----
const ta = Pool.recommendDose("ta", 60, 90, 10000);
assert.strictEqual(ta.direction, "raise");
close(ta.amount, 72, 1.0);               // 24 oz per 10 ppm * 3
assert.ok(ta.summary.includes("baking soda"));
console.log("[ok] alkalinity up: ", ta.summary);

// ---- gallons scale the dose ----
const small = Pool.recommendDose("fc", 0, 3, 5000, "bleach6");
close(small.amount, 16.0, 1.0);
console.log("[ok] dose scales with pool size");

// ---- in-range returns a friendly note, no product ----
const fine = Pool.recommendDose("ph", 7.5, 7.5, 10000);
assert.strictEqual(fine.inRange, true);
assert.ok(!fine.product);
console.log("[ok] in-range: ", fine.summary);

// ---- missing info ----
assert.strictEqual(Pool.recommendDose("ph", 8.0, 7.5, null).ok, false);
assert.strictEqual(Pool.recommendDose("bogus", 1, 2, 10000).ok, false);
console.log("[ok] missing/bad input handled");

console.log("\nALL POOL CHECKS PASSED.");
