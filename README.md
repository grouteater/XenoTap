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

**Version stamps.** Every file the page loads carries a `?v=` number (in `index.html`, the two `import` lines at the top of `js/app.js`, the one in `js/daily.js`, and the `places.json` fetch). iPhone Safari caches scripts aggressively, and without the stamp it can pair a new page with an old script. If you edit a file by hand, bump every `?v=` number (find and replace `?v=16` with `?v=17`, and so on).

To update later: on the repo page click **Add file > Upload files**, drag in the new contents of the folder, and commit. Files with the same name are replaced. Pages redeploys on its own within a minute or two. (For a one-line tweak you can also open the file on GitHub, click the pencil icon, edit, and commit.)

## Playing

* New puzzle at midnight Eastern time. Everyone gets the same six, whatever their timezone.
* Archive: the menu button (top right), or add `?date=2026-09-15` to the URL. Earliest day is `LAUNCH_DATE`.
* Progress saves in the browser per day, so refreshing or coming back later resumes the same game, and archive games never overwrite today's.

## Modes

Open the menu (☰, top right):

* **Daily puzzle:** the main game. Six places, same for everyone, new at midnight Eastern. Counts toward stats and streaks.
* **Archive:** any past daily puzzle.
* **Practice** (`?mode=practice`): the daily format with fresh random places, unlimited. Uses the exact same selection rules and never touches stats. When a game ends, a big "New game" button sits at the bottom of the screen (and in the results), so you can keep going even while looking at the globe. After finishing the daily, "Keep playing: Practice mode" jumps straight in.
* **Country Streak** (`?mode=streak`): a country's name and flag appear; tap inside it and confirm. One miss ends the run. Easy countries dominate early and harder ones ramp in as the streak grows (full ramp by 25). For territories (Puerto Rico, Greenland, French Guiana...) tapping the country that owns it also counts. Tiny countries (under 20,000 km²) get 30 km of slack, since they are only a few pixels wide at the zoom cap. Includes Brazil, India, China and Russia. Saves best streak, runs and average.
* **Hot & Cold** (`?mode=hotcold`): a mystery country. Every tap reports the distance from your tap to its nearest border and a temperature (🥶 Freezing over 6,000 km, 🧊 Cold, 🌥️ Cool, ☀️ Warm, 🌶️ Hot, 🔥 Burning under 250 km), plus warmer or colder than your last tap. A big arrow next to your latest tap points toward the country's nearest border (along the globe's shortest path, so from New York to Kazakhstan it points north over the pole), and the card spells out the direction ("head northeast"). Earlier taps stay on the globe as colored dots. Tap inside it to win. Countries under 1,000 km² sit this mode out. Saves games, wins, average taps and best.

All three practice modes draw faint outlines of every country on the globe as a learning aid. The daily puzzle never shows them.

When a Country Streak or Hot & Cold game ends, the bottom of the screen shows "Results" and "Play again", so you can study the map and restart without hunting for a button.

Each mode has its own stats (tap the stats button while in that mode). None of them affect the daily stats.

## Tuning

Everything adjustable is in `js/config.js`.

| Setting | Default | What it does |
|---|---|---|
| `SCORE_DECAY_KM` | 2800 | Base score = 100 × e^(−km / this). Raise to be more forgiving. |
| `PERFECT_RADIUS_KM` | 25 | Guesses this close get a full 100. |
| `MULTIPLIERS` | 1, 1.25, 1.5, 1.75, 2, 2.5 | How much each round counts toward the day total. Max total 1000. |
| `ROUND_NAMES` | Warm-up ... Boss | Shown on the round card. |
| `HINT_FACTOR` | 0.5 | A hint multiplies that round's score by this. |
| `MIN_CITY_POP` | 10,000 | No answer is ever smaller than this. |
| `ROUND_POOLS` | famous, easy, known ×2, any ×2 | Which city pool each round draws from (see below). |
| `DAY_COUNTRIES` | 2026-09-23: US, NZ, ZA, EE, UG, LA | Hand-pick the countries for a specific date, in round order; the game picks a city in each. Set before that day goes live. |
| `DAY_POOLS` | none | One-off pool overrides for specific dates, e.g. a gentle holiday. Set before that day goes live. |
| `CITY_REPEAT_DAYS` | famous 35, known 45, other 60 | A city cannot come back within this many days. |
| `COUNTRY_REPEAT_OVERRIDES` | US 2, CA 4 | These countries may return sooner than the usual 7 days (always with a different city). |
| `MAX_KM_PER_PX` | 270/402 | Zoom cap (see below). |
| `LAUNCH_DATE` | 2026-09-23 | Puzzle #1 and the start of the archive. |
| `AFRICA_FROM_ROUND` | 5 | African places only appear from round 5 on. |
| `AFRICA_LATE_WEIGHT` | 0.45 | Per-country weight for Africa in rounds 5-6 (see below). |

**Scoring.** Every round is scored 0 to 100 for proximity, and that is the number players see and share. The day total weights later rounds more: total = round 1 × 1 + round 2 × 1.25 + ... + round 6 × 2.5, so six perfect rounds make 1000.

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

**Imagery: Esri World Imagery.** No API key, no signup, no labels, no borders. Attribution shows along the bottom edge of the screen as Esri requires. If you ever want a fully open-licensed alternative, `config.js` has a commented-out Sentinel-2 cloudless option from EOX that you can swap in.

**Zoom cap.** The limit is a ground resolution of 0.67 km per screen pixel: the Florida peninsula (about 270 km across at Tampa's latitude) edge to edge on a 402 px wide iPhone 17 Pro. MapLibre's zoom scale changes with latitude, so the cap is recalculated from the latitude at the center of the view every time the globe moves. It is enforced as the map's hard `maxZoom`, so pinch, scroll wheel, keyboard and double tap cannot get past it. On a wider desktop screen you see more ground at max zoom, but the detail per pixel is the same.

**Daily picks: harder as the day goes on.** Rounds draw from three pools of cities (set in `tools/build-data.mjs`):

| Rounds | Pool | What is in it |
|---|---|---|
| 1 Warm-up | **Famous** (105 cities) | Popular US and Canadian cities, very well known European cities (London, Paris, Rome, Venice, Nice, Stockholm...), and household names elsewhere (Tokyo, Sydney, Mexico City, Dubai, Bangkok, Nassau). |
| 2 Easy | **Easy** (famous + about 70 more) | The famous list plus well-known cities in the easiest countries: mid-size US cities, Lyon, Kyoto, Málaga, Oslo. |
| 3-4 Medium, Tricky | **Known** (about 150 cities) | Places most people have heard of: Brussels, Istanbul, Athens, Buenos Aires, Lima, Reykjavík, Kathmandu, plus capitals of 300,000+ in well-known countries. |
| 5-6 Hard, Boss | **Any** | Every playable city, weighted toward harder countries (difficulty tier 5 = 1.0 down to tier 1 = 0.3) and away from famous (×0.15) and known (×0.4) cities. |

**Keeping the early rounds fresh.** A simulated year of rounds 1-2 uses about 170 different cities; the same city comes back after about 47 days on average and never within 35 days. The US appears in round 1 about one day in four (it has 45 famous cities and may return after 2 days, always with a different city), Canada after 4 days, and every other country after at least a week.

Africa only appears in rounds 5 and 6. Because Africa has far more small countries than any other region, equal per-country weighting would make about 60% of late rounds African, so African countries get 0.45 weight there: over a simulated year that is about 40% of round 5-6 picks. Every place also has a difficulty tier from 1 to 5 (from a typical American's point of view), used for weighting rounds 5-6 and the practice modes:

| Tier | Examples |
|---|---|
| 1 | Canada, Mexico, UK, Italy, Japan, Australia, Egypt |
| 2 | Austria, Colombia, Kenya, Iran, Indonesia, Greenland |
| 3 | Romania, Kazakhstan, Ghana, Honduras, Sri Lanka, Uzbekistan |
| 4 | Armenia, Georgia, Belarus, Botswana, Moldova, DR Congo |
| 5 | Kyrgyzstan, Suriname, Bhutan, Laos, Brunei, Libya, Senegal, Chad |

In rounds 1-4 a city is picked directly from the pool; a country's chance grows with its number of listed cities, but more slowly (count^0.7). Nothing anywhere is under 10,000 people. Each day has no two countries that share a land border and no two places closer than 1,000 km (`MIN_SPACING_KM`); rounds 1-4 allow at most two places per continent. A country cannot return within 7 days and is less likely for 30 days after that. A city cannot return within 35 days (famous), 45 days (known) or 60 days (everything else).

To move a city between pools, edit the `FAMOUS` or `KNOWN` list in `tools/build-data.mjs` and rerun it.

**Islands are rare and well known.** Two rules in `tools/build-data.mjs`:
1. Island nations are only playable if they are on an allowlist of places most Americans know: Japan, UK, Ireland, Iceland, New Zealand, the Philippines and Indonesia at full weight; Cuba, Jamaica, Puerto Rico, the Bahamas, the Dominican Republic, Haiti, Madagascar, Sri Lanka, Taiwan, Cyprus, Malta, Singapore, the Isle of Man and Greenland at 0.35 weight. Every other island nation or territory (Tonga, Vanuatu, Comoros, Mauritius, Guadeloupe, Guernsey and so on) is out.
2. Inside any country, cities on a small island (under 25,000 km²) more than 150 km from that country's big landmasses are dropped: the Canaries, Madeira, Crete, Mallorca, Sardinia, Okinawa and most of the central Philippines. Near-shore islands stay (Sicily, Bali, Zanzibar, Brooklyn, Istanbul), and Honolulu is kept by name.

**Deterministic, with no history file.** The date string (Eastern time) is hashed into a seed for a small seeded random generator (mulberry32). To avoid repeats without storing anything, the game replays every day from `LAUNCH_DATE` up to the requested day in memory, which takes a fraction of a second even years out. That means any date, past or present, always produces the same six places on every device, and nothing can fall out of sync.

**City pool.** GeoNames data (CC BY 4.0), rebuilt by `tools/build-data.mjs`: cities of at least 15,000 people, the 80 largest per country, plus every national capital regardless of size. Brazil, India, China, Russia and Mongolia are excluded (the first four also play in Country Streak and Hot & Cold; Mongolia is out everywhere). After the island rules, that comes to 6,920 places in 173 countries and territories.

**How names are shown:**
* Countries: `City, Country` (e.g. Arlon, Belgium)
* US states, Canadian provinces and Australian states are added: `Windsor, Ontario, Canada`
* Places with their own country code that belong to another country show both: `San Juan, Puerto Rico, United States`, `Papeete, French Polynesia, France`, `Kowloon, Hong Kong, China`. The flag is the territory's own flag.
* Disputed or partially recognized places (Taiwan, Kosovo, Palestine, Western Sahara) show only their own name, with no sovereign listed.
* City-states are not repeated: `Monaco`, not `Monaco, Monaco`.

**Share text.** Each round shows an emoji and its 0 to 100 score, so it is easy to compare round by round with friends: 🌟 100 · 🎯 95+ · 🔥 90+ · 🟩 80+ · 🟨 60+ · 🟧 40+ · 🟥 15+ · ⬛ under 15. 💡 marks a round where a hint was used. The last line is the weighted day total.

```
XenoTap #23 · Sep 23, 2026
🎯 100  🟩 86  🟨 68
🟧 44💡  🟩 85  🟥 22
612 / 1000
https://you.github.io/xenotap/
```

**Hints.** One per round, and each one halves that round's score (so 50 is the most a hinted round can earn): hemisphere (north or south, east or west), continent, or a distance check. For the distance check you tap one test spot and it tells you exactly how many km that spot is from the city.

**Country outlines.** When a round is revealed, the answer country's border is drawn on the globe, and the result card says "Right country" if your guess landed inside it. The final "View globe" screen outlines all six countries. Outlines come from mledoze/countries, simplified to about 2 km detail (finer than the zoom cap can show), stored in `data/borders.json` and fetched in the background after the globe loads.

**Where your guess landed.** The reveal says "Right country" or names the country you actually tapped ("You guessed 🇩🇿 Algeria", or open water). This uses outlines for every country on Earth, including ones that are never answers.

**Results screen.** Every round is labeled ("Round 3 · Medium") so you can line your results up with a friend's share text. Tapping a round opens a country facts card: capital, languages, currency, size compared to a US state ("a bit bigger than Maryland"), land borders, and what people are called. Facts come from mledoze/countries. Current leaders are deliberately left out because they go stale.

**Stats and streaks.** Games played, average, best, current streak and best streak, plus a score histogram with today's bar highlighted. Streaks count days finished on the day itself (archive games count toward the other stats but not streaks). Stats are saved under a fixed key (`xenotap:stats`) that never changes between releases, so updating the site never wipes them. On iPhone, Safari and the Home Screen app keep separate storage, so pick one.

**Add to Home Screen.** `manifest.webmanifest`, the icons in `icons/`, and the Apple meta tags make XenoTap open full screen with its own icon when added from Safari's Share menu.

**Final results view.** After the last round, "View globe" shows each answer as a red pin labeled "Round 3: Tartu, Estonia", and the line from each guess fades from white (your guess) to red (the answer). Labels stay the same size at any zoom; when two would overlap, the later round shrinks to a short "R3" tag, and zooming in brings the full label back.

**Look.** Plain and calm: soft lavender background, near-white cards with a hairline border and soft shadow, dark primary buttons, and round bars colored by difficulty (green for the warm-up through dark red for the boss). Red is reserved for map markers. No animated colors.

**Answer marker.** During the rounds, the real location gets a red circle with big red arrows pointing at it, in the style of a YouTube clickbait thumbnail.

## Rebuilding the city data (optional)

Only needed if you change the population floor, per-country cap, or excluded countries in `tools/build-data.mjs`. Requires Node.js.

```
cd tools
npm install all-the-cities world-countries mapshaper
node build-data.mjs
node build-borders.mjs
```

## Credits

Map engine: MapLibre GL JS (BSD-3). Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Places: GeoNames (CC BY 4.0). Country metadata: mledoze/countries (ODbL). Font: Outfit (Google Fonts).
