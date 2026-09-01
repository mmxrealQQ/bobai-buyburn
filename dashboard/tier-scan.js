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
  QUOTES, BNB_PAIR, WBNB, LOGS_RPC, LOGS_RPCS, SEL as S,
  call, hx, addrAt, res2, decStr, rpcBatch, rpc,
  classify, priceToken, discover,
  SWAP_T, SWAP_V3_T, SWAP_V3_UNI, int256,
  bandDepthV2, bandDepthV3, windowMinutes,
} from './scanner-chain.js';

// How wide "at the price" is taken to be. Two percent is not a preference: it
// is roughly where a position stops being a liquidity position and starts being
// a bet on direction, and it is narrow enough that the answer differs per tier
// instead of converging on the balance sheet. It travels with every figure
// derived from it, because a working-capital number without its band is not a
// number anybody can check.
const BAND_PCT = 2;

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
  // NORMALISED HERE, not left to the caller.
  //
  // Everything downstream compares addresses as strings — which side of a pool
  // the token is, which candidate is the same pool, whether a quote is one of
  // the known ones — and `addrAt` returns them lowercase. A checksummed address
  // therefore matches nothing, and the failure is not an error: the comparisons
  // simply all come out false, the token gets priced through the wrong path,
  // and the answer arrives complete and wrong. Measured 2026-09-01 with CAKE:
  // the identical address in checksum case reported the V2 pool as holding
  // $6.48 BILLION against its true $17.4 million, with no warning of any kind.
  // Every caller today happens to lowercase; the next one will not.
  input = String(input || '').toLowerCase();
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

  // WHERE THE CAPITAL ACTUALLY STANDS, read before the ladder is walked.
  //
  // Until now every figure here divided fees by what the pool contract holds,
  // with a caveat admitting that V3 balances include liquidity parked outside
  // the price range, earning nothing. That caveat is now a measurement: the
  // pool's own tick data says how much of each side stands within two percent
  // of the current price, which is the capital a new dollar would actually be
  // competing with. Asked for every V3 tier in one batched pass rather than
  // per tier, because tier-by-tier is the pattern that came back half-read.
  const v3rows = mine.filter((c) => c.kind === 'v3');
  let bandByPool = new Map();
  try {
    const got = await bandDepthV3(v3rows.map((c) => c.pair), BAND_PCT);
    v3rows.forEach((c, i) => { if (got[i]) bandByPool.set(c.pair, got[i]); });
  } catch { bandByPool = new Map(); }

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
    // One endpoint serves these ranges and it rate-limits, so a refusal is
    // often a queue rather than a verdict. Retried once, briefly, because five
    // tiers asked back to back while three other probes are also reading logs
    // was enough to have every tier come back unmeasured — which then rendered
    // as "nothing traded" for a pair that trades every block.
    //
    // Three attempts across both endpoints that were measured to serve this
    // range at all, starting from a different one per tier so five tiers do not
    // queue behind each other on the same host. Measured 2026-08-29: five
    // concurrent callers left 0 to 2 of 5 tiers readable, against 4 to 5 when
    // asked one at a time.
    let logs = null;
    for (let attempt = 0; attempt < 3 && logs === null; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt));
      const endpoint = LOGS_RPCS[(i + attempt) % LOGS_RPCS.length];
      try {
        logs = await rpc('eth_getLogs', [{
          address: c.pair, topics,
          fromBlock: '0x' + from.toString(16), toBlock: '0x' + head.toString(16),
        }], endpoint);
      } catch { logs = null; }
    }

    const capitalUsd = tokenUsd == null ? null : c.q * c.usd + c.tok * tokenUsd;

    // The same band question asked of both pool shapes, because exempting V2
    // would smuggle the old answer back in. A constant-product pool is a
    // full-range position, so the share of it standing within two percent is
    // 1 - 1/sqrt(1.02) — about 0.985% — no matter how large the pool is. That
    // is not a flaw in V2 and it is not an argument against it; it is the
    // reason a $40M V2 pool and a $2M V3 pool can be the same size where it
    // counts, and neither pool's own interface will ever tell you that.
    const tokenIs0 = !quoteIs0;
    let band = null;
    if (c.kind === 'v3') band = bandByPool.get(c.pair) || null;
    else {
      const rTok = c.tok * Math.pow(10, tokDec), rQ = c.q * 1e18;
      band = bandDepthV2(tokenIs0 ? rTok : rQ, tokenIs0 ? rQ : rTok, BAND_PCT);
    }
    let workingUsd = null, workingShare = null;
    if (band && tokenUsd != null) {
      const tokAmt = (tokenIs0 ? band.amount0 : band.amount1) / Math.pow(10, tokDec);
      const qAmt = (tokenIs0 ? band.amount1 : band.amount0) / 1e18;
      // An amount inside the band can never exceed what the contract holds. If
      // it does, the walk is wrong and the honest output is nothing at all —
      // a number that fails its own arithmetic must not be published because
      // it happens to look reasonable.
      if (tokAmt <= c.tok * 1.005 && qAmt <= c.q * 1.005) {
        workingUsd = tokAmt * tokenUsd + qAmt * c.usd;
        workingShare = capitalUsd > 0 ? (workingUsd / capitalUsd) * 100 : null;
      }
    }

    const row = {
      tier: label(c), venue: c.venue, pool: c.pair,
      fee_pct: +(c.fee * 100).toFixed(4),
      quote_held: +c.q.toFixed(6),
      quote_held_usd: +(c.q * c.usd).toFixed(2),
      token_held: +c.tok.toFixed(6),
      // BOTH sides of the pool, because an LP puts up both and is paid on both.
      // bsc_pool_scan's liquidityUsd for the same pool is the quote side only —
      // a deliberately more conservative figure for a different question — and
      // the two are labelled rather than reconciled, because reconciling them
      // would mean one of the questions getting the wrong answer.
      capital_usd: capitalUsd == null ? null : +capitalUsd.toFixed(2),
      // The capital standing within the band, and how little of the balance
      // that can be. Null rather than zero when it could not be read: an empty
      // band and an unread one are opposite facts.
      working_capital_usd: workingUsd == null ? null : +workingUsd.toFixed(2),
      working_share_pct: workingShare == null ? null : +workingShare.toFixed(2),
      band_pct: BAND_PCT,
      band_complete: band ? band.complete !== false : null,
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
      // The same fees over the capital that was actually in a position to earn
      // them. This is the figure an LP is choosing between tiers with; the one
      // above is the figure every interface shows instead.
      row.fees_per_1000_usd_working =
        workingUsd > 0 ? +(((fees * c.usd) / workingUsd) * 1000).toFixed(6) : null;
    }
    tiers.push(row);
  }

  const measured = tiers.filter((v) => v.measured);
  const traded = measured
    .filter((v) => v.fees_per_1000_usd_parked != null && v.volume_usd > 0)
    .sort((a, b) => b.fees_per_1000_usd_parked - a.fees_per_1000_usd_parked);

  // The ranking the whole tool is for, run a second time over the denominator
  // that was previously only apologised for. It is withheld under exactly the
  // same conditions as the first one, plus one of its own: every band must have
  // been read whole. A tier whose tick set was truncated has a working figure
  // that is too small in a direction that would flatter its rivals.
  const bandsWhole = tiers.every((v) => v.band_complete !== false);
  const working = measured
    .filter((v) => v.fees_per_1000_usd_working != null && v.volume_usd > 0)
    .sort((a, b) => b.fees_per_1000_usd_working - a.fees_per_1000_usd_working);
  const mostWorking = [...tiers]
    .filter((v) => v.working_capital_usd != null)
    .sort((a, b) => b.working_capital_usd - a.working_capital_usd)[0];

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
    // How many tiers were actually read, kept separate from how many exist.
    // Without this, a run where the log endpoint refused every range is
    // indistinguishable from a pair that nobody traded — the two look the same
    // from outside and mean opposite things, and the first is about us.
    tiers_measured: measured.length,
    tiers_found: tiers.length,
    // WHY THE VERDICT GOES NULL WHEN A TIER COULD NOT BE READ
    //
    // These three fields used to be computed over whatever happened to be
    // readable, and that turned a throttled request into a wrong answer instead
    // of a missing one. Measured on 2026-08-29 with five callers at once: asked
    // one at a time, CAKE/WBNB reports V3 0.01% as the best-paying tier; asked
    // concurrently, two of five tiers came back unreadable and the same endpoint
    // answered "V2 0.25%" — the tier with the most capital, which is exactly the
    // wrong answer this tool exists to correct, delivered with no sign that
    // anything had been skipped.
    //
    // A ranking over an unknown subset is not a ranking. So the headline verdict
    // is withheld unless every tier was read, and the partial result is still
    // offered under a name that says what it is.
    comparison_complete: measured.length === tiers.length,
    tiers_unreadable: tiers.filter((v) => !v.measured).map((v) => v.tier),
    // The two answers side by side are the whole point: an LP is shown the
    // first number everywhere and needs the second one.
    best_paying_tier: measured.length === tiers.length && traded.length ? traded[0].tier : null,
    best_paying_tier_among_readable: traded.length ? traded[0].tier : null,
    most_capital_tier: mostCapital ? mostCapital.tier : null,
    // THE SECOND ANSWER, over working capital rather than parked capital.
    //
    // Both are kept and neither replaces the other. Fees over parked capital is
    // what a tier returns on the money committed to it, which is the honest
    // answer for capital already sitting there. Fees over working capital is
    // what a tier returns on the money that was in a position to earn, which is
    // the honest answer for a dollar not yet committed. They disagree often,
    // and the disagreement is the finding, not an error to be reconciled away.
    band_pct: BAND_PCT,
    bands_complete: bandsWhole,
    best_paying_tier_by_working_capital:
      measured.length === tiers.length && bandsWhole && working.length ? working[0].tier : null,
    best_paying_tier_by_working_capital_among_readable: working.length ? working[0].tier : null,
    most_working_capital_tier: mostWorking ? mostWorking.tier : null,
    // Does changing the denominator change the answer? When it does, every
    // interface an LP can consult is pointing at the other tier.
    working_capital_changes_the_answer:
      measured.length === tiers.length && bandsWhole && working.length && traded.length
        ? working[0].tier !== traded[0].tier
        : null,
    capital_is_in_the_best_paying_tier:
      measured.length === tiers.length && traded.length && mostCapital
        ? traded[0].tier === mostCapital.tier
        : null,
    idle_capital: idle,
    // Not part of the comparison, and named so that is visible. An LP looking
    // at the wrong pair entirely is a likelier mistake than an LP in the wrong
    // tier, so the other quotes come first.
    same_venue_other_quotes: otherQuotes,
    other_venues: otherVenues,
    caveats: [
      'Capital is both sides of the pool in dollars, not one side. On V3 the two sides are not worth the same, and dividing by one of them makes the identical pool look several times better or worse depending on which token you call the quote.',
      `Capital is what the pool contract holds. Working capital is the part of it standing within ${BAND_PCT}% of the current price, read from the pool's own tick data — the rest is on the balance sheet and earns nothing while the price is where it is. The two denominators answer different questions and both are given: parked capital is what a tier returns on money already committed to it, working capital is what it returns on a dollar you have not committed yet.`,
      `Working capital assumes the price stays inside the band. It will not stay there forever, and a position placed there stops earning the moment it leaves — so the working figure is the better guide to where a dollar earns today and says nothing about how long it keeps earning.`,
      'The tick walk behind the working figure was checked against PancakeSwap\'s own quoter on live pools and agreed to within 0.002%, the difference being the pool rounding in its own favour at every tick it crosses.',
      tokenUsd == null
        ? 'This token could not be priced against BNB, so no pool could be totalled and no tier is ranked. The per-tier turnover below is still measured.'
        : `Token priced at ${tokPrice.direct ? 'its own quote' : 'one hop through BNB'}; the pool totals inherit that.`,
      'Fees are the pool fee applied to measured turnover. PancakeSwap pays a share of that to the protocol, so what reaches liquidity providers is somewhat less.',
      'Impermanent loss is not in this figure. A tier can pay best and still be the worse place to be.',
      measured.length === 0
        ? 'No tier could be read: the log endpoint refused every range. This says nothing about whether the pair traded — it says the measurement did not happen. Retry.'
        : traded.length === 0
          ? `Nothing traded on any of the ${measured.length} tiers that could be read, so no tier is ranked.`
          : measured.length < tiers.length
            ? `Incomplete: ${tiers.length - measured.length} of ${tiers.length} tiers could not be read, so no winner is declared. A ranking over an unknown subset would name whichever tier happened to be readable, and the tiers that go missing under load are not random — they are the ones being asked about most. The partial result is in best_paying_tier_among_readable. Retry for a complete one.`
            : `Ranking covers the ${traded.length} of ${measured.length} readable tiers that traded in this window.`,
    ],
  };
}
