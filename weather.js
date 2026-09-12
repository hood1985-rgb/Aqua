/* ============================================================
   Weather-aware pool tips — pure logic, unit-testable.
   Feeds from Open-Meteo's free forecast API (no key needed).
   ============================================================ */

"use strict";

(function (global) {
  /* daily is Open-Meteo's `daily` object (parallel arrays). */
  function buildTips(daily) {
    const d = daily || {};
    const tips = [];

    const maxTemp = pick(d, "temperature_2m_max", 0);
    const precip = pick(d, "precipitation_sum", 0);
    const wind = pick(d, "windspeed_10m_max", 0);
    const uv = pick(d, "uv_index_max", 0);
    const code = pick(d, "weathercode", 0);

    if (maxTemp >= 32) {
      tips.push("Brutal heat ahead — chlorine burns off fast. Keep it topped up and watch that stabilizer.");
    } else if (maxTemp >= 27) {
      tips.push("Warm and sunny — chlorine demand ticks up, so stay on top of your free chlorine.");
    } else if (maxTemp < 15) {
      tips.push("Cool spell — the pool's basically napping. Chlorine will hold longer; don't overdo it.");
    }

    if (precip > 0) {
      tips.push("Rain's on the way — expect dilution. Retest after it passes and rebalance what got washed out.");
    }

    if (code >= 95) {
      tips.push("Thunderstorms forecast — give it a beat before touching the water.");
    }

    if (wind >= 25) {
      tips.push("Wind's kickin' up — expect debris. Skim the surface and keep that skimmer basket clear.");
    }

    if (uv >= 8) {
      tips.push("High UV — the sun eats chlorine for breakfast. Cyanuric acid (stabilizer) is your friend.");
    }

    if (!tips.length) {
      tips.push("Weather looks gentle — a good day for a service call or two. Test as usual.");
    }

    return tips.slice(0, 4);
  }

  function pick(daily, key, fallback) {
    const arr = daily[key];
    if (!Array.isArray(arr) || !arr.length) return fallback;
    const v = Number(arr[0]);
    return isFinite(v) ? v : fallback;
  }

  function describe(daily) {
    const d = daily || {};
    const hi = Math.round(pick(d, "temperature_2m_max", 0));
    const lo = Math.round(pick(d, "temperature_2m_min", 0));
    const precip = pick(d, "precipitation_sum", 0);
    const code = pick(d, "weathercode", 0);
    const cond = conditionText(code);
    let s = `Today: ${cond}, high ${hi}°F`;
    if (isFinite(Number(daily.temperature_2m_min) && daily.temperature_2m_min[0])) s += `, low ${lo}°F`;
    if (precip > 0) s += `, rain expected`;
    s += ".";
    return s;
  }

  function conditionText(code) {
    if (code === 0) return "clear skies";
    if (code <= 2) return "mostly sunny";
    if (code === 3) return "overcast";
    if (code >= 51 && code <= 57) return "drizzle";
    if (code >= 61 && code <= 67) return "rain";
    if (code >= 71 && code <= 77) return "snow";
    if (code >= 80 && code <= 82) return "showers";
    if (code >= 95) return "thunderstorms";
    return "mixed conditions";
  }

  const Weather = { buildTips, describe, conditionText };
  global.Weather = Weather;
  if (typeof module !== "undefined" && module.exports) module.exports = Weather;
})(typeof window !== "undefined" ? window : globalThis);
