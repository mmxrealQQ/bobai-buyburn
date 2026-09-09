// Every reason the LP agent refuses to act, in one file.
//
// Shared by scripts/lp-agent.mjs (a person, plan by default) and
// worker-lp/index.js (the daily cron with the keys). Two copies of a refusal
// list is how one of them stops refusing. Pure: no chain, no I/O.
//
// Three steps, three guard functions, and the floors they share:
//   sweep     AI income (USD1, $U) -> BNB -> the liquidity wallet
//   collect   position fees -> BNB -> the buyback wallet
//   increase  BNB above the reserve -> more of the same position
//
// Every floor is a gas argument: below it, moving the money costs more than
// the money. A day under a floor is a decision, not an error, and is recorded
// as one.

// What the liquidity wallet keeps back after every run. Above MIN_GAS_BNB on
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
// every width with a wait of 0, 1, 2 and 3 h before a re-set and names the
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
  if (!best || !base) return keep(`the set wait of ${set} h — the record has not yet replayed every wait`);
  if (!(hoursOfPrices >= WAIT_PICK_MIN_HOURS)) return keep(`the set wait of ${set} h — the record holds ${hoursOfPrices} h of prices and a measured wait needs ${WAIT_PICK_MIN_HOURS} h`);
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
// A re-set trades about half the position to re-centre it, through the
// PancakeSwap V2 router — a 0.25% pool. On 2026-09-09 that was measured at
// 0.04 WBNB a re-set: 0.0001 BNB of fee, more than the re-set's whole gas
// (0.00007 BNB). Until then the measured re-set cost was gas alone, and the
// wait test, charged half the true cost, favoured re-setting at once.
export const V2_SWAP_FEE_PCT = 0.25;
// How much of the fees a collect keeps as capital, in percent. The rest goes
// to the buyback wallet. Until 2026-09-04 every collected fee went to the
// buyback; since then the position keeps half, so it grows out of its own
// earnings and the buyback's share grows with it ("er soll auch davon
// wachsen"). The kept share waits as BNB in the liquidity wallet and goes
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

// state: { positions, inRange, width, hoursOfPrices, valueBnb }
// width is what the earnings test in the window record picked, or what a
// person named by hand; null means the record cannot yet say which width earns.
// state.resume: no position, but the wallet holds the pool's two tokens — a
// re-set that stopped between its unwind and its mint. Then the plan is the
// mint alone, sized like a re-set (the same width, the same floor), and the
// "in range" question does not arise: there is no range yet.
export function refuseRebalance(state) {
  if (state.positions !== 1 && !(state.positions === 0 && state.resume)) return state.positions === 0
    ? 'this wallet holds no position to re-set'
    : `this wallet holds ${state.positions} positions — which one to re-set is a decision for a person`;
  if (state.inRange) return 'the price is inside the range — nothing to re-set';
  if (state.width == null)
    return `no width has yet earned more than its re-sets over the recorded prices (${state.hoursOfPrices || 0} h recorded, ${MIN_HOURS_FOR_EARNINGS} h needed). A re-set into a width that only held 37 minutes is how a position pays for a re-set every day. Holding.`;
  if (!(state.valueBnb >= MIN_REBALANCE_BNB))
    return `${state.resume ? "the wallet's two sides are" : 'the position is'} worth ${Number(state.valueBnb || 0).toFixed(6)} BNB, below the ${MIN_REBALANCE_BNB} BNB floor — a ${state.resume ? 'mint' : 're-set'} would cost more than it is likely to earn back`;
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

// state: { positions, spendableBnb, inRange }
// spendableBnb is what the wallet holds above the reserve and the gas budget.
export function refuseIncrease(state) {
  if (state.positions !== 1) return state.positions === 0
    ? 'this wallet holds no position to grow'
    : `this wallet holds ${state.positions} positions — which one to grow is a decision for a person`;
  if (!(state.spendableBnb >= MIN_INCREASE_BNB))
    return `only ${Number(state.spendableBnb || 0).toFixed(6)} BNB above the reserve, below the ${MIN_INCREASE_BNB} BNB floor — it stays as BNB until more arrives`;
  if (!state.inRange) return 'the price is outside the position\'s range. Adding to a range that earns nothing is not growth; the BNB is held until the range is re-set.';
  return null;
}
