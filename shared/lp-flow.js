// Where the money came from and where it went, from the liquidity agent's
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
//         fees owed by the position, BNB in the liquidity wallet above reserve
//   rule  the fee share kept, as the last collect named it
//   paid_for  what the x402 service was paid for (from the agent worker's
//         own earnings record), when the caller has it

const n = (v) => Number(v) || 0;
const r6 = (v) => Number(v.toFixed(6));

export function moneyFlow(rec, { earned = null } = {}) {
  const hist = (Array.isArray(rec?.history) ? rec.history : []).filter((e) => e && !e.dry);
  const bySource = {};
  let feesProduced = 0, feesKept = 0, feesForwarded = 0, collects = 0;
  let intoPosition = 0, increases = 0, resets = 0, gas = 0, txs = 0;
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
        feesForwarded += n(c.forwarded_bnb);
      }
    }
    const inc = st.increase;
    if (inc && inc.acted && !inc.error) {
      increases += 1;
      intoPosition += inc.bnb_spent != null ? n(inc.bnb_spent) : n(inc.wbnb_used);
    }
    const rb = st.rebalance;
    if (rb && rb.acted && !rb.error && rb.new_position) resets += 1;
    for (const step of [...sweeps, c, inc, rb]) {
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
    fees_owed_bnb: ls.collect && ls.collect.owed ? r6(n(ls.collect.owed.bnb_equivalent)) : 0,
    wallet_spendable_bnb: ls.increase && ls.increase.spendable_bnb != null ? r6(n(ls.increase.spendable_bnb)) : null,
  };
  const keptPct = ls.collect && ls.collect.kept_pct != null ? n(ls.collect.kept_pct) : null;

  return {
    since: first,
    last_moved: lastMoved,
    in: {
      income,
      income_bnb: r6(incomeBnb),
      fees: { bnb: r6(feesProduced), collects },
      total_bnb: r6(incomeBnb + feesProduced),
    },
    out: {
      buyback_bnb: r6(feesForwarded),
      kept_as_capital_bnb: r6(feesKept),
      capital_arrived_bnb: r6(incomeBnb + feesKept),
      into_position_bnb: r6(intoPosition),
      increases,
      resets,
    },
    gas: { bnb: r6(gas), transactions: txs },
    waiting,
    rule: keptPct == null ? null : { fee_share_kept_pct: keptPct, fee_share_buyback_pct: 100 - keptPct },
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
  const fees = flow.in.fees.collects
    ? `${f(flow.in.fees.bnb)} BNB of fees over ${flow.in.fees.collects} collect${flow.in.fees.collects === 1 ? '' : 's'}`
    : 'no fees collected yet';
  const out = flow.in.fees.collects || flow.in.income.length
    ? `${f(flow.out.buyback_bnb)} BNB to the buyback wallet, ${f(flow.out.kept_as_capital_bnb)} BNB kept as capital, ${f(flow.out.into_position_bnb)} BNB already put into the position`
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
