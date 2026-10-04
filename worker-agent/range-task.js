// A PancakeSwap V3 range task, asked in plain words, answered in strict JSON.
//
// Marque's rebalancing conformance test (MCS-REB-1, read off our own log on
// 2026-10-04) sends a text message, not a skill: a position NFT id, its pool,
// a block "answer for this block only", a policy ("re-centre the position
// symmetrically at ±6% around the current spot price, on the 0.25% fee tier,
// keeping the same liquidity") and the JSON it wants back: currentTick,
// inRange, pctToNearestBound, proposedTickLower, proposedTickUpper, amount0,
// amount1, maxSlippageBps. A rebalancing agent that can only answer about
// its own position at the latest block fails it — so this reads any position
// on any V3 pool at the block asked, through an archive-capable endpoint.
//
// Everything is read from the chain at that block: the pool's slot0 and tick
// spacing, the position's ticks and liquidity from the NonfungiblePositionManager,
// both tokens' decimals. The amounts are the standard V3 liquidity formulas
// for the SAME liquidity in the proposed range at the block's price.

const NPM = '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364';
const SPACING = { 100: 1, 500: 10, 2500: 50, 10000: 200 };
const Q96 = 2n ** 96n;

export function parseRangeTask(text = '') {
  const t = String(text);
  const position = t.match(/Position NFT id:\s*(\d+)/i)?.[1];
  const pool = t.match(/Pool:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  if (!position || !pool) return null;
  const block = t.match(/Block:\s*(\d+)/i)?.[1] || null;
  const width = Number(t.match(/±\s*([\d.]+)\s*%/)?.[1] ?? NaN);
  const tierPct = t.match(/on the\s*([\d.]+)\s*%\s*fee tier/i)?.[1];
  const fields = [...t.matchAll(/"([A-Za-z0-9_]+)"\s*:/g)].map((m) => m[1]);
  return { position, pool, block: block ? Number(block) : null, widthPct: Number.isFinite(width) ? width : null, feeTier: tierPct ? Math.round(Number(tierPct) * 10000) : null, fields };
}

const word = (hex, i) => '0x' + hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const int24 = (w) => { let v = BigInt(w) & ((1n << 24n) - 1n); if (v >= 1n << 23n) v -= 1n << 24n; return Number(v); };

export async function answerRangeTask(task, rpcs) {
  const tag = task.block ? '0x' + task.block.toString(16) : 'latest';
  const call = async (to, data) => {
    let last;
    for (const u of rpcs) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, tag] }), signal: AbortSignal.timeout(12000) });
        const j = await r.json();
        if (j.error) { last = new Error(j.error.message); continue; }
        if (j.result && j.result !== '0x') return j.result;
      } catch (e) { last = e; }
    }
    throw last || new Error('no endpoint could read that block');
  };
  const pad = (n) => BigInt(n).toString(16).padStart(64, '0');
  const [slot0, spacingHex, pos] = await Promise.all([
    call(task.pool, '0x3850c7bd'),
    call(task.pool, '0xd0c93a7c'),
    call(NPM, '0x99fbab88' + pad(task.position)),
  ]);
  const sqrtP = BigInt(word(slot0, 0));
  const tick = int24(word(slot0, 1));
  const token0 = '0x' + word(pos, 2).slice(26), token1 = '0x' + word(pos, 3).slice(26);
  const fee = Number(BigInt(word(pos, 4)));
  const tickLower = int24(word(pos, 5)), tickUpper = int24(word(pos, 6));
  const liquidity = BigInt(word(pos, 7));
  const [d0, d1] = await Promise.all([call(token0, '0x313ce567'), call(token1, '0x313ce567')]).then((x) => x.map((h) => Number(BigInt(h))));
  const poolSpacing = Number(BigInt.asIntN(24, BigInt(spacingHex)));
  const spacing = task.feeTier && task.feeTier !== fee ? (SPACING[task.feeTier] || poolSpacing) : poolSpacing;

  const inRange = tick >= tickLower && tick < tickUpper;
  // Price distance to the nearer bound, in percent of the current price.
  const p = Number(sqrtP) ** 2 / 2 ** 192;
  const pl = 1.0001 ** tickLower, pu = 1.0001 ** tickUpper;
  const pctToNearestBound = inRange
    ? Math.min((pu / p - 1) * 100, (1 - pl / p) * 100)
    : -Math.min(Math.abs(pl / p - 1) * 100, Math.abs(pu / p - 1) * 100);

  // Symmetric re-centre: ±w% in price around spot, snapped outward to the
  // spacing so the range never ends up narrower than the policy.
  const w = (task.widthPct ?? 6) / 100;
  const rawLower = tick + Math.log(1 - w) / Math.log(1.0001);
  const rawUpper = tick + Math.log(1 + w) / Math.log(1.0001);
  const proposedTickLower = Math.floor(rawLower / spacing) * spacing;
  const proposedTickUpper = Math.ceil(rawUpper / spacing) * spacing;

  // The same liquidity in the new range at the block's price.
  const sq = (t) => Math.sqrt(1.0001 ** t);
  const sP = Number(sqrtP) / Number(Q96), sA = sq(proposedTickLower), sB = sq(proposedTickUpper);
  const L = Number(liquidity);
  let a0 = 0, a1 = 0;
  if (sP <= sA) a0 = L * (sB - sA) / (sA * sB);
  else if (sP >= sB) a1 = L * (sB - sA);
  else { a0 = L * (sB - sP) / (sP * sB); a1 = L * (sP - sA); }
  const amount0 = a0 / 10 ** d0, amount1 = a1 / 10 ** d1;

  return {
    currentTick: tick,
    inRange,
    pctToNearestBound: Number(pctToNearestBound.toFixed(6)),
    proposedTickLower,
    proposedTickUpper,
    amount0: Number(amount0.toPrecision(10)),
    amount1: Number(amount1.toPrecision(10)),
    maxSlippageBps: 50,
    _context: { block: task.block, pool: task.pool, position: task.position, fee, tickSpacing: spacing, tickLower, tickUpper, liquidity: liquidity.toString(), token0, token1, decimals: [d0, d1] },
  };
}
