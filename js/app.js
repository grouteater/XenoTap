import { CONFIG } from "./config.js?v=6";
import * as daily from "./daily.js?v=6";

const $ = (id) => document.getElementById(id);
// Cache-busting stamp, inherited from how index.html loaded this file (e.g. "?v=6").
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
let date = params.get("date");
if (!date || !daily.isValidDate(date) || date > today || date < CONFIG.LAUNCH_DATE) date = today;
const isToday = date === today;

let state = null;
let cities = [];
let map = null;
let probeMode = false;
let pendingGuess = null;
const markers = { guess: null, answer: null, probe: null, extra: [] };

function freshState(ids) {
  return { v: 3, date, ids, round: 0, phase: "guess", rounds: Array.from({ length: R }, () => ({ guess: null, hint: null })) };
}
function save() { store.set(gameKey(date), state); }

async function boot() {
  const data = await fetch("data/places.json" + V).then((r) => r.json());
  daily.initData(data);
  cities = daily.puzzleFor(date).map(daily.describeCity);

  state = store.get(gameKey(date));
  const ids = cities.map((c) => c.index).join(",");
  if (!state || state.v !== 3 || state.ids !== ids || !Array.isArray(state.rounds) || state.rounds.length !== R) state = freshState(ids);

  initMap();
  wireUI();
  $("loading").remove();

  if (!store.get("xenotap:v2:seenHelp")) { openSheet("help-sheet"); store.set("xenotap:v2:seenHelp", true); }
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
    render(true);
    setTimeout(loadAllBorders, 1500); // warm the outline cache before the first reveal
  });

  map.on("click", onMapTap);
  window.xenotap = { map, cities }; // handy for poking at the game from devtools
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
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      if (inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole))) return true;
    }
  }
  return false;
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
  if (state.phase !== "guess" || document.querySelector(".sheet-backdrop:not([hidden])")) return;
  if (!onGlobe(e)) return;
  const ll = e.lngLat.wrap();
  const lngLat = [ll.lng, ll.lat];

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
  $("day-label").textContent = `#${daily.puzzleNumber(date)}${isToday ? "" : " archive"}`;
  $("mult-label").textContent = r.hint ? "max 50 · hint" : `worth ${fmtMult(weightFor(i))}`;
  $("mult-label").classList.toggle("halved", !!r.hint);
  $("target-flag").textContent = c.flag;
  $("target-text").textContent = c.label;
  document.title = `XenoTap #${daily.puzzleNumber(date)}`;

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
  loadBorder(cities[i].cc).then((fc) => {
    if (state.phase === "reveal" && state.round === i && inCountry(r.guess, fc)) {
      $("result-dist").innerHTML = `${escapeHtml(distText)} <span class="badge">Right country</span>`;
    }
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
  const url = location.origin + location.pathname + (isToday ? "" : `?date=${date}`);
  return [
    `XenoTap #${daily.puzzleNumber(date)} · ${fmtDate(date)}`,
    cells.slice(0, 3).join("  "),
    cells.slice(3).join("  "),
    `${total} / ${Math.round(maxTotal())}`,
    url,
  ].join("\n");
}

function openEnd() {
  const { total } = totals();
  $("end-day").textContent = `XenoTap #${daily.puzzleNumber(date)} · ${fmtDate(date)}${isToday ? "" : " (archive)"}`;
  $("end-total").textContent = total;
  $("end-max").textContent = ` / ${Math.round(maxTotal())}`;
  $("end-grid").innerHTML = state.rounds.map((r) => `<span>${roundCell(r)}</span>`).join("");
  $("breakdown").innerHTML = state.rounds.map((r, i) => {
    const c = cities[i];
    return `<li><span>${c.flag}</span><span><div class="bd-name">${escapeHtml(c.label)}</div><div class="bd-sub">${fmtKm(r.km)}${r.hint ? " · hint 💡" : ""} · counts ${fmtMult(weightFor(i))}</div></span><span class="bd-pts">${r.score}</span></li>`;
  }).join("");
  $("countdown-ring").hidden = !isToday;
  openSheet("end-sheet");
  tickCountdown();
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

async function copyResults() {
  const text = shareText();
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
  $("btn-confirm").onclick = confirmGuess;
  $("btn-cancel").onclick = cancelGuess;
  $("btn-next").onclick = nextRound;
  $("btn-hint").onclick = () => {
    openSheet("hint-sheet");
  };
  document.querySelectorAll("[data-hint]").forEach((b) => (b.onclick = () => chooseHint(b.dataset.hint)));
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheets));
  document.querySelectorAll(".sheet-backdrop").forEach((bd) => bd.addEventListener("click", (e) => { if (e.target === bd) closeSheets(); }));
  $("btn-help").onclick = () => openSheet("help-sheet");
  $("btn-archive").onclick = () => { renderArchive(); openSheet("archive-sheet"); };
  $("btn-end-archive").onclick = () => { renderArchive(); openSheet("archive-sheet"); };
  $("archive-date").onchange = (e) => {
    const d = e.target.value;
    if (daily.isValidDate(d) && d >= CONFIG.LAUNCH_DATE && d <= today) location.href = d === today ? "./" : `?date=${d}`;
  };
  $("btn-copy").onclick = copyResults;
  $("btn-view-globe").onclick = () => { closeSheets(); showAllResults(true); };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSheets(); if (pendingGuess) cancelGuess(); }
    if (e.key === "Enter" && pendingGuess && state.phase === "guess") confirmGuess();
  });
}

boot().catch((err) => {
  console.error(err);
  const l = $("loading");
  if (l) l.innerHTML = `<div style="text-align:center;font-size:16px;padding:20px">XenoTap failed to load.<br><small>${escapeHtml(String(err.message || err))}</small><br><br><button class="btn prism" onclick="location.reload()">Reload</button></div>`;
});
