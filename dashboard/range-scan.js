// WHICH PRICE RANGE, and the answer is a replay rather than a forecast.
//
// The tier question — which of the five pools sharing a pair is worth being in —
// is answered next door in tier-scan.js. This is the question after it, and it
// is the one concentrated liquidity actually forces on somebody: a V3 position
// is not "in the pool", it is in a price range, and the range decides almost
// everything. Narrow earns a large share of every trade and stops earning the
// moment the price walks out. Wide earns a sliver forever. Every interface that
// offers to pick one does it with a preset.
//
// WHAT MAKES A HONEST ANSWER POSSIBLE HERE
// The V3 Swap event carries `liquidity` — the liquidity that was active when
// that swap went through — alongside the price and the tick. Checked against a
// live pool: the last event's liquidity and tick equal the pool's own slot0 to
// the digit. So for any candidate range, a position of a given size can be
// walked through the swaps that actually happened: was it in range at that
// price, and if so what share of the active liquidity was it. That is not a
// model of a position. It is what the position would have collected, computed
// from the trades that occurred, with the pool's own liquidity as the
// denominator at every step.
//
// WHAT IT STILL CANNOT KNOW
// It is one window of about an hour. A range that held through it is not
// a range that holds tomorrow, and the replay says nothing about impermanent
// loss — a narrow range that captured the most fees is also the one that ends
// up furthest from the composition it started in. Both are stated in the
// answer rather than in a footnote, because the number is seductive and the
// caveat is the reason it is safe to publish.
import {
  QUOTES, BNB_PAIR, WBNB, LOGS_RPC, LOGS_RPCS, SEL as S,
  call, hx, addrAt, res2, decStr, rpcBatch, rpc,
  classify, priceToken, discover, bandDepthV3, windowMinutes, getLogsSplit, WINDOW_BLOCKS,
  SWAP_V3_T, SWAP_V3_UNI, int256, decOf,
} from './scanner-chain.js';

export class RangeError extends Error {
  constructor(headline, detail) {
    super(headline);
    this.headline = headline;
    this.detail = detail;
  }
}

// The widths worth putting side by side. Not a preference: they span the range
// from "this is a market-making position that needs watching" to "this is a V2
// position wearing a V3 badge", and the point of showing all of them at once is
// that the trade-off between them is visible instead of asserted.
const WIDTHS = [0.25, 0.5, 1, 2, 5, 10];
const FULL = 1e6; // stands in for min/max tick — a full-range position

// WHAT PUTTING A RANGE BACK COSTS, and why it belongs in this answer.
//
// A narrow range collects more per dollar and is walked out of more often, and
// a comparison that reports only the first half recommends a position that
// bleeds. Every re-entry is four calls — decrease, collect, burn, mint — and on
// BSC that is about 700,000 gas. Priced at 1 gwei rather than at the current
// floor of roughly 0.05, for the same reason the gas roster plans at 1 gwei: a
// figure that only holds while the chain is quiet is not a figure to size a
// position with.
//
// It is an assumption, so it is returned with the answer and can be replaced by
// the caller. What must never happen is it being left out and the narrow range
// looking free.
const REBALANCE_GAS = 700000n;
const REBALANCE_GAS_PRICE = 1000000000n; // 1 gwei

const sqrtAt = (pct) => Math.sqrt(1 + pct / 100);

// The liquidity constant L for a position of `usd` placed between two roots at
// the current price. Inverted from the standard amounts, so the position is
// sized by what it is worth rather than by a liquidity number nobody holds.
function liquidityFor(usd, sLo, sHi, sP, p0PerUnit, p1PerUnit) {
  // Value of one unit of L placed in this range, in dollars.
  const a0 = sP >= sHi ? 0 : (1 / Math.max(sP, sLo) - 1 / sHi);
  const a1 = sP <= sLo ? 0 : (Math.min(sP, sHi) - sLo);
  const per = a0 * p0PerUnit + a1 * p1PerUnit;
  return per > 0 ? usd / per : 0;
}

export async function rangePlan(input, opts = {}) {
  // Lowercased at the door, for the reason spelled out in tier-scan.js: every
  // address comparison downstream is against a lowercase value from addrAt.
  const address = String(input || '').toLowerCase();
  const capitalUsd = Number(opts.capitalUsd) > 0 ? Number(opts.capitalUsd) : 1000;

  let what;
  try { what = await classify(address); }
  catch {
    throw new RangeError('The chain did not answer.',
      'The public BSC node refused or timed out. Nothing is cached here, so a retry in a few seconds usually works.');
  }

  const base = await rpcBatch([call(BNB_PAIR, S.reserves), call(BNB_PAIR, S.token0)]);
  const br = res2(base[0]);
  const bnbUsd = br ? (addrAt(base[1]) === WBNB ? br[1] / br[0] : br[0] / br[1]) : 0;
  if (!(bnbUsd > 0)) throw new RangeError('Could not price BNB.', 'The reference pool read back empty.');

  // A V3 pool address answers the question directly. A token has to have a pool
  // chosen for it, and the choice is named rather than hidden: the tier holding
  // the most capital at the price. Which tier PAYS best is a different question
  // and pancakeswap_fee_tiers is the tool for it — picking one here by fees
  // would quietly answer both questions with one number.
  let pool = null, token = address, quote = null, feeRaw = null, chosen = null;
  if (what.kind === 'v3pool') {
    pool = address;
    const [a, b] = [what.token0, what.token1];
    const qa = QUOTES.find(([x]) => x === a), qb = QUOTES.find(([x]) => x === b);
    token = qa && !qb ? b : qb && !qa ? a : a;
    quote = token === a ? b : a;
    const f = await rpcBatch([call(pool, S.fee)]);
    feeRaw = Number(hx(f[0])) || 0;
  } else {
    const info0 = await rpcBatch([call(address, S.decimals)]);
    const dec0 = decOf(info0[0]);
    const cands = (await discover(address, dec0, bnbUsd)).filter((c) => c.kind === 'v3');
    if (!cands.length)
      throw new RangeError('That token has no PancakeSwap V3 pool.',
        'A range is a V3 idea. On a V2 pool your liquidity spans every price by construction and there is nothing to choose.');
    quote = cands[0].quote;
    const sameQuote = cands.filter((c) => c.quote === quote);
    const bands = await bandDepthV3(sameQuote.map((c) => c.pair), 2);
    let bestI = 0, bestV = -1;
    sameQuote.forEach((c, i) => {
      const b = bands[i];
      if (!b) return;
      // Compared in quote units, which is the one currency both sides of every
      // candidate already share.
      const v = (b.amount1 || 0) + (b.amount0 || 0);
      if (v > bestV) { bestV = v; bestI = i; }
    });
    pool = sameQuote[bestI].pair;
    feeRaw = sameQuote[bestI].feeRaw;
    chosen = `${(sameQuote[bestI].fee * 100).toFixed(2)}% — the tier standing the most capital within 2% of the price`;
    token = address;
  }

  const meta = await rpcBatch([
    call(token, S.decimals), call(token, S.symbol),
    call(quote, S.decimals), call(quote, S.symbol),
    call(pool, S.token0), call(pool, S.slot0), call(pool, '0xd0c93a7c'),   // tickSpacing()
  ]);
  const tokDec = decOf(meta[0]);
  const tokSym = decStr(meta[1]).slice(0, 12) || null;
  const qDec = decOf(meta[2]);
  const knownQ = QUOTES.find(([x]) => x === quote);
  const qSym = knownQ ? knownQ[1] : (decStr(meta[3]).slice(0, 12) || null);
  const tokenIs0 = addrAt(meta[4]) === token;
  const slot0 = meta[5];
  // A RANGE HAS TO SIT ON THE POOL'S TICK GRID (2026-09-18). A position's
  // edges are multiples of the tier's tick spacing — 1 on 0.01%, 10 on 0.05%,
  // 50 on 0.25%, 200 on 1% — so the narrowest position the 1% tier can hold is
  // 200 ticks, about ±1.0%. The replay offered ±0.25% there all the same and
  // named it "the narrowest range that held", 3.6 times what any mintable
  // position collected. Widths under one spacing are left out and said so;
  // the others are snapped outward onto the grid, as the manager would mint them.
  const spacing = Number(hx(meta[6])) || 1;
  const TICK_LN = Math.log(1.0001);
  const tickOf = (sq) => (2 * Math.log(sq)) / TICK_LN;
  const sqrtOfTick = (t) => Math.pow(1.0001, t / 2);
  const mintable = (w) => (2 * Math.log(1 + w / 100)) / TICK_LN >= spacing;
  const notMintable = WIDTHS.filter((w) => !mintable(w));
  if (!slot0 || slot0.length < 130) throw new RangeError('The pool did not answer.', 'slot0 read back empty.');
  const sP = Number(BigInt('0x' + slot0.slice(2, 66))) / Number(2n ** 96n);
  // THE PROTOCOL'S CUT (2026-09-13). A swap's fee is not all the liquidity's:
  // the pool keeps a share for the protocol before it credits the positions.
  // CAKE/BNB 0.05% carries feeProtocol 3400 on both sides — 34% of every fee
  // goes to PancakeSwap, 66% to the liquidity. The replay charged the whole
  // fee to the position and overstated every width by that half again; the
  // agent's own position measured it (0.57 of the replay over 71 h). Read
  // from slot0's sixth word: PancakeSwap packs two 16-bit shares in 1/10000
  // (token0 low, token1 high); a Uniswap-style pool packs two 4-bit divisors
  // (fee/x, x in 4..10, 0 = none) in one byte. Told apart by size.
  const fpRaw = slot0.length >= 2 + 64 * 6 ? Number(BigInt('0x' + slot0.slice(2 + 64 * 5, 2 + 64 * 6))) : 0;
  const protocolShare = fpRaw > 255
    ? [(fpRaw & 0xffff) / 1e4, (fpRaw >>> 16) / 1e4]
    : [(fpRaw & 0xf) ? 1 / (fpRaw & 0xf) : 0, (fpRaw >>> 4) ? 1 / (fpRaw >>> 4) : 0];
  const lpShare = protocolShare.map((x) => (x >= 0 && x < 1 ? 1 - x : 1));

  const tokUsd = (await priceToken(token, bnbUsd)).usd;
  const qUsd = knownQ ? (knownQ[2] ? 1 : bnbUsd) : (await priceToken(quote, bnbUsd)).usd;
  if (!(tokUsd > 0) || !(qUsd > 0))
    throw new RangeError('This pair could not be priced.', 'Without both sides in dollars a position cannot be sized, so nothing is reported rather than a figure in token units pretending to be one in dollars.');

  // Dollars per raw unit of each side, which is what the liquidity maths works
  // in. token0/token1 order is the pool's, not ours.
  const p0PerUnit = (tokenIs0 ? tokUsd / 10 ** tokDec : qUsd / 10 ** qDec);
  const p1PerUnit = (tokenIs0 ? qUsd / 10 ** qDec : tokUsd / 10 ** tokDec);

  const head = parseInt(await rpc('eth_blockNumber', [], LOGS_RPC), 16);
  const from = head - (WINDOW_BLOCKS - 1);
  let logs = null;
  for (let attempt = 0; attempt < 3 && logs === null; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt));
    // In pieces when the whole range is refused (getLogsSplit in scanner-chain).
    logs = await getLogsSplit({ address: pool, topics: [[SWAP_V3_T, SWAP_V3_UNI]] }, from, head, LOGS_RPCS[attempt % LOGS_RPCS.length]);
  }
  if (!logs)
    throw new RangeError('The log endpoint refused this range.',
      'That is a fact about the measurement, not about the pool. Nothing is cached here, so a retry usually works.');

  // Every swap, as the pool itself recorded it: what went in, where the price
  // ended up, and how much liquidity was active while it happened.
  const swaps = [];
  for (const L of logs) {
    const d = L.data.slice(2);
    if (d.length < 64 * 5) continue;
    const a0 = int256(d.slice(0, 64)), a1 = int256(d.slice(64, 128));
    const sqrt = Number(BigInt('0x' + d.slice(128, 192))) / Number(2n ** 96n);
    const liq = Number(BigInt('0x' + d.slice(192, 256)));
    if (!(sqrt > 0) || !(liq > 0)) continue;
    // The fee is taken out of whichever side went IN, which is the positive one.
    const feeUsd = (a0 > 0n ? Number(a0) * p0PerUnit : Number(a1) * p1PerUnit) * (feeRaw / 1e6);
    // What the liquidity is credited with: the fee less the protocol's share
    // on the side that went in.
    const lpUsd = feeUsd * (a0 > 0n ? lpShare[0] : lpShare[1]);
    swaps.push({ block: parseInt(L.blockNumber, 16), sqrt, liq, feeUsd: feeUsd > 0 ? feeUsd : 0, lpUsd: lpUsd > 0 ? lpUsd : 0 });
  }
  swaps.sort((a, b) => a.block - b.block);

  // The replay. For each candidate width, a position of the stated size is
  // placed around the CURRENT price and walked through the swaps that already
  // happened. Two honest imprecisions, both stated: the position is placed at
  // today's price rather than at the price when the window opened, and the
  // active liquidity in the event is the pool's after that swap.
  const spanBlocks = swaps.length > 1 ? swaps[swaps.length - 1].block - swaps[0].block : 0;
  const totalFees = swaps.reduce((s, x) => s + x.feeUsd, 0);
  const totalToLiquidity = swaps.reduce((s, x) => s + x.lpUsd, 0);
  const rows = [...WIDTHS.filter(mintable), FULL].map((w) => {
    const k = w === FULL ? 1e9 : sqrtAt(w);
    let sLo = sP / k, sHi = sP * k;
    if (w !== FULL && spacing > 1) { sLo = sqrtOfTick(Math.floor(tickOf(sLo) / spacing) * spacing); sHi = sqrtOfTick(Math.ceil(tickOf(sHi) / spacing) * spacing); }
    const L = liquidityFor(capitalUsd, sLo, sHi, sP, p0PerUnit, p1PerUnit);
    let fees = 0, inRange = 0, blocksIn = 0, crossings = 0, was = null;
    for (let i = 0; i < swaps.length; i++) {
      const s = swaps[i];
      const isIn = s.sqrt > sLo && s.sqrt < sHi;
      if (isIn) {
        inRange += 1;
        // Share of the liquidity that was actually standing there, with this
        // position's own size in the denominator because adding it is what
        // dilutes everyone including itself.
        fees += s.lpUsd * (L / (s.liq + L));
      }
      // THE BLOCKS AFTER THIS SWAP, NOT BEFORE IT.
      //
      // A swap sets a price and that price stands until the next swap moves it.
      // The first version credited the gap BEFORE each in-range swap, which
      // attributes an interval to a price that had not happened yet — it reads
      // almost right and is wrong at exactly the moments that matter, the ones
      // either side of a crossing.
      if (isIn && i < swaps.length - 1) blocksIn += swaps[i + 1].block - s.block;
      // Counted in both directions, because a position placed around today's
      // price and replayed backwards can just as easily be ARRIVED IN as left.
      // Counting only departures made a narrow range that the price walked into
      // halfway through look like one it had never left.
      if (was !== null && was !== isIn) crossings += 1;
      was = isIn;
    }
    return {
      width_pct: w === FULL ? null : w,
      full_range: w === FULL,
      _crossings: crossings,
      _fees: fees,
      _sLo: sLo, _sHi: sHi,
      // Filled in below, once, in the unit somebody would actually type.
      price_range: null,
      swaps_in_range: inRange,
      swaps_total: swaps.length,
      share_of_window_in_range_pct: spanBlocks > 0 ? +((blocksIn / spanBlocks) * 100).toFixed(1) : null,
      times_it_crossed_the_edge: crossings,
      fees_usd_in_window: +fees.toFixed(6),
    };
  });
  // The price bounds, expressed the way somebody would type them into a
  // position: in quote per token, not in roots.
  //
  // THE EDGES THE FEES WERE COUNTED BETWEEN (2026-09-20). Since the ranges are
  // snapped onto the grid the replay walks the snapped position, and this line
  // still printed price ± width: on the 0.25% tier (spacing 50, half a percent
  // a step) the row called ±0.5% was replayed from −0.56% to +0.94% (CAKE/USDT,
  // measured) and shown as ±0.5%. The bounds are the ones the position was replayed with;
  // width_pct stays the width that was asked for.
  const priceAt = (sq) => (tokenIs0 ? (sq * sq) * (10 ** tokDec / 10 ** qDec) : 1 / ((sq * sq) * (10 ** qDec / 10 ** tokDec)));
  const priceOfToken = priceAt(sP);
  rows.forEach((r) => {
    if (r.full_range) { r.price_range = null; delete r._sLo; delete r._sHi; return; }
    const a = priceAt(r._sLo), b = priceAt(r._sHi);
    r.price_range = { low: +Math.min(a, b).toPrecision(8), high: +Math.max(a, b).toPrecision(8),
      unit: `${qSym} per ${tokSym || 'token'}` };
    delete r._sLo; delete r._sHi;
  });

  // The cost of one re-entry, in dollars, from the live BNB price rather than
  // from a number typed into this file a month ago.
  const rebalanceUsd = opts.rebalanceCostUsd != null
    ? Number(opts.rebalanceCostUsd)
    : (Number(REBALANCE_GAS * REBALANCE_GAS_PRICE) / 1e18) * bnbUsd;
  rows.forEach((r) => {
    // Fees minus what it would have cost to put the position back each time the
    // price crossed out. Same window on both sides of the subtraction, so this
    // is a comparison and not a rate — and it can go negative, which is the
    // whole point: a range that collects the most and is nursed four times can
    // be the worst place in the list.
    r.assumed_rebalance_cost_usd = +rebalanceUsd.toFixed(6);
    r.net_after_rebalancing_usd_in_window =
      +(r._fees - (r.full_range ? 0 : r._crossings * rebalanceUsd)).toFixed(6);
    delete r._crossings; delete r._fees;
  });

  const minutes = await windowMinutes(from, head);
  const best = rows.filter((r) => r.fees_usd_in_window > 0)
    .sort((a, b) => b.fees_usd_in_window - a.fees_usd_in_window)[0] || null;
  // The width that came out ahead once the nursing was paid for. This is the
  // one an unattended position should be sized by, and it is regularly not the
  // one that collected most.
  const bestNet = rows.slice().sort((a, b) => b.net_after_rebalancing_usd_in_window - a.net_after_rebalancing_usd_in_window)[0] || null;
  const fullRow = rows.find((r) => r.full_range);
  // HELD means in range for the WHOLE window, not "was never seen leaving".
  // Those are different claims and the second one is satisfied by a range the
  // price only wandered into near the end.
  const held = rows.filter((r) => !r.full_range && r.width_pct != null
    && r.share_of_window_in_range_pct === 100 && r.times_it_crossed_the_edge === 0);
  const narrowestHeld = held.length ? held[0] : null;

  return {
    tool: 'pancakeswap_range_plan',
    pair: { token: { address: token, symbol: tokSym, decimals: tokDec },
            quote: { address: quote, symbol: qSym, decimals: qDec } },
    pool, fee_pct: +(feeRaw / 1e4).toFixed(4),
    // The grid the ranges were snapped to, and the widths it cannot hold.
    tick_spacing: spacing,
    narrowest_mintable_width_pct: +((Math.exp((spacing * TICK_LN) / 2) - 1) * 100).toFixed(3),
    widths_this_tier_cannot_hold_pct: notMintable,
    tier_chosen_because: chosen,
    price_now: +priceOfToken.toPrecision(8),
    capital_considered_usd: capitalUsd,
    measured_window: {
      from_block: from, to_block: head, blocks: head - from + 1,
      minutes: minutes == null ? null : +minutes.toFixed(1),
      swaps: swaps.length,
      fees_the_pool_paid_usd: +totalFees.toFixed(6),
      // The split the pool makes before any position sees a fee. The rows
      // above are the liquidity's part; the total is what the traders paid.
      fees_paid_to_liquidity_usd: +totalToLiquidity.toFixed(6),
      fees_kept_by_the_protocol_usd: +(totalFees - totalToLiquidity).toFixed(6),
      paid_to_liquidity_pct: +(Math.min(lpShare[0], lpShare[1]) * 100).toFixed(2),
      protocol_fee_pct: { token0: +(protocolShare[0] * 100).toFixed(2), token1: +(protocolShare[1] * 100).toFixed(2) },
      note: 'One sample of live chain. Not annualised here and not to be annualised from here: what a range did over one window is not what it does over a year.',
    },
    ranges: rows,
    // The two sentences worth having.
    best_earning_range_in_this_window: best
      ? (best.full_range ? 'full range' : `±${best.width_pct}%`) : null,
    best_range_after_paying_to_put_it_back: bestNet
      ? (bestNet.full_range ? 'full range' : `±${bestNet.width_pct}%`) : null,
    rebalance_cost_usd_assumed: +rebalanceUsd.toFixed(6),
    narrowest_range_that_held_the_whole_window: narrowestHeld ? `±${narrowestHeld.width_pct}%` : null,
    times_better_than_full_range: (best && fullRow && fullRow.fees_usd_in_window > 0)
      ? +(best.fees_usd_in_window / fullRow.fees_usd_in_window).toFixed(1) : null,
    caveats: [
      `Replayed against the ${swaps.length} swaps that actually happened in this window, using the liquidity the pool reported as active at each one. It is not a simulation of a market; it is arithmetic over trades that occurred.`,
      protocolShare[0] > 0 || protocolShare[1] > 0
        ? `The pool keeps ${(protocolShare[0] * 100).toFixed(0)}% of every fee for the protocol before it credits the liquidity; every figure above is the liquidity's ${(lpShare[0] * 100).toFixed(0)}%, read from the pool itself (slot0.feeProtocol), not the whole fee the trader paid.`
        : 'This pool keeps nothing for the protocol (slot0.feeProtocol is zero): the liquidity is credited with the whole fee.',
      `Putting a range back costs gas, so every crossing is charged at $${rebalanceUsd.toFixed(4)} — 700,000 gas priced at 1 gwei, well above the current floor, because a position sized on a quiet chain is stranded by a busy hour. Both sides of that subtraction are the same window, so it is a comparison rather than a rate. It can go negative, and when it does the range collected more than it was worth.`,
      `The window is ${minutes == null ? 'about forty' : minutes.toFixed(1)} minutes of chain and travels with every figure above, because a fee figure without the period it was earned over is the number this project exists to stop people quoting.`,
      'The position is placed around the price as it stands now, then walked back through the window. A position opened at the start of the window would have sat slightly differently.',
      'Impermanent loss is not in any of this, and it is worst exactly where the fees are best: the narrow range that captured the most is also the one that ends furthest from what it started as.',
      'The position is centred on the price as it stands now, so a narrow range can show as arrived-in rather than left — the crossing count runs in both directions for that reason, and "held" means in range for the whole window rather than never seen leaving.',
      'A range that held through an hour is not a range that holds. The crossing count is what happened, not what will.',
      swaps.length < 10
        ? `Only ${swaps.length} swaps in the window, which is too few to separate the widths with any confidence. Treat the ordering as noise until this pool trades more.`
        : `${swaps.length} swaps carried this comparison.`,
    ],
  };
}
