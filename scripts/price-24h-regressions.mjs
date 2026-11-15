#!/usr/bin/env node
// /api/price carries the last 24 hours from our own Swap ledger (2026-11-15). Offline: the ledger is faked.
//   node scripts/price-24h-regressions.mjs      (self-tests.mjs runs it as it is)
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    return /\/(dashboard|shared)\/(?:i18n\/)?[^/]+\.js$/.test(url) ? nextLoad(url, { ...context, format: 'module' }) : nextLoad(url, context);
  },
});
const ROOT = path.resolve(import.meta.dirname, '..');
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

const now = Date.now(), H = 3600000;
let ledger = null, slow = false;
globalThis.fetch = async (u) => {
  if (String(u).startsWith('https://bobai-tg-bot.bobbuildonbnb.workers.dev/candles')) {
    if (slow) await new Promise((r) => setTimeout(r, 2500));
    return ledger ? new Response(JSON.stringify(ledger)) : new Response('down', { status: 503 });
  }
  throw new Error('offline test: no network (' + String(u).slice(0, 60) + ')');
};
const W = await import(pathToFileURL(path.join(ROOT, 'dashboard/_worker.js')).href);
ok('market24h is exported', typeof W.market24h === 'function');
if (typeof W.market24h !== 'function') { console.log('\nprice-24h: FAIL'); process.exit(1); }

// 25 hours of candles: price 1e-7 BNB at $600 a day ago; two buys of 0.5 BNB and one sell of 1 BNB inside the day
const row = (t, c, u, b = 0, s = 0, bb = 0, sb = 0) => ({ t, c, u, v: bb + sb, b, s, bb, sb });
ledger = { minutes: 10, rows: [row(now - 25 * H, 1e-7, 600), row(now - 24.1 * H, 1e-7, 600), row(now - 10 * H, 1.1e-7, 600, 2, 0, 1, 0), row(now - 1 * H, 1.2e-7, 600, 0, 1, 0, 1)] };
const priceNow = 1.2e-7 * 600;
const m = (await W.market24h(priceNow, { fresh: true })).market_24h;
ok('change against the candle a day ago (+20 %)', m?.change_pct === 20, JSON.stringify(m));
ok('volume in USD is the BNB volume at its minute\'s BNB price ($1,200)', m?.volume_usd === 1200, m?.volume_usd);
ok('buys and sells counted (2 / 1)', m?.buys === 2 && m?.sells === 1);
ok('buy and sell volume apart ($600 / $600)', m?.buy_volume_usd === 600 && m?.sell_volume_usd === 600);
ok('the source is named', /candles/.test(m?.source || ''));

ledger = null;
ok('ledger down: nothing added', JSON.stringify(await W.market24h(priceNow, { fresh: true })) === '{}');
ledger = { minutes: 10, rows: [row(now - 30 * H, 1e-7, 600), row(now - 1 * H, 1.2e-7, 600)] };
ok('no candle near 24 h ago (gap over an hour): nothing added, no made-up change', JSON.stringify(await W.market24h(priceNow, { fresh: true })) === '{}');
slow = true; ledger = { minutes: 10, rows: [row(now - 24.1 * H, 1e-7, 600), row(now - H, 1.2e-7, 600)] };
const t0 = Date.now(); const r = await W.market24h(priceNow, { fresh: true });
ok('a slow ledger costs the price at most ~1.5 s and adds nothing', Date.now() - t0 < 2200 && JSON.stringify(r) === '{}', `${Date.now() - t0} ms`);

console.log(`\nprice-24h: ${fails ? fails + ' FAIL' : 'all pins hold'}`);
process.exit(fails ? 1 : 0);
