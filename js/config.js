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
  // What each round draws from:
  //   famous: hand-picked household names (tools/build-data.mjs FAMOUS list)
  //   known:  places most players have heard of (KNOWN list + big capitals)
  //   any:    every playable city, weighted toward harder countries
  //   mixed:  famous + known together (an easier "known")
  ROUND_POOLS: ["famous", "famous", "known", "known", "any", "any"],
  // One-off easier days. Note: changing a day that is already live also nudges
  // later days a little (repeat avoidance looks back at earlier picks).
  DAY_POOLS: {
    "2026-09-23": ["famous", "famous", "mixed", "mixed", "known", "known"], // launch day: gentler
  },
  AFRICA_FROM_ROUND: 5,             // African places only appear from this round on (1-based)
  // Rounds with the "any" pool: country weight by difficulty tier (5 = hardest),
  // and famous / known cities are made rarer so the Boss round stays a boss.
  HARD_TIER_WEIGHT: { 1: 0.3, 2: 0.5, 3: 0.8, 4: 1, 5: 1 },
  LATE_FAME_WEIGHT: { 2: 0.15, 1: 0.4 },
  LATE_POP_EXPONENT: 0.2,           // city weight inside a country = min(pop, cap) ^ this
  // Africa has far more small countries than any other region, so per-country
  // weighting alone would make most late rounds African. This evens it out.
  AFRICA_LATE_WEIGHT: 0.45,
  // Rounds 1-4: how much a country's share grows with its number of listed cities
  // (0 = every country equal, 1 = every city equal). 0.7 keeps the US common.
  EARLY_COUNTRY_SPREAD: 0.7,
  KNOWN_CAPITAL_MIN_POP: 300000,    // tier 1-2 capitals this big join the "known" pool
  CITY_POP_CAP: 3000000,
  MIN_CITY_POP: 10000,              // no answer is ever smaller than this
  TERRITORY_WEIGHT: 0.3,            // dependent territories vs 1.0 for countries
  // (Island rules live in tools/build-data.mjs: only well known island nations
  // are playable, and remote small-island cities are dropped.)
  MAX_PER_CONTINENT: 2,             // per day, keeps each day globally spread
  MIN_SPACING_KM: 1000,             // any two places on the same day are at least this far apart
  // Countries that share a land border never appear on the same day.
  COUNTRY_REPEAT_DAYS: 7,           // a country will not recur within this window
  RECENT_SOFT_DAYS: 30,             // ...and is less likely for this long after that
  RECENT_SOFT_WEIGHT: 0.3,
  // A city will not recur within this many days (famous ones come back sooner).
  CITY_REPEAT_DAYS: { famous: 21, known: 30, other: 60 },
};
