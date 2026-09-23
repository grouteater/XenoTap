// XenoTap tunables. Everything you might want to adjust lives here.
//
// NOTE: values marked (affects puzzles) change which cities get picked.
// Changing them after launch reshuffles every day, including the archive.

export const CONFIG = {
  // ---- Calendar -----------------------------------------------------------
  LAUNCH_DATE: "2026-09-01",        // puzzle #1, earliest archive day (affects puzzles)
  TIMEZONE: "America/New_York",     // daily rollover at midnight Eastern
  SEED_SALT: "xenotap-v1",          // (affects puzzles)

  // ---- Rounds and scoring -------------------------------------------------
  ROUNDS: 6,
  SCORE_DECAY_KM: 1200,             // base = 100 * e^(-km / this). Bigger = more forgiving.
  PERFECT_RADIUS_KM: 20,            // guesses this close get a full 100
  MULTIPLIER_FIRST: 1,              // round 1 multiplier
  MULTIPLIER_LAST: 2,               // round 6 multiplier (linear in between)
  HINT_FACTOR: 0.5,                 // hint halves that round's multiplier
  WARM_THRESHOLD_KM: 2000,          // warm/cold probe: "warm" if within this distance

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
  TERRITORY_WEIGHT: 0.5,            // dependent territories vs 1.0 for countries
  MAX_PER_CONTINENT: 2,             // per day, keeps each day globally spread
  COUNTRY_REPEAT_DAYS: 14,          // a country will not recur within this window
  CITY_REPEAT_DAYS: 60,             // a city will not recur within this window
  CITY_POP_EXPONENT: 0.3,           // city weight = min(pop, cap) ^ this. 0 = all equal.
  CITY_POP_CAP: 3000000,
};
