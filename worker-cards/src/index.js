// BOBAI CARDS — the share-preview images of the Brain Terminal, drawn by the server from live data.
//
// When someone shares a moment from brainonbnb.com, X / Telegram / WhatsApp fetch a link and show the
// og:image under it. That image used to exist only in the sharer's browser (terminal.js makeCard()), so a
// shared LINK had no picture. Here the same card is drawn on request from the same public sources.
//
// OWNER DECISION 2026-09-26: the card is drawn by the server, never uploaded. Nobody can make an image appear
// under our domain — there is no upload route, no user text is ever rendered, the motif is one of five fixed
// words, and every number comes from our logs or the chain. That is the whole security model; keep it so.
//
// ROUTES (behind brainonbnb.com/m/*, proxied by the dashboard worker; paths are the public ones)
//   GET /m/<motif>.png       1600x900  (X, OG)          motif: now | burn | liq | day | week
//   GET /m/<motif>-tall.png  1080x1350 (phone feeds)
//   GET /m/<motif>[-tall]    tiny HTML: the OG/Twitter tags for crawlers, then on to the page for people
//
// CACHING
// Keyed by the data version: last burn + last liquidity add + the ten-minute bucket. A new burn shows at once;
// price and queue may be ten minutes old, which is also how often the candles move. Two layers: this isolate's
// memory (works everywhere, also on workers.dev where the Cache API is a no-op) and caches.default (works on a
// zone route / custom domain). A card with a dropped element (a read failed) is served but never stored, so
// the next request tries the read again instead of pinning a poorer card for ten minutes.
//
// PROXY (dashboard/_worker.js, early in fetch; the zone cache there is the real ten-minute cache):
//   if (url.pathname.startsWith('/m/')) {
//     const png = url.pathname.endsWith('.png') && request.method === 'GET';
//     if (png) { const hit = await caches.default.match(request); if (hit) return hit; }
//     const r = await fetch('https://bobai-cards.bobbuildonbnb.workers.dev' + url.pathname + url.search, { method: request.method });
//     const res = new Response(r.body, r);
//     if (png && r.ok) ctx.waitUntil(caches.default.put(request, res.clone()));
//     return res;
//   }
//
// COST: one render is ~1-2 s of CPU in resvg-wasm (Workers Paid: 30 s limit). Blur filters are the expensive
// part — the frame glow was one and cost 1.8 s alone, it is stacked strokes now. Keep new effects blur-free.

import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import inter500 from '../fonts/inter-500.ttf';
import inter700 from '../fonts/inter-700.ttf';
import sg600 from '../fonts/spacegrotesk-600.ttf';
import sg700 from '../fonts/spacegrotesk-700.ttf';
import logo from '../img/logo.png';
import pIdle from '../img/idle.png';
import pGiggle from '../img/giggle.png';
import pLiq from '../img/liq.png';
import pBurn from '../img/burn.png';
import pBurnSmall from '../img/burn-small.png';
import pBurnNice from '../img/burn-nice.png';
import pBurnBig from '../img/burn-big.png';
import pBurnMega from '../img/burn-mega.png';
import pBurnApoc from '../img/burn-apocalypse.png';
import pBurnNova from '../img/burn-supernova.png';
import { readLogs, readState, dataVersion } from './data.js';
import { ensureWasm, renderCard, pickMotif } from './render.js';
import { metaOf, SIZES } from './card.js';

const SITE = 'https://brainonbnb.com';
const PAGE = SITE + '/'; // where a person lands after the crawler has read the tags
const ASSETS = {
  fonts: [inter500, inter700, sg600, sg700], logo,
  poses: { idle: pIdle, giggle: pGiggle, liq: pLiq, burn: pBurn, 'burn-small': pBurnSmall, 'burn-nice': pBurnNice, 'burn-big': pBurnBig, 'burn-mega': pBurnMega, 'burn-apocalypse': pBurnApoc, 'burn-supernova': pBurnNova },
};
// the logs are small and written at most every few minutes; the edge may hold them a minute
const FETCH = { cf: { cacheTtl: 60, cacheEverything: true } };
const ROUTE = /^\/m\/(now|burn|liq|day|week)(-tall)?(\.png)?\/?$/;

// isolate memory: a handful of PNGs (~0.7 MB each), newest kept; plus the renders in flight, so a burst of
// crawlers for the same card (X fetches it several times per post) costs one render, not five
const MEM = new Map(), INFLIGHT = new Map(), MEM_MAX = 12;
const remember = (k, v) => { MEM.set(k, v); while (MEM.size > MEM_MAX) MEM.delete(MEM.keys().next().value); };

async function png(k, fmt, ctx) {
  const logs = await readLogs(FETCH);
  const ver = dataVersion(logs), key = `${k}-${fmt}-${ver}`;
  if (MEM.has(key)) return { body: MEM.get(key), ver, stored: true };
  const cacheKey = new Request(`${SITE}/m/__cards/${key}.png`);
  const hit = await caches.default.match(cacheKey).catch(() => null);
  if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); remember(key, b); return { body: b, ver, stored: true }; }
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const job = (async () => {
    await ensureWasm(wasm);
    const S = await readState(FETCH, logs);
    const r = renderCard(S, k, fmt, ASSETS);
    if (r.complete) {
      remember(key, r.png);
      ctx.waitUntil(caches.default.put(cacheKey, new Response(r.png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' } })).catch(() => {}));
    }
    return { body: r.png, ver, stored: r.complete };
  })().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, job);
  return job;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function page(k, fmt) {
  const logs = await readLogs(FETCH), ver = dataVersion(logs), now = Date.now();
  // the tags describe the moment the image will show: same fallback to 'now' when that moment has no record
  const S = await readState(FETCH, logs), pick = pickMotif(k, S, now), m = pick.m;
  const { title, description } = metaOf(m);
  const [w, h] = SIZES[fmt], img = `${SITE}/m/${pick.k}${fmt === 'tall' ? '-tall' : ''}.png?v=${ver}`;
  const url = `${SITE}/m/${pick.k}${fmt === 'tall' ? '-tall' : ''}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="$BOBAI · Brain On BNB AI">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${img}"><meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${w}"><meta property="og:image:height" content="${h}">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@BrainOnBNB">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0;url=${PAGE}">
<style>body{background:#0c0b0c;color:#eceaf5;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#F0B90B}</style>
</head><body><p><a href="${PAGE}">Open the $BOBAI Brain Terminal</a></p>
<script>location.replace(${JSON.stringify(PAGE)})</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-robots-tag': 'noindex' } });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    const u = new URL(req.url), r = u.pathname.match(ROUTE);
    if (!r) return Response.redirect(PAGE, 302);
    const [, k, tall, isPng] = r, fmt = tall ? 'tall' : 'wide';
    try {
      if (!isPng) return await page(k, fmt);
      const { body, stored } = await png(k, fmt, ctx);
      return new Response(req.method === 'HEAD' ? null : body, { headers: {
        'content-type': 'image/png', 'content-length': String(body.length),
        // a degraded card (a read failed) is only held a minute so the full one replaces it soon
        'cache-control': stored ? 'public, max-age=600' : 'public, max-age=60',
        'access-control-allow-origin': '*',
      } });
    } catch (e) {
      // no half-drawn picture and no stack trace to a crawler; a short-lived error it will retry
      console.error('card', k, fmt, e?.stack || e);
      return new Response('card unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
    }
  },
};
