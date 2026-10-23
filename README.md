# PIDS Simulator — Singapore Bus Passenger Information Display

A working, browser-based simulation of an onboard **Passenger Information Display System (PIDS)**
for Singapore public buses, built on real LTA data and the **Figma** *PIDS* file.

The sign is a faithful port of the Figma screens: a **1280 × 600** safe zone, dark display
ground, Inter + Geist Mono, and the `sg-*` colour tokens. The request-stop control is the
Figma **Bus Stop Bell** component, artwork and all — body, screws and button in one SVG, with
the recorded bell chime.

![status vocabulary](https://img.shields.io/badge/status-BUS%20STOPPING%20%2F%20NEXT%20STOP%20%2F%20LAST%20STOP-5BBF2E)

---

## What it does

| Feature | Detail |
| --- | --- |
| **Real routes** | All 654 Singapore bus services, every direction, 5 821 stops |
| **Real interchanges** | 678 bus stops matched to MRT / LRT stations, with line codes (`NS / CC`, `PL`, …) |
| **Live sign** | 1280 × 600 canvas, ticking clock, four-stop window, chevron progress track |
| **Ride simulation** | The bus advances stop by stop; the sign shows `NEXT STOP` while it runs. At the terminus it **reverses** and runs the opposite direction |
| **Bus Stop Bell** | The Figma bell component with its chime. Rings for the next stop and latches — it cannot be un-rung. Only then does the sign switch to `BUS STOPPING` |
| **Long service numbers** | The green box grows with the number (`999A`, `962A`, …) and `BUS STOPPING` fills the space up to the clock |
| **Rail line pills** | Every interchange shows its line as its own pill — `NSL`, `EWL`, `NEL`, `CCL`, `DTL`, `TEL`, `LRT` — each in the colour of that line |
| **Terminus pinned** | The terminus always sits in the 4th column; the three changing stops fill the first three |
| **One item, one screen** | The display and its control panel are a single unit that centres and scales to the viewport — the page never scrolls |

### Status vocabulary

| Marker | Colour | Meaning |
| --- | --- | --- |
| `BUS STOPPING` | red `#E11D25` | the bus is halting here **because the bell was rung** |
| `NEXT STOP` | grey `#6E828F` | the stop the bus is heading to |
| — | dark `#101418` | a stop further along the route |
| `LAST STOP` | green `#5BBF2E` + cream ring | the terminus |
| train glyph + line pill | the line's own colour | the stop is an MRT / LRT interchange |

> The `ARRIVING` status was retired — a bus arrives at a stop, it does not announce the
> approach. `BUS STOPPING` is **not** a dwell state either: it only appears from the moment the
> bell is rung until the bus has served the requested stop, and the red callout then replaces
> the destination in the header. See `DESIGN.md` §5.

---

## Run it locally

The page loads `data/*.json` with `fetch()`, so it must be served over HTTP (not `file://`).

```bash
cd pids
python -m http.server 8765
# open http://127.0.0.1:8765/
```

Deep links: `?svc=50` selects a service, `&dir=1` a direction.

### Controls

There are two controls and a bell — everything else is automatic.

| Control | What it does |
| --- | --- |
| **Bus service** | any of the 654 service numbers (autocompleted) |
| **Direction** | the direction of travel; it flips itself when the bus reaches the terminus |
| **Bus Stop Bell** | rings the chime for the next stop and latches — each press replays the sound |

The ride always runs: the bus dwells at a stop, moves to the next, serves a bell request
longer, and turns round at the terminus. `assets/bus-stop-bell.mp3` is the bell sound.

---

## Deploy to GitHub Pages

The site is fully static — no build step.

```bash
cd pids
git init
git add .
git commit -m "PIDS simulator: real LTA data, Figma sign, request-stop interaction"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

`404.html` is not needed; `.nojekyll` is included so Pages serves the files as-is.
After the first push the site is live at `https://<you>.github.io/<repo>/`.

> Deploying this folder as its own repository keeps the parent portfolio site untouched.

The first commit here was made with a placeholder identity. Re-write it with your own before
pushing, so the commit is attributed to your GitHub account:

```bash
git commit --amend --reset-author --author="Your Name <you@users.noreply.github.com>"
```

---

## Data

Everything is bundled as static JSON, because LTA's XML endpoints send
`Access-Control-Allow-Origin: https://www.mytransport.sg` — a browser on GitHub Pages cannot
read them directly.

| File | Source | Notes |
| --- | --- | --- |
| `data/stops.json` | `lta.gov.sg/map/busService/bus_stops.xml` | code, road name, lat/long, interchange match |
| `data/services.json` | `cheeaun/sgbusdata` + LTA `bus_services.xml` / `bus_route_xml/*.xml` | stop sequence per direction |
| `data/stations.json` | LTA DataMall **static** “Train Station Codes and Chinese Names” | code → English name → line |
| `data/meta.json` | build manifest | counts, sources, field order |

**No API key is needed** for the bundled snapshot. Rebuild it with:

```bash
python tools/build_data.py        # needs: pip install xlrd
```

`build_data.py` re-downloads the LTA feeds, re-derives the interchanges and rewrites `data/`.
The interchange matcher works on **name matching plus a 700 m spatial sanity check** against the
station’s own “X Stn” bus stop, which keeps same-name places (e.g. two different “Beauty World”
stops) from being cross-linked.

The rail codes live in field 8 of every stop (`st[7]` in `app.js`), slash-joined for
interchanges — `EW/CC` is a stop served by the East West and Circle lines. `app.js` maps each
code to its line pill (`NS → NSL`, `CA → EWL`, `PL → LRT`, …).

---

## Refreshing the design assets

The icons are exported straight from the Figma file, so the simulator always matches the
design. Re-export them with a Figma personal access token (node ids are listed in the script):

```bash
FIGMA_TOKEN=figd_... node tools/extract_icons.mjs
```

The token is only sent in the `X-Figma-Token` header and is never written to disk. The bell
needs no export — it is drawn inline from the component geometry in `DESIGN.md` §6 — and the
chime is `assets/bus-stop-bell.mp3`.

---

## Files

```
pids/
├── index.html            page shell
├── style.css             design tokens + sign rendering
├── app.js                data loading, simulation, rendering
├── DESIGN.md             design guidelines (tokens, Bus Stop Bell, status vocabulary)
├── .nojekyll             GitHub Pages
├── assets/
│   ├── interior.jpg      page background — the bus interior photograph
│   ├── bus-stop-bell.mp3 the bell chime
│   └── icons/            the PIDS mark (favicon + panel icon) and the Figma sign icons
├── data/                 generated JSON (see above)
└── tools/
    ├── build_data.py     rebuild data/ from the public feeds
    ├── extract_icons.mjs re-export the sign icons from the Figma file
    ├── verify_layout.mjs headless layout regression test
    ├── layout_audit.mjs  print the box of every block at a given viewport
    └── screenshot.mjs    save a PNG of the page at a given viewport
```

`tools/verify_layout.mjs` drives headless Edge over the DevTools Protocol. It asserts that
**every one of the 861 service/direction combinations renders inside the 1280 × 600 safe zone**
with no element clipped, that the rendered geometry still matches the Figma screens (sign size,
service box minimum and long numbers, callout span, clock box, bar, marker centres, name and
pill baselines), that the bell is one intact component that paints and chimes on every press,
that only the service and direction controls exist and that the direction reverses at the
terminus, and that the unit is centred and fully visible at 1920 × 1080, 1600 × 900 and
1366 × 768 without scrolling:

```bash
node tools/verify_layout.mjs http://127.0.0.1:8765/
```

`tools/layout_audit.mjs` and `tools/screenshot.mjs` are the same CDP plumbing, used to inspect
the page when something looks off:

```bash
node tools/layout_audit.mjs http://127.0.0.1:8765/ 1920 1080
node tools/screenshot.mjs http://127.0.0.1:8765/ 1920 1080 out.png
```

---

## Design guidelines

`DESIGN.md` is the normative document: the Figma source map, colour tokens, the four type
roles, the 1280 × 600 sign geometry, the **Bus Stop Bell** component, the stop-status
vocabulary and the layout of the page. Keep the copies in step — `PIDS/DESIGN.md` (design
folder), `pids/DESIGN.md` (this repo) and the implementation in `app.js` / `style.css`.

### Design tokens

| Token | Hex | Use |
| --- | --- | --- |
| `sg-green-500` | `#5BBF2E` | service box, progress bar, next-stop pill |
| `sg-green-100` | `#E9F4C6` | last-stop pill, destination ring |
| `sg-green-700` | `#3A5C00` | text on the cream pill |
| `sg-display` | `#141B21` | timeline ground, chevron shadow |
| `sg-header` | `#1E272E` | header band |
| `sg-ink` | `#101418` | clock face, upcoming-stop marker |
| `sg-row-dark` | `#6E828F` | next-stop marker |
| `sg-muted` | `#D7E0E6` | clock bezel |
| `sg-stop` | `#E11D25` | bus-stopping marker, bell button |
| `sg-arrive` | `#FACC15` | bell body |

The rail line pills carry the colour of their own line (from the Figma *Train Station Icons*
sheet), not a single generic pill colour: `CCL #FA9E0D`, `NSL #D42E12`, `EWL #009645`,
`NEL #9900AA`, `DTL #005EC4`, `TEL #9D5B25`, `LRT #748477`.

Type roles: `sg-font-grot` (Stroudley → stand-in **Inter**) for the sign display voice,
`sg-font-text` (Ocean Sans → stand-in **Open Sans**) for companion UI, `sg-font-data`
(**Geist Mono**, tabular) for the clock, and **JetBrains Mono** for the bell's `STOP` label.

The same set is exported for Figma in `PIDS/sg-bus-design-tokens.json` (Tokens Studio format).
