#!/usr/bin/env node
// scripts/pool-scan-indexed-check.mjs — a PancakeSwap pool quoted in CAKE, SOL, ETC… is measured, not sent "elsewhere" (2026-10-18)
//
// /stats/detail of 17.10.: 69 of ~114 outside pool scans (nearly all one trading bot) ended 'elsewhere'. A sample of
// 44 listed BSC tokens put 15 there, most on a PancakeSwap pool the factories were never asked about, because
// discover() only pairs a token with BNB and the four stablecoins. indexedPool() takes the pair the index ranks
// deepest, asks the chain what it is, and prices its quote through the quote's own deepest pool (priceQuote, at least
// $1,000 on the hard side). This checks, on the live route, tokens whose market is such a pool: quotable, the pool
// named, the quote's pricing pool stated, and the price within 10% of the index's (an independent figure, not ours).
//
//   node scripts/pool-scan-indexed-check.mjs [base]     (default https://brainonbnb.com)   exit 1 on any FAIL
import { ownTestHeaders } from './lib/own-test-headers.mjs';
const OWN = ownTestHeaders();   // our checks are not callers: uncounted against the 50 free scans a day
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
// token, the quote its main pool trades against, and its kind — PancakeSwap V2 and V3 both, each found 18.10.
const CASES = [
  ['0x24cefa61d9b075e42f0c1e16cf93fd78f0000000', 'Cake', 'v2'],  // AMU, ~$260k of CAKE in a V2 pair
  ['0x3f2b2f9eab97abdf5a46dfc1b5a6b0679527202b', 'Cake', 'v3'],  // SIRPANCAKE, CAKE V3
  ['0x6ff45323817d1d53bbb8a8dfba9245ae74057777', 'GMEB', 'v2'],  // memestock, priced through GMEB's USDT V3 pool
  ['0x4af9b7e850441240e41bab65af30a117e6777777', 'SOL', 'v3'],   // 索拉拉, SOL V3; SOL's V2 BNB pair is a side pocket
];
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
for (const [token, quote, kind] of CASES) {
  // As the site's own page asks: the reading alone, and not counted as an outside scan.
  const j = await (await fetch(`${BASE}/api/pool-scan?address=${token}&r=${Date.now()}`, { headers: { ...OWN, accept: 'application/json', referer: 'https://brainonbnb.com/scanner' }, signal: AbortSignal.timeout(90000) })).json().catch(() => null);
  const ds = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`)).json().catch(() => null);
  const idx = (ds?.pairs || []).find((p) => p.chainId === 'bsc' && p.pairAddress?.toLowerCase() === j?.pool?.address?.toLowerCase());
  const label = `${j?.symbol || token.slice(0, 10)} (${quote} ${kind})`;
  if (!j?.quotable) { check(false, `${label}: measured`, (j?.reason || j?.error || 'no answer').slice(0, 110)); continue; }
  check(j.price?.quoteSymbol?.toLowerCase() === quote.toLowerCase() && j.pool?.kind === kind && /^PancakeSwap/.test(j.pool?.venue || ''),
    `${label}: measured in its PancakeSwap pool`, `${j.pool?.venue} ${j.pool?.kind} · ${j.price?.quoteSymbol}, $${j.pool?.liquidityUsd} hard side`);
  const via = j.price?.quotePricedVia;
  check(!!via && /^0x[0-9a-f]{40}$/i.test(via.pair) && via.hardSideUsd >= 1000, `${label}: the quote's pricing pool is stated`, via ? `${via.name} $${via.hardSideUsd}` : 'missing');
  const off = idx?.priceUsd ? Math.abs(j.price.usd / Number(idx.priceUsd) - 1) : null;
  check(off != null && off < 0.10, `${label}: price within 10% of the index`, off == null ? 'index has no figure for this pool' : `${j.price.usd.toPrecision(4)} vs ${Number(idx.priceUsd).toPrecision(4)} (${(off * 100).toFixed(1)}%)`);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
