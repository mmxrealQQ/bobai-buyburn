#!/usr/bin/env node
// Does the sell simulation say "sellable" only when a sell really goes through?
//
// The scanner's sell test (dashboard/scanner-chain.js, simulateRoundTrip) is
// the one chip a buyer will act on, so it is pinned in both directions here:
//   · the keccak it uses to find storage slots matches the known vector,
//   · two tokens everybody can sell come back sellable,
//   · the same call with the allowance withheld comes back NOT sellable, with
//     the router's own reason — proof that a revert is seen as a revert and
//     never read as "fine",
//   · the tax the probe reads is pinned both ways: the arithmetic from what
//     arrived returns 3% for a 3% token and 0% for a clean one, and live the
//     probe reads BOBAI at 3% and CAKE at 0%.
// Run: node scripts/sell-sim-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchDir } from './lib/scratch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const stage = scratchDir('sellsim-');
fs.writeFileSync(path.join(stage, 'scanner-chain.mjs'), fs.readFileSync(path.join(ROOT, 'dashboard', 'scanner-chain.js'), 'utf8'));
const C = await import('file://' + path.join(stage, 'scanner-chain.mjs').split(path.sep).join('/'));

let failed = 0;
const ok = (name, pass, detail) => { if (!pass) failed += 1; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// The error classifier, both ways: a revert is a verdict, a refusal is not.
ok('a router revert counts as a revert', C.isRevert({ code: 3, message: 'execution reverted: TransferHelper: TRANSFER_FROM_FAILED' }));
ok('a revert carrying only data counts as a revert', C.isRevert({ message: 'x', data: '0x08c379a0' + '0'.repeat(64) }));
ok('a rate limit is NOT a revert', !C.isRevert({ code: -32005, message: 'rate limit exceeded' }));
ok('a timeout is NOT a revert', !C.isRevert({ message: 'request timed out' }));
ok('an unsupported override is NOT a revert', !C.isRevert({ code: -32602, message: 'invalid argument 2: json: cannot unmarshal' }));
ok('keccak256 of the empty string matches the known vector',
  C.keccakHex('') === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');

// The tax arithmetic, without a node: a pair holding 1e24 tokens and 1e21
// WBNB is sold 1e21 tokens; when 97% of them arrive the inverse must say 3%,
// and when all of them arrive it must say 0%. A function that returned 0% for
// both would pass every "sellable" check above and be worthless.
{
  const rTok = 10n ** 24n, rQ = 10n ** 21n, amount = 10n ** 21n;
  const out = (arrived) => (arrived * 9975n * rQ) / (rTok * 10000n + arrived * 9975n);
  const t3 = C.sellTaxFromReceived(rTok, rQ, amount, out((amount * 97n) / 100n));
  const t0 = C.sellTaxFromReceived(rTok, rQ, amount, out(amount));
  ok('a 3% tax is read as 3% from what arrived', t3 != null && Math.abs(t3 - 0.03) < 0.0005, String(t3));
  ok('a clean token is read as 0%', t0 != null && Math.abs(t0) < 0.0005, String(t0));
  ok('a received amount the pool could not pay is not a tax', C.sellTaxFromReceived(rTok, rQ, amount, rQ) == null);
}

const PAIRS = [
  ['BOBAI', '0x245c386dcfed896f5c346107596141e5edcbffff', '0x6eadd4cb786898b34929444988380ed0cc6fd9a6'],
  ['CAKE', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', '0x0ed7e52944161450477ee417de9cd3a859b14fd0'],
];
for (const [name, token, pair] of PAIRS) {
  const t0 = await C.rpcBatch([C.call(pair, C.SEL.token0)]);
  const r = await C.simulateRoundTrip(token, pair, C.addrAt(t0[0]) === token, 'v2');
  ok(`${name}: the simulation ran`, r.ok, r.reason);
  ok(`${name}: a sell goes through`, r.ok && r.sellable === true, r.sell_error);
  ok(`${name}: a buy goes through`, r.ok && r.buyable === true, r.buy_error);
  // The probe's reading of the tax, live. BOBAI charges 3% each way, CAKE
  // nothing: two different answers from the same code, or it measured nothing.
  const want = name === 'BOBAI' ? 3 : 0;
  ok(`${name}: the simulated sell tax reads ${want}%`, r.tax && r.tax.sell_pct != null && Math.abs(r.tax.sell_pct - want) < 0.3, JSON.stringify(r.tax));
  ok(`${name}: the simulated buy tax reads ${want}%`, r.tax && r.tax.buy_pct != null && Math.abs(r.tax.buy_pct - want) < 0.3, JSON.stringify(r.tax));
}
// THROUGH THE POOL THAT WAS READ (2026-09-21). Asked about a pair against
// USDT, the test used to trade the token's pair against BNB instead and call
// that "sellable" — for ARK a four-dollar pair beside a $28M market. CAKE has
// both pairs: the same token, asked through its USDT pair, must route
// token -> USDT -> BNB, say so, and still read CAKE's 0%.
{
  const CAKE = PAIRS[1][1], USDT = '0x55d398326f99059ff775485246999027b3197955';
  const pair = C.addrAt((await C.rpcBatch([C.call('0xca143ce32fe78f1f7019d7d551a6402fc5350c73', C.getPair(CAKE, USDT))]))[0]);
  const t0 = await C.rpcBatch([C.call(pair, C.SEL.token0)]);
  const r = await C.simulateRoundTrip(CAKE, pair, C.addrAt(t0[0]) === CAKE, 'v2');
  ok('CAKE through its USDT pair: the test trades THAT pair, in two hops, and says so',
    r.ok && r.through_scanned_pool === true && r.pair === pair && Array.isArray(r.path) && r.path.length === 3 && r.path[1] === USDT, JSON.stringify({ pair: r.pair, path: r.path, through: r.through_scanned_pool, reason: r.reason }));
  ok('… sells, buys, and reads 0% both ways from the probe’s own quote',
    r.ok && r.sellable === true && r.buyable === true && r.tax && Math.abs(r.tax.sell_pct) < 0.3 && Math.abs(r.tax.buy_pct) < 0.3, JSON.stringify(r.tax));
  const direct = await C.simulateRoundTrip(PAIRS[0][1], PAIRS[0][2], true, 'v2');
  ok('a pair against BNB is one hop, through the pool that was read', direct.through_scanned_pool === true && direct.path.length === 2 && direct.pair === PAIRS[0][2], JSON.stringify(direct.path));
}
// A V3 POOL IS TESTED TOO (2026-09-21). Until then "this token trades on V3"
// meant "not simulated" — for most of what was being traded. CAKE's V3 pool
// against BNB at 0.25%, found by asking the factory, not written down.
{
  const CAKE = PAIRS[1][1], WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
  const getPool = '0x1698ee82' + CAKE.slice(2).padStart(64, '0') + WBNB.slice(2).padStart(64, '0') + (2500).toString(16).padStart(64, '0');
  const pool = C.addrAt((await C.rpcBatch([C.call('0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', getPool)]))[0]);
  const r = await C.simulateRoundTrip(CAKE, pool, true, 'v3');
  ok('CAKE through its V3 pool: the sell goes through THAT pool, and says so',
    r.ok && r.sellable === true && r.through_scanned_pool === true && r.pair === pool && r.venue === 'PancakeSwap V3', JSON.stringify({ ok: r.ok, sellable: r.sellable, pair: r.pair, reason: r.reason, err: r.sell_error }));
  ok('… with 0% on the sell, and the buy side said to be not simulated', r.tax && r.tax.sell_pct === 0 && r.tax.buy_pct === null && r.buyable === null, JSON.stringify(r.tax));
  // The negative: the same calls with no test balance placed. The router must
  // refuse them — if this "sold", the pass above would prove nothing.
  const neg = await C.simulateV3Sell(CAKE, pool, true);
  ok('the same sell with NO balance is refused, and carries the refusal', neg.ok === true && neg.sellable === false && !!neg.sell_error, JSON.stringify({ sellable: neg.sellable, err: neg.sell_error }));
  // A V2 pair handed over as "v3" holds no fee(): not a PancakeSwap V3 pool.
  const wrong = await C.simulateRoundTrip(PAIRS[1][1], PAIRS[1][2], true, 'v3');
  ok('a pool that is not PancakeSwap V3 is "not run", never "sellable"', wrong.ok === false && wrong.sellable === undefined, JSON.stringify(wrong).slice(0, 140));
}

// The negative: the same sell with no allowance. The router must refuse it,
// and the refusal must arrive as sellable:false with the router's reason.
{
  const token = PAIRS[0][1], pair = PAIRS[0][2];
  const url = C.RPCS[0];
  const PROBE = '0x0000000000000000000000000000000000c0ffee', ROUTER = '0x10ed43c718714eb63d5aa57b78b54704e256024e';
  const pad = (v) => (typeof v === 'bigint' ? v.toString(16) : String(v).replace(/^0x/, '')).padStart(64, '0');
  const amount = 10n ** 18n;
  const balKey = C.keccakHex(pad(PROBE) + pad(0n));
  const deadline = pad(BigInt(Math.floor(Date.now() / 1000) + 600));
  const data = '0x791ac947' + pad(amount) + pad(0n) + pad(0xa0n) + pad(PROBE) + deadline + pad(2n) + pad(token) + pad('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
  const j = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from: PROBE, to: ROUTER, data, gas: '0x1e8480' }, 'latest', { [token]: { stateDiff: { [balKey]: '0x' + pad(amount) } }, [PROBE]: { balance: '0x' + pad(10n ** 18n) } }] }) }).then((r) => r.json());
  ok('a sell without allowance is refused by the router', !!j.error, JSON.stringify(j).slice(0, 100));
  ok('and the refusal carries a reason a reader can see', !!j.error && /TRANSFER_FROM_FAILED|revert|execution/i.test(JSON.stringify(j.error)), JSON.stringify(j.error || {}).slice(0, 100));
}

fs.rmSync(stage, { recursive: true, force: true });
console.log(`\n${failed ? failed + ' check(s) FAILED' : 'the sell simulation behaves in both directions'}`);
process.exitCode = failed ? 1 : 0;
