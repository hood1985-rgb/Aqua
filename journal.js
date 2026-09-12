/* ============================================================
   Aqua's daily journal — summarizes each day's conversation.
   Pure logic (no DOM) so it can be unit-tested with Node.
   ============================================================ */

"use strict";

(function (global) {
  function todayKey(d) {
    const date = d || new Date();
    return date.toISOString().slice(0, 10);
  }

  /* A short, human summary of the day without needing OpenAI. */
  function summarizeLocal({ lines, facts, name }) {
    lines = lines || [];
    facts = facts || [];
    if (!lines.length) return "";

    const n = lines.length;
    let s = `You two traded ${n} message${n === 1 ? "" : "s"} today.`;

    if (facts.length) {
      const bits = facts.slice(0, 6).map((f) => f.text);
      s += ` She learned ${facts.length} new thing${facts.length === 1 ? "" : "s"}: ${bits.join(", ")}.`;
    }

    const last = lines[lines.length - 1];
    if (last && last.a) {
      const tail = last.a.length > 120 ? last.a.slice(0, 120).replace(/\s+\S*$/, "") + "…" : last.a;
      s += ` You wrapped up on: "${tail}"`;
    }

    return s;
  }

  /* Build the OpenAI prompt for a journal entry in Aqua's voice. */
  function buildJournalPrompt({ date, transcript, name }) {
    const lines = (transcript || [])
      .map((x) => `${name || "Boss"}: ${x.u}\nAqua: ${x.a}`)
      .join("\n");
    return (
      "You are Aqua — a southeast-Texas gal, Navy veteran, and right hand at Hood's Pool Service. " +
      `Below is the transcript of your conversation with ${name || "your boss"} on ${date}. ` +
      "Write a warm, first-person journal entry for that day: 2-3 short sentences capturing what " +
      "you talked about and what you learned about them. Use your natural drawl (y'all, fixin' to) " +
      "but keep it clean. No bullet points, no markdown, no emojis.\n\nTRANSCRIPT:\n" + lines
    );
  }

  const Journal = { todayKey, summarizeLocal, buildJournalPrompt };
  global.Journal = Journal;
  if (typeof module !== "undefined" && module.exports) module.exports = Journal;
})(typeof window !== "undefined" ? window : globalThis);
