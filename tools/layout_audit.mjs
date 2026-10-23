/**
 * Numeric layout audit (no raster needed) — prints the box of every
 * visible block at a given viewport size.
 * usage: node tools/layout_audit.mjs [url] [width] [height]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const W = Number(process.argv[3] || 1920);
const H = Number(process.argv[4] || 1080);
const PORT = 9900 + Math.floor(Math.random() * 90);

const profile = mkdtempSync(join(tmpdir(), 'pids-audit-'));
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, URL,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
}
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(3500);

const out = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
               right: Math.round(b.right), bottom: Math.round(b.bottom) };
    };
    const out = {
      viewport: { w: innerWidth, h: innerHeight },
      scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
      app: box('.app'),
      unit: box('.unit'),
      unitTransform: getComputedStyle(document.getElementById('unit')).transform,
      stage: box('.stage'),
      sign: box('#sign'),
      panel: box('.panel'),
      svcField: box('#svcInput'),
      dirField: box('#dirSelect'),
      bell: box('.bell'),
      bellSvg: box('.bell__svg'),
      dataPill: box('#dataPill'),
    };
    const s = out.sign.w / 1280;
    out.signScale = Math.round(s * 1000) / 1000;
    out.unitCentre = { x: Math.round((out.unit.x + out.unit.right) / 2), y: Math.round((out.unit.y + out.unit.bottom) / 2) };
    out.viewportCentre = { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
    return out;
  })()`,
});
console.log(JSON.stringify(out.result.value, null, 2));
ws.close();
proc.kill();
process.exit(0);
