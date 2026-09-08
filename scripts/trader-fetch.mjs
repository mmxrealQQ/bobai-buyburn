#!/usr/bin/env node
// Hourly closes for the four legs of the trading agent, one file, in USD:
// BNB/USDT and CAKE/BNB from Binance spot (public klines, no key), BOB/BNB
// and BOBAI/BNB from their PancakeSwap V2 pools via GeckoTerminal (the only
// hourly history those two have). Written to data/trader/prices.json with
// the source and the fetch time; the backtest reads that file and nothing
// live, so a run is repeatable.
//   node scripts/trader-fetch.mjs            last ~41 days (1000 hours)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'trader', 'prices.json');
const H = 1000;
async function binance(symbol) {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${H}`);
  if (!r.ok) throw new Error(`${symbol}: ${r.status}`);
  return (await r.json()).map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] }));
}
async function gecko(pool) {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pool}/ohlcv/hour?limit=${H}&currency=usd`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${pool}: ${r.status}`);
  const j = await r.json();
  return j.data.attributes.ohlcv_list.map((k) => ({ t: k[0] * 1000, o: k[1], h: k[2], l: k[3], c: k[4], v: k[5] })).sort((a, b) => a.t - b.t);
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
