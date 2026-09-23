import { CONFIG } from "./config.js?v=8";
import * as daily from "./daily.js?v=8";

const $ = (id) => document.getElementById(id);
// Cache-busting stamp, inherited from how index.html loaded this file (e.g. "?v=8").
const V = new URL(import.meta.url).search;
const R = CONFIG.ROUNDS;

// ---------------------------------------------------------------- geometry

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversineKm(a, b) { // a, b = [lng, lat]
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Great-circle points from a to b, longitudes unwrapped so lines never jump the antimeridian.
function greatCircle(a, b, n = 96) {
  const [l1, p1, l2, p2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const pts = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lng = toDeg(Math.atan2(y, x));
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    if (prev !== null) { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
    prev = lng;
    pts.push([lng, lat]);
  }
  return pts;
}

// ---------------------------------------------------------------- scoring

// Every round is scored 0 to 100 (a hint halves it). The day's total weights
// later, harder rounds more: total = sum of round score x MULTIPLIERS[round].
const weightFor = (i) => CONFIG.MULTIPLIERS[i] ?? CONFIG.MULTIPLIERS[CONFIG.MULTIPLIERS.length - 1];
const maxTotal = () => Array.from({ length: R }, (_, i) => weightFor(i) * 100).reduce((a, b) => a + b, 0);
const totalOf = (rounds) => Math.round(rounds.reduce((a, r, i) => a + (r.score || 0) * weightFor(i), 0));

function baseScore(km) {
  if (km <= CONFIG.PERFECT_RADIUS_KM) return 100;
  return Math.round(100 * Math.exp(-(km - CONFIG.PERFECT_RADIUS_KM) / CONFIG.SCORE_DECAY_KM));
}

// Share colors follow the round score (0 to 100).
function emojiFor(base) {
  if (base >= 95) return "🎯";
  if (base >= 80) return "🟩";
  if (base >= 60) return "🟨";
  if (base >= 40) return "🟧";
  if (base >= 15) return "🟥";
  return "⬛";
}

const fmtKm = (km) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-US")) + " km";
const fmtMult = (m) => { let s = String(+m.toFixed(2)); if (!s.includes(".")) s += ".0"; return "×" + s; };
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------- storage (best effort)

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const gameKey = (d) => `xenotap:v3:game:${d}`;

// ---------------------------------------------------------------- setup

const today = daily.todayET();
const params = new URLSearchParams(location.search);
// Modes: daily (default), practice (unlimited daily-format games), streak, hotcold.
const MODE = ["practice", "streak", "hotcold"].includes(params.get("mode")) ? params.get("mode") : "daily";
const PRACTICE = MODE === "practice";
const PRACTICE_KEY = "xenotap:v3:practice";
let controller = null; // set for streak / hotcold
let date = params.get("date");
if (!date || !daily.isValidDate(date) || date > today || date < CONFIG.LAUNCH_DATE) date = today;
const isToday = date === today;

let NAMES = {}; // cc -> [name, flag] for every country on Earth
let state = null;
let cities = [];
let map = null;
let probeMode = false;
let pendingGuess = null;
const markers = { guess: null, answer: null, probe: null, extra: [] };

function freshState(ids) {
  return { v: 3, date, ids, round: 0, phase: "guess", rounds: Array.from({ length: R }, () => ({ guess: null, hint: null })) };
}
function save() { store.set(PRACTICE ? PRACTICE_KEY : gameKey(date), state); }

let DATA = null;
async function boot() {
  const data = await fetch("data/places.json" + V).then((r) => r.json());
  DATA = data;
  daily.initData(data);
  NAMES = data.names || {};
  document.body.dataset.mode = MODE;

  if (MODE === "streak" || MODE === "hotcold") {
    controller = MODE === "streak" ? streakMode() : hotColdMode();
    initMap();
    wireUI();
    controller.start(); // the card shows right away; the globe catches up
    $("loading").remove();
    return;
  }

  if (PRACTICE) {
    state = store.get(PRACTICE_KEY);
    if (!state || state.v !== 3 || !state.seed) state = null;
    const seed = state ? state.seed : (Math.random() * 2 ** 32) >>> 0;
    cities = daily.randomPuzzle(seed).map(daily.describeCity);
    const ids = cities.map((c) => c.index).join(",");
    if (!state || state.ids !== ids) { state = freshState(ids); state.seed = seed; }
  } else {
    cities = daily.puzzleFor(date).map(daily.describeCity);
    state = store.get(gameKey(date));
    const ids = cities.map((c) => c.index).join(",");
    if (!state || state.v !== 3 || state.ids !== ids || !Array.isArray(state.rounds) || state.rounds.length !== R) state = freshState(ids);
  }

  initMap();
  wireUI();
  $("loading").remove();

  if (state.phase === "done") recordStats();
  if (!store.get("xenotap:v2:seenHelp") && !params.get("archive")) { openSheet("help-sheet"); store.set("xenotap:v2:seenHelp", true); }
}

// ---------------------------------------------------------------- map

// Open space between the target card and the bottom controls, used as camera
// padding so the globe and revealed answers never hide under the UI.
function uiPadding() {
  const top = Math.max(0, $("target-card").getBoundingClientRect().bottom + 8);
  const bottom = Math.max(0, innerHeight - $("bottom").getBoundingClientRect().top + 8);
  return { top, bottom, left: 0, right: 0 };
}

// MapLibre's globe grows with 1/cos(latitude) at a fixed zoom, so the
// whole-globe view compensates to keep the same on-screen size everywhere.
function overviewZoom(lat) {
  return Math.max(0, initialZoom() + Math.log2(Math.cos(toRad(Math.min(80, Math.abs(lat))))));
}

function initialZoom() {
  const m = Math.min(innerWidth, innerHeight - 260);
  return Math.max(0, Math.min(2.4, Math.log2(m / 190)));
}

function initMap() {
  const img = CONFIG.IMAGERY;
  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      projection: { type: "globe" },
      sources: {
        sat: { type: "raster", tiles: img.tiles, tileSize: img.tileSize, maxzoom: img.maxzoom, attribution: img.attribution },
      },
      layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-fade-duration": 150 } }],
      sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.6, 6, 0.2] },
    },
    center: [15, 18],
    zoom: Math.max(0, initialZoom() + Math.log2(Math.cos(toRad(18)))),
    minZoom: 0,
    maxZoom: capZoomAt(18),
    renderWorldCopies: false,
    attributionControl: { compact: false },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    doubleClickZoom: false,
    clickTolerance: 8,
    maxPitch: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  // Hard zoom cap: maxZoom is recomputed from the center latitude as the view
  // moves, so ground resolution never gets finer than CONFIG.MAX_KM_PER_PX.
  map.on("move", updateZoomCap);

  map.on("load", () => {
    // Country outlines for revealed answers (under the guess lines).
    map.addSource("borders", { type: "geojson", data: emptyFC() });
    map.addLayer({ id: "borders-fill", type: "fill", source: "borders", paint: { "fill-color": "#fdf6c8", "fill-opacity": 0.14 } });
    map.addLayer({
      id: "borders-casing", type: "line", source: "borders",
      layout: { "line-join": "round" },
      paint: { "line-color": "#2b2840", "line-width": 4.5, "line-opacity": 0.45 },
    });
    map.addLayer({
      id: "borders-line", type: "line", source: "borders",
      layout: { "line-join": "round" },
      paint: { "line-color": "#fdf6c8", "line-width": 2.2 },
    });
    map.addSource("lines", { type: "geojson", lineMetrics: true, data: emptyFC() });
    map.addLayer({
      id: "lines-casing", type: "line", source: "lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#2b2840", "line-width": 6, "line-opacity": 0.55 },
    });
    map.addLayer({
      id: "lines", type: "line", source: "lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": 3,
        "line-gradient": ["interpolate", ["linear"], ["line-progress"],
          0, "#f4b6d2", 0.25, "#fbd3b0", 0.5, "#f5ebb0", 0.75, "#b9ddf2", 1, "#cbc2f2"],
      },
    });
    updateZoomCap();
    map.setPadding(uiPadding());
    if (!controller) render(true);
    setTimeout(loadAllBorders, 1500); // warm the outline cache before the first reveal
  });

  map.on("click", onMapTap);
  window.xenotap = { map, cities, data: DATA, get controller() { return controller; } }; // handy for poking at the game from devtools
}

function kmPerPx() {
  const c = map.getContainer();
  const x = c.clientWidth / 2, y = c.clientHeight / 2;
  const a = map.unproject([x - 20, y]);
  const b = map.unproject([x + 20, y]);
  return haversineKm([a.lng, a.lat], [b.lng, b.lat]) / 40;
}

// MapLibre's globe keeps Web Mercator zoom semantics: at zoom z the ground
// resolution at the center is 78271.517 m/px * cos(lat) / 2^z (512 px tiles).
// Solving for the zoom that gives MAX_KM_PER_PX makes the cap exact at any latitude.
function capZoomAt(lat) {
  const c = Math.cos(toRad(Math.min(85, Math.abs(lat))));
  return Math.log2((78271.517 * c) / (CONFIG.MAX_KM_PER_PX * 1000));
}

function updateZoomCap() {
  const cap = Math.max(1, capZoomAt(map.getCenter().lat));
  if (Math.abs(cap - map.getMaxZoom()) > 0.005) map.setMaxZoom(cap);
}

// Zoom that shows roughly `km` across the smaller screen dimension, clamped to the cap.
function zoomForSpan(km) {
  const kpp = kmPerPx();
  const c = map.getContainer();
  const pad = uiPadding();
  const px = Math.min(c.clientWidth, c.clientHeight - pad.top - pad.bottom);
  const target = km / Math.max(160, px);
  const z = map.getZoom() + Math.log2(kpp / target);
  return Math.max(0, Math.min(map.getMaxZoom(), z));
}

const emptyFC = () => ({ type: "FeatureCollection", features: [] });

function setLines(pairs) {
  const src = map.getSource("lines");
  if (!src) return;
  src.setData({
    type: "FeatureCollection",
    features: pairs.map(([a, b]) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: greatCircle(a, b) } })),
  });
}

// Marker roots must not get their own CSS position: MapLibre positions them
// absolutely. All styling goes on an inner element.
function markerRoot(inner, label) {
  const root = document.createElement("div");
  root.className = "mk";
  root.appendChild(inner);
  if (label) {
    const l = document.createElement("div");
    l.className = "marker-label";
    l.textContent = label;
    root.appendChild(l);
  }
  return root;
}

function guessEl() {
  const el = document.createElement("div");
  el.className = "pin";
  el.innerHTML = `<svg viewBox="0 0 30 40"><path d="M15 38.5C15 38.5 2.5 24.5 2.5 15a12.5 12.5 0 0 1 25 0c0 9.5-12.5 23.5-12.5 23.5z" fill="#ffffff" stroke="#2b2840" stroke-width="3"/><circle cx="15" cy="15" r="4.5" fill="#2b2840"/></svg>`;
  return markerRoot(el);
}

// The answer: a red circle with thick red arrows pointing at it, clickbait thumbnail style.
function answerEl(label, mini = false) {
  const arrow = "M0 0 L-20 -17 L-20 -7 L-50 -7 L-50 7 L-20 7 L-20 17 Z"; // tip at origin, pointing +x
  const arrows = [340, 200, 125, 55].map((deg, k) =>
    `<g transform="rotate(${deg}) translate(30 0) rotate(180)"><g class="bob" style="animation-delay:${k * -0.15}s"><path d="${arrow}" /></g></g>`).join("");
  const el = document.createElement("div");
  el.className = "bait" + (mini ? " mini" : "");
  el.innerHTML = `<svg viewBox="-85 -85 170 170">
    <circle r="22" class="halo"/><circle r="22" class="ring-red"/>
    <g class="arrows">${arrows}</g></svg>`;
  return markerRoot(el, label);
}

function probeEl(text) {
  const el = document.createElement("div");
  el.className = "probe-dot";
  return markerRoot(el, text);
}

function addMarker(el, lngLat, anchor = "bottom") {
  return new maplibregl.Marker({ element: el, anchor }).setLngLat(lngLat).addTo(map);
}

// ---------------------------------------------------------------- country outlines

// All outlines live in one file (keyed by country code), fetched once in the
// background after the globe loads.
let bordersPromise = null;
function loadAllBorders() {
  if (!bordersPromise) bordersPromise = fetch("data/borders.json" + V).then((r) => r.json()).catch(() => ({}));
  return bordersPromise;
}
async function loadBorder(cc) {
  const all = await loadAllBorders();
  return { type: "FeatureCollection", features: all[cc] || [] };
}

let borderToken = 0;
async function showBorders(ccs) {
  const token = ++borderToken;
  const fcs = await Promise.all(ccs.map(loadBorder));
  if (token !== borderToken) return; // a newer request replaced this one
  const src = map.getSource("borders");
  if (src) src.setData({ type: "FeatureCollection", features: fcs.flatMap((fc) => fc.features) });
}
function clearBorders() { showBorders([]); }

// Ray casting point-in-polygon on lng/lat rings.
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inCountry(pt, fc) {
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      if (inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole))) return true;
    }
  }
  return false;
}

// Which country (if any) a point falls in. Checks every country's bounding box first.
const bboxes = new Map();
function bboxOf(cc, feats) {
  if (!bboxes.has(cc)) {
    let a = 180, b = 90, c = -180, d = -90;
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) {
        for (const [x, y] of poly[0]) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
      }
    }
    bboxes.set(cc, [a, b, c, d]);
  }
  return bboxes.get(cc);
}
async function countryAt(pt) {
  const all = await loadAllBorders();
  for (const [cc, feats] of Object.entries(all)) {
    const [a, b, c, d] = bboxOf(cc, feats);
    if (pt[0] < a || pt[0] > c || pt[1] < b || pt[1] > d) continue;
    if (inCountry(pt, { features: feats })) return cc;
  }
  return null;
}
// Fill in r.landed ("XX" or "sea") once, then persist it.
function resolveLanded(r) {
  if (!r.guess || r.landed) return Promise.resolve(r.landed);
  return countryAt(r.guess).then((cc) => { r.landed = cc || "sea"; save(); return r.landed; });
}
function landedText(r, i) {
  if (!r.landed) return "";
  if (r.landed === "sea") return "🌊 Your guess landed in open water";
  if (r.landed === cities[i].cc) return "";
  const [name, flag] = NAMES[r.landed] || [r.landed, ""];
  return `You guessed ${flag} ${name}`;
}

function clearMarkers() {
  for (const k of ["guess", "answer", "probe"]) { if (markers[k]) markers[k].remove(); markers[k] = null; }
  markers.extra.forEach((m) => m.remove());
  markers.extra = [];
  setLines([]);
}

function onGlobe(e) {
  const p = map.project(e.lngLat);
  return Math.hypot(p.x - e.point.x, p.y - e.point.y) < 4;
}

// ---------------------------------------------------------------- game flow

const cur = () => state.rounds[state.round];
const cityLngLat = (i) => [cities[i].lng, cities[i].lat];

function onMapTap(e) {
  if (document.querySelector(".sheet-backdrop:not([hidden])")) return;
  if (!onGlobe(e)) return;
  const ll = e.lngLat.wrap();
  const lngLat = [ll.lng, ll.lat];
  if (controller) { controller.onTap(lngLat); return; }
  if (state.phase !== "guess") return;

  if (probeMode) { resolveProbe(lngLat); return; }

  pendingGuess = lngLat;
  if (markers.guess) markers.guess.setLngLat(lngLat);
  else markers.guess = addMarker(guessEl(), lngLat);
  renderActions();
}

function cancelGuess() {
  pendingGuess = null;
  if (markers.guess) { markers.guess.remove(); markers.guess = null; }
  renderActions();
}

function confirmGuess() {
  if (!pendingGuess || state.phase !== "guess") return;
  const i = state.round;
  const r = cur();
  const km = haversineKm(pendingGuess, cityLngLat(i));
  const base = baseScore(km);
  const score = r.hint ? Math.round(base * CONFIG.HINT_FACTOR) : base;
  Object.assign(r, { guess: pendingGuess, km, base, score });
  pendingGuess = null;
  state.phase = "reveal";
  save();
  render(false);
}

function nextRound() {
  if (state.round >= R - 1) {
    state.phase = "done";
    save();
    recordStats();
    render(false);
    return;
  }
  state.round += 1;
  state.phase = "guess";
  save();
  clearMarkers();
  render(false);
  map.easeTo({ zoom: overviewZoom(map.getCenter().lat), padding: uiPadding(), duration: 900 });
}

// ---------------------------------------------------------------- hints

function chooseHint(type) {
  closeSheets();
  const r = cur();
  if (r.hint || state.phase !== "guess") return;
  const c = cities[state.round];
  if (type === "hemisphere") {
    r.hint = { type, text: `${c.lat >= 0 ? "Northern" : "Southern"} and ${c.lng >= 0 ? "Eastern" : "Western"} Hemispheres` };
  } else if (type === "continent") {
    r.hint = { type, text: `Continent: ${c.continent}` };
  } else {
    r.hint = { type: "probe", text: null, probe: null };
    probeMode = true;
  }
  save();
  render(false);
}

function resolveProbe(lngLat) {
  const r = cur();
  const km = haversineKm(lngLat, cityLngLat(state.round));
  r.hint.probe = lngLat;
  r.hint.km = km;
  r.hint.text = `📏 Your test spot is ${fmtKm(km)} from the city.`;
  probeMode = false;
  save();
  render(false);
}

function drawProbe(r) {
  if (markers.probe) { markers.probe.remove(); markers.probe = null; }
  if (r.hint && r.hint.type === "probe" && r.hint.probe) {
    markers.probe = addMarker(probeEl(fmtKm(r.hint.km)), r.hint.probe, "center");
  }
}

// ---------------------------------------------------------------- rendering

function render(initial) {
  const i = Math.min(state.round, R - 1);
  const r = state.rounds[i];
  const c = cities[i];

  $("round-label").textContent = `${i + 1}/${R} · ${CONFIG.ROUND_NAMES[i] || ""}`;
  $("day-label").textContent = PRACTICE ? "Practice" : `#${daily.puzzleNumber(date)}${isToday ? "" : " archive"}`;
  $("mult-label").textContent = r.hint ? "max 50 · hint" : `worth ${fmtMult(weightFor(i))}`;
  $("mult-label").classList.toggle("halved", !!r.hint);
  $("target-flag").textContent = c.flag;
  $("target-text").textContent = c.label;
  document.title = PRACTICE ? "XenoTap Practice" : `XenoTap #${daily.puzzleNumber(date)}`;

  $("pips").innerHTML = state.rounds.map((rr, k) =>
    `<span class="pip ${rr.guess ? "done" : k === i ? "current" : ""}" style="${rr.guess ? `background-position:${k * 20}% 0` : ""}"></span>`).join("");

  const hintBtn = $("btn-hint");
  hintBtn.disabled = !!r.hint || state.phase !== "guess";
  hintBtn.textContent = r.hint ? "Hint used" : "Hint";

  const hr = $("hint-result");
  hr.hidden = !(r.hint && r.hint.text);
  if (r.hint && r.hint.text) hr.textContent = r.hint.text;

  probeMode = state.phase === "guess" && !!r.hint && r.hint.type === "probe" && !r.hint.probe;

  if (state.phase === "done") {
    renderActions();
    if (initial) showAllResults(false);
    openEnd();
    return;
  }

  // Map objects for this round
  clearMarkers();
  drawProbe(r);
  if (state.phase === "reveal") {
    markers.guess = addMarker(guessEl(), r.guess);
    markers.answer = addMarker(answerEl(c.name), cityLngLat(i), "center");
    setLines([[r.guess, cityLngLat(i)]]);
    showBorders([c.cc]);
    const mid = greatCircle(r.guess, cityLngLat(i), 2)[1];
    showResult(r, i);
    renderActions(); // result card must be visible before measuring padding
    map.easeTo({ center: mid, zoom: zoomForSpan(Math.max(r.km * 1.6, 700)), padding: uiPadding(), duration: initial ? 0 : 1300 });
  } else {
    clearBorders();
    if (pendingGuess) markers.guess = addMarker(guessEl(), pendingGuess);
  }
  renderActions();
}

function showResult(r, i) {
  const distText = r.km <= CONFIG.PERFECT_RADIUS_KM ? `Bullseye! ${fmtKm(r.km)}` : `${fmtKm(r.km)} away`;
  $("result-dist").textContent = distText;
  $("result-where").textContent = "";
  resolveLanded(r).then(() => {
    if (state.phase !== "reveal" || state.round !== i) return;
    if (r.landed === cities[i].cc) $("result-where").innerHTML = `<span class="badge">Right country</span>`;
    else $("result-where").textContent = landedText(r, i);
  });
  $("result-calc").textContent = (r.hint ? `${r.base}, halved by hint · ` : "") + `counts ${fmtMult(weightFor(i))} in your total`;
  $("result-base").textContent = fmtMult(weightFor(i));
  $("result-points").textContent = r.score;
  setRing($("result-ring"), 0);
  requestAnimationFrame(() => requestAnimationFrame(() => setRing($("result-ring"), r.score / 100)));
  $("btn-next").textContent = i >= R - 1 ? "See results" : "Next round";
}

function setRing(el, frac) {
  el.querySelector(".ring-fg").style.strokeDashoffset = (113.1 * (1 - Math.max(0, Math.min(1, frac)))).toFixed(2);
}

function renderActions() {
  const phase = state.phase;
  $("actions-place").hidden = !(phase === "guess" && !pendingGuess) && phase !== "done";
  $("actions-confirm").hidden = !(phase === "guess" && pendingGuess);
  $("result-card").hidden = phase !== "reveal";
  const helper = $("helper");
  helper.classList.toggle("probe", probeMode);
  if (phase === "done") {
    helper.textContent = "Tap Results to see your score";
    helper.style.pointerEvents = "auto";
    helper.onclick = openEnd;
    helper.innerHTML = `<b>Results</b>`;
    helper.style.cursor = "pointer";
  } else {
    helper.onclick = null;
    helper.style.pointerEvents = "none";
    helper.textContent = probeMode ? "Tap a test spot to measure its distance" : "Tap the globe to place your guess";
  }
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty("--bottom-h", $("bottom").offsetHeight + 20 + "px");
  });
}

// ---------------------------------------------------------------- end of game

function totals() {
  const total = totalOf(state.rounds);
  const hints = state.rounds.filter((r) => r.hint).length;
  return { total, hints };
}

function roundCell(r) {
  return `${emojiFor(r.score || 0)} ${r.score || 0}${r.hint ? "💡" : ""}`;
}

function shareText() {
  const { total } = totals();
  const cells = state.rounds.map(roundCell);
  const url = location.origin + location.pathname + (PRACTICE ? "?mode=practice" : isToday ? "" : `?date=${date}`);
  return [
    PRACTICE ? "XenoTap Practice" : `XenoTap #${daily.puzzleNumber(date)} · ${fmtDate(date)}`,
    cells.slice(0, 3).join("  "),
    cells.slice(3).join("  "),
    `${total} / ${Math.round(maxTotal())}`,
    url,
  ].join("\n");
}

function openEnd() {
  const { total } = totals();
  $("end-day").textContent = PRACTICE ? "Practice game (not counted in stats)" : `XenoTap #${daily.puzzleNumber(date)} · ${fmtDate(date)}${isToday ? "" : " (archive)"}`;
  $("end-total").textContent = total;
  $("end-max").textContent = ` / ${Math.round(maxTotal())}`;
  $("end-grid").innerHTML = state.rounds.map((r) => `<span>${roundCell(r)}</span>`).join("");
  renderBreakdown();
  Promise.all(state.rounds.map(resolveLanded)).then(renderBreakdown);
  if (!PRACTICE) renderStats($("end-stats"));
  $("end-stats-wrap").hidden = PRACTICE;
  $("btn-end-archive").textContent = PRACTICE ? "New practice game" : "Play past days";
  $("countdown-ring").hidden = !isToday || PRACTICE;
  openSheet("end-sheet");
  tickCountdown();
}

function renderBreakdown() {
  $("breakdown").innerHTML = state.rounds.map((r, i) => {
    const c = cities[i];
    const where = r.landed === c.cc ? "right country ✓" : landedText(r, i).replace("You guessed ", "guessed ").replace("🌊 Your guess landed in open water", "guessed open water 🌊");
    return `<li><details>
      <summary>
        <span class="bd-round">Round ${i + 1} · ${CONFIG.ROUND_NAMES[i] || ""}</span>
        <span class="bd-row">
          <span class="bd-flag">${c.flag}</span>
          <span><span class="bd-name">${escapeHtml(c.label)}</span>
            <span class="bd-sub">${fmtKm(r.km)}${where ? " · " + escapeHtml(where) : ""}${r.hint ? " · hint 💡" : ""}</span></span>
          <span class="bd-pts">${r.score}</span>
        </span>
        <span class="bd-more">Country facts</span>
      </summary>
      ${factsHtml(c)}
    </details></li>`;
  }).join("");
}

// ---------------------------------------------------------------- country facts

// Total area in km2, used for "about the size of..." comparisons.
const US_STATES_KM2 = [
  ["Alaska", 1723337], ["Texas", 695662], ["California", 423967], ["Montana", 380831], ["New Mexico", 314917],
  ["Arizona", 295234], ["Nevada", 286380], ["Colorado", 269601], ["Oregon", 254799], ["Wyoming", 253335],
  ["Michigan", 250487], ["Minnesota", 225163], ["Utah", 219882], ["Idaho", 216443], ["Kansas", 213100],
  ["Nebraska", 200330], ["South Dakota", 199729], ["Washington", 184661], ["North Dakota", 183108],
  ["Oklahoma", 181037], ["Missouri", 180540], ["Florida", 170312], ["Wisconsin", 169635], ["Georgia", 153910],
  ["Illinois", 149995], ["Iowa", 145746], ["New York", 141297], ["North Carolina", 139391], ["Arkansas", 137732],
  ["Alabama", 135767], ["Louisiana", 135659], ["Mississippi", 125438], ["Pennsylvania", 119280], ["Ohio", 116098],
  ["Virginia", 110787], ["Tennessee", 109153], ["Kentucky", 104656], ["Indiana", 94326], ["Maine", 91633],
  ["South Carolina", 82933], ["West Virginia", 62756], ["Maryland", 32131], ["Hawaii", 28313],
  ["Massachusetts", 27336], ["Vermont", 24906], ["New Hampshire", 24214], ["New Jersey", 22591],
  ["Connecticut", 14357], ["Delaware", 6446], ["Rhode Island", 4001],
];
function sizeComparison(area, cc) {
  if (!area || cc === "US") return "";
  const texas = 695662, dc = 177;
  if (area > 1.3 * US_STATES_KM2[0][1]) return `about ${(area / texas).toFixed(1).replace(/\.0$/, "")}× the size of Texas`;
  if (area < 3000) {
    const x = area / dc;
    return x < 1.5 ? "about the size of Washington, DC" : `about ${Math.round(x)}× the size of Washington, DC`;
  }
  let best = US_STATES_KM2[0], bestD = Infinity;
  for (const st of US_STATES_KM2) {
    const d = Math.abs(Math.log(area / st[1]));
    if (d < bestD) { bestD = d; best = st; }
  }
  const r = area / best[1];
  if (r > 1.2) return `a bit bigger than ${best[0]}`;
  if (r < 0.83) return `a bit smaller than ${best[0]}`;
  return `about the size of ${best[0]}`;
}

function factsHtml(c) {
  const f = c.facts || {};
  const rows = [];
  const add = (k, v) => { if (v) rows.push(`<div class="fact"><span>${k}</span><b>${escapeHtml(v)}</b></div>`); };
  const cName = NAMES[c.cc]?.[0] || c.country;
  add("Country", cName + (c.sovereign ? ` (${c.sovereign})` : ""));
  add("Capital", f.capital);
  add("Languages", (f.languages || []).slice(0, 4).join(", "));
  add("Currency", (f.currencies || []).join(", "));
  if (f.area) add("Size", `${f.area.toLocaleString("en-US")} km²` + (sizeComparison(f.area, c.cc) ? ` · ${sizeComparison(f.area, c.cc)}` : ""));
  const nb = (c.neighbors || []).map((n) => NAMES[n]?.[0]).filter(Boolean);
  add("Borders", nb.length ? nb.slice(0, 6).join(", ") + (nb.length > 6 ? ` +${nb.length - 6} more` : "") : "No land borders");
  if (f.landlocked) add("Coast", "Landlocked");
  add("People", f.demonym);
  return `<div class="facts">${rows.join("")}</div>`;
}

// ---------------------------------------------------------------- stats and streaks
// Stored under one fixed key that never changes between releases, so updates
// to the game never wipe anyone's history.

const STATS_KEY = "xenotap:stats";
function loadStats() {
  const s = store.get(STATS_KEY);
  return s && typeof s.days === "object" ? s : { days: {} };
}
function recordStats() {
  if (PRACTICE) return; // practice games never touch your stats
  const s = loadStats();
  if (s.days[date]) return;
  // "live" = finished on the puzzle's own day; only live days count toward streaks.
  s.days[date] = { t: totalOf(state.rounds), live: date === daily.todayET() ? 1 : 0 };
  store.set(STATS_KEY, s);
}
function computeStats() {
  const days = loadStats().days;
  const dates = Object.keys(days).sort();
  const totals = dates.map((d) => days[d].t);
  const played = totals.length;
  const avg = played ? Math.round(totals.reduce((a, b) => a + b, 0) / played) : 0;
  const best = played ? Math.max(...totals) : 0;
  const live = (d) => days[d] && days[d].live;
  const now = daily.todayET();
  let cur = 0;
  let d = live(now) ? now : daily.addDays(now, -1);
  while (live(d)) { cur++; d = daily.addDays(d, -1); }
  let maxStreak = 0, run = 0, prev = null;
  for (const dd of dates.filter(live)) {
    run = prev && daily.addDays(prev, 1) === dd ? run + 1 : 1;
    maxStreak = Math.max(maxStreak, run);
    prev = dd;
  }
  const hist = Array(10).fill(0);
  for (const t of totals) hist[Math.min(9, Math.floor(t / 100))]++;
  return { played, avg, best, cur, maxStreak, hist };
}
function renderStats(el) {
  const st = computeStats();
  const peak = Math.max(1, ...st.hist);
  const mine = state && state.phase === "done" ? Math.min(9, Math.floor(totalOf(state.rounds) / 100)) : -1;
  el.innerHTML = `
    <div class="stat-tiles">
      <div><b>${st.played}</b><span>Played</span></div>
      <div><b>${st.avg}</b><span>Average</span></div>
      <div><b>${st.best}</b><span>Best</span></div>
      <div><b>${st.cur}</b><span>Streak</span></div>
      <div><b>${st.maxStreak}</b><span>Best streak</span></div>
    </div>
    <div class="hist">${st.hist.map((n, k) => `
      <div class="hist-row"><span>${k * 100}+</span><div class="hist-bar${k === mine ? " mine" : ""}" style="width:${Math.max(4, (n / peak) * 100)}%">${n || ""}</div></div>`).join("")}
    </div>`;
}

let countdownTimer = null;
function tickCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const s = daily.secondsUntilRollover();
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    $("countdown").textContent = `${h}h${String(m).padStart(2, "0")}`;
    setRing($("countdown-ring"), 1 - s / 86400);
    if (daily.todayET() !== today) { $("countdown").textContent = "New!"; clearInterval(countdownTimer); }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function showAllResults(animate = true) {
  clearMarkers();
  const pairs = [];
  state.rounds.forEach((r, i) => {
    if (!r.guess) return;
    markers.extra.push(addMarker(guessEl(), r.guess));
    markers.extra.push(addMarker(answerEl(cities[i].name, true), cityLngLat(i), "center"));
    pairs.push([r.guess, cityLngLat(i)]);
  });
  setLines(pairs);
  showBorders(cities.map((c) => c.cc));
  // Center the globe on the average position of the day's answers.
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < R; i++) {
    const la = toRad(cities[i].lat), lo = toRad(cities[i].lng);
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  const center = [toDeg(Math.atan2(y, x)), Math.max(-50, Math.min(50, toDeg(Math.atan2(z, Math.hypot(x, y)))))];
  map.easeTo({ center, zoom: overviewZoom(center[1]), padding: uiPadding(), duration: animate ? 900 : 0 });
}

function copyResults() { return copyText(shareText()); }
async function copyText(text) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {}
  if (!ok) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
  }
  toast(ok ? "Copied! Paste it in the group chat." : "Could not copy. Long-press to select instead.");
}

// ---------------------------------------------------------------- archive

function renderArchive() {
  const input = $("archive-date");
  input.min = CONFIG.LAUNCH_DATE;
  input.max = today;
  input.value = date;
  const days = [];
  for (let d = today; d >= CONFIG.LAUNCH_DATE && days.length < 120; d = daily.addDays(d, -1)) days.push(d);
  $("archive-list").innerHTML = days.map((d) => {
    const s = store.get(gameKey(d));
    let st = "Play";
    if (s && s.phase === "done") st = `${totalOf(s.rounds)} pts`;
    else if (s && s.rounds && s.rounds.some((r) => r.guess || r.hint)) st = "In progress";
    const href = d === today ? "./" : `?date=${d}`;
    return `<li><a href="${href}" class="${d === date ? "current" : ""}"><span>#${daily.puzzleNumber(d)} · ${fmtDate(d)}${d === today ? " (today)" : ""}</span><span class="st">${st}</span></a></li>`;
  }).join("");
}

// ---------------------------------------------------------------- UI plumbing

function openSheet(id) { closeSheets(); $(id).hidden = false; }
function closeSheets() { document.querySelectorAll(".sheet-backdrop").forEach((s) => (s.hidden = true)); }

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

function wireUI() {
  addEventListener("resize", () => requestAnimationFrame(() => map && map.setPadding(uiPadding())));
  $("btn-confirm").onclick = () => (controller ? controller.confirm() : confirmGuess());
  $("btn-cancel").onclick = () => (controller ? controller.cancel() : cancelGuess());
  $("btn-next").onclick = nextRound;
  $("btn-hint").onclick = () => {
    openSheet("hint-sheet");
  };
  document.querySelectorAll("[data-hint]").forEach((b) => (b.onclick = () => chooseHint(b.dataset.hint)));
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheets));
  document.querySelectorAll(".sheet-backdrop").forEach((bd) => bd.addEventListener("click", (e) => { if (e.target === bd) closeSheets(); }));
  $("btn-help").onclick = () => openSheet("help-sheet");
  $("btn-stats").onclick = () => {
    if (controller) { $("stats-title").textContent = controller.title + " stats"; $("stats-body").innerHTML = controller.statsHtml(); }
    else { $("stats-title").textContent = "Your stats"; renderStats($("stats-body")); }
    openSheet("stats-sheet");
  };
  $("btn-archive").onclick = () => openSheet("menu-sheet");
  $("menu-archive").onclick = (e) => { e.preventDefault(); if (MODE !== "daily") { location.href = "./?archive=1"; return; } renderArchive(); openSheet("archive-sheet"); };
  $("menu-help").onclick = (e) => { e.preventDefault(); openSheet("help-sheet"); };
  document.querySelectorAll(`[data-mode-link="${MODE}"]`).forEach((a) => a.classList.add("current"));
  if (params.get("archive") && MODE === "daily") { renderArchive(); openSheet("archive-sheet"); }
  $("btn-end-archive").onclick = () => {
    if (PRACTICE) { store.set(PRACTICE_KEY, null); location.reload(); return; }
    renderArchive(); openSheet("archive-sheet");
  };
  $("mode-again").onclick = () => controller && controller.restart();
  $("mode-copy").onclick = () => controller && copyText(controller.shareText());
  $("archive-date").onchange = (e) => {
    const d = e.target.value;
    if (daily.isValidDate(d) && d >= CONFIG.LAUNCH_DATE && d <= today) location.href = d === today ? "./" : `?date=${d}`;
  };
  $("btn-copy").onclick = copyResults;
  $("btn-view-globe").onclick = () => { closeSheets(); showAllResults(true); };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSheets(); if (pendingGuess) cancelGuess(); }
    if (e.key === "Enter" && controller) controller.confirm();
    else if (e.key === "Enter" && pendingGuess && state.phase === "guess") confirmGuess();
  });
}


// ================================================================ practice modes
// Shared by Country Streak and Hot & Cold.

const EARTH_KM = 6371.0088;
const vec = ([lng, lat]) => { const a = toRad(lat), b = toRad(lng); return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; };
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const len = (u) => Math.hypot(u[0], u[1], u[2]);
const angle = (u, v) => Math.atan2(len(cross(u, v)), dot(u, v));

// Great-circle distance from P to the arc AB (all unit vectors), in radians.
function arcDistance(P, A, B) {
  const n0 = cross(A, B), nl = len(n0);
  if (nl < 1e-12) return angle(P, A);
  const n = [n0[0] / nl, n0[1] / nl, n0[2] / nl];
  const s = dot(P, n);
  const C0 = [P[0] - s * n[0], P[1] - s * n[1], P[2] - s * n[2]];
  const cl = len(C0);
  if (cl > 1e-12) {
    const C = [C0[0] / cl, C0[1] / cl, C0[2] / cl];
    if (dot(cross(A, C), n) >= 0 && dot(cross(C, B), n) >= 0) return Math.asin(Math.min(1, Math.abs(s)));
  }
  return Math.min(angle(P, A), angle(P, B));
}

const ringVecs = new Map(); // cc -> array of rings as unit vectors
function countryRings(cc, feats) {
  if (!ringVecs.has(cc)) {
    const rings = [];
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) for (const ring of poly) rings.push(ring.map(vec));
    }
    ringVecs.set(cc, rings);
  }
  return ringVecs.get(cc);
}

// Kilometers from a point to the nearest border of a country (0 if inside).
async function distToCountryKm(pt, cc) {
  const all = await loadAllBorders();
  const feats = all[cc] || [];
  if (inCountry(pt, { features: feats })) return 0;
  const P = vec(pt);
  let best = Infinity;
  for (const ring of countryRings(cc, feats)) {
    for (let i = 0; i < ring.length - 1; i++) {
      const d = arcDistance(P, ring[i], ring[i + 1]);
      if (d < best) best = d;
    }
  }
  return best * EARTH_KM;
}

// Countries available to the practice modes: every playable country or
// territory, plus the four giants the daily skips (they are easy here).
function modePool() {
  const byName = {};
  for (const [cc, [name]] of Object.entries(NAMES)) byName[name] = cc;
  const pool = DATA.countries.map((c) => ({
    cc: c.cc, name: c.name, flag: c.flag, tier: c.tier, kind: c.kind,
    area: c.facts?.area || 0, sov: c.sovereign ? byName[c.sovereign] || null : null, sovName: c.sovereign,
  }));
  for (const cc of ["BR", "IN", "CN", "RU"]) {
    if (NAMES[cc]) pool.push({ cc, name: NAMES[cc][0], flag: NAMES[cc][1], tier: 1, kind: "sovereign", area: 1e7, sov: null });
  }
  return pool;
}

function weightedChoice(items, weights) {
  let total = weights.reduce((a, b) => a + b, 0), r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

function setCard({ label, day, right, flag, text, hint }) {
  $("round-label").textContent = label || "";
  $("day-label").textContent = day || "";
  $("mult-label").textContent = right || "";
  $("mult-label").classList.remove("halved");
  $("target-flag").textContent = flag || "";
  $("target-text").textContent = text || "";
  const hr = $("hint-result");
  hr.hidden = !hint;
  if (hint) hr.innerHTML = hint;
}

function setHelper(text) {
  $("actions-place").hidden = false;
  $("actions-confirm").hidden = true;
  $("result-card").hidden = true;
  const h = $("helper");
  h.onclick = null; h.style.pointerEvents = "none";
  h.textContent = text;
}

function openModeSheet({ kicker, big, small, text, stats }) {
  $("mode-kicker").textContent = kicker;
  $("mode-big").textContent = big;
  $("mode-small").textContent = small || "";
  $("mode-text").innerHTML = text;
  $("mode-stats").innerHTML = stats;
  openSheet("mode-sheet");
}

function flyToCountry(cc) {
  loadAllBorders().then((all) => {
    const bb = bboxOf(cc, all[cc] || []);
    if (!bb || bb[0] > bb[2]) return;
    const span = haversineKm([bb[0], bb[1]], [bb[2], bb[3]]);
    const center = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    // Countries that straddle the antimeridian (Fiji, Russia) have useless boxes; just zoom out.
    const tooWide = bb[2] - bb[0] > 180;
    map.easeTo({
      center: tooWide ? map.getCenter() : center,
      zoom: tooWide ? overviewZoom(0) : zoomForSpan(Math.max(span * 1.4, 600)),
      padding: uiPadding(), duration: 1100,
    });
  });
}

// ---------------------------------------------------------------- Country Streak
// A country appears; tap inside it. One miss ends the run. Tapping the country
// that owns a territory also counts (Puerto Rico -> United States).

function streakMode() {
  const KEY = "xenotap:streak:run";
  const STATS = "xenotap:streak:stats";
  const pool = modePool();
  let run = store.get(KEY);
  let pending = null;
  let busy = false;

  const stats = () => store.get(STATS) || { best: 0, runs: 0, total: 0 };
  // Easy countries dominate at first; harder ones ramp in as the streak grows.
  const EASY = { 1: 1, 2: 0.55, 3: 0.25, 4: 0.1, 5: 0.05 };
  const HARD = { 1: 0.35, 2: 0.7, 3: 0.8, 4: 0.6, 5: 0.45 };
  function nextCountry() {
    const d = Math.min(1, run.streak / 25);
    const used = new Set(run.used.slice(-60));
    const cands = pool.filter((c) => !used.has(c.cc));
    const weights = cands.map((c) => (EASY[c.tier] * (1 - d) + HARD[c.tier] * d) * (c.kind === "territory" ? 0.5 : 1));
    const c = weightedChoice(cands, weights);
    run.cc = c.cc;
    run.used.push(c.cc);
    store.set(KEY, run);
  }
  const target = () => pool.find((c) => c.cc === run.cc);

  function render() {
    const t = target();
    const st = stats();
    setCard({
      label: "Country Streak",
      day: `Streak ${run.streak}`,
      right: `Best ${Math.max(st.best, run.streak)}`,
      flag: t.flag,
      text: t.kind === "territory" && t.sovName ? `${t.name} (${t.sovName})` : t.name,
      hint: t.kind === "territory" && t.sovName ? `Tapping ${escapeHtml(t.sovName)} counts too.` : "",
    });
    $("btn-hint").hidden = true;
    $("pips").innerHTML = "";
    if (pending) {
      $("actions-place").hidden = true; $("actions-confirm").hidden = false; $("result-card").hidden = true;
    } else setHelper("Tap inside the country, then confirm");
  }

  async function isCorrect(pt, t) {
    // A little slack for tiny countries, which are only a few pixels wide at the zoom cap.
    const tol = t.area && t.area < 20000 ? 30 : 5;
    if ((await distToCountryKm(pt, t.cc)) <= tol) return true;
    if (t.sov && (await distToCountryKm(pt, t.sov)) <= 5) return true;
    return false;
  }

  async function confirm() {
    if (!pending || busy || run.over) return;
    busy = true;
    const pt = pending, t = target();
    pending = null;
    $("actions-confirm").hidden = true;
    if (await isCorrect(pt, t)) {
      run.streak++;
      store.set(KEY, run);
      showBorders(t.sov ? [t.cc, t.sov] : [t.cc]);
      toast(`✓ ${t.name}! Streak ${run.streak}`);
      setTimeout(() => {
        clearMarkers(); clearBorders();
        nextCountry(); render(); busy = false;
      }, 1100);
      return;
    }
    // Miss: the run is over.
    run.over = true;
    store.set(KEY, run);
    const st = stats();
    st.runs++; st.total += run.streak; st.best = Math.max(st.best, run.streak);
    store.set(STATS, st);
    showBorders(t.sov ? [t.cc, t.sov] : [t.cc]);
    flyToCountry(t.cc);
    const [km, landed] = await Promise.all([distToCountryKm(pt, t.cc), countryAt(pt)]);
    const where = landed ? `You tapped ${NAMES[landed]?.[1] || ""} ${escapeHtml(NAMES[landed]?.[0] || landed)}` : "You tapped open water";
    busy = false;
    setTimeout(() => openModeSheet({
      kicker: "Country Streak over",
      big: String(run.streak),
      small: run.streak === 1 ? " country" : " countries",
      text: `${where}. ${t.flag} <b>${escapeHtml(t.name)}</b> was ${fmtKm(km)} away.${run.streak > 0 && run.streak >= st.best ? "<br><b>New best!</b>" : ""}`,
      stats: statsHtml(),
    }), 900);
    setHelper("Run over. Tap Play again to start a new one");
  }

  function statsHtml() {
    const st = stats();
    return `<div class="stat-tiles three">
      <div><b>${st.best}</b><span>Best streak</span></div>
      <div><b>${st.runs}</b><span>Runs</span></div>
      <div><b>${st.runs ? (st.total / st.runs).toFixed(1) : 0}</b><span>Average</span></div></div>`;
  }

  return {
    title: "Country Streak",
    start() {
      if (!run || run.over || !pool.some((c) => c.cc === run.cc)) { run = { streak: 0, used: [], over: false }; nextCountry(); }
      render();
    },
    restart() { closeSheets(); run = null; store.set(KEY, null); clearMarkers(); clearBorders(); this.start(); map.easeTo({ zoom: overviewZoom(map.getCenter().lat), duration: 700 }); },
    onTap(pt) {
      if (busy || run.over) return;
      pending = pt;
      if (markers.guess) markers.guess.setLngLat(pt); else markers.guess = addMarker(guessEl(), pt);
      render();
    },
    confirm,
    cancel() { pending = null; if (markers.guess) { markers.guess.remove(); markers.guess = null; } render(); },
    statsHtml,
    shareText() {
      return [`XenoTap Country Streak: ${run.streak} 🔥`, `Best: ${stats().best}`, location.origin + location.pathname + "?mode=streak"].join("\n");
    },
  };
}

// ---------------------------------------------------------------- Hot & Cold
// A mystery country. Every tap reports the distance to its nearest border and a
// temperature. Tap inside it to win; fewer taps is better.

const TEMPS = [
  { max: 250, name: "Burning", emoji: "🔥", color: "#ff3b30" },
  { max: 750, name: "Hot", emoji: "🌶️", color: "#ff7a45" },
  { max: 1500, name: "Warm", emoji: "☀️", color: "#ffb347" },
  { max: 3000, name: "Cool", emoji: "🌥️", color: "#9fd3f0" },
  { max: 6000, name: "Cold", emoji: "🧊", color: "#6fa8ff" },
  { max: Infinity, name: "Freezing", emoji: "🥶", color: "#8e8cff" },
];
const tempFor = (km) => TEMPS.find((t) => km <= t.max);

function hotColdMode() {
  const KEY = "xenotap:hotcold:game";
  const STATS = "xenotap:hotcold:stats";
  // Very small countries would be near impossible to tap into, so they sit this mode out.
  const pool = modePool().filter((c) => c.area >= 1000);
  const W = { 1: 1, 2: 1, 3: 0.8, 4: 0.6, 5: 0.5 };
  let game = store.get(KEY);
  let busy = false;
  const dots = [];

  const stats = () => store.get(STATS) || { played: 0, won: 0, taps: 0, best: 0 };
  const target = () => pool.find((c) => c.cc === game.cc);

  function newGame() {
    const c = weightedChoice(pool, pool.map((p) => W[p.tier] * (p.kind === "territory" ? 0.4 : 1)));
    game = { cc: c.cc, taps: [], done: false, won: false };
    store.set(KEY, game);
  }

  function drawDots() {
    dots.forEach((m) => m.remove());
    dots.length = 0;
    game.taps.forEach((tp, k) => {
      const el = document.createElement("div");
      const t = tempFor(tp.km);
      el.className = "temp-dot" + (k === game.taps.length - 1 ? " latest" : "");
      el.style.background = tp.km === 0 ? "#3ecf8e" : t.color;
      dots.push(addMarker(markerRoot(el, k === game.taps.length - 1 && tp.km > 0 ? fmtKm(tp.km) : ""), tp.pt, "center"));
    });
  }

  function render() {
    const n = game.taps.length;
    const last = game.taps[n - 1], prev = game.taps[n - 2];
    let hint = "";
    if (last) {
      const t = tempFor(last.km);
      const trend = prev ? (last.km < prev.km - 1 ? " · warmer ↑" : last.km > prev.km + 1 ? " · colder ↓" : " · same") : "";
      hint = last.km === 0 ? "✅ <b>You found it!</b>"
        : `<b style="color:${t.color}">${t.emoji} ${t.name}</b> · ${fmtKm(last.km)} from its border${trend}`;
    }
    const tt = game.done ? target() : null;
    setCard({
      label: "Hot & Cold",
      day: `${n} ${n === 1 ? "tap" : "taps"}`,
      right: `Best ${stats().best || "-"}`,
      flag: tt ? tt.flag : "❓",
      text: tt ? tt.name : "Mystery country",
      hint: hint || "Tap anywhere to take a reading.",
    });
    const giveUp = $("btn-hint");
    giveUp.hidden = false;
    giveUp.disabled = game.done;
    giveUp.textContent = "Give up";
    giveUp.onclick = () => finish(false);
    $("pips").innerHTML = "";
    setHelper(game.done ? "Tap Play again for a new mystery" : "Tap to take a reading. Tap inside it to win");
    drawDots();
  }

  async function onTap(pt) {
    if (busy || game.done) return;
    busy = true;
    const t = target();
    let km = await distToCountryKm(pt, t.cc);
    // Inside counts, and so does a tap right on the border line (small countries get more slack).
    if (km <= (t.area < 20000 ? 25 : 2)) km = 0;
    game.taps.push({ pt, km: Math.round(km) });
    store.set(KEY, game);
    busy = false;
    if (km === 0) { finish(true); return; }
    render();
  }

  function finish(won) {
    if (game.done) return;
    game.done = true; game.won = won;
    store.set(KEY, game);
    const st = stats();
    st.played++;
    if (won) { st.won++; st.taps += game.taps.length; st.best = st.best ? Math.min(st.best, game.taps.length) : game.taps.length; }
    store.set(STATS, st);
    const t = target();
    showBorders([t.cc]);
    flyToCountry(t.cc);
    render();
    const n = game.taps.length;
    setTimeout(() => openModeSheet({
      kicker: won ? "Found it!" : "Mystery revealed",
      big: won ? String(n) : t.flag,
      small: won ? (n === 1 ? " tap" : " taps") : "",
      text: `${t.flag} <b>${escapeHtml(t.name)}</b>${won ? "" : " was the mystery country"}.<div class="trail">${trail()}</div>`,
      stats: statsHtml(),
    }), 900);
  }

  const trail = () => game.taps.map((tp) => (tp.km === 0 ? "✅" : tempFor(tp.km).emoji)).join("");

  function statsHtml() {
    const st = stats();
    return `<div class="stat-tiles four">
      <div><b>${st.played}</b><span>Played</span></div>
      <div><b>${st.won}</b><span>Found</span></div>
      <div><b>${st.won ? (st.taps / st.won).toFixed(1) : "-"}</b><span>Avg taps</span></div>
      <div><b>${st.best || "-"}</b><span>Best</span></div></div>`;
  }

  return {
    title: "Hot & Cold",
    start() {
      if (!game || game.done || !pool.some((c) => c.cc === game.cc)) newGame();
      render();
    },
    restart() { closeSheets(); newGame(); clearBorders(); render(); map.easeTo({ zoom: overviewZoom(map.getCenter().lat), duration: 700 }); },
    onTap, confirm() {}, cancel() {},
    statsHtml,
    shareText() {
      const t = target();
      return [
        game.won ? `XenoTap Hot & Cold: found it in ${game.taps.length} ${game.taps.length === 1 ? "tap" : "taps"}` : "XenoTap Hot & Cold: gave up",
        trail(),
        location.origin + location.pathname + "?mode=hotcold",
      ].join("\n");
    },
  };
}

boot().catch((err) => {
  console.error(err);
  const l = $("loading");
  if (l) l.innerHTML = `<div style="text-align:center;font-size:16px;padding:20px">XenoTap failed to load.<br><small>${escapeHtml(String(err.message || err))}</small><br><br><button class="btn prism" onclick="location.reload()">Reload</button></div>`;
});
