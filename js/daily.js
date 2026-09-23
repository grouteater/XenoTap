// Deterministic daily puzzle generation.
//
// Every day's 6 cities come from a seeded PRNG keyed on the date string.
// To avoid repeats without any stored history file, the game replays every
// day from LAUNCH_DATE forward in memory, so "recently used" is itself
// derived from the seed. Same date in = same cities out, on every device.

import { CONFIG } from "./config.js";

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

// ---- Puzzle generation ----------------------------------------------------------

let DATA = null;
let citiesByCountry = null;
let cityWeights = null;
const history = []; // history[n] = city indices for day n (0 = LAUNCH_DATE)

export function initData(data) {
  DATA = data;
  citiesByCountry = data.countries.map(() => []);
  data.cities.forEach((c, i) => citiesByCountry[c[1]].push(i));
  cityWeights = data.cities.map((c) => Math.pow(Math.min(c[5], CONFIG.CITY_POP_CAP), CONFIG.CITY_POP_EXPONENT));
  history.length = 0;
}

function generateDay(n) {
  const date = addDays(CONFIG.LAUNCH_DATE, n);
  const rng = mulberry32(hashString(CONFIG.SEED_SALT + ":" + date));

  const recentCities = new Set();
  const recentCountries = new Set();
  for (let back = 1; back <= Math.max(CONFIG.CITY_REPEAT_DAYS, CONFIG.COUNTRY_REPEAT_DAYS); back++) {
    const prev = history[n - back];
    if (!prev) continue;
    for (const ci of prev) {
      if (back <= CONFIG.CITY_REPEAT_DAYS) recentCities.add(ci);
      if (back <= CONFIG.COUNTRY_REPEAT_DAYS) recentCountries.add(DATA.cities[ci][1]);
    }
  }

  const recentPerCountry = new Map();
  for (const ci of recentCities) {
    const k = DATA.cities[ci][1];
    recentPerCountry.set(k, (recentPerCountry.get(k) || 0) + 1);
  }

  const picks = [];
  const usedCountries = new Set();
  const continentCount = {};

  // Constraint levels are relaxed only if the pool ever runs dry.
  for (let round = 0; round < CONFIG.ROUNDS; round++) {
    let chosen = null;
    for (let level = 0; level < 3 && chosen === null; level++) {
      const candidates = [];
      const weights = [];
      DATA.countries.forEach((c, idx) => {
        if (usedCountries.has(idx)) return;
        if (level < 2 && recentCountries.has(idx)) return;
        if (level < 1 && (continentCount[c.continent] || 0) >= CONFIG.MAX_PER_CONTINENT) return;
        if (citiesByCountry[idx].length - (recentPerCountry.get(idx) || 0) <= 0) return;
        candidates.push(idx);
        weights.push(c.kind === "territory" ? CONFIG.TERRITORY_WEIGHT : 1);
      });
      if (candidates.length === 0) continue;
      const country = weightedPick(candidates, weights, rng);
      const pool = citiesByCountry[country].filter((ci) => !recentCities.has(ci));
      chosen = weightedPick(pool, pool.map((ci) => cityWeights[ci]), rng);
    }
    if (chosen === null) break; // cannot happen with the shipped dataset
    const cIdx = DATA.cities[chosen][1];
    picks.push(chosen);
    usedCountries.add(cIdx);
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
  };
}
