/* ============================================================
   Aqua's phone sync — a tiny LAN web server so the boss's phone
   (on the same WiFi) can see the route + job board and check
   things off from the truck. No cloud, no account — your PC is
   the server, guarded by a PIN.

   Pure Node (no Electron), so it's unit-testable. main.js wires
   it up with the real snapshot + op inbox.
   ============================================================ */

"use strict";

const http = require("http");

const MAX_BODY = 64 * 1024;
const OP_KINDS = ["job-done", "job-add", "route-done"];

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/* 6-digit PIN, never starting with 0 (easier to read out loud). */
function makePin() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

function validOp(op) {
  if (!op || typeof op !== "object") return false;
  if (!OP_KINDS.includes(op.kind)) return false;
  if (op.kind === "job-add") return typeof op.text === "string" && op.text.trim().length > 0;
  return typeof op.id === "string" && op.id.length > 0;
}

/* opts: { page (html string), pin, getSnapshot: () => obj, onOp: (op) => result } */
function createSyncServer(opts) {
  opts = opts || {};
  const page = opts.page || "<html><body>Aqua phone sync is running.</body></html>";
  const pin = opts.pin || null;
  const getSnapshot = opts.getSnapshot || (() => ({}));
  const onOp = opts.onOp || (() => ({ ok: true }));

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://sync");
    } catch (e) {
      return json(res, 400, { ok: false, error: "bad request" });
    }
    const authed = !pin || url.searchParams.get("pin") === pin || req.headers["x-sync-pin"] === pin;

    if (req.method === "GET" && url.pathname === "/") {
      const body = Buffer.from(page, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      if (!authed) return json(res, 401, { ok: false, error: "bad pin" });
      return json(res, 200, { ok: true, snapshot: getSnapshot() });
    }

    if (req.method === "POST" && url.pathname === "/api/op") {
      if (!authed) return json(res, 401, { ok: false, error: "bad pin" });
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        let op;
        try {
          op = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (e) {
          return json(res, 400, { ok: false, error: "bad json" });
        }
        if (!validOp(op)) return json(res, 400, { ok: false, error: "bad op" });
        if (op.kind === "job-add") op.text = String(op.text).slice(0, 200);
        let result;
        try {
          result = onOp(op) || { ok: true };
        } catch (e) {
          return json(res, 500, { ok: false, error: "op failed" });
        }
        return json(res, 200, { ok: true, result });
      });
      req.on("error", () => json(res, 500, { ok: false, error: "read failed" }));
      return;
    }

    return json(res, 404, { ok: false, error: "not found" });
  });

  return server;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSyncServer, makePin, validOp, OP_KINDS };
}
