#!/usr/bin/env node
// scripts/pool-scan-infinity-check.mjs — a token whose market is a PancakeSwap Infinity CL pool is measured there (2026-10-19)
//
// The sample of 18.10. put the last "elsewhere" scans on Pancake Infinity CL pools (GWEI: $907k there, the scan read a
// $28k Uniswap pool), and the indexes miss many of them (DNA's $1.7M, KII's and AEON's $1M were in neither). The scan
// now finds a token's Infinity pools from their keys on chain (infinityFind: keccak256 of the PoolKey over the
// hook/fee/parameter combinations in use), sizes them with PancakeSwap's Infinity quoter, and prices every trade size
// through that quoter, hook included. This checks, on the live route: each token below is quotable on an Infinity CL
// pool, names its hook and its quoter, has a full cost ladder and a 1% depth, and its price is within 10% of the
// index's (an independent figure). CAKE and BOBAI keep their V2 pools. Offline first: the id this code derives for
// GWEI/USDT's key is the pool's real id.
//
//   node scripts/pool-scan-infinity-check.mjs [base]     (default https://brainonbnb.com)   exit 1 on any FAIL
import { registerHooks } from 'node:module';
import { ownTestHeaders } from './lib/own-test-headers.mjs';
registerHooks({ load(url, c, n) { return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? n(url, { ...c, format: 'module' }) : n(url, c); } });
const OWN = ownTestHeaders();   // our checks are not callers: uncounted against the 50 free scans a day
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

{
  const m = await import(new URL('../dashboard/scanner-chain.js', import.meta.url).href);
  const id = typeof m.infPoolId === 'function'
    ? m.infPoolId('0x30117e4bc17d7b044194b76a38365c53b72f7d49', '0x55d398326f99059ff775485246999027b3197955', '0x72e09ebd9b24f47730b651889a4ed984cba53d90', 67, 0x0a0055)
    : null;
  check(id === '0x473e34fad874524a146022cfd7c9df2af73988adeea0f21629dbb8c301305a17', 'offline: the id derived from GWEI/USDT\'s key is its pool id', String(id));
}

const INF = [
  ['0x30117e4bc17d7b044194b76a38365c53b72f7d49', 'GWEI', 'USDT'],
  ['0xa991f61940095aea0724ef54077223b048c5cf7b', 'DNA', 'USDT'],      // in no index on 19.10.
  ['0xeec6574eabba52bac3f0277f2cd5ac7e67197886', 'KII', 'USDT'],      // in no index; read a $179 Uniswap pool before
  ['0x277add739c6e0477616948357af9e79fe1ec9b80', 'AEON', 'USDT'],     // GoPlus listed its $1M pool at $127; 8 decimals
  ['0x4b3d30992f003c8167699735f5ab2831b2a087d3', 'COLLECT', 'BNB'],   // against native BNB (currency 0x0)
];
const scan = async (t) => (await fetch(`${BASE}/api/pool-scan?address=${t}&r=${Date.now()}`, { headers: { ...OWN, accept: 'application/json' }, signal: AbortSignal.timeout(120000) })).json().catch(() => null);
for (const [t, name, quote] of INF) {
  const j = await scan(t);
  const p = j?.pool || {};
  check(j?.quotable === true && p.kind === 'inf' && p.venue === 'PancakeSwap Infinity CL', `${name}: measured on its Infinity CL pool`, j?.quotable ? `${p.venue} ${p.kind} ${String(p.address).slice(0, 12)}` : (j?.reason || j?.error || 'no answer').slice(0, 140));
  if (p.kind !== 'inf') continue;
  check(j.price?.quoteSymbol === quote && /^0x[0-9a-f]{64}$/.test(p.poolId || '') && /CLQuoter 0x/.test(p.quotedBy || '') && 'hooks' in p, `${name}: quoted in ${quote}, pool id, quoter and hook named`, `${j.price?.quoteSymbol} hook ${p.hooks}`);
  const rows = j.tradeCost || [];
  check(rows.length === 6 && rows.every((r) => r.buyCostPct > 0 && r.sellCostPct > 0 && r.buyCostPct < 50 && r.sellCostPct < 50), `${name}: a cost for every size, each way`, rows.map((r) => `${r.sizeUsd}:${r.buyCostPct}/${r.sellCostPct}`).join(' '));
  check(rows.every((r, i) => !i || r.buyCostPct >= rows[i - 1].buyCostPct - 0.002), `${name}: a larger buy never costs less`);
  check(j.onePercentDepth?.buyUsd > 0 && j.onePercentDepth?.sellUsd > 0, `${name}: the 1% depth each way`, `${j.onePercentDepth?.buyUsd} / ${j.onePercentDepth?.sellUsd}`);
  const ds = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t}`)).json().catch(() => null);
  const ref = (ds?.pairs || []).filter((x) => x.chainId === 'bsc' && x.priceUsd).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const dev = ref ? Math.abs(j.price.usd / Number(ref.priceUsd) - 1) : null;
  check(dev == null || dev < 0.1, `${name}: price within 10% of the index's`, dev == null ? 'no index price to compare' : `${j.price.usd.toPrecision(5)} vs ${Number(ref.priceUsd).toPrecision(5)} (${(dev * 100).toFixed(1)}%)`);
}
for (const [t, name] of [['0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', 'CAKE'], ['0x245c386dcfed896f5c346107596141e5edcbffff', 'BOBAI']]) {
  const j = await scan(t);
  check(j?.quotable === true && j.pool?.kind === 'v2' && j.pool?.venue === 'PancakeSwap V2', `${name}: keeps its PancakeSwap V2 pool`, `${j?.pool?.venue} ${j?.pool?.kind}`);
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
