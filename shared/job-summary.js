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
      return {
        headline: `${g.levels || '—'} levels across ±${n(g.band_pct, 1)}% on ${p.token?.symbol || 'the token'} — a completed cycle nets ${net == null ? '—' : (net >= 0 ? '+' : '') + pct(net)}`,
        facts: [
          ['Pool', `${p.pool?.venue || '—'}, ${usd(p.pool?.liquidity_usd)} deep`],
          ['Grid spacing', pct(g.spacing_pct)],
          ['Round-trip cost per cycle', pct(e.round_trip_cost_pct)],
          ['Transfer tax (measured)', p.transfer_tax ? `${pct(p.transfer_tax.buy_pct)} buy / ${pct(p.transfer_tax.sell_pct)} sell` : '—'],
          ['Warnings', String((p.warnings || []).length)],
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
      const best = (p.tiers || []).find((t) => t.tier === p.best_paying_tier) || null;
      return {
        headline: p.no_move_because
          ? `${p.best_paying_tier || '—'} pays best — ${String(p.no_move_because).split('. ')[0]}.`
          : `${p.best_paying_tier || '—'} pays best of ${p.tiers_measured ?? '—'} tiers measured`,
        facts: [
          ['Pair', `${p.pair?.token?.symbol || '—'} / ${p.pair?.quote?.symbol || '—'}`],
          ['Window', w.minutes != null ? `${n(w.minutes, 1)} min, ${n(w.blocks, 0)} blocks — not annualised` : '—'],
          ['Tiers found / measured', `${p.tiers_found ?? '—'} / ${p.tiers_measured ?? '—'}`],
          ['Most capital sits in', p.most_capital_tier || '—'],
          best ? ['Fees in the window, at the price', usd(best.your_fees_usd_in_window_if_placed_at_the_price)] : ['Move worth it', p.move_worth_it == null ? 'nothing to move' : String(p.move_worth_it)],
        ],
      };
    }
  } catch { /* fall through to the honest default */ }
  return { headline: 'Delivered. The document below is the deliverable.', facts: [] };
}
