// Builds data/borders.json: simplified outlines, keyed by country code, for every place
// in data/places.json, shown on the globe when a round's answer is revealed.
//
// Source: mledoze/countries outlines (ODbL), via the world-countries package.
// Simplified to ~2 km detail, which is finer than the globe's zoom cap shows.
//
//   cd tools && npm install world-countries mapshaper && node build-borders.mjs

import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";

const require = createRequire(import.meta.url);
const countries = require("world-countries");
const here = dirname(fileURLToPath(import.meta.url));
const places = JSON.parse(readFileSync(join(here, "..", "data", "places.json"), "utf8"));
const srcDir = join(dirname(require.resolve("world-countries/package.json")), "data");

// Every country on Earth (not just playable ones), so the game can say where any guess landed.
const features = [];
for (const meta of countries) {
  let gj;
  try { gj = JSON.parse(readFileSync(join(srcDir, meta.cca3.toLowerCase() + ".geo.json"), "utf8")); } catch { continue; }
  for (const f of gj.features) if (f.geometry) features.push({ type: "Feature", properties: { cc: meta.cca2 }, geometry: f.geometry });
}

const tmpIn = join(tmpdir(), "xenotap-borders-in.json");
const tmpOut = join(tmpdir(), "xenotap-borders-out.json");
writeFileSync(tmpIn, JSON.stringify({ type: "FeatureCollection", features }));
const mapshaper = join(dirname(require.resolve("mapshaper/package.json")), "bin", "mapshaper");
execFileSync(process.execPath, [mapshaper, tmpIn, "-simplify", "dp", "interval=2000", "keep-shapes",
  "-o", tmpOut, "precision=0.001", "format=geojson"], { stdio: "inherit" });

const simplified = JSON.parse(readFileSync(tmpOut, "utf8"));
const byCC = {};
for (const f of simplified.features) if (f.geometry) (byCC[f.properties.cc] ||= []).push({ type: "Feature", properties: {}, geometry: f.geometry });
writeFileSync(join(here, "..", "data", "borders.json"), JSON.stringify(byCC));
console.log(`wrote ${Object.keys(byCC).length} outlines`);
