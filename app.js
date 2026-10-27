/* ============================================================
   PIDS Simulator — app logic
   Data: LTA bus stops / services + DataMall train station codes
   Sign: Figma "PIDS" (aLttgbqVyAlB0RlPBTOXs4) Screens 1-4, 1280x600 safe zone
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);
const ICONS = 'assets/icons/';

/* ─────────── design tokens (mirrors the Figma file) ─────────── */
const C = {
  green500: '#5BBF2E',
  amber: '#FF9E1B',
  stop: '#E11D25',
  green100: '#E9F4C6',
  green700: '#3A5C00',
};

const DATA_URL = {
  stops: 'data/stops.json',
  services: 'data/services.json',
  stations: 'data/stations.json',
  meta: 'data/meta.json',
};

let STOPS = {}, SERVICES = {}, STATIONS = {}, META = {};

/* ─────────── simulation state ─────────── */
const S = {
  svc: '50',
  dir: 0,
  route: [],          // array of stop codes
  pos: 0,            // index of the stop the bus is at (arrived)
  phase: 'move',     // 'move' | 'dwell'
  t: 0,              // seconds elapsed in the current phase
  legTime: 26,       // seconds between stops (simulated)
  dwellTime: 6,      // seconds stopped at a stop
  speed: 4,
  requested: null,   // index of a stop the passenger asked the bus to stop at
};

const TAGS = {
  stopping: 'BUS STOPPING',
  next: 'NEXT STOP',
  final: 'LAST STOP',
};

/* Rail line codes shown on the sign — Figma "Train Station Icons" sheet
   (Pencil i4BRoL): every code carries the line suffix and its own colour. */
const LINE_PILL = {
  NS: { label: 'NSL', color: '#D42E12' },
  EW: { label: 'EWL', color: '#009645' },
  CA: { label: 'EWL', color: '#009645' },
  NE: { label: 'NEL', color: '#9900AA' },
  CC: { label: 'CCL', color: '#FA9E0D' },
  DT: { label: 'DTL', color: '#005EC4' },
  TE: { label: 'TEL', color: '#9D5B25' },
  PL: { label: 'LRT', color: '#748477' },
  SL: { label: 'LRT', color: '#748477' },
  BP: { label: 'LRT', color: '#748477' },
};

/* ─────────── boot ─────────── */
init();

async function init() {
  try {
    const [stops, services, stations, meta] = await Promise.all([
      fetchJSON(DATA_URL.stops), fetchJSON(DATA_URL.services),
      fetchJSON(DATA_URL.stations), fetchJSON(DATA_URL.meta),
    ]);
    STOPS = stops; SERVICES = services; STATIONS = stations; META = meta;
  } catch (err) {
    $('dataPill').textContent = 'Dataset failed to load';
    $('dataPill').classList.add('is-off');
    $('svcInput').classList.add('is-invalid');
    $('svcInput').placeholder = 'Serve this folder over HTTP';
    return;
  }

  $('dataPill').textContent = `${META.services} services · ${META.stops} stops`;

  buildServiceList();
  $('svcInput').addEventListener('input', onServiceInput);
  $('svcInput').addEventListener('change', onServiceInput);
  $('dirSelect').addEventListener('change', () => {
    S.dir = +$('dirSelect').value;
    loadRoute();
  });
  $('btnRequest').addEventListener('click', requestStop);

  const params = new URLSearchParams(location.search);
  const wantSvc = params.get('svc');
  if (wantSvc && SERVICES[wantSvc]) S.svc = wantSvc;
  $('svcInput').value = S.svc;

  window.addEventListener('resize', fitUnit);
  fitUnit();

  onServiceInput();

  const dparam = params.get('dir');
  if (dparam !== null && SERVICES[S.svc] && SERVICES[S.svc].r[+dparam]) {
    S.dir = +dparam;
    $('dirSelect').value = dparam;
    loadRoute();
  }

  setInterval(tick, 3000);
  requestAnimationFrame(loop);

  /* the sign is measured, so re-fit once the webfonts are in */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      fitNumber();
      if (!$('signCallout').hidden) fitCallout();
    });
  }
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/* ─────────── service / route selection ─────────── */

function buildServiceList() {
  const nums = Object.keys(SERVICES).sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
    return na - nb;
  });
  const dl = $('svcList');
  dl.innerHTML = nums.map((n) => `<option value="${n}"></option>`).join('');
  ALL_SERVICES = nums;
}

let ALL_SERVICES = [];

/* Only two controls exist: the service and the direction. */
function onServiceInput() {
  const raw = $('svcInput').value.trim();
  const svc = raw.split('/')[0].trim();
  if (!SERVICES[svc]) {
    const dl = $('svcList');
    dl.innerHTML = ALL_SERVICES
      .filter((n) => n.startsWith(raw.replace(/\D/g, '') || raw))
      .map((n) => `<option value="${n}"></option>`).join('');
    $('svcInput').classList.toggle('is-invalid', !!raw);
    if (raw) $('svcInput').setAttribute('aria-invalid', 'true');
    else $('svcInput').removeAttribute('aria-invalid');
    return;
  }
  $('svcInput').classList.remove('is-invalid');
  $('svcInput').removeAttribute('aria-invalid');
  S.svc = svc;
  const v = SERVICES[svc];
  const dirs = v.r.map((r, i) => directionLabel(v.n, r, i));
  $('dirSelect').innerHTML = dirs
    .map((d, i) => `<option value="${i}">${d}</option>`).join('');
  // default to the direction running toward the first term of the service name
  const terms = v.n.split('<>').map((t) => t.trim()).filter(Boolean);
  let def = 0;
  if (terms.length >= 2) {
    const t0 = terms[0].toLowerCase();
    def = v.r.findIndex((r) => stopName(r[r.length - 1]).toLowerCase().startsWith(t0.slice(0, 6)));
    if (def < 0) def = 0;
  }
  S.dir = def;
  $('dirSelect').value = String(def);
  loadRoute();
}

function directionLabel(svcName, route, i) {
  const terms = svcName.split('<>').map((t) => t.trim()).filter(Boolean);
  const first = stopName(route[0]);
  const last = stopName(route[route.length - 1]);
  if (terms.length >= 2) {
    // which end of the service name does this route start / end at?
    const match = (txt) => {
      if (!txt) return -1;
      const t = txt.toLowerCase();
      return terms.findIndex((term) => {
        const p = term.toLowerCase();
        return p.length >= 4 && t.startsWith(p.slice(0, Math.min(6, p.length)));
      });
    };
    const fi = match(first);
    const li = match(last);
    if (fi >= 0 && li >= 0 && fi !== li) return `${terms[fi]} → ${terms[li]}`;
    if (fi >= 0) return `${terms[fi]} → ${last}`;
    if (li >= 0) return `${first} → ${terms[li]}`;
    return `${terms[0]} → ${terms[1]}`;
  }
  return `Route ${i + 1} · ${first} → ${last}`;
}

function stopName(code) {
  const s = STOPS[code];
  return s ? s[2] : code;
}

function loadRoute() {
  const v = SERVICES[S.svc];
  if (!v) return;
  S.route = (v.r[S.dir] || v.r[0] || []).slice();
  S.pos = 0;
  S.phase = 'dwell';
  S.t = 0;
  S.requested = null;

  $('signNumber').textContent = S.svc;
  fitNumber();
  updateRequestButton();
  render();
}

/* ─────────── simulation loop ─────────── */

function loop() {
  const dt = 1 / 60;
  if (S.route.length) {
    S.t += dt * S.speed;
    if (S.phase === 'dwell') {
      const atEnd = S.pos >= S.route.length - 1;
      /* A stop that was rung for is held longer, so the BUS STOPPING
         announcement stays readable. */
      const held = S.requested === S.pos && !atEnd;
      if (S.t >= (held ? S.dwellTime * 3 : S.dwellTime)) {
        S.t = 0;
        // the stop the bell was rung for has now been served — the bell resets
        if (S.requested === S.pos) {
          S.requested = null;
          updateRequestButton();
        }
        if (atEnd) { S.phase = 'dwell'; S.t = 0; setTimeout(()=>reverseDirection(),3000); }
        else S.phase = 'move';
      }
    } else if (S.t >= S.legTime) {
      S.t = 0;
      S.pos = Math.min(S.pos + 1, S.route.length - 1);
      S.phase = 'dwell';
    }
  }
  render();
  requestAnimationFrame(loop);
}

function tick() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  $('signTime').textContent = `${hh}:${mm}`;
}

/* At the terminus the bus runs the service back the other way: pick the
   direction that starts where this one ended. */
function reverseDirection() {
  const v = SERVICES[S.svc];
  if (!v || !v.r.length || !S.route.length) return;
  const lastCode = S.route[S.route.length - 1];
  const firstCode = S.route[0];
  const norm = (code) => stopName(code).toLowerCase().replace(/^(opp|aft|bef)\s+/, '').trim();
  const cand = [];
  for (let i = 0; i < v.r.length; i++) if (i !== S.dir || v.r.length === 1) cand.push(i);

  let next = cand.find((i) => v.r[i][0] === lastCode);
  if (next == null) next = cand.find((i) => v.r[i][v.r[i].length - 1] === firstCode);
  if (next == null) next = cand.find((i) => norm(v.r[i][0]) === norm(lastCode));
  if (next == null) next = cand[0];
  if (next == null) return;

  S.dir = next;
  S.route = v.r[next].slice();
  S.pos = 0;
  S.phase = 'dwell';
  S.t = 0;
  S.requested = null;
  syncDirSelect();
  updateRequestButton();
}

function syncDirSelect() {
  const sel = $('dirSelect');
  if (!sel.options.length) return;
  sel.value = String(S.dir);
}

/* The Bus Stop Bell rings on every press; only the first press of a ride sets
   the request — it latches and the PIDS stays in BUS STOPPING. */
function requestStop() {
  ringBell();
  if (!S.route.length || S.requested != null) return;
  S.requested = Math.min(S.pos + 1, S.route.length - 1);
  updateRequestButton();
  render();
}

function ringBell() {
  const a = $('bellAudio');
  if (!a) return;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* audio unavailable */ }
}

function updateRequestButton() {
  const b = $('btnRequest');
  const rung = S.requested != null;
  b.classList.toggle('is-rung', rung);
  b.setAttribute('aria-pressed', rung ? 'true' : 'false');
  b.title = rung ? 'Bell rung — press again to ring' : 'Ring the bus stop bell';
}

/* ─────────── sign rendering ─────────── */

/* The bus only announces BUS STOPPING when the bell was rung — an ordinary
   dwell shows nothing but NEXT STOP. The announcement lasts from the press
   until the bus has served the requested stop. */
function isBellStopping() {
  return S.requested != null && S.requested < S.route.length - 1;
}

/* Upcoming stops only - show next stops up to 4, final appears when reached */
function visibleStops() {
  const last = S.route.length - 1;
  const out = [];
  const head = (isBellStopping() && S.requested === S.pos) ? S.pos : S.pos + 1;
  for (let i = head; i <= last && out.length < 4; i++) {
    out.push({ idx: i, code: S.route[i], col: out.length });
  }
  return out;
}

function statusFor(entry, vi) {
  if (!entry) return 'upcoming';
  const last = S.route && S.route.length ? S.route.length - 1 : -1;
  if (entry.idx === last) return 'final';
  /* The red marker belongs to the stop the bell was rung for — while the bus
     is still approaching it, that stop is not the first column. */
  if (isBellStopping() && entry.idx === S.requested) return 'stopping';
  return vi === 0 ? 'next' : 'upcoming';
}

function iconFor(entry, status) {
  const s = STOPS[entry.code];
  if (status === 'final') return 'flag--white';
  if (s && s[4]) return 'train--white';
  return 'bus-stop--white';
}

/* Marker glyphs keep their Figma size inside the 96px circle: bus and train
   27x33, flag 25x30. */
const ICON_SIZE = {
  'bus-stop--white': '27px',
  'train--white': '27px',
  'flag--white': '25px',
};

function iconTag(entry, status) {
  const name = iconFor(entry, status);
  const w = ICON_SIZE[name];
  return `<img src="${ICONS}${name}.svg" alt=""${w ? ` style="width:${w}"` : ''}>`;
}

/* The Figma sign sets 40px for stop names; step down only for the long ones. */
function nameSize(name) {
  if (name.length <= 20) return 40;
  if (name.length <= 28) return 34;
  return 30;
}

/* 78px destination in the header, scaled down when the terminus name is long. */
function destSize(name) {
  if (name.length <= 15) return 78;
  if (name.length <= 19) return 62;
  if (name.length <= 24) return 50;
  return 42;
}

function render() {
  if (!S.route.length) return;
  const vis = visibleStops();
  const n = vis.length;

  /* header --------------------------------------------------------------- */
  const dest = stopName(S.route[S.route.length - 1]).toUpperCase();
  const callout = isBellStopping() ? 'BUS STOPPING' : '';

  $('signDest').hidden = !!callout;
  $('signCallout').hidden = !callout;
  if (callout) {
    $('signCalloutText').textContent = callout;
    fitCallout();
  } else {
    $('signDest').textContent = dest;
    $('signDest').style.fontSize = `${destSize(dest)}px`;
  }

  /* track ---------------------------------------------------------------- */
  const trackHtml = [];
  const cols = vis.map((v) => v.col);
  trackHtml.push(`<div class="sign__bar" style="width:${Math.max(0, 320 * (cols[cols.length - 1] - cols[0]))}px"></div>`);
  /* The Figma puts a double chevron in the gap that leads to the destination. */
  const destVisible = statusFor(vis[n - 1], n - 1) === 'final';
  for (let i = 0; i < n - 1; i++) {
    const cx = (cols[i] * 320 + 160 + cols[i + 1] * 320 + 160) / 2;
    if (i === n - 2 && destVisible) {
      trackHtml.push(`<div class="schev" style="left:${cx - 29}px">`
        + `<img src="${ICONS}chevron--dark.svg" alt=""><img src="${ICONS}chevron--white.svg" alt=""></div>`);
      trackHtml.push(`<div class="schev" style="left:${cx - 5.84}px">`
        + `<img src="${ICONS}chevron--dark.svg" alt=""><img src="${ICONS}chevron--white.svg" alt=""></div>`);
      continue;
    }
    trackHtml.push(`<div class="schev" style="left:${cx - 18}px">`
      + `<img src="${ICONS}chevron--dark.svg" alt=""><img src="${ICONS}chevron--white.svg" alt=""></div>`);
  }
  trackHtml.push(`<div class="srow">${vis.map((entry, vi) => {
    const status = statusFor(entry, vi);
    return `<div style="grid-column:${entry.col + 1}">`
      + `<div class="marker marker--${status}">${iconTag(entry, status)}</div></div>`;
  }).join('')}</div>`);
  $('signTrack').innerHTML = trackHtml.join('');

  /* names ---------------------------------------------------------------- */
  $('signNames').innerHTML = `<div class="srow">${vis.map((entry) => {
    const st = STOPS[entry.code] || [];
    const label = (st[2] || entry.code).toUpperCase();
    return `<div style="grid-column:${entry.col + 1}"><div class="sname" style="font-size:${nameSize(label)}px" `
      + `title="${escapeHtml(label)}">${escapeHtml(label)}</div></div>`;
  }).join('')}</div>`;

  /* pills ---------------------------------------------------------------- */
  $('signPills').innerHTML = `<div class="srow">${vis.map((entry, vi) => {
    const st = STOPS[entry.code] || [];
    const status = statusFor(entry, vi);
    /* Every train station shows its line code(s) as pills — the line suffix
       and colour of the Figma "Train Station Icons" sheet. The codes sit in
       one row above the status pill (Figma Screen 3). */
    const lines = (st[7] || '').split('/').filter(Boolean).map((code) => {
      const l = LINE_PILL[code] || { label: `${code}L`, color: '#748477' };
      return `<span class="pill pill--line" style="background:${l.color}">${escapeHtml(l.label)}</span>`;
    });
    let statusPill = '';
    if (status === 'stopping') statusPill = `<span class="pill pill--stop">${TAGS.stopping}</span>`;
    else if (status === 'next') statusPill = `<span class="pill">${TAGS.next}</span>`;
    else if (status === 'final') statusPill = `<span class="pill pill--final">${TAGS.final}</span>`;
    const lineRow = lines.length ? `<div class="spills__lines">${lines.join('')}</div>` : '';
    return `<div style="grid-column:${entry.col + 1}"><div class="spills">${lineRow}${statusPill}</div></div>`;
  }).join('')}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ─────────── fitting: service number, callout, whole unit ─────────── */

/* The green box grows with the service number (Pencil C9UR11: "999A" ->
   273px); past 300px of type the number itself steps down so the callout
   always keeps room. */
const NUMBER_MAX_W = 300;

function fitNumber() {
  const el = $('signNumber');
  let fs = 78;
  el.style.fontSize = `${fs}px`;
  while (el.offsetWidth > NUMBER_MAX_W && fs > 40) {
    fs -= 2;
    el.style.fontSize = `${fs}px`;
  }
}

/* BUS STOPPING fills the space between the service box and the clock
   (Pencil C9UR11), shrinking the type only when the number is long. */
function fitCallout() {
  const box = $('signCallout');
  if (box.hidden) return;
  const el = $('signCalloutText');
  let fs = 80;
  el.style.fontSize = `${fs}px`;
  const avail = box.clientWidth - 14;
  while (el.offsetWidth > avail && fs > 44) {
    fs -= 2;
    el.style.fontSize = `${fs}px`;
  }
}

/* One item: the display and its panel scale together and stay centred. */
function fitUnit() {
  const app = $('app');
  const unit = $('unit');
  const cs = getComputedStyle(app);
  const availW = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.max(0.2, Math.min(1, availW / unit.offsetWidth, availH / unit.offsetHeight));
  unit.style.transform = `scale(${s})`;
}
