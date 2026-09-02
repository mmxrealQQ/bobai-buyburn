// Every reason the LP collect refuses to act, in one function.
//
// Shared by scripts/lp-collect.mjs (a person, plan by default) and
// worker-lp/index.js (the daily cron with the key). Two copies of a refusal
// list is how one of them stops refusing. Pure: no chain, no I/O.
//
// The floor is what a collect + swap + transfer costs in gas at 1 gwei with
// room to spare: below it, collecting fees loses money to recover them.
export const MIN_COLLECT_BNB = 0.002;

export function refuse(state) {
  if (state.positions === 0) return 'this wallet holds no position — open one first with lp-open.mjs';
  if (state.positions > 1) return `this wallet holds ${state.positions} positions. Collecting from one of several silently is a decision a person should make, not a script.`;
  if (state.liquidity === 0n) return 'the position has no liquidity left in it';
  if (state.owedBnbEquivalent <= 0) return 'nothing is owed yet';
  if (state.owedBnbEquivalent < MIN_COLLECT_BNB)
    return `only ${state.owedBnbEquivalent.toFixed(6)} BNB of fees are owed, below the ${MIN_COLLECT_BNB} BNB floor — collecting it would cost more gas than it recovers`;
  if (state.gasBnb < 0.0015) return `the wallet holds ${state.gasBnb.toFixed(6)} BNB, not enough gas for collect + swap + transfer`;
  if (state.quoteOffPct != null && Math.abs(state.quoteOffPct) > 25)
    return `the quote implies a price ${state.quoteOffPct.toFixed(1)}% away from the pool's own — refusing rather than trading into something that moved`;
  return null;
}
