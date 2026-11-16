// Draws the page cards on this machine with the worker's own card.js, pages.js, fonts and resvg, from the live sources,
// to look at before a deploy. Writes nothing in the repo.
//   node worker-og/render-local.mjs <outdir> [token registry jobs settle board]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { pageCard, boardCard } from './card.js';
import { pageSpec, PAGES } from './pages.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const names = process.argv.slice(3).length ? process.argv.slice(3) : [...PAGES, 'board'];
await initWasm(fs.readFileSync(path.join(DIR, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
const fonts = ['grotesk-700.ttf', 'inter-400.ttf', 'inter-600.ttf'].map((f) => new Uint8Array(fs.readFileSync(path.join(DIR, 'fonts', f))));
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(DIR, 'logo.png')).toString('base64');
const get = (u) => fetch(u, { headers: { 'user-agent': 'brainonbnb-test og-local' }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
fs.mkdirSync(out, { recursive: true });
for (const n of names) {
  let svg;
  if (n === 'board') { const [b, a] = await Promise.all([get('https://agent.brainonbnb.com/board?limit=1'), get('https://agent.brainonbnb.com/board/active')]); svg = boardCard(b, a); }
  else svg = pageCard(await pageSpec(n, get));
  const png = new Resvg(svg.replace('LOGO_DATA_URI', LOGO), { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  fs.writeFileSync(path.join(out, n + '.png'), png);
  console.log(n, png.length);
}
