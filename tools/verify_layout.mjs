/**
 * Headless verification for the PIDS simulator.
 * Drives Edge over the DevTools Protocol: checks geometry, overflow, content,
 * the interaction states (default / end-of-route / bell) and the layout rules
 * (long service numbers, unit centring, auto direction reversal).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const PORT = 9333 + Math.floor(Math.random() * 300);

const profile = mkdtempSync(join(tmpdir(), 'pids-edge-'));
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1600,1400', URL,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('devtools target not found');
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description
      || msg.params.exceptionDetails?.text));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error'
             && !/favicon/.test(msg.params.entry.text)) {
    errors.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  }
};

function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
}

await send('Runtime.enable');
await send('Log.enable');
await sleep(3000);

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

const ok = (pass, label, detail = '') => {
  if (!pass) fails++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
};

const SNAPSHOT = `(() => {
  const sign = document.getElementById('sign');
  const r = sign.getBoundingClientRect();
  const over = [];
  sign.querySelectorAll('*').forEach((el) => {
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return;
    const d = { bottom: b.bottom - r.bottom, right: b.right - r.right, top: r.top - b.top, left: r.left - b.left };
    if (d.bottom > 0.6 || d.right > 0.6 || d.top > 0.6 || d.left > 0.6) {
      over.push({ cls: (el.className || el.tagName).toString().slice(0, 40),
                  text: (el.textContent || '').trim().slice(0, 30),
                  over: [Math.round(d.left), Math.round(d.top), Math.round(d.right), Math.round(d.bottom)] });
    }
  });
  const names = [...document.querySelectorAll('#signNames .srow > div')].map((c) => {
    const n = c.querySelector('.sname');
    const b = n.getBoundingClientRect();
    return { name: n.textContent.trim(), fs: getComputedStyle(n).fontSize,
             x: Math.round(b.left - r.left + b.width / 2), y: Math.round(b.top - r.top) };
  });
  const markers = [...document.querySelectorAll('#signTrack .marker')].map((m) => {
    const cs = getComputedStyle(m);
    const b = m.getBoundingClientRect();
    return { bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopColor,
             icon: m.querySelector('img')?.getAttribute('src').split('/').pop(),
             cx: Math.round(b.left - r.left + b.width / 2), y: Math.round(b.top - r.top) };
  });
  const pills = [...document.querySelectorAll('#signPills .spills')].map((p) => ({
    items: [...p.querySelectorAll('.pill')].map((x) => x.textContent.trim() + ' ' + getComputedStyle(x).backgroundColor),
  }));
  const bar = document.querySelector('.sign__bar');
  const barBox = bar.getBoundingClientRect();
  return {
    sign: { w: Math.round(r.width), h: Math.round(r.height) },
    number: document.getElementById('signNumber').textContent,
    dest: document.getElementById('signDest').textContent,
    destHidden: document.getElementById('signDest').hidden,
    callout: document.getElementById('signCallout').hidden ? null : document.getElementById('signCalloutText').textContent,
    bar: { x: Math.round(barBox.left - r.left), w: Math.round(barBox.width) },
    names, markers, pills,
    text: sign.innerText.replace(/\\n+/g, ' | '),
    overflow: over,
  };
})()`;

function report(label, snap) {
  console.log(`\n===== ${label} =====`);
  console.log(`sign ${snap.sign.w}x${snap.sign.h}   number=${snap.number}  dest="${snap.dest}"${snap.destHidden ? ' (hidden)' : ''}  callout=${snap.callout || 'none'}`);
  console.log(`bar x=${snap.bar.x} w=${snap.bar.w}`);
  console.log(`overflow: ${snap.overflow.length ? JSON.stringify(snap.overflow) : 'none'}`);
  snap.markers.forEach((m, i) => {
    const n = snap.names[i] || {};
    const p = snap.pills[i] || {};
    console.log(`  ${i + 1}. ${String(n.name).padEnd(24)} ${String(n.fs).padEnd(5)} c=${n.x} y=${n.y}  marker c=${m.cx} y=${m.y} ${m.bg} ${m.border} ${m.icon}`);
    console.log(`      pills: ${p.items.join(' + ') || '(none)'}`);
  });
  console.log(`  text: ${snap.text}`);
}

console.log('service options:', JSON.stringify(await evaluate(
  `[...document.getElementById('dirSelect').options].map(o => o.text)`)));
console.log('pill:', await evaluate(`document.getElementById('dataPill').textContent`));

report('A · default view', await evaluate(SNAPSHOT));

await evaluate(`S.pos = S.route.length - 1; S.phase = 'dwell'; S.t = 0; render()`);
await sleep(300);
report('B · end of route (design composition)', await evaluate(SNAPSHOT));

await evaluate(`document.getElementById('btnRequest').click()`);
await sleep(300);
report('C · bus stop bell rung', await evaluate(SNAPSHOT));

// ── the bell sounds on every press, latches once, and is one whole SVG ──
console.log('\n===== BUS STOP BELL =====');
await evaluate(`(() => {
  window.__plays = 0;
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays++; const p = orig.apply(this, arguments); if (p && p.catch) p.catch(() => {}); return p; };
  return true;
})()`);
await evaluate(`(() => { S.requested = null; updateRequestButton(); render(); return true; })()`);
const bellIdle = await evaluate(`(() => {
  const b = document.getElementById('btnRequest');
  return { pressed: b.getAttribute('aria-pressed'), cls: b.className,
           stop: getComputedStyle(b.querySelector('.bell__stopbtn')).fill };
})()`);
await evaluate(`document.getElementById('btnRequest').click()`);
const bellFirst = await evaluate(`({ requested: S.requested, plays: window.__plays })`);
await evaluate(`document.getElementById('btnRequest').click(); document.getElementById('btnRequest').click();`);
const bellLatch = await evaluate(`(() => {
  const b = document.getElementById('btnRequest');
  return { requested: S.requested, plays: window.__plays, pressed: b.getAttribute('aria-pressed'),
           cls: b.className, stop: getComputedStyle(b.querySelector('.bell__stopbtn')).fill,
           src: document.getElementById('bellAudio').getAttribute('src'),
           time: Math.round(document.getElementById('bellAudio').currentTime * 10) / 10 };
})()`);
const bellGeom = await evaluate(`(() => {
  const b = document.getElementById('btnRequest');
  const svg = b.querySelector('.bell__svg');
  const br = b.getBoundingClientRect(), sr = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const stop = svg.querySelector('.bell__stopbtn').getBBox();
  const txt = svg.querySelector('.bell__stoptxt');
  const cs = getComputedStyle(txt);

  /* screws: every slot must be a 18x4 chord through the middle of its disc,
     pivoting on its top-left corner exactly as Pencil exports it */
  const discs = [...svg.querySelectorAll('circle')];
  const slotGroups = [...svg.querySelectorAll('g')].filter((g) => {
    const r = g.querySelector('rect');
    return r && r.getAttribute('fill') === '#747474';
  });
  const slots = slotGroups.map((g) => g.querySelector('rect'));
  const P = (el, x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(el.getScreenCTM()); };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const screws = discs.map((c, i) => {
    const s = slots[i];
    const m = c.getScreenCTM();
    const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
    const ctr = P(c, cx, cy);
    const mid = P(s, (+s.getAttribute('width')) / 2, (+s.getAttribute('height')) / 2);
    const a = P(s, 0, (+s.getAttribute('height')) / 2);
    const e = P(s, +s.getAttribute('width'), (+s.getAttribute('height')) / 2);
    const r = +c.getAttribute('r') * Math.hypot(m.a, m.b);
    return {
      r: +c.getAttribute('r'),
      cx: Math.round(cx * 10) / 10,
      cy: Math.round(cy * 10) / 10,
      offCentre: Math.round((dist(mid, ctr) / r) * 1000) / 1000,
      chord: dist(a, ctr) <= r && dist(e, ctr) <= r,
    };
  });
  const body = svg.querySelector('path').getBBox();

  return {
    children: [...b.children].map((e) => e.tagName),
    inside: sr.left >= br.left - 0.5 && sr.top >= br.top - 0.5
            && sr.right <= br.right + 0.5 && sr.bottom <= br.bottom + 0.5,
    aspect: Math.round((sr.width / sr.height) * 1000) / 1000,
    viewBox: [vb.x, vb.y, vb.width, vb.height].join(' '),
    stop: [stop.x, stop.y, stop.width, stop.height].map(Math.round).join(' '),
    parts: svg.querySelectorAll('path, rect, circle, text').length,
    font: cs.fontFamily.split(',')[0].replace(/"/g, '') + ' ' + cs.fontWeight + ' ' + cs.fontSize,
    text: txt.textContent,
    panel: Math.round(document.querySelector('.panel').getBoundingClientRect().bottom - br.bottom),
    bodyCentreX: Math.round((body.x + body.width / 2) * 10) / 10,
    screws,
    slotAttrs: slotGroups.map((g) => g.getAttribute('transform') + ' | '
      + [...g.querySelectorAll('rect')].map((r) => r.getAttribute('width') + 'x' + r.getAttribute('height')).join('')),
  };
})()`);
console.log(JSON.stringify({ bellIdle, bellFirst, bellLatch, bellGeom }, null, 2));
ok(bellIdle.pressed === 'false' && bellIdle.stop === 'rgb(225, 29, 37)', 'idle bell: red STOP button, not pressed');
ok(bellFirst.requested != null && bellFirst.plays === 1, 'first press rings the bell (sound plays) and sets the request');
ok(bellLatch.requested === bellFirst.requested && bellLatch.pressed === 'true'
   && bellLatch.stop === 'rgb(168, 19, 26)', 'bell latches (BUS STOPPING stays, STOP darkens to #A8131A)');
ok(bellLatch.plays === 3, 'the sound replays on every press', `plays=${bellLatch.plays} after 3 presses`);
ok(bellLatch.src === 'assets/bus-stop-bell.mp3', 'the bell uses the PIDS mp3', bellLatch.src);
ok(bellGeom.children.join(',') === 'svg', 'no text or parts below the bell', bellGeom.children.join(','));
ok(bellGeom.inside, 'the whole bell is inside its button');
ok(Math.abs(bellGeom.aspect - 144 / 377) < 0.006, 'bell keeps the component aspect ratio', String(bellGeom.aspect));
ok(bellGeom.viewBox === '0 572 144 377' && bellGeom.stop === '9 698 126 126',
  'STOP button sits at 9,126 (126x126) in the Figma bell coordinates', bellGeom.viewBox + ' / ' + bellGeom.stop);
ok(bellGeom.font === 'JetBrains Mono 200 40px' && bellGeom.text === 'STOP', 'STOP label is JetBrains Mono 200 40px');

// the two screws sit on the bell's centre line, 19.5 from the top and 18.5 from the bottom
ok(bellGeom.bodyCentreX === 71.5 && bellGeom.screws.length === 2,
  'the bell body is 143 wide and carries exactly two screw discs', `body centre ${bellGeom.bodyCentreX}`);
ok(bellGeom.screws.every((s) => s.r === 11.5 && s.cx === 71.5 && s.cx === bellGeom.bodyCentreX),
  'both screw discs are 23 px wide and centred on the bell body', JSON.stringify(bellGeom.screws.map((s) => [s.r, s.cx])));
ok(bellGeom.screws[0].cy === 591.5 && bellGeom.screws[1].cy === 930.5,
  'the screws sit 8 px from the top and 8 px from the bottom', bellGeom.screws.map((s) => s.cy).join(' / '));
ok(bellGeom.slotAttrs[0] === 'translate(67 584) rotate(45) | 18x4'
   && bellGeom.slotAttrs[1] === 'translate(63.4328 935.5522) rotate(-45) | 18x4',
  'the screw slots use the Pencil geometry (18 x 4, pivoting on the top-left corner)',
  bellGeom.slotAttrs.join(' | '));
ok(bellGeom.screws.every((s) => s.offCentre <= 0.35 && s.chord),
  'each screw slot is centred in its disc and spans it end to end (KrwUd)',
  bellGeom.screws.map((s) => `off ${s.offCentre}`).join(', '));

// paint check: rasterise the bell and sample it, so a broken glyph/shape shows up
const bellPaint = await evaluate(`(async () => {
  const svg = document.querySelector('.bell__svg');
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 144; c.height = 377;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 144, 377);
  // the SVG viewBox starts at y=572, so canvas y = figma y - 572
  const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).join(',');
  const textFill = getComputedStyle(svg.querySelector('.bell__stoptxt')).fill;
  return {
    bodyTop: at(30, 60),       // figma y 632 — yellow body, left of the screws
    bodyBottom: at(30, 350),   // figma y 922 — yellow body
    stopBtn: at(20, 189),      // figma y 761 — inside the red button
    screwTop: at(71, 10),      // figma y 582 — top screw disc
    screwBottom: at(71, 349),  // figma y 921 — bottom screw disc
    slot: at(71, 19),          // figma y 591 — the top screw slot on the disc centre
    slotBottom: at(66, 361),   // figma y 933 — on the bottom screw slot
    textFill,
  };
})()`);
console.log(JSON.stringify(bellPaint));
ok(bellPaint.bodyTop === '250,204,21' && bellPaint.bodyBottom === '250,204,21', 'the yellow body paints top to bottom');
ok(bellPaint.stopBtn === '225,29,37', 'the red STOP button paints inside the body');
ok(bellPaint.screwTop === '217,217,217' && bellPaint.screwBottom === '217,217,217'
   && bellPaint.slot === '116,116,116' && bellPaint.slotBottom === '116,116,116',
  'both screws paint inside the body, each with its slot');
ok(bellPaint.textFill === 'rgb(255, 255, 255)', 'the STOP label is white');

// ── the bell is the only button; the panel has just service + direction ──
const controls = await evaluate(`({
  labels: [...document.querySelectorAll('.panel__fields .field__label')].map((l) => l.textContent.trim()),
  buttons: [...document.querySelectorAll('button')].map((b) => b.id || b.textContent.trim()),
  removed: ['btnPlay', 'btnRestart', 'btnEnd', 'speedRange', 'routeHint', 'reqHint', 'bellLabel']
    .filter((k) => document.getElementById(k)),
})`);
console.log('\n===== CONTROLS =====');
console.log(JSON.stringify(controls));
ok(controls.labels.join(',') === 'Bus service,Direction', 'the panel only offers the service and the direction');
ok(controls.buttons.join(',') === 'btnRequest', 'the bell is the only button');
ok(controls.removed.length === 0, 'play / restart / jump-to-end / speed are gone', controls.removed.join(','));

// ── at the terminus the service runs back the other way ──
const revPick = await evaluate(`(() => {
  for (const [svc, v] of Object.entries(SERVICES)) {
    if (v.r.length === 2 && v.r[1][0] === v.r[0][v.r[0].length - 1] && v.r[0].length > 6) return svc;
  }
  return null;
})()`);
await evaluate(`(() => {
  /* snapshot in the same task as the forced terminus state, so a frame that
     lands in between cannot reverse the bus under the snapshot */
  document.getElementById('svcInput').value = ${JSON.stringify(revPick)};
  onServiceInput();
  const before = { svc: S.svc, dir: S.dir, last: S.route[S.route.length - 1],
    pos: S.pos, dirs: SERVICES[S.svc].r.length, first: S.route[0] };
  S.pos = S.route.length - 1; S.phase = 'dwell'; S.t = S.dwellTime + 0.2;
  window.__revBefore = before;
  return before;
})()`);
const revBefore = await evaluate(`window.__revBefore`);
await sleep(900);
const revAfter = await evaluate(`({
  dir: S.dir, pos: S.pos, first: S.route[0],
  sel: document.getElementById('dirSelect').value,
  selected: document.getElementById('dirSelect').selectedOptions[0]?.text,
  desc: S.route.length > 1 ? stopName(S.route[0]) + ' -> ' + stopName(S.route[S.route.length - 1]) : '',
})`);
console.log('\n===== AUTO DIRECTION REVERSAL =====');
console.log(JSON.stringify({ revBefore, revAfter }, null, 2));
ok(revBefore.dirs === 2 && revAfter.dir !== revBefore.dir, 'at the terminus the bus switches to the opposite direction');
ok(revAfter.pos === 0 && revAfter.first === revBefore.last,
  'the other direction starts at the stop the bus just reached', `${revAfter.first} / ${revBefore.last}`);
ok(revAfter.sel === String(revAfter.dir), 'the direction picker follows the reversal', revAfter.selected);

await evaluate(`(() => {
  document.getElementById('svcInput').value = '50';
  onServiceInput();
  return true;
})()`);
await sleep(300);

// the Figma file has no "stop requested" sign state — the sign must stay Figma-only
const figmaOnly = await evaluate(`(() => {
  const LINE_COLOURS = {
    NSL: 'rgb(212, 46, 18)', EWL: 'rgb(0, 150, 69)', NEL: 'rgb(153, 0, 170)',
    CCL: 'rgb(250, 158, 13)', DTL: 'rgb(0, 94, 196)', TEL: 'rgb(157, 91, 37)',
    LRT: 'rgb(116, 132, 119)',
  };
  const pills = [...document.querySelectorAll('#signPills .pill')].map(t => t.textContent.trim());
  const markers = [...document.querySelectorAll('#signTrack .marker')].map(c => c.className);
  const callout = document.getElementById('signCalloutText').textContent.trim();
  const dest = document.getElementById('signDest').textContent.trim();
  const linePills = pills.filter(p => /^[A-Z]{1,4}$/.test(p));
  return {
    requested: S.requested,
    pills, markers, callout, dest, linePills,
    hasRequestedState: pills.includes('STOP REQUESTED') || markers.some(c => c.includes('requested'))
      || callout.includes('REQUESTED'),
    multiCodePill: linePills.some(p => p.includes('/')),
    badLineLabel: linePills.filter(p => !['NSL', 'EWL', 'NEL', 'CCL', 'DTL', 'TEL', 'LRT'].includes(p)),
    unknownLine: linePills.filter(p => !['NSL', 'EWL', 'NEL', 'CCL', 'DTL', 'TEL', 'LRT'].includes(p)),
    badLineColour: [...document.querySelectorAll('#signPills .pill--line')]
      .map(p => p.textContent.trim() + ':' + getComputedStyle(p).backgroundColor)
      .filter(s => !LINE_COLOURS[s.split(':')[0]] || LINE_COLOURS[s.split(':')[0]] !== s.split(':')[1]),
  };
})()`);
console.log('\n===== Figma-ONLY SIGN STATES =====');
console.log(JSON.stringify(figmaOnly, null, 2));
const figmaOnlyOk = !figmaOnly.hasRequestedState && !figmaOnly.multiCodePill && !figmaOnly.badLineLabel.length
  && !figmaOnly.unknownLine.length && !figmaOnly.badLineColour.length;
ok(figmaOnlyOk, 'no non-Figma sign state (no STOP REQUESTED, one code per pill, every line code known and L-suffixed)');

// ── the sign rules ──
const rules = await evaluate(`(() => {
  const cols = () => [...document.querySelectorAll('#signNames .srow > div')]
    .map((c) => Math.round(c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2));
  const pillsOf = () => [...document.querySelectorAll('#signPills .spills')]
    .map((p) => [...p.querySelectorAll('.pill')].map((x) => x.textContent.trim()));
  const namesOf = () => [...document.querySelectorAll('#signNames .sname')].map((n) => n.textContent.trim());
  const out = {};
  // 1. an ordinary dwell shows NEXT STOP — never BUS STOPPING
  S.requested = null; S.phase = 'dwell'; S.t = 0; render();
  out.dwell = { callout: document.getElementById('signCallout').hidden ? null : 'shown', pills: pillsOf() };
  // 2. the bell was rung for this stop -> BUS STOPPING
  S.requested = S.pos; render();
  out.rung = {
    callout: document.getElementById('signCallout').hidden ? null : 'shown',
    pills: pillsOf(),
    names: namesOf(),
    markers: [...document.querySelectorAll('#signTrack .marker')].map(c => c.className),
  };
  // 2b. while the bus is still approaching the requested stop, the red marker
  //     belongs to that stop — not to the next one
  S.requested = S.pos + 2; S.phase = 'move'; render();
  out.approaching = {
    names: namesOf(),
    markers: [...document.querySelectorAll('#signTrack .marker')].map(c => c.className),
    requested: stopName(S.route[S.requested]),
  };
  // 3. the terminus is always the 4th column, the first 3 change
  S.requested = null; S.phase = 'move'; render();
  const before = cols();
  S.pos = Math.max(0, S.pos - 2); render();
  const after = cols();
  out.columns = { before, after, terminusLast: true };
  // 4. an interchange with two rail lines shows both line pills in one row
  const savedRoute = S.route.slice(); const savedPos = S.pos;
  const keys = Object.keys(STOPS);
  const multiKey = keys.find(k => (STOPS[k][7] || '').split('/').filter(Boolean).length > 1);
  const filler = keys.filter(k => k !== multiKey).slice(0, 2);
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'; };
  S.route = [filler[0], multiKey, filler[1]];
  S.pos = 0; S.phase = 'move'; S.t = 0; S.requested = null;
  render();
  const codes = STOPS[multiKey][7].split('/').filter(Boolean);
  out.multiLine = {
    stop: STOPS[multiKey][2], codes: STOPS[multiKey][7],
    expected: codes.map(c => LINE_PILL[c].label),
    expectedColours: codes.map(c => rgb(LINE_PILL[c].color)),
    rows: [...document.querySelectorAll('#signPills .spills')].map(p => ({
      labels: [...p.querySelectorAll('.pill--line')].map(x => x.textContent.trim()),
      colours: [...p.querySelectorAll('.pill--line')].map(x => getComputedStyle(x).backgroundColor),
    })),
  };
  S.route = savedRoute; S.pos = savedPos; S.phase = 'move'; render();
  return out;
})()`);
console.log('\n===== SIGN RULES (bell / terminus column / line pills) =====');
console.log(JSON.stringify(rules, null, 2));
const rulesOk = rules.dwell.callout === null
  && rules.dwell.pills.flat().includes('NEXT STOP')
  && !rules.dwell.pills.flat().includes('BUS STOPPING')
  && rules.rung.callout === 'shown'
  && rules.rung.pills.flat().includes('BUS STOPPING');
ok(rulesOk, 'BUS STOPPING only after the bell is rung');
const redAt = (r) => r.markers.findIndex((m) => m.includes('marker--stopping'));
const stopIdx = (r) => r.names.findIndex((n) => n.toUpperCase() === String(r.requested).toUpperCase());
ok(redAt(rules.rung) === 0 && redAt(rules.approaching) === stopIdx(rules.approaching) && stopIdx(rules.approaching) > 0,
  'the red marker follows the requested stop',
  `at the stop: column ${redAt(rules.rung) + 1}, approaching: column ${redAt(rules.approaching) + 1} of "${rules.approaching.requested}"`);
const multiOk = rules.multiLine.rows.some(r => r.labels.join(',') === rules.multiLine.expected.join(',')
  && r.colours.join(',') === rules.multiLine.expectedColours.join(','));
ok(multiOk, 'an interchange shows every rail line as its own coloured pill',
  `${rules.multiLine.stop} ${rules.multiLine.codes} -> ${rules.multiLine.expected.join(' + ')}`);

// ── Figma fidelity: layout constants from the PIDS file (Screens 1-4) ──
const fidelity = await evaluate(`(() => {
  const sign = document.getElementById('sign');
  const out = [];
  const ok = (name, actual, expected) => out.push({ name, actual, expected, pass: String(actual) === String(expected) });
  const sr = sign.getBoundingClientRect();
  const scale = sr.width / 1280;
  // absolute (unscaled) position of an element inside the sign
  const abs = (el) => {
    const b = el.getBoundingClientRect();
    return { x: Math.round((b.left - sr.left) / scale), y: Math.round((b.top - sr.top) / scale),
             w: Math.round(b.width / scale), h: Math.round(b.height / scale) };
  };
  const box = (sel) => { const el = document.querySelector(sel); return el ? abs(el) : null; };
  ok('sign size', sign.offsetWidth + 'x' + sign.offsetHeight, '1280x600');
  const band = box('.sign__band'), area = box('.sign__area');
  ok('band', band.w + 'x' + band.h, '1280x150');
  ok('area', area.w + 'x' + area.h, '1280x450');
  const svc = box('.sign__svc');
  ok('service block', svc.w + 'x' + svc.h + '@' + svc.x + ',' + svc.y, '190x150@0,0');
  ok('service block fill', getComputedStyle(document.querySelector('.sign__svc')).backgroundColor, 'rgb(91, 191, 46)');
  const num = getComputedStyle(document.getElementById('signNumber'));
  ok('number type', num.fontSize + '/' + num.fontWeight + ' ' + num.fontFamily.split(',')[0].replace(/"/g, ''), '78px/700 Inter');
  ok('head x', box('.sign__head').x, '220');
  const clock = box('.sign__clock');
  ok('clock box', clock.w + 'x' + clock.h, '268x101');
  ok('clock x', clock.x, '983');
  ok('clock y', clock.y, '24');
  const t = getComputedStyle(document.getElementById('signTime'));
  ok('time type', t.fontSize + '/' + t.fontWeight + ' ' + t.fontFamily.split(',')[0].replace(/"/g, ''), '50px/400 Geist Mono');
  const bar = box('.sign__bar');
  ok('bar', bar.w + 'x' + bar.h + '@' + bar.x + ',' + bar.y, '960x22@160,242');
  const markers = [...document.querySelectorAll('#signTrack .marker')].map((m) => abs(m).x + abs(m).w / 2);
  ok('marker centres', markers.join(','), '160,480,800,1120');
  const m0 = abs(document.querySelector('#signTrack .marker'));
  ok('marker size', m0.w, '106');
  ok('marker centre y (on the bar)', m0.y + m0.h / 2, '253');
  const short = [...document.querySelectorAll('#signNames .sname')].find((n) => n.textContent.trim().length <= 20);
  const ns = getComputedStyle(short);
  ok('name type', ns.fontSize + '/' + ns.fontWeight, '40px/700');
  ok('name y', abs(short).y, '325');
  const pillRows = [...document.querySelectorAll('#signPills .spills')].map((p) => {
    const items = [...p.querySelectorAll('.pill')].map((x) => abs(x));
    const ys = [...new Set(items.map((i) => i.y))].sort((a, b) => a - b);
    const okRow = ys.length === 1 ? ys[0] === 476
      : ys.length === 2 ? (ys[0] === 446 && ys[1] === 506)
      : false;
    return (okRow ? 'ok ' : 'BAD') + ' n=' + items.length + ' rows=' + ys.join('+');
  });
  ok('pill rows (single 476 / line 446 + status 506)', pillRows.join(' | '), pillRows.join(' | '));
  ok('pill rows valid', pillRows.every((p) => p.startsWith('ok')) ? 'yes' : 'no', 'yes');
  const stack = [...document.querySelectorAll('#signPills .spills')]
    .map((p) => {
      const lines = [...p.querySelectorAll('.spills__lines .pill')].map((x) => x.className.replace('pill ', '')).join(',');
      const status = [...p.querySelectorAll(':scope > .pill')].map((x) => x.className.replace('pill ', '')).join(',');
      return (lines ? lines + '|' : '') + status;
    })
    .filter((s) => s.includes('|'));
  ok('line pills are on top', stack.every((s) => s.split('|')[0].startsWith('pill--line')) ? 'yes' : 'no', 'yes');
  const pr = getComputedStyle(document.querySelector('#signPills .pill'));
  ok('pill radius', pr.borderTopLeftRadius, '24px');
  const SG = {
    'green-100': '#E9F4C6', 'green-300': '#A9D94E', 'green-500': '#5BBF2E', 'green-600': '#5B8C00',
    'green-700': '#3A5C00', ink: '#101418', display: '#141B21', header: '#1E272E', 'row-light': '#9FB2BF',
    'row-dark': '#6E828F', muted: '#D7E0E6', line: '#D9E2E6', paper: '#F4F6F3', white: '#FFFFFF',
    amber: '#FF9E1B', stop: '#E11D25', arrive: '#FACC15', signal: '#3ED234', mint: '#7BEDD3',
    blue: '#3B82F6', orange: '#F97316', heart: '#E4002B',
  };
  const rootCS = getComputedStyle(document.documentElement);
  const badTok = Object.keys(SG).filter((k) => (rootCS.getPropertyValue('--sg-' + k) || '').trim().toUpperCase() !== SG[k]);
  ok('sg-* tokens (Figma 1:544)', badTok.length ? 'diff: ' + badTok.join(',') : 'all 22 match', 'all 22 match');
  const glyphs = [...document.querySelectorAll('#signTrack .marker img')].map((i) => {
    const b = i.getBoundingClientRect();
    return Math.round(b.width / scale) + 'x' + Math.round(b.height / scale);
  });
  const allowed = ['27x33', '25x30', '40x40'];
  ok('marker glyph sizes valid', glyphs.every((g) => allowed.includes(g)) ? 'yes' : 'no', 'yes');
  const chev = [...document.querySelectorAll('#signTrack .schev')].map((c) => {
    const b = c.getBoundingClientRect();
    return Math.round((b.left - sr.left) / scale) + ',' + Math.round((b.top - sr.top) / scale);
  });
  const gaps = markers.length - 1;
  const destShown = [...document.querySelectorAll('#signTrack .marker')].some((m) => m.className.includes('marker--final'));
  const expectChev = [];
  for (let i = 0; i < gaps; i++) {
    const cx = 320 + 320 * i;
    if (i === gaps - 1 && destShown) {
      expectChev.push(Math.round(cx - 29) + ',222');
      expectChev.push(Math.round(cx - 5.84) + ',222');
    } else {
      expectChev.push((cx - 18) + ',222');
    }
  }
  ok('chevrons', chev.join(' '), expectChev.join(' '));
  return out;
})()`);
console.log('\n===== FIGMA FIDELITY (Screens 1-4) =====');
for (const f of fidelity) {
  if (!f.pass) fails++;
  console.log(`  ${f.pass ? 'ok  ' : 'FAIL'} ${f.name.padEnd(22)} ${String(f.actual).padEnd(22)} expected ${f.expected}`);
}

// ── Figma Screens 1 & 3: the gap that leads to the destination carries a double chevron ──
const destChev = await evaluate(`(() => {
  const sign = document.getElementById('sign');
  S.phase = 'move'; S.pos = Math.max(0, S.route.length - 5); S.t = 0; S.requested = null;
  render();
  const sr = sign.getBoundingClientRect();
  const scale = sr.width / 1280;
  const chev = [...document.querySelectorAll('#signTrack .schev')].map((c) => {
    const b = c.getBoundingClientRect();
    return Math.round((b.left - sr.left) / scale) + ',' + Math.round((b.top - sr.top) / scale);
  });
  const markers = [...document.querySelectorAll('#signTrack .marker')].map((m) => m.className);
  return { chev, markers, dest: markers[markers.length - 1] };
})()`);
console.log('\n===== DESTINATION STATE (Figma double chevron) =====');
console.log(`  chevrons : ${destChev.chev.join(' ')}`);
const wantChev = '302,222 622,222 931,222 954,222';
ok(destChev.chev.join(' ') === wantChev, 'double chevron in the final gap', `${destChev.chev.join(' ')} expected ${wantChev}`);
ok(/final/.test(destChev.markers[destChev.markers.length - 1] || ''), 'destination marker is final');

// ── longer bus service numbers (Pencil Screen 4, C9UR11) ──
const longSvc = await evaluate(`(() => {
  const sign = document.getElementById('sign');
  const probe = (txt) => {
    document.getElementById('signNumber').textContent = txt;
    fitNumber();
    S.requested = S.pos; S.phase = 'dwell'; S.t = 0;
    render();
    const sr = sign.getBoundingClientRect();
    const k = sr.width / 1280;
    const rel = (el) => {
      const b = el.getBoundingClientRect();
      return { l: Math.round((b.left - sr.left) / k), r: Math.round((b.right - sr.left) / k), w: Math.round(b.width / k) };
    };
    const box = rel(document.querySelector('.sign__svc'));
    const num = rel(document.getElementById('signNumber'));
    const call = rel(document.getElementById('signCallout'));
    const clock = rel(document.querySelector('.sign__clock'));
    const txtEl = document.getElementById('signCalloutText');
    const callBox = document.getElementById('signCallout');
    return {
      label: txt,
      box, num, call, clock,
      numberFs: getComputedStyle(document.getElementById('signNumber')).fontSize,
      callFs: getComputedStyle(txtEl).fontSize,
      callFits: txtEl.offsetWidth <= callBox.clientWidth - 14,
      tight: { l: call.l, r: call.r },
    };
  };
  const a = probe('999A');
  const b = probe('999AB');
  S.requested = null;
  document.getElementById('signNumber').textContent = S.svc;
  fitNumber(); render();
  return { a, b };
})()`);
console.log('\n===== LONG SERVICE NUMBERS (Pencil C9UR11) =====');
console.log(JSON.stringify(longSvc, null, 2));
for (const p of [longSvc.a, longSvc.b]) {
  const grows = p.box.w >= 190;
  const inside = p.num.l >= p.box.l - 1 && p.num.r <= p.box.r + 1;
  const spans = Math.abs(p.call.l - (p.box.r + 30)) <= 1 && Math.abs(p.call.r - (p.clock.l - 30)) <= 1;
  ok(grows && inside && spans && p.callFits,
    `"${p.label}": green box ${p.box.w}px, callout ${p.call.w}px between box and clock`,
    `number ${p.num.w}px @${p.numberFs}, callout type ${p.callFs}${p.callFits ? '' : ', TEXT OVERFLOWS'}`);
}
ok(longSvc.a.box.w > 190, 'a 4-character number widens the green box', `${longSvc.a.box.w}px`);

// ── stress: every service × direction, checked for overflow at the worst stop ──
const stress = await evaluate(`(() => {
  const sign = document.getElementById('sign');
  const worst = [];
  let checked = 0;
  for (const svc of Object.keys(SERVICES)) {
    const v = SERVICES[svc];
    for (let d = 0; d < v.r.length; d++) {
      S.svc = svc; S.dir = d; S.route = v.r[d].slice();
      if (!S.route.length) continue;
      document.getElementById('signNumber').textContent = svc;
      fitNumber();
      let best = 0, bestLen = 0;
      for (let i = 0; i < Math.min(S.route.length, 40); i++) {
        const nm = (STOPS[S.route[i]] || [,,''])[2] || '';
        const len = Math.min(nm.length, 40);
        if (len > bestLen) { bestLen = len; best = i; }
      }
      S.pos = best; S.phase = 'dwell'; S.t = 0; S.requested = null;
      render();
      checked++;
      const r = sign.getBoundingClientRect();
      let bad = 0, detail = '';
      sign.querySelectorAll('*').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width && !b.height) return;
        const d2 = { bottom: b.bottom - r.bottom, right: b.right - r.right, top: r.top - b.top, left: r.left - b.left };
        if (d2.bottom > 0.6 || d2.right > 0.6 || d2.top > 0.6 || d2.left > 0.6) {
          bad++;
          if (!detail) detail = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 40)
            + ' :: ' + [d2.left, d2.top, d2.right, d2.bottom].map(Math.round).join(',');
        }
      });
      if (bad) worst.push({ svc, d, bad, detail });
    }
  }
  return { checked, worst: worst.slice(0, 12), worstCount: worst.length };
})()`);
console.log(`\n===== STRESS: ${stress.checked} service/direction combinations =====`);
console.log(`overflowing: ${stress.worstCount}`);
stress.worst.forEach((w) => console.log(`  svc ${w.svc} dir ${w.d} (${w.bad} el) ${w.detail}`));
ok(stress.worstCount === 0, 'no service overflows the sign');

// ── the whole unit fits and stays centred, at any common size ──
for (const [vw, vh] of [[1920, 1080], [1600, 900], [1366, 768]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await evaluate(`fitUnit()`);
  await sleep(300);
  const fit = await evaluate(`(() => {
    const unit = document.getElementById('unit').getBoundingClientRect();
    const sign = document.getElementById('sign').getBoundingClientRect();
    const stage = document.getElementById('stage').getBoundingClientRect();
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const bell = document.querySelector('.bell__svg').getBoundingClientRect();
    const style = getComputedStyle(document.getElementById('unit'));
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      unit: { x: Math.round(unit.left), y: Math.round(unit.top), w: Math.round(unit.width), h: Math.round(unit.height),
              cx: Math.round(unit.left + unit.width / 2), cy: Math.round(unit.top + unit.height / 2) },
      sign: { x: Math.round(sign.left), y: Math.round(sign.top), w: Math.round(sign.width), h: Math.round(sign.height) },
      panel: { r: Math.round(panel.right), b: Math.round(panel.bottom), w: Math.round(panel.width) },
      bell: { r: Math.round(bell.right), b: Math.round(bell.bottom) },
      transform: style.transform,
      stageFits: sign.left >= stage.left - 0.6 && sign.top >= stage.top - 0.6
        && sign.right <= stage.right + 0.6 && sign.bottom <= stage.bottom + 0.6,
    };
  })()`);
  console.log(`\n===== VIEWPORT FIT (${vw}x${vh}) =====`);
  console.log(JSON.stringify(fit, null, 2));
  const centred = Math.abs(fit.unit.cx - fit.vw / 2) <= 1.5 && Math.abs(fit.unit.cy - fit.vh / 2) <= 1.5;
  const inside = fit.unit.x >= 0 && fit.unit.y >= 0
    && fit.unit.x + fit.unit.w <= fit.vw + 0.5 && fit.unit.y + fit.unit.h <= fit.vh + 0.5;
  ok(fit.scrollH <= fit.vh + 1 && fit.scrollW <= fit.vw + 1, 'no scrolling');
  ok(inside && centred, 'the display + panel + bell scale as one unit, centred in the viewport');
  ok(fit.stageFits, 'the display is not clipped by its frame');
  ok(fit.bell.r <= fit.panel.r && fit.bell.b <= fit.panel.b, 'the bell is inside the panel');
}
await send('Emulation.clearDeviceMetricsOverride');

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : 'none');

ws.close();
proc.kill();
process.exit(0);
