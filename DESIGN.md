# PIDS — design guidelines

**Source of truth:** the Figma file *PIDS* (file key `aLttgbqVyAlB0RlPBTOZs4`).
Everything below was read out of that file with the Figma REST API — node ids are
given so any value can be re-checked.

| Frame | Node id | What it is |
|---|---|---|
| `Screen 1` | `14:497` | normal running state |
| `Screen 2` | `13:358` | bus stopping at the current stop — **only after the bell is rung** |
| `Screen 3` | `14:643` | next stop is a rail interchange |
| `Bus Stop Bell` | `19:53` | the request-stop button (companion UI) |
| `PIDS Design System` | `1:544` | colour / type tokens |
| `Train Station Icons` | `16:2` | rail line pills |

The simulator (`pids/`) implements this spec 1:1. `pids/tools/verify_layout.mjs`
asserts every number in §3–§5 against the live page, so drift shows up as a
failed check rather than a silent regression.

---

## 1. Brand context

LTA's *Passenger Information Display System* for Singapore buses. The display is a
wide, high-contrast LED sign in the saloon: a dark header with the service and
destination, and a "progress timeline" of the next stops underneath. Everything
is designed to be legible at a glance from a standing passenger's seat, so the
type is large and the colour carries the state.

## 2. Colour tokens

From `PIDS Design System` (`1:544`) and the `sg-*` set in `PIDSdesignsystem.html`.

| Token | Hex | Use |
|---|---|---|
| `sg-green-100` | `#E9F4C6` | "LAST STOP" pill, destination ring |
| `sg-green-500` | `#5BBF2E` | service box, progress bar, next pill |
| `sg-green-700` | `#3A5C00` | text on cream |
| `sg-ink` | `#101418` | clock body, "upcoming" marker |
| `sg-display` | `#141B21` | timeline background, chevron shadow |
| `sg-header` | `#1E272E` | header band |
| `sg-row-dark` | `#6E828F` | "next stop" marker |
| `sg-muted` | `#D7E0E6` | clock hairline |
| `sg-white` | `#FFFFFF` | all type, marker rings |
| `sg-amber` | `#FF9E1B` | EDS amber (not used for the rail pills) |
| `sg-stop` | `#E11D25` | bus-stopping marker + pill, bell button |
| `sg-arrive` | `#FACC15` | bell body |

The full `sg-*` set (22 colours, also in `sg-bus-design-tokens.json`) is asserted
token-by-token by `pids/tools/verify_layout.mjs`, so a drift in `--sg-*` fails
the build check.

### 2.1 Rail line pills

The rail pills come from the Figma *Train Station Icons* sheet (`16:2`, mirrored in
Pencil as `i4BRoL`). Every code carries the **line suffix** and **its own colour** —
there is no generic "rail pill" colour:

| Pill | Hex | Pill | Hex |
|---|---|---|---|
| `CCL` | `#FA9E0D` | `TEL` | `#9D5B25` |
| `NSL` | `#D42E12` | `CRL` | `#97C616` |
| `EWL` | `#009645` | `JRL` | `#0099AA` |
| `NEL` | `#9900AA` | `LRT` | `#748477` |
| `DTL` | `#005EC4` | | |

A stop served by more than one line shows **one pill per line**, side by side in a
single row (100 px wide, 10 px gap), above the status pill.

## 3. Type roles

| Role | Figma font | Site token | Used for |
|---|---|---|---|
| Sign | Inter | `--font-sign` | service number, destination, stop names, pills |
| Sign data | Geist Mono | `--font-mono` | clock |
| Bell | JetBrains Mono | `--font-bell` | the `STOP` label on the bell button |
| Companion | Ocean Sans | `--font-companion` | the simulator's own panel chrome |

Type scale on the sign: service number and destination **78 / 700**; stop names
**40 / 700**; pill labels **30 / 700**; clock **50 / 400**; callout **80 / 700**.
Letter-spacing is `0` everywhere except the bell's `STOP` (`2`).

## 4. Sign frame — 1280 × 600

```
+----------------------------------------------------------  y=0
| ▓▓ SERVICE ▓▓| DESTINATION (or BUS STOPPING)   |  CLOCK   |  header band 150
|                (or BUS STOPPING)              |          |  #1E272E
+----------------------------------------------------------  y=150
|                  timeline area 450  #141B21                  |
|     ●───────➤───────●───────➤───────●───────➤───────◆      |
|    BLK 121      KADALOOR STN     SHUNFU EST     BISHAN INT    |
|   [NEXT STOP]     [CCL]                          [LAST STOP] |
+----------------------------------------------------------  y=600
```

### 4.1 Header (`sign__band`, 1280 × 150, `#1E272E`)

The band is a single flex row: service box, 30 px gap, destination/callout, 30 px gap,
clock (29 px from the right edge). Nothing in the band is absolutely positioned, so the
**green service box grows with the number** and the callout takes whatever is left.

| Element | Geometry | Type |
|---|---|---|
| Service box | `190 × 150` minimum at `x=0`, fill `#5BBF2E`, `30 px` side padding, number centred. Grows with the number: `999A` → `273 × 150` | number 78/700 white |
| Destination | fills the space after the box (starts at `x=220` for a 190 px box) | 78/700 white, steps down for long names |
| Callout | fills the space between the service box and the clock (30 px clear each side) — `733 × 100` for a 190 px box, `650 × 100` for `999A` (Screen 4, `C9UR11`); radius 50, fill `#E11D25` | 80/700 white, steps down only if needed |
| Clock | `268 × 101` at `x=983, y=24`, radius 32, fill `#101418`, 3 px `#D7E0E6` | time 50/400 Geist Mono |

The clock holds a 29 × 29 clock glyph, a 25 px gap, then the time.

**Long service numbers.** The Pencil screens settle the rule: `Screen 1`/`Screen 2`
(`jcSbA`, `QYqq1`) have a 190 px box, `Screen 3` (`Q5FRP`) widens it for `999A`, and
`Screen 4` (`C9UR11`) pairs that box with a `650` px `BUS STOPPING` callout. So the box
is sized by its content (`number + 2 × 30`, min 190) and `BUS STOPPING` fills the gap
between the box and the clock rather than using a fixed width. In the site
`fitNumber()` steps the number down past 300 px of type, and `fitCallout()` shrinks the
callout label only when the available width demands it.

### 4.2 Timeline (`sign__area`, 1280 × 450, `#141B21`)

Four columns of **320 px** fill the safe area, so marker centres sit at
`x = 160, 480, 800, 1120` and the connecting bar spans `160 → 1120`.

| Element | Geometry |
|---|---|
| Progress bar | `960 × 22` at `y=242`, fill `#5BBF2E` |
| Chevrons | `29 × 62` glyph, dark copy then white copy offset 8 px, tip at the column midpoint (`320`, `640`, `960`), `y=222`. The gap that leads to the **destination** carries a **double** chevron (tips at `931` and `954`) |
| Stop markers | 101 px circle with a 5 px ring → **106 px outer / 96 px colour disc**, glyph centred, `y=253` (centre) |
| Stop names | 40/700 white, centred on the column, max 2 lines, `y=325` |
| Pills | height 50, radius 24, 30/700, centred on the column, `y=476` |

**Columns.** The three changing stops fill columns 1–3 and the **terminus is always
pinned to column 4**, so the bar always reaches the destination marker and the last
gap always carries the double chevron. The bar is only as long as the columns in use
(`320 × (last column − first column)`).

**Chevrons** sit at the midpoint of two *visible* columns — `cx = (col₁ · 320 + 160 +
col₂ · 320 + 160) / 2` — and are drawn at `cx − 18`; the double chevron of the final gap
is drawn at `cx − 29` and `cx − 5.84`.

**Pill stacking.** A column can carry two rows: the rail line-code pill(s) sit
**above** the status pill with a 10 px gap, and the pair is centred on the status row.
One pill → `y=476`; a line row + status pill → `446` (line codes) and `506` (status),
as in `Screen 3`.

### 4.3 Marker glyphs

| Marker | Source node | Glyph |
|---|---|---|
| Bus stop | `14:525` | bus front, 27 × 33 |
| Rail station | `14:529` | train front, 27 × 33 |
| Destination | `14:537` | flag, 25 × 30 |
| Chevron | `14:511` / `14:512` | chevron, 29 × 62 |
| Clock | `14:502` | clock, 29 × 29 |

All glyphs are exported from Figma as SVG and shipped in `assets/icons/`.

## 5. Stop status vocabulary

| Status | Marker fill | Ring | Glyph | Pill |
|---|---|---|---|---|
| Bus stopping | `#E11D25` | white 5 px | bus stop | `BUS STOPPING` — red |
| Next stop | `#6E828F` | white 5 px | bus stop / train | `NEXT STOP` — green |
| Upcoming | `#101418` | white 5 px | bus stop / train | — |
| Last stop | `#5BBF2E` | `#E9F4C6` 5 px | flag | `LAST STOP` — cream, `#3A5C00` text |
| Rail interchange | — | — | — | one pill per line, in the line's colour |

`ARRIVING` has been **retired** — it is no longer a stop status. A moving bus shows
`NEXT STOP`.

**`BUS STOPPING` is a bell state, not a dwell state.** The sign shows it only from the
moment the passenger rings the bell until the bus has served that stop; the red callout
then replaces the destination in the header (`Screen 2`). The red marker follows the
**requested stop** — it is in the first column once the bus has arrived there, and in
whichever column the stop sits in while the bus is still approaching it. An ordinary
dwell shows `NEXT STOP` and nothing else. The requested stop is held 3× longer than a
normal stop, and the request clears once the bus has departed it.

The Figma file has **no "stop requested" sign state**, so the sign never shows
one: a bell request is visible on the bell button itself (latched), and nothing else
changes on the display. The rail pill carries **one** pill per line, exactly as the
file does.

## 6. Bus Stop Bell component (`19:53`)

The physical request-stop button, used verbatim in the control panel.

| Part | Geometry | Style |
|---|---|---|
| Bell body | 144 × 377, full bleed | `#FACC15` |
| STOP button | 126 × 126 at `9, 126` | `#E11D25`, `STOP` in JetBrains Mono 200 / 40, `ls 2`, white |
| Screws | 23 × 23 discs at `x=60`, `y=8` and `y=347` | `#D9D9D9` disc, 18 × 4 `#747474` slot at ±45° |

The two discs sit on the body's centre line (`x = 71.5`) and each slot is a chord
through the middle of its disc: the top slot runs `\` from the disc's top-left, the
bottom slot runs `/`. Both bars pivot on their **own top-left corner**
(`transform-origin: top left`), which is how Pencil exports the component — rotating a
bar about its centre instead pushes it out of its disc.

The bell carries **no mounting plate** — the yellow body is the whole button — and
**no caption**: the control is the artwork alone, with the ring affordance carried by
`aria-label` / `title`.

The site draws the whole component as **one inline SVG** (`viewBox="0 572 144 377"`,
the Figma coordinates), so the body, both screws and the STOP button cannot drift
apart. The button box is the SVG box: there is nothing outside it. Slot geometry is
the Pencil node `KrwUd`.

Behaviour: **one-way.** Every press plays `assets/bus-stop-bell.mp3` (restarted from
the top, so repeated presses repeat the ring); the first press of a ride also rings
the bell and it latches — there is no cancel. The request clears when the bus has
served that stop, when the route changes, or when the service reverses at the
terminus. Latched state: the STOP button darkens to `#A8131A` and `aria-pressed`
becomes `"true"`, but the bell stays operable so it keeps ringing.

## 7. Known divergences from the Figma file

| # | Divergence | Why |
|---|---|---|
| 1 | The timeline is centred on the safe area (marker centres `160…1120`) rather than the Figma's hand-placed `172…1132`. | The Figma's timeline is 12 px off-centre; a symmetric layout keeps both margins at 112 px and nothing clips. |
| 2 | The destination and long stop names step down in size. | Keeps long names inside the safe area without clipping. |
| 3 | The bell has no caption and scales with the panel instead of sitting at 68 %. | The caption is removed on purpose; the artwork is one SVG that fits the panel exactly. |
| 4 | The rail pills use the *Train Station Icons* colours instead of the single amber pill of the screens. | Every line carries its own colour and suffix (`CCL`, `NSL`, …), as the icon sheet specifies. |
| 5 | The terminus is pinned to column 4 and the three changing stops fill columns 1–3. | Keeps the double chevron and the bar aligned with the destination for the whole ride. |
| 6 | The service box is content-sized (min 190) and the callout fills the remaining header width. | The Pencil screens (`C9UR11` / `Q5FRP`) do exactly this for long numbers; a fixed 190 px would clip `999A`. |

Everything else is 1:1 with the Figma file — including the **absence** of a
"stop requested" sign state and one pill per rail line.

## 8. Pencil mirror (`PIDS.pen`)

`PIDS.pen` is the Pencil copy of this design. It carries the bus-stop-bell
component, its states and the four sign screens rebuilt 1:1 from the Figma
geometry above.

| Frame | Node id | Notes |
|---|---|---|
| `Bus Stop Bell` | `B7hK6` | reusable component — yellow body 144 × 377, STOP button, two screws, no plate |
| `Bus Stop Bell - States` | `PbLBr` | idle and latched (`#A8131A` button); the site drops the caption |
| `Train Station Icons` | `i4BRoL` | the nine line pills with their colours, 100 px wide, 10 px gap |
| `Screen 1` | `jcSbA` | normal running state — 190 px service box, bar `y=242`, markers `y=202.5`, single pills at `y=476` |
| `Screen 2` | `QYqq1` | the red `BUS STOPPING` callout `733` px wide, shown only after the bell is rung |
| `Screen 3` | `Q5FRP` | rail interchange — `999A` service box, line-code pill **above** the status pill |
| `Screen 4` | `C9UR11` | long service number — `999A` box (~273 px) with a `650` px `BUS STOPPING` callout |

All frames are `1280 × 600`, `layout: "none"`, clipped, and use the same
`sg-*` variables as the site. The Figma glyphs are referenced as image fills
from `assets/icons/*.svg` (relative paths, so the `.pen` file must stay next to
that folder).

## 9. The companion page

The simulator is **one item**: the 1280 × 600 display plus a 268 px control panel,
24 px apart, floating on the bus-interior photograph (`assets/interior.jpg`, with a
dark radial scrim). The page centres the pair and `fitUnit()` scales the whole unit
(as a single `transform: scale()`) to the viewport, so at any size the display, the
panel and the bell shrink together and stay centred — nothing sticks to an edge and
the page never scrolls.

The panel holds, top to bottom: the PIDS mark, **two controls only** — the bus
service and the direction — the bell, and the dataset status. There is no play,
restart, jump-to-end or speed control; the simulation always runs.

When the bus reaches the terminus of its direction it **reverses**: the app picks the
direction of the same service that starts at the stop just reached (falling back to
the direction that ends at the route's origin, then to a name match that ignores
`Opp`/`Aft`/`Bef`, then to the other direction) and continues from that stop. The
direction picker updates to match. A single-direction service simply runs again.

The bell fills the panel between the controls and the status line and rings the chime on
every press, so it is always reachable at any viewport size.

## 10. Editing notes

- Tokens live in `style.css` under `:root` (`--sg-*`, `--font-*`).
- The sign is laid out in absolute pixels inside a fixed 1280 × 600 box; `fitUnit()` in
  `app.js` scales the whole `.unit` (display + panel) with a single `transform: scale()`
  and the flex-centred `app` keeps it centred at every viewport.
- `app.js` owns all state; the DOM is rebuilt on every frame, so keep the
  markup generation in one place (`render()`).
- Run `node pids/tools/verify_layout.mjs` after any change — it checks the
  geometry above, the bell and its sound, the controls, the automatic reversal, and
  sweeps all 861 service/direction combinations for overflow.
