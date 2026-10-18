#!/usr/bin/env node
// scripts/flap-curve-check.mjs — a token still on flap.sh's bonding curve is measured, not sent "elsewhere" (2026-10-18)
//
// The pool scan answered a flap.sh token "most of it sits at Flapsh … not measured here", and the index's figure for
// such a curve is its virtual reserve: on 18.10. one showed $8,915 of "liquidity" with 0.071 BNB (~$51) in the curve.
// Now scanner-scan.js / scanner.js read flap.sh's Portal (getTokenV5, quoteExactInput). This checks, on the live route,
// a token that is tradable on the curve right now: the answer is the curve's (platform flap.sh), its reserve is the one
// the Portal reports (read here independently, same block window), the price agrees with the index within 5%, a sell
// larger than the reserve is marked as unpayable, the index figure is named as virtual, and the preflight stops a sell
// the curve cannot pay. Nothing is traded.
//
//   node scripts/flap-curve-check.mjs [base]     (default https://brainonbnb.com)   exit 1 on any FAIL
import { ownTestHeaders } from './lib/own-test-headers.mjs';
const OWN = ownTestHeaders();   // our checks are not callers: uncounted against the 50 free scans a day
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const PORTAL = '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0';
// flap.sh tokens seen on the curve 18.10.; the first still tradable is used (curves graduate or empty)
const CANDIDATES = ['0x08510f97c8ed446bb64e7ff05ec202196f3a7777', '0x97e16e574cafb407eb1d95b2b4284c69fab77777'];
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + String(detail).slice(0, 150) : ''}`); };
const rpc = async (data) => (await (await fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: PORTAL, data }, 'latest'] }) })).json()).result;
const word = (h, i) => BigInt('0x' + h.slice(2 + 64 * i, 66 + 64 * i));

let token = null, state = null;
for (const t of CANDIDATES) {
  const h = await rpc('0x5c4bc504' + t.slice(2).padStart(64, '0')).catch(() => null);
  if (h && h.length > 66 && Number(word(h, 0)) === 1) { token = t; state = { reserve: Number(word(h, 1)) / 1e18, price: Number(word(h, 3)) / 1e18 }; break; }
}
check(!!token, 'a flap.sh token still tradable on its curve was found', token || 'none of the candidates — add a fresh one');
if (token) {
  const j = await (await fetch(`${BASE}/api/pool-scan?address=${token}&r=${Date.now()}`, { headers: { ...OWN, accept: 'application/json', referer: 'https://brainonbnb.com/scanner' }, signal: AbortSignal.timeout(90000) })).json().catch(() => ({}));
  const c = j.curve || {};
  check(c.platform === 'flap.sh' && /flap\.sh bonding curve/.test(j.reason || ''), 'the pool scan answers from the curve', (j.reason || j.error || '').slice(0, 120));
  check(c.reserve != null && Math.abs(c.reserve - state.reserve) <= Math.max(1e-6, state.reserve * 0.02), 'its reserve is the Portal\'s own (read here independently)', `${c.reserve} vs ${state.reserve}`);
  const ds = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`)).json().catch(() => ({}));
  const px = Number((ds.pairs || [])[0]?.priceUsd);
  check(px > 0 && c.priceUsd > 0 && Math.abs(c.priceUsd / px - 1) < 0.05, 'the price agrees with the index within 5%', `${c.priceUsd?.toPrecision(4)} vs ${px?.toPrecision(4)}`);
  const over = (c.tradeCost || []).filter((r) => r.sizeUsd > (c.reserveUsd ?? Infinity));
  check(over.every((r) => r.sellCostPct == null && /holds/.test(r.note || '')), 'every sell larger than the money in the curve is marked unpayable', `${over.length} sizes above $${c.reserveUsd}`);
  check(!(c.indexLiquidityUsd > c.reserveUsd) || /virtual|index figures/.test(j.reason || '') , 'the index\'s figure is set beside the real one', `index $${c.indexLiquidityUsd} · curve $${c.reserveUsd}`);
  const p = await (await fetch(`${BASE}/api/preflight?address=${token}&usd=250&r=${Date.now()}`, { headers: { ...OWN, accept: 'application/json', referer: 'https://brainonbnb.com/scanner' }, signal: AbortSignal.timeout(90000) })).json().catch(() => ({}));
  const codes = [...(p.stop || []), ...(p.caution || [])].map((x) => x.code);
  check(/flap\.sh bonding curve/.test(p.venue || ''), 'the preflight names the venue', p.venue || p.error);
  check(c.reserveUsd >= 250 || codes.includes('curve_cannot_pay'), 'the preflight stops a $250 sell the curve cannot pay', codes.join(','));
  check(!(c.indexLiquidityUsd > 0) || codes.includes('index_liquidity_virtual'), 'the preflight names the index figure as virtual', codes.join(','));
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
