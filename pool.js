/* ============================================================
   Aqua's pool-service toolkit — chemistry math for Hood's Pool
   Service. Pure logic (no DOM), so it can be unit-tested with
   Node and used from the app.

   Doses are standard "per 10,000 gallons" approximations used by
   pool pros — always test your water before dosing.
   ============================================================ */

"use strict";

(function (global) {
  /* Approximate dose rates, per 10,000 US gallons. */
  const CHEM = {
    fc: {
      name: "Free Chlorine",
      unit: "ppm",
      min: 1,
      max: 4,
      defaultTarget: 3,
      lower: {
        note: "Chlorine burns off on its own — turn off the chlorinator, let the sun work, or use a chlorine neutralizer (sodium thiosulfate).",
      },
      raise: {
        products: {
          bleach6:  { name: "6% liquid bleach",              perPpmPer10k: 10.67, unit: "fl oz" },
          liquid12: { name: "12.5% liquid chlorine (shock)", perPpmPer10k: 5.12,  unit: "fl oz" },
          calhypo:  { name: "cal-hypo granules (68%)",       perPpmPer10k: 2.3,   unit: "oz" },
        },
      },
    },
    ph: {
      name: "pH",
      unit: "",
      min: 7.4,
      max: 7.6,
      defaultTarget: 7.5,
      lower: { product: "muriatic acid (31.45%)",           perUnitPer10k: 12, perDelta: 0.2, unit: "fl oz" },
      raise: { product: "soda ash (sodium carbonate)",      perUnitPer10k: 6,  perDelta: 0.2, unit: "oz" },
    },
    ta: {
      name: "Total Alkalinity",
      unit: "ppm",
      min: 80,
      max: 120,
      defaultTarget: 90,
      lower: { product: "muriatic acid (31.45%)", perUnitPer10k: null, perDelta: 1, unit: "fl oz",
               note: "Lower TA slowly — add acid in small doses near a return jet with the pump running, then retest." },
      raise: { product: "baking soda (sodium bicarbonate)", perUnitPer10k: 24, perDelta: 10, unit: "oz" },
    },
    ch: {
      name: "Calcium Hardness",
      unit: "ppm",
      min: 200,
      max: 400,
      defaultTarget: 275,
      raise: { product: "calcium chloride", perUnitPer10k: 20, perDelta: 10, unit: "oz" },
    },
    cya: {
      name: "Cyanuric Acid (stabilizer)",
      unit: "ppm",
      min: 30,
      max: 50,
      defaultTarget: 40,
      raise: { product: "stabilizer (cyanuric acid)", perUnitPer10k: 21, perDelta: 10, unit: "oz" },
      lower: { note: "CYA only comes down by draining and refilling some water." },
    },
    salt: {
      name: "Salt",
      unit: "ppm",
      min: 2700,
      max: 3400,
      defaultTarget: 3000,
      raise: { product: "pool salt", perUnitPer10k: 8.4, perDelta: 100, unit: "lb" },
    },
  };

  const ALIASES = {
    fc: "fc", chlorine: "fc", freechlorine: "fc",
    ph: "ph", "ph level": "ph",
    ta: "ta", alkalinity: "ta",
    ch: "ch", hardness: "ch", calcium: "ch",
    cya: "cya", stabilizer: "cya",
    salt: "salt",
  };

  const DEFAULT_POOL = { gallons: null, chlorineType: "bleach6", surface: null };

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function parseParam(word) {
    return ALIASES[String(word || "").toLowerCase().trim()] || null;
  }

  function formatAmount(amount, unit) {
    const a = Math.abs(amount);
    switch (unit) {
      case "fl oz":
        if (a >= 128) return `${round1(a / 128)} gallon${a === 128 ? "" : "s"}`;
        if (a >= 32) return `${round1(a / 32)} quart${a === 32 ? "" : "s"}`;
        if (a >= 8) return `${round1(a / 8)} cup${a === 8 ? "" : "s"}`;
        return `${round1(a)} fl oz`;
      case "oz":
        if (a >= 16) return `${round1(a / 16)} lb`;
        return `${round1(a)} oz`;
      case "lb":
        return `${round1(a)} lb`;
      default:
        return `${round1(a)}`;
    }
  }

  function recommendDose(param, current, target, gallons, chlorineType) {
    const spec = CHEM[param];
    if (!spec) return { ok: false, error: `I don't know the "${param}" test. I know: fc, ph, ta, ch, cya, salt.` };

    current = Number(current);
    target = Number(target);
    gallons = Number(gallons);

    if (!isFinite(current) || !isFinite(target)) {
      return { ok: false, error: "Give me numbers, darlin' — like /chem ph 8.0 7.5." };
    }
    if (!isFinite(gallons) || gallons <= 0) {
      return { ok: false, error: "Tell me the pool size first — /pool set 15000 for a 15,000-gallon pool." };
    }

    if (current >= spec.min && current <= spec.max) {
      return {
        ok: true,
        inRange: true,
        param,
        name: spec.name,
        summary: `${spec.name} is already in the ideal range (${spec.min}–${spec.max}${spec.unit ? " " + spec.unit : ""}). Nothin' to add.`,
      };
    }

    const delta = target - current;
    const direction = delta > 0 ? "raise" : "lower";
    const how = spec[direction];

    // A direction with no dosing product (e.g. lowering CYA, or chlorine
    // that needs to burn off) — just explain what to do.
    if (!how || !(how.products || how.perUnitPer10k != null)) {
      const note = (how && how.note) || "No easy chemical for that one — talk to me and we'll figure it out.";
      return { ok: true, param, name: spec.name, direction, note, summary: note };
    }

    let amount, unit, product;
    if (how.products) {
      const p = how.products[chlorineType] || how.products.bleach6;
      amount = p.perPpmPer10k * Math.abs(delta) * (gallons / 10000);
      unit = p.unit;
      product = p.name;
    } else {
      amount = how.perUnitPer10k * (Math.abs(delta) / how.perDelta) * (gallons / 10000);
      unit = how.unit;
      product = how.product;
    }

    amount = round1(amount);
    const verb = direction === "raise" ? "raise" : "lower";
    const pretty = formatAmount(amount, unit);

    const summary =
      `To ${verb} ${spec.name} from ${current} to ${target}` +
      `${spec.unit ? " " + spec.unit : ""} in a ${gallons.toLocaleString("en-US")}-gallon pool, ` +
      `add about ${pretty} of ${product}.`;

    return {
      ok: true,
      param,
      name: spec.name,
      current,
      target,
      direction,
      amount,
      unit,
      product,
      summary,
    };
  }

  const Pool = {
    CHEM,
    DEFAULT_POOL,
    parseParam,
    recommendDose,
    formatAmount,
    chlorineTypes: [
      ["bleach6", "6% liquid bleach"],
      ["liquid12", "12.5% liquid chlorine"],
      ["calhypo", "Cal-hypo granules"],
    ],
  };

  global.Pool = Pool;
  if (typeof module !== "undefined" && module.exports) module.exports = Pool;
})(typeof window !== "undefined" ? window : globalThis);
