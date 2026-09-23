# XenoTap

A daily geography game. Six places a day, one unlabeled satellite globe, tap where you think each one is. Static site, no backend, no build step, hosted free on GitHub Pages.

## Put it online (GitHub Pages, about 5 minutes)

1. Sign in at github.com and click **New repository** (the + in the top right).
2. Name it `xenotap`, set it to **Public**, and click **Create repository**. Leave the other options alone.
3. On the empty repo page, click the **uploading an existing file** link.
4. Open the XenoTap folder on your computer, select **everything inside it** (not the folder itself), and drag it all onto the upload page. Subfolders (`css`, `js`, `data`, `vendor`, `tools`) upload with their structure.
5. Click **Commit changes**.
6. Go to **Settings > Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main**, folder **/ (root)**, then **Save**.
7. Wait a minute or two. Your game is live at `https://YOUR-USERNAME.github.io/xenotap/`.

To update later: on the repo page click **Add file > Upload files**, drag in the new contents of the folder, and commit. Files with the same name are replaced. Pages redeploys on its own within a minute or two. (For a one-line tweak you can also open the file on GitHub, click the pencil icon, edit, and commit.)

## Playing

* New puzzle at midnight Eastern time. Everyone gets the same six, whatever their timezone.
* Archive: the menu button (top right), or add `?date=2026-09-15` to the URL. Earliest day is `LAUNCH_DATE`.
* Progress saves in the browser per day, so refreshing or coming back later resumes the same game, and archive games never overwrite today's.

## Tuning

Everything adjustable is in `js/config.js`.

| Setting | Default | What it does |
|---|---|---|
| `SCORE_DECAY_KM` | 2800 | Base score = 100 × e^(−km / this). Raise to be more forgiving. |
| `PERFECT_RADIUS_KM` | 25 | Guesses this close get a full 100. |
| `MULTIPLIERS` | 1, 1.25, 1.5, 1.75, 2, 2.5 | One per round. Max total 1000. |
| `ROUND_NAMES` | Warm-up ... Boss | Shown on the round card. |
| `HINT_FACTOR` | 0.5 | A hint multiplies that round's multiplier by this. |
| `MAX_KM_PER_PX` | 525/390 | Zoom cap (see below). |
| `LAUNCH_DATE` | 2026-09-01 | Puzzle #1 and the start of the archive. |

What the scoring curve looks like at the default 2800:

| Distance | Base score |
|---|---|
| 25 km | 100 |
| 100 km | 97 |
| 300 km | 91 |
| 500 km | 84 |
| 1,000 km | 71 |
| 2,000 km | 49 |
| 3,000 km | 35 |
| 5,000 km | 17 |

Landing anywhere in the right country almost always scores well: most countries are well under 1,000 km across, and even a guess at the wrong end of the US or Canada keeps about half the points.

**Settings that change puzzles.** `LAUNCH_DATE`, `SEED_SALT`, the selection settings at the bottom of `config.js`, and `data/places.json` all feed the daily picks. Changing any of them reshuffles every day, archive included. Settle them before sharing the link widely.

## How it works (and why)

**Globe: MapLibre GL JS 5 in globe projection.** It is free, open source, and fast on phones because it streams ordinary map tiles instead of a full 3D terrain engine like CesiumJS (heavier download, slower on mobile). It also has reliable screen-to-lat/lng conversion and a built-in "tap vs drag" distinction, so dragging to spin never drops a pin. The library is copied into `vendor/`, so the site does not depend on a CDN.

**Imagery: Esri World Imagery.** No API key, no signup, no labels, no borders. Attribution shows in the corner as Esri requires. If you ever want a fully open-licensed alternative, `config.js` has a commented-out Sentinel-2 cloudless option from EOX that you can swap in.

**Zoom cap.** The limit is a ground resolution of 1.35 km per screen pixel, which is 525 km (about the width of Florida) across a 390 px wide phone. MapLibre's zoom scale changes with latitude, so the cap is recalculated from the latitude at the center of the view every time the globe moves. Measured result: 526 km across a phone at the equator, 30°, 45°, 60° and 75°. It is enforced as the map's hard `maxZoom`, so pinch, scroll wheel, keyboard and double tap cannot get past it. On a wider desktop screen you see more ground at max zoom, but the detail per pixel is the same.

**Daily picks: harder as the day goes on.** Each round picks a country first, then a city inside it. Knowing the country is the main skill, and knowing the exact city earns the last few points. Every place has a difficulty tier from 1 to 5, judged from a typical American's point of view (set in `tools/build-data.mjs`):

| Tier | Examples | Count |
|---|---|---|
| 1 | Canada, Mexico, UK, Italy, Japan, Australia, Egypt | 32 |
| 2 | Austria, Colombia, Kenya, Iran, Indonesia, Greenland | 50 |
| 3 | Romania, Kazakhstan, Ghana, Honduras, Bhutan, Fiji | 62 |
| 4 | Moldova, Kyrgyzstan, DR Congo, Suriname, Vanuatu, Guernsey | 56 |
| 5 | Senegal, Mali, Chad, Gabon, Comoros, Tuvalu, Wallis and Futuna | 33 |

Rounds 1 to 6 draw from tiers 1, 2, 3, 3 or 4, 4, then 5 (`ROUND_TIERS` in `config.js`). Early rounds also lean toward bigger, better known cities, and late rounds toward smaller ones (`ROUND_POP_EXPONENT`). Dependent territories get 0.3 weight so tiny islands do not crowd out real countries. Each day has at most two places per continent. The same country will not come back within 14 days, and the same city will not come back within 60.

**Deterministic, with no history file.** The date string (Eastern time) is hashed into a seed for a small seeded random generator (mulberry32). To avoid repeats without storing anything, the game replays every day from `LAUNCH_DATE` up to the requested day in memory, which takes a fraction of a second even years out. That means any date, past or present, always produces the same six places on every device, and nothing can fall out of sync.

**City pool.** GeoNames data (CC BY 4.0), rebuilt by `tools/build-data.mjs`: cities of at least 15,000 people, the 80 largest per country, plus every national capital regardless of size. Brazil, India, China and Russia are excluded. That comes to 7,079 places in 233 countries and territories.

**How names are shown:**
* Countries: `City, Country` (e.g. Arlon, Belgium)
* US states, Canadian provinces and Australian states are added: `Windsor, Ontario, Canada`
* Places with their own country code that belong to another country show both: `San Juan, Puerto Rico, United States`, `Papeete, French Polynesia, France`, `Kowloon, Hong Kong, China`. The flag is the territory's own flag.
* Disputed or partially recognized places (Taiwan, Kosovo, Palestine, Western Sahara) show only their own name, with no sovereign listed.
* City-states are not repeated: `Monaco`, not `Monaco, Monaco`.

**Share text.** Each round shows a color and its points. Colors use the proximity score before multipliers, so hints and later rounds never change them: 🎯 95+ · 🟩 80+ · 🟨 60+ · 🟧 40+ · 🟥 15+ · ⬛ under 15. 💡 marks a round where a hint was used.

```
XenoTap #23 · Sep 23, 2026
🎯 100  🟩 108  🟨 102
🟧 44💡  🟩 170  🟥 55
579 / 1000
https://you.github.io/xenotap/
```

**Hints.** One per round, and each one halves that round's multiplier: hemisphere (north or south, east or west), continent, or a distance check. For the distance check you tap one test spot and it tells you exactly how many km that spot is from the city.

**Answer marker.** The real location gets a red circle with big red arrows pointing at it, in the style of a YouTube clickbait thumbnail.

## Rebuilding the city data (optional)

Only needed if you change the population floor, per-country cap, or excluded countries in `tools/build-data.mjs`. Requires Node.js.

```
cd tools
npm install all-the-cities world-countries
node build-data.mjs
```

## Credits

Map engine: MapLibre GL JS (BSD-3). Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Places: GeoNames (CC BY 4.0). Country metadata: mledoze/countries (ODbL). Font: Outfit (Google Fonts).
