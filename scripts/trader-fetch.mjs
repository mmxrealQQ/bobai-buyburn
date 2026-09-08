#!/usr/bin/env node
// Hourly closes for the four legs of the trading agent, one file, in USD:
// BNB/USDT and CAKE/BNB from Binance spot (public klines, no key), BOB/BNB
// and BOBAI/BNB from their PancakeSwap V2 pools via GeckoTerminal (the only
// hourly history those two have). Written to data/trader/prices.json with
// the source and the fetch time; the backtest reads that file and nothing
// live, so a run is repeatable.
//   node scripts/trader-fetch.mjs            last ~41 days (1000 hours)
//   node scripts/trader-fetch.mjs --hours 4320   six months, paged (Binance: endTime; Gecko: before_timestamp)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'trader', 'prices.json');
const hi = process.argv.indexOf('--hours');
const H = hi > 0 ? Number(process.argv[hi + 1]) : 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function binance(symbol) {
  const out = []; let endTime = Date.now();
  while (out.length < H) {
    const lim = Math.min(1000, H - out.length);
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${lim}&endTime=${endTime}`);
    if (!r.ok) throw new Error(`${symbol}: ${r.status}`);
    const page = (await r.json()).map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] }));
    if (!page.length) break;
    out.unshift(...page); endTime = page[0].t - 1;
    if (page.length < lim) break;
    await sleep(250);
  }
  return out;
}
async function gecko(pool) {
  const out = []; let before = Math.floor(Date.now() / 1000);
  while (out.length < H) {
    const lim = Math.min(1000, H - out.length);
    let r = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      r = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pool}/ohlcv/hour?limit=${lim}&currency=usd&before_timestamp=${before}`, { headers: { accept: 'application/json' } });
      if (r.status !== 429) break;
      await sleep(20000 * (attempt + 1));   // the free tier throttles; wait it out rather than guess
    }
    if (!r.ok) throw new Error(`${pool}: ${r.status}`);
    const j = await r.json();
    const page = j.data.attributes.ohlcv_list.map((k) => ({ t: k[0] * 1000, o: k[1], h: k[2], l: k[3], c: k[4], v: k[5] })).sort((a, b) => a.t - b.t);
    if (!page.length) break;
    out.unshift(...page); before = Math.floor(page[0].t / 1000) - 1;
    if (page.length < lim) break;
    await sleep(1500);   // GeckoTerminal's free tier: ~30 calls a minute
  }
  return out;
}
const bnb = await binance('BNBUSDT');
const cakeBnb = await binance('CAKEBNB');
const bob = await gecko('0x3c79593e01A7f7FeD5d0735B16621e2D52A6bC58');
const bobai = await gecko('0x6eadd4cb786898b34929444988380ed0cc6fd9a6');
const bnbAt = new Map(bnb.map((k) => [k.t, k.c]));
// Every leg priced in USD and in BNB, on the same hourly grid.
const series = {
  BNB: { pair: 'BNB/USDT', source: 'binance spot 1h', usd: bnb.map((k) => [k.t, k.c]) },
  CAKE: { pair: 'CAKE/BNB', source: 'binance spot 1h', bnb: cakeBnb.map((k) => [k.t, k.c]), usd: cakeBnb.filter((k) => bnbAt.has(k.t)).map((k) => [k.t, k.c * bnbAt.get(k.t)]) },
  BOB: { pair: 'BOB/BNB', source: 'geckoterminal pool 0x3c79 (V2) 1h', usd: bob.map((k) => [k.t, k.c]), bnb: bob.filter((k) => bnbAt.has(k.t)).map((k) => [k.t, k.c / bnbAt.get(k.t)]) },
  BOBAI: { pair: 'BOBAI/BNB', source: 'geckoterminal pool 0x6ead (V2) 1h', usd: bobai.map((k) => [k.t, k.c]), bnb: bobai.filter((k) => bnbAt.has(k.t)).map((k) => [k.t, k.c / bnbAt.get(k.t)]) },
};
fs.writeFileSync(OUT, JSON.stringify({ fetched_at: new Date().toISOString(), hours: H, series }, null, 1));
for (const [k, s] of Object.entries(series)) console.log(k.padEnd(6), s.pair.padEnd(10), 'usd points', s.usd.length, 'from', new Date(s.usd[0][0]).toISOString().slice(0, 13), 'to', new Date(s.usd[s.usd.length - 1][0]).toISOString().slice(0, 13), 'last', s.usd[s.usd.length - 1][1]);
