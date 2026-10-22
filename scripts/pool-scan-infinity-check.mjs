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
const OWN = ownTestHeaders();   // our checks are not callers: uncounted against the 1,000 free scans a day
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

{
  const m = await import(new URL('../dashboard/scanner-chain.js', import.meta.url).href);
  const id = typeof m.infPoolId === 'function'
    ? m.infPoolId('0x30117e4bc17d7b044194b76a38365c53b72f7d49', '0x55d398326f99059ff775485246999027b3197955', '0x72e09ebd9b24f47730b651889a4ed984cba53d90', 67, 0x0a0055)
    : null;
  check(id === '0x473e34fad874524a146022cfd7c9df2af73988adeea0f21629dbb8c301305a17', 'offline: the id derived from GWEI/USDT\'s key is its pool id', String(id));

  // THE TAX THROUGH THE VAULT (2026-10-19), on a made-up chain: none of the 106 tokens in the largest Infinity pools
  // carries a transfer tax, so a taxed trade is built here. A buy the pool paid out as 100 arrives as 97 (3 to a tax
  // wallet); a sell sends 100 of which the Vault gets 95; a transaction with a second Infinity swap in it — the Vault
  // is everybody's — must be skipped, or its unrelated transfer would read as a 50% tax.
  const PM = '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b', VAULT = '0x238a358808379702088667322f80ac48bad5e6c4';
  const SWAP = '0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237', XFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const TOK = '0x1111111111111111111111111111111111111111', POOL = '0x' + 'ab'.repeat(32), OTHER = '0x' + 'cd'.repeat(32);
  const w = (v) => (BigInt.asUintN(256, BigInt(v))).toString(16).padStart(64, '0'), t = (a) => '0x' + a.slice(2).padStart(64, '0');
  const E = 10n ** 18n, buyer = '0x' + '22'.repeat(20), seller = '0x' + '33'.repeat(20), taxw = '0x' + '44'.repeat(20);
  const swap = (id, a0, tx) => ({ address: PM, topics: [SWAP, id, t(buyer)], data: '0x' + w(a0) + w(0) + w(0) + w(0) + w(0) + w(0) + w(0), transactionHash: tx, logIndex: '0x0' });
  const xf = (from, to, v, i) => ({ address: TOK, topics: [XFER, t(from), t(to)], data: '0x' + w(v), logIndex: '0x' + i.toString(16) });
  const TX = {
    '0x01': [swap(POOL, 100n * E, '0x01'), xf(VAULT, buyer, 97n * E, 1), xf(VAULT, taxw, 3n * E, 2)],
    '0x02': [swap(POOL, -95n * E, '0x02'), xf(seller, VAULT, 95n * E, 1), xf(seller, taxw, 5n * E, 2)],
    '0x03': [swap(POOL, 100n * E, '0x03'), swap(OTHER, 5n * E, '0x03'), xf(VAULT, buyer, 50n * E, 1)],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const ask = JSON.parse(init.body), one = (q) => {
      if (q.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: q.id, result: '0x3e8' };
      if (q.method === 'eth_getLogs') return { jsonrpc: '2.0', id: q.id, result: q.params[0].topics?.[1] === POOL ? Object.values(TX).map((l) => l[0]) : [] };
      if (q.method === 'eth_getTransactionReceipt') return { jsonrpc: '2.0', id: q.id, result: { logs: TX[q.params[0]] || [] } };
      if (q.method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id: q.id, result: { timestamp: '0x0' } };
      return { jsonrpc: '2.0', id: q.id, result: '0x' };
    };
    return new Response(JSON.stringify(Array.isArray(ask) ? ask.map(one) : one(ask)), { headers: { 'content-type': 'application/json' } });
  };
  let tx;
  try { tx = await m.measureTax(TOK, POOL, true, 'inf'); } finally { globalThis.fetch = realFetch; }
  check(tx?.ok && Math.abs(tx.buy - 0.03) < 1e-9, 'offline: a 3% buy tax is read through the Vault', JSON.stringify(tx && { ok: tx.ok, buy: tx.buy, n: tx.nBuy, reason: tx.reason }));
  check(tx?.ok && Math.abs(tx.sell - 0.05) < 1e-9, 'offline: a 5% sell tax is read through the Vault', JSON.stringify(tx && { sell: tx.sell, n: tx.nSell }));
  check(tx?.nBuy === 1, 'offline: a transaction with a second Infinity swap is skipped, not read as a 50% tax', JSON.stringify(tx?.spread));
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
  check(j.tax?.buySource === 'measured' || j.tax?.sellSource === 'measured' || /has not traded/.test(j.tax?.reason || ''), `${name}: the tax is measured from its own trades through the Vault`, `${j.tax?.buyPct}%/${j.tax?.sellPct}% · ${j.tax?.source} · trades ${JSON.stringify(j.tax?.tradesMeasured || null)}`);
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
