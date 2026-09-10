// THE PORTFOLIO: the DeFi agent as one picture — what went in, what it is
// worth, what it holds where, the P&L by where it came from, the pool
// record's verdict, and what it did in the last day.
//
// One model, built here from the three records (the agent's own, the series,
// the pool record) and served at agent.brainonbnb.com/lp/portfolio. The
// /defi page and the Telegram card (/defi, and the 05:00 UTC post) render
// this JSON and compute nothing of their own — the operator's rule since
// 2026-09-07: a number the page shows and a number the bot posts come from
// one function, or one of them is wrong.
//
// Pure. Pinned by scripts/lp-portfolio.mjs --self-test.
import { CANDIDATES } from './lp-pools.js';

const n = (x) => Number(x || 0);
const r4 = (x) => Math.round(n(x) * 1e4) / 1e4;
const r5 = (x) => Math.round(n(x) * 1e5) / 1e5;

const labelOf = (pool) => (CANDIDATES.find((c) => c.pool === String(pool || '').toLowerCase()) || {}).label || null;

// What one recorded step did, in a few words, or null when it did nothing.
export function stepWords(name, s) {
  if (!s || typeof s !== 'object') return null;
  if (s.error) return { what: `${name}: ${s.error}`, error: true };
  if (!s.acted) return null;
  switch (name) {
    case 'sweep': return { what: `swept ${s.bnb_out != null ? r5(s.bnb_out) + ' BNB of ' : ''}income into the DeFi wallet` };
    case 'collect': return { what: `collected ${s.produced_bnb != null ? r5(s.produced_bnb) + ' BNB of ' : ''}fees${s.bobai_units ? `, ${Math.round(n(s.bobai_units)).toLocaleString('en-US')} $BOBAI bought and held` : ''}` };
    case 'relocate': return { what: `moved the position to ${s.to_label || labelOf(s.new_pool) || s.new_pool || 'another pool'}${s.new_position ? ` (#${s.new_position})` : ''}` };
    case 'rebalance': return { what: s.upgraded_to_pct != null
      ? `re-set the range wider/narrower: ±${s.upgraded_from_pct}% → ±${s.upgraded_to_pct}%${s.new_position ? ` (#${s.new_position})` : ''}`
      : `re-set the range around the price${s.new_position ? ` (#${s.new_position})` : ''}${n(s.bobai_bnb) > 0 ? `, ${r5(s.bobai_bnb)} BNB of its fees into $BOBAI` : ''}` };
    case 'increase': return { what: `grew the position${n(s.bnb_spent) > 0 ? ` by ${r4(s.bnb_spent)} BNB` : ''}` };
    default: return { what: `${name} acted` };
  }
}

// Every action in the last day, newest first (the operator, 2026-09-10:
// "das erste zuoberst"): the daily run and every hourly check that moved
// something, from the record's own history (only runs that acted or failed
// are kept there).
export function lastDay(rec, now = Date.now()) {
  const since = now - 24 * 3600e3;
  const runs = (Array.isArray(rec?.history) ? rec.history : []).filter((h) => h && h.at && Date.parse(h.at) >= since);
  const out = [];
  for (const h of runs) {
    const steps = h.steps && typeof h.steps === 'object' ? h.steps : {};
    for (const [name, v] of Object.entries(steps)) {
      for (const s of Array.isArray(v) ? v : [v]) {
        const w = stepWords(name, s);
        if (w) out.push({ at: h.at, step: name, ...w });
      }
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function lpPortfolio(rec, series, pools, { now = Date.now(), bobaiUsd = null } = {}) {
  const last = rec && rec.last;
  const sum = series && series.summary;
  if (!last || !last.at || !sum || !sum.profit) return null;
  const pts = Array.isArray(series.points) ? series.points : [];
  const pt = pts.length ? pts[pts.length - 1] : null;
  const bnbUsd = n(sum.profit.bnb_usd) || null;
  const usd = (bnb) => (bnbUsd ? Math.round(n(bnb) * bnbUsd * 100) / 100 : null);
  const value = sum.value_bnb || {};
  const putIn = n(value.capital_total_bnb) || (n(value.start) + n(value.added_by_hand_bnb) + n(sum.deposits_put_in_bnb) + n(sum.income_put_in_bnb));
  const sources = [{ label: 'start', bnb: r4(value.start) }];
  if (n(value.added_by_hand_bnb) > 0) sources.push({ label: 'by hand', bnb: r4(value.added_by_hand_bnb) });
  if (n(sum.deposits_put_in_bnb) > 0) sources.push({ label: 'deposited', bnb: r4(sum.deposits_put_in_bnb) });
  if (n(sum.income_put_in_bnb) > 0) sources.push({ label: 'from AI income', bnb: r4(sum.income_put_in_bnb) });

  // The range as it stands: the newest check, not the series' last point —
  // on 2026-09-10 the card said "in range" from the 05:40 point while the
  // 11:30 check had the price outside for two hours.
  const chk = rec.last_check && rec.last_check.at && Date.parse(rec.last_check.at) >= Date.parse(last.at) ? rec.last_check : last;
  const inc = (chk.steps && chk.steps.increase) || (last.steps && last.steps.increase) || {};
  const rb = (chk.steps && chk.steps.rebalance) || {};
  const position = (inc.position != null ? String(inc.position) : null) || (pt && pt.position != null ? String(pt.position) : null) || (rb.new_position != null ? String(rb.new_position) : null);
  const inRange = inc.in_range != null ? !!inc.in_range : rb.in_range != null ? !!rb.in_range : pt ? !!pt.in_range : null;
  const poolAddr = String(rec.pool || (pools && pools.watched && pools.watched.pool) || '').toLowerCase() || null;
  const poolLabel = (pools && pools.watched && pools.watched.label) || labelOf(poolAddr) || null;
  const walletBnb = inc.wallet_bnb != null ? n(inc.wallet_bnb) : pt ? n(pt.wallet_bnb) : 0;

  const p = sum.profit;
  const feeParts = [];
  if (n(p.fees_collected_bnb) > 0) feeParts.push({ label: 'collected', bnb: r5(p.fees_collected_bnb) });
  if (n(p.fees_folded_bnb) > 0) feeParts.push({ label: 'folded into the position', bnb: r5(p.fees_folded_bnb) });
  if (n(p.fees_forwarded_at_resets_bnb) > 0) feeParts.push({ label: 'into $BOBAI', bnb: r5(p.fees_forwarded_at_resets_bnb) });
  if (n(p.fees_owed_bnb) > 0) feeParts.push({ label: 'still owed by the position', bnb: r5(p.fees_owed_bnb) });

  let poolRecord = null;
  if (pools && Array.isArray(pools.pools) && pools.pools.length) {
    const rows = pools.pools;
    const shown = rows.slice(0, 3);
    const here = rows.find((x) => x.watched);
    if (here && !shown.includes(here)) shown.push(here);
    const same = !!(pools.pick && pools.watched && pools.pick.pool === pools.watched.pool);
    poolRecord = {
      usd: n(pools.usd) || 50, width_pct: n(pools.width_pct) || 1, pools: rows.length,
      rows: shown.map((x) => ({ label: x.label, here: !!x.watched, fees_usd_per_day: x.fees_usd_per_day == null ? null : r4(x.fees_usd_per_day), hours: x.hours })),
      pick: pools.pick ? { label: pools.pick.label, here: same } : null,
      pick_due: pools.pick_due || null,
      least_hours: rows.reduce((m, x) => Math.min(m, n(x.hours)), Infinity),
      move: pools.move ? { move: !!pools.move.move, why: pools.move.why, to: pools.move.to ? pools.move.to.label : null } : null,
    };
  }

  const day = lastDay(rec, now);
  return {
    at: last.at, date: String(last.at).slice(0, 10), checked_at: chk.at || last.at, bnb_usd: bnbUsd,
    pool: { address: poolAddr, label: poolLabel, position, in_range: inRange, range_checked_at: last.range_checked_at || chk.at || null },
    put_in: { bnb: r4(putIn), usd: usd(putIn), sources },
    worth: { bnb: r4(value.now), usd: usd(value.now) },
    holdings: {
      position_bnb: r4(value.now), fees_owed_bnb: r5(sum.fees_owed_now_bnb),
      bobai_units: Math.round(n(sum.bobai_held_units)), bobai_bnb: r5(sum.fees_into_bobai_bnb ?? sum.fees_sent_to_buyback_bnb),
      // What the held $BOBAI is worth now, at the pair's own price — read by
      // the route, so the model can say "3,895 $BOBAI (≈ $x)" beside the
      // BNB it cost.
      bobai_usd: bobaiUsd > 0 ? Math.round(n(sum.bobai_held_units) * bobaiUsd * 100) / 100 : null,
      bobai_usd_price: bobaiUsd > 0 ? bobaiUsd : null,
      wallet_bnb: r4(walletBnb),
    },
    pnl: {
      // Where the profit went, the operator's two halves: the fees kept as
      // capital (collected and kept, or folded in by a re-set) keep working;
      // the other half became $BOBAI the agent holds.
      kept_working_bnb: r5(sum.fees_kept_as_capital_bnb),
      into_bobai_bnb: r5(sum.fees_into_bobai_bnb ?? sum.fees_sent_to_buyback_bnb),
      bobai_units: Math.round(n(sum.bobai_held_units)),
      profit_bnb: r5(p.bnb), profit_usd: p.usd != null ? Math.round(n(p.usd) * 100) / 100 : usd(p.bnb), change_pct: Math.round(n(value.change_pct) * 100) / 100,
      from_price_bnb: r5(p.from_price_bnb), from_fees_bnb: r5(p.from_fees_bnb), fee_parts: feeParts, gas_bnb: r5(p.gas_bnb),
      in_range_runs: n(sum.days_in_range), runs: n(sum.runs_with_a_position), since: String(sum.since || '').slice(0, 10),
      other_token: poolLabel ? poolLabel.split('/')[0] : 'the other side',
    },
    pool_record: poolRecord,
    last_24h: day,
    last_run_ok: last.ok !== false,
    links: { page: 'https://brainonbnb.com/defi', record: 'https://agent.brainonbnb.com/lp/agent', series: 'https://agent.brainonbnb.com/lp/series', pools: 'https://agent.brainonbnb.com/lp/pools' },
  };
}
