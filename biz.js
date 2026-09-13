/* ============================================================
   Aqua's shop tools — chemical inventory, customer text drafts,
   birthdays/anniversaries, and the invoice helper.
   Pure logic (no DOM) so it's unit-testable with Node.
   ============================================================ */

"use strict";

(function (global) {
  /* ---------------- chemical inventory ----------------
     An item: { id, item, qty, unit, low }.
     qty is a number (or null when just tracking presence). */

  /* "shock 4 bags" -> { item, qty, unit }; "shock" -> { item, qty: 1, unit: "" } */
  function invParseAdd(rest) {
    const t = String(rest || "").trim();
    if (!t) return null;
    const m = /^(.+?)\s+(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(t);
    if (m) {
      return { item: m[1].trim(), qty: parseFloat(m[2]), unit: (m[3] || "").trim() };
    }
    return { item: t, qty: 1, unit: "" };
  }

  /* Find by 1-based number ("2") or name fragment ("muriatic"). */
  function invFind(list, key) {
    const k = String(key || "").trim().toLowerCase();
    if (!k) return null;
    if (/^\d+$/.test(k)) {
      const n = parseInt(k, 10);
      return (list || [])[n - 1] || null;
    }
    return (list || []).find((x) => String(x.item || "").toLowerCase().includes(k)) || null;
  }

  function invLow(item) {
    if (!item || item.qty == null || item.low == null) return false;
    return Number(item.qty) <= Number(item.low);
  }

  function invBuyList(list) {
    return (list || []).filter(invLow);
  }

  const Inventory = { parseAdd: invParseAdd, find: invFind, isLow: invLow, buyList: invBuyList };

  /* ---------------- customer text drafts ---------------- */

  const TEXT_TEMPLATES = {
    late: "Hi {name}! This is Hood's Pool Service — running about {mins} minutes late today. See you soon!",
    onmyway: "Hi {name}! Hood's Pool Service is on the way — see you shortly!",
    done: "Hi {name}! All done at your pool today — water's looking great. 🏊 — Hood's Pool Service",
    reschedule: "Hi {name}, this is Hood's Pool Service — I need to move today's visit. What day works best for you?",
    balance: "Hi {name}! Friendly reminder from Hood's Pool Service — balance due {amount}. Thanks so much!",
  };

  const TEXT_ALIASES = {
    late: "late", runninglate: "late",
    onmyway: "onmyway", on_the_way: "onmyway", omw: "onmyway", here: "onmyway",
    done: "done", finished: "done",
    reschedule: "reschedule", resched: "reschedule", move: "reschedule",
    balance: "balance", pay: "balance", due: "balance",
  };

  function textKey(word) {
    return TEXT_ALIASES[String(word || "").toLowerCase().replace(/[^a-z]/g, "")] || null;
  }

  /* First segment is the name: "Smith - 15k gal" -> "Smith". */
  function customerName(text) {
    return String(text || "").split(/\s+-\s+/)[0].trim() || "there";
  }

  function textDraft(key, vars) {
    const tpl = TEXT_TEMPLATES[key];
    if (!tpl) return null;
    vars = vars || {};
    return tpl
      .replace("{name}", vars.name || "there")
      .replace("{mins}", vars.mins != null ? String(vars.mins) : "20")
      .replace("{amount}", vars.amount || "");
  }

  const Texts = { TEMPLATES: TEXT_TEMPLATES, key: textKey, customerName, draft: textDraft };

  /* ---------------- birthdays & anniversaries ----------------
     An occasion: { id, name, type: "birthday"|"anniversary", month 1-12, day, year|null }. */

  const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sept: 9, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  /* "3/14", "3/14/2015", "March 14", "March 14, 2015" -> { month, day, year } */
  function occParseDate(str) {
    const t = String(str || "").trim();
    if (!t) return null;
    let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
    if (m) {
      const month = parseInt(m[1], 10), day = parseInt(m[2], 10);
      let year = m[3] != null ? parseInt(m[3], 10) : null;
      if (year != null && year < 100) year += year < 30 ? 2000 : 1900;
      return validOccDate(month, day) ? { month, day, year } : null;
    }
    m = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i.exec(t);
    if (m) {
      const month = MONTHS[m[1].toLowerCase()];
      const day = parseInt(m[2], 10);
      const year = m[3] != null ? parseInt(m[3], 10) : null;
      return month && validOccDate(month, day) ? { month, day, year } : null;
    }
    return null;
  }

  function validOccDate(month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return day <= dim;
  }

  function occNextDate(month, day, now) {
    now = now || new Date();
    let d = new Date(now.getFullYear(), month - 1, day);
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      d = new Date(now.getFullYear() + 1, month - 1, day);
    }
    return d;
  }

  /* Occasions within `days` from now, sorted soonest-first.
     Each result: { occ, date, inDays, turns } (turns = age/years, if year known). */
  function occUpcoming(list, now, days) {
    now = now || new Date();
    days = days == null ? 7 : days;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = [];
    for (const occ of (list || [])) {
      if (!occ || !occ.month || !occ.day) continue;
      const date = occNextDate(occ.month, occ.day, now);
      const inDays = Math.round((date - today) / 86400000);
      if (inDays < 0 || inDays > days) continue;
      out.push({
        occ,
        date,
        inDays,
        turns: occ.year ? date.getFullYear() - occ.year : null,
      });
    }
    out.sort((a, b) => a.inDays - b.inDays);
    return out;
  }

  function occDescribe(u) {
    const o = u.occ;
    const what = o.type === "anniversary" ? "anniversary" : "birthday";
    const when = u.inDays === 0 ? "TODAY" : u.inDays === 1 ? "tomorrow" : `in ${u.inDays} days (${u.date.toLocaleDateString("en-US", { weekday: "long" })})`;
    const turns = u.turns ? ` — turns ${u.turns}` : "";
    return `${o.name}'s ${what} is ${when}${turns}!`;
  }

  const Occasions = {
    MONTHS, parseDate: occParseDate, nextDate: occNextDate,
    upcoming: occUpcoming, describe: occDescribe,
  };

  /* ---------------- invoice helper ---------------- */

  function money(n) {
    return "$" + Number(n || 0).toFixed(2);
  }

  /* stops: [{ text }], def: default amount, overrides: { index0: amount }. */
  function invoiceTotals(stops, def, overrides) {
    overrides = overrides || {};
    const lines = (stops || []).map((s, i) => ({
      text: s.text,
      amount: overrides[i] != null ? Number(overrides[i]) : Number(def) || 0,
    }));
    const total = lines.reduce((a, l) => a + l.amount, 0);
    return { lines, total };
  }

  function invoiceText(stops, def, overrides) {
    if (!stops || !stops.length) return "No route — line up today's stops first, then I'll total them up.";
    const { lines, total } = invoiceTotals(stops, def, overrides);
    const body = lines.map((l, i) => `${i + 1}. ${customerName(l.text)} — ${money(l.amount)}`).join("\n");
    return `Today's invoice (${lines.length} stop${lines.length === 1 ? "" : "s"}):\n${body}\nTotal: ${money(total)}`;
  }

  const Invoice = { money, totals: invoiceTotals, text: invoiceText };

  global.Inventory = Inventory;
  global.Texts = Texts;
  global.Occasions = Occasions;
  global.Invoice = Invoice;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Inventory, Texts, Occasions, Invoice };
  }
})(typeof window !== "undefined" ? window : globalThis);
