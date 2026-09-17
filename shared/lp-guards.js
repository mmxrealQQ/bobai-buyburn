// Every reason the DeFi agent refuses to act, in one file.
//
// Shared by scripts/lp-agent.mjs (a person, plan by default) and
// worker-lp/index.js (the daily cron with the keys). Two copies of a refusal
// list is how one of them stops refusing. Pure: no chain, no I/O.
//
// Three steps, three guard functions, and the floors they share:
//   sweep     AI income (USD1, $U) -> BNB -> the DeFi wallet
//   collect   position fees -> BNB -> the buyback wallet
//   increase  BNB above the reserve -> more of the same position
//
// Every floor is a gas argument: below it, moving the money costs more than
// the money. A day under a floor is a decision, not an error, and is recorded
// as one.

// What the DeFi wallet keeps back after every run. Above MIN_GAS_BNB on
// purpose: the first build kept 0.001 and demanded 0.0015 to act, so the first
// real collect would have left the wallet unable to do the second.
export const GAS_RESERVE_BNB = 0.002;
// Below this the collect's five transactions cannot be paid for at 1 gwei.
export const MIN_GAS_BNB = 0.0015;
// Fees worth less than this stay in the position: at 1 gwei the collect,
// sale, unwrap and transfer cost about 0.0004 BNB, and a run should clearly
// beat its gas rather than marginally.
export const MIN_COLLECT_BNB = 0.002;
// Income worth less than this stays where it landed: approve + swap is about
// 0.0002 BNB at 1 gwei, so anything under 0.004 would lose more than 5% to gas.
export const MIN_SWEEP_BNB = 0.004;
// An income wallet needs this much to pay for its own approve + swap.
export const MIN_SWEEP_GAS_BNB = 0.0005;
// The most a single sweep moves from one wallet. Not a refusal: a larger
// balance is swept in daily slices. A bug that produced a huge balance would
// then move a bounded amount a day rather than everything at once.
export const MAX_SWEEP_USD = 50;
// Capital under this stays as BNB in the wallet: growing the position is
// three to four transactions (wrap, swap, increase, unwrap; approvals only
// when the allowance is short). Was 0.01 while the gas was assumed at 1 gwei;
// measured on 2026-09-04 the eight-transaction re-set cost 0.000075 BNB, so
// four transactions are about 0.00004 BNB and 0.005 BNB is where that stays
// under 1%. Capital idling in the wallet earns nothing; since the collect
// keeps half of the fees as capital, the floor decides how soon they earn.
export const MIN_INCREASE_BNB = 0.005;
// Kept out of the amount that goes into the position, so the increase itself
// never spends the reserve.
export const INCREASE_GAS_BUDGET_BNB = 0.001;
// A re-set of the range is eight transactions, about 0.0008 BNB at 1 gwei;
// under this much capital that is over 4% of the position for one move.
export const MIN_REBALANCE_BNB = 0.02;
// How long the price has to stay outside the range before a re-set is paid
// for. A price that left a minute ago is often back within the hour, and a
// re-set then pays for a move the market undid on its own. The agent checks
// hourly; two checks outside in a row is the trigger. The earnings test in
// the window record replays every width with this same delay, so the width
// it picks was picked for the way the agent actually behaves.
export const RESET_AFTER_HOURS = 2;
// Since 2026-09-09 the wait is measured, not set. The window record replays
// every width with a wait of 0 to 24 h (the grid in lp-windows.js) before a re-set and names the
// net per day of each; the re-set uses the wait that netted the most — once
// the record holds WAIT_PICK_MIN_HOURS of prices AND that wait beats the set
// one by WAIT_PICK_MARGIN. Under either bar the set wait stands. The bar is
// there because the first readings were not monotonic (157 h on 2026-09-09:
// 0 h $0.89, 1 h $0.80, 2 h $0.73, 3 h $0.81 a day on $50): a wait that wins
// by a few cents on a week of prices is noise with a number on it, and a
// re-set rule that flips every hour would be worse than a fixed one.
export const WAIT_PICK_MIN_HOURS = 120;
export const WAIT_PICK_MARGIN = 0.10;
// delays: the window record's delay test rows ({hours, net_usd_per_day, …});
// hoursOfPrices: how much price the record holds. Returns the wait a re-set
// uses and where it comes from — a pure function, so the record page, the
// worker and the self-test cannot read the same rows three ways.
export function waitInUse(delays, hoursOfPrices, set = RESET_AFTER_HOURS) {
  const priced = (delays || []).filter((d) => d && d.net_usd_per_day != null);
  const base = priced.find((d) => d.hours === set) || null;
  const best = priced.slice().sort((a, b) => b.net_usd_per_day - a.net_usd_per_day)[0] || null;
  const keep = (why) => ({ hours: set, basis: 'set', why });
  if (!best) return keep(`the set wait of ${set} h — the record has not yet replayed every wait`);
  if (!(hoursOfPrices >= WAIT_PICK_MIN_HOURS)) return keep(`the set wait of ${set} h — the record holds ${hoursOfPrices} h of prices and a measured wait needs ${WAIT_PICK_MIN_HOURS} h`);
  // The set wait nets nothing at any width (since 2026-09-11 a re-set is
  // charged what its range lost against holding, and on a trending week no
  // width nets at 2 h) while another wait does: that wait is in use. The
  // bar below guards against flipping between two waits that both earn; a
  // wait that turns "hold" into "earn" is not a flip.
  if (!base) {
    if (best.net_usd_per_day > 0) return { hours: best.hours, basis: 'measured', why: `${best.hours} h netted $${best.net_usd_per_day} a day over ${hoursOfPrices} h of prices while the set ${set} h netted nothing at any width` };
    return keep(`the set wait of ${set} h — no wait nets anything over ${hoursOfPrices} h of prices`);
  }
  if (best.hours === set) return { hours: set, basis: 'measured', why: `${set} h netted the most per day over ${hoursOfPrices} h of prices` };
  // Nets are rounded to four places; so is the bar, or 0.9 × 1.1 lands a
  // hair above 0.99 and a wait exactly a tenth ahead is refused.
  const bar = Math.round(base.net_usd_per_day * (1 + WAIT_PICK_MARGIN) * 1e4) / 1e4;
  if (!(best.net_usd_per_day >= bar)) return keep(`the set wait of ${set} h — ${best.hours} h netted $${best.net_usd_per_day} a day against $${base.net_usd_per_day}, under the ${Math.round(WAIT_PICK_MARGIN * 100)}% bar for a change`);
  return { hours: best.hours, basis: 'measured', why: `${best.hours} h netted $${best.net_usd_per_day} a day against $${base.net_usd_per_day} at the set ${set} h, over ${hoursOfPrices} h of prices — more than the ${Math.round(WAIT_PICK_MARGIN * 100)}% bar` };
}
// The earnings test needs this much recorded price before it may pick; a
// width chosen on six hours of a quiet afternoon is a guess with a number on it.
export const MIN_HOURS_FOR_EARNINGS = 24;
// Until 2026-09-09 a re-set re-centred through the PancakeSwap V2 router, a
// 0.25% pool: on ~0.04 WBNB a re-set that was 0.0001 BNB of fee, more than
// the re-set's whole gas (0.00007 BNB), and the measured re-set cost charged
// gas alone. Since then the trade goes through the position's own V3 pool
// (0.05%) and every re-set writes its fee down; this rate prices the older
// records, which only name their trade.
export const V2_SWAP_FEE_PCT = 0.25;
// How much of the fees a collect keeps as capital, in percent. The rest goes
// to the buyback wallet. Until 2026-09-04 every collected fee went to the
// buyback; since then the position keeps half, so it grows out of its own
// earnings and the buyback's share grows with it ("er soll auch davon
// wachsen"). The kept share waits as BNB in the DeFi wallet and goes
// into the position with the next increase. worker-lp reads the live value
// from LP_FEE_KEEP_PCT in wrangler.toml; this is the default and the one the
// hand script uses.
export const FEE_SHARE_KEPT_PCT = 50;

// Split what a collect produced (bigint wei) into the part kept as capital
// and the part sent to the buyback wallet. A percentage that is not a number
// between 0 and 100 falls back to the default rather than to "send it all"
// or "keep it all": a typo in a config must not change where the money goes
// by more than the default does. Pure, pinned by the self-test.
export function splitFees(producedRaw, keptPct = FEE_SHARE_KEPT_PCT) {
  const raw = Number(keptPct);
  const pct = Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : FEE_SHARE_KEPT_PCT;
  const total = producedRaw > 0n ? producedRaw : 0n;
  const keep = (total * BigInt(Math.round(pct * 100))) / 10000n;
  return { keep, buyback: total - keep, pct };
}

// A re-set of the range pays the old range's fees out with the principal.
// Until 2026-09-08 the mint then folded all of them into the new capital:
// five re-sets, 0.00177 BNB of fees, and the buyback wallet saw none of it,
// because the collect step never reached its own floor before the next
// re-set took the fees away. So the re-set splits them the same way the
// collect does — the kept share is minted into the new capital, the rest is
// sent on before the mint. Under this much the buyback share stays as
// capital too: the unwrap and the transfer are two transactions, about
// 0.00005 BNB at 1 gwei, and a share that only pays for its own gas is not
// a share. Pure, pinned by the self-test.
export const MIN_RESET_FORWARD_BNB = 0.0001;
export function resetForward(foldedWei, keptPct = FEE_SHARE_KEPT_PCT) {
  const split = splitFees(foldedWei, keptPct);
  const floor = BigInt(Math.round(MIN_RESET_FORWARD_BNB * 1e6)) * 10n ** 12n;
  if (split.buyback <= 0n) return { forward: 0n, kept: split.keep, pct: split.pct, why: split.keep > 0n ? `all of it stays as capital (kept share ${split.pct}%)` : 'the old range owed no fees' };
  if (split.buyback < floor) return { forward: 0n, kept: split.keep + split.buyback, pct: split.pct, why: `the buyback share ${(Number(split.buyback) / 1e18).toFixed(6)} BNB is under the ${MIN_RESET_FORWARD_BNB} BNB floor — it stays as capital` };
  return { forward: split.buyback, kept: split.keep, pct: split.pct, why: null };
}

// state: { positions, liquidity (bigint), owedBnbEquivalent, gasBnb, quoteOffPct }
// owedBnbEquivalent is what this run would turn into BNB: fees owed by the
// position plus anything an interrupted earlier run left in the wallet.
export function refuseCollect(state) {
  if (state.positions === 0) return 'this wallet holds no position — open one first with lp-open.mjs';
  if (state.positions > 1) return `this wallet holds ${state.positions} positions. Collecting from one of several silently is a decision a person should make, not a script.`;
  if (state.liquidity === 0n) return 'the position has no liquidity left in it';
  if (state.owedBnbEquivalent <= 0) return 'nothing is owed yet';
  if (state.owedBnbEquivalent < MIN_COLLECT_BNB)
    return `only ${state.owedBnbEquivalent.toFixed(6)} BNB of fees are owed, below the ${MIN_COLLECT_BNB} BNB floor — collecting it would cost more gas than it recovers`;
  if (state.gasBnb < MIN_GAS_BNB) return `the wallet holds ${state.gasBnb.toFixed(6)} BNB, not enough gas for collect + swap + transfer`;
  if (state.quoteOffPct != null && Math.abs(state.quoteOffPct) > 25)
    return `the quote implies a price ${state.quoteOffPct.toFixed(1)}% away from the pool's own — refusing rather than trading into something that moved`;
  return null;
}
// The old name, kept for anything that still imports it.
export const refuse = refuseCollect;

// state: { symbol, balance, bnbEquivalent, gasBnb, bnbUsd, feedAgeS, impliedUsd }
// impliedUsd is what the route pays per token in dollars; a stablecoin that
// routes far from a dollar is a thin or manipulated pool, not a bargain.
export function refuseSweep(state) {
  const sym = state.symbol || 'the token';
  if (!(state.balance > 0)) return `nothing has arrived since the last sweep — the wallet holds no ${sym}`;
  if (state.gasBnb < MIN_SWEEP_GAS_BNB) return `the wallet holds ${Number(state.gasBnb).toFixed(6)} BNB, not enough gas for approve + swap`;
  if (state.feedAgeS > 3600) return `Chainlink BNB/USD is ${Math.round(state.feedAgeS / 60)} min old — not a live price, so the route cannot be checked`;
  if (!(state.bnbUsd >= 100 && state.bnbUsd <= 5000)) return `Chainlink reports BNB at $${state.bnbUsd} — outside the plausible range, not trusting it`;
  if (state.bnbEquivalent < MIN_SWEEP_BNB)
    return `${Number(state.balance).toFixed(4)} ${sym} is worth ${Number(state.bnbEquivalent).toFixed(6)} BNB, below the ${MIN_SWEEP_BNB} BNB floor — gas would eat it. It stays until more arrives.`;
  if (state.impliedUsd != null && (state.impliedUsd < 0.9 || state.impliedUsd > 1.1))
    return `the route prices ${sym} at $${state.impliedUsd.toFixed(4)} — outside 0.90–1.10, refusing to sell into that`;
  return null;
}

// WHEN A RANGE COUNTS AS LEFT (2026-09-16). A one-sided range is minted
// right beside the price (ticksAdjacent, ONE_SIDED_GAP_TICKS away), so the
// pool's own "in range" is false the moment it exists; taken literally, the
// next hourly check would call that "left" and re-set it to the same place,
// every hour, for gas. A price within RANGE_LEFT_TICKS of an edge sits at
// the edge and has not left — that is half a percent, the drift of a quiet
// hour on CAKE/BNB. The same slack applies to a centred range: a price half
// a percent past the edge is a price that is often back within the hour.
// Pure; pinned by scripts/lp-agent.mjs --self-test.
export const RANGE_LEFT_TICKS = 50;
export function rangeLeft(tick, tickLower, tickUpper, slack = RANGE_LEFT_TICKS) {
  const t = Number(tick), lo = Number(tickLower), hi = Number(tickUpper);
  if (![t, lo, hi].every(Number.isFinite) || !(hi > lo)) return { outside: false, side: null, ticks_away: 0, left: false };
  if (t < lo) return { outside: true, side: 'below', ticks_away: lo - t, left: lo - t > slack };
  if (t >= hi) return { outside: true, side: 'above', ticks_away: t - hi + 1, left: t - hi + 1 > slack };
  return { outside: false, side: null, ticks_away: 0, left: false };
}
// A one-sided range starts this many ticks beyond the price (0.2%), so the
// mint that follows the read is still entirely on its side of the price
// when the block comes — a range the price has entered in between needs the
// other token, which the wallet does not hold, and the mint would take
// nothing. The same tolerance the minimums of a centred mint use.
export const ONE_SIDED_GAP_TICKS = 20;

// THE WIDTH (2026-09-16, evening): the width that left the most money
// against holding over the last WIDTH_WINDOW_HOURS, fees included —
// replayed the way the agent lives it (one-sided re-sets after the wait in
// use). Score = fees_usd − the re-sets' cost + vs_holding_usd of the week's
// replay: what the liquidity earned, less the gas of its re-sets, plus where
// it ended against a wallet that held the minted amounts. That is the line the whole agent is judged by on its
// card, so the width is chosen by it and by nothing else. In a ranging
// week narrow widths win (fees high, nothing lost to the trend); in a
// trending week wide ones win (less sold on the way up, less held on the
// way down). The morning's rule, "the narrowest width in range 95% of the
// hours", was a stand-in for that and picked ±4% on a week where ±10% had
// ended $0.72 further ahead on $50; before it, "the most net per day once
// every re-set is charged its hindsight loss" had answered "hold". A width
// in use (`current`, the class of the position's ticks) is kept unless
// another leads it by WIDTH_PICK_MARGIN of its own score and at least
// WIDTH_PICK_MIN_LEAD_USD on $50 a week — the same bar the wait pick uses,
// so two widths a few cents apart do not swap every re-set. Pure; pinned.
export const WIDTH_WINDOW_HOURS = 168;
export const WIDTH_PICK_MARGIN = 0.10;
export const WIDTH_PICK_MIN_LEAD_USD = 0.02;
// Kept for the record of the morning rule and its pins; not applied.
export const IN_RANGE_TARGET = 0.95;
export function pickWidth(rows, { current = null, key = 'earnings_7d', margin = WIDTH_PICK_MARGIN, minLead = WIDTH_PICK_MIN_LEAD_USD } = {}) {
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const cand = (rows || [])
    .filter((r) => r && r.width !== 'full' && isFinite(Number(r.width)) && r[key] && Number(r[key].hours) > 0 && typeof r[key].vs_holding_usd === 'number' && typeof r[key].fees_usd === 'number')
    .map((r) => ({ row: r, width: Number(r.width), hours: Number(r[key].hours), fees: Number(r[key].fees_usd), vs: Number(r[key].vs_holding_usd), share: Number(r[key].hours_in_range) / Number(r[key].hours) }))
    .map((c) => ({ ...c, gas: Number(c.row[key].resets || 0) * Number(c.row[key].reset_cost_usd || 0) }))
    .map((c) => ({ ...c, score: r4(c.fees - c.gas + c.vs) }));
  if (!cand.length) return null;
  // The most money against holding; a tie goes to the wider width, which
  // is crossed less often.
  const sorted = cand.slice().sort((a, b) => b.score - a.score || b.width - a.width);
  const best = sorted[0];
  const cur = current != null ? cand.find((c) => c.width === Number(current)) : null;
  const table = sorted.map((c) => `±${c.width}% ${c.score >= 0 ? '+' : '−'}$${Math.abs(c.score).toFixed(2)}`).join(', ');
  const shape = (c, kept, why) => ({
    width: c.width, score_usd: c.score, fees_usd: r4(c.fees), vs_holding_usd: r4(c.vs), in_range_share: Math.round(c.share * 1000) / 1000, hours: c.hours,
    kept_current: kept, best_width: best.width, best_score_usd: best.score,
    earnings: c.row.earnings || null, earnings_7d: c.row[key],
    basis: why,
  });
  if (cur && cur.width !== best.width) {
    const bar = r4(cur.score + Math.max(Math.abs(cur.score) * margin, minLead));
    if (best.score < bar) return shape(cur, true, `±${cur.width}% stays: ±${best.width}% ended $${best.score.toFixed(2)} against holding (fees in) over the last ${Math.round(cur.hours)} h on $50, ±${cur.width}% $${cur.score.toFixed(2)} — under the bar of $${bar.toFixed(2)} for a change (${Math.round(margin * 100)}% of its own score, at least $${minLead.toFixed(2)}). The week: ${table}`);
    return shape(best, false, `±${best.width}% ended the most ahead against holding over the last ${Math.round(best.hours)} h on $50, fees in: $${best.score.toFixed(2)} ($${best.fees.toFixed(2)} of fees, ${best.vs >= 0 ? '+' : '−'}$${Math.abs(best.vs).toFixed(2)} against holding), over the bar of $${bar.toFixed(2)} against the ±${cur.width}% in use. The week: ${table}`);
  }
  return shape(best, !!cur, `±${best.width}% ended the most ahead against holding over the last ${Math.round(best.hours)} h on $50, fees in: $${best.score.toFixed(2)} ($${best.fees.toFixed(2)} of fees, ${best.vs >= 0 ? '+' : '−'}$${Math.abs(best.vs).toFixed(2)} against holding)${cur ? ', the width in use' : ''}. The week: ${table}`);
}

// state: { positions, inRange, atEdge, side, ticksAway, width, hoursOfPrices, valueBnb }
// width is what the width record picked (pickWidth), or what a person named
// by hand; null means the record holds no day of prices yet. atEdge: the
// price is outside but within RANGE_LEFT_TICKS of an edge (rangeLeft).
// state.resume: no position, but the wallet holds the pool's two tokens — a
// re-set that stopped between its unwind and its mint. Then the plan is the
// mint alone, sized like a re-set (the same width, the same floor), and the
// "in range" question does not arise: there is no range yet.
export function refuseRebalance(state) {
  if (state.positions !== 1 && !(state.positions === 0 && state.resume)) return state.positions === 0
    ? 'this wallet holds no position to re-set'
    : `this wallet holds ${state.positions} positions — which one to re-set is a decision for a person`;
  if (state.inRange) return 'the price is inside the range — nothing to re-set';
  if (state.atEdge) return `the price sits ${state.ticksAway ?? '?'} tick${state.ticksAway === 1 ? '' : 's'} ${state.side || 'beyond'} the range — at the edge, within the ${RANGE_LEFT_TICKS}-tick slack, not left`;
  if (state.width == null)
    return `no width is on record yet (${state.hoursOfPrices || 0} h of prices recorded, ${MIN_HOURS_FOR_EARNINGS} h needed before the record may name one). Holding.`;
  if (!(state.valueBnb >= MIN_REBALANCE_BNB))
    return `${state.resume ? "the wallet's two sides are" : 'the position is'} worth ${Number(state.valueBnb || 0).toFixed(6)} BNB, below the ${MIN_REBALANCE_BNB} BNB floor — a ${state.resume ? 'mint' : 're-set'} would cost more than it is likely to earn back`;
  return null;
}

// state: { positions, hasTarget, targetHasWbnb, samePool, width, valueBnb, move }
// A relocate is a re-set into another pool: withdraw, leave the old pair,
// enter the new one, mint. The pool record's switch rule (move) says whether
// it is worth it; a person naming --to on the hand script is a decision of
// their own and passes no move. Everything a re-set refuses, this refuses too.
// THE POOL IS DECIDED. On 2026-09-11 the operator closed the question the
// pool record had been measuring for a day ("wir bleiben immer bei CAKE/BNB
// und optimieren nur das. keine anderen Pools"): the agent lives in
// CAKE/BNB 0.05% and gets better there, width, wait and sizing, with every
// hour of record about one pool. A move is a withdrawal, two trades through
// two pools and a mint — two re-sets' cost plus what the range lost — paid
// to chase a lead measured in gross fees; there is no pool it moves to. The
// only relocate the guard lets through is one that brings a position that
// is somewhere else back home.
export const HOME_POOL = {
  pool: '0xafb2da14056725e3ba3a30dd846b6bbbd7886c56',
  label: 'CAKE/BNB 0.05%',
  since: '2026-09-11',
  why: 'the agent stays in CAKE/BNB 0.05% and optimises there — the operator\'s decision of 2026-09-11; there is no pool it moves to',
};
export function refuseRelocate(state) {
  if (state.positions !== 1) return state.positions === 0
    ? 'this wallet holds no position to move'
    : `this wallet holds ${state.positions} positions — which one to move is a decision for a person`;
  if (!state.toPool || String(state.toPool).toLowerCase() !== HOME_POOL.pool) return HOME_POOL.why;
  if (state.move && state.move.move === false) return `the switch rule says stay: ${state.move.why}`;
  if (!state.hasTarget) return 'no pool to move to was named';
  if (!state.targetHasWbnb) return 'the pool named is not against WBNB; this agent only holds WBNB pairs, so the record stays in BNB';
  if (state.samePool) return 'the pool named is the one the position is in — nothing to move';
  if (state.width == null) return 'no width is known for the new range';
  if (!(state.valueBnb >= MIN_REBALANCE_BNB))
    return `the position is worth ${Number(state.valueBnb || 0).toFixed(6)} BNB, below the ${MIN_REBALANCE_BNB} BNB floor — a move would cost more than it is likely to earn back`;
  return null;
}

// The wait after the price leaves the range, before a re-set is paid for.
// outSinceMs is when the agent first saw the price outside (null: this is the
// first time), nowMs is now. Null means the wait is over and a re-set is due.
// The checks run on an hourly grid, so "two hours" means the check two slots
// later — not two hours to the millisecond. On 2026-09-08 the price left the
// range at the 17:50:37.852 check and the 19:50:37.800 check, 52 ms short of
// two hours, waited another hour for it; a few minutes of slack is the
// difference between the rule and the cron's jitter.
// A deposit that waits beside a range the price has left. The wait rule
// weighs a re-set's cost against the chance that the price comes back on its
// own — for the position alone. With a deposit of a quarter of the position
// or more idle in the wallet, the hours of waiting cost more than the re-set:
// on 2026-09-10 0.3056 BNB waited beside a 0.29 BNB position from 11:18 UTC
// for a 12:50 re-set, a third of a day's fees on the whole capital against a
// $0.09 re-set. Then the re-set is due now, and the deposit watch may call
// it. Pure; pinned by scripts/lp-agent.mjs --self-test.
export const DEPOSIT_RESET_SHARE = 0.25;
export function depositForcesReset(state) {
  const spendable = Number(state.spendableBnb || 0), value = Number(state.valueBnb || 0);
  if (state.inRange) return null;
  if (!(spendable >= MIN_INCREASE_BNB)) return null;
  if (!(value > 0) || spendable < DEPOSIT_RESET_SHARE * value) return null;
  return `${spendable.toFixed(4)} BNB waits beside a ${value.toFixed(4)} BNB position the price has left — a deposit of ${Math.round((spendable / value) * 100)}% of the position earns nothing while the wait runs, so the range is re-set now`;
}

export const RESET_WAIT_SLACK_MIN = 5;
export function rebalanceWait(outSinceMs, nowMs, hours = RESET_AFTER_HOURS) {
  // A measured wait of 0 h is no wait: the re-set is due the hour the price
  // is first seen outside.
  if (!(hours > 0)) return null;
  if (outSinceMs == null) return `the price has just left the range — waiting ${hours} h in case it comes back on its own`;
  const h = (nowMs - outSinceMs) / 36e5;
  if (!(h >= hours - RESET_WAIT_SLACK_MIN / 60)) return `the price has been outside for ${Math.max(0, h).toFixed(1)} h — waiting until ${hours} h before paying for a re-set`;
  return null;
}

// A width upgrade: the price is inside the range, so nothing forces a re-set,
// but the window record's earnings test now names a different width that
// nets more per day. Until 2026-09-10 the agent only took the new width when
// the price left the old range — a position minted at 2% sat for days
// while the record said 1% earned a seventh more. The rule: once a day, in
// range, with a day of prices on record, re-set into the picked width when
// the extra it nets on this position's capital clears the re-set's cost
// within a day AND is more than a tenth of what the current width nets —
// the same margin the wait pick uses, so noise between two close widths
// never pays for a re-set. At most one such re-set a day, bounded by the
// daily run; the hourly checks never upgrade.
export const WIDTH_UPGRADE_MARGIN = 0.1; // until 2026-09-11; kept for the record, no longer applied
// A switch of a live range pays back within this many days, or it waits
// (2026-09-11): the gain a day on the position, against the switch's full
// cost — execution plus what the current range would realise at today's
// price. Three days, as the pool switch rule had it; a pick that will not
// carry its own cost in three days is not a pick, it is a reading.
export const WIDTH_UPGRADE_PAYBACK_DAYS = 3;
// The widths the hourly replay measures (six, since 2026-09-02) and the
// widths derived between them (2026-09-11, "die mathematisch beste Range"):
// inside its range a position's fee share is its liquidity share, and for
// the same dollars that is 1/width — the record's own rows say so to the
// digit (±1% 0.020, ±2% 0.010, ±5% 0.004, ±10% 0.002 in one hour). So a
// ±3% row is the ±5% row times 5/3, read off the wider neighbour, which was
// in range whenever the narrower one was. The grid is what the earnings
// test replays and what a re-set may mint; widthClassOf snaps to it.
export const REPLAYED_WIDTHS = [0.25, 0.5, 1, 2, 5, 10];
export const DERIVED_WIDTHS = [1.5, 3, 4, 7];
export const RECORD_WIDTHS = REPLAYED_WIDTHS.concat(DERIVED_WIDTHS).sort((a, b) => a - b);

// WHAT A RANGE IS WORTH AT ANOTHER PRICE. A position minted centred on p0
// with a value of 1, in the symmetric range p0/up ... p0*up, holds an amount
// of each side that the pool's own curve fixes; at another price p it holds
// different amounts, and less than a wallet that kept the minted amounts
// would (`hodl`). Inside the range the curve applies; below it the position
// is all of the priced token and moves with p; above it, all of the quote
// and moves not at all. `loss` is what the range has given up against
// holding, as a share of the holding: never negative, zero at p0. The
// earnings test charges it at every replayed re-set; resetLosses reads it
// off the re-sets that happened; widthUpgrade charges it to a switch.
export function rangeValue(p0, widthPct, p) {
  const up = 1 + widthPct / 100;
  const pa = p0 / up, pb = p0 * up;
  const sa = Math.sqrt(pa), sb = Math.sqrt(pb), s0 = Math.sqrt(p0);
  const L = 1 / (2 * s0 - sa - p0 / sb);
  const x0 = L * (1 / s0 - 1 / sb), y0 = L * (s0 - sa);
  const value = p <= pa ? L * (1 / sa - 1 / sb) * p
    : p >= pb ? L * (sb - sa)
    : L * (2 * Math.sqrt(p) - sa - p / sb);
  const hodl = x0 * p + y0;
  return { value, hodl, loss: Math.max(0, 1 - value / hodl) };
}

// The width class of a position from its ticks: half its span, in percent,
// snapped to the record's width nearest on a log scale (a 380-tick range is
// ±1.9%, the record's 2%). Null without ticks.
export function widthClassOf(ticks) {
  if (!Array.isArray(ticks) || ticks.length !== 2 || !(ticks[1] > ticks[0])) return null;
  const half = (Math.pow(1.0001, (ticks[1] - ticks[0]) / 2) - 1) * 100;
  return RECORD_WIDTHS.slice().sort((a, b) => Math.abs(Math.log(a / half)) - Math.abs(Math.log(b / half)))[0];
}

// state: { daily, inRange, ticks, pick: {width, earnings:{net_usd_per_day}},
//          rows: the record's rows, hoursOfPrices, valueBnb, bnbUsd, resetCostUsd }
// Returns { upgrade: true, why, from, to, gain_usd_per_day } or { upgrade: false, why }.
// RETIRED 2026-09-16, with the one-sided re-set: a position in range is
// never touched. A switch of width while in range was a full re-set with
// its trade and its realised loss, paid for a lead measured in hindsight;
// the width now changes at the next natural re-set, which trades nothing.
// The function stays, says so, and its pins pin the refusal.
export const WIDTH_UPGRADE_ENABLED = false;
export function widthUpgrade(state) {
  const no = (why) => ({ upgrade: false, why });
  if (!WIDTH_UPGRADE_ENABLED) return no('the width changes at the next re-set, never while the price is inside the range (2026-09-16)');
  if (!state.daily) return no('the hourly check does not upgrade a width — the daily run does, once');
  if (!state.inRange) return no('the price is outside the range — that is a re-set, not an upgrade');
  const from = widthClassOf(state.ticks);
  if (from == null) return no('the position names no ticks');
  const pick = state.pick;
  if (!pick || pick.earnings == null || !(pick.earnings.net_usd_per_day > 0)) return no('the record names no width that earns');
  if (!(state.hoursOfPrices >= MIN_HOURS_FOR_EARNINGS)) return no(`${state.hoursOfPrices || 0} h of prices on record, ${MIN_HOURS_FOR_EARNINGS} h needed before a width may be upgraded`);
  if (pick.width === from) return no(`the position is at the picked width (${from}%)`);
  const row = (state.rows || []).find((r) => r.width === from);
  const nowNet = row && row.earnings ? Number(row.earnings.net_usd_per_day) : null;
  if (nowNet == null) return no(`the record has no earnings for the position's width (${from}%)`);
  const usd = Number(state.valueBnb || 0) * Number(state.bnbUsd || 0);
  if (!(usd > 0)) return no('the position has no dollar value to scale the record by');
  const scale = usd / 50;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const gain = (Number(pick.earnings.net_usd_per_day) - nowNet) * scale;
  if (!(gain > 0)) return no(`${pick.width}% nets no more than ${from}% on $${usd.toFixed(2)}`);
  // The lead must hold over the last day too (2026-09-11): a lead the whole
  // record shows but the last day does not is one the market has left.
  const pickRow = (state.rows || []).find((r) => r.width === pick.width);
  const pickDay = pickRow && pickRow.earnings_24h ? Number(pickRow.earnings_24h.net_usd_per_day) : null;
  const nowDay = row && row.earnings_24h ? Number(row.earnings_24h.net_usd_per_day) : null;
  if (pickDay == null || nowDay == null) return no(`the record has no last-day replay for ${pick.width}% and ${from}% yet`);
  if (!(pickDay > nowDay)) return no(`${pick.width}% leads ${from}% over ${state.hoursOfPrices} h ($${r4(gain)} a day on $${usd.toFixed(2)}) but not over the last day ($${r4(pickDay)} against $${r4(nowDay)} on $50) — the lead is not standing, no switch`);
  // The full cost of switching now: the re-set's execution (gas, swap fee,
  // the measured impact) plus what the current range has lost against
  // holding at today's price — a switch realises it, holding might not.
  const execution = Number(state.resetCostUsd || 0);
  const centre = Array.isArray(state.ticks) && state.ticks.length === 2 ? (state.ticks[0] + state.ticks[1]) / 2 : null;
  const realised = centre != null && state.tick != null ? rangeValue(Math.pow(1.0001, centre), from, Math.pow(1.0001, Number(state.tick))).loss * usd : 0;
  const cost = execution + realised;
  const paybackDays = gain > 0 ? cost / gain : Infinity;
  if (!(paybackDays <= WIDTH_UPGRADE_PAYBACK_DAYS)) return no(`${pick.width}% nets $${r4(gain)} a day more than ${from}% on $${usd.toFixed(2)}, but the switch costs $${r4(cost)} ($${r4(execution)} to execute, $${r4(realised)} the range would realise at today's price) — ${paybackDays === Infinity ? 'never' : r4(paybackDays) + ' days'} to pay back, more than the ${WIDTH_UPGRADE_PAYBACK_DAYS} allowed`);
  return {
    upgrade: true, from, to: pick.width, gain_usd_per_day: r4(gain), cost_usd: r4(cost), execution_usd: r4(execution), realised_usd: r4(realised), payback_days: r4(paybackDays),
    why: `in range at ${from}%, but ${pick.width}% netted $${r4(gain)} a day more on $${usd.toFixed(2)} over ${state.hoursOfPrices} h of prices and leads over the last day too ($${r4(pickDay)} against $${r4(nowDay)} on $50); the switch costs $${r4(cost)} ($${r4(execution)} to execute, $${r4(realised)} realised at today's price) and pays back in ${r4(paybackDays)} days`,
  };
}

// state: { positions, spendableBnb, inRange, wbnbOnly }
// spendableBnb is what the wallet holds above the reserve and the gas budget.
// wbnbOnly (2026-09-16): the range lies entirely below the price and holds
// only WBNB — a buy ladder. BNB joins it as it is, no trade, and earns the
// moment the price comes down into it; that is growth, not a range that
// earns nothing. A range above the price (all of the other side) still
// refuses: joining it would mean buying the other side, and buying is what
// the ladder step does with a range of its own below the price.
export function refuseIncrease(state) {
  if (state.positions !== 1) return state.positions === 0
    ? 'this wallet holds no position to grow'
    : `this wallet holds ${state.positions} positions — which one to grow is a decision for a person`;
  if (!(state.spendableBnb >= MIN_INCREASE_BNB))
    return `only ${Number(state.spendableBnb || 0).toFixed(6)} BNB above the reserve, below the ${MIN_INCREASE_BNB} BNB floor — it stays as BNB until more arrives`;
  if (!state.inRange && state.wbnbOnly) return null;
  if (!state.inRange) return 'the price is outside the position\'s range, above it: the range is all of the other side, and BNB would have to be traded into it. The BNB is held for the ladder (a range of its own below the price) or the next re-set.';
  return null;
}

// THE LADDER (2026-09-16, the operator's "BNB als Reserve fuer Nachkauf").
// After a one-sided re-set below the price the whole position is the other
// side, waiting above the price. BNB that arrives then — a deposit, the
// kept half of the fees — used to be traded into the other side (the
// increase) or to idle. The ladder gives it a range of its own BELOW the
// price, WBNB only, no trade: a buy ladder under the sell ladder. Whichever
// way the price goes, one of the two earns, and the lower one buys the other
// side on the way down through fees instead of through a swap. The two are
// merged back into one the moment they hold the same token (the price went
// through one of them): the reserve is unwound at the main range's next
// re-set and its tokens go into the new range as they are.
// state: { gate, positions, mainSide ('other'|'wbnb'|'both'|null), reserve
//          (bool), reserveSide, spendableBnb, reserveLeft (bool) }
// Returns { act: 'mint_reserve'|'increase_reserve'|'merge'|'reset_reserve'
//           |null, why }. Pure; pinned both ways.
export const LADDER_GATE = 'LP_LADDER';
// THE LADDER RECORD FOLLOWS THE CHAIN (2026-09-17). The record names a main
// range the wallet no longer holds (burnt at a re-set whose new id was never
// written — a tick that died between the mint and the KV write, or the read
// that returned no id on 09-16 08:50) while the reserve it names is still
// there beside exactly one other position in the same pool: that other one
// is the main range. Anything else — the main still held, the reserve gone,
// a third position, another pool — is left as it is, and the guards refuse.
// state: { main, reserve, held: [ids], samePool (bool) }
// Returns { main, why } or null. Pure; pinned both ways.
export function ladderHeal(state) {
  const held = (state.held || []).map(String);
  if (state.main == null || state.reserve == null || held.length !== 2) return null;
  if (!held.includes(String(state.reserve)) || held.includes(String(state.main))) return null;
  if (state.samePool !== true) return null;
  const main = held.find((i) => i !== String(state.reserve));
  return { main, why: `the ladder record named main range #${state.main}, which this wallet no longer holds; beside the reserve #${state.reserve} it holds exactly one other position in the same pool, #${main} — that is the main range now` };
}
export function ladderDecision(state) {
  const no = (why) => ({ act: null, why });
  if (state.positions === 0) return no('no position: the first deposit opens the main range, not a ladder');
  if (state.positions > 2 || (state.positions === 2 && !state.reserve)) return no(`this wallet holds ${state.positions} positions the ladder record does not name — a decision for a person`);
  const spendable = Number(state.spendableBnb || 0);
  if (state.reserve) {
    if (state.mainSide && state.reserveSide && state.mainSide === state.reserveSide && state.mainSide !== 'both') return { act: 'merge', why: `main and reserve both hold only ${state.mainSide === 'wbnb' ? 'WBNB' : 'the other side'} — the price went through one of them; the reserve joins the main range at its re-set, no trade` };
    if (state.reserveLeft) return { act: 'reset_reserve', why: 'the price has left the reserve range by more than the slack — it is re-set beside the price, one-sided, no trade' };
    if (spendable >= MIN_INCREASE_BNB && state.mainSide === 'other') return { act: 'increase_reserve', why: `${spendable.toFixed(6)} BNB waits and the main range is all of the other side above the price — the BNB joins the reserve range below it, no trade` };
    return no(spendable >= MIN_INCREASE_BNB ? 'BNB waits, but the main range is not all of the other side — the increase step takes it' : `the ladder stands: main ${state.mainSide === 'both' ? 'in range' : state.mainSide === 'wbnb' ? 'below the price' : 'above the price'}, reserve below it; ${spendable.toFixed(6)} BNB waits, under the ${MIN_INCREASE_BNB} BNB floor`);
  }
  if (state.mainSide !== 'other') return no(state.mainSide === 'wbnb' ? 'the main range is all WBNB below the price — BNB joins it through the increase step, no ladder needed' : 'the main range is in range and earns on both sides — BNB joins it through the increase step');
  if (!(spendable >= MIN_INCREASE_BNB)) return no(`the main range is all of the other side above the price and only ${spendable.toFixed(6)} BNB waits, under the ${MIN_INCREASE_BNB} BNB floor — the ladder opens with the next deposit`);
  return { act: 'mint_reserve', why: `the main range is all of the other side above the price and ${spendable.toFixed(6)} BNB waits — it opens a reserve range below the price, WBNB only, no trade` };
}

