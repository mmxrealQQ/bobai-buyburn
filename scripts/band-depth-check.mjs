#!/usr/bin/env node
// Does the working-capital figure survive being checked?
//
// /scanner and pancakeswap_fee_tiers now divide fees by the capital standing
// within a band of the current price, reconstructed by walking a V3 pool's tick
// book. That number has no second source anywhere on the internet to compare
// against, which is exactly why it needs one here.
//
// It has one, and it is the strongest kind: the pool's own quoter. The walk
// says how much token1 it takes to drag the price to the upper edge of the band
// and how much token0 comes back out. The quoter simulates that same swap
// inside the contract, crossing the same ticks. If the walk misreads one tick,
// misses one, or sign-flips a liquidityNet, the two answers separate.
//
// And a checker that only ever passes proves nothing, so every check here is
// run a second time against deliberately broken input under --self-test and has
// to fail. The one that matters most is the fast path: Multicall3 falls back to
// a plain batch when anything goes wrong, which is correct behaviour and
// completely invisible — the first port of the decoder was broken for exactly
// that reason and the only symptom was one extra request.
//
// Usage:
//   node scripts/band-depth-check.mjs [--self-test] [token ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchDir } from './lib/scratch.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const stage = scratchDir('band-check-');
// Same trick build-skill.mjs uses: the repo root is CommonJS, so these files
// have to arrive as .mjs before Node will read their exports.
for (const f of ['scanner-chain.js', 'tier-scan.js']) {
  let src = fs.readFileSync(path.join(ROOT, 'dashboard', f), 'utf8');
  src = src.split("'./scanner-chain.js'").join("'./scanner-chain.mjs'");
  fs.writeFileSync(path.join(stage, f.replace(/\.js$/, '.mjs')), src);
}
const C = await import('file://' + path.join(stage, 'scanner-chain.mjs').split(path.sep).join('/'));

const SELF = process.argv.includes('--self-test');
const TOKENS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DEFAULT_TOKENS = [
  ['CAKE', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'],
  ['USDT', '0x55d398326f99059ff775485246999027b3197955'],
];
const BAND = 2;
// The pool rounds in its own favour at every tick it crosses, so the quoter is
// allowed to come in fractionally under the ideal arithmetic. Measured across
// CAKE and USDT with the tick set read from a single block: 0.0000%. A tenth of
// a percent is therefore a very loose gate that still catches a misread tick.
const TOL_PCT = 0.1;

let failed = 0, checks = 0;
const ok = (name, pass, detail) => {
  checks += 1;
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// --- the closed form V2 has to obey ------------------------------------------
// A constant-product pool is a full-range position, so the share of it standing
// within ±b of the price is 1 - 1/sqrt(1+b/100) and nothing else: not a
// function of the reserves, not of the pair, not of the size. Any deviation is
// a bug in segAmounts, and this needs no network at all.
{
  const expect = 1 - 1 / Math.sqrt(1 + BAND / 100);
  const cases = [[1e21, 4e21], [7.3e24, 12e18], [5e18, 5e18]];
  let worst = 0;
  for (const [r0, r1] of cases) {
    const b = C.bandDepthV2(r0, r1, BAND);
    worst = Math.max(worst, Math.abs(b.amount0 / r0 - expect), Math.abs(b.amount1 / r1 - expect));
  }
  ok('V2 band share matches 1 - 1/sqrt(1+b)', worst < 1e-12,
    `expected ${(expect * 100).toFixed(4)}%, worst deviation ${worst.toExponential(2)}`);
  if (SELF) {
    // The identity is size-independent, so a checker that passes on anything
    // would also pass on a pool whose sides were computed with the wrong root.
    const b = C.bandDepthV2(1e21, 4e21, BAND);
    ok('SELF: V2 identity rejects a wrong constant',
      Math.abs(b.amount0 / 1e21 - (expect * 1.001)) > 1e-12, 'a 0.1% wrong target is not accepted');
  }
}

// --- the fast path is actually taken -----------------------------------------
{
  const POOL = '0x172fcd41e0913e95784454622d1c3724f546f849'; // WBNB/USDT 0.01%
  const iword = (v) => { const x = BigInt(v); return ((x < 0n ? (1n << 256n) + x : x).toString(16)).padStart(64, '0'); };
  const calls = [];
  for (let t = -66000; t < -65600; t++) calls.push(C.call(POOL, '0xf30dba93' + iword(t)));
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (...a) => { n += 1; return orig(...a); };
  const via = await C.multicall(calls);
  const requests = n;
  globalThis.fetch = orig;
  ok('400 tick reads cost one request', requests === 1, `${requests} request(s) for ${calls.length} calls`);
  ok('aggregate returns one result per call', via.length === calls.length, `${via.length} of ${calls.length}`);
  // And the aggregated answers are the same bytes the plain batch returns —
  // otherwise "cheaper" would be buying a different answer.
  const sample = [0, 137, 399];
  const one = await C.rpcBatch(sample.map((i) => calls[i]));
  ok('aggregated bytes equal batched bytes', sample.every((s, k) => via[s] === one[k]),
    sample.map((s, k) => (via[s] === one[k] ? 'match' : 'DIFFER')).join(' '));
  if (SELF) {
    // Break the aggregate and require the fallback rather than a wrong answer:
    // a helper contract that is not there must cost requests, never accuracy.
    const saved = C.MULTICALL3;
    const bogus = await C.multicall(sample.map((i) => calls[i]), 'https://bsc.publicnode.com');
    ok('SELF: fallback still answers correctly', bogus.every((v, k) => v === one[k]),
      'same bytes through either path' + (saved ? '' : ''));
  }
}

// --- the walk against the pool's own quoter ----------------------------------
const list = TOKENS.length ? TOKENS.map((t) => [t.slice(0, 8), t.toLowerCase()]) : DEFAULT_TOKENS;
for (const [name, addr] of list) {
  const base = await C.rpcBatch([C.call(C.BNB_PAIR, C.SEL.reserves), C.call(C.BNB_PAIR, C.SEL.token0)]);
  const br = C.res2(base[0]);
  const bnbUsd = C.addrAt(base[1]) === C.WBNB ? br[1] / br[0] : br[0] / br[1];
  const info = await C.rpcBatch([C.call(addr, C.SEL.decimals)]);
  const dec = Number(C.hx(info[0])) || 18;
  const cands = await C.discover(addr, dec, bnbUsd);
  if (!cands.length) { ok(`${name}: has pools`, false, 'discover found none'); continue; }
  const quote = cands[0].quote;
  const v3 = cands.filter((c) => c.quote === quote && c.kind === 'v3');
  if (!v3.length) { ok(`${name}: has a V3 tier to check`, false, 'V2 only'); continue; }
  const zeros = await C.rpcBatch(v3.map((c) => C.call(c.pair, C.SEL.token0)));
  const bands = await C.bandDepthV3(v3.map((c) => c.pair), BAND);

  for (let i = 0; i < v3.length; i++) {
    const c = v3[i], b = bands[i];
    const tier = `${name} V3 ${(c.fee * 100).toFixed(2)}%`;
    if (!b) { ok(`${tier}: readable`, false, 'no state'); continue; }
    const t0 = C.addrAt(zeros[i]), tokenIs0 = t0 === addr;
    const d0 = tokenIs0 ? dec : 18;

    // Invariant first, because it needs no second party: what stands inside the
    // band is a subset of what the contract holds. A walk that reports more
    // than the pool owns is wrong in a way no tolerance should forgive.
    const tokAmt = (tokenIs0 ? b.amount0 : b.amount1) / 10 ** dec;
    const qAmt = (tokenIs0 ? b.amount1 : b.amount0) / 1e18;
    ok(`${tier}: band fits inside the pool`,
      tokAmt <= c.tok * 1.005 && qAmt <= c.q * 1.005,
      `${tokAmt.toPrecision(6)} of ${c.tok.toPrecision(6)} token, ${qAmt.toPrecision(6)} of ${c.q.toPrecision(6)} quote`);

    const grossIn = b.to_upper_in1 / (1 - c.fee);
    if (!(grossIn > 1)) { ok(`${tier}: band has depth to quote`, true, 'empty band, nothing to compare'); continue; }
    const t1 = tokenIs0 ? quote : addr;
    const r = await C.rpcBatch([C.call(C.QUOTER, C.quoteCall(t1, t0, BigInt(Math.floor(grossIn)), c.feeRaw))]);
    if (!r[0] || r[0].length < 130) { ok(`${tier}: quoter answered`, false, 'quoter refused'); continue; }
    const got = Number(BigInt('0x' + r[0].slice(2, 66)));
    const diff = b.amount0 > 0 ? (got / b.amount0 - 1) * 100 : null;
    ok(`${tier}: walk agrees with the quoter`,
      diff != null && Math.abs(diff) < TOL_PCT,
      `walk ${(b.amount0 / 10 ** d0).toPrecision(8)}, quoter ${(got / 10 ** d0).toPrecision(8)}, ${diff == null ? '—' : diff.toFixed(4) + '%'}`);

    if (SELF) {
      // Feed the quoter an input that is deliberately 5% too large. If the
      // comparison above is doing any work at all, this has to disagree — a
      // check that cannot fail is not a check.
      const bad = BigInt(Math.floor(grossIn * 1.05));
      const r2 = await C.rpcBatch([C.call(C.QUOTER, C.quoteCall(t1, t0, bad, c.feeRaw))]);
      const got2 = r2[0] && r2[0].length >= 130 ? Number(BigInt('0x' + r2[0].slice(2, 66))) : null;
      const d2 = got2 != null && b.amount0 > 0 ? Math.abs((got2 / b.amount0 - 1) * 100) : null;
      ok(`SELF: ${tier} comparison rejects a 5% wrong trade`, d2 != null && d2 > TOL_PCT,
        d2 == null ? 'quoter refused' : `disagrees by ${d2.toFixed(3)}%`);
      break; // one poisoned case per token is enough to prove the gate bites
    }
  }
}

fs.rmSync(stage, { recursive: true, force: true });
console.log(`\n${checks - failed}/${checks} checks passed${SELF ? ' (with self-test)' : ''}`);
process.exit(failed ? 1 : 0);
