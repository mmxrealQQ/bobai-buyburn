// Where to put liquidity on PancakeSwap, and what the pool it is sitting in
// actually paid the people already in it.
//
// The four agents before this one all serve somebody spending money: a trader
// sizing a grid, a borrower watching a health factor, a holder rebalancing, a
// lender chasing a rate. None of them serves the other side of the market. A
// liquidity provider has a decision to make that nothing on the chain helps
// with, and it is not a small one.
//
// THE DECISION
// A pair on PancakeSwap does not live in one pool. It lives in up to five at
// once — V2 at 0.25%, and V3 at 0.01%, 0.05%, 0.25% and 1.00% — sharing a price
// and competing for the same flow. Every interface ranks them by the money
// already parked in them. That number is a measure of what other people did,
// not of what the pool pays, and the two come apart constantly: measured across
// six of the busiest pairs on the chain, the tier holding the most capital was
// routinely not the tier paying best.
//
// WHAT THIS RETURNS
// Per tier: the fees the pool actually paid out over a measured window, divided
// by the capital in it. Plus the tiers holding real money that did not trade at
// all — a 1.00% pool exists on every pair, holds money on every pair, and on
// none of the six did it see a single swap.
//
// WHAT IT REFUSES TO DO
// It does not annualise. The window is about forty minutes of chain, it travels
// with every figure, and turning it into an APR would be the exact move this
// marketplace was built to argue against. It does not know impermanent loss, so
// it says so rather than implying a tier is "best" in a sense it cannot measure.
// And it does not tell anyone to move: a tier that pays better today is not a
// reason to pay gas twice, which is why the answer carries what a move costs
// against what the difference is worth.
// The measurement itself lives once, in the dashboard worker, and is reached
// over our own MCP endpoint — the same way the grid and rebalance agents reach
// the pool scan. Not imported: this is a different Worker, and a second copy of
// the arithmetic is how a fee table drifts. The custom domain is deliberate;
// a *.workers.dev loopback answers 404 from inside another Worker.
const MEASURE = 'https://brainonbnb.com/mcp';

const round = (n, d = 6) => (n == null ? null : +Number(n).toFixed(d));

async function measure(address) {
  const r = await fetch(MEASURE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'pancakeswap_fee_tiers', arguments: { address } },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'the tiers could not be measured');
  const text = j.result?.content?.[0]?.text;
  if (!text) throw new Error('the measurement returned nothing readable');
  const m = JSON.parse(text);
  if (m.error) throw new Error(m.error);
  return m;
}

// A move costs two transactions — withdrawing from one pool and adding to
// another — plus whatever the price moved in between. Gas on BSC is cheap and
// this is deliberately generous rather than flattering: an agent whose answer
// is "yes, move" should have had to clear a real bar to say it.
const MOVE_GAS_USD = 0.60;

export async function lpTierPlan(input = {}) {
  const address = String(input.token || input.address || input.pool || '')
    .match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (!address) throw new Error('lp_tier_plan needs a token or pool address (0x…)');
  const capitalUsd = Number(input.capitalUsd) > 0 ? Number(input.capitalUsd) : 1000;

  const m = await measure(address.toLowerCase());

  const priced = (m.tiers || []).filter((t) => t.fees_per_1000_usd_parked != null);
  const traded = priced.filter((t) => t.volume_usd > 0)
    .sort((a, b) => b.fees_per_1000_usd_parked - a.fees_per_1000_usd_parked);

  // What the capital in question would have earned in each tier over the window
  // that was actually measured. Stated in dollars because "0.0166 per 1000" is
  // not a quantity anybody can weigh a decision against, and stated for the
  // window rather than for a year because that is the only period it is true of.
  const perTier = (m.tiers || []).map((t) => ({
    tier: t.tier,
    pool: t.pool,
    fee_pct: t.fee_pct,
    capital_in_pool_usd: t.capital_usd,
    measured: t.measured === true,
    ...(t.measured
      ? {
          swaps: t.swaps,
          volume_usd: t.volume_usd,
          your_share_of_fees_usd_in_window:
            t.fees_per_1000_usd_parked == null
              ? null
              : round((t.fees_per_1000_usd_parked / 1000) * capitalUsd, 6),
        }
      : { reason: t.reason }),
  }));

  const best = traded[0] || null;
  const mostCapital = m.most_capital_tier
    ? priced.find((t) => t.tier === m.most_capital_tier) || null
    : null;

  // The comparison that decides anything: how long the better tier needs to run
  // at this rate before it has paid for the move. Reported as a duration, not
  // as a verdict, and explicitly conditional — the rate is a forty-minute
  // sample and the honest thing is to say what would have to hold, not to
  // pretend it will.
  //
  // Three ways there is no comparison to make, and they are not the same
  // thing. Silence would read as "no move worth making" in all three, which is
  // only true in one of them: `most_capital_tier` is taken from every tier that
  // could be weighed, including one whose logs were refused — so the tier
  // holding the most money can be present and unpriced.
  let move = null;
  let noMove = null;
  if (!best) noMove = 'No tier traded in the measured window, so there is nothing to compare.';
  else if (!mostCapital) noMove = `The tier holding the most capital (${m.most_capital_tier}) could not be priced this run, so the comparison would be against a blank.`;
  else if (best.tier === mostCapital.tier) noMove = 'The tier holding the most capital is also the one paying best. Nothing to move.';
  if (best && mostCapital && best.tier !== mostCapital.tier) {
    const perWindow = ((best.fees_per_1000_usd_parked - mostCapital.fees_per_1000_usd_parked) / 1000) * capitalUsd;
    const windows = perWindow > 0 ? MOVE_GAS_USD / perWindow : null;
    const minutes = windows != null && m.measured_window?.minutes
      ? windows * m.measured_window.minutes
      : null;
    move = {
      from: mostCapital.tier,
      to: best.tier,
      extra_fees_usd_per_window: round(perWindow, 6),
      assumed_move_cost_usd: MOVE_GAS_USD,
      windows_to_break_even: windows == null ? null : round(windows, 2),
      hours_to_break_even_if_this_rate_held: minutes == null ? null : round(minutes / 60, 2),
      caveat: 'The rate is a single measured window. This is what would have to hold for the move to pay, not a forecast that it will.',
    };
  }

  return {
    service: 'lp_tier_plan',
    pair: { token: m.token, quote: m.quote },
    capital_considered_usd: capitalUsd,
    measured_window: m.measured_window,
    // Kept apart deliberately: how many tiers exist, and how many could be
    // read. A run where the log endpoint refused every range must never be
    // reported as a pair that nobody traded.
    tiers_found: m.tiers_found ?? (m.tiers || []).length,
    tiers_measured: m.tiers_measured ?? (m.tiers || []).filter((t) => t.measured).length,
    tiers: perTier,
    best_paying_tier: m.best_paying_tier,
    most_capital_tier: m.most_capital_tier,
    // The single sentence the whole service exists to be able to say.
    capital_is_in_the_best_paying_tier: m.capital_is_in_the_best_paying_tier,
    idle_capital: m.idle_capital,
    move_worth_it: move,
    no_move_because: move ? null : noMove,
    not_compared: {
      same_venue_other_quotes: m.same_venue_other_quotes,
      other_venues: m.other_venues,
    },
    limits: m.caveats,
  };
}
