// Where an asset earns most on Venus, and how long a move takes to pay for
// itself.
//
// The third of the four categories. Like the other two it computes rather than
// claims, and like the other two the interesting output is not the headline
// number everybody publishes but the one that decides whether acting on it is
// worth doing.
//
// THE NUMBER EVERY YIELD DASHBOARD GETS WRONG
// Venus quotes interest as a rate per block. Turning that into an APY needs the
// number of blocks in a year, and almost everything published about BSC still
// uses 10,512,000 — the figure for three-second blocks.
//
// BSC does not have three-second blocks any more. Measured against the chain on
// 2026-08-26, one hundred thousand blocks took 45,042 seconds: 0.4504 s per
// block, about 70 million blocks a year. An APY computed with the old constant
// is wrong by a factor of roughly 6.7, and wrong in the flattering direction
// for anyone quoting borrow costs.
//
// So the block time is measured here, from two blocks a hundred thousand apart,
// every time. Nothing is hardcoded, because the last constant everybody trusted
// was also right when it was written.
//
// AND IT IS CHECKED AGAINST THE PROTOCOL
// The health-factor agent cross-checks its arithmetic against Venus's own
// getAccountLiquidity, and says so when the two disagree rather than printing
// the prettier number. The same rule applies here: our APY is compared against
// the APY Venus itself publishes, and a market where they diverge is reported
// as divergent. A yield figure nobody has second-sourced is a guess with a
// decimal point.
//
// THE OUTPUT THAT IS ACTUALLY WORTH PAYING FOR
// Not "market X pays 5.3%". That is on a dozen dashboards for free. It is:
// moving costs gas and, if the asset differs, a swap through a pool of finite
// depth — so at your size, how many days until the better rate has paid for the
// move? Below a certain position size the answer is never, and saying so is
// worth more than a ranked list.
//
// WHAT THIS DOES NOT DO
// It does not move funds, sign anything, or predict where rates go. Venus
// rates float with utilisation and can change in the next block.

import { chain, VENUS } from './venus.js';

const { batchCall, decodeString, word, uint, addrAt, addrArg, SEL, RPCS, BATCH_RPCS } = chain;

const YSEL = {
  supplyRatePerBlock: '0xae9d70b0',
  borrowRatePerBlock: '0xf8f9da28',
  getCash: '0x3b1d21a2',
  totalBorrows: '0x47bd3718',
  supplyCaps: '0x02c3bcbb',
};

const SECONDS_PER_YEAR = 31_536_000;

// An eth_call answer can carry more than one word — a Venus rate came back as
// three, and reading the whole thing as one integer produced 4.26e+144 and an
// APY of Infinity. Only ever take the first word.
const firstWord = (hex) => {
  if (!hex || hex === '0x') return null;
  return BigInt('0x' + word(hex, 0));
};

async function rpc(method, params) {
  for (let i = 0; i < RPCS.length * 2; i++) {
    try {
      const r = await fetch(RPCS[i % RPCS.length], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
    } catch { /* next endpoint */ }
  }
  throw new Error(`no BSC endpoint answered ${method}`);
}

/**
 * Seconds per block, measured rather than assumed.
 * Two blocks a hundred thousand apart: long enough that a single slow block
 * cannot skew it, recent enough to reflect the chain as it runs today.
 */
export async function measureBlockTime(span = 100_000) {
  const latest = Number(BigInt(await rpc('eth_blockNumber', [])));
  const [a, b] = await Promise.all([
    rpc('eth_getBlockByNumber', ['0x' + (latest - span).toString(16), false]),
    rpc('eth_getBlockByNumber', ['0x' + latest.toString(16), false]),
  ]);
  const dt = Number(BigInt(b.timestamp)) - Number(BigInt(a.timestamp));
  if (!(dt > 0)) throw new Error('block timestamps did not advance — cannot measure block time');
  const secondsPerBlock = dt / span;
  return {
    seconds_per_block: +secondsPerBlock.toFixed(4),
    blocks_per_year: Math.round(SECONDS_PER_YEAR / secondsPerBlock),
    measured_over_blocks: span,
    from_block: latest - span,
    to_block: latest,
  };
}

const apyFromRate = (ratePerBlock, blocksPerYear) => {
  const r = Number(ratePerBlock) / 1e18;
  if (!(r > 0)) return 0;
  // Compounding per block. expm1/log1p rather than pow, because (1+3e-10)
  // rounds to 1 in float64 and pow would return exactly zero.
  return (Math.expm1(Math.log1p(r) * blocksPerYear)) * 100;
};

// Venus's own published APY, used as the second source. Fetched, not trusted:
// if it does not answer, the result says the figures are unconfirmed rather
// than quietly presenting one source as two.
async function venusPublished() {
  try {
    // limit=100: the API pages at 20 by default, and the core pool has 55
    // markets — without it the "second source" could cover a third of them
    // at most (2026-09-18). A browser-like agent header, because a bare
    // Worker fetch is what the API has been refusing.
    const r = await fetch('https://api.venus.io/markets/core-pool?chainId=56&limit=100', {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; brainonbnb-yield/1.0; +https://brainonbnb.com)' },
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    const arr = j.result?.markets || j.result || [];
    const by = new Map();
    for (const m of arr) {
      if (!m.address) continue;
      by.set(String(m.address).toLowerCase(), {
        supplyApy: Number(m.supplyApy),
        borrowApy: Number(m.borrowApy),
        symbol: m.symbol,
      });
    }
    return by.size ? by : null;
  } catch { return null; }
}

/**
 * Read every Venus core-pool market and rank it by what it pays a supplier.
 * Read-only.
 */
export async function venusMarkets() {
  const clock = await measureBlockTime();
  const B = clock.blocks_per_year;

  const [marketsHex] = await batchCall([{ to: VENUS.UNITROLLER, data: SEL.getAllMarkets }]);
  const count = Number(uint(marketsHex, 1));
  const vTokens = [];
  for (let i = 0; i < count; i++) vTokens.push(addrAt(marketsHex, 2 + i));

  const [oracleHex] = await batchCall([{ to: VENUS.UNITROLLER, data: SEL.oracle }]);
  const oracle = addrAt(oracleHex, 0);

  // Seven reads per market, not eight. The eighth was underlying(), whose
  // result this function never looked at — 52 calls per run spent on nothing,
  // found while cutting the request count down.
  const PER_MARKET = 7;
  const calls = vTokens.flatMap((v) => ([
    { to: v, data: SEL.symbol },
    { to: v, data: YSEL.supplyRatePerBlock },
    { to: v, data: YSEL.borrowRatePerBlock },
    { to: v, data: YSEL.getCash },
    { to: v, data: YSEL.totalBorrows },
    { to: oracle, data: SEL.getUnderlyingPrice + addrArg(v) },
    { to: VENUS.UNITROLLER, data: SEL.markets + addrArg(v) },
  ]));
  // Three hundred and sixty-four calls, and a public BSC endpoint rejects a
  // JSON-RPC batch anywhere near that size outright. batchCall insists on a
  // complete answer — correctly, since a dropped market is a missing market —
  // so the whole run failed with "no endpoint answered the batch" rather than
  // degrading. Our own telemetry caught it, twice.
  //
  // Chunked, sequentially, with a pause between chunks and one retry each.
  // Sequentially because firing the chunks together at one host recreates the
  // rate limit this project once measured and nearly published as a finding
  // about somebody else.
  //
  // The first attempt used 96 per chunk. It passed from a laptop three runs in
  // a row and failed from the Worker, where the egress address is shared and
  // the public endpoints throttle it far sooner — a reminder that "works on my
  // machine" is a statement about an IP address as much as about code. Smaller
  // chunks, a breath between them, and a second attempt before giving up: a
  // throttled endpoint recovers in well under a second, and failing an entire
  // run over one refused chunk is what took the agent offline.
  // And the chunks are spread across the endpoints rather than queued at one.
  //
  // batchCall walks its endpoint list from index 0 on every call, so ten chunks
  // in a row all hit the same host inside a second and the tenth got refused.
  // That is this project's own lesson arriving in a new place: the census once
  // reported 54 MCP agents instead of 235 for exactly this reason, and nearly
  // published it as a finding about the chain. Rotating the list by chunk gives
  // each endpoint a fifth of the work.
  const CHUNK = 40;
  const res = [];
  for (let i = 0; i < calls.length; i += CHUNK) {
    const slice = calls.slice(i, i + CHUNK);
    const n = i / CHUNK;
    const rotated = BATCH_RPCS.slice(n % BATCH_RPCS.length).concat(BATCH_RPCS.slice(0, n % BATCH_RPCS.length));
    let part;
    try {
      part = await batchCall(slice, { rpcs: rotated });
    } catch {
      await new Promise((r) => setTimeout(r, 400));
      part = await batchCall(slice, { rpcs: rotated });
    }
    res.push(...part);
    if (i + CHUNK < calls.length) await new Promise((r) => setTimeout(r, 120));
  }

  const published = await venusPublished();
  const markets = [];
  const disagreements = [];

  for (let i = 0; i < vTokens.length; i++) {
    const o = i * PER_MARKET;
    const v = vTokens[i];
    const symbol = decodeString(res[o]) || v.slice(0, 8);
    const supplyRate = firstWord(res[o + 1]);
    const borrowRate = firstWord(res[o + 2]);
    if (supplyRate === null || borrowRate === null) continue;

    const supplyApy = apyFromRate(supplyRate, B);
    const borrowApy = apyFromRate(borrowRate, B);

    const cash = firstWord(res[o + 3]) ?? 0n;
    const borrows = firstWord(res[o + 4]) ?? 0n;
    // The oracle prices one whole underlying token, scaled so that price times
    // amount lands in 1e18 regardless of the underlying's own decimals.
    const price = firstWord(res[o + 5]) ?? 0n;
    const collateralFactor = res[o + 6] ? Number(uint(res[o + 6], 1)) / 1e18 : null;

    const liquidityUsd = Number((cash * price) / 10n ** 18n) / 1e18;
    const borrowedUsd = Number((borrows * price) / 10n ** 18n) / 1e18;
    const supplied = liquidityUsd + borrowedUsd;
    const utilisation = supplied > 0 ? borrowedUsd / supplied : 0;

    const theirs = published?.get(v.toLowerCase());
    let agreement = 'unconfirmed — Venus\'s own API did not answer';
    if (theirs && Number.isFinite(theirs.supplyApy)) {
      const diff = Math.abs(theirs.supplyApy - supplyApy);
      // A tenth of a point. Rates move between their snapshot and our block, so
      // exact equality would be the suspicious result, not the reassuring one.
      agreement = diff <= 0.1
        ? 'agrees with Venus'
        : `DISAGREES with Venus: they publish ${theirs.supplyApy.toFixed(4)}%, we compute ${supplyApy.toFixed(4)}%`;
      if (diff > 0.1) disagreements.push({ market: symbol, ours: +supplyApy.toFixed(4), venus: +theirs.supplyApy.toFixed(4) });
    }

    markets.push({
      vtoken: v,
      symbol,
      supply_apy_pct: +supplyApy.toFixed(4),
      borrow_apy_pct: +borrowApy.toFixed(4),
      utilisation_pct: +(utilisation * 100).toFixed(2),
      available_liquidity_usd: Math.round(liquidityUsd),
      total_supplied_usd: Math.round(supplied),
      collateral_factor: collateralFactor,
      cross_check: agreement,
    });
  }

  // A deprecated market keeps its last rate forever while its liquidity goes to
  // zero. vUST currently computes to 1.0e14 % APY that way. Compounding a stale
  // per-block rate over seventy million blocks produces a number that is
  // arithmetically correct and completely meaningless, and printing it at the
  // top of a ranked list would discredit every honest row beneath it.
  //
  // Excluded, not hidden: the reason is returned alongside, because a silent
  // filter is indistinguishable from a bug.
  const PLAUSIBLE_MAX_APY = 1000;
  const excluded = [];
  const live = [];
  for (const m of markets) {
    if (m.supply_apy_pct > PLAUSIBLE_MAX_APY) {
      excluded.push({ symbol: m.symbol, vtoken: m.vtoken, computed_supply_apy_pct: m.supply_apy_pct, available_liquidity_usd: m.available_liquidity_usd, reason: 'rate compounds to an implausible APY — a deprecated market whose per-block rate stopped being updated while its liquidity drained' });
      continue;
    }
    live.push(m);
  }

  live.sort((a, b) => b.supply_apy_pct - a.supply_apy_pct);
  // What "second-sourced" and "disagrees" are counted over: the markets that
  // are ranked. `confirmed` was the size of Venus's list ("55 of 54"), and a
  // market this function itself excludes as deprecated (vUST, 1e14 %) stood in
  // the disagreements (2026-09-18, the first day the API answered in full).
  // A market with next to nothing supplied is left out of the comparison too:
  // Venus publishes 0 for it, the chain still computes its last rate.
  const ranked = new Set(live.map((m) => m.symbol));
  const dust = new Set(live.filter((m) => m.total_supplied_usd < 10000).map((m) => m.symbol));
  const confirmedLive = live.filter((m) => !/^unconfirmed/.test(m.cross_check)).length;
  const realDisagreements = disagreements.filter((d) => ranked.has(d.market) && !dust.has(d.market));
  return { clock, markets: live, excluded, disagreements: realDisagreements, oracle, confirmed: confirmedLive };
}

/**
 * The whole point: given an amount and where it sits today, is moving it worth
 * the cost, and after how long?
 */
export async function yieldPlan(input = {}) {
  const amountUsd = Number(input.amountUsd ?? input.amount_usd ?? input.usd ?? 0);
  const fromSymbol = input.from ? String(input.from).toUpperCase() : null;
  const currentApy = input.currentApyPct != null ? Number(input.currentApyPct) : null;

  const { clock, markets, excluded, disagreements, oracle, confirmed } = await venusMarkets();
  if (!markets.length) throw new Error('no Venus market could be read');

  // A market with no liquidity left cannot take a deposit out again, which
  // makes its rate irrelevant however good it looks.
  const usable = markets.filter((m) => m.available_liquidity_usd > 0 && m.supply_apy_pct > 0);
  const best = usable[0] || null;

  const from = fromSymbol
    ? markets.find((m) => m.symbol.toUpperCase() === fromSymbol || m.symbol.toUpperCase() === 'V' + fromSymbol)
    : null;
  const baseline = currentApy != null ? currentApy : (from ? from.supply_apy_pct : null);

  const result = {
    measured_block_time: clock,
    // Stated in the answer, not just in a comment: this is the figure the rest
    // of the market gets wrong, and a buyer can check it in one call.
    why_the_block_time_is_here: `Venus quotes interest per block, so an APY depends entirely on how many blocks a year has. BSC now produces a block every ${clock.seconds_per_block} s — about ${clock.blocks_per_year.toLocaleString('en-US')} a year, not the 10,512,000 that three-second blocks implied and that most published BSC yield figures still assume. Using the old constant understates these rates by roughly ${(clock.blocks_per_year / 10_512_000).toFixed(1)}x.`,
    markets_read: markets.length,
    ranked: markets.slice(0, 12),
    // Named rather than implied. A market Venus's own API does not cover is not
    // confirmed by anything, and calling the whole set "cross-checked" because
    // some of it was would be the same overstatement this project keeps finding
    // in other people's numbers.
    cross_check: {
      // Agreement needs something to agree WITH. With no market confirmed the
      // second source did not answer, and "agrees: true" beside "0 of 54" was
      // one source presented as two (2026-09-18). null = not checked.
      agrees: confirmed > 0 ? disagreements.length === 0 : null,
      second_sourced: `${confirmed} of ${markets.length} live markets are covered by Venus's own published API; the rest are computed from the chain only and say so per row.`,
      ...(disagreements.length
        ? { disagreements, note: 'Our figure and Venus\'s own published APY differ on these markets by more than 0.1 points. Rates move between their snapshot and our block, but a large gap is a reason to read the market directly before acting.' }
        : { note: confirmed > 0
          ? 'Every market Venus also publishes agrees with our independent computation to within 0.1 points — derived from the rate per block and the measured block time, not copied from them.'
          : 'Venus\'s own API did not answer this time, so nothing here is second-sourced: every figure is our computation from the chain alone (rate per block, measured block time). Not cross-checked.' }),
    },
    ...(excluded.length ? { excluded_from_ranking: excluded } : {}),
    oracle,
    measured_at: new Date().toISOString(),
    what_this_is_not: 'A forecast. Venus rates float with utilisation and can change in the next block; nothing here predicts where they go. Measurement only, not financial advice.',
  };

  if (!best) {
    result.verdict = 'No Venus core-pool market currently pays a positive supply rate with liquidity available to withdraw.';
    return result;
  }

  result.best_available = { symbol: best.symbol, supply_apy_pct: best.supply_apy_pct, available_liquidity_usd: best.available_liquidity_usd };

  if (!(amountUsd > 0)) {
    result.verdict = `${best.symbol} pays the most at ${best.supply_apy_pct}% supply APY. Give amountUsd (and optionally from, the market you are in now) to find out whether moving there pays for itself, and after how long.`;
    return result;
  }

  if (baseline == null) {
    result.verdict = `${best.symbol} pays ${best.supply_apy_pct}%. Give "from" (the Venus market you hold today) or currentApyPct to price the move against what you already earn.`;
    return result;
  }

  const deltaPct = best.supply_apy_pct - baseline;
  const extraPerYearUsd = amountUsd * deltaPct / 100;

  // What moving costs. Gas on BSC is small and knowable; a Venus move is a
  // redeem and a mint, and a different underlying needs a swap on top. The swap
  // is priced by the rebalancing agent, which measures the pool — here the cost
  // is stated as gas only and says so, rather than inventing a swap cost this
  // function has not measured.
  // MEASURED, NOT ROUNDED UP (2026-09-18). This was a constant $0.25; BSC clears
  // at 0.05 gwei and a redeem plus a mint is about 450,000 gas — two cents. A
  // cost ten times too high made the break-even ten times too long and told
  // small positions "not worth it". Gas price and the BNB price are read; if
  // either read fails the old generous figure stands and says it was assumed.
  const MOVE_GAS = 450000;
  let gasUsd = 0.25, gasBasis = 'assumed (the gas price could not be read): a generous $0.25';
  try {
    const [gp, feed] = await Promise.all([rpc('eth_gasPrice', []), rpc('eth_call', [{ to: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE', data: '0xfeaf968c' }, 'latest'])]);
    const gwei = Number(BigInt(gp)) / 1e9, bnbUsd = Number(BigInt('0x' + String(feed).slice(2 + 64, 2 + 128))) / 1e8;
    if (gwei > 0 && bnbUsd > 0) {
      gasUsd = +Math.max(0.01, (gwei * 1e-9) * MOVE_GAS * bnbUsd * 1.5).toFixed(2);   // with half again as headroom, never under a cent
      gasBasis = `measured: ${gwei} gwei x ${MOVE_GAS.toLocaleString('en-US')} gas (a redeem and a mint) at $${bnbUsd.toFixed(0)} a BNB, with half again as headroom`;
    }
  } catch { /* the assumed figure stands */ }
  const sameAsset = from && best.symbol.toUpperCase() === from.symbol.toUpperCase();
  const costUsd = gasUsd;

  const daysToBreakEven = extraPerYearUsd > 0 ? (costUsd / (extraPerYearUsd / 365)) : Infinity;

  // One threshold table, read by both the flag and the sentence. The first
  // version of this had 90 days in the boolean and 365 in the wording, so a
  // move could come back worth_it:false under the heading "Worth it." — the
  // exact kind of self-contradiction this marketplace exists to point out in
  // other people's data.
  const payback = !Number.isFinite(daysToBreakEven) ? 'never'
    : daysToBreakEven <= 30 ? 'quick'
      : daysToBreakEven <= 365 ? 'slow'
        : 'never-in-a-year';

  result.move = {
    from: from ? from.symbol : `an outside position earning ${baseline}%`,
    to: best.symbol,
    amount_usd: amountUsd,
    apy_now_pct: +Number(baseline).toFixed(4),
    apy_after_pct: best.supply_apy_pct,
    apy_gain_pct: +deltaPct.toFixed(4),
    extra_per_year_usd: +extraPerYearUsd.toFixed(2),
    cost_usd: costUsd,
    cost_basis: gasBasis + '. BSC gas for a redeem and a mint. If the underlying differs the move also needs a swap, whose real cost depends on pool depth — that is measured by the rebalancing agent, and is NOT included here.',
    same_underlying: !!sameAsset,
    days_to_break_even: Number.isFinite(daysToBreakEven) ? +daysToBreakEven.toFixed(1) : null,
    payback,
    worth_it: payback === 'quick' || payback === 'slow',
  };

  // The honest verdict, including the one nobody publishes.
  const money = `$${amountUsd.toLocaleString('en-US')} at ${best.supply_apy_pct}% instead of ${Number(baseline).toFixed(2)}% earns $${extraPerYearUsd.toFixed(2)} more a year, and the move costs about $${costUsd} in gas`;
  if (deltaPct <= 0) {
    result.verdict = `Do not move. You already earn ${Number(baseline).toFixed(2)}%, and the best market available pays ${best.supply_apy_pct}% — the move costs money and gains nothing.`;
  } else if (payback === 'never') {
    result.verdict = 'The move gains nothing per year, so it never pays for itself.';
  } else if (payback === 'never-in-a-year') {
    result.verdict = `Not worth it at this size. ${money} — which takes ${daysToBreakEven.toFixed(0)} days to break even, longer than a year. The rate difference is real; at your size it does not pay for the transaction.`;
  } else if (payback === 'slow') {
    result.verdict = `Marginal. ${money}, so it pays for itself after ${daysToBreakEven.toFixed(0)} days. Worth doing only if the money is staying put for longer than that.`;
  } else {
    // "Worth it" is about the gas. A move into another underlying also needs a
    // swap this function has not priced, and the verdict has to say so itself.
    result.verdict = `Worth it${sameAsset ? '' : ' on gas alone'}. ${money}. It pays for itself in ${daysToBreakEven.toFixed(1)} days.${sameAsset ? '' : ` Moving from ${from ? from.symbol : 'your asset'} into ${best.symbol} also needs a swap, which is NOT in this figure — price it first (rebalance_plan measures it).`}`;
  }

  if (amountUsd > best.available_liquidity_usd) {
    result.warning = `${best.symbol} has $${best.available_liquidity_usd.toLocaleString('en-US')} of withdrawable liquidity and you are moving $${amountUsd.toLocaleString('en-US')}. A deposit larger than the free liquidity can be supplied but not necessarily withdrawn on demand, and depositing it lowers the very rate that made this market the best one.`;
  }

  return result;
}
