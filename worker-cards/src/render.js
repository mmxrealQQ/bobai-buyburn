// SVG -> PNG, shared by the Worker and the Node test so both draw with the very same code.
//
// The caller hands in the raw assets (Worker: bundled as Data modules; Node: read from disk). resvg-wasm
// is initialised once per isolate — a second initWasm() throws, and a card request must never pay the
// ~1 MB instantiate twice.

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { Buffer } from 'node:buffer';
import { motifOf, cardSvg, MOTIFS } from './card.js';

let ready = null;
export function ensureWasm(wasm) { return (ready ||= initWasm(wasm).catch(e => { ready = null; throw e; })); }

// assets: { fonts: [ArrayBuffer|Uint8Array], logo: ArrayBuffer, poses: { name: ArrayBuffer } }
let imgCache = null;
function images(assets) {
  if (imgCache) return imgCache;
  const uri = b => 'data:image/png;base64,' + Buffer.from(b).toString('base64');
  const poses = {}; for (const [k, v] of Object.entries(assets.poses)) poses[k] = uri(v);
  return (imgCache = { logo: assets.logo ? uri(assets.logo) : null, pose: name => poses[name] || null });
}

// The moment asked for, or 'now' when it has nothing on record (no burn yet, or its log did not answer).
export function pickMotif(k, S, now) {
  const m = MOTIFS.includes(k) ? motifOf(k, S, now) : null;
  return m ? { k, m } : { k: 'now', m: motifOf('now', S, now) };
}

export function renderCard(S, k, fmt, assets, now = Date.now()) {
  const { m } = pickMotif(k, S, now);
  const svg = cardSvg(m, fmt, S, images(assets), now);
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontBuffers: assets.fonts.map(f => new Uint8Array(f)), defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' },
  });
  const png = r.render().asPng();
  r.free();
  return { png, svg, m, complete: !!(m.value && m.cards.every(c => c[1] != null)) };
}
