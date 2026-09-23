// XenoTap tunables. Everything you might want to adjust lives here.
//
// NOTE: values marked (affects puzzles) change which cities get picked.
// Changing them after launch reshuffles every day, including the archive.

export const CONFIG = {
  // ---- Calendar -----------------------------------------------------------
  LAUNCH_DATE: "2026-09-23",        // puzzle #1, earliest archive day (affects puzzles)
  TIMEZONE: "America/New_York",     // daily rollover at midnight Eastern
  SEED_SALT: "xenotap-v2",          // (affects puzzles)

  // ---- Rounds and scoring -------------------------------------------------
  ROUNDS: 6,
  // Base score = 100 * e^(-km / SCORE_DECAY_KM). Bigger = more forgiving.
  // At 2800: 300 km = 91, 1,000 km = 71, 2,000 km = 49, 3,000 km = 35.
  SCORE_DECAY_KM: 2800,
  PERFECT_RADIUS_KM: 25,            // guesses this close get a full 100
  // Round multipliers. Later rounds are harder places, so they pay more.
  // 100 x (1 + 1.25 + 1.5 + 1.75 + 2 + 2.5) = 1000 max.
  MULTIPLIERS: [1, 1.25, 1.5, 1.75, 2, 2.5],
  ROUND_NAMES: ["Warm-up", "Easy", "Medium", "Tricky", "Hard", "Boss"],
  HINT_FACTOR: 0.5,                 // hint halves that round's multiplier

  // ---- Globe --------------------------------------------------------------
  // Hard zoom cap expressed as ground distance per CSS pixel.
  // The Florida peninsula (about 270 km across at Tampa) edge to edge on a
  // 402 px wide iPhone 17 Pro = 0.67 km/px. Desktop gets the same detail per pixel.
  MAX_KM_PER_PX: 270 / 402,

  IMAGERY: {
    // Esri World Imagery: no key, no labels, no borders.
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 10,
    attribution:
      '<a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  // Alternative with a fully open license (Sentinel-2 cloudless 2016, CC BY 4.0):
  // tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
  // attribution: 'Sentinel-2 cloudless by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016)'

  // ---- City selection (affects puzzles) -----------------------------------
  // A country is drawn first, then a city inside it. Knowing the country is
  // the main skill; the city is the bonus.
  //
  // Each country has a difficulty tier (1 = easy for Americans, 5 = obscure),
  // set in tools/build-data.mjs. Each round draws from overlapping tiers with
  // these weights, so no single small pool gets used up.
  ROUND_TIERS: [
    { 1: 1, 2: 0.35 },   // Warm-up (tier 2 only via its capital, see below)
    { 1: 0.5, 2: 1 },    // Easy
    { 2: 0.5, 3: 1 },    // Medium
    { 3: 0.6, 4: 1 },    // Tricky
    { 4: 1, 5: 0.6 },    // Hard
    { 4: 0.5, 5: 1 },    // Boss
  ],
  // Every pick has at least this many people. Tiny capitals (Alofi, Funafuti,
  // Vatican City) are never answers, and places with no town this big drop out.
  MIN_CITY_POP: 10000,
  // Per round, a city must be a national capital, its country's biggest city,
  // or at least this big. Round 1 is Madrid / Toronto / Osaka territory.
  ROUND_MIN_POP: [500000, 250000, 50000, 10000, 10000, 10000],
  // In round 1, countries above tier 1 can only show a big capital (Vienna, Nairobi, Bogotá).
  ROUND1_CAPITALS_ONLY_ABOVE_TIER: 1,
  // How strongly each round favors big cities. city weight = min(pop, cap) ^ exponent.
  // Early rounds lean toward well known cities, late rounds toward small ones.
  ROUND_POP_EXPONENT: [0.5, 0.4, 0.35, 0.3, 0.25, 0.2],
  CITY_POP_CAP: 3000000,
  TERRITORY_WEIGHT: 0.3,            // dependent territories vs 1.0 for countries
  // Softer regions early: in the first N rounds these get their weight multiplied.
  EARLY_ROUNDS: 4,
  EARLY_REGION_WEIGHT: { Africa: 0.5, "South-Eastern Asia": 0.5 },
  // (Island rules live in tools/build-data.mjs: only well known island nations
  // are playable, most at 0.35 weight, and remote small-island cities are dropped.)
  MAX_PER_CONTINENT: 2,             // per day, keeps each day globally spread
  MIN_SPACING_KM: 1000,             // any two places on the same day are at least this far apart
  // Countries that share a land border never appear on the same day.
  COUNTRY_REPEAT_DAYS: 7,           // a country will not recur within this window
  RECENT_SOFT_DAYS: 30,             // ...and is less likely for this long after that
  RECENT_SOFT_WEIGHT: 0.3,
  CITY_REPEAT_DAYS: 60,             // a city will not recur within this window
};
