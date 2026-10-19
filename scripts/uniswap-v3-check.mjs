#!/usr/bin/env node
// scripts/uniswap-v3-check.mjs — a token whose market is a Uniswap V3 pool on BNB Chain is measured (2026-10-18)
//
// The pool scan read PancakeSwap (V2 + V3), Uniswap V2 and Biswap; a Uniswap V3 pool was "elsewhere … not measured
// here", and a pasted one was refused as "not a PancakeSwap pool". Now discover({uniswap}) asks Uniswap's V3 factory
// (0xdb1d…61f7, checked on chain), the depth and cost are quoted by Uniswap's own QuoterV2 and the sell test runs through
// its SwapRouter02. This checks, live: a token whose readable market is a Uniswap V3 pool is quotable there; that pool's
// factory() is Uniswap's (asked here independently); the price agrees with the index within 10%; the sell test ran
// through Uniswap's router; a pasted Uniswap V3 pool is scanned, not refused; PancakeSwap's own pools are unchanged.
//
//   node scripts/uniswap-v3-check.mjs [base]     (default https://brainonbnb.com)   exit 1 on any FAIL
import { ownTestHeaders } from './lib/own-test-headers.mjs';
const OWN = ownTestHeaders();   // our checks are not callers: uncounted against the 50 free scans a day
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const UNI = '0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7';
// BTW/USDT 0.3% (~$369k), 72% of BTW's liquidity on 19.10. — the first pin, 贵州茅台, thinned out to ~$12k over five
// pools and its Uniswap pool fell under the 25% share rule, a market change and not a fault (ZEC/USDT, 41%, would do too)
const TOKEN = '0x444045b0ee1ee319a660a5e3d604ca0ffa35acaa';   // BTW: its deepest readable pool is Uniswap V3
const PASTED = '0xf7b5a9b7ef764606f900c9c1db39afc682049bc4';  // BTW/USDT, Uniswap V3 (a pasted pool is still held to the 25% share rule)
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + String(detail).slice(0, 150) : ''}`); };
const scan = async (a) => (await fetch(`${BASE}/api/pool-scan?address=${a}&r=${Date.now()}`, { headers: { ...OWN, accept: 'application/json', referer: 'https://brainonbnb.com/scanner' }, signal: AbortSignal.timeout(90000) })).json().catch(() => ({}));
const factoryOf = async (pool) => '0x' + ((await (await fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: pool, data: '0xc45a0155' }, 'latest'] }) })).json()).result || '').slice(-40);

{
  const j = await scan(TOKEN);
  check(j.quotable && j.pool?.venue === 'Uniswap V3', 'a token whose market is a Uniswap V3 pool is measured there', j.pool ? `${j.pool.venue} ${j.pool.address}` : (j.reason || j.error || '').slice(0, 110));
  if (j.pool?.address) {
    check((await factoryOf(j.pool.address)) === UNI, 'that pool\'s factory() is Uniswap\'s (asked here)');
    const ds = await (await fetch(`https://api.dexscreener.com/latest/dex/pairs/bsc/${j.pool.address}`)).json().catch(() => ({}));
    const px = Number((ds.pairs || [ds.pair])[0]?.priceUsd);
    check(px > 0 && Math.abs(j.price.usd / px - 1) < 0.10, 'the price agrees with the index within 10%', `${j.price.usd?.toPrecision(4)} vs ${px?.toPrecision(4)}`);
    const sim = j.sellability || {};
    check(/Uniswap V3/.test(sim.venue || '') || /Uniswap/.test(sim.source || ''), 'the sell test ran through Uniswap\'s router', `${sim.venue || ''} ${String(sim.source || sim.reason || '').slice(0, 80)}`);
    check(j.onePercentDepth?.buyUsd > 0, 'the 1% depth was quoted by Uniswap\'s quoter', j.onePercentDepth?.buyUsd);
  }
}
{
  const j = await scan(PASTED);
  check(j.quotable && j.pool?.venue === 'Uniswap V3' && !/neither a PancakeSwap|not a PancakeSwap pool/.test(j.error || ''), 'a pasted Uniswap V3 pool is scanned, not refused', j.pool ? `${j.pool.venue} ${j.price?.quoteSymbol}` : (j.error || j.reason || '').slice(0, 110));
}
{
  const j = await scan(CAKE);
  check(j.quotable && /^PancakeSwap/.test(j.pool?.venue || ''), 'CAKE is still measured in its PancakeSwap pool', j.pool?.venue);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
