/* ============================================================
   Aqua's small tools — reminders & service jobs.
   Pure logic (no DOM) so it can be unit-tested with Node.
   ============================================================ */

"use strict";

(function (global) {
  function nowISO() {
    return new Date().toISOString();
  }

  const MINUTE = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;

  const UNITS = {
    sec: 1000, secs: 1000, second: 1000, seconds: 1000,
    min: MINUTE, mins: MINUTE, minute: MINUTE, minutes: MINUTE,
    hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
    day: DAY, days: DAY,
  };

  /* "in 20 minutes to check the pH" -> { at, message } */
  function parseReminder(text) {
    const t = String(text || "").trim();

    let m = /^in\s+(\d+(?:\.\d+)?)\s+(secs?|seconds?|mins?|minutes?|hrs?|hours?|days?)\b\s*(.*)$/i.exec(t);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = UNITS[m[2].toLowerCase()];
      if (isFinite(n) && unit) {
        return { at: Date.now() + n * unit, message: m[3].trim() || "Reminder" };
      }
    }

    m = /^timer\s+(\d+(?:\.\d+)?)\s*(secs?|seconds?|mins?|minutes?|hrs?|hours?)?\s*(.*)$/i.exec(t);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = UNITS[(m[2] || "min").toLowerCase()] || MINUTE;
      return { at: Date.now() + n * unit, message: m[3].trim() || "Timer's up." };
    }

    m = /^at\s+(\d{1,2}):(\d{2})\s*(.*)$/i.exec(t);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (h <= 23 && min <= 59) {
        const d = new Date();
        d.setHours(h, min, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return { at: d.getTime(), message: m[3].trim() || "Reminder" };
      }
    }

    m = /^at\s+(\d{1,2})\s*(am|pm)\s*(.*)$/i.exec(t);
    if (m) {
      let h = parseInt(m[1], 10);
      const ap = m[2].toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h <= 23) {
        const d = new Date();
        d.setHours(h, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return { at: d.getTime(), message: m[3].trim() || "Reminder" };
      }
    }

    return null;
  }

  const Reminders = {
    add(list, entry) {
      entry = entry || {};
      entry.id = "r" + Date.now() + Math.random().toString(36).slice(2, 6);
      entry.created = nowISO();
      entry.fired = false;
      list.push(entry);
      return entry;
    },
    due(list, now = Date.now()) {
      return (list || []).filter((r) => r.at <= now && !r.fired);
    },
    pending(list) {
      return (list || []).filter((r) => !r.fired).sort((a, b) => a.at - b.at);
    },
    remove(list, id) {
      const i = (list || []).findIndex((r) => r.id === id);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    },
  };

  const Tasks = {
    add(list, text) {
      const task = {
        id: "t" + Date.now() + Math.random().toString(36).slice(2, 6),
        text: String(text || "").trim(),
        date: nowISO(),
        done: false,
      };
      list.push(task);
      return task;
    },
    open(list) {
      return (list || []).filter((t) => !t.done);
    },
    done(list) {
      return (list || []).filter((t) => t.done);
    },
    toggle(list, id) {
      const t = (list || []).find((x) => x.id === id);
      if (t) t.done = !t.done;
      return !!t;
    },
    remove(list, id) {
      const i = (list || []).findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    },
  };

  const Tools = { parseReminder, Reminders, Tasks };
  global.Tools = Tools;
  if (typeof module !== "undefined" && module.exports) module.exports = Tools;
})(typeof window !== "undefined" ? window : globalThis);
