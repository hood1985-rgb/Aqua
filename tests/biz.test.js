#!/usr/bin/env node
/* Tests Aqua's shop logic: inventory, text drafts, occasions, invoices.
   Run: node tests/biz.test.js */

"use strict";

const assert = require("assert");
const { Inventory, Texts, Occasions, Invoice } = require("../biz.js");

// ---- inventory ----
{
  assert.deepStrictEqual(Inventory.parseAdd("shock 4 bags"), { item: "shock", qty: 4, unit: "bags" });
  assert.deepStrictEqual(Inventory.parseAdd("muriatic acid 2 gal"), { item: "muriatic acid", qty: 2, unit: "gal" });
  assert.deepStrictEqual(Inventory.parseAdd("test strips 50"), { item: "test strips", qty: 50, unit: "" });
  assert.deepStrictEqual(Inventory.parseAdd("skimmer net"), { item: "skimmer net", qty: 1, unit: "" });
  assert.strictEqual(Inventory.parseAdd(""), null);
  const list = [
    { id: "a", item: "shock", qty: 1, unit: "bags", low: 2 },
    { id: "b", item: "chlorine tablets", qty: 10, unit: "lbs", low: 3 },
  ];
  assert.strictEqual(Inventory.find(list, "2"), list[1]);
  assert.strictEqual(Inventory.find(list, "MURIATIC"), null);
  assert.strictEqual(Inventory.find(list, "chlor"), list[1]);
  assert.strictEqual(Inventory.isLow(list[0]), true);
  assert.strictEqual(Inventory.isLow(list[1]), false);
  assert.deepStrictEqual(Inventory.buyList(list), [list[0]]);
}
console.log("[ok] inventory");

// ---- text drafts ----
{
  assert.strictEqual(Texts.key("late"), "late");
  assert.strictEqual(Texts.key("OMW"), "onmyway");
  assert.strictEqual(Texts.key("done"), "done");
  assert.strictEqual(Texts.key("resched"), "reschedule");
  assert.strictEqual(Texts.key("balance"), "balance");
  assert.strictEqual(Texts.key("pizza"), null);
  assert.strictEqual(Texts.customerName("Smith - 15k gal - sand filter"), "Smith");
  assert.strictEqual(Texts.customerName(""), "there");
  const late = Texts.draft("late", { name: "Smith", mins: 20 });
  assert.ok(/Smith/.test(late) && /20 minutes late/.test(late), "late draft: " + late);
  assert.ok(/on the way/.test(Texts.draft("onmyway", { name: "Jones" })));
  assert.ok(/All done/.test(Texts.draft("done", { name: "Jones" })));
  const bal = Texts.draft("balance", { name: "Jones", amount: "$65.00" });
  assert.ok(/\$65\.00/.test(bal), "balance draft carries the amount");
  assert.strictEqual(Texts.draft("nope", {}), null);
}
console.log("[ok] text drafts");

// ---- occasions ----
{
  assert.deepStrictEqual(Occasions.parseDate("3/14"), { month: 3, day: 14, year: null });
  assert.deepStrictEqual(Occasions.parseDate("3/14/2015"), { month: 3, day: 14, year: 2015 });
  assert.deepStrictEqual(Occasions.parseDate("March 14"), { month: 3, day: 14, year: null });
  assert.deepStrictEqual(Occasions.parseDate("december 25, 1990"), { month: 12, day: 25, year: 1990 });
  assert.strictEqual(Occasions.parseDate("13/45"), null);
  assert.strictEqual(Occasions.parseDate("not a date"), null);
  const now = new Date(2026, 8, 13); // Sep 13 2026
  const list = [
    { id: "1", name: "Robert", type: "birthday", month: 9, day: 13, year: 1986 },
    { id: "2", name: "Angela", type: "birthday", month: 9, day: 16, year: 2016 },
    { id: "3", name: "Mom & Dad", type: "anniversary", month: 10, day: 1, year: 1995 },
    { id: "4", name: "Far Away", type: "birthday", month: 1, day: 5, year: null },
  ];
  const up = Occasions.upcoming(list, now, 7);
  assert.strictEqual(up.length, 2, "two occasions inside 7 days");
  assert.strictEqual(up[0].occ.name, "Robert");
  assert.strictEqual(up[0].inDays, 0);
  assert.strictEqual(up[0].turns, 40);
  assert.strictEqual(up[1].occ.name, "Angela");
  assert.strictEqual(up[1].inDays, 3);
  assert.ok(/TODAY/.test(Occasions.describe(up[0])), "today wording: " + Occasions.describe(up[0]));
  assert.ok(/turns 10/.test(Occasions.describe(up[1])), "turns wording: " + Occasions.describe(up[1]));
  // year wrap: Dec 30 sees Jan 5
  const wrap = Occasions.upcoming(list, new Date(2026, 11, 30), 7);
  assert.ok(wrap.some((u) => u.occ.name === "Far Away"), "wraps past New Year");
}
console.log("[ok] occasions");

// ---- invoice ----
{
  assert.strictEqual(Invoice.money(65), "$65.00");
  assert.strictEqual(Invoice.money("80.5"), "$80.50");
  const stops = [{ text: "Smith - filter" }, { text: "Jones - green pool" }];
  const t = Invoice.totals(stops, 65, { 1: 120 });
  assert.strictEqual(t.lines[0].amount, 65);
  assert.strictEqual(t.lines[1].amount, 120);
  assert.strictEqual(t.total, 185);
  const txt = Invoice.text(stops, 65, { 1: 120 });
  assert.ok(/Smith — \$65\.00/.test(txt) && /Total: \$185\.00/.test(txt), "invoice text:\n" + txt);
  assert.ok(/No route/.test(Invoice.text([], 65, {})));
}
console.log("[ok] invoice");

console.log("\nALL BIZ CHECKS PASSED.");
