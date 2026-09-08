// THE POOL RECORD: what the same fifty dollars would have earned in each of
// the pools the liquidity agent could live in, hour by hour.
//
// The width record (lp-windows.js) answers "how wide" for the pool the agent
// is in. This answers the question that comes before it and was answered
// once, by hand, on 2026-09-08: "which pool". The operator's rule is that the
// position exists to make a profit and that the choice is CAKE/BNB or BOB/BNB,
// each against BNB — so those are the candidates, in the fee tiers that hold
// any liquidity at all. One 37-minute sample that morning put CAKE/BNB 0.01%
// at twice the fees per working dollar of the 0.05% pool the agent is in,
// and BOB/BNB's V3 pools at zero swaps. A sample is not a rate. This keeps the
// samples until they are one.
//
// It reads. It signs nothing, holds no key and moves nothing. The agent does
// not move pools on its own: a pool change is a withdrawal, two trades and a
// mint, and a record that says "the other pool paid more this week" is the
// evidence for a decision, not the decision. The record is served at
// agent.brainonbnb.com/lp/pools and the verdict is pure, so the hand script
// can pin its rules.
//
// COST. Every candidate but the watched one is one extra replay per hour on
// our own MCP endpoint (the watched pool's window is copied from the width
// record, which measured it minutes earlier in the same tick). Two candidates
// is 48 replays a day and one KV write an hour.

import { KV_KEY as WINDOWS_KEY, POSITION_USD, measure, windowFromPlan } from './lp-windows.js';

export const KV_KEY = 'lp:pools';
// Hourly windows; 200 is over a week per pool, which is more than a pool
// decision should rest on before somebody looks at it.
export const MAX_WINDOWS = 200;
// A day of hours before any pool is called better than another. Below this
// the record reports and refuses to pick — the same threshold the width
// record uses before it trusts its earnings test.
export const MIN_HOURS_TO_PICK = 24;

// The pools the operator named, by address. The watched pool is whichever of
// these env.LP_WATCH_POOL points at; the others are measured beside it.
export const CANDIDATES = [
  { pool: '0xafb2da14056725e3ba3a30dd846b6bbbd7886c56', label: 'CAKE/BNB 0.05%', pair: 'CAKE/BNB', fee_pct: 0.05 },
  { pool: '0x1e213600fa9317feac4ef4087acdf5d0e25d7187', label: 'CAKE/BNB 0.01%', pair: 'CAKE/BNB', fee_pct: 0.01 },
  { pool: '0x910a64e36da4bec09a0772b11d437869ad07dc4b', label: 'BOB/BNB 0.05%', pair: 'BOB/BNB', fee_pct: 0.05 },
];

const labelOf = (pool) => (CANDIDATES.find((c) => c.pool === String(pool).toLowerCase()) || {}).label || String(pool);

// One window, the shape the width record uses, trimmed to what a pool
// comparison reads: the fees each width earned in the window, whether it
// held, and how busy the pool was.
export function poolWindow(entry) {
  return {
    at: entry.at,
    from_block: entry.from_block,
    to_block: entry.to_block,
    minutes: entry.minutes,
    swaps: entry.swaps,
    price: entry.price,
    pool_fees_usd: entry.pool_fees_usd,
    rows: (entry.rows || []).map((r) => ({ width: r.width, fees: r.fees, held: r.held })),
  };
}

// Appends unless this exact chain slice is already there for that pool.
export function appendPoolWindow(log, pool, entry) {
  const key = String(pool).toLowerCase();
  const rec = log.pools[key] || { label: labelOf(key), windows: [] };
  if (rec.windows.some((x) => x.from_block === entry.from_block && x.to_block === entry.to_block)) return { log, added: false };
  const windows = rec.windows.concat(poolWindow(entry));
  if (windows.length > MAX_WINDOWS) windows.splice(0, windows.length - MAX_WINDOWS);
  return { log: { ...log, pools: { ...log.pools, [key]: { ...rec, label: labelOf(key), windows } } }, added: true };
}

// WHAT THE RECORD SAYS, per pool, at one width. Pure; pinned by
// scripts/lp-pools.mjs --self-test.
//   - each pool is read over its own recorded hours (windows carry their
//     minutes; a window earns for the minutes it covers, nothing more),
//   - fees are what the replay says $usd would have collected inside the
//     width, so a pool where $50 is a large share of the working capital is
//     already diluted by its own arithmetic,
//   - a pool is "quiet" for a window in which nobody swapped,
//   - nothing is picked until every pool has a day of hours; then the pool
//     with the most fees per day at this width is named, and the watched
//     pool is named beside it whether or not they are the same,
//   - the pick is a finding. The agent never acts on it by itself.
export function poolVerdict(log, widthPct, { watched = null, minHours = MIN_HOURS_TO_PICK } = {}) {
  const usd = log?.usd || POSITION_USD;
  const pools = Object.entries(log?.pools || {}).map(([pool, rec]) => {
    let fees = 0, hours = 0, swaps = 0, quiet = 0, held = 0, priced = 0;
    for (const w of rec.windows || []) {
      const row = (w.rows || []).find((r) => r.width === widthPct);
      if (!row || typeof row.fees !== 'number') continue;
      const h = (w.minutes || 37.5) / 60;
      fees += row.fees; hours += h; priced += 1;
      swaps += Number(w.swaps || 0);
      if (!Number(w.swaps || 0)) quiet += 1;
      if (row.held) held += 1;
    }
    const r4 = (x) => Math.round(x * 10000) / 10000, r1 = (x) => Math.round(x * 10) / 10;
    return {
      pool,
      label: rec.label || labelOf(pool),
      watched: !!watched && pool === String(watched).toLowerCase(),
      windows: priced,
      hours: r1(hours),
      swaps,
      quiet_windows: quiet,
      held_pct: priced ? Math.round((held / priced) * 1000) / 10 : null,
      fees_usd: r4(fees),
      fees_usd_per_day: hours > 0 ? r4((fees / hours) * 24) : null,
      first: (rec.windows || [])[0]?.at || null,
      last: (rec.windows || []).slice(-1)[0]?.at || null,
    };
  }).sort((a, b) => (b.fees_usd_per_day ?? -1) - (a.fees_usd_per_day ?? -1));
  const enough = pools.length >= 2 && pools.every((p) => p.hours >= minHours);
  const pick = enough ? pools[0] : null;
  const watchedRow = pools.find((p) => p.watched) || null;
  return {
    usd,
    width_pct: widthPct,
    pools,
    pick: pick ? { pool: pick.pool, label: pick.label, fees_usd_per_day: pick.fees_usd_per_day } : null,
    watched: watchedRow ? { pool: watchedRow.pool, label: watchedRow.label, fees_usd_per_day: watchedRow.fees_usd_per_day } : null,
    why: !pools.length ? 'nothing recorded yet'
      : !enough ? `no pick until every pool has ${minHours} h of windows (${pools.map((p) => `${p.label} ${p.hours} h`).join(', ')})`
      : pick && watchedRow && pick.pool === watchedRow.pool ? `${pick.label}, the pool the agent is in, earned the most per day for $${usd} in ±${widthPct}%`
      : pick && watchedRow ? `${pick.label} earned $${pick.fees_usd_per_day} a day for $${usd} in ±${widthPct}% against $${watchedRow.fees_usd_per_day} in ${watchedRow.label}, where the agent is. A finding, not a move: the agent never changes pools by itself.`
      : `${pick.label} earned the most per day for $${usd} in ±${widthPct}%`,
    rule: 'Each pool is replayed with the same code over its own recorded hours; fees are what this much capital would have collected inside the width, diluted by the pool\'s own working capital. Nothing is picked until every pool has a day of windows. The pick is evidence for the operator; the agent does not act on it.',
  };
}

export async function readLpPools(env) {
  const raw = await env.AGENT.get(KV_KEY);
  return raw ? JSON.parse(raw) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN_REFUSED = /every BSC endpoint refused|rate limit|capacity|too many|quota|429|timed out|timeout|aborted|network|fetch failed/i;

// The hourly tick, run after the width record's own so the watched pool's
// window is already there to copy. One replay per other candidate, one KV
// read, one KV write. A candidate the chain refuses this hour is skipped
// this hour — a missing window is a gap, an invented one is a lie.
export async function recordLpPools(env) {
  const watched = String(env.LP_WATCH_POOL || '').toLowerCase();
  const prev = (await readLpPools(env)) || { usd: POSITION_USD, since: new Date().toISOString(), pools: {} };
  let log = { ...prev, usd: POSITION_USD, pools: { ...(prev.pools || {}) } };
  const added = [], skipped = [];

  // The watched pool: the width record measured it minutes ago.
  if (watched) {
    const w = JSON.parse((await env.AGENT.get(WINDOWS_KEY)) || 'null');
    const latest = w && w.pool && w.pool.toLowerCase() === watched ? (w.windows || []).slice(-1)[0] : null;
    if (latest) {
      const r = appendPoolWindow(log, watched, latest);
      log = r.log; if (r.added) added.push(labelOf(watched));
    } else skipped.push({ pool: watched, why: 'the width record holds no window for it yet' });
  }

  // The others: measured now, with the width record's own patience.
  for (const c of CANDIDATES) {
    if (c.pool === watched) continue;
    let plan = null;
    try { plan = await measure(c.pool, POSITION_USD); }
    catch (e) {
      if (!CHAIN_REFUSED.test(String(e.message))) { skipped.push({ pool: c.pool, why: String(e.message).slice(0, 120) }); continue; }
      await sleep(15000);
      try { plan = await measure(c.pool, POSITION_USD); }
      catch (e2) { skipped.push({ pool: c.pool, why: String(e2.message).slice(0, 120) }); continue; }
    }
    const r = appendPoolWindow(log, c.pool, windowFromPlan(plan, POSITION_USD));
    log = r.log; if (r.added) added.push(c.label);
    await sleep(3000);
  }

  // Every run leaves a note, added or not: a pool missing from an hour
  // is a gap the reader should be able to explain (2026-09-08 07:30 the
  // BOB/BNB window was missing and the record could not say why).
  log.last_run = { at: new Date().toISOString(), added, skipped };
  await env.AGENT.put(KV_KEY, JSON.stringify(log));
  return { ok: true, added, skipped, pools: Object.keys(log.pools).length };
}

export async function noteLpPoolsError(env, e) {
  const prev = (await readLpPools(env)) || { usd: POSITION_USD, since: new Date().toISOString(), pools: {} };
  prev.last_error = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 200) };
  await env.AGENT.put(KV_KEY, JSON.stringify(prev));
}
