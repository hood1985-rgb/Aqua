#!/usr/bin/env node
/* Tests Aqua's audience modes: kid-safe talk, Rhonda's Canadian flavour,
   and the audience-aware system prompt. Run: node tests/audience.test.js */

"use strict";

const assert = require("assert");
const { Memory, Brain, kidSafe, canadianize } = require("../brain.js");

// ---- kid-safe ----
assert.strictEqual(kidSafe("Damn, that's hot."), "Darn, that's hot.");
assert.strictEqual(kidSafe("What the hell?"), "What the heck?");
assert.strictEqual(kidSafe("Oh shit, it broke."), "Oh shoot, it broke.");
assert.strictEqual(kidSafe("You pissed me off"), "You upset me off");
assert.ok(!/damn/i.test(kidSafe("Damn fine work.")));
assert.strictEqual(kidSafe("You're a smart cookie!"), "You're a smart cookie!");
console.log("[ok] kidSafe");

// ---- canadianize ----
assert.strictEqual(canadianize("What's your favorite color?", false),
  "What's your favourite colour?");
assert.strictEqual(canadianize("Y'all come back now.", false), "You all come back now.");
assert.strictEqual(canadianize("Howdy, neighbor!", false), "Hey there, neighbour!");
assert.ok(canadianize("Good game.", true).endsWith("eh?"), "addEh appends eh?");
assert.ok(canadianize("Good game.", false).indexOf("eh?") === -1, "no eh without the flag");
assert.ok(!/cheque/.test(canadianize("Check the filter.", false)), "pool talk stays intact");
assert.strictEqual(canadianize("Great win!", true), "Great win! Eh?");
console.log("[ok] canadianize");

// ---- audience-aware system prompt ----
{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const mem = new Memory(storage);
  const brain = new Brain(mem);
  const plain = brain.systemPrompt();
  assert.ok(!/YOUNG CHILD/.test(plain), "default prompt has no child section");
  assert.ok(!/Rhonda Hood/.test(plain), "default prompt has no Rhonda section");
  const kid = brain.systemPrompt({ child: true, rhonda: false });
  assert.ok(/YOUNG CHILD/.test(kid), "child prompt present for kids");
  assert.ok(!/Rhonda Hood/.test(kid), "no Rhonda section for kids");
  const rhonda = brain.systemPrompt({ child: false, rhonda: true });
  assert.ok(/Rhonda Hood/.test(rhonda), "Rhonda prompt present for Rhonda");
  assert.ok(!/YOUNG CHILD/.test(rhonda), "no child section for Rhonda");
  const es = brain.systemPrompt({ child: false, rhonda: false, spanish: true });
  assert.ok(/ESPA\u00d1OL/.test(es), "spanish prompt present in spanish mode");
  assert.ok(!/ESPA\u00d1OL/.test(plain), "no spanish section by default");
}
console.log("[ok] systemPrompt audience modes");

console.log("\nALL AUDIENCE CHECKS PASSED.");
