// Deterministic daily puzzle generation.
//
// Every day's 6 cities come from a seeded PRNG keyed on the date string.
// To avoid repeats without any stored history file, the game replays every
// day from LAUNCH_DATE forward in memory, so "recently used" is itself
// derived from the seed. Same date in = same cities out, on every device.

import { CONFIG } from "./config.js?v=10";

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
let eligible = null; // eligible[round][countryIdx] = city indices allowed in that round
const history = []; // history[n] = city indices for day n (0 = LAUNCH_DATE)

export function initData(data) {
  DATA = data;
  citiesByCountry = data.countries.map(() => []);
  data.cities.forEach((c, i) => citiesByCountry[c[1]].push(i));
  const biggest = citiesByCountry.map((list) => list.reduce((b, ci) => (data.cities[ci][5] > data.cities[b][5] ? ci : b), list[0]));
  eligible = Array.from({ length: CONFIG.ROUNDS }, (_, round) => {
    const minPop = CONFIG.ROUND_MIN_POP[round] ?? CONFIG.MIN_CITY_POP;
    return citiesByCountry.map((list, k) => list.filter((ci) => {
      const [, , , , , pop, isCap] = data.cities[ci];
      if (round === 0 && data.countries[k].tier > CONFIG.ROUND1_CAPITALS_ONLY_ABOVE_TIER) return isCap && pop >= minPop;
      return pop >= CONFIG.MIN_CITY_POP && (pop >= minPop || isCap || ci === biggest[k]);
    }));
  });
  history.length = 0;
}

function generateDay(n) {
  const date = addDays(CONFIG.LAUNCH_DATE, n);
  const rng = mulberry32(hashString(CONFIG.SEED_SALT + ":" + date));

  const recentCities = new Set();
  const recentCountries = new Set();   // hard block
  const softCountries = new Set();     // less likely
  const lookback = Math.max(CONFIG.CITY_REPEAT_DAYS, CONFIG.COUNTRY_REPEAT_DAYS, CONFIG.RECENT_SOFT_DAYS);
  for (let back = 1; back <= lookback; back++) {
    const prev = history[n - back];
    if (!prev) continue;
    for (const ci of prev) {
      const k = DATA.cities[ci][1];
      if (back <= CONFIG.CITY_REPEAT_DAYS) recentCities.add(ci);
      if (back <= CONFIG.COUNTRY_REPEAT_DAYS) recentCountries.add(k);
      else if (back <= CONFIG.RECENT_SOFT_DAYS) softCountries.add(k);
    }
  }
  return pickSix(rng, recentCities, recentCountries, softCountries);
}

// Unlimited practice games: same rules as the daily, fresh random seed, no history.
export function randomPuzzle(seed) {
  return pickSix(mulberry32(seed >>> 0), new Set(), new Set(), new Set());
}

function pickSix(rng, recentCities, recentCountries, softCountries) {
  const picks = [];
  const usedCountries = new Set();
  const blockedNeighbors = new Set(); // country codes bordering something already picked today
  const continentCount = {};

  // Constraints are relaxed step by step only if a round's pool ever runs dry:
  // 0 = everything, 1 = ignore continent spread, 2 = allow recent countries,
  // 3 = also allow neighboring tiers, 4 = anything (last resort).
  // Bordering countries and places closer than MIN_SPACING_KM are blocked at every level but 4.
  for (let round = 0; round < CONFIG.ROUNDS; round++) {
    const tierW = CONFIG.ROUND_TIERS[round] || { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
    const tiers = Object.keys(tierW).map(Number);
    const exponent = CONFIG.ROUND_POP_EXPONENT[round] ?? 0.3;
    let chosen = null;
    const rejected = new Set(); // countries with no city far enough from today's other picks
    for (let level = 0; level < 5 && chosen === null; level++) {
      while (chosen === null) {
        const candidates = [];
        const weights = [];
        DATA.countries.forEach((c, idx) => {
          if (usedCountries.has(idx) || rejected.has(idx)) return;
          if (level < 4 && blockedNeighbors.has(c.cc)) return;
          if (level < 3 && !tiers.includes(c.tier)) return;
          if (level === 3 && !tiers.some((t) => Math.abs(t - c.tier) <= 1)) return;
          if (level < 2 && recentCountries.has(idx)) return;
          if (level < 1 && (continentCount[c.continent] || 0) >= CONFIG.MAX_PER_CONTINENT) return;
          if (!eligible[round][idx].some((ci) => !recentCities.has(ci))) return;
          candidates.push(idx);
          let w = (tierW[c.tier] ?? 0.3) * (c.weight ?? 1) * (c.kind === "territory" ? CONFIG.TERRITORY_WEIGHT : 1);
          if (round < CONFIG.EARLY_ROUNDS) {
            w *= CONFIG.EARLY_REGION_WEIGHT[c.continent] ?? CONFIG.EARLY_REGION_WEIGHT[c.subregion] ?? 1;
          }
          if (softCountries.has(idx)) w *= CONFIG.RECENT_SOFT_WEIGHT;
          weights.push(w);
        });
        if (candidates.length === 0) break; // relax to the next level
        const country = weightedPick(candidates, weights, rng);
        const pool = eligible[round][country].filter((ci) =>
          !recentCities.has(ci) && (level === 4 || picks.every((p) => distKm(DATA.cities[p], DATA.cities[ci]) >= CONFIG.MIN_SPACING_KM)));
        if (pool.length === 0) { rejected.add(country); continue; }
        chosen = weightedPick(pool, pool.map((ci) => Math.pow(Math.min(DATA.cities[ci][5], CONFIG.CITY_POP_CAP), exponent)), rng);
      }
    }
    if (chosen === null) break; // cannot happen with the shipped dataset
    const cIdx = DATA.cities[chosen][1];
    picks.push(chosen);
    usedCountries.add(cIdx);
    for (const n of DATA.countries[cIdx].neighbors || []) blockedNeighbors.add(n);
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
