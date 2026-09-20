#!/usr/bin/env node
// Does the scanner read a four.meme launch curve, and only a launch curve?
//
// A token still raising on four.meme has no pool anywhere; the scanner used to
// answer it with "no pool", which is true and useless. dashboard/scanner-chain.js
// now asks four.meme's helper contract (curveInfo, curveLadder). Pinned here in
// both directions:
//   · a token that never was on four.meme comes back null (CAKE),
//   · a graduated one comes back with liquidityAdded so the pool path applies
//     ($BOBAI, launched there 2026-03-27, raise complete),
//   · a token found raising RIGHT NOW (from the manager's own recent logs) has
//     a consistent record and a ladder whose costs rise with size, sit above
//     the platform fee, and flag a size the curve cannot fill.
// Run: node scripts/curve-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchDir } from './lib/scratch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const stage = scratchDir('curve-');
fs.writeFileSync(path.join(stage, 'scanner-chain.mjs'), fs.readFileSync(path.join(ROOT, 'dashboard', 'scanner-chain.js'), 'utf8'));
const C = await import('file://' + path.join(stage, 'scanner-chain.mjs').split(path.sep).join('/'));

let failed = 0;
const ok = (name, pass, detail) => { if (!pass) failed += 1; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// The other direction first: not everything is a curve.
const cake = await C.curveInfo('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
ok('CAKE is not a four.meme token', cake === null, JSON.stringify(cake));
const bobai = await C.curveInfo('0x245c386dcfed896f5c346107596141e5edcbffff');
ok('$BOBAI is a four.meme token that has graduated', !!bobai && bobai.liquidityAdded === true, JSON.stringify(bobai));
ok('$BOBAI raised its whole 18 BNB', !!bobai && bobai.quoteSym === 'BNB' && Math.abs(bobai.raised - 18) < 0.01 && bobai.maxRaising === 18, bobai && `${bobai.raised} of ${bobai.maxRaising} ${bobai.quoteSym}`);
ok('$BOBAI launch date is the one on the whitepaper (2026-03-27)', !!bobai && new Date(bobai.launchTime * 1000).toISOString().slice(0, 10) === '2026-03-27');

// A token raising right now: the manager's most recent trade log names one.
// Public nodes cap eth_getLogs at a few dozen blocks, so ask in small windows.
async function liveCurveToken() {
  const head = Number(await C.rpc('eth_blockNumber', [], C.LOGS_RPC));
  for (let k = 0; k < 30; k++) {
    const to = head - 10 * k, from = to - 9;
    let logs;
    try {
      logs = await C.rpc('eth_getLogs', [{ address: C.FOURMEME_MANAGER, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }], C.LOGS_RPC);
    } catch { continue; }
    if (!Array.isArray(logs)) continue;
    for (const l of logs.slice().reverse()) {
      if (l.topics.length !== 1 || !l.data || l.data.length < 130) continue;
      const token = C.addrAt('0x' + l.data.slice(2, 66));
      if (!token || token === C.NULLA) continue;
      const info = await C.curveInfo(token);
      if (info && !info.liquidityAdded && info.maxRaising > 0) return { token, info };
    }
  }
  return null;
}
const live = await liveCurveToken();
ok('a token raising right now was found in the manager’s recent logs', !!live, 'none in the last ~300 blocks — try again in a minute');
if (live) {
  const { token, info } = live;
  console.log(`      ${token}  ${info.quoteSym}  raised ${info.raised.toFixed(2)} of ${info.maxRaising}  (${info.progressPct.toFixed(1)}%)  price ${info.price}`);
  ok('the record is consistent (progress = raised / maxRaising)', Math.abs(info.progressPct - info.raised / info.maxRaising * 100) < 0.01);
  ok('tokens left never exceed the offer', info.offersLeft >= 0 && info.offersLeft <= info.maxOffers);
  ok('the fee is a sane platform fee (0–5 %)', info.feePct >= 0 && info.feePct <= 5, String(info.feePct));
  const bnb = await C.rpcBatch([C.call(C.BNB_PAIR, C.SEL.reserves), C.call(C.BNB_PAIR, C.SEL.token0)]);
  const br = C.res2(bnb[0]); const bIs0 = C.addrAt(bnb[1]) === C.WBNB;
  const bnbUsd = bIs0 ? br[1] / br[0] : br[0] / br[1];
  const quoteUsd = info.quoteSym === 'BNB' ? bnbUsd : info.quoteIsStable ? 1 : 0;
  ok('the quote can be priced in dollars', quoteUsd > 0, info.quoteSym);
  if (quoteUsd > 0) {
    const leftUsd = (info.maxRaising - info.raised) * quoteUsd;
    // One size the curve can surely fill, one it surely cannot.
    const sizes = [Math.max(1, Math.min(100, leftUsd / 4)), leftUsd * 3];
    const rows = await C.curveLadder(token, info, quoteUsd, sizes);
    ok('the ladder answered both sizes', rows.length === 2, String(rows.length));
    const [small, huge] = rows;
    ok('a small buy is quoted and costs at least the platform fee', !!small && small.buyCost != null && small.buyCost >= info.feePct * 0.99, small && `${small.buyCost}% vs fee ${info.feePct}%`);
    ok('a small sell is quoted and costs at least the platform fee', !!small && small.sellCost != null && small.sellCost >= info.feePct * 0.99, small && `${small.sellCost}%`);
    ok('a buy larger than what is left is flagged, not priced', !!huge && huge.buyCost == null && /more than the curve has left/.test(huge.buyNote || ''), huge && JSON.stringify(huge));
    ok('a sell of that size still gets a quote and costs more than the small one', !!huge && huge.sellCost != null && huge.sellCost > small.sellCost, huge && `${huge.sellCost}% vs ${small.sellCost}%`);
    const std = await C.curveLadder(token, info, quoteUsd, C.STEPS);
    const priced = std.filter((r) => r.buyCost != null).map((r) => r.buyCost);
    ok('buy cost rises with size on the standard ladder', priced.every((v, i) => i === 0 || v >= priced[i - 1]), priced.map((v) => v.toFixed(2)).join(' < '));
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed: the curve is read, only a curve is read, and the ladder says when a size cannot be filled');
process.exit(failed ? 1 : 0);
