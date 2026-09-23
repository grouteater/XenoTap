// Deterministic daily puzzle generation.
//
// Every day's 6 cities come from a seeded PRNG keyed on the date string.
// To avoid repeats without any stored history file, the game replays every
// day from LAUNCH_DATE forward in memory, so "recently used" is itself
// derived from the seed. Same date in = same cities out, on every device.

import { CONFIG } from "./config.js?v=17";

// ---- Dates ------------------------------------------------------------------

export function todayET(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CONFIG.TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Seconds until the next midnight in the puzzle timezone.
export function secondsUntilRollover(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CONFIG.TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => +parts.find((p) => p.type === t).value;
  return 86400 - (get("hour") * 3600 + get("minute") * 60 + get("second"));
}

const DAY_MS = 86400000;
const toUTC = (d) => Date.parse(d + "T00:00:00Z");
export const addDays = (d, n) => new Date(toUTC(d) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
export const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(toUTC(d)) && addDays(d, 0) === d;
export const puzzleNumber = (d) => daysBetween(CONFIG.LAUNCH_DATE, d) + 1;

// ---- Seeded randomness --------------------------------------------------------

function hashString(str) { // FNV-1a 32 bit, then a final avalanche
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

function distKm(a, b) { // city rows: [name, ci, region, lat, lng, ...]
  const r = Math.PI / 180;
  const h = Math.sin(((b[3] - a[3]) * r) / 2) ** 2 + Math.cos(a[3] * r) * Math.cos(b[3] * r) * Math.sin(((b[4] - a[4]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- Puzzle generation ----------------------------------------------------------

let DATA = null;
let citiesByCountry = null;
const poolCache = new Map(); // "kind:round" -> { kind, byCountry: city idx arrays, flat: city idx array }
const history = []; // history[n] = city indices for day n (0 = LAUNCH_DATE)

const isAfrica = (k) => DATA.countries[k].continent === "Africa";
const fameKey = (ci) => (DATA.cities[ci][7] === 2 ? "famous" : DATA.cities[ci][7] === 1 ? "known" : "other");

export function initData(data) {
  DATA = data;
  citiesByCountry = data.countries.map(() => []);
  data.cities.forEach((c, i) => citiesByCountry[c[1]].push(i));
  poolCache.clear();
  history.length = 0;
}

// The pool of cities a round can draw from. Africa only from AFRICA_FROM_ROUND on.
function poolFor(kind, round) {
  const key = kind + ":" + round;
  if (poolCache.has(key)) return poolCache.get(key);
  const africaOk = round + 1 >= CONFIG.AFRICA_FROM_ROUND;
  const byCountry = citiesByCountry.map((list, k) => {
    if (!africaOk && isAfrica(k)) return [];
    const tier = DATA.countries[k].tier;
    return list.filter((ci) => {
      const [, , , , , pop, isCap, fame] = DATA.cities[ci];
      if (pop < CONFIG.MIN_CITY_POP) return false;
      const known = fame === 1 || (isCap && tier <= 2 && fame !== 2 && pop >= CONFIG.KNOWN_CAPITAL_MIN_POP);
      if (kind === "famous") return fame === 2;
      if (kind === "known") return known;
      if (kind === "mixed") return fame === 2 || known;
      if (kind === "easy") return fame === 2 || (fame === 1 && tier === 1);
      return true;
    });
  });
  const pool = { kind, byCountry, flat: byCountry.flat() };
  poolCache.set(key, pool);
  return pool;
}

function generateDay(n) {
  const date = addDays(CONFIG.LAUNCH_DATE, n);
  const rng = mulberry32(hashString(CONFIG.SEED_SALT + ":" + date));

  const recentCities = new Set();
  const recentCountries = new Set();   // hard block
  const softCountries = new Set();     // less likely
  const R = CONFIG.CITY_REPEAT_DAYS;
  const lookback = Math.max(R.famous, R.known, R.other, CONFIG.COUNTRY_REPEAT_DAYS, CONFIG.RECENT_SOFT_DAYS);
  for (let back = 1; back <= lookback; back++) {
    const prev = history[n - back];
    if (!prev) continue;
    for (const ci of prev) {
      const k = DATA.cities[ci][1];
      if (back <= R[fameKey(ci)]) recentCities.add(ci);
      const hardDays = CONFIG.COUNTRY_REPEAT_OVERRIDES?.[DATA.countries[k].cc] ?? CONFIG.COUNTRY_REPEAT_DAYS;
      if (back <= hardDays) recentCountries.add(k);
      else if (back <= CONFIG.RECENT_SOFT_DAYS && hardDays === CONFIG.COUNTRY_REPEAT_DAYS) softCountries.add(k);
    }
  }
  const kinds = CONFIG.DAY_POOLS?.[date] || CONFIG.ROUND_POOLS;
  if (CONFIG.DAY_COUNTRIES?.[date]) return pickFromCountries(rng, CONFIG.DAY_COUNTRIES[date], kinds);
  return pickSix(rng, recentCities, recentCountries, softCountries, kinds);
}

// A hand-picked day: one city per listed country, in order. Prefers the round's
// usual pool (famous, known...), then falls back to any sizeable city there.
function pickFromCountries(rng, codes, kinds) {
  return codes.map((cc, round) => {
    const k = DATA.countries.findIndex((c) => c.cc === cc);
    if (k < 0) throw new Error("DAY_COUNTRIES: unknown or excluded country " + cc);
    const order = [kinds[round], "mixed", "any"];
    let cands = [];
    for (const kind of order) {
      // Ignore the Africa-from-round rule here: the day was chosen by hand.
      cands = poolFor(kind, CONFIG.ROUNDS - 1).byCountry[k];
      if (kind === "any") cands = cands.filter((ci) => DATA.cities[ci][5] >= 50000);
      if (cands.length) break;
    }
    if (!cands.length) cands = citiesByCountry[k];
    return weightedPick(cands, cands.map((ci) => Math.sqrt(Math.min(DATA.cities[ci][5], CONFIG.CITY_POP_CAP))), rng);
  });
}

// Unlimited practice games: same rules as the daily, fresh random seed, no history.
export function randomPuzzle(seed) {
  return pickSix(mulberry32(seed >>> 0), new Set(), new Set(), new Set(), CONFIG.ROUND_POOLS);
}

function pickSix(rng, recentCities, recentCountries, softCountries, kinds) {
  const picks = [];
  const usedCountries = new Set();
  const blockedNeighbors = new Set(); // country codes bordering something already picked today
  const continentCount = {};
  const farEnough = (ci) => picks.every((p) => distKm(DATA.cities[p], DATA.cities[ci]) >= CONFIG.MIN_SPACING_KM);

  // Constraints relax step by step only if a round's pool runs dry:
  // 0 = everything, 1 = ignore continent spread, 2 = allow recent countries,
  // 3 = allow recently used cities, 4 = ignore neighbors and spacing too.
  for (let round = 0; round < CONFIG.ROUNDS; round++) {
    const pool = poolFor(kinds[round], round);
    const countryOk = (k, level) => {
      const c = DATA.countries[k];
      if (usedCountries.has(k)) return false;
      if (level < 4 && blockedNeighbors.has(c.cc)) return false;
      if (level < 2 && recentCountries.has(k)) return false;
      // Continent spread applies to rounds 1-4; late rounds are weighted instead (see below).
      if (level < 1 && pool.kind !== "any" && (continentCount[c.continent] || 0) >= CONFIG.MAX_PER_CONTINENT) return false;
      return true;
    };
    const cityOk = (ci, level) => (level >= 3 || !recentCities.has(ci)) && (level >= 4 || farEnough(ci));
    const countryWeight = (k) => {
      const c = DATA.countries[k];
      let w = (c.weight ?? 1) * (c.kind === "territory" ? CONFIG.TERRITORY_WEIGHT : 1);
      if (softCountries.has(k)) w *= CONFIG.RECENT_SOFT_WEIGHT;
      return w;
    };

    let chosen = null;
    for (let level = 0; level < 5 && chosen === null; level++) {
      if (pool.kind !== "any") {
        // City first: every famous / known city is a candidate. Countries with many
        // listed cities (the US) come up more, but not in proportion to their count.
        const cands = [], weights = [];
        for (const ci of pool.flat) {
          const k = DATA.cities[ci][1];
          if (!countryOk(k, level) || !cityOk(ci, level)) continue;
          cands.push(ci);
          weights.push(countryWeight(k) * Math.pow(pool.byCountry[k].length, CONFIG.EARLY_COUNTRY_SPREAD - 1));
        }
        if (cands.length) chosen = weightedPick(cands, weights, rng);
      } else {
        // Country first, weighted toward harder countries, then a city inside it.
        const rejected = new Set();
        while (chosen === null) {
          const cands = [], weights = [];
          DATA.countries.forEach((c, k) => {
            if (rejected.has(k) || !countryOk(k, level) || !pool.byCountry[k].length) return;
            cands.push(k);
            weights.push(countryWeight(k) * (CONFIG.HARD_TIER_WEIGHT[c.tier] ?? 1) *
              (c.continent === "Africa" ? CONFIG.AFRICA_LATE_WEIGHT : 1) *
              ((continentCount[c.continent] || 0) >= CONFIG.MAX_PER_CONTINENT ? 0.35 : 1));
          });
          if (!cands.length) break;
          const k = weightedPick(cands, weights, rng);
          const inside = pool.byCountry[k].filter((ci) => cityOk(ci, level));
          if (!inside.length) { rejected.add(k); continue; }
          chosen = weightedPick(inside, inside.map((ci) =>
            Math.pow(Math.min(DATA.cities[ci][5], CONFIG.CITY_POP_CAP), CONFIG.LATE_POP_EXPONENT) *
            (CONFIG.LATE_FAME_WEIGHT[DATA.cities[ci][7]] ?? 1)), rng);
        }
      }
    }
    if (chosen === null) break; // cannot happen with the shipped dataset
    const cIdx = DATA.cities[chosen][1];
    picks.push(chosen);
    usedCountries.add(cIdx);
    for (const nb of DATA.countries[cIdx].neighbors || []) blockedNeighbors.add(nb);
    const cont = DATA.countries[cIdx].continent;
    continentCount[cont] = (continentCount[cont] || 0) + 1;
  }
  return picks;
}

// Returns an array of city indices for the date. Replays from launch as needed.
export function puzzleFor(date) {
  const n = daysBetween(CONFIG.LAUNCH_DATE, date);
  if (n < 0) throw new Error("Date is before launch");
  while (history.length <= n) history.push(generateDay(history.length));
  return history[n];
}

export function describeCity(ci) {
  const [name, cIdx, region, lat, lng, pop, isCap] = DATA.cities[ci];
  const country = DATA.countries[cIdx];
  // Display rule: City, [State/Province,] [Territory,] Country.
  // City-states (Monaco, Singapore, Vatican City) are not repeated.
  const parts = [name];
  if (region) parts.push(region);
  if (country.kind === "territory") parts.push(country.name, country.sovereign);
  else parts.push(country.name);
  for (let i = parts.length - 1; i > 0; i--) if (parts[i] === parts[i - 1]) parts.splice(i, 1);
  return {
    index: ci, name, region, lat, lng, population: pop, isCapital: !!isCap,
    flag: country.flag, country: country.name, cc: country.cc,
    continent: country.continent, label: parts.join(", "),
    facts: country.facts, neighbors: country.neighbors, sovereign: country.sovereign,
  };
}
