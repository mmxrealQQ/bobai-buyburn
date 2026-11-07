// bobai-og: the share card of a scan (see wrangler.toml and card.js).
//   GET /scan/<0x address>.png   -> 1200x630 PNG, from our own /api/preflight at $500; cached an hour at the edge
//   GET /board.png               -> the Brain Board card with its live figures; 15 minutes at the edge
//   GET /health                  -> ok
// A check that does not answer still gives a card (the plain "scan any token" one), cached five minutes only.
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import grotesk from './fonts/grotesk-700.ttf';
import inter400 from './fonts/inter-400.ttf';
import inter600 from './fonts/inter-600.ttf';
import logo from './logo.png';
import { card, agentCard, boardCard, popCard } from './card.js';

let ready = null;
// the Brain Pop poster under the run card, fetched once per isolate
let poster = null;
const posterUri = async () => { if (poster) return poster; try { const r = await fetch('https://brainonbnb.com/og-brainpop.jpg', { signal: AbortSignal.timeout(8000) }); if (r.ok) poster = 'data:image/jpeg;base64,' + b64(await r.arrayBuffer()); } catch {} return poster; };
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
    // THE BRAIN POP CARD (2026-11-07): /pop/<run>.png — one run: who, the score, the place of its day; the preview of the
    // challenge link brainonbnb.com/m/pop/<run>. A run is final once counted; its place can still move that day: one hour.
    const pm = url.pathname.match(/^\/(?:og\/)?pop\/([a-z0-9]{1,12})\.png$/);
    if (pm) {
      const key = new Request('https://og.brainonbnb.com/pop/' + pm[1] + '.png');
      const hit = await caches.default.match(key);
      if (hit) return hit;
      // through the site, not bobai-pop.*.workers.dev: a worker may not call a workers.dev worker of the same account (1042)
      const POP = 'https://brainonbnb.com/api/pop/';
      const get = (u) => fetch(u, { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const run = await get(POP + 'run/' + pm[1]);
      if (!run) return Response.redirect('https://brainonbnb.com/og-brainpop.jpg', 302);
      let place = null;
      if (run.ranked) { const t = await get(POP + 'top?scope=day&d=' + run.day); const i = t && Array.isArray(t.rows) ? t.rows.findIndex((x) => x.run === run.run) : -1; if (i >= 0) { place = { rank: i + 1, players: t.players, today: run.day === new Date().toISOString().slice(0, 10) }; run.name = t.rows[i].name || run.name; /* the name the player plays as now, as the board and the Telegram post show it */ } }
      const png = await render(popCard(run, place, await posterUri()));
      const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
      ctx.waitUntil(caches.default.put(key, res.clone()));
      return res;
    }
    // THE BRAIN BOARD CARD (2026-10-24): /board.png with the board's figures; 15 minutes at the edge, so they stay fresh
    if (/^\/(?:og\/)?board\.png$/.test(url.pathname)) {
      const key = new Request('https://og.brainonbnb.com/board.png');
      const hit = await caches.default.match(key);
      if (hit) return hit;
      const get = (u) => fetch(u, { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [b, a] = await Promise.all([get('https://agent.brainonbnb.com/board?limit=1'), get('https://agent.brainonbnb.com/board/active')]);
      const png = await render(boardCard(b, a));
      const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${b ? 900 : 120}`, 'access-control-allow-origin': '*' } });
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
