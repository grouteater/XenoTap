// XenoTap tunables. Everything you might want to adjust lives here.
//
// NOTE: values marked (affects puzzles) change which cities get picked.
// Changing them after launch reshuffles every day, including the archive.

export const CONFIG = {
  // ---- Calendar -----------------------------------------------------------
  LAUNCH_DATE: "2026-09-01",        // puzzle #1, earliest archive day (affects puzzles)
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
  // 525 km across a 390 px wide phone (about the width of Florida) = 1.35 km/px.
  MAX_KM_PER_PX: 525 / 390,

  IMAGERY: {
    // Esri World Imagery: no key, no labels, no borders.
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 9,
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
  // set in tools/build-data.mjs. Round N draws from the tiers listed here.
  ROUND_TIERS: [[1], [2], [3], [3, 4], [4], [5]],
  // How strongly each round favors big cities. city weight = min(pop, cap) ^ exponent.
  // Early rounds lean toward well known cities, late rounds toward small ones.
  ROUND_POP_EXPONENT: [0.5, 0.4, 0.35, 0.3, 0.25, 0.2],
  CITY_POP_CAP: 3000000,
  TERRITORY_WEIGHT: 0.3,            // dependent territories vs 1.0 for countries
  MAX_PER_CONTINENT: 2,             // per day, keeps each day globally spread
  COUNTRY_REPEAT_DAYS: 14,          // a country will not recur within this window
  CITY_REPEAT_DAYS: 60,             // a city will not recur within this window
};
