// RUG WATCH — a webhook for a token an agent holds (2026-10-09).
//
// WHAT IT IS. An agent registers a BSC token and its own https callback. Every
// fifteen minutes (the cron this worker already runs) the token is read again
// with our own preflight (brainonbnb.com/api/preflight, the same answer
// bsc_token_preflight gives) and compared with the read before. When something
// dangerous changed — the sell stopped going through, the liquidity left, the
// tax went up, the owner or the proxy implementation changed — the callback is
// POSTed, signed with the watch's own secret. Delivery is the webhook only: no
// Telegram, no browser, no mail. The preflight is a measurement, not a promise,
// and so is every event here: it says what changed between two reads.
//
// WHO GETS HOW MANY (the operator's decisions, 2026-10-09). One active watch
// free per caller. A wallet holding 1,000,000 $BOBAI or more gets up to 25 —
// "unlimited" in the pitch, 25 in the terms, because a cap that is written down
// is one nobody can be surprised by. The holder proves the wallet by signing a
// short message (EIP-191 personal_sign, no transaction); the balance is read on
// registration and once a day after. 200 active watches in all, 50 of them
// free: every watch is one preflight per tick, and a preflight is a few dozen
// reads of public nodes on the site's side.
//
// WHAT IS WRITTEN WHEN. A check that finds nothing new writes nothing: the
// reference snapshot is rewritten only when something moved by a margin that
// matters (the same margins the events use, so a slow creep is still measured
// against the last reference and fires once it adds up), a failed read is
// counted, and a watch is written at least every six hours so its status does
// not look dead. 200 watches cost at most ~800 writes a day when nothing moves.
//
// HOW TOKENS ARE RUGGED TODAY (2026-10-09, the operator, a memecoin builder):
// "rugs today are not done by pulling liquidity any more — market makers pump
// with fake wallets and fake volume and then dump, or slow-rug." A diff of two
// reads 15 minutes apart sees none of that: each step is small. So a watch now
// keeps a short history of its own reads (`series`, one compact point per read
// kept: the price at the fixed test size, the pool's hard side, buys / sells /
// swaps / wallets / volume of the last hour, what insiders sold) and trendEvents
// reads it for fake volume, a pump, the dump after a pump, a slow rug, liquidity
// draining and insiders selling. A point is STORED at most once an hour (and at
// every alert, so the read that fired is kept): the current read is always
// compared with the stored ones, but the reads in between are not kept. That
// costs one write per watch and hour — 200 watches, at most ~4,800 writes a day
// when nothing moves (was ~800) — and keeps the whole series under ~5 KB.
//
// Pure where it can be (snapshotOf, diffSnap, stepWatch, trendEvents, tierCheck,
// callbackProblem, verifyHolderProof, signBody, publicView) so that
// scripts/rug-watch-regressions.mjs pins each rule offline.
import { recoverMessageAddress } from 'viem';

export const RUG_WATCH = {
  days: 30,
  freePerCaller: 1,
  freeCap: 50,
  holderCap: 25,
  totalCap: 200,
  bobai: '0x245c386dcfed896f5c346107596141e5edcbffff',
  holderLine: 1000000n * 10n ** 18n,
  holderLineText: '1,000,000 $BOBAI',
  proofWindowMs: 10 * 60 * 1000,
  proofFutureMs: 2 * 60 * 1000, // a clock a little ahead is a clock, not a forgery
  dedupMs: 6 * 3600 * 1000,
  failsBeforeAlarm: 4,
  holderRecheckMs: 24 * 3600 * 1000,
  heartbeatMs: 6 * 3600 * 1000,
  concurrency: 6,
  preflightTimeoutMs: 25000,
  callbackTimeoutMs: 5000,
  usd: 250,
  keptEvents: 20,
};
export const RUG_PREFIX = 'rugwatch:';
const ORIGIN = 'https://agent.brainonbnb.com';
export const RUG_DOCS = `${ORIGIN}/rug-watch`;
const PREFLIGHT_URL = 'https://brainonbnb.com/api/preflight';

const iso = (ms) => new Date(ms).toISOString();
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const usdText = (v) => (v == null ? '?' : '$' + Math.round(v).toLocaleString('en-US'));
const pctText = (v) => (v == null ? '?' : `${Math.round(v * 100) / 100}%`);
const EPS = 1e-9;

// ---------------------------------------------------------------- the snapshot

// The few fields of a preflight answer the events are about, and nothing else:
// a snapshot is stored with every watch, and 200 of them are read every tick.
export function snapshotOf(pf) {
  const codes = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => x && x.code).filter(Boolean))].sort();
  const d = pf?.depth || {};
  const sides = [num(d.one_percent_buy_usd), num(d.one_percent_sell_usd)].filter((v) => v != null);
  const ctl = pf?.control && pf.control.read ? pf.control : null;
  return {
    gate: pf?.gate ?? null,
    kind: pf?.kind ?? null,
    stop: codes(pf?.stop),
    caution: codes(pf?.caution),
    buy_tax: num(pf?.tax?.buy_pct),
    sell_tax: num(pf?.tax?.sell_pct),
    depth_usd: sides.length ? Math.min(...sides) : null,
    pool_hard_usd: num(d.pool_hard_side_usd),
    lp_burned_pct: num(pf?.lp_burned_pct),
    control_read: !!ctl,
    owner: ctl && ctl.owner && ctl.owner.address ? { address: String(ctl.owner.address).toLowerCase(), kind: ctl.owner.kind ?? null } : null,
    implementation: ctl && ctl.proxy && ctl.proxy.implementation ? String(ctl.proxy.implementation).toLowerCase() : null,
    mint: ctl ? !!ctl.mint_selector : null,
    // The trend fields (2026-10-09): the price at the test size, the last hour of
    // swaps, and what insiders sold in it — see trendEvents.
    price: priceOf(pf),
    act: actOf(pf?.activity),
    insider: insiderOf(pf?.flow),
    block: pf?.block ?? null,
    at: pf?.measured_at ?? null,
  };
}

// THE PRICE (2026-10-09): what one token costs at the preflight's own fixed size
// (size_usd / entry.receive_tokens, $250 here), so it carries the pool fee, the
// buy tax and the slippage of that size. That is not "the" price and no figure
// here says it is: only RELATIVE changes between the watch's own reads are used,
// and those are read at the same size every time. A tax that moves shifts it a
// little (the tax has its own event); a pool that loses half its depth makes the
// same $250 dearer (liquidity_pulled says that one). null without a route quote.
export function priceOf(pf) {
  const got = num(pf?.entry?.receive_tokens), size = num(pf?.size_usd);
  return got > 0 && size > 0 ? Number((size / got).toPrecision(6)) : null;
}
// The preflight's `activity` (the pool's swaps over the window read, ~60 min).
function actOf(a) {
  if (!a) return null;
  return { minutes: num(a.window_minutes), swaps: num(a.swaps), buys: num(a.buys), sells: num(a.sells), unique: num(a.unique_traders), vol: num(a.volume_usd), big_sell: num(a.largest_sell_usd) };
}
// The preflight's `flow`: the deployer's sells (wallets it funded included — the
// scan counts them under the deployer, scanner-chain.js viaWalletsItFunded),
// net of liquidity it put back, plus top holders' sells. sold_usd is null when
// neither could be read.
function insiderOf(f) {
  if (!f) return null;
  const d = f.deployer;
  const dep = d ? num(d.net_sold_usd ?? d.sold_usd) : null;
  const top = num(f.top_holders_sold_usd);
  return { sold_usd: dep == null && top == null ? null : Math.round((dep || 0) + (top || 0)), dev_sells: d ? num(d.sells) : null, dev_holds_pct: d ? num(d.holds_pct) : null,
    top_selling: num(f.top_holders_selling), sellers: num(f.sellers) };
}

// The pool is gone (the preflight answers 422 no_pool for a token that had
// one): a determinate read, not a failed one — the worst one there is.
export function goneSnapshot(at) {
  return { gate: 'stop', kind: 'no_pool', stop: ['no_pool'], caution: [], buy_tax: null, sell_tax: null, depth_usd: 0, pool_hard_usd: 0,
    lp_burned_pct: null, control_read: false, owner: null, implementation: null, mint: null, price: null, act: null, insider: null, block: null, at };
}

// ---------------------------------------------------------------- the events

const STOP_EVENT = { not_sellable: 'sell_blocked', not_buyable: 'buy_blocked', round_trip: 'round_trip_loss', no_pool: 'liquidity_pulled' };
const STOP_WHAT = {
  not_sellable: 'A test sell from a fresh address no longer goes through (stop code not_sellable); at the previous check it did. The token may have turned into a honeypot.',
  not_buyable: 'A test buy no longer goes through (stop code not_buyable); at the previous check it did.',
  not_quotable: 'No pool quotes this token any more (stop code not_quotable); at the previous check one did.',
  sell_not_quotable: 'The sell side no longer quotes at any size (stop code sell_not_quotable); at the previous check it did.',
  round_trip: 'An immediate buy and sell now loses half the money or more (stop code round_trip); at the previous check it did not.',
  no_pool: 'No pool for this token can be found any more; at the previous check the preflight still read one.',
};
const isRenounced = (o) => !!o && (o.kind === 'renounced' || /^0x0{40}$/.test(o.address || '') || /^0x0{36}dead$/i.test(o.address || ''));

// diffSnap(baseline, previous, current) -> events. `previous` is the reference
// the last check left (the snapshot at registration on the first check);
// `baseline` is that registration snapshot, named in the sentence where it
// helps. Each event: {code, level, what, before, after}. Critical first; one
// event per code.
export function diffSnap(baseline, prev, cur) {
  if (!prev || !cur) return [];
  const ev = [];
  const push = (e) => { if (!ev.some((x) => x.code === e.code)) ev.push(e); };
  const had = (list, code) => (prev[list] || []).includes(code);
  const has = (list, code) => (cur[list] || []).includes(code);

  // The pool's hard side: a fall of half or more is the liquidity pulled.
  const a = prev.pool_hard_usd, b = cur.pool_hard_usd;
  if (a > 0 && b != null) {
    const drop = (a - b) / a;
    const at0 = baseline && baseline.pool_hard_usd != null && baseline.at !== prev.at ? `; at registration it held ${usdText(baseline.pool_hard_usd)}` : '';
    if (cur.kind === 'no_pool') push({ code: 'liquidity_pulled', level: 'critical', what: `No pool for this token can be found any more; at the previous check its pool held ${usdText(a)} on the hard side${at0}.`, before: a, after: 0 });
    else if (drop >= 0.5 - EPS) push({ code: 'liquidity_pulled', level: 'critical', what: `The pool's hard side fell from ${usdText(a)} to ${usdText(b)} (-${Math.round(drop * 100)}%) since the previous check${at0}.`, before: a, after: b });
    else if (drop >= 0.25 - EPS) push({ code: 'liquidity_falling', level: 'warning', what: `The pool's hard side fell from ${usdText(a)} to ${usdText(b)} (-${Math.round(drop * 100)}%) since the previous check${at0}.`, before: a, after: b });
  }

  // A stop the previous read did not have.
  for (const code of cur.stop || []) {
    if (had('stop', code)) continue;
    const name = STOP_EVENT[code] || code;
    push({ code: name, level: 'critical', what: STOP_WHAT[code] || `The preflight now stops on ${code}; at the previous check it did not.`, before: null, after: code });
  }

  // LP: the burned share fell, or the preflight now reports LP withdrawn.
  const la = prev.lp_burned_pct, lb = cur.lp_burned_pct;
  if (la != null && lb != null && la - lb >= 5 - EPS) push({ code: 'lp_withdrawn', level: 'critical', what: `The burned share of the LP fell from ${pctText(la)} to ${pctText(lb)} since the previous check: LP that could not move did.`, before: la, after: lb });
  else if (has('caution', 'lp_withdrawn') && !had('caution', 'lp_withdrawn')) push({ code: 'lp_withdrawn', level: 'critical', what: 'The preflight now reports LP withdrawn from this pair (caution lp_withdrawn); at the previous check it did not.', before: null, after: 'lp_withdrawn' });

  // The owner: any change, and renounced -> an owner again is the worst case.
  const oa = prev.owner, ob = cur.owner;
  if (oa && ob && oa.address && ob.address && oa.address !== ob.address) {
    const worst = isRenounced(oa) && !isRenounced(ob);
    push({ code: 'owner_changed', level: 'critical',
      what: worst
        ? `Ownership was renounced and the contract has an owner again: ${ob.address} (${ob.kind || 'unknown kind'}). This is the worst case — whatever the contract lets an owner do, that address can do now.`
        : `The owner changed from ${oa.address} (${oa.kind || '?'}) to ${ob.address} (${ob.kind || '?'}).`,
      before: oa.address, after: ob.address });
  }

  // The proxy points at new code.
  if (prev.control_read && cur.control_read && prev.implementation && cur.implementation && prev.implementation !== cur.implementation)
    push({ code: 'proxy_upgraded', level: 'critical', what: `The proxy was upgraded: its implementation moved from ${prev.implementation} to ${cur.implementation}. The token now runs code that was not there at the previous check.`, before: prev.implementation, after: cur.implementation });

  // The tax, either side, against the previous read.
  for (const side of ['buy', 'sell']) {
    const ta = prev[`${side}_tax`], tb = cur[`${side}_tax`];
    if (ta == null || tb == null || tb - ta < 2 - EPS) continue;
    const crit = tb >= 10 - EPS;
    push({ code: `${side}_tax_up`, level: crit ? 'critical' : 'warning', what: `The ${side} tax rose from ${pctText(ta)} to ${pctText(tb)} since the previous check${crit ? ' — 10% or more now' : ''}.`, before: ta, after: tb });
  }

  // Warnings: selling by the deployer or a top holder, a tax the owner can change.
  const WARN = {
    dev_selling: 'The deployer, or a wallet it funded, is now selling into the pool (caution dev_selling); at the previous check it was not.',
    top_holder_selling: 'A top holder is now selling a quarter or more of its balance into the pool (caution top_holder_selling); at the previous check none was.',
    tax_can_change: 'The preflight now reads that the owner can change the transfer tax (caution tax_can_change); at the previous check it did not.',
  };
  for (const [code, what] of Object.entries(WARN)) if (has('caution', code) && !had('caution', code)) push({ code, level: 'warning', what, before: null, after: code });

  return ev.sort((x, y) => (x.level === y.level ? 0 : x.level === 'critical' ? -1 : 1));
}

// Whether a new read moved far enough from the reference to become it. The
// margins are the events' own: smaller moves are not written, and a creep is
// measured against the last reference until it adds up to an event.
export function movedEnough(prev, cur) {
  if (!prev) return true;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (prev.gate !== cur.gate || prev.kind !== cur.kind || !same(prev.stop, cur.stop) || !same(prev.caution, cur.caution)) return true;
  if ((prev.owner?.address || null) !== (cur.owner?.address || null) || prev.implementation !== cur.implementation || prev.mint !== cur.mint) return true;
  for (const k of ['buy_tax', 'sell_tax']) if ((prev[k] == null) !== (cur[k] == null) || (prev[k] != null && Math.abs(cur[k] - prev[k]) >= 2 - EPS)) return true;
  if ((prev.lp_burned_pct == null) !== (cur.lp_burned_pct == null) || (prev.lp_burned_pct != null && Math.abs(cur.lp_burned_pct - prev.lp_burned_pct) >= 5 - EPS)) return true;
  const a = prev.pool_hard_usd, b = cur.pool_hard_usd;
  if ((a == null) !== (b == null)) return true;
  if (a > 0 && b != null && Math.abs(b - a) / a >= 0.25 - EPS) return true;
  return false;
}

// The same code fires at most once per six hours per watch.
export function dueEvents(events, fired = {}, now) {
  const next = { ...fired };
  const send = [];
  for (const e of events) {
    if (next[e.code] && now - next[e.code] < RUG_WATCH.dedupMs) continue;
    next[e.code] = now;
    send.push(e);
  }
  return { send, fired: next };
}

// ---------------------------------------------------------------- the trend (2026-10-09)

// Every line of the trend detectors, named (see "HOW TOKENS ARE RUGGED TODAY" above).
export const TREND = {
  pointMs: 3600e3,          // one stored point per hour (and one at every alert)
  pointSlackMs: 5 * 60e3,   // cron ticks drift by seconds: 55+ minutes counts as the hour
  pointMinGapMs: 10 * 60e3, // a write that happens anyway takes a point along, never two per tick
  keepMs: 25 * 3600e3,      // the series keeps a day and the hour before it
  dayMs: 24 * 3600e3,
  maxPoints: 96,
  // fake volume, from one read's last hour (the same rule as the preflight's caution volume_from_few_wallets)
  washMinSwaps: 20,         // fewer swaps than this say nothing either way
  washSwapsPerWallet: 10,   // wallets <= max(3, swaps / 10): ten swaps or more per wallet
  washMinWallets: 3,
  washVolX: 2,              // or the hour's volume >= 2x the pool's hard side …
  washFewWallets: 10,       // … made by 10 wallets or fewer
  // pump and dump, against the watch's own prices
  pumpPct: 40, pumpWindowMs: 6 * 3600e3,   // up 40% or more on the lowest price of the last 6 h
  dumpPct: 30,                             // down 30% or more from the 24 h high, when that high came from a pump
  // slow rug and slow drain, over the last 24 h of points
  slowPct: 25,              // the price down 25% or more on the oldest point of the day …
  slowMaxStepPct: 25,       // … with no single step between two points of 25% or more (a step that big is an event of its own)
  slowMinSpanMs: 6 * 3600e3, slowMinPoints: 4,
  slowSellShare: 0.6,       // sells outnumbered buys in 60% or more of the reads with swaps (at least 3 of them)
  drainPct: 30, drainMaxStepPct: 25,       // the hard side down 30% or more over the day, no single 25% step
  // insiders: the deployer, wallets it funded, top holders
  insiderUsd: 1000, insiderPoolPct: 5,     // sold in all >= $1,000 or 5% of the hard side, whichever is lower
  insiderGapMs: 55 * 60e3,  // two reads closer than this share most of their window: the larger counts, once
};

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
// One point of the series, from a snapshot: {t, p price, h hard side, b buys,
// s sells, n swaps, u wallets, v volume, m window minutes, i insider usd, ts top
// holders selling}. Nulls are left out (a read without a route has no p).
export function pointOf(snap, t) {
  if (!snap) return null;
  const a = snap.act || {}, ins = snap.insider || {};
  return compact({ t, p: snap.price, h: snap.pool_hard_usd == null ? null : Math.round(snap.pool_hard_usd), b: a.buys, s: a.sells, n: a.swaps, u: a.unique,
    v: a.vol == null ? null : Math.round(a.vol), m: a.minutes, i: ins.sold_usd, ts: ins.top_selling });
}
export const seriesIn = (series, now) => (Array.isArray(series) ? series.filter((p) => p && p.t <= now && now - p.t <= TREND.keepMs).sort((x, y) => x.t - y.t) : []);

// Fake volume in one read's hour: {swaps, wallets, minutes, vol, hard, rule, line} or null.
export function washOf(swaps, wallets, vol, hard, minutes = null) {
  const n = num(swaps), u = num(wallets), v = num(vol), h = num(hard);
  if (n == null || u == null || u < 1 || n < TREND.washMinSwaps) return null;
  const line = Math.max(TREND.washMinWallets, Math.floor(n / TREND.washSwapsPerWallet));
  if (u <= line) return { swaps: n, wallets: u, minutes, vol: v, hard: h, rule: 'few_wallets', line };
  if (v != null && h > 0 && v >= TREND.washVolX * h && u <= TREND.washFewWallets) return { swaps: n, wallets: u, minutes, vol: v, hard: h, rule: 'volume_over_pool', line: TREND.washFewWallets };
  return null;
}

const pxText = (p) => (p == null ? '?' : '$' + (p >= 1 ? p.toFixed(4) : p.toFixed(Math.min(20, 3 - Math.floor(Math.log10(p))))));
const hoursText = (ms) => `${Math.round(ms / 360e3) / 10} h`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// The largest fall between two neighbouring points, as a fraction.
function maxStepDrop(pts, k) {
  let worst = 0;
  for (let j = 1; j < pts.length; j++) if (pts[j - 1][k] > 0 && pts[j][k] != null) worst = Math.max(worst, (pts[j - 1][k] - pts[j][k]) / pts[j - 1][k]);
  return worst;
}
// What insiders sold across reads. Each read covers about the hour before it;
// two reads closer than insiderGapMs share most of that hour, so only the
// larger of the two counts (never the sum of the same sells twice).
export function insiderTotal(pts) {
  let total = 0, last = null;
  for (const p of pts) {
    if (!(p.i > 0)) continue;
    if (last && p.t - last.t < TREND.insiderGapMs) { if (p.i > last.i) { total += p.i - last.i; last = { t: last.t, i: p.i }; } continue; }
    total += p.i; last = { t: p.t, i: p.i };
  }
  return total;
}
// Whether a point's price came out of a pump: some point up to 6 h before it was
// 40% or more lower. Returns that low point, or null.
function pumpedFrom(pts, peak) {
  let low = null;
  for (const q of pts) if (q.p > 0 && q.t < peak.t && peak.t - q.t <= TREND.pumpWindowMs && (!low || q.p < low.p)) low = q;
  return low && peak.p >= low.p * (1 + TREND.pumpPct / 100 - EPS) ? low : null;
}

// trendEvents(series, cur, sameTick) -> events from the watch's own history.
// `series` is the stored points (oldest first), `cur` the point of this read
// (not yet stored), `sameTick` the codes diffSnap found in this read. Never a
// certainty: each sentence says what the figures look like and gives them.
export function trendEvents(series, cur, sameTick = []) {
  if (!cur) return [];
  const T = TREND, ev = [];
  const pts = [...(series || []).filter((p) => p && p.t < cur.t && cur.t - p.t <= T.dayMs), cur];
  const actLine = cur.n != null ? ` In the hour read (${cur.m ?? '?'} min): ${plural(cur.b ?? 0, 'buy')} and ${plural(cur.s ?? 0, 'sell')}${cur.u != null ? ` by ${plural(cur.u, 'wallet')}` : ' (wallets not read)'}${cur.v != null ? `, ${usdText(cur.v)} volume` : ''}.` : '';

  // 1. Fake volume: many swaps from a handful of wallets, or a volume far over the pool from few of them.
  const wash = washOf(cur.n, cur.u, cur.v, cur.h, cur.m);
  if (wash) ev.push({ code: 'fake_volume', level: 'warning',
    what: `${wash.swaps} swaps by ${plural(wash.wallets, 'wallet')} in ${wash.minutes ?? '?'} min${wash.vol != null ? `, ${usdText(wash.vol)} volume` : ''}${wash.hard != null ? ` on a ${usdText(wash.hard)} pool (hard side)` : ''}. This looks like wash trading: a handful of wallets made most of the volume, so the volume says little about real demand (line: ${wash.rule === 'few_wallets' ? `${wash.line} wallets or fewer for ${wash.swaps} swaps — ten swaps or more per wallet` : `the hour's volume ${T.washVolX}x the pool or more, from ${wash.line} wallets or fewer`}; a router or aggregator trading for many wallets counts as one address).`,
    before: null, after: { swaps: wash.swaps, wallets: wash.wallets, volume_usd: wash.vol, pool_hard_usd: wash.hard } });

  // 2. Pump: up 40% or more on the lowest price of the last 6 h.
  const priced = pts.filter((p) => p.p > 0);
  const lowP = pumpedFrom(priced, cur);
  if (cur.p > 0 && lowP) {
    const up = Math.round((cur.p / lowP.p - 1) * 100);
    ev.push({ code: 'pump', level: 'warning',
      what: `The price at the $${RUG_WATCH.usd} test size rose +${up}% within ${hoursText(cur.t - lowP.t)} (from ${pxText(lowP.p)} to ${pxText(cur.p)} per token).${actLine} You are holding into a pump; in today's rugs the wallets that pumped a token often sell into the buyers it draws.`,
      before: lowP.p, after: cur.p });
  }

  // 3. The dump after a pump: down 30% or more from the 24 h high, when that high came out of a pump.
  const before = priced.filter((p) => p !== cur);
  const peak = before.reduce((a, p) => (!a || p.p > a.p ? p : a), null);
  const peakFrom = peak ? pumpedFrom(before, peak) : null;
  if (cur.p > 0 && peak && peakFrom && cur.p <= peak.p * (1 - T.dumpPct / 100 + EPS)) {
    const down = Math.round((1 - cur.p / peak.p) * 100), rise = Math.round((peak.p / peakFrom.p - 1) * 100);
    ev.push({ code: 'dump', level: 'critical',
      what: `The price at the $${RUG_WATCH.usd} test size fell ${down}% from its high of the last 24 h (${pxText(peak.p)}, ${iso(peak.t)}) to ${pxText(cur.p)}; that high came after a rise of +${rise}% within ${hoursText(peak.t - peakFrom.t)}. This looks like the dump after a pump.${actLine}`,
      before: peak.p, after: cur.p });
  }

  // 4. Slow rug: the price bled 25% or more over the day without one big step, sells
  // dominated, and insiders sold. And the same for the pool: liquidity draining.
  const first = pts[0];
  const ins = insiderTotal(pts);
  const topChecks = pts.filter((p) => p.ts > 0).length;
  if (first !== cur && cur.t - first.t >= T.slowMinSpanMs && pts.length >= T.slowMinPoints) {
    const pp = priced;
    if (cur.p > 0 && pp.length >= T.slowMinPoints && pp[0] !== cur && cur.t - pp[0].t >= T.slowMinSpanMs && !ev.some((e) => e.code === 'dump')) {
      const fall = 1 - cur.p / pp[0].p, step = maxStepDrop(pp, 'p');
      const flows = pts.filter((p) => p.b != null && p.s != null && p.b + p.s > 0);
      const heavy = flows.filter((p) => p.s > p.b).length;
      if (fall >= T.slowPct / 100 - EPS && step < T.slowMaxStepPct / 100 - EPS && flows.length >= 3 && heavy / flows.length >= T.slowSellShare - EPS && (ins >= 1 || topChecks > 0))
        ev.push({ code: 'slow_rug', level: 'critical',
          what: `Over the last ${hoursText(cur.t - pp[0].t)} the price at the $${RUG_WATCH.usd} test size fell ${Math.round(fall * 100)}% (from ${pxText(pp[0].p)} to ${pxText(cur.p)}) with no single step of ${T.slowMaxStepPct}% or more, sells outnumbered buys in ${heavy} of ${flows.length} reads, and insiders sold${ins >= 1 ? ` — the deployer, wallets it funded and top holders about ${usdText(ins)} in all` : ''}${topChecks ? ` (a top holder selling in ${plural(topChecks, 'read')})` : ''}. This looks like a slow rug: no one event, the price bled while insiders left.`,
          before: pp[0].p, after: cur.p });
    }
    const hh = pts.filter((p) => p.h != null);
    if (cur.h != null && hh.length >= 2 && hh[0] !== cur && hh[0].h > 0 && cur.t - hh[0].t >= T.slowMinSpanMs && !sameTick.some((c) => c === 'liquidity_falling' || c === 'liquidity_pulled')) {
      const fall = 1 - cur.h / hh[0].h;
      if (fall >= T.drainPct / 100 - EPS && maxStepDrop(hh, 'h') < T.drainMaxStepPct / 100 - EPS)
        ev.push({ code: 'liquidity_draining', level: 'warning',
          what: `The pool's hard side fell ${Math.round(fall * 100)}% over the last ${hoursText(cur.t - hh[0].t)} (from ${usdText(hh[0].h)} to ${usdText(cur.h)}) with no single step of ${T.drainMaxStepPct}% or more: drained slowly rather than pulled at once.`,
          before: hh[0].h, after: cur.h });
    }
  }

  // 5. Insiders selling, added up across the day's reads.
  const line = Math.min(T.insiderUsd, cur.h > 0 ? (cur.h * T.insiderPoolPct) / 100 : Infinity);
  if (ins >= 1 && ins >= line - EPS)
    ev.push({ code: 'insider_selling', level: 'warning',
      what: `The deployer, wallets it funded and top holders sold about ${usdText(ins)} into the pool ${first === cur ? 'in the hour this read covers' : `across the reads of the last ${hoursText(cur.t - first.t)}`} (line drawn at ${usdText(line)}: $${T.insiderUsd.toLocaleString('en-US')} or ${T.insiderPoolPct}% of the pool's hard side, whichever is lower; reads that share their hour counted once).`,
      before: null, after: ins });

  return ev;
}

// One check of one watch. `read` is {ok: true, snap} or {ok: false, why}.
// A failed read is never an event by itself: it is counted, and only the
// fourth in a row says so ("unreadable", a warning).
export function stepWatch(w, read, now) {
  const out = { ...w, checks: (w.checks || 0) + 1, last_checked_at: now };
  let events = [];
  let dirty = false;
  let point = null, hist = [];
  if (!read || !read.ok) {
    out.fails = (w.fails || 0) + 1;
    out.last_error = String(read?.why || 'no answer').slice(0, 160);
    dirty = true;
    if (out.fails >= RUG_WATCH.failsBeforeAlarm)
      events.push({ code: 'unreadable', level: 'warning', what: `The token could not be read ${out.fails} checks in a row (last: ${out.last_error}). Nothing is known about it since ${w.snapshot?.at || 'the last good read'}.`, before: w.snapshot?.at ?? null, after: null });
  } else {
    if (w.fails) { out.fails = 0; out.last_error = null; dirty = true; }
    const diffs = diffSnap(w.baseline, w.snapshot, read.snap);
    // The trend (2026-10-09): this read against the watch's own stored points.
    point = pointOf(read.snap, now);
    hist = seriesIn(w.series, now);
    const trend = trendEvents(hist, point, diffs.map((e) => e.code)).filter((e) => !diffs.some((d) => d.code === e.code));
    events = [...diffs, ...trend].sort((x, y) => (x.level === y.level ? 0 : x.level === 'critical' ? -1 : 1));
    if (diffs.length || movedEnough(w.snapshot, read.snap)) { out.snapshot = read.snap; dirty = true; }
  }
  const { send, fired } = dueEvents(events, w.fired || {}, now);
  if (send.length) {
    out.fired = fired;
    out.events = [...(w.events || []), ...send.map((e) => ({ ...e, at: iso(now) }))].slice(-RUG_WATCH.keptEvents);
    dirty = true;
  }
  // The series: a point is stored once an hour (that alone is a write), and
  // taken along when the watch is written anyway — an alert, a moved reference.
  // A watch from before the series starts it an hour after its last write.
  if (point) {
    const lastT = hist.length ? hist[hist.length - 1].t : (w.saved_at || w.created_at || 0);
    if (now - lastT >= TREND.pointMs - TREND.pointSlackMs || (dirty && now - lastT >= TREND.pointMinGapMs)) {
      out.series = [...hist, point].slice(-TREND.maxPoints);
      dirty = true;
    }
  }
  if (!dirty && now - (w.saved_at || 0) >= RUG_WATCH.heartbeatMs) dirty = true;
  return { watch: out, send, dirty };
}

// ---------------------------------------------------------------- reading a token

// One preflight over the site's REST route (another hostname, so no loopback).
// No user-agent of our own: the site recognises this worker's requests by
// their address and keeps them out of its public counts (dashboard/_worker.js, isOwn).
export async function readToken(token, fetchFn = globalThis.fetch, now = Date.now()) {
  let r;
  try {
    r = await fetchFn(`${PREFLIGHT_URL}?address=${token}&usd=${RUG_WATCH.usd}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(RUG_WATCH.preflightTimeoutMs) });
  } catch (e) {
    return { ok: false, why: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `no answer within ${RUG_WATCH.preflightTimeoutMs / 1000} s` : 'the preflight could not be reached' };
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (r.status === 200 && j && !j.error && j.kind) return { ok: true, pf: j, snap: snapshotOf(j) };
  if (r.status === 422 && j?.code === 'no_pool') return { ok: true, gone: true, pf: j, snap: goneSnapshot(iso(now)) };
  return { ok: false, status: r.status, code: j?.code || null, error: j?.error || null, why: `http ${r.status}${j?.code ? ` (${j.code})` : ''}` };
}

// $BOBAI balance of a wallet, one eth_call over the worker's own rpc helper.
export async function holderBalance(rpcFn, wallet) {
  const data = '0x70a08231' + String(wallet).toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const hex = await rpcFn('eth_call', [{ to: RUG_WATCH.bobai, data }, 'latest']);
  if (typeof hex !== 'string' || !/^0x[0-9a-f]*$/i.test(hex)) throw new Error('balanceOf did not answer');
  return hex === '0x' ? 0n : BigInt(hex);
}
const bobaiText = (wei) => (Number(wei / 10n ** 15n) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });

// ---------------------------------------------------------------- the holder proof

export const proofMessage = (wallet, issued) => `BOBAI rug watch\nwallet: ${String(wallet).toLowerCase()}\nissued: ${issued}`;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export async function verifyHolderProof(body, now = Date.now()) {
  const no = (status, code, error) => ({ ok: false, status, code, error });
  const wallet = String(body?.wallet || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return no(400, 'bad_wallet', 'wallet must be a BSC address (0x followed by 40 hex characters).');
  const issued = String(body?.issued || '').trim();
  if (!ISO_RE.test(issued)) return no(400, 'bad_issued', 'issued must be the ISO 8601 UTC time you signed, as in 2026-10-09T12:00:00.000Z (new Date().toISOString()).');
  const t = Date.parse(issued);
  if (!(now - t <= RUG_WATCH.proofWindowMs) || t - now > RUG_WATCH.proofFutureMs) return no(403, 'stale_proof', 'issued must lie within the last 10 minutes: sign a fresh message and send it at once.');
  const signature = String(body?.signature || '').trim();
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return no(400, 'bad_signature', 'signature must be the 65-byte personal_sign signature (0x followed by 130 hex characters).');
  let signer;
  try { signer = (await recoverMessageAddress({ message: proofMessage(wallet, issued), signature })).toLowerCase(); }
  catch { return no(403, 'bad_signature', 'the signature does not recover to any address over the message.'); }
  if (signer !== wallet) return no(403, 'wrong_signer', `the signature over the message does not come from ${wallet}. Sign exactly: "${proofMessage(wallet, issued).replace(/\n/g, '\\n')}" with that wallet.`);
  return { ok: true, wallet };
}

// ---------------------------------------------------------------- the callback

// https only, no credentials in the URL, never our own hosts, never a private,
// loopback, link-local or shared address. The URL parser normalises the odd
// spellings (2130706433, 0x7f.1) to dotted quads before this looks.
export function callbackProblem(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'callback is required: the https URL the alert is POSTed to.';
  if (s.length > 400) return 'callback must be at most 400 characters.';
  let u;
  try { u = new URL(s); } catch { return 'callback must be a URL.'; }
  if (u.protocol !== 'https:') return 'callback must be an https:// URL.';
  if (u.username || u.password) return 'callback must not carry a user name or password; put a token in the path or check the signature header instead.';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'callback must be a public host, not localhost or a local name.';
  if (host === 'brainonbnb.com' || host.endsWith('.brainonbnb.com')) return 'callback must be your own endpoint, not one of ours.';
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224)
      return 'callback must be a public address, not a private, loopback or link-local one.';
  }
  if (host.startsWith('[')) {
    const h = host.slice(1, -1);
    if (h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:')) return 'callback must be a public address, not a private, loopback or link-local one.';
  }
  if (!host.includes('.') && !host.startsWith('[')) return 'callback must be a public host name.';
  return null;
}

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
// x-bobai-signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the watch's secret>
export async function signBody(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const newSecret = () => 'rws_' + hex(crypto.getRandomValues(new Uint8Array(24)));
function sameString(a, b) {
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// One POST, five seconds, no redirect followed (a redirect to somewhere
// internal is the one way round the host check). A callback that fails is
// recorded and never stalls the watches after it.
export async function deliver(w, events, snapshot, now, fetchFn = globalThis.fetch) {
  const body = JSON.stringify({ watch: w.id, token: w.token, symbol: w.symbol ?? null, events, snapshot, baseline_at: w.baseline?.at ?? null, at: iso(now), docs: RUG_DOCS });
  try {
    const r = await fetchFn(w.callback, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'bobai-rug-watch/1', 'x-bobai-signature': await signBody(w.secret, body), 'x-bobai-watch': w.id },
      body, redirect: 'manual', signal: AbortSignal.timeout(RUG_WATCH.callbackTimeoutMs),
    });
    return { at: iso(now), status: r.status, ok: r.status >= 200 && r.status < 300, events: events.map((e) => e.code) };
  } catch (e) {
    return { at: iso(now), status: 0, ok: false, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'no answer within 5 s' : 'unreachable', events: events.map((e) => e.code) };
  }
}

// ---------------------------------------------------------------- tiers

// Who is asking. The site's MCP tool forwards its caller's address with the
// shared secret; a Worker from another zone is known by the zone Cloudflare
// writes into cf-worker (all Workers share one connecting address); everyone
// else by the connecting address, IPv6 by its /64.
export function callerOf(request, env) {
  const h = (k) => request.headers.get(k);
  const fwd = h('x-rug-watch-for');
  const ip = fwd && env?.HIT_SECRET && h('x-hit-secret') === env.HIT_SECRET ? fwd : h('cf-worker') ? null : h('cf-connecting-ip');
  if (!ip && h('cf-worker')) return 'worker:' + String(h('cf-worker')).toLowerCase().slice(0, 100);
  return 'ip:' + ipKey(ip || 'unknown');
}
function ipKey(ip) {
  ip = String(ip).trim().toLowerCase().slice(0, 64);
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
// The free key is kept hashed: a watch never stores who asked.
export async function ownerKey(caller, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(salt || 'bobai-rug-watch')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'c:' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(caller))).slice(0, 32);
}

// entries: KV keys of rugwatch:* with their metadata {t: tier, o: owner,
// e: expires ms, k: token, c: callback hash}. The same owner registering the
// same token to the same callback renews; everything else is a new watch.
export function tierCheck(entries, { tier, owner, token, cb, now }) {
  const live = entries.filter((e) => e.metadata && e.metadata.e > now);
  const mine = live.filter((e) => e.metadata.o === owner);
  const same = mine.find((e) => e.metadata.k === token && e.metadata.c === cb);
  if (same) return { ok: true, renew: same.name.slice(RUG_PREFIX.length) };
  const no = (code, error) => ({ ok: false, status: 429, code, error });
  if (live.length >= RUG_WATCH.totalCap) return no('capacity', `All ${RUG_WATCH.totalCap} watches are taken. Try again later; watches end after ${RUG_WATCH.days} days.`);
  if (tier === 'free') {
    if (mine.length >= RUG_WATCH.freePerCaller) return no('free_limit', `One active watch is free per caller and yours is running. Cancel it (DELETE /rug-watch/<id> with x-rug-watch-secret), or prove a wallet holding ${RUG_WATCH.holderLineText} for up to ${RUG_WATCH.holderCap}.`);
    if (live.filter((e) => e.metadata.t === 'free').length >= RUG_WATCH.freeCap) return no('free_capacity', `All ${RUG_WATCH.freeCap} free watches are taken. Holders of ${RUG_WATCH.holderLineText} can still register, or try again later.`);
  } else if (mine.length >= RUG_WATCH.holderCap) {
    return no('holder_limit', `This wallet has ${RUG_WATCH.holderCap} active watches, the most a holder gets. Cancel one to add another.`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- storage

const metaOf = (w) => ({ t: w.tier, o: w.owner, e: w.expires_at, k: w.token, c: w.cb, p: w.paused ? 1 : 0 });
export async function saveWatch(env, w, now) {
  await env.AGENT.put(RUG_PREFIX + w.id, JSON.stringify(w), {
    expirationTtl: Math.max(60, Math.floor((w.expires_at - now) / 1000) + 86400),
    metadata: metaOf(w),
  });
}
// THE OWNER INDEX (2026-10-09, found live): KV listings are eventually consistent, so a second free watch registered
// right after the first passed the one-per-caller check — the list did not show the first one yet. A plain key per
// owner reads back at once; the tier check reads both and counts each watch once.
export const OWNER_PREFIX = 'rugown:';
export async function readOwnerIndex(env, owner) {
  try { const v = JSON.parse((await env.AGENT.get(OWNER_PREFIX + owner)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function writeOwnerIndex(env, owner, list, now) {
  const live = list.filter((x) => x && x.e > now);
  if (!live.length) { await env.AGENT.delete(OWNER_PREFIX + owner).catch(() => {}); return; }
  const until = Math.max(...live.map((x) => x.e));
  await env.AGENT.put(OWNER_PREFIX + owner, JSON.stringify(live), { expirationTtl: Math.max(60, Math.floor((until - now) / 1000) + 86400) });
}
export function mergeEntries(listed, index, owner) {
  const seen = new Set(listed.map((e) => e.name));
  const extra = index.filter((x) => !seen.has(RUG_PREFIX + x.id)).map((x) => ({ name: RUG_PREFIX + x.id, metadata: { t: x.t, o: owner, e: x.e, k: x.k, c: x.c, p: 0 } }));
  return listed.concat(extra);
}
async function listKeys(env) {
  const keys = [];
  let cursor = null;
  do {
    const page = await env.AGENT.list({ prefix: RUG_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// What anyone holding the id may read: never the secret, never who registered.
export function publicView(w, now = Date.now()) {
  let host = null;
  try { host = new URL(w.callback).host; } catch { host = null; }
  return {
    watch: w.id, token: w.token, symbol: w.symbol ?? null, tier: w.tier,
    status: now > w.expires_at ? 'expired' : w.paused ? 'paused' : 'active',
    ...(w.paused ? { paused_why: w.paused === 'holder_line' ? `the wallet holds less than ${RUG_WATCH.holderLineText}; this watch resumes when it holds the line again (read once a day)` : String(w.paused) } : {}),
    created_at: iso(w.created_at), expires_at: iso(w.expires_at),
    callback_host: host,
    baseline: w.baseline, snapshot: w.snapshot,
    last_checked_at: w.last_checked_at ? iso(w.last_checked_at) : null,
    checks: w.checks || 0, failed_in_a_row: w.fails || 0, ...(w.last_error ? { last_error: w.last_error } : {}),
    events: w.events || [], last_delivery: w.last_delivery || null,
    history: w.series || [],
    note: 'snapshot is the reference the next check is compared with: it is rewritten when something moves by a margin that matters. When nothing changes, checks and last_checked_at are written at least every 6 hours. history is the stored series the trend alerts read (one point an hour and one at every alert, 24 h kept): t time (ms), p price per token at the $250 test size, h pool hard side (USD), b buys, s sells, n swaps, u wallets, v volume (USD) and m minutes of the hour read, i what insiders sold in it (USD), ts top holders selling.',
    renew: `POST ${RUG_DOCS} again with the same token and callback before expires_at.`,
    cancel: `DELETE ${RUG_DOCS}/${w.id} with the header x-rug-watch-secret.`,
  };
}

// ---------------------------------------------------------------- terms

export function rugWatchTerms() {
  const example = proofMessage('0x1234567890abcdef1234567890abcdef12345678', '2026-10-09T12:00:00.000Z');
  return {
    service: 'rug watch',
    what: 'Register a BSC token you hold and an https callback of your own. Every 15 minutes the token is read again with the same preflight bsc_token_preflight answers with (brainonbnb.com/api/preflight), compared with the read before and with the watch\'s own history of the last 24 h; when something dangerous changed — the classic rug (sell blocked, liquidity pulled, tax up, owner or proxy changed) or today\'s (fake volume from a handful of wallets, a pump and the dump after it, a slow rug where the price bleeds while insiders sell) — your callback is POSTed at once. Webhook only — no Telegram, no browser, no mail.',
    cadence: 'every 15 minutes, on this worker\'s cron',
    register: {
      how: `POST ${RUG_DOCS}`,
      body: { token: '0x… (the BSC token)', callback: 'https://… (your endpoint; https, public, not ours)', wallet: 'optional — holder tier', signature: 'optional — holder tier', issued: 'optional — holder tier' },
      answer: 'watch (the id), secret (shown ONCE — keep it: it signs every alert and cancels the watch), tier, expires_at, baseline (the snapshot every later read is compared with), status_url',
      refused: 'a token the preflight cannot read as a pool (still on its four.meme curve, no pool, not a token) is refused with the preflight\'s own code',
    },
    tiers: {
      free: { watches: RUG_WATCH.freePerCaller, per: 'caller (the connecting address, IPv6 by /64; over MCP the MCP caller\'s)', all_free_watches: RUG_WATCH.freeCap },
      holder: {
        line: `${RUG_WATCH.holderLineText} (token ${RUG_WATCH.bobai}, 18 decimals) in the wallet`,
        watches: RUG_WATCH.holderCap,
        honest_note: `"Unlimited" means ${RUG_WATCH.holderCap} active watches per holder wallet.`,
        proof: {
          method: 'EIP-191 personal_sign by the wallet — a signature, no transaction, nothing spent',
          message: 'BOBAI rug watch\nwallet: <lowercase address>\nissued: <ISO 8601 UTC time, e.g. new Date().toISOString()>',
          lines: ['BOBAI rug watch', 'wallet: <lowercase address>', 'issued: <ISO 8601 UTC time>'],
          joined_by: 'one line feed (LF) between lines, none at the end; the address in lower case; issued exactly as sent in the body',
          example_message: example,
          send: '{"token":"0x…","callback":"https://…","wallet":"<the address>","signature":"0x…","issued":"<the same time string>"}',
          issued_within: '10 minutes before the request',
        },
        recheck: 'the balance is read on registration and once a day after. Under the line, the wallet\'s oldest watch keeps running as its free one and the others pause (each callback gets a holder_line warning); they resume when the wallet holds the line again.',
      },
    },
    limits: { active_watches_in_all: RUG_WATCH.totalCap, days: RUG_WATCH.days, renew: 'register the same token to the same callback again (same caller, or same wallet) — the watch keeps its id and secret and runs another 30 days' },
    detects: [
      { code: 'sell_blocked', level: 'critical', when: 'the preflight newly stops on not_sellable: a test sell from a fresh address no longer goes through' },
      { code: 'buy_blocked', level: 'critical', when: 'newly not_buyable' },
      { code: 'round_trip_loss', level: 'critical', when: 'newly round_trip: an immediate buy and sell loses half or more' },
      { code: 'not_quotable / sell_not_quotable / <any new stop code>', level: 'critical', when: 'any stop code the previous read did not have' },
      { code: 'liquidity_pulled', level: 'critical', when: 'the pool\'s hard side fell 50% or more since the previous read, or the pool is gone' },
      { code: 'liquidity_falling', level: 'warning', when: 'the pool\'s hard side fell 25% or more since the previous read' },
      { code: 'lp_withdrawn', level: 'critical', when: 'the burned share of the LP fell by 5 points or more, or the preflight newly reports lp_withdrawn' },
      { code: 'buy_tax_up / sell_tax_up', level: 'critical at 10% or more, else warning', when: 'a tax rose by 2 points or more since the previous read' },
      { code: 'owner_changed', level: 'critical', when: 'owner() / getOwner() names another address — renounced to an owner again is said to be the worst case' },
      { code: 'proxy_upgraded', level: 'critical', when: 'the EIP-1967 implementation changed' },
      { code: 'dev_selling / top_holder_selling', level: 'warning', when: 'newly in the preflight\'s caution list' },
      { code: 'tax_can_change', level: 'warning', when: 'newly in the preflight\'s caution list' },
      // How tokens are rugged today (2026-10-09): pumped with fake wallets and fake volume, then dumped — or bled slowly.
      // These read the watch's own history of reads (see `history`), not one diff.
      { code: 'fake_volume', level: 'warning', when: `the last hour read looks like wash trading: ${TREND.washMinSwaps}+ swaps by at most max(${TREND.washMinWallets}, swaps / ${TREND.washSwapsPerWallet}) wallets, or the hour's volume ${TREND.washVolX}x the pool's hard side or more from ${TREND.washFewWallets} wallets or fewer (a router or aggregator trading for many wallets counts as one address, so this can also be a market that trades through one)` },
      { code: 'pump', level: 'warning', when: `the price at the $${RUG_WATCH.usd} test size rose ${TREND.pumpPct}% or more on its lowest of the last ${TREND.pumpWindowMs / 3600e3} h — you are holding into a pump; buys against wallets are named` },
      { code: 'dump', level: 'critical', when: `the price fell ${TREND.dumpPct}% or more from its high of the last 24 h, and that high came out of a pump (${TREND.pumpPct}%+ within ${TREND.pumpWindowMs / 3600e3} h)` },
      { code: 'slow_rug', level: 'critical', when: `over the last 24 h (${TREND.slowMinSpanMs / 3600e3} h of history at least): the price down ${TREND.slowPct}% or more with no single step of ${TREND.slowMaxStepPct}% between two stored reads, sells outnumbering buys in ${Math.round(TREND.slowSellShare * 100)}% of the reads, and insiders (the deployer, wallets it funded, top holders) selling` },
      { code: 'liquidity_draining', level: 'warning', when: `the pool's hard side down ${TREND.drainPct}% or more over the last 24 h with no single step of ${TREND.drainMaxStepPct}%` },
      { code: 'insider_selling', level: 'warning', when: `the deployer, wallets it funded and top holders sold $${TREND.insiderUsd.toLocaleString('en-US')} or ${TREND.insiderPoolPct}% of the pool's hard side (whichever is lower) in all across the last 24 h of reads` },
      { code: 'unreadable', level: 'warning', when: 'the token could not be read 4 checks in a row (one failed read is never an alert)' },
      { code: 'holder_line', level: 'warning', when: `a holder wallet fell under ${RUG_WATCH.holderLineText}` },
    ],
    repeats: 'the same code is sent at most once per 6 hours per watch',
    history: `the trend alerts (fake_volume, pump, dump, slow_rug, liquidity_draining, insider_selling) read a series the watch keeps of its own reads: the price per token at the $${RUG_WATCH.usd} test size (pool fee, tax and slippage included — only relative changes are used), the pool's hard side, the last hour's buys, sells, swaps, wallets and volume, and what insiders sold. Every read is compared with it, but a point is stored only once an hour (and at every alert), ${TREND.maxPoints} at most, 24 h kept — so a move between two stored points is seen at the read it happens in, and a slow trend at hourly resolution.`,
    callback: {
      method: 'POST, application/json, one attempt, 5 s timeout, redirects not followed',
      body: { watch: '<id>', token: '0x…', symbol: '…', events: [{ code: 'sell_blocked', level: 'critical', what: 'one sentence with the figures before and after', before: null, after: 'not_sellable', at: '<ISO time>' }], snapshot: '<the read that fired>', baseline_at: '<ISO time of the registration read>', at: '<ISO time>', docs: RUG_DOCS },
      signature: {
        header: 'x-bobai-signature: sha256=<hex>',
        how: 'HMAC-SHA256 of the raw request body, keyed with the watch\'s secret; compare before parsing',
        node: "crypto.createHmac('sha256', secret).update(rawBody).digest('hex') === header.slice(7)",
      },
      also: 'x-bobai-watch: <id>. The last delivery (time, HTTP status) is in the status.',
    },
    status: `GET ${RUG_DOCS}/<id> — the baseline, the current reference snapshot, the events sent, checks, failed reads in a row and the last delivery. Never the secret.`,
    cancel: `DELETE ${RUG_DOCS}/<id> with the header x-rug-watch-secret: <secret>`,
    mcp: 'bsc_rug_watch on https://brainonbnb.com/mcp registers the same watch',
    cannot_see: 'what happens between two reads: a rug inside 15 minutes is reported after it happened. It reads what the preflight reads — not the team, not the socials. Fake volume from many fresh wallets, each trading a little, looks like a busy market here; and a wallet count is a count of addresses, not of people.',
    disclaimer: 'Measurement, not advice. An event says what changed between two reads; no event is not a promise.',
  };
}

// ---------------------------------------------------------------- routes

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
const refuse = (status, code, error, extra = {}) => json({ error, code, docs: RUG_DOCS, ...extra }, status);

// /rug-watch and /rug-watch/<id>. deps: { rpc, bump(kind, n), note(name), now, fetch }.
export async function handleRugWatch(request, env, path, deps = {}) {
  const now = deps.now ?? Date.now();
  const note = deps.note || (() => {});
  const bump = deps.bump || (() => {});
  const fetchFn = deps.fetch || ((...a) => globalThis.fetch(...a));

  if (path === '/rug-watch') {
    if (request.method === 'GET') { note('rug-watch:terms'); return json(rugWatchTerms()); }
    if (request.method !== 'POST') return refuse(405, 'method', 'GET for the terms, POST to register.');
    return register(request, env, { now, note, bump, fetchFn, rpc: deps.rpc });
  }
  const m = path.match(/^\/rug-watch\/([0-9a-f-]{36})$/i);
  if (!m) return refuse(404, 'not_found', 'No such route: GET /rug-watch for the terms, GET /rug-watch/<id> for a watch.');
  const key = RUG_PREFIX + m[1].toLowerCase();
  const raw = await env.AGENT.get(key);
  if (!raw) return refuse(404, 'no_such_watch', 'No such watch, or it has ended.');
  const w = JSON.parse(raw);
  if (request.method === 'GET') { note('rug-watch:status'); return json(publicView(w, now)); }
  if (request.method === 'DELETE') {
    if (!sameString(request.headers.get('x-rug-watch-secret'), w.secret)) return refuse(403, 'bad_secret', 'Send the secret you were given at registration in the header x-rug-watch-secret.');
    await env.AGENT.delete(key);
    try { if (w.owner) await writeOwnerIndex(env, w.owner, (await readOwnerIndex(env, w.owner)).filter((x) => x.id !== w.id), now); } catch { /* it ends with its own expiry */ }
    note('rug-watch:cancel');
    return json({ cancelled: true, watch: w.id });
  }
  return refuse(405, 'method', 'GET for the status, DELETE (with x-rug-watch-secret) to cancel.');
}

async function register(request, env, { now, note, bump, fetchFn, rpc }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'bad_body', 'Send JSON: {"token":"0x…","callback":"https://…"}.');
  const token = String(body.token || body.address || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) return refuse(400, 'bad_token', 'token must be a BSC token address (0x followed by 40 hex characters).');
  const cbIssue = callbackProblem(body.callback);
  if (cbIssue) return refuse(400, 'bad_callback', cbIssue);
  const callback = String(body.callback).trim();

  // The tier: a wallet (or a signature) asks for the holder tier and must prove it.
  const holder = body.wallet != null || body.signature != null;
  let owner, wallet = null;
  if (holder) {
    const proof = await verifyHolderProof(body, now);
    if (!proof.ok) { note(`rug-watch:refused:${proof.code}`); return refuse(proof.status, proof.code, proof.error); }
    wallet = proof.wallet; owner = wallet;
  } else {
    owner = await ownerKey(callerOf(request, env), env?.HIT_SECRET);
  }
  const tier = holder ? 'holder' : 'free';
  const cb = (await sha(callback)).slice(0, 16);
  const entries = mergeEntries(await listKeys(env), await readOwnerIndex(env, owner), owner);
  const decision = tierCheck(entries, { tier, owner, token, cb, now });
  if (!decision.ok) { note(`rug-watch:refused:${decision.code}`); return refuse(decision.status, decision.code, decision.error); }

  let balance = null;
  if (holder) {
    if (!rpc) return refuse(503, 'balance_unreadable', 'The wallet balance could not be read right now. Try again in a minute.');
    try { balance = await holderBalance(rpc, wallet); }
    catch { return refuse(503, 'balance_unreadable', 'The wallet balance could not be read right now. Try again in a minute.'); }
    if (balance < RUG_WATCH.holderLine) { note('rug-watch:refused:below_holder_line'); return refuse(403, 'below_holder_line', `${wallet} holds ${bobaiText(balance)} $BOBAI; the holder tier starts at ${RUG_WATCH.holderLineText}. Without a wallet you get ${RUG_WATCH.freePerCaller} watch free.`); }
  }

  // Renewal: the same caller (or wallet), token and callback — another 30 days, same id and secret.
  if (decision.renew) {
    const raw = await env.AGENT.get(RUG_PREFIX + decision.renew);
    if (raw) {
      const w = JSON.parse(raw);
      w.expires_at = now + RUG_WATCH.days * 86400000;
      if (holder && w.paused === 'holder_line') w.paused = null;
      if (holder) w.holder_checked_at = now;
      w.saved_at = now;
      await saveWatch(env, w, now);
      note('rug-watch:renewed');
      return json({ renewed: true, watch: w.id, secret: null, secret_note: 'unchanged — the secret you were given at registration', tier: w.tier, expires_at: iso(w.expires_at), baseline: w.baseline, snapshot: w.snapshot, status_url: `${RUG_DOCS}/${w.id}` });
    }
  }

  // The baseline: one preflight now. Only a token with a pool can be watched.
  const read = await readToken(token, fetchFn, now);
  if (!read.ok) {
    if (read.status === 400 || read.status === 422) return refuse(422, read.code || 'not_measurable', read.error || 'The preflight could not read this token.');
    return refuse(503, 'preflight_unavailable', `The preflight did not answer (${read.why}). Nothing was registered; try again shortly.`);
  }
  if (read.gone) return refuse(422, 'no_pool', 'No pool was found for this token: there is nothing to watch yet.');
  if (read.pf.kind !== 'pool') {
    const curve = read.pf.kind === 'curve';
    return refuse(422, curve ? 'on_launch_curve' : 'not_quotable', curve
      ? 'This token is still on its four.meme launch curve: there is no pool to watch yet. Register it once it lists on PancakeSwap.'
      : 'No pool quotes this token: the preflight stops on not_quotable, so there is nothing to compare later reads with.');
  }

  const id = crypto.randomUUID();
  const secret = newSecret();
  const w = {
    id, token, symbol: read.pf.token?.symbol ?? null, callback, cb, secret, tier, owner,
    ...(wallet ? { wallet, holder_checked_at: now } : {}),
    created_at: now, expires_at: now + RUG_WATCH.days * 86400000,
    baseline: read.snap, snapshot: read.snap, series: [pointOf(read.snap, now)],
    checks: 0, fails: 0, fired: {}, events: [], last_delivery: null, paused: null, saved_at: now,
  };
  await saveWatch(env, w, now);
  try { const idx = await readOwnerIndex(env, owner); idx.push({ id: w.id, t: w.tier, e: w.expires_at, k: w.token, c: w.cb }); await writeOwnerIndex(env, owner, idx, now); } catch { /* the listing still counts it, a minute later */ }
  await bump('rug_watch_created');
  note(`rug-watch:created:${tier}`);
  return json({
    watch: id,
    secret,
    secret_note: 'Shown once. It signs every alert (x-bobai-signature: sha256=HMAC of the raw body) and cancels the watch (header x-rug-watch-secret).',
    tier,
    expires_at: iso(w.expires_at),
    baseline: read.snap,
    status_url: `${RUG_DOCS}/${id}`,
    cadence: 'every 15 minutes',
    ...(wallet ? { wallet, holds: `${bobaiText(balance)} $BOBAI` } : {}),
  }, 201);
}

// ---------------------------------------------------------------- the cron

// Once a day per holder wallet: under the line, the oldest watch keeps running
// (as the wallet's free one) and the rest pause; back over it, they resume.
async function holderSweep(watches, now, rpc, notes, dirty) {
  const byWallet = new Map();
  for (const w of watches) if (w.tier === 'holder' && w.wallet) byWallet.set(w.wallet, [...(byWallet.get(w.wallet) || []), w]);
  for (const [wallet, ws] of byWallet) {
    if (!ws.some((w) => now - (w.holder_checked_at || 0) >= RUG_WATCH.holderRecheckMs)) continue;
    let bal;
    try { bal = await holderBalance(rpc, wallet); } catch { continue; } // a failed read never pauses anything
    const above = bal >= RUG_WATCH.holderLine;
    ws.sort((a, b) => a.created_at - b.created_at);
    ws.forEach((w, i) => {
      w.holder_checked_at = now; dirty.add(w.id);
      if (above) { if (w.paused === 'holder_line') w.paused = null; w.holder_below = false; return; }
      const keep = i < RUG_WATCH.freePerCaller;
      if (!w.holder_below || (!keep && w.paused !== 'holder_line')) {
        notes.set(w.id, [{ code: 'holder_line', level: 'warning', what: `${wallet} now holds ${bobaiText(bal)} $BOBAI, under the ${RUG_WATCH.holderLineText} line: ${keep ? 'this watch keeps running as the wallet\'s free one; its other watches are paused' : 'this watch is paused until the wallet holds the line again (read once a day)'}.`, before: RUG_WATCH.holderLineText, after: `${bobaiText(bal)} $BOBAI` }]);
      }
      if (!keep) w.paused = 'holder_line';
      w.holder_below = true;
    });
  }
}

// Every active watch, every tick. One preflight per token however many watch it,
// six at a time; a watch is written only when it changed (stepWatch).
export async function runRugWatches(env, deps = {}) {
  const now = deps.now ?? Date.now();
  const fetchFn = deps.fetch || ((...a) => globalThis.fetch(...a));
  const keys = await listKeys(env);
  const live = keys.filter((k) => !k.metadata || k.metadata.e > now);
  const ended = keys.filter((k) => k.metadata && k.metadata.e <= now);
  await Promise.all(ended.map((k) => env.AGENT.delete(k.name).catch(() => {})));
  const watches = (await mapLimit(live.slice(0, RUG_WATCH.totalCap), 20, async (k) => {
    try { const raw = await env.AGENT.get(k.name); return raw ? JSON.parse(raw) : null; } catch { return null; }
  })).filter((w) => w && w.expires_at > now);

  const dirty = new Set();
  const notes = new Map();
  if (deps.rpc) await holderSweep(watches, now, deps.rpc, notes, dirty);

  const reads = new Map();
  const readOf = (token) => {
    if (!reads.has(token)) reads.set(token, (deps.readToken || readToken)(token, fetchFn, now).catch(() => ({ ok: false, why: 'the preflight could not be reached' })));
    return reads.get(token);
  };
  let checked = 0, failed = 0, alerts = 0, writes = 0;
  await mapLimit(watches, RUG_WATCH.concurrency, async (w0) => {
    let w = w0, send = [], snap = w0.snapshot;
    let changed = dirty.has(w0.id);
    if (!w0.paused) {
      const read = await readOf(w0.token);
      const step = stepWatch(w0, read.ok ? { ok: true, snap: read.snap } : read, now);
      w = step.watch; send = step.send; changed = changed || step.dirty;
      if (read.ok) snap = read.snap; else failed++;
      checked++;
    }
    const extra = notes.get(w0.id);
    if (extra) {
      const due = dueEvents(extra, w.fired || {}, now);
      if (due.send.length) {
        w = { ...w, fired: due.fired, events: [...(w.events || []), ...due.send.map((e) => ({ ...e, at: iso(now) }))].slice(-RUG_WATCH.keptEvents) };
        send = [...send, ...due.send];
        changed = true;
      }
    }
    if (send.length && w.callback) {
      w.last_delivery = await deliver(w, send, snap, now, fetchFn);
      alerts++; changed = true;
    }
    if (changed) {
      w.saved_at = now;
      try { await saveWatch(env, w, now); writes++; } catch { /* the next tick tries again */ }
    }
  });
  if (deps.bump) {
    if (checked) await Promise.resolve(deps.bump('rug_watch_checks', checked)).catch(() => {});
    if (alerts) await Promise.resolve(deps.bump('rug_watch_alerts', alerts)).catch(() => {});
  }
  return { active: watches.length, checked, tokens_read: reads.size, failed_reads: failed, alerts, writes, ended: ended.length };
}
