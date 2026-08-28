// Which PancakeSwap fee tier is actually paying its liquidity providers.
//
// A pair on PancakeSwap does not live in one pool. It lives in up to five at
// once: V2 at 0.25%, and V3 at 0.01%, 0.05%, 0.25% and 1.00%. They share a
// price and compete for the same flow, and a liquidity provider has to pick
// one. Every source an LP can consult ranks those pools by the money already
// parked in them, which is the one number that does not answer the question.
//
// Measured on six of the busiest pairs on the chain, the tier holding the most
// capital was usually not the tier paying best, and on WBNB/USDT it was beaten
// by a pool holding a fifth as much. On USDC/USDT the tier with the most money
// in it paid the least of the three that traded at all. And a 1.00% pool exists
// on every pair, holds real money on every pair, and traded on none of them.
//
// So this returns one figure per tier: the swap fees the pool actually paid out
// over a measured window, divided by the quote-side capital sitting in it.
// Nothing here is annualised. The window is around forty minutes of real chain
// and is reported in the answer, because a forty-minute sample multiplied into
// an APR is exactly the kind of number this project exists to stop repeating.
//
// PancakeSwap only, deliberately. The same token often trades on Uniswap V2 and
// Biswap too, and those pools are named in the answer and excluded from the
// comparison — a tier ranking is a question about one venue's fee ladder, and
// silently folding another venue into it would answer a different question.
import {
  QUOTES, BNB_PAIR, WBNB, LOGS_RPC, SEL as S,
  call, hx, addrAt, res2, decStr, rpcBatch, rpc,
  classify, priceToken, discover,
  SWAP_T, SWAP_V3_T, SWAP_V3_UNI, int256,
} from './scanner-chain.js';

export class TierError extends Error {
  constructor(headline, detail) {
    super(headline);
    this.headline = headline;
    this.detail = detail;
  }
}

const PANCAKE_V2 = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
const abs = (v) => (v < 0n ? -v : v);
const label = (c) => (c.kind === 'v2' ? 'V2 0.25%' : 'V3 ' + (c.fee * 100).toFixed(2) + '%');

// How long the readable window actually is, asked of the chain rather than
// derived from a block time. BSC's has changed three times, and the build that
// assumed one printed "2 hours" over a 38-minute window for months.
const windowMinutes = async (from, to) => {
  try {
    const [a, b] = await Promise.all([
      rpc('eth_getBlockByNumber', ['0x' + from.toString(16), false], LOGS_RPC),
      rpc('eth_getBlockByNumber', ['0x' + to.toString(16), false], LOGS_RPC),
    ]);
    const s = parseInt(b.timestamp, 16) - parseInt(a.timestamp, 16);
    return s > 0 ? s / 60 : null;
  } catch { return null; }
};

// The quote-side turnover this pool handled in the window. V3 states the two
// amounts as signed integers from the pool's point of view; V2 states four
// unsigned ones, of which only one per side is ever non-zero.
const turnover = (logs, kind, quoteIs0) => {
  const U = (h) => BigInt('0x' + h);
  let v = 0n;
  for (const L of logs) {
    const d = L.data.slice(2);
    if (kind === 'v3') {
      v += abs(quoteIs0 ? int256(d.slice(0, 64)) : int256(d.slice(64, 128)));
    } else {
      const a0i = U(d.slice(0, 64)), a1i = U(d.slice(64, 128));
      const a0o = U(d.slice(128, 192)), a1o = U(d.slice(192, 256));
      v += quoteIs0 ? a0i + a0o : a1i + a1o;
    }
  }
  return Number(v) / 1e18;
};

export async function feeTiers(input) {
  let what;
  try {
    what = await classify(input);
  } catch {
    throw new TierError(
      'The chain did not answer.',
      'The public BSC node refused or timed out. Nothing is cached here, so a retry in a few seconds usually works.',
    );
  }

  const base = await rpcBatch([call(BNB_PAIR, S.reserves), call(BNB_PAIR, S.token0)]);
  const br = res2(base[0]);
  const bnbUsd = br ? (addrAt(base[1]) === WBNB ? br[1] / br[0] : br[0] / br[1]) : 0;
  if (!(bnbUsd > 0))
    throw new TierError('Could not price BNB.', 'The reference pool read back empty.');

  // A pasted pool fixes both sides of the pair. A pasted token leaves the quote
  // open, and the honest default is the quote its own liquidity already chose:
  // the deepest pool's, not a favourite of ours.
  let token = input, pinnedQuote = null;
  if (what.kind === 'v2pair' || what.kind === 'v3pool') {
    const [a, b] = [what.token0, what.token1];
    const qa = QUOTES.find(([x]) => x === a), qb = QUOTES.find(([x]) => x === b);
    token = qa && !qb ? b : qb && !qa ? a : a;
    pinnedQuote = token === a ? b : a;
  }

  const info = await rpcBatch([call(token, S.decimals), call(token, S.symbol)]);
  const tokDec = Number(hx(info[0])) || 18;
  const tokSym = decStr(info[1]).slice(0, 12) || null;

  const cands = await discover(token, tokDec, bnbUsd);
  if (!cands.length)
    throw new TierError(
      'No pool found for that address.',
      'The factories were asked directly for every fee tier against BNB, USDT, BUSD, USDC and USD1, and none of them has a pool.',
    );

  const quote = pinnedQuote || cands[0].quote;
  const known = QUOTES.find(([x]) => x === quote);
  const quoteSym = known ? known[1] : (await priceToken(quote, bnbUsd)).sym;

  // The denominator has to be the whole pool, not one side of it.
  //
  // The first build divided fees by the quote-side balance, and on V2 that is
  // harmless because the two sides are worth the same by construction. On V3
  // they are not: the same WBNB/USDT 0.01% pool held $3.4M of BNB against $8.7M
  // of USDT, so calling BNB the quote made it look four times better than
  // calling USDT the quote — for the identical pool, in the identical window.
  // A liquidity provider puts up both sides, so both sides are the capital.
  const tokPrice = await priceToken(token, bnbUsd);
  const tokenUsd = tokPrice.usd;

  // PancakeSwap's own ladder against one quote, and only that. What is left out
  // is named rather than dropped — but in the two shapes it actually has, which
  // is not one shape. A PancakeSwap pool against a different quote is the same
  // venue answering a different question; a Biswap pool is a different venue.
  // Listing both as "other venues excluded" was wrong about most of the rows.
  const isMine = (c) => c.quote === quote && (c.kind === 'v3' || c.factory === PANCAKE_V2);
  const mine = cands.filter(isMine);
  const rest = cands.filter((c) => !isMine(c));
  const roll = (rows, key) => {
    const m = new Map();
    for (const c of rows) {
      const k = key(c);
      // Keyed by the serialised fields, not the object: two identical shapes
      // are two different Map keys otherwise, and nothing would ever group.
      const id = JSON.stringify(k);
      const at = m.get(id) || { ...k, pools: 0, held_usd: 0 };
      at.pools += 1;
      at.held_usd += c.q * c.usd;
      m.set(id, at);
    }
    return [...m.values()]
      .map((r) => ({ ...r, held_usd: +r.held_usd.toFixed(2) }))
      .sort((a, b) => b.held_usd - a.held_usd);
  };
  const otherQuotes = roll(
    rest.filter((c) => c.kind === 'v3' || c.factory === PANCAKE_V2),
    (c) => ({ quote: c.sym }),
  );
  const otherVenues = roll(
    rest.filter((c) => c.kind !== 'v3' && c.factory !== PANCAKE_V2),
    (c) => ({ venue: c.venue, quote: c.sym }),
  );
  if (!mine.length)
    throw new TierError(
      'That token has no PancakeSwap pool against its deepest quote.',
      'It trades on other venues only, and comparing PancakeSwap fee tiers is not a question that has an answer here.',
    );

  const head = parseInt(await rpc('eth_blockNumber', [], LOGS_RPC), 16);
  // One window, and only one: this endpoint serves roughly 5,000 blocks at the
  // head and answers anything older by demanding a personal token.
  const from = head - 4999;

  // Which data word is the quote side. The factories sort token0 below token1,
  // so this is derivable — but it is asked anyway, because the whole figure
  // inverts if it is ever wrong and one batched call is cheap insurance.
  const zeros = await rpcBatch(mine.map((c) => call(c.pair, S.token0)));

  // The ladder is read in ladder order — V2 first, then V3 by rising fee. The
  // discovery order is by depth, which changes between two calls a minute apart
  // and would make the same pair look reshuffled every time it is asked about.
  const order = mine
    .map((c, i) => ({ c, zero: zeros[i] }))
    .sort((a, b) =>
      (a.c.kind === 'v2' ? -1 : 0) - (b.c.kind === 'v2' ? -1 : 0) || a.c.fee - b.c.fee);

  const tiers = [];
  for (let i = 0; i < order.length; i++) {
    const c = order[i].c;
    const quoteIs0 = addrAt(order[i].zero) === quote;
    const topics = [c.kind === 'v3' ? [SWAP_V3_T, SWAP_V3_UNI] : SWAP_T];
    let logs = null;
    try {
      logs = await rpc('eth_getLogs', [{
        address: c.pair, topics,
        fromBlock: '0x' + from.toString(16), toBlock: '0x' + head.toString(16),
      }], LOGS_RPC);
    } catch { logs = null; }

    const capitalUsd = tokenUsd == null ? null : c.q * c.usd + c.tok * tokenUsd;
    const row = {
      tier: label(c), venue: c.venue, pool: c.pair,
      fee_pct: +(c.fee * 100).toFixed(4),
      quote_held: +c.q.toFixed(6),
      quote_held_usd: +(c.q * c.usd).toFixed(2),
      token_held: +c.tok.toFixed(6),
      capital_usd: capitalUsd == null ? null : +capitalUsd.toFixed(2),
    };
    // A refused range and a quiet pool arrive as the same emptiness and mean
    // opposite things. Only one of them may be reported as a fact about a pool.
    if (!logs) {
      row.measured = false;
      row.reason = 'the log endpoint refused this range';
    } else {
      const vol = turnover(logs, c.kind, quoteIs0);
      const fees = vol * c.fee;
      row.measured = true;
      row.swaps = logs.length;
      row.volume_quote = +vol.toFixed(6);
      row.volume_usd = +(vol * c.usd).toFixed(2);
      row.fees_paid_usd = +(fees * c.usd).toFixed(6);
      row.fees_per_1000_usd_parked =
        capitalUsd > 0 ? +(((fees * c.usd) / capitalUsd) * 1000).toFixed(6) : null;
    }
    tiers.push(row);
  }

  const measured = tiers.filter((v) => v.measured);
  const traded = measured
    .filter((v) => v.fees_per_1000_usd_parked != null && v.volume_usd > 0)
    .sort((a, b) => b.fees_per_1000_usd_parked - a.fees_per_1000_usd_parked);

  const minutes = await windowMinutes(from, head);
  const mostCapital = [...tiers]
    .filter((v) => v.capital_usd != null)
    .sort((a, b) => b.capital_usd - a.capital_usd)[0];
  const idle = measured
    .filter((v) => v.volume_usd === 0 && (v.capital_usd || 0) >= 100)
    .map((v) => ({ tier: v.tier, capital_usd: v.capital_usd, pool: v.pool }));

  return {
    token: { address: token, decimals: tokDec, symbol: tokSym || undefined },
    quote: { address: quote, symbol: quoteSym },
    measured_window: {
      from_block: from, to_block: head, blocks: head - from + 1,
      minutes: minutes == null ? null : +minutes.toFixed(1),
      note: 'A single sample of live chain, not a rate. It is not annualised here and should not be annualised from here: forty minutes of flow says what happened in forty minutes.',
    },
    tiers,
    // The two answers side by side are the whole point: an LP is shown the
    // first number everywhere and needs the second one.
    best_paying_tier: traded.length ? traded[0].tier : null,
    most_capital_tier: mostCapital ? mostCapital.tier : null,
    capital_is_in_the_best_paying_tier:
      traded.length && mostCapital ? traded[0].tier === mostCapital.tier : null,
    idle_capital: idle,
    // Not part of the comparison, and named so that is visible. An LP looking
    // at the wrong pair entirely is a likelier mistake than an LP in the wrong
    // tier, so the other quotes come first.
    same_venue_other_quotes: otherQuotes,
    other_venues: otherVenues,
    caveats: [
      'Capital is both sides of the pool in dollars, not one side. On V3 the two sides are not worth the same, and dividing by one of them makes the identical pool look several times better or worse depending on which token you call the quote.',
      'Capital is what the pool contract holds. In V3 that includes liquidity sitting outside the current price range, which earns nothing — so a well-placed narrow position earns more than the tier figure here, and this number is the pool average rather than any one position.',
      tokenUsd == null
        ? 'This token could not be priced against BNB, so no pool could be totalled and no tier is ranked. The per-tier turnover below is still measured.'
        : `Token priced at ${tokPrice.direct ? 'its own quote' : 'one hop through BNB'}; the pool totals inherit that.`,
      'Fees are the pool fee applied to measured turnover. PancakeSwap pays a share of that to the protocol, so what reaches liquidity providers is somewhat less.',
      'Impermanent loss is not in this figure. A tier can pay best and still be the worse place to be.',
      traded.length === 0
        ? 'Nothing traded on any tier in this window, so no tier is ranked.'
        : 'Ranking covers only the tiers that traded in this window.',
    ],
  };
}
