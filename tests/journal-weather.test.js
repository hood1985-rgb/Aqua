#!/usr/bin/env node
/* Tests the journal + weather pure logic. Run: node tests/journal-weather.test.js */

"use strict";

const assert = require("assert");
const Journal = require("../journal.js");
const Weather = require("../weather.js");

// ---- journal: today key ----
const key = Journal.todayKey();
assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
console.log("[ok] todayKey:", key);

// ---- journal: local summary ----
const s = Journal.summarizeLocal({
  lines: [
    { u: "I love fishing", a: "Noted — you love fishing." },
    { u: "I'm a teacher", a: "So you work as a teacher — respect." },
  ],
  facts: [{ text: "love fishing" }, { text: "work as a teacher" }],
  name: "Robert",
});
assert.ok(s.includes("2 messages"));
assert.ok(s.includes("Robert") === false); // name not required in local summary
assert.ok(s.includes("2 new things"));
assert.ok(s.includes("fishing"));
console.log("[ok] local summary: ", s);

// ---- journal: prompt builder ----
const p = Journal.buildJournalPrompt({ date: "2026-09-11", transcript: [{ u: "hi", a: "hey" }], name: "Robert" });
assert.ok(p.includes("2026-09-11"));
assert.ok(p.includes("Robert: hi"));
assert.ok(p.includes("Aqua: hey"));
console.log("[ok] journal prompt");

// ---- weather: tips ----
const tips = Weather.buildTips({
  temperature_2m_max: [34],
  precipitation_sum: [5],
  windspeed_10m_max: [30],
  uv_index_max: [9],
  weathercode: [95],
});
assert.ok(tips.some((t) => /chlorine/i.test(t)));
assert.ok(tips.some((t) => /rain/i.test(t)));
assert.ok(tips.some((t) => /wind/i.test(t)));
assert.ok(tips.some((t) => /thunder/i.test(t)));
assert.ok(tips.length <= 4);
console.log("[ok] weather tips:\n   " + tips.join("\n   "));

// gentle weather -> single fallback tip
const gentle = Weather.buildTips({ temperature_2m_max: [22], precipitation_sum: [0], windspeed_10m_max: [8], uv_index_max: [4], weathercode: [1] });
assert.strictEqual(gentle.length, 1);
console.log("[ok] gentle weather: ", gentle[0]);

// ---- weather: describe ----
const desc = Weather.describe({ temperature_2m_max: [30], temperature_2m_min: [18], precipitation_sum: [0], weathercode: [0] });
assert.ok(desc.includes("30°F"));
assert.ok(desc.includes("clear skies"));
console.log("[ok] describe:", desc);

console.log("\nALL JOURNAL & WEATHER CHECKS PASSED.");
