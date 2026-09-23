// Builds data/places.json from GeoNames (via the all-the-cities package)
// and country metadata (via the world-countries package).
//
// You only need this if you want to change which cities are in the pool.
//   cd tools && npm install all-the-cities world-countries && node build-data.mjs
//
// WARNING: changing the dataset changes every puzzle, including past
// archive days. Do it before launch, or accept that history reshuffles.

import { createRequire } from "module";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const cities = require("all-the-cities");
const countries = require("world-countries");

// ---- Tunables -------------------------------------------------------------
const POPULATION_FLOOR = 15000;      // cities below this are dropped (capitals exempt)
const MAX_CITIES_PER_COUNTRY = 80;   // keep the N most populous per country
const EXCLUDED_COUNTRIES = ["BR", "IN", "CN", "RU"];
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

for (const [cc, list] of [...grouped.entries()].sort()) {
  const meta = byCC.get(cc);
  if (!meta || EXCLUDED_COUNTRIES.includes(cc) || SKIP.includes(cc)) continue;
  if (meta.region === "Antarctic") continue;

  const isCap = (x) => x.featureCode === "PPLC";
  let pool = list
    .filter((x) => x.population >= POPULATION_FLOOR)
    .sort((a, b) => b.population - a.population)
    .slice(0, MAX_CITIES_PER_COUNTRY);
  for (const cap of list.filter(isCap)) if (!pool.includes(cap)) pool.push(cap);
  if (pool.length === 0) pool = list.sort((a, b) => b.population - a.population).slice(0, 2);
  if (pool.length === 0) continue;

  const disputed = DISPUTED.includes(cc);
  const territory = !meta.independent && !disputed;
  if (territory && !SOVEREIGN[cc]) { console.warn("No sovereign mapping for", cc, meta.name.common); continue; }

  const ci = outCountries.length;
  outCountries.push({
    cc,
    name: meta.name.common,
    flag: meta.flag,
    continent: continentOf(meta),
    sovereign: territory ? SOVEREIGN[cc] : null,
    kind: territory ? "territory" : disputed ? "disputed" : "sovereign",
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
    ]);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const out = {
  source: "GeoNames (CC BY 4.0) via all-the-cities; country metadata from mledoze/countries (ODbL)",
  populationFloor: POPULATION_FLOOR,
  maxCitiesPerCountry: MAX_CITIES_PER_COUNTRY,
  countries: outCountries,
  cities: outCities, // [name, countryIndex, stateOrProvince, lat, lng, population, isCapital]
};
writeFileSync(join(here, "..", "data", "places.json"), JSON.stringify(out));
console.log(`countries: ${outCountries.length}  cities: ${outCities.length}`);
