#!/usr/bin/env node
/* Aqua's self-test (JavaScript port) — simulates a typed conversation and
   checks that her brain and memory work. No audio, no internet, no mic.

   Run:  node tests/smoke.js
*/

"use strict";

const { Memory, Brain } = require("../brain.js");

// A fake localStorage so we can run outside the browser.
function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
}

function main() {
  const storage = makeStorage();
  const mem = new Memory(storage, "aqua.test");
  mem.touchSession();  // app.js does this on startup
  const brain = new Brain(mem);

  console.log("=".repeat(60));
  console.log("SIMULATED FIRST CONVERSATION");
  console.log("=".repeat(60));

  console.log(`\nAqua: ${brain.greeting()}\n`);

  const turns = [
    "Robert",
    "I love fishing and old trucks",
    "I'm a teacher",
    "I live in Dallas",
    "sad today honestly",
    "who are you?",
    "what do you know about me?",
    "I have two dogs",
    "thanks aqua",
    "bye",
  ];

  for (const turn of turns) {
    const reply = brain.respond(turn);
    console.log(`You:  ${turn}`);
    console.log(`Aqua: ${reply}\n`);
  }

  console.log("=".repeat(60));
  console.log("CHECKING HER MEMORY");
  console.log("=".repeat(60));

  if (mem.name !== "Robert") throw new Error(`name was ${JSON.stringify(mem.name)}`);
  console.log(`[ok] remembered the name: ${mem.name}`);

  const texts = mem.allFacts().map((f) => f.text);
  const must = ["fishing", "truck", "teacher", "dallas", "dog"];
  for (const m of must) {
    if (!texts.some((t) => t.toLowerCase().includes(m))) throw new Error(`missing fact "${m}": ${texts}`);
  }
  console.log(`[ok] remembered ${texts.length} facts: ${texts}`);

  // second session: she should greet by name
  mem.save();
  const mem2 = new Memory(storage, "aqua.test");
  mem2.touchSession();
  const brain2 = new Brain(mem2);
  const greeting = brain2.greeting();
  console.log(`\nSecond-session greeting:\nAqua: ${greeting}\n`);
  if (!greeting.includes("Robert")) throw new Error(`greeting didn't use the name: ${greeting}`);
  console.log("[ok] greeted him by name on the second session");

  // she never stores the same fact twice
  const before = mem2.allFacts().length;
  brain2.learnFrom("I love fishing");
  const after = mem2.allFacts().length;
  if (before !== after) throw new Error("duplicate fact was stored");
  console.log("[ok] no duplicate facts");

  console.log("\nALL CHECKS PASSED - Aqua's brain is alive (in JavaScript).");
}

try {
  main();
} catch (e) {
  console.error("\n[FAIL] " + e.message);
  process.exit(1);
}
