#!/usr/bin/env node
/* Tests Aqua's reminders & jobs. Run: node tests/tools.test.js */

"use strict";

const assert = require("assert");
const Tools = require("../tools.js");
const { parseReminder, Reminders, Tasks } = Tools;

// ---- duration parsing ----
let r = parseReminder("in 20 minutes to check the pH");
assert.ok(r, "should parse a duration");
assert.ok(Math.abs(r.at - Date.now() - 20 * 60000) < 5000, "~20 min from now");
assert.strictEqual(r.message, "to check the pH");

r = parseReminder("in 2 hours to backwash");
assert.ok(Math.abs(r.at - Date.now() - 2 * 3600000) < 10000, "~2 hr from now");
assert.strictEqual(r.message, "to backwash");
console.log("[ok] duration parsing");

// ---- timer shorthand ----
r = parseReminder("timer 5");
assert.ok(r, "timer should parse");
assert.ok(Math.abs(r.at - Date.now() - 5 * 60000) < 5000, "~5 min");
assert.ok(r.message.includes("Timer"), "timer message");
console.log("[ok] timer shorthand");

// ---- clock parsing ----
r = parseReminder("at 15:30 check the Smiths' filter");
assert.ok(r);
const d = new Date(r.at);
assert.strictEqual(d.getHours(), 15);
assert.strictEqual(d.getMinutes(), 30);
assert.strictEqual(r.message, "check the Smiths' filter");
console.log("[ok] clock parsing");

r = parseReminder("at 3pm call the boss");
assert.ok(r);
assert.strictEqual(new Date(r.at).getHours(), 15);
console.log("[ok] 12-hour clock parsing");

assert.strictEqual(parseReminder("banana phone"), null);
console.log("[ok] garbage rejected");

// ---- reminders list ----
const list = [];
const now = Date.now();
Reminders.add(list, { at: now - 1000, message: "due" });
Reminders.add(list, { at: now + 999999, message: "later" });
assert.strictEqual(Reminders.due(list, now).length, 1);
assert.strictEqual(Reminders.pending(list).length, 2);
assert.strictEqual(Reminders.pending(list)[0].message, "due");
Reminders.remove(list, list[1].id);
assert.strictEqual(list.length, 1);
console.log("[ok] reminders due/pending/remove");

// ---- tasks ----
const tasks = [];
const t1 = Tasks.add(tasks, "check filter");
const t2 = Tasks.add(tasks, "shock the pool");
assert.strictEqual(Tasks.open(tasks).length, 2);
Tasks.toggle(tasks, t1.id);
assert.strictEqual(Tasks.open(tasks).length, 1);
assert.strictEqual(Tasks.open(tasks)[0].text, "shock the pool");
assert.strictEqual(Tasks.done(tasks).length, 1);
Tasks.remove(tasks, t2.id);
assert.strictEqual(tasks.length, 1);
console.log("[ok] tasks add/open/done/remove");

console.log("\nALL TOOL CHECKS PASSED.");
