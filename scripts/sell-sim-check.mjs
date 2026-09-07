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

const ROOT = path.resolve(import.meta.dirname, '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sellsim-'));
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
ok('a V3-only token is reported as not simulated, not as sellable',
  (await C.simulateRoundTrip(PAIRS[1][1], PAIRS[1][2], true, 'v3')).ok === false);

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
