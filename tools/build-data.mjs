// Builds data/places.json from GeoNames (via the all-the-cities package)
// and country metadata (via the world-countries package).
//
// You only need this if you want to change which cities are in the pool.
//   cd tools && npm install all-the-cities world-countries && node build-data.mjs
// Then run build-borders.mjs to refresh the country outlines.
//
// WARNING: changing the dataset changes every puzzle, including past
// archive days. Do it before launch, or accept that history reshuffles.

import { createRequire } from "module";
import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const cities = require("all-the-cities");
const countries = require("world-countries");

// ---- Tunables -------------------------------------------------------------
const POPULATION_FLOOR = 15000;      // cities below this are dropped (capitals exempt)
const MAX_CITIES_PER_COUNTRY = 80;   // keep the N most populous per country
const EXCLUDED_COUNTRIES = ["BR", "IN", "CN", "RU", "MN"];
// Places with no real cities, or not useful as answers.
const SKIP = ["AQ", "TF", "BV", "HM", "GS", "UM", "IO", "PN", "CC", "CX", "TK", "NF", "SJ"];
// ---------------------------------------------------------------------------

// Display rule for places with their own ISO code that are not sovereign states:
//   dependent territory -> "City, Territory, Sovereign"  (own flag)
//   disputed / partially recognized -> "City, Name"      (no sovereign shown)
const SOVEREIGN = {
  PR: "United States", GU: "United States", VI: "United States", AS: "United States", MP: "United States",
  HK: "China", MO: "China",
  GL: "Denmark", FO: "Denmark",
  PF: "France", NC: "France", RE: "France", GP: "France", MQ: "France", GF: "France", YT: "France",
  PM: "France", WF: "France", BL: "France", MF: "France",
  AW: "Netherlands", CW: "Netherlands", SX: "Netherlands", BQ: "Netherlands",
  BM: "United Kingdom", KY: "United Kingdom", VG: "United Kingdom", TC: "United Kingdom",
  AI: "United Kingdom", MS: "United Kingdom", GI: "United Kingdom", FK: "United Kingdom",
  SH: "United Kingdom", IM: "United Kingdom", JE: "United Kingdom", GG: "United Kingdom",
  CK: "New Zealand", NU: "New Zealand",
  AX: "Finland",
};
const DISPUTED = ["EH", "PS", "TW", "XK"];

const US_STATES = { AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming" };
const CA_PROV = { "01":"Alberta","02":"British Columbia","03":"Manitoba","04":"New Brunswick","05":"Newfoundland and Labrador","07":"Nova Scotia","08":"Ontario","09":"Prince Edward Island","10":"Quebec","11":"Saskatchewan","12":"Yukon","13":"Northwest Territories","14":"Nunavut" };
const AU_STATES = { "01":"Australian Capital Territory","02":"New South Wales","03":"Northern Territory","04":"Queensland","05":"South Australia","06":"Tasmania","07":"Victoria","08":"Western Australia" };
const REGION_NAMES = { US: US_STATES, CA: CA_PROV, AU: AU_STATES };


// Difficulty tier per place, from the point of view of a typical American
// player: 1 = can point to it blindfolded, 5 = most people could not place it.
// Rounds get harder as the day goes on (see ROUND_TIERS in js/config.js).
const TIERS = {
  1: "US CA MX GB IE FR DE IT ES PT GR NL CH SE NO JP KR AU NZ EG ZA IL TR CU JM PR IS PH TH VN SA AR",
  2: "AT BE DK FI PL CZ HU UA HR BS DO HT CO PE CL VE EC CR PA KE MA NG ET AE IR IQ AF PK ID MY SG TW HK KP GL NP MN BO UY SY JO LB QA KW MC VA MT CY LU",
  3: "RO BG RS SK SI BA AL ME LT LV EE KZ UZ LK BD MM KH TN DZ SD GH TZ UG RW SO CM ZW ZM MG GT HN NI SV BZ OM YE PS PY SM LI AD MO",
  4: "AM GE BY MK XK BW NA MD AZ SS ER DJ CD AO MZ MW LS SZ BI CI GI IM",
  5: "KG TJ TM SR GY GF BN PG EH BT LA LY SN ML BF NE TD CF CG GA GQ GN GW SL LR GM TG BJ MR",
};
const TIER_OF = {};
for (const [t, list] of Object.entries(TIERS)) for (const cc of list.split(" ")) TIER_OF[cc] = +t;

// ---- Islands ---------------------------------------------------------------
// Island nations (no land border, plus Hispaniola and Timor) are only playable
// if they are on this list. The number is their pick weight: big, famous ones
// play like any country, the rest are kept rare.
const ISLAND_NATIONS_ALLOWED = {
  JP: 1, GB: 1, IE: 1, IS: 1, NZ: 1, PH: 1, ID: 1,
  CU: 0.35, JM: 0.35, PR: 0.35, BS: 0.35, DO: 0.35, HT: 0.35, MG: 0.35, LK: 0.35,
  TW: 0.35, CY: 0.35, MT: 0.35, SG: 0.35, IM: 0.35, GL: 0.35,
};
const ISLAND_SHARED_LAND = ["DO", "HT", "TL", "GB", "IE", "MF", "SX"]; // islands that do have a land border
// Cities on a small island (< REMOTE_ISLAND_KM2) that is more than
// REMOTE_ISLAND_GAP_KM from the country's main landmass are dropped
// (Canaries, Madeira, Crete, Mallorca, Okinawa, Jeju...). Exceptions by name:
const REMOTE_ISLAND_KM2 = 25000;
const REMOTE_ISLAND_GAP_KM = 150;
const REMOTE_ISLAND_KEEP = ["US:Honolulu"];

const geoDir = join(dirname(require.resolve("world-countries/package.json")), "data");
const RAD = Math.PI / 180;
function ringAreaKm2(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += (r[i + 1][0] - r[i][0]) * RAD * (2 + Math.sin(r[i][1] * RAD) + Math.sin(r[i + 1][1] * RAD));
  return Math.abs((a * 6371 * 6371) / 2);
}
function inRing(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function km(a, b) {
  const h = Math.sin(((b[1] - a[1]) * RAD) / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(((b[0] - a[0]) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function landmasses(cca3) {
  const gj = JSON.parse(readFileSync(join(geoDir, cca3.toLowerCase() + ".geo.json"), "utf8"));
  const out = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) out.push({ ring: poly[0], area: ringAreaKm2(poly[0]) });
  }
  return out.sort((a, b) => b.area - a.area);
}
function isRemoteIslandCity(city, lands) {
  if (lands.length < 2) return false;
  const pt = city.loc.coordinates;
  let home = lands.find((l) => inRing(pt, l.ring));
  if (!home) { // coastal points can fall just outside a simplified outline
    let best = Infinity;
    for (const l of lands) for (let i = 0; i < l.ring.length; i += 4) {
      const d = (l.ring[i][0] - pt[0]) ** 2 + (l.ring[i][1] - pt[1]) ** 2;
      if (d < best) { best = d; home = l; }
    }
  }
  if (home === lands[0] || home.area >= REMOTE_ISLAND_KM2) return false;
  // Distance to the nearest big landmass of the same country (Bali sits next to Java).
  let gap = Infinity;
  for (const l of lands) {
    if (l !== lands[0] && l.area < REMOTE_ISLAND_KM2) continue;
    for (let i = 0; i < l.ring.length; i += 2) gap = Math.min(gap, km(pt, l.ring[i]));
  }
  return gap > REMOTE_ISLAND_GAP_KM;
}

// ---- City fame (drives rounds 1 to 4) ----------------------------------------
// FAMOUS: rounds 1-2. Popular US and Canadian cities, very well known European
// cities, and a few extremely well known cities elsewhere.
const FAMOUS = `
US:New York City|US:Los Angeles|US:Chicago|US:Houston|US:Phoenix|US:Philadelphia|US:San Antonio|US:San Diego|US:Dallas
US:San Francisco|US:Seattle|US:Denver|US:Boston|US:Miami|US:Atlanta|US:Las Vegas|US:Washington, D.C.|US:Nashville
US:New Orleans|US:Detroit|US:Portland|US:Austin|US:Orlando|US:Minneapolis|US:Honolulu|US:Salt Lake City|US:Baltimore
US:St. Louis|US:Pittsburgh|US:Tampa|US:Charlotte|US:Indianapolis|US:Kansas City|US:Memphis|US:Anchorage
CA:Toronto|CA:Montréal|CA:Vancouver|CA:Calgary|CA:Ottawa|CA:Edmonton|CA:Québec|CA:Winnipeg
GB:London|GB:Edinburgh|GB:Manchester|GB:Liverpool|FR:Paris|IT:Rome|IT:Venice|IT:Milan|IT:Florence|ES:Madrid|ES:Barcelona
DE:Berlin|DE:Munich|NL:Amsterdam|AT:Vienna|CZ:Prague|IE:Dublin|PT:Lisbon|SE:Stockholm|DK:Copenhagen
JP:Tokyo|JP:Kyoto|JP:Osaka|AU:Sydney|AU:Melbourne|MX:Mexico City|MX:Cancún|HK:Hong Kong|AE:Dubai|KR:Seoul|SG:Singapore
CU:Havana|PR:San Juan|IL:Jerusalem
US:Cleveland|US:Milwaukee|US:Sacramento|US:San Jose|US:Columbus|US:Raleigh|US:Jacksonville|US:Louisville|US:Oklahoma City|US:Buffalo|CA:Victoria|CA:Halifax|FR:Nice|ES:Sevilla|IT:Naples|DE:Hamburg|DE:Frankfurt am Main|CH:Zürich|CH:Genève|TH:Bangkok|NZ:Auckland|AU:Brisbane|MX:Tijuana|MX:Acapulco de Juárez|BS:Nassau|JM:Montego Bay|IL:Tel Aviv|JP:Hiroshima`;
// KNOWN: rounds 3-4. Places most players have heard of. National capitals of
// tier 1-2 countries outside Africa are added automatically.
const KNOWN = `
NO:Oslo|NO:Bergen|BE:Brussels|BE:Antwerpen|TR:Istanbul|TR:Ankara|TR:İzmir|TR:Antalya|GR:Athens|GR:Thessaloníki|FI:Helsinki
PL:Warsaw|PL:Kraków|HU:Budapest|CH:Bern|FR:Lyon|FR:Marseille|FR:Bordeaux|FR:Strasbourg
IT:Turin|IT:Bologna|IT:Verona|IT:Genoa|IT:Pisa|ES:Valencia|ES:Málaga|ES:Granada|ES:Bilbao
DE:Köln|DE:Stuttgart|DE:Düsseldorf|DE:Dresden|AT:Salzburg|AT:Innsbruck|NL:Rotterdam
NL:The Hague|PT:Porto|GB:Glasgow|GB:Birmingham|GB:Belfast|GB:Cardiff|GB:Bristol|GB:Oxford|GB:Cambridge|GB:Leeds
SE:Göteborg|IS:Reykjavík|EE:Tallinn|LV:Riga|LT:Vilnius|UA:Kyiv|UA:Odessa|RO:Bucharest|BG:Sofia|RS:Belgrade|HR:Zagreb
HR:Split|HR:Dubrovnik|SI:Ljubljana|SK:Bratislava|BA:Sarajevo|MC:Monaco|LU:Luxembourg|BY:Minsk|CY:Nicosia
TH:Phuket|TH:Chiang Mai|VN:Hanoi|VN:Ho Chi Minh City|PH:Manila|MY:Kuala Lumpur|ID:Jakarta|ID:Denpasar
TW:Taipei|KR:Busan|JP:Sapporo|JP:Yokohama|JP:Nagoya|JP:Kobe|JP:Nagasaki|AE:Abu Dhabi|QA:Doha|
SA:Riyadh|SA:Mecca|SA:Jeddah|IR:Tehran|IQ:Baghdad|AF:Kabul|PK:Karachi|PK:Islamabad|PK:Lahore|NP:Kathmandu|LK:Colombo
LB:Beirut|JO:Amman|SY:Damascus|KW:Kuwait City|OM:Muscat|KP:Pyongyang
AR:Buenos Aires|AR:Córdoba|PE:Lima|PE:Cusco|CO:Bogotá|CO:Medellín|CO:Cartagena|CL:Santiago|EC:Quito|VE:Caracas
BO:La Paz|UY:Montevideo|CR:San José|DO:Santo Domingo|HT:Port-au-Prince|JM:Kingston|
GT:Guatemala City|MX:Guadalajara|MX:Monterrey|MX:Puerto Vallarta|MX:Mérida
US:Tucson|US:Albuquerque|US:El Paso|US:Cincinnati|
US:Richmond|US:Savannah|US:Charleston|US:Santa Fe|US:Reno|US:Boise|US:Omaha|
US:Birmingham|US:Des Moines|US:Madison|US:Spokane|US:Tulsa
CA:Saskatoon|CA:Regina|CA:St. John's|CA:Hamilton
AU:Perth|AU:Adelaide|AU:Canberra|AU:Hobart|AU:Darwin|AU:Gold Coast|NZ:Wellington|NZ:Christchurch`;
const parseList = (txt) => new Set(txt.replace(/\n/g, "|").split("|").map((x) => x.trim()).filter(Boolean));
const FAMOUS_SET = parseList(FAMOUS);
const KNOWN_SET = parseList(KNOWN);
const matchedFame = new Set();

const BAD_FEATURES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH", "PPLF", "PPLR"]);

function continentOf(c) {
  if (c.region === "Americas") return c.subregion === "South America" ? "South America" : "North America";
  return c.region; // Africa, Asia, Europe, Oceania
}

const outCountries = [];
const outCities = [];
const byCC = new Map(countries.map((c) => [c.cca2, c]));

const grouped = new Map();
for (const c of cities) {
  if (BAD_FEATURES.has(c.featureCode)) continue;
  if (!grouped.has(c.country)) grouped.set(c.country, []);
  grouped.get(c.country).push(c);
}

const droppedIslands = [];
const droppedCities = [];
for (let [cc, list] of [...grouped.entries()].sort()) {
  const meta = byCC.get(cc);
  if (!meta || EXCLUDED_COUNTRIES.includes(cc) || SKIP.includes(cc)) continue;
  if (meta.region === "Antarctic") continue;

  const islandNation = cc !== "AU" && ((meta.borders || []).length === 0 || ISLAND_SHARED_LAND.includes(cc));
  if (islandNation && !(cc in ISLAND_NATIONS_ALLOWED)) { droppedIslands.push(cc); continue; }
  const lands = landmasses(meta.cca3);
  const keepCity = (x) => REMOTE_ISLAND_KEEP.includes(cc + ":" + x.name) || !isRemoteIslandCity(x, lands);
  const before = list.length;
  list = list.filter(keepCity);
  if (list.length < before) droppedCities.push(`${cc} -${before - list.length}`);

  const isCap = (x) => x.featureCode === "PPLC";
  let pool = list
    .filter((x) => x.population >= POPULATION_FLOOR)
    .sort((a, b) => b.population - a.population)
    .slice(0, MAX_CITIES_PER_COUNTRY);
  for (const cap of list.filter(isCap)) if (!pool.includes(cap)) pool.push(cap);
  // Famous / known cities are always in, even if they fall outside the top 80 (Venice).
  // Duplicate names resolve to the most populous match (Portland OR, not Portland ME).
  const fameOf = new Map();
  for (const [set, level] of [[FAMOUS_SET, 2], [KNOWN_SET, 1]]) {
    for (const key of set) {
      const [kcc, name] = [key.slice(0, 2), key.slice(3)];
      if (kcc !== cc) continue;
      const best = list.filter((x) => x.name === name).sort((a, b) => b.population - a.population)[0];
      if (!best) continue;
      matchedFame.add(key);
      if (!fameOf.has(best)) fameOf.set(best, level);
      if (!pool.includes(best)) pool.push(best);
    }
  }
  if (pool.length === 0) pool = list.sort((a, b) => b.population - a.population).slice(0, 2);
  if (pool.length === 0) continue;

  const disputed = DISPUTED.includes(cc);
  const territory = !meta.independent && !disputed;
  if (territory && !SOVEREIGN[cc]) { console.warn("No sovereign mapping for", cc, meta.name.common); continue; }

  const ci = outCountries.length;
  outCountries.push({
    cc,
    name: meta.name.common,
    flag: meta.flag || "🇧🇶",  // only Caribbean Netherlands lacks one in the source data
    continent: continentOf(meta),
    sovereign: territory ? SOVEREIGN[cc] : null,
    kind: territory ? "territory" : disputed ? "disputed" : "sovereign",
    tier: TIER_OF[cc] || (console.warn("No tier for", cc), 4),
    subregion: meta.subregion,
    weight: islandNation ? ISLAND_NATIONS_ALLOWED[cc] : 1,
    facts: {
      capital: (meta.capital || [])[0] || null,
      languages: Object.values(meta.languages || {}),
      currencies: Object.values(meta.currencies || {}).map((c) => c.name),
      area: Math.round(meta.area || 0),
      demonym: meta.demonyms?.eng?.m || null,
      landlocked: !!meta.landlocked,
    },
    // Land neighbors (ISO alpha-2). Two neighbors never appear on the same day.
    neighbors: (meta.borders || []).map((c3) => countries.find((x) => x.cca3 === c3)?.cca2).filter(Boolean),
  });

  const regions = REGION_NAMES[cc];
  for (const x of pool) {
    const [lng, lat] = x.loc.coordinates;
    outCities.push([
      x.name,
      ci,
      regions ? regions[x.adminCode] || "" : "",
      +lat.toFixed(4),
      +lng.toFixed(4),
      x.population,
      isCap(x) ? 1 : 0,
      fameOf.get(x) || 0, // 2 = famous (rounds 1-2), 1 = known (rounds 3-4)
    ]);
  }
}

// Names and flags for every country on Earth, used to say where a guess landed.
const names = {};
for (const c of countries) names[c.cca2] = [c.name.common, c.flag || ""];

const missing = [...FAMOUS_SET, ...KNOWN_SET].filter((k) => !matchedFame.has(k));
if (missing.length) console.warn("fame list entries not found:", missing.join(", "));
console.log("island nations dropped:", droppedIslands.join(" "));
console.log("remote island cities dropped:", droppedCities.join(", "));
const here = dirname(fileURLToPath(import.meta.url));
const out = {
  source: "GeoNames (CC BY 4.0) via all-the-cities; country metadata from mledoze/countries (ODbL)",
  populationFloor: POPULATION_FLOOR,
  maxCitiesPerCountry: MAX_CITIES_PER_COUNTRY,
  countries: outCountries,
  names,
  cities: outCities, // [name, countryIndex, stateOrProvince, lat, lng, population, isCapital, fame]
};
writeFileSync(join(here, "..", "data", "places.json"), JSON.stringify(out));
console.log(`countries: ${outCountries.length}  cities: ${outCities.length}`);
