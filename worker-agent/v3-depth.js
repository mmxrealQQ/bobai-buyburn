// worker-agent/v3-depth.js — the 1% buy depth of a PancakeSwap V3 pool, for the pool watch (2026-10-16)
//
// The pool watch read V2 reserves only, so the pool scan could offer it on a V2 pair alone — and the deepest market of
// most large tokens (ETH, ASTER, USD1) is a V3 pool. A V3 pool's depth is not in a balance: its liquidity sits in
// ranges, so the size that moves the price 1% is asked of PancakeSwap's QuoterV2, the way the scanner measures it
// (dashboard/scanner-chain.js onePctV3, buy side): a dust quote gives "before" from the same block state, twelve
// sizes from $20 to $976M are quoted, and the 1% crossing is read off the curve in log space. Same figure as the
// scan's onePercentDepth.buyUsd, so the threshold the scan offers and the depth the watch reads are one measure.
//
// One JSON-RPC batch per reading: a probe the pool cannot fill reverts, and that is an answer (the pool runs out),
// not an endpoint failure to retry elsewhere. Only a batch that does not come back moves to the next endpoint.

export const V3_FACTORY = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
export const QUOTER = '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997';
export const V3_SEL = { factory: '0xc45a0155', fee: '0xddca3f43', slot0: '0x3850c7bd', token0: '0x0dfe1681', token1: '0xd21220a7' };
const pad = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');
const num = (v) => BigInt(v).toString(16).padStart(64, '0');
// quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)) -> (amountOut, sqrtPriceX96After, …)
export const quoteCall = (tin, tout, amt, fee) => '0xc6a5026a' + pad(tin) + pad(tout) + num(amt) + num(fee) + num(0);
export const PROBES = Array.from({ length: 12 }, (_, i) => 20 * Math.pow(5, i));

export async function ethCallBatch(endpoints, calls) {
  let last;
  for (const endpoint of endpoints) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }))),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      if (!Array.isArray(j)) { last = new Error('batch not answered'); continue; }
      const out = new Array(calls.length).fill(null);
      for (const x of j) if (x && Number.isInteger(x.id) && typeof x.result === 'string') out[x.id] = x.result;
      // Every slot empty, reverts included, is read as this endpoint failing — a pool that answers nothing at all
      // is not something to conclude from one node.
      if (out.every((x) => x == null)) { last = new Error('every call failed'); continue; }
      return out;
    } catch (e) { last = e; }
  }
  throw last || new Error('all RPC endpoints failed');
}

// The crossing of 1% on the probe curve: { v } a figure, { min } a floor (every quotable probe stayed under 1%),
// { thin: true } over 1% already at the smallest probe. Pure, so a test can pin it.
export function crossing(points) {
  const pts = points.filter((p) => p.m != null && p.m > 0);
  if (!pts.length) return {};
  if (pts[0].m >= 1) return { thin: true, below: pts[0].u };
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].m >= 1 && pts[i - 1].m < 1) {
      const a = pts[i - 1], b = pts[i], t = (0 - Math.log(a.m)) / (Math.log(b.m) - Math.log(a.m));
      return { v: Math.exp(Math.log(a.u) + t * (Math.log(b.u) - Math.log(a.u))) };
    }
  }
  const last = pts[pts.length - 1];
  return last.m < 1 ? { min: last.u } : {};
}

// The USD size of quote that moves the pool's price 1% up. Returns { depthUsd, floor } or null when nothing could be
// read (never a guess: the watch skips the round, as it does when a V2 read fails).
export async function v3BuyDepthUsd(endpoints, { pool, token, quote, fee, quoteUsd }) {
  if (!(quoteUsd > 0)) return null;
  const tokenIs0 = token.toLowerCase() < quote.toLowerCase();
  const dust = BigInt(Math.max(1, Math.floor((1 / quoteUsd) * 1e18)));
  const calls = [{ to: pool, data: V3_SEL.slot0 }, { to: QUOTER, data: quoteCall(quote, token, dust, fee) },
    ...PROBES.map((u) => ({ to: QUOTER, data: quoteCall(quote, token, BigInt(Math.floor((u / quoteUsd) * 1e18)), fee) }))];
  const all = await ethCallBatch(endpoints, calls);
  const word = (h, i) => (h && h.length >= 2 + 64 * (i + 1) ? Number(BigInt('0x' + h.slice(2 + 64 * i, 2 + 64 * (i + 1)))) : null);
  // "before" from the dust quote (same block state as the probes), slot0 when the dust quote did not answer
  const before = word(all[1], 1) || word(all[0], 0);
  if (!(before > 0)) return null;
  const move = (h) => {
    const after = word(h, 1);
    if (!(after > 0)) return null;
    const ratio = Math.pow(after / before, 2);
    return Math.abs((tokenIs0 ? ratio : 1 / ratio) - 1) * 100;
  };
  const c = crossing(PROBES.map((u, i) => ({ u, m: move(all[2 + i]) })));
  if (c.v != null) return { depthUsd: c.v, floor: false };
  if (c.min != null) return { depthUsd: c.min, floor: true };   // at least this much: deeper than the largest probe it would quote
  if (c.thin) return { depthUsd: c.below / 2, floor: false };   // 1% already at $20: under it, read as half
  // No probe quotable at all, with the pool's slot0 readable: nothing left to buy against.
  return all[0] ? { depthUsd: 0, floor: false } : null;
}

// Is this address a PancakeSwap V3 pool holding token and quote? { fee } or { error }.
export async function readV3Pool(endpoints, pool, token, quote) {
  const r = await ethCallBatch(endpoints, [V3_SEL.factory, V3_SEL.fee, V3_SEL.token0, V3_SEL.token1].map((data) => ({ to: pool, data }))).catch(() => null);
  const addr = (h) => (h && h.length >= 66 ? '0x' + h.slice(-40).toLowerCase() : null);
  if (!r || addr(r[0]) !== V3_FACTORY) return { error: 'not a PancakeSwap V3 pool' };
  const fee = r[1] && r[1].length >= 66 ? Number(BigInt(r[1])) : null;
  const sides = [addr(r[2]), addr(r[3])];
  if (!(fee > 0)) return { error: 'that V3 pool did not answer its fee' };
  if (!sides.includes(token)) return { error: 'that pool does not hold this token' };
  if (!sides.includes(quote)) return { error: 'that pool is not quoted in the quote named (WBNB by default) — name its quote' };
  return { fee };
}
