// Local check: the Worker's own render code, in Node, against live data -> out/<motif>-<fmt>.png (+ .svg).
// Run from worker-cards/: node test/render.mjs [motif ...]
// Look at the PNGs: overflow, text on text, a cut figure, a zero where a failed read should have dropped
// the element — the things a pixel test would not catch.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readState } from '../src/data.js';
import { ensureWasm, renderCard } from '../src/render.js';
import { MOTIFS } from '../src/card.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const rd = p => readFile(path.join(root, p));
const POSES = ['idle', 'giggle', 'liq', 'burn', 'burn-small', 'burn-nice', 'burn-big', 'burn-mega', 'burn-apocalypse', 'burn-supernova'];

await ensureWasm(await rd('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const assets = {
  fonts: await Promise.all(['inter-500', 'inter-700', 'spacegrotesk-600', 'spacegrotesk-700'].map(f => rd(`fonts/${f}.ttf`))),
  logo: await rd('img/logo.png'),
  poses: Object.fromEntries(await Promise.all(POSES.map(async p => [p, await rd(`img/${p}.png`)]))),
};

const t0 = Date.now();
const S = await readState();
console.log('data', Date.now() - t0, 'ms', { burns: S.burns.length, liq: S.liq.length, price: S.price, bnbP: S.bnbP, deadA: S.deadA, queued: S.queued, walletBnb: S.walletBnb, lpPct: S.lpPct, candles: S.candles?.rows.length });

await mkdir(path.join(root, 'out'), { recursive: true });
const want = process.argv.slice(2).length ? process.argv.slice(2) : MOTIFS;
for (const k of want) for (const fmt of ['wide', 'tall']) {
  const t = Date.now();
  const r = renderCard(S, k, fmt, assets);
  const name = `${k}-${fmt}`;
  await writeFile(path.join(root, 'out', name + '.png'), r.png);
  await writeFile(path.join(root, 'out', name + '.svg'), r.svg.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'data:,'));
  console.log(name.padEnd(12), (r.png.length / 1024).toFixed(0) + ' KB', Date.now() - t, 'ms', r.complete ? '' : '(incomplete: an element was dropped)');
}
