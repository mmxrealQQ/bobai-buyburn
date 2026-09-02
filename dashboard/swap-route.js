// WHICH PANCAKESWAP ROUTE, AND CAN YOU GET BACK OUT.
//
// The pool scan next door answers "what does a trade cost" for the pool it
// judged deepest. That is the right answer to a different question. A pair
// lives in up to five PancakeSwap pools at once, they quote differently at
// different sizes, and the deepest one is not reliably the cheapest one for
// the size actually being traded — depth is a fact about the pool, cost is a
// fact about the trade.
//
// So every route is quoted for the exact size, by the venue's own quoter, and
// the winner is whichever really returns the most. Nothing here is derived from
// a depth ranking.
//
// AND THE SECOND HALF, which is the one that matters for an automated swap:
// what comes back if you turn round and sell it again. A token you can buy and
// cannot sell quotes beautifully in one direction. The round trip is simulated
// through the same quoters, against the amount the buy would really have
// produced, so "you would get 3% of it back" is a measurement rather than a
// label from a reputation service.
//
// WHAT THIS IS NOT
// It is not a safety certificate and it does not use the word. It cannot see an
// owner who has not acted yet, a proxy that has not been upgraded yet, or a
// blacklist you are not on today. It measures the round trip as it stands now,
// names the route, and states the slippage that size needs. Everything it
// cannot see is listed in the answer rather than implied away.
import {
  QUOTES, BNB_PAIR, WBNB, QUOTER, SEL as S, V3_FEES,
  call, hx, addrAt, res2, decStr, rpcBatch, quoteCall,
  classify, priceToken, discover, measureTax, V2_FEE,
} from './scanner-chain.js';

export class RouteError extends Error {
  constructor(headline, detail) {
    super(headline);
    this.headline = headline;
    this.detail = detail;
  }
}

// Constant product with the fee taken off the input, which is what a V2 pool
// does. No call needed: the reserves are already known by the time this runs.
const v2Out = (amountIn, reserveIn, reserveOut, fee) => {
  const eff = amountIn * (1 - fee);
  return (reserveOut * eff) / (reserveIn + eff);
};

const out0 = (h) => (h && h.length >= 66 ? Number(BigInt('0x' + h.slice(2, 66))) : null);

export async function swapRoute(input, opts = {}) {
  // Lowercased at the door, for the reason spelled out in tier-scan.js.
  const address = String(input || '').toLowerCase();
  const usd = Number(opts.usd) > 0 ? Number(opts.usd) : 250;

  let what;
  try { what = await classify(address); }
  catch {
    throw new RouteError('The chain did not answer.',
      'The public BSC node refused or timed out. Nothing is cached here, so a retry in a few seconds usually works.');
  }
  if (what.kind !== 'token' && what.kind !== 'v2pair' && what.kind !== 'v3pool') {
    throw new RouteError('That address is not a token or a pool.', 'Nothing to route through.');
  }

  const base = await rpcBatch([call(BNB_PAIR, S.reserves), call(BNB_PAIR, S.token0)]);
  const br = res2(base[0]);
  const bnbUsd = br ? (addrAt(base[1]) === WBNB ? br[1] / br[0] : br[0] / br[1]) : 0;
  if (!(bnbUsd > 0)) throw new RouteError('Could not price BNB.', 'The reference pool read back empty.');

  let token = address;
  if (what.kind === 'v2pair' || what.kind === 'v3pool') {
    const [a, b] = [what.token0, what.token1];
    const qa = QUOTES.find(([x]) => x === a), qb = QUOTES.find(([x]) => x === b);
    token = qa && !qb ? b : qb && !qa ? a : a;
  }

  const meta = await rpcBatch([call(token, S.decimals), call(token, S.symbol)]);
  const dec = Number(hx(meta[0])) || 18;
  const sym = decStr(meta[1]).slice(0, 12) || null;

  const cands = await discover(token, dec, bnbUsd);
  if (!cands.length)
    throw new RouteError('No pool found for that address.',
      'Every fee tier against BNB, USDT, BUSD, USDC and USD1 was asked directly, and none of them has a pool.');

  const quote = cands[0].quote;
  const known = QUOTES.find(([x]) => x === quote);
  const quoteSym = known ? known[1] : (await priceToken(quote, bnbUsd)).sym;
  const quoteUsd = known ? (known[2] ? 1 : bnbUsd) : (await priceToken(quote, bnbUsd)).usd;

  // Only routes against the one quote the pair is deepest in, and only
  // PancakeSwap. Comparing a PancakeSwap pool against a Biswap one would answer
  // "where is this cheapest on the chain", which is a fair question and not
  // this one — and mixing the two under one heading is how the previous build
  // of the tier tool was wrong about most of its rows.
  const routes = cands.filter((c) => c.quote === quote
    && (c.kind === 'v3' || c.venue === 'PancakeSwap V2'));
  if (!routes.length)
    throw new RouteError('No PancakeSwap route against this pair\'s deepest quote.',
      'It trades elsewhere. Naming another venue here would answer a different question from the one asked.');

  const amountIn = usd / quoteUsd;
  const amountInRaw = BigInt(Math.floor(amountIn * 1e18));

  // Every V3 tier asked for a real quote at the real size, in one batch. The
  // quoter walks the ticks, so what comes back is the fill including every
  // crossing — an estimate of the trade would be a different number.
  const v3 = routes.filter((r) => r.kind === 'v3');
  const v3Quotes = v3.length
    ? await rpcBatch(v3.map((r) => call(QUOTER, quoteCall(quote, token, amountInRaw, r.feeRaw))))
    : [];

  const legs = [];
  routes.forEach((r) => {
    if (r.kind === 'v3') {
      const i = v3.indexOf(r);
      const got = out0(v3Quotes[i]);
      legs.push({
        route: `V3 ${(r.fee * 100).toFixed(2)}%`, kind: 'v3', pool: r.pair, feeRaw: r.feeRaw,
        out: got == null ? null : got / 10 ** dec,
        quoted: got != null,
      });
    } else {
      // The V2 leg needs no quoter: the pool is two reserves and a fee, and the
      // arithmetic is exact rather than approximate.
      const got = v2Out(amountIn, r.q, r.tok, V2_FEE);
      legs.push({ route: 'V2 0.25%', kind: 'v2', pool: r.pair, out: got, quoted: got > 0, reserves: { quote: r.q, token: r.tok } });
    }
  });

  const quotable = legs.filter((l) => l.quoted && l.out > 0).sort((a, b) => b.out - a.out);
  if (!quotable.length)
    throw new RouteError('No route quoted at this size.',
      `Every PancakeSwap pool for ${sym || 'this token'} against ${quoteSym} refused or returned nothing for $${usd}. That is a statement about this size, not about the token: try a smaller one.`);

  const best = quotable[0];

  // THE TRANSFER TAX FIRST, because the round trip is wrong without it.
  //
  // Measured from trades that executed rather than read off a label, and it has
  // to come before the round trip rather than after: the tax is taken OUTSIDE
  // the pool, so no quoter can see it. The first version of this quoted both
  // legs and reported that $BOBAI — a token with a published 3% tax — returns
  // 98.6% of a round trip. Every digit was correct about the pools and the
  // sentence it formed was false.
  //
  // token0/token1 order is asked of the winning pool rather than assumed. The
  // first version passed null for it and measureTax answered "no readable
  // transfers" on a pair that trades every block — an argument mistake that
  // arrives looking exactly like a quiet token.
  const zero = await rpcBatch([call(best.pool, S.token0)]);
  const tax = await measureTax(token, best.pool, addrAt(zero[0]) === token, best.kind)
    .catch(() => ({ ok: false, reason: 'not measurable' }));
  const taxBuy = tax.ok && tax.buy != null ? tax.buy : 0;
  const taxSell = tax.ok && tax.sell != null ? tax.sell : 0;

  // THE ROUND TRIP. Buy at this size, then sell the proceeds straight back on
  // the same route. Both legs are quoted by the venue, and the amounts carried
  // between them are the ones that would really arrive: the tax comes off what
  // the buy delivers, and again off what the sell hands to the pool.
  const received = best.out * (1 - taxBuy);
  const reachesPool = received * (1 - taxSell);
  let backOut = null;
  if (best.kind === 'v3') {
    const r = await rpcBatch([call(QUOTER, quoteCall(token, quote, BigInt(Math.floor(reachesPool * 10 ** dec)), best.feeRaw))]);
    const g = out0(r[0]);
    backOut = g == null ? null : g / 1e18;
  } else {
    const leg = legs.find((l) => l.kind === 'v2');
    backOut = v2Out(reachesPool, leg.reserves.token, leg.reserves.quote, V2_FEE);
  }
  const roundTripPct = backOut == null ? null : (backOut / amountIn - 1) * 100;

  // The same trip through the pools alone, so the tax's share of the loss is
  // visible as its own cost rather than blamed on depth.
  let poolOnly = null;
  if (taxBuy === 0 && taxSell === 0) {
    poolOnly = backOut;
  } else if (best.kind === 'v2') {
    const leg = legs.find((l) => l.kind === 'v2');
    poolOnly = v2Out(best.out, leg.reserves.token, leg.reserves.quote, V2_FEE);
  } else {
    const r = await rpcBatch([call(QUOTER, quoteCall(token, quote, BigInt(Math.floor(best.out * 10 ** dec)), best.feeRaw))]);
    const g = out0(r[0]);
    poolOnly = g == null ? null : g / 1e18;
  }

  // What slippage this trade actually needs. Two pool fees plus both sides of
  // the tax plus the price the trade itself moves, with headroom. A
  // fee-on-transfer token gets the floor this project already uses, because
  // routers compare the pre-tax quote against the post-tax delivery and a
  // "correct" tolerance rejects the trade every time.
  const fot = taxBuy > 0.001 || taxSell > 0.001;
  const impactPct = roundTripPct == null ? null : Math.abs(roundTripPct) / 2;
  const slippageBps = fot
    ? 1500
    : Math.max(50, Math.ceil(((impactPct || 0) + 0.5) * 100));

  const refusals = [];
  if (backOut == null)
    refusals.push('The sell side could not be quoted at all on the best route. A buy that quotes and a sell that does not is the exact shape this check exists to catch — do not trade this automatically.');
  if (roundTripPct != null && roundTripPct < -50)
    refusals.push(`An immediate round trip returns ${(100 + roundTripPct).toFixed(1)}% of what went in. Whatever the cause, it is not a cost anybody would accept knowingly.`);

  return {
    tool: 'pancakeswap_swap_route',
    token: { address: token, symbol: sym, decimals: dec },
    quote: { address: quote, symbol: quoteSym },
    size_usd: usd,
    // What that size is in the quote token, and the exact raw amount the
    // quoter was asked about. Without it nobody can put the same question to
    // a second venue: a cross-check that re-derives the input from its own
    // price feed is comparing two questions, not two answers.
    you_pay: { amount: +amountIn.toFixed(8), symbol: quoteSym, raw: amountInRaw.toString() },
    routes: legs.map((l) => ({
      route: l.route, pool: l.pool,
      quoted: l.quoted,
      out_tokens: l.out == null ? null : +l.out.toFixed(8),
      // How much worse than the best route, at this size. The number an agent
      // is choosing between, rather than the depth every interface shows.
      worse_than_best_pct: l.out > 0 && best.out > 0 ? +(((best.out / l.out) - 1) * 100).toFixed(4) : null,
    })),
    best_route: best.route,
    best_route_pool: best.pool,
    // Named explicitly, because "the deepest pool" is what every other source
    // would have told you and it is regularly not this one.
    best_route_is_the_deepest_pool: best.pool === cands[0].pair,
    you_would_receive: +best.out.toFixed(8),
    round_trip: {
      sell_back_immediately: backOut == null ? null : +backOut.toFixed(8),
      // THE figure: what actually comes back, transfer tax included.
      you_keep_pct: roundTripPct == null ? null : +(100 + roundTripPct).toFixed(2),
      you_keep_pct_pools_only: poolOnly == null ? null : +((poolOnly / amountIn) * 100).toFixed(2),
      note: 'Buy at this size, sell the proceeds straight back on the same route. Both legs quoted by the venue; the measured transfer tax is applied to the amounts carried between them, because it is taken outside the pool where no quoter can see it. Two pool fees and the price your own trade moves are in it too, so a healthy untaxed pair does not return 100% either.',
    },
    transfer_tax: tax.ok
      ? { buy_pct: tax.buy == null ? null : +(tax.buy * 100).toFixed(2),
          sell_pct: tax.sell == null ? null : +(tax.sell * 100).toFixed(2),
          source: 'measured from executed trades on-chain' }
      : { buy_pct: null, sell_pct: null, source: `not measurable (${tax.reason || 'no readable trades'})` },
    slippage_bps_needed: slippageBps,
    slippage_note: fot
      ? 'This token takes a cut on transfer, so a router compares its pre-tax quote against a post-tax delivery. Anything under about 1500 bps reverts every time, and the tolerance is not the loss — the tax is taken either way.'
      : 'Covers the pool fee, the price this size moves, and headroom. Setting it lower does not save money; it fails the trade.',
    refuse_to_trade: refusals,
    // A tax measured on one side only makes the round trip OPTIMISTIC, and the
    // reader has to be told which way the error runs. Silence here would be the
    // same mistake as leaving the tax out entirely, one notch quieter.
    round_trip_caveat: tax.ok && (tax.buy == null || tax.sell == null)
      ? `Only the ${tax.buy == null ? 'sell' : 'buy'} side of the transfer tax could be measured in this window, so the round trip above is better than the real one by whatever the other side charges.`
      : (!tax.ok
        ? 'No transfer tax could be measured from recent trades, so the round trip is the pools alone. If this token takes a cut, the real figure is lower than the one above.'
        : null),
    cannot_see: [
      'An owner who has not acted yet, a proxy that has not been upgraded yet, or a blacklist you are not on today. This is the round trip as it stands right now.',
      'Anything off-chain: the team, the socials, the deployer\'s history.',
      'Routes outside PancakeSwap. The same token often trades on Uniswap V2 and Biswap, and comparing across venues is a fair question this deliberately does not answer.',
    ],
  };
}
