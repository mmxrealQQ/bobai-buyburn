// Where the money came from and where it went, from the DeFi agent's
// own record.
//
// One function, used by the agent worker (the /lp/agent JSON and page, the
// series), by the liquidity page and by the Telegram report — so the three
// never disagree about a total. Everything is a sum over the record's history
// of runs that actually signed something; dry runs are skipped, they moved
// nothing. Pure: no chain, no I/O, pinned by the self-test in
// scripts/lp-agent.mjs.
//
// THE SHAPE
//   in    what came in: each income wallet's sweeps (sold, BNB received,
//         runs) and the fees the position produced
//   out   where it went: the buyback wallet, kept as capital, already put
//         into the position (increases), and how many re-sets
//   gas   what all of it cost in BNB, over how many transactions
//   waiting   what the last run saw still waiting: income on the wallets,
//         fees owed by the position, BNB in the DeFi wallet above reserve
//   rule  the fee share kept, as the last collect named it
//   paid_for  what the x402 service was paid for (from the agent worker's
//         own earnings record), when the caller has it

const n = (v) => Number(v) || 0;
const r6 = (v) => Number(v.toFixed(6));
// What a step's own transactions paid in gas. `bnb_spent` of an increase or a
// ladder mint is the wallet's balance before minus after, so the gas is in
// it; gas has its own line below. Counted in both, it left the profit twice
// (2026-09-18: 0.00087 BNB over 28 steps, 6.5% of the profit on the card).
const gasOf = (step) => (step && Array.isArray(step.txs) ? step.txs : []).reduce((a, t) => a + n(t.gas_bnb), 0);

export function moneyFlow(rec, { earned = null } = {}) {
  const hist = (Array.isArray(rec?.history) ? rec.history : []).filter((e) => e && !e.dry);
  const bySource = {};
  let feesProduced = 0, feesKept = 0, feesForwarded = 0, collects = 0, bobaiUnits = 0;
  let intoPosition = 0, increases = 0, resets = 0, gas = 0, txs = 0;
  let feesFolded = 0, resetsWithFees = 0, resetForwarded = 0;
  let lastKeptPct = null;
  let first = null, lastMoved = null;
  for (const e of hist) {
    const st = e.steps || {};
    const sweeps = Array.isArray(st.sweep) ? st.sweep : [];
    for (const s of sweeps) {
      if (!s.acted || s.error) continue;
      const k = s.source || 'income';
      bySource[k] = bySource[k] || { source: k, token: s.token || null, sold: 0, bnb: 0, runs: 0 };
      bySource[k].sold += n(s.sold);
      bySource[k].bnb += n(s.received_bnb);
      bySource[k].runs += 1;
    }
    const c = st.collect;
    if (c && c.acted && !c.error) {
      // Records before the split carry only forwarded_bnb; that was all of it.
      const produced = c.produced_bnb != null ? n(c.produced_bnb) : n(c.forwarded_bnb) + n(c.kept_bnb);
      if (produced > 0) {
        collects += 1;
        feesProduced += produced;
        feesKept += n(c.kept_bnb);
        // Since 2026-09-09 the share buys BOBAI held in the wallet (c.bobai_bnb);
        // older records sent it to the buyback wallet (c.forwarded_bnb).
        feesForwarded += n(c.bobai_bnb ?? c.forwarded_bnb);
        bobaiUnits += n(c.bobai_units);
      }
    }
    const inc = st.increase;
    if (inc && inc.acted && !inc.error) {
      increases += 1;
      intoPosition += inc.bnb_spent != null ? Math.max(0, n(inc.bnb_spent) - gasOf(inc)) : n(inc.wbnb_used);
    }
    // The ladder step (2026-09-16) puts BNB into the reserve range: capital
    // into the position like an increase, counted the same way.
    const ld = st.ladder;
    if (ld && ld.acted && !ld.error && n(ld.bnb_spent) > 0) {
      increases += 1;
      intoPosition += Math.max(0, n(ld.bnb_spent) - gasOf(ld));
    }
    const rb = st.rebalance;
    if (rb && rb.acted && !rb.error && rb.new_position) {
      resets += 1;
      // A re-set does not collect the old range's fees as fees: the unwind
      // pays them out with the principal. They are fees the position
      // produced all the same. Before 2026-09-08 the mint folded all of them
      // into the new capital; since then the buyback share is sent on first
      // (fees_forwarded_bnb) and only the rest is folded in.
      if (n(rb.fees_folded_bnb) > 0) { feesFolded += n(rb.fees_folded_bnb); resetsWithFees += 1; }
      if (n(rb.bobai_bnb ?? rb.fees_forwarded_bnb) > 0) resetForwarded += n(rb.bobai_bnb ?? rb.fees_forwarded_bnb);
      bobaiUnits += n(rb.bobai_units);
      if (rb.fees_kept_pct != null) lastKeptPct = n(rb.fees_kept_pct);
      // A re-set forced by a deposit wraps the waiting BNB into its own mint:
      // capital put in, like an increase — no increase follows to count it.
      if (n(rb.wrapped_waiting_bnb) > 0) { intoPosition += n(rb.wrapped_waiting_bnb); increases += 1; }
    }
    if (c && c.acted && !c.error && c.kept_pct != null) lastKeptPct = n(c.kept_pct);
    for (const step of [...sweeps, c, inc, rb, st.ladder]) {
      for (const t of (step && Array.isArray(step.txs) ? step.txs : [])) { txs += 1; gas += n(t.gas_bnb); }
    }
    if (e.acted) { if (!first) first = e.at; lastMoved = e.at; }
  }
  const income = Object.values(bySource).map((s) => ({ ...s, sold: r6(s.sold), bnb: r6(s.bnb) }));
  const incomeBnb = income.reduce((a, s) => a + s.bnb, 0);

  const last = rec?.last || {}, ls = last.steps || {};
  const lastSweeps = Array.isArray(ls.sweep) ? ls.sweep : [];
  const waiting = {
    income: lastSweeps.filter((s) => s.balance > 0).map((s) => ({ source: s.source || null, token: s.token || s.source || null, amount: n(s.balance), bnb: s.bnb_equivalent != null ? n(s.bnb_equivalent) : null })),
    // The newest figure: the hourly check's rebalance step reads what the
    // position owes now; the daily collect's figure is up to a day old.
    fees_owed_bnb: ls.rebalance && ls.rebalance.fees_owed_bnb != null ? r6(n(ls.rebalance.fees_owed_bnb)) : ls.collect && ls.collect.owed ? r6(n(ls.collect.owed.bnb_equivalent)) : 0,
    wallet_spendable_bnb: ls.increase && ls.increase.spendable_bnb != null ? r6(n(ls.increase.spendable_bnb)) : null,
  };
  // The rule is what the last step that split fees named: the last collect,
  // or the last re-set that forwarded (since 2026-09-08 re-sets split too).
  const keptPct = ls.collect && ls.collect.kept_pct != null ? n(ls.collect.kept_pct) : lastKeptPct;
  const foldedKept = feesFolded - resetForwarded;

  return {
    since: first,
    last_moved: lastMoved,
    in: {
      income,
      income_bnb: r6(incomeBnb),
      // bnb = collected by the collect step + taken by re-sets; folded_bnb
      // is all a re-set took, folded_kept_bnb the part it minted into the
      // new capital, forwarded_at_resets_bnb the part it sent to the buyback.
      fees: { bnb: r6(feesProduced + feesFolded), collects, collected_bnb: r6(feesProduced), folded_bnb: r6(feesFolded), folded_kept_bnb: r6(foldedKept), forwarded_at_resets_bnb: r6(resetForwarded), resets_with_fees: resetsWithFees },
      total_bnb: r6(incomeBnb + feesProduced + feesFolded),
    },
    out: {
      // BNB the agent spent buying BOBAI it now holds in its own wallet
      // (before 2026-09-09 this went to the buyback wallet).
      bobai_bnb: r6(feesForwarded + resetForwarded),
      bobai_units: r6(bobaiUnits),
      kept_as_capital_bnb: r6(feesKept + foldedKept),
      capital_arrived_bnb: r6(incomeBnb + feesKept + foldedKept),
      into_position_bnb: r6(intoPosition),
      increases,
      resets,
    },
    gas: { bnb: r6(gas), transactions: txs },
    waiting,
    rule: keptPct == null ? null : { fee_share_kept_pct: keptPct, fee_share_bobai_pct: 100 - keptPct },
    paid_for: earned ? { x402_answers: n(earned.count), usd1: n(earned.totalUsd1) } : null,
  };
}

// The flow in one sentence per direction, for a page or a chat message.
// Figures are BNB with five decimals; the caller adds dollars if it has them.
export function flowLines(flow) {
  if (!flow) return null;
  const f = (v) => n(v).toFixed(5);
  const income = flow.in.income.length
    ? flow.in.income.map((s) => `${f(s.bnb)} BNB from ${s.sold} ${s.token || s.source} (${s.source}, ${s.runs} sweep${s.runs === 1 ? '' : 's'})`).join(', ')
    : 'no income swept yet';
  const fd = flow.in.fees.folded_bnb || 0, rw = flow.in.fees.resets_with_fees || 0, rf = flow.in.fees.forwarded_at_resets_bnb || 0;
  const folded = fd > 0 ? `${f(fd)} BNB of fees taken at ${rw} re-set${rw === 1 ? '' : 's'}${rf > 0 ? `, ${f(rf)} of it spent on BOBAI held` : ', all of it folded into the capital'}` : '';
  const fees = flow.in.fees.collects
    ? `${f(flow.in.fees.collected_bnb != null ? flow.in.fees.collected_bnb : flow.in.fees.bnb)} BNB of fees over ${flow.in.fees.collects} collect${flow.in.fees.collects === 1 ? '' : 's'}${folded ? `, ${folded}` : ''}`
    : (folded || 'no fees collected yet');
  const out = flow.in.fees.collects || flow.in.income.length || fd > 0
    ? `${f(flow.out.bobai_bnb)} BNB spent on BOBAI held in the wallet, ${f(flow.out.kept_as_capital_bnb)} BNB kept as capital, ${f(flow.out.into_position_bnb)} BNB already put into the position`
    : 'nothing has left the wallet yet';
  return {
    came_in: `${income}; ${fees}`,
    went_out: out,
    // "on record": runs by hand and, before 2026-09-06, the transactions a
    // failed run sent before its revert are not in the record — the wallet's
    // nonce on the chain is the full count.
    cost: `${flow.gas.transactions} transaction${flow.gas.transactions === 1 ? '' : 's'} on record, ${n(flow.gas.bnb).toFixed(6)} BNB of gas`,
  };
}

// THE HISTORY'S CAP AND ITS ARCHIVE (2026-09-15). The record keeps its
// newest HISTORY_CAP runs; at three runs a day that is about 65 days, and
// every total above is a sum over that history — put in, fees, the $BOBAI
// bought, what each re-set lost. Dropping the oldest runs would have made
// the totals shrink silently from early November 2026. So a run the cap
// pushes out is not dropped: the writer (worker-lp) appends it to the
// archive key, and every reader that sums (worker-agent) merges the
// archive back in front of the history before it counts. The record a
// browser sees at /lp/agent is the merged one; the archive is a store, not
// a second source. Both pure, pinned by scripts/lp-agent.mjs --self-test.
export const HISTORY_CAP = 200;
export const ARCHIVE_KEY = 'lp:agent:archive';

// The history after one more entry: what stays on the record and what the
// cap pushed out, oldest first, so the archive keeps the order of the runs.
export function trimHistory(history, entry, cap = HISTORY_CAP) {
  const all = (Array.isArray(history) ? history : []).concat(entry === undefined ? [] : [entry]);
  const over = Math.max(0, all.length - cap);
  return { kept: all.slice(over), dropped: all.slice(0, over) };
}

// The record with its archived runs back in front of the history, and how
// many were archived — the shape every sum expects.
export function withArchive(rec, archive) {
  const entries = Array.isArray(archive?.entries) ? archive.entries : [];
  if (!rec || !entries.length) return rec;
  return { ...rec, history: entries.concat(Array.isArray(rec.history) ? rec.history : []), history_archived: entries.length };
}
