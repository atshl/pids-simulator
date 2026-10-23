/**
 * Extract the sign icons and the Bus Stop Bell artwork from the Figma file
 * "PIDS" (file key aLttgbqVyAlB0RlPBTOXs4) into standalone SVG files.
 *
 *   FIGMA_TOKEN=figd_... node tools/extract_icons.mjs
 *
 * The token is only used for the request; nothing is written to disk.
 * Node ids come straight from the Figma file:
 *
 *   14:502  clock glyph            14:525  bus-stop glyph
 *   14:529  rail-station glyph     14:537  destination flag
 *   14:511  chevron (dark)         14:512  chevron (white)
 *   19:53   Bus Stop Bell frame    (yellow bell body)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = 'aLttgbqVyAlB0RlPBTOXs4';
const TOKEN = process.env.FIGMA_TOKEN
  || readFileSync(join(process.env.TEMP || process.env.TMP || '.', 'figma-token.txt'), 'utf8').trim();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
const H = { 'X-Figma-Token': TOKEN };

const svg = (w, h, d, fill) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">\n`
  + `  <path d="${d}" fill="${fill}"/>\n</svg>\n`;

const pathOf = (s) => {
  const m = s.match(/<path d="([^"]+)"/);
  if (!m) throw new Error('no <path> in the exported SVG');
  return m[1];
};

async function exportSvg(ids) {
  const url = `https://api.figma.com/v1/images/${KEY}?ids=${ids.map(encodeURIComponent).join(',')}&format=svg&scale=1`;
  const r = await fetch(url, { headers: H });
  const j = await r.json();
  if (!r.ok) throw new Error(`Figma ${r.status}: ${JSON.stringify(j)}`);
  const out = {};
  for (const [id, u] of Object.entries(j.images)) {
    if (!u) continue;
    out[id] = await (await fetch(u)).text();
  }
  return out;
}

const imgs = await exportSvg(['14:502', '14:525', '14:529', '14:537', '14:511', '14:512', '19:53']);

const files = {
  'clock--white.svg': svg(29, 29, pathOf(imgs['14:502']), 'white'),
  'bus-stop--white.svg': svg(27, 33, pathOf(imgs['14:525']), 'white'),
  'train--white.svg': svg(27, 33, pathOf(imgs['14:529']), 'white'),
  'flag--white.svg': svg(25, 30, pathOf(imgs['14:537']), 'white'),
  'chevron--dark.svg': svg(29, 62, pathOf(imgs['14:511']), '#141B21'),
  'chevron--white.svg': svg(29, 62, pathOf(imgs['14:512']), 'white'),
};

const bell = imgs['19:53'].match(/<path d="([^"]+)" fill="#FACC15"/);
if (!bell) throw new Error('bell body not found in the Bus Stop Bell frame');
files['bell--FACC15.svg'] = `<svg width="143" height="375" viewBox="0 572 143 375" fill="none" `
  + `xmlns="http://www.w3.org/2000/svg">\n  <path d="${bell[1]}" fill="#FACC15"/>\n</svg>\n`;

for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(OUT, name), body);
  console.log(`  ${name.padEnd(22)} ${body.length} bytes`);
}
console.log(`wrote ${Object.keys(files).length} icons to ${OUT}`);
