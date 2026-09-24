// What a delivered answer says, in a few lines a person can read.
//
// Every service this project sells returns a JSON document, and the document
// is the deliverable: the SHA-256 of it is what goes on-chain. Nobody hires
// on the strength of a JSON blob, though. This turns each service's result
// into a headline and a handful of labelled figures, and it is the ONE place
// that does so — the marketplace card (scripts/erc8004-publish.mjs) and the
// job page (worker-agent/index.js, /job?id=) both read it, so the example a
// buyer sees before paying and the delivery they read after cannot be
// summarised by two different rules.
//
// Rules: every figure comes from the result, nothing is recomputed, and a
// result this cannot read is summarised as "delivered; read the document",
// never as a guess. Plain ESM, no imports — it runs in the worker and in Node.

const n = (v, d = 2) => (v == null || !isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const usd = (v) => (v == null || !isFinite(Number(v)) ? '—' : '$' + n(v, Number(v) >= 100 ? 0 : 2));
const pct = (v, d = 2) => (v == null || !isFinite(Number(v)) ? '—' : n(v, d) + '%');

export function summarize(service, result) {
  const r = result || {};
  try {
    if (service === 'health_factor' && r.position) {
      const p = r.position, d = r.drawdown || {};
      if (!p.has_position) return { headline: 'No Venus position at that address.', facts: [['Account', p.account || '—']] };
      return {
        headline: `Health factor ${n(p.health_factor, 4)} — ${p.verdict || (p.liquidatable ? 'liquidatable' : 'not liquidatable')}`,
        facts: [
          ['Borrowed', usd(p.borrowed_usd)],
          ['Collateral', usd(p.collateral_usd)],
          ['Headroom before liquidation', usd(p.headroom_usd)],
          ['Collateral can fall by', d.tolerable_collateral_drop_pct != null ? pct(d.tolerable_collateral_drop_pct) : '—'],
          ['Cross-check with Venus', p.cross_check ? (p.cross_check.agrees ? 'agrees' : 'DISAGREES') : '—'],
        ],
      };
    }
    if (service === 'grid_plan' && r.plan) {
      const p = r.plan, g = p.grid || {}, e = p.economics || {};
      const net = e.net_per_completed_cycle_pct;
      const warns = (p.warnings || []).map((w) => String(typeof w === 'string' ? w : w?.text || w?.message || JSON.stringify(w)));
      return {
        headline: `${g.levels || '—'} levels across ±${n(g.band_pct, 1)}% on ${p.token?.symbol || 'the token'} — a completed cycle nets ${net == null ? '—' : (net >= 0 ? '+' : '') + pct(net)}`,
        // What the delivery is about, so a page can hold it against what was
        // asked: job 56670 asked for WBNB and was delivered for BOBAI.
        subject: p.token?.symbol || null,
        facts: [
          ['Pool', `${p.pool?.venue || '—'}, ${usd(p.pool?.liquidity_usd)} deep`],
          ['Grid spacing', pct(g.spacing_pct)],
          ['Round-trip cost per cycle', pct(e.round_trip_cost_pct)],
          ['Transfer tax (measured)', p.transfer_tax ? `${pct(p.transfer_tax.buy_pct)} buy / ${pct(p.transfer_tax.sell_pct)} sell` : '—'],
          // "Warnings 2" said nothing; the warnings are in the document.
          ['Warnings', warns.length ? warns.join(' · ').slice(0, 400) : 'none'],
        ],
      };
    }
    if (service === 'yield_plan' && r.plan) {
      const p = r.plan, top = (p.ranked || []).slice(0, 3);
      return {
        headline: p.verdict ? String(p.verdict).split('. ')[0] + '.' : `Best available: ${p.best_available?.symbol || '—'} at ${pct(p.best_available?.supply_apy_pct)}`,
        facts: [
          ...top.map((m, i) => [`#${i + 1} ${m.symbol}`, `${pct(m.supply_apy_pct)} supply APY, ${usd(m.available_liquidity_usd)} available`]),
          ['Markets read', String(p.markets_read ?? '—')],
          ['Block time measured', p.measured_block_time ? `${n(p.measured_block_time.seconds_per_block, 4)} s` : '—'],
        ],
      };
    }
    if (service === 'rebalance_plan' && r.plan) {
      const p = r.plan, e = p.economics || {};
      const moves = (p.legs || []).filter((l) => l.action && l.action !== 'hold');
      return {
        headline: p.verdict ? String(p.verdict).split(' — ')[0] : `${moves.length} trade(s) to reach the target weights`,
        facts: [
          ['Portfolio', `${usd(p.portfolio?.total_usd)} in ${p.portfolio?.holdings ?? '—'} holding(s)`],
          ['Value to move', usd(e.value_to_move_usd)],
          ['Cost of the rebalance', `${usd(e.cost_to_rebalance_usd)} (${pct(e.cost_pct_of_value_moved)} of what moves)`],
          ...moves.slice(0, 3).map((l) => [`${l.action} ${l.symbol || l.token}`, `${usd(l.trade_usd)}, costs ${pct(l.cost_pct)}`]),
        ],
      };
    }
    if (service === 'lp_tier_plan' && r.plan) {
      const p = r.plan, w = p.measured_window || {};
      // The tier for the buyer's own size (2026-09-24); older plans carry only
      // the pool-wide ranking.
      const bestTier = p.best_tier_for_your_size || p.best_paying_tier;
      const pays = p.best_tier_for_your_size ? 'pays your size best' : 'pays best';
      const best = (p.tiers || []).find((t) => t.tier === bestTier) || null;
      return {
        headline: p.no_move_because
          ? `${bestTier || '—'} ${pays} — ${String(p.no_move_because).split('. ')[0]}.`
          : `${bestTier || '—'} ${pays} of ${p.tiers_measured ?? '—'} tiers measured`,
        subject: p.pair?.token?.symbol || null,
        facts: [
          ['Pair', `${p.pair?.token?.symbol || '—'} / ${p.pair?.quote?.symbol || '—'}`],
          ['Window', w.minutes != null ? `${n(w.minutes, 1)} min, ${n(w.blocks, 0)} blocks — not annualised` : '—'],
          ['Tiers found / measured', `${p.tiers_found ?? '—'} / ${p.tiers_measured ?? '—'}`],
          ['Most capital sits in', p.most_capital_tier || '—'],
          best ? ['Your fees in the window, at the price', usd(best.your_fees_usd_in_window_if_placed_at_the_price)] : null,
          p.move_worth_it ? ['Move worth it', `${p.move_worth_it.from} → ${p.move_worth_it.to}: ${usd(p.move_worth_it.extra_fees_usd_per_window)} more a window, pays back ${usd(p.move_worth_it.assumed_move_cost_usd)} in ${n(p.move_worth_it.hours_to_break_even_if_this_rate_held, 1)} h if the rate held`] : ['Move worth it', 'nothing to move'],
        ].filter(Boolean),
      };
    }
    if (service === 'lp_position_plan' && r.plan) {
      const p = r.plan;
      if (!p.position) return { headline: p.verdict || 'No position to plan.', facts: [['Address', p.address || '—'], ['Positions', String(p.positions ?? '—')]] };
      const owed = p.fees_owed && p.fees_owed.bnb_equivalent;
      return {
        headline: (p.in_range ? 'In range' : 'Out of range') + ` — position #${p.position} worth ${n(p.value_bnb, 4)} BNB`,
        facts: [
          ['Pool', p.pool ? `${pct(p.pool.fee_tier_pct)} tier, ticks ${p.pool.ticks.join(' … ')}, price at ${p.pool.tick}` : '—'],
          ['Room to the edges', p.room ? `${pct(p.room.to_lower_pct)} below, ${pct(p.room.to_upper_pct)} above` : '—'],
          ['Fees owed', owed == null ? '—' : `${n(owed, 6)} BNB — ${p.collect && p.collect.pays_for_gas ? 'collecting pays for its gas' : 'under the gas floor, left to grow'}`],
          ['Re-set', p.rebalance ? (p.rebalance.why || (p.rebalance.new_ticks ? `due: ticks ${p.rebalance.new_ticks.join(' … ')}, ±${p.rebalance.width_pct}%` : '—')) : '—'],
          ['Grow', p.increase ? (p.increase.why || (p.increase.wbnb ? `${p.increase.wbnb} WBNB from spare BNB` : '—')) : '—'],
        ],
      };
    }
  } catch { /* fall through to the honest default */ }
  return { headline: 'Delivered. The document below is the deliverable.', facts: [] };
}
