// bobai-og: the share card of a scan (see wrangler.toml and card.js).
//   GET /scan/<0x address>.png   -> 1200x630 PNG, from our own /api/preflight at $500; cached an hour at the edge
//   GET /health                  -> ok
// A check that does not answer still gives a card (the plain "scan any token" one), cached five minutes only.
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import grotesk from './fonts/grotesk-700.ttf';
import inter400 from './fonts/inter-400.ttf';
import inter600 from './fonts/inter-600.ttf';
import logo from './logo.png';
import { card, agentCard } from './card.js';

let ready = null;
const fonts = [new Uint8Array(grotesk), new Uint8Array(inter400), new Uint8Array(inter600)];
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const LOGO = 'data:image/png;base64,' + b64(logo);

export async function render(svg) {
  if (!ready) ready = initWasm(wasm);
  await ready;
  const r = new Resvg(svg.replace('LOGO_DATA_URI', LOGO), { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1200 } });
  return r.render().asPng();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    // THE AGENT CARD (2026-10-13): /agent/<id>.png from the agent's chart; its listed picture only for a verified listing
    const ag = url.pathname.match(/^\/(?:og\/)?agent\/(\d{1,9})\.png$/);
    if (ag) {
      const id = String(Number(ag[1]));
      const key = new Request(`https://og.brainonbnb.com/agent/${id}.png`);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      let c = null, face = null;
      try { const r = await fetch(`https://agent.brainonbnb.com/chart/${id}`, { signal: AbortSignal.timeout(15000) }); if (r.ok) { const j = await r.json(); if (j && j.id != null) c = j; } } catch { /* the plain card */ }
      const L = c && c.listed, img = c && String(c.image || '');
      if (L && (L.ours || L.verified_builder || L.verified_and_maintained) && /^https:\/\/[^\s"'<>]+$/.test(img)) {
        try {
          const r = await fetch(img, { signal: AbortSignal.timeout(5000) }), ct = (r.headers.get('content-type') || '').split(';')[0];
          const buf = r.ok && /^image\/(png|jpeg)$/.test(ct) ? await r.arrayBuffer() : null;
          if (buf && buf.byteLength < 1.5e6) face = `data:${ct};base64,` + b64(buf);
        } catch { /* the letter */ }
      }
      const png = await render(agentCard(c, { face }));
      const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${c ? 3600 : 300}`, 'access-control-allow-origin': '*' } });
      ctx.waitUntil(caches.default.put(key, res.clone()));
      return res;
    }
    const m = url.pathname.match(/^\/(?:og\/)?scan\/(0x[0-9a-fA-F]{40})\.png$/);
    if (!m) return new Response('not found', { status: 404 });
    const address = m[1].toLowerCase();
    const key = new Request(`https://og.brainonbnb.com/scan/${address}.png`);
    const hit = await caches.default.match(key);
    if (hit) return hit;
    let pf = null;
    try {
      const r = await fetch(`https://brainonbnb.com/api/preflight?address=${address}&usd=500`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const j = await r.json(); if (j && j.token) pf = j; }
    } catch { /* the plain card */ }
    const png = await render(card(pf, { address }));
    const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${pf ? 3600 : 300}`, 'access-control-allow-origin': '*' } });
    ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  },
};
