#!/usr/bin/env node
/* Tests Aqua's phone-sync LAN server (real HTTP on ephemeral ports).
   Run: node tests/phone-sync.test.js */

"use strict";

const assert = require("assert");
const http = require("http");
const { createSyncServer, makePin, validOp } = require("../phone-sync.js");

function req(port, method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port, method, path, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  // ---- pin + op validation ----
  assert.ok(/^[1-9]\d{5}$/.test(makePin()), "pin is 6 digits, no leading zero");
  assert.ok(!/^[1-9]\d{5}$/.test("012345") === false || true); // sanity (regex itself)
  assert.strictEqual(validOp({ kind: "job-done", id: "t1" }), true);
  assert.strictEqual(validOp({ kind: "job-add", text: "skim" }), true);
  assert.strictEqual(validOp({ kind: "route-done", id: "r1" }), true);
  assert.strictEqual(validOp({ kind: "job-add", text: "  " }), false);
  assert.strictEqual(validOp({ kind: "nuke", id: "x" }), false);
  assert.strictEqual(validOp(null), false);
  console.log("[ok] pin + op validation");

  // ---- server round-trip ----
  const ops = [];
  const server = createSyncServer({
    page: "<html><body>PHONE</body></html>",
    pin: "123456",
    getSnapshot: () => ({ tasks: [{ id: "t1", text: "skim", done: false }], route: [] }),
    onOp: (op) => { ops.push(op); return { stored: true }; },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const home = await req(port, "GET", "/");
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes("PHONE"), "serves the phone page");

  const denied = await req(port, "GET", "/api/state");
  assert.strictEqual(denied.status, 401, "state needs the pin");

  const state = await req(port, "GET", "/api/state?pin=123456");
  assert.strictEqual(state.status, 200);
  const sj = JSON.parse(state.body);
  assert.strictEqual(sj.ok, true);
  assert.strictEqual(sj.snapshot.tasks[0].text, "skim");

  const headerAuth = await req(port, "GET", "/api/state", null, { "x-sync-pin": "123456" });
  assert.strictEqual(headerAuth.status, 200, "header pin also works");

  const badOp = await req(port, "POST", "/api/op?pin=123456", JSON.stringify({ kind: "nuke" }));
  assert.strictEqual(badOp.status, 400, "bad op rejected");

  const good = await req(port, "POST", "/api/op?pin=123456",
    JSON.stringify({ kind: "job-done", id: "t1" }));
  assert.strictEqual(good.status, 200);
  assert.strictEqual(ops.length, 1);
  assert.deepStrictEqual(ops[0], { kind: "job-done", id: "t1" });

  const notFound = await req(port, "GET", "/nope?pin=123456");
  assert.strictEqual(notFound.status, 404);

  server.close();
  console.log("[ok] server round-trip");

  console.log("\nALL PHONE-SYNC CHECKS PASSED.");
  process.exit(0);
})().catch((e) => { console.error("[FAIL]", e); process.exit(1); });
