#!/usr/bin/env node
// Pins the free rug watch (worker-agent/rug-watch.js, 2026-10-09): which change
// of a token's preflight becomes an alert and which does not, the six-hour
// repeat rule, that a failed read is never an alert until the fourth in a row,
// the holder proof (EIP-191 over an exact message), the tier limits, the
// callback URL check, the signature header, and that the status never shows
// the secret. Then the same through the real worker's routes and cron, and the
// MCP tool on the site's worker. Offline: every fetch is answered here.
//
//   node scripts/rug-watch-regressions.mjs      (self-tests.mjs runs it as it is)
//
// The throwaway keys are made here with viem's generatePrivateKey and live only
// in this process; nothing is written to disk.
import { registerHooks } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

registerHooks({
  load(url, ctx, next) { return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); },
});
const ROOT = path.resolve(import.meta.dirname, '..');
const imp = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let fails = 0, passes = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (cond) passes++; else fails++; };

let RW;
try { RW = await imp('worker-agent/rug-watch.js'); }
catch (e) { console.log('  FAIL  worker-agent/rug-watch.js loads — ' + (e?.message || e)); console.log('\n1 FAILED'); process.exit(1); }
const { snapshotOf, goneSnapshot, diffSnap, stepWatch, dueEvents, verifyHolderProof, proofMessage, callbackProblem, signBody, tierCheck, publicView, runRugWatches, RUG_WATCH, RUG_PREFIX } = RW;

// ---------------------------------------------------------------- fixtures
const TOKEN = '0x' + 'a'.repeat(40);
const OWNER = '0x' + 'e'.repeat(40);
const pf = (over = {}) => ({
  tool: 'bsc_token_preflight', kind: 'pool', gate: 'no_known_stop', token: { address: TOKEN, symbol: 'TKN', name: 'Token' },
  stop: [], caution: [], tax: { buy_pct: 3, sell_pct: 3 },
  depth: { pool: '0x' + 'b'.repeat(40), one_percent_buy_usd: 500, one_percent_sell_usd: 450, pool_hard_side_usd: 100000 },
  lp_burned_pct: 99,
  control: { read: true, owner: { address: OWNER, kind: 'eoa', source: 'owner()' }, proxy: null, mint_selector: false },
  block: 1, measured_at: '2026-10-09T00:00:00.000Z', ...over,
});
const S = (over = {}) => snapshotOf(pf(over));
const codesOf = (ev) => ev.map((e) => `${e.code}:${e.level}`).join();
const diff = (a, b) => diffSnap(a, a, b);

console.log('snapshot');
{
  const s = S();
  ok('snapshot keeps gate, codes, taxes, the thinner 1% side, hard side, LP burned, owner, implementation, mint, block, at',
    s.gate === 'no_known_stop' && s.buy_tax === 3 && s.sell_tax === 3 && s.depth_usd === 450 && s.pool_hard_usd === 100000 && s.lp_burned_pct === 99
    && s.owner.address === OWNER && s.owner.kind === 'eoa' && s.implementation === null && s.mint === false && s.block === 1 && !!s.at, JSON.stringify(s));
}

console.log('\ndiffSnap: each rule fires, and not under its line');
{
  const base = S();
  ok('not_sellable appearing -> sell_blocked, critical', codesOf(diff(base, S({ stop: [{ code: 'not_sellable', why: 'x' }], gate: 'stop' }))) === 'sell_blocked:critical');
  const both = S({ stop: [{ code: 'not_sellable' }] });
  ok('… a stop that was already there fires nothing', diff(both, both).length === 0);
  ok('any other new stop code is critical under its own name', codesOf(diff(base, S({ stop: [{ code: 'not_quotable' }] }))) === 'not_quotable:critical');
  ok('buy tax 3 -> 5: buy_tax_up, warning', codesOf(diff(base, S({ tax: { buy_pct: 5, sell_pct: 3 } }))) === 'buy_tax_up:warning');
  ok('sell tax 8 -> 12: sell_tax_up, critical (10% or more)', codesOf(diff(S({ tax: { buy_pct: 3, sell_pct: 8 } }), S({ tax: { buy_pct: 3, sell_pct: 12 } }))) === 'sell_tax_up:critical');
  ok('… 3 -> 4.9 fires nothing (under 2 points)', diff(base, S({ tax: { buy_pct: 4.9, sell_pct: 4.9 } })).length === 0);
  ok('… a tax that falls fires nothing', diff(base, S({ tax: { buy_pct: 0, sell_pct: 0 } })).length === 0);
  const tx = diff(base, S({ tax: { buy_pct: 5, sell_pct: 3 } }))[0];
  ok('… and the sentence carries before and after', /3%/.test(tx.what) && /5%/.test(tx.what) && tx.before === 3 && tx.after === 5, tx.what);
  ok('hard side 100k -> 49k: liquidity_pulled, critical', codesOf(diff(base, S({ depth: { one_percent_buy_usd: 200, one_percent_sell_usd: 200, pool_hard_side_usd: 49000 } }))) === 'liquidity_pulled:critical');
  ok('hard side 100k -> 70k: liquidity_falling, warning', codesOf(diff(base, S({ depth: { one_percent_buy_usd: 300, one_percent_sell_usd: 300, pool_hard_side_usd: 70000 } }))) === 'liquidity_falling:warning');
  ok('… 100k -> 80k fires nothing', diff(base, S({ depth: { one_percent_buy_usd: 400, one_percent_sell_usd: 400, pool_hard_side_usd: 80000 } })).length === 0);
  ok('the pool gone (no_pool) -> liquidity_pulled once, critical', codesOf(diff(base, goneSnapshot('2026-10-09T01:00:00.000Z'))) === 'liquidity_pulled:critical');
  ok('LP burned 99 -> 93: lp_withdrawn, critical', codesOf(diff(base, S({ lp_burned_pct: 93 }))) === 'lp_withdrawn:critical');
  ok('… 99 -> 95 fires nothing', diff(base, S({ lp_burned_pct: 95 })).length === 0);
  ok('lp_withdrawn newly in caution: lp_withdrawn, critical', codesOf(diff(base, S({ caution: [{ code: 'lp_withdrawn' }] }))) === 'lp_withdrawn:critical');
  const ren = S({ control: { read: true, owner: { address: '0x' + '0'.repeat(40), kind: 'renounced' }, proxy: null, mint_selector: false } });
  const back = diff(ren, S())[0];
  ok('renounced -> an owner: owner_changed, critical, called the worst case', back?.code === 'owner_changed' && back.level === 'critical' && /worst case/.test(back.what), back?.what);
  const other = diff(base, S({ control: { read: true, owner: { address: '0x' + 'f'.repeat(40), kind: 'eoa' }, proxy: null, mint_selector: false } }))[0];
  ok('one owner -> another: owner_changed, critical', other?.code === 'owner_changed' && other.level === 'critical' && !/worst case/.test(other.what));
  ok('… an owner that could not be read is no change', diff(base, S({ control: { read: false } })).length === 0);
  const px = (impl) => S({ control: { read: true, owner: { address: OWNER, kind: 'eoa' }, proxy: { implementation: impl, admin: null }, mint_selector: false } });
  ok('proxy implementation changed: proxy_upgraded, critical', codesOf(diff(px('0x' + '1'.repeat(40)), px('0x' + '2'.repeat(40)))) === 'proxy_upgraded:critical');
  ok('… the same implementation fires nothing', diff(px('0x' + '1'.repeat(40)), px('0x' + '1'.repeat(40))).length === 0);
  for (const c of ['dev_selling', 'top_holder_selling', 'tax_can_change']) {
    ok(`${c} newly in caution: warning`, codesOf(diff(base, S({ caution: [{ code: c }] }))) === `${c}:warning`);
    ok(`… ${c} already there fires nothing`, diff(S({ caution: [{ code: c }] }), S({ caution: [{ code: c }] })).length === 0);
  }
  const many = diff(base, S({ stop: [{ code: 'not_sellable' }], caution: [{ code: 'dev_selling' }], tax: { buy_pct: 3, sell_pct: 30 } }));
  ok('several at once: critical ones first', many[0].level === 'critical' && many[many.length - 1].level === 'warning', codesOf(many));
}

console.log('\nstepWatch: six-hour repeats, failed reads, writes');
{
  const now = Date.parse('2026-10-09T12:00:00Z');
  const base = S();
  const w = { id: 'x', token: TOKEN, baseline: base, snapshot: base, fired: {}, events: [], checks: 0, fails: 0, saved_at: now };
  const bad = S({ stop: [{ code: 'not_sellable' }] });
  let r = stepWatch(w, { ok: true, snap: bad }, now);
  ok('a new stop is sent and recorded', r.send.length === 1 && r.watch.events.length === 1 && r.dirty);
  // the reference went back to clean and the stop came again within six hours
  r = stepWatch({ ...r.watch, snapshot: base }, { ok: true, snap: bad }, now + 3 * 3600e3);
  ok('the same code again within 6 h is not sent', r.send.length === 0);
  r = stepWatch({ ...r.watch, snapshot: base }, { ok: true, snap: bad }, now + 7 * 3600e3);
  ok('… and after 6 h it is', r.send.length === 1 && r.send[0].code === 'sell_blocked');
  ok('dueEvents keeps the time each code was sent', dueEvents([{ code: 'a' }], {}, 5).fired.a === 5);

  let f = { ...w };
  const sent = [];
  for (let i = 1; i <= 5; i++) { const s = stepWatch(f, { ok: false, why: 'http 503' }, now + i * 900e3); f = s.watch; sent.push(s.send.length); }
  ok('failed reads 1-3 are no alert', sent.slice(0, 3).every((n) => n === 0), sent.join());
  ok('… the 4th in a row is "unreadable", a warning', f.events.some((e) => e.code === 'unreadable' && e.level === 'warning') && sent[3] === 1, sent.join());
  ok('… and the 5th does not repeat it', sent[4] === 0);
  ok('… the failures are counted', f.fails === 5);
  const healed = stepWatch(f, { ok: true, snap: base }, now + 6 * 900e3);
  ok('a good read sets the count back to 0, and a failed read never changes the reference', healed.watch.fails === 0 && healed.watch.snapshot === base);

  const calm = stepWatch(w, { ok: true, snap: S({ depth: { one_percent_buy_usd: 490, one_percent_sell_usd: 440, pool_hard_side_usd: 95000 }, block: 2 }) }, now + 900e3);
  ok('a read that moved under every line writes nothing', !calm.dirty && calm.send.length === 0);
  const beat = stepWatch(w, { ok: true, snap: base }, now + 6 * 3600e3 + 1);
  ok('… but a watch is written at least every 6 hours', beat.dirty);
  const creep1 = stepWatch(w, { ok: true, snap: S({ tax: { buy_pct: 4, sell_pct: 3 } }) }, now + 900e3);
  const creep2 = stepWatch(creep1.watch, { ok: true, snap: S({ tax: { buy_pct: 5, sell_pct: 3 } }) }, now + 1800e3);
  ok('a tax creeping up a point at a time still fires once it adds up to 2 points', creep1.send.length === 0 && creep2.send.some((e) => e.code === 'buy_tax_up'));
}

// ---------------------------------------------------------------- today's rugs (2026-10-09)
// "Rugs today are not done by pulling liquidity any more: market makers pump with fake wallets and fake volume
// and then dump, or slow-rug" (the operator). Each detector through stepWatch, the way the cron drives it: the
// watch is carried to the next tick only when the step says it is written (dirty), as KV would.
console.log('\ntoday\'s rugs: fake volume, pump, dump, slow rug, draining, insiders');
{
  const H = 3600e3, t0 = Date.parse('2026-10-09T00:00:00Z');
  // one read: price per token at the $250 test size, the pool's hard side, the hour's activity, insiders' sells
  const R = ({ price = 0.001, hard = 100000, act = null, dep = null, top = 0 } = {}) => S({
    size_usd: 250, entry: { receive_tokens: price ? 250 / price : null },
    depth: { one_percent_buy_usd: 500, one_percent_sell_usd: 450, pool_hard_side_usd: hard },
    activity: act ? { window_minutes: 59, largest_sell_usd: 100, ...act } : null,
    flow: dep != null || top ? { window_minutes: 59, deployer: dep != null ? { address: '0xdep', holds_pct: 5, sold_usd: dep, sells: dep ? 2 : 0 } : null, sellers: 5, top_holders_selling: top ? 1 : 0, top_holders_sold_usd: top } : null,
  });
  const busy = { swaps: 300, buys: 160, sells: 140, unique_traders: 120, volume_usd: 50000 };
  // reads: [{h: hours after t0, ...R args}] -> every send, and the watch after
  const drive = (reads, start = {}) => {
    const first = R(reads[0]);
    let w = { id: 'x', token: TOKEN, baseline: first, snapshot: first, fired: {}, events: [], checks: 0, fails: 0, saved_at: t0 - 2 * H, created_at: t0 - 2 * H, ...start };
    const sent = [], writes = [];
    for (const r of reads) {
      const now = t0 + r.h * H;
      const st = stepWatch(w, { ok: true, snap: R(r) }, now);
      sent.push(...st.send.map((e) => ({ ...e, h: r.h })));
      if (st.dirty) { w = { ...st.watch, saved_at: now }; writes.push(r.h); }
    }
    return { sent, w, writes, codes: sent.map((e) => `${e.code}:${e.level}`) };
  };
  const has = (d, code) => d.sent.some((e) => e.code === code);
  const hourly = (n, f) => Array.from({ length: n }, (_, i) => ({ h: i, ...f(i) }));

  const sp = R({ price: 0.002 });
  ok('the snapshot carries the price at the test size (size_usd / entry.receive_tokens), the hour\'s activity and insiders\' sells',
    sp.price === 0.002 && R({ act: busy }).act?.swaps === 300 && R({ act: busy }).act?.unique === 120 && R({ dep: 300, top: 200 }).insider?.sold_usd === 500, JSON.stringify([sp.price, sp.act, sp.insider]));

  // 1. fake volume
  let d = drive([{ h: 0 }, { h: 1, hard: 8000, act: { swaps: 41, buys: 30, sells: 11, unique_traders: 3, volume_usd: 12000 } }]);
  const fv = d.sent.find((e) => e.code === 'fake_volume');
  ok('41 swaps by 3 wallets in an hour: fake_volume, a warning, with the figures and "looks like"', fv?.level === 'warning' && /41 swaps by 3 wallets in 59 min/.test(fv.what) && /\$12,000 volume/.test(fv.what) && /\$8,000 pool/.test(fv.what) && /looks like/.test(fv.what), fv?.what || d.codes.join());
  d = drive([{ h: 0 }, { h: 1, hard: 8000, act: { swaps: 60, buys: 35, sells: 25, unique_traders: 8, volume_usd: 20000 } }]);
  ok('… 60 swaps by 8 wallets, $20k volume on an $8k pool: fake_volume too (the hour\'s volume 2x the pool from 10 wallets or fewer)', has(d, 'fake_volume'), d.codes.join());
  d = drive([{ h: 0 }, { h: 1, act: busy }, { h: 2, hard: 20000, act: busy }]);
  ok('… a normal busy market (300 swaps by 120 wallets, even at $50k volume on a $20k pool) is NOT fake volume', !has(d, 'fake_volume') && d.w.series?.length >= 2, d.codes.join() + ' series ' + d.w.series?.length);
  d = drive([{ h: 0 }, { h: 1, act: { swaps: 19, buys: 10, sells: 9, unique_traders: 1, volume_usd: 900 } }, { h: 2, act: { swaps: 41, buys: 21, sells: 20, unique_traders: 5, volume_usd: 3000 } }, { h: 3, act: { swaps: 41, buys: 21, sells: 20, unique_traders: null, volume_usd: 3000 } }]);
  ok('… 19 swaps (under 20), 41 swaps by 5 wallets (line 4), and wallets not read: none of them', !has(d, 'fake_volume') && d.w.series?.length >= 3, d.codes.join());
  const wash = { swaps: 41, buys: 30, sells: 11, unique_traders: 3, volume_usd: 12000 };
  d = drive([{ h: 0 }, { h: 1, act: wash }, { h: 1.25, act: wash }, { h: 4, act: wash }, { h: 7.5, act: wash }]);
  ok('… repeated: once, not again within 6 h, again after 6 h', d.sent.filter((e) => e.code === 'fake_volume').map((e) => e.h).join() === '1,7.5', d.sent.map((e) => e.code + '@' + e.h).join());

  // 2. pump
  d = drive([{ h: 0, price: 0.001 }, { h: 1, price: 0.0011 }, { h: 3, price: 0.00145, act: { swaps: 80, buys: 62, sells: 18, unique_traders: 40, volume_usd: 9000 } }]);
  const pu = d.sent.find((e) => e.code === 'pump');
  ok('price +45% within 6 h: pump, a warning, naming buys against wallets', pu?.level === 'warning' && /\+45%/.test(pu.what) && /62 buys and 18 sells by 40 wallets/.test(pu.what) && pu.before === 0.001 && pu.after === 0.00145, pu?.what || d.codes.join());
  d = drive([{ h: 0, price: 0.001 }, { h: 1, price: 0.0011 }, { h: 3, price: 0.00135 }]);
  ok('… +35% is no pump (and the prices are kept in the series)', !has(d, 'pump') && d.w.series?.some((p) => p.p === 0.00135), d.codes.join());
  d = drive([{ h: 0, price: 0.001 }, { h: 7, price: 0.0012 }, { h: 14, price: 0.00145 }]);
  ok('… +45% over 14 h, never 40% within 6 h, is no pump either', !has(d, 'pump') && d.w.series?.length === 3, d.codes.join() + ' ' + d.w.series?.length);

  // 3. dump after a pump
  d = drive([{ h: 0, price: 0.001 }, { h: 1, price: 0.001 }, { h: 2, price: 0.0016 }, { h: 3, price: 0.0016 }, { h: 4, price: 0.00105 }]);
  const du = d.sent.find((e) => e.code === 'dump');
  ok('pumped to +60%, then -34% from that high: dump, critical, after the pump warning', du?.level === 'critical' && /fell 34%/.test(du.what) && /\+60%/.test(du.what) && d.sent.findIndex((e) => e.code === 'pump') < d.sent.findIndex((e) => e.code === 'dump'), du?.what || d.codes.join());
  d = drive([{ h: 0, price: 0.001 }, { h: 1, price: 0.001 }, { h: 2, price: 0.0016 }, { h: 3, price: 0.0016 }, { h: 4, price: 0.0012 }]);
  ok('… -25% from the high is no dump', has(d, 'pump') && !has(d, 'dump'), d.codes.join());
  d = drive(hourly(16, (i) => ({ price: 0.001 * (1 + 0.05 * Math.min(i, 10)) })).concat([{ h: 16, price: 0.001 }]));
  ok('… -33% from a high that was climbed slowly (no 40% within 6 h) is no dump', !has(d, 'dump') && !has(d, 'pump') && d.w.series?.length >= 10, d.codes.join());

  // 4. slow rug
  const bleed = (i, o = {}) => ({ price: 0.001 * (1 - 0.035 * i), act: { swaps: 40, buys: 12, sells: 28, unique_traders: 30, volume_usd: 3000 }, dep: 150, ...o });
  d = drive(hourly(10, (i) => bleed(i)));
  const sr = d.sent.find((e) => e.code === 'slow_rug');
  ok('price -28% over 8 h in 3.5% steps, sells ahead in every read, the deployer selling: slow_rug, critical', sr?.level === 'critical' && /fell 2[5-9]%/.test(sr.what) && /sells outnumbered buys in \d+ of \d+ reads/.test(sr.what) && /insiders sold/.test(sr.what) && /looks like a slow rug/.test(sr.what), sr?.what || d.codes.join());
  d = drive(hourly(10, (i) => bleed(i, { act: { swaps: 40, buys: 28, sells: 12, unique_traders: 30, volume_usd: 3000 } })));
  ok('… the same fall with buys ahead is no slow rug', !has(d, 'slow_rug') && d.w.series?.length >= 9, d.codes.join());
  d = drive(hourly(10, (i) => bleed(i, { dep: 0 })));
  ok('… nor with no insider selling', !has(d, 'slow_rug') && d.w.series?.length >= 9, d.codes.join());
  d = drive(hourly(6, (i) => bleed(i, { price: 0.001 * (1 - 0.035 * i) })));
  ok('… nor -17.5% (under 25%)', !has(d, 'slow_rug') && d.w.series?.length >= 5, d.codes.join());
  d = drive([...hourly(5, (i) => bleed(0)), { h: 5, ...bleed(9) }, { h: 6, ...bleed(9) }, { h: 7, ...bleed(9) }]);
  ok('… nor a fall in one step of 25% or more (that is a crash, not a bleed)', !has(d, 'slow_rug') && d.w.series?.length >= 7, d.codes.join());

  // 5. liquidity draining
  d = drive(hourly(10, (i) => ({ hard: 100000 * (1 - 0.04 * i) })));
  const ld = d.sent.find((e) => e.code === 'liquidity_draining');
  ok('the hard side -32% over 8 h in 4% steps: liquidity_draining, a warning', ld?.level === 'warning' && /fell 3\d% over the last/.test(ld.what) && /drained slowly/.test(ld.what), ld?.what || d.codes.join());
  d = drive(hourly(8, (i) => ({ hard: 100000 * (1 - 0.035 * i) })));
  ok('… -24.5% is not', !has(d, 'liquidity_draining') && d.w.series?.length >= 7, d.codes.join());

  // 6. insiders selling, added up
  d = drive([{ h: 0 }, { h: 1, dep: 400 }, { h: 2, dep: 400 }, { h: 3, dep: 400 }]);
  const is = d.sent.find((e) => e.code === 'insider_selling');
  ok('the deployer sells $400 an hour three hours running ($1,200 in all): insider_selling, a warning, on the third', is?.level === 'warning' && is.h === 3 && /\$1,200/.test(is.what), is?.what || d.codes.join());
  d = drive([{ h: 0 }, { h: 1, dep: 400 }, { h: 2, dep: 400 }]);
  ok('… $800 on a $100k pool is not', !has(d, 'insider_selling') && d.w.series?.length === 3, d.codes.join());
  d = drive([{ h: 0 }, { h: 1, dep: 600 }, { h: 1.25, dep: 600 }]);
  ok('… two reads 15 minutes apart share their hour: $600 counted once, not $1,200', !has(d, 'insider_selling') && d.w.series?.length === 2, d.codes.join());
  d = drive([{ h: 0, hard: 8000 }, { h: 1, hard: 8000, dep: 450 }]);
  ok('… on an $8k pool, $450 is past 5% of the hard side: insider_selling', has(d, 'insider_selling'), d.codes.join());
  d = drive([{ h: 0, hard: 8000 }, { h: 1, hard: 8000, top: 500 }]);
  ok('… and a top holder\'s sells count as an insider\'s', has(d, 'insider_selling'), d.codes.join());

  // a calm market, and what is stored
  d = drive(Array.from({ length: 24 * 4 + 1 }, (_, i) => ({ h: i / 4, price: 0.001 * (1 + 0.03 * Math.sin(i)), hard: 100000 * (1 + 0.02 * Math.cos(i)), act: busy, dep: 0 })));
  ok('a calm busy day (price ±3%, many wallets, no insider sells), 97 reads: no alert at all, while the day is kept in the series', d.sent.length === 0 && d.w.series?.length > 20, d.codes.join());
  ok('… one stored point an hour: 25 writes for 97 checks over 24 h (hours 0 to 24), the series one point an hour', d.writes.length === 25 && d.w.series?.length === 25 && d.w.series.every((p, i, a) => !i || p.t - a[i - 1].t >= 55 * 60e3), `${d.writes.length} writes, ${d.w.series?.length} points`);
  ok('… and a point is compact: t, p, h, b, s, n, u, v, m, i, ts — no nulls', Object.keys(d.w.series?.[0] || {}).every((k) => ['t', 'p', 'h', 'b', 's', 'n', 'u', 'v', 'm', 'i', 'ts'].includes(k)) && d.w.series?.length > 0 && !JSON.stringify(d.w.series || null).includes('null'), JSON.stringify(d.w.series?.[0]));
  d = drive(Array.from({ length: 40 }, (_, i) => ({ h: i, act: busy })));
  ok('the series keeps a day (25 h) and at most 96 points', d.w.series?.length <= 26 && d.w.series[0].t >= t0 + 39 * H - 25 * H, String(d.w.series?.length));
  ok('the status shows the series as history', Array.isArray(publicView({ ...d.w, callback: 'https://example.com/h', created_at: 1, expires_at: Date.now() + 1e6 }).history) && publicView({ ...d.w, callback: 'https://example.com/h', created_at: 1, expires_at: Date.now() + 1e6 }).history.length === d.w.series?.length);
}

console.log('\nholder proof (EIP-191, exact message)');
{
  const now = Date.now();
  const acct = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const wallet = acct.address.toLowerCase();
  const issued = new Date(now - 60e3).toISOString();
  const sig = await acct.signMessage({ message: proofMessage(wallet, issued) });
  ok('the message is the three lines, lower-case wallet', proofMessage(acct.address, issued) === `BOBAI rug watch\nwallet: ${wallet}\nissued: ${issued}`);
  ok('a good signature passes', (await verifyHolderProof({ wallet, issued, signature: sig }, now)).ok === true);
  const wrong = await verifyHolderProof({ wallet: other.address, issued, signature: sig }, now);
  ok('… claimed for another wallet: wrong_signer', !wrong.ok && wrong.code === 'wrong_signer' && wrong.status === 403, JSON.stringify(wrong));
  const oldIssued = new Date(now - 11 * 60e3).toISOString();
  const oldSig = await acct.signMessage({ message: proofMessage(wallet, oldIssued) });
  const stale = await verifyHolderProof({ wallet, issued: oldIssued, signature: oldSig }, now);
  ok('… issued 11 minutes ago: stale_proof', !stale.ok && stale.code === 'stale_proof');
  const future = new Date(now + 10 * 60e3).toISOString();
  ok('… issued 10 minutes ahead: stale_proof', (await verifyHolderProof({ wallet, issued: future, signature: await acct.signMessage({ message: proofMessage(wallet, future) }) }, now)).code === 'stale_proof');
  const altered = await acct.signMessage({ message: proofMessage(wallet, issued) + ' ' });
  ok('… a signature over an altered message fails', (await verifyHolderProof({ wallet, issued, signature: altered }, now)).ok === false);
  const checksummed = await acct.signMessage({ message: `BOBAI rug watch\nwallet: ${acct.address}\nissued: ${issued}` });
  ok('… the address not in lower case in the signed message fails', (await verifyHolderProof({ wallet, issued, signature: checksummed }, now)).ok === false);
  ok('… a malformed signature is a 400', (await verifyHolderProof({ wallet, issued, signature: '0x12' }, now)).status === 400);
}

console.log('\ntiers');
{
  const now = 1e12;
  const e = (i, t, o, k = TOKEN, c = 'cb', exp = now + 1e6) => ({ name: `${RUG_PREFIX}id${i}`, metadata: { t, o, e: exp, k, c } });
  ok('a second free watch from the same caller is refused (free_limit)', tierCheck([e(1, 'free', 'me')], { tier: 'free', owner: 'me', token: '0x' + 'c'.repeat(40), cb: 'cb2', now }).code === 'free_limit');
  ok('… the same token to the same callback renews instead', tierCheck([e(1, 'free', 'me')], { tier: 'free', owner: 'me', token: TOKEN, cb: 'cb', now }).renew === 'id1');
  // FOUND LIVE (2026-10-09): a second free watch passed because the KV listing did not show the first one yet
  ok('a watch only in the owner index (not yet in the listing) still counts: the second free watch is refused', typeof RW.mergeEntries === 'function' && tierCheck(RW.mergeEntries([], [{ id: 'fresh', t: 'free', e: now + 1e6, k: TOKEN, c: 'cb' }], 'me'), { tier: 'free', owner: 'me', token: '0x' + 'c'.repeat(40), cb: 'cb2', now }).code === 'free_limit');
  ok('… and one in both is counted once', typeof RW.mergeEntries === 'function' && RW.mergeEntries([e(1, 'free', 'me')], [{ id: 'id1', t: 'free', e: now + 1e6, k: TOKEN, c: 'cb' }], 'me').length === 1);
  ok('… an ended watch does not count', tierCheck([e(1, 'free', 'me', TOKEN, 'cb', now - 1)], { tier: 'free', owner: 'me', token: '0x' + 'c'.repeat(40), cb: 'x', now }).ok === true);
  const fifty = Array.from({ length: RUG_WATCH.freeCap }, (_, i) => e(i, 'free', `o${i}`));
  ok(`${RUG_WATCH.freeCap} free watches in all: the next is refused (free_capacity)`, RUG_WATCH.freeCap === 50 && tierCheck(fifty, { tier: 'free', owner: 'new', token: TOKEN, cb: 'z', now }).code === 'free_capacity');
  ok('… a holder still gets one', tierCheck(fifty, { tier: 'holder', owner: '0xh', token: TOKEN, cb: 'z', now }).ok === true);
  const h = (n) => Array.from({ length: n }, (_, i) => e(i, 'holder', '0xh', '0x' + String(i).padStart(40, '0'), `c${i}`));
  ok('a holder wallet gets 25: the 25th is taken, the 26th refused (holder_limit)', RUG_WATCH.holderCap === 25 && tierCheck(h(24), { tier: 'holder', owner: '0xh', token: TOKEN, cb: 'z', now }).ok && tierCheck(h(25), { tier: 'holder', owner: '0xh', token: TOKEN, cb: 'z', now }).code === 'holder_limit');
  const full = Array.from({ length: RUG_WATCH.totalCap }, (_, i) => e(i, 'holder', `w${i}`));
  ok(`${RUG_WATCH.totalCap} watches in all: the next is refused (capacity), whatever the tier`, RUG_WATCH.totalCap === 200 && tierCheck(full, { tier: 'holder', owner: 'new', token: TOKEN, cb: 'z', now }).code === 'capacity' && tierCheck(full, { tier: 'free', owner: 'new', token: TOKEN, cb: 'z', now }).code === 'capacity');
}

console.log('\ncallback URL');
{
  const refused = ['http://example.com/hook', 'https://localhost/hook', 'https://foo.localhost/x', 'https://10.0.0.5/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://192.168.1.1/x', 'https://172.16.0.1/x', 'https://100.64.0.1/x', 'https://[::1]/x', 'https://[fd00::1]/x', 'https://2130706433/x', 'https://brainonbnb.com/x', 'https://agent.brainonbnb.com/rug-watch', 'https://user:pw@example.com/x', 'ftp://example.com/x', 'https://intranet/x', ''];
  const letThrough = refused.filter((u) => callbackProblem(u) === null);
  ok('http, localhost, private / loopback / link-local / shared addresses, our own hosts, credentials and bare names are refused', letThrough.length === 0, letThrough.join(' '));
  const good = ['https://example.com/hook', 'https://hooks.my-agent.io:8443/rug?k=1', 'https://8.8.8.8/x'];
  const blocked = good.filter((u) => callbackProblem(u) !== null);
  ok('… a public https endpoint passes', blocked.length === 0, blocked.join(' '));
}

console.log('\nsignature header');
{
  const body = JSON.stringify({ watch: 'x', events: [{ code: 'sell_blocked' }] });
  const want = 'sha256=' + crypto.createHmac('sha256', 'rws_secret').update(body).digest('hex');
  ok('x-bobai-signature is sha256=<hex HMAC-SHA256 of the raw body with the secret>', (await signBody('rws_secret', body)) === want);
  ok('… another secret gives another signature', (await signBody('rws_other', body)) !== want);
}

console.log('\nstatus view');
{
  const w = { id: 'abc', token: TOKEN, symbol: 'TKN', tier: 'free', secret: 'rws_topsecret', owner: 'c:1234', callback: 'https://example.com/h?key=private', created_at: 1, expires_at: Date.now() + 1e6, baseline: S(), snapshot: S() };
  const v = JSON.stringify(publicView(w));
  ok('the status never carries the secret, the owner or the callback\'s path and query', !v.includes('rws_topsecret') && !/"secret"/.test(v) && !v.includes('c:1234') && !v.includes('key=private') && v.includes('example.com'));
}

// ---------------------------------------------------------------- the real worker
console.log('\nworker-agent routes and cron (offline)');
const store = new Map();
const kv = {
  get: async (k) => (store.has(k) ? store.get(k).v : null),
  put: async (k, v, o = {}) => { kv.puts++; store.set(k, { v, m: o.metadata ?? null }); },
  delete: async (k) => { store.delete(k); },
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: store.get(name).m })), list_complete: true }),
  puts: 0,
};
const env = { AGENT: kv, HIT_SECRET: 'hs', X402_WALLET: '0x690E950214980BC329823A2DB2fD90C06Bd54dE4' };
const answers = new Map(); // token -> {status, body}
const balances = new Map(); // wallet -> bigint
const hooks = []; // callbacks received
let hookDown = new Set();
const agentCalls = [];
const pfCalls = new Map(); // token -> preflight reads
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.startsWith('https://brainonbnb.com/api/preflight')) {
    const t = new URL(url).searchParams.get('address');
    pfCalls.set(t, (pfCalls.get(t) || 0) + 1);
    const a = answers.get(t) || { status: 200, body: pf({ token: { address: t, symbol: 'TKN' } }) };
    if (a.throws) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  }
  if (url.startsWith('https://hook.example/')) {
    if (hookDown.has(url)) throw new Error('connect refused');
    hooks.push({ url, headers: Object.fromEntries(new Headers(init.headers)), body: init.body, redirect: init.redirect });
    return new Response('ok');
  }
  if (url.startsWith('https://agent.brainonbnb.com/')) { agentCalls.push({ url, init }); return new Response(JSON.stringify({ watch: 'id', secret: 'rws_x', tier: 'free' }), { status: 201 }); }
  if (init.method === 'POST' && /^\{"jsonrpc"/.test(String(init.body))) {
    const b = JSON.parse(init.body);
    if (b.method === 'eth_call' && b.params[0].to === RUG_WATCH.bobai) {
      const who = '0x' + b.params[0].data.slice(-40);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + (balances.get(who) ?? 0n).toString(16).padStart(64, '0') }));
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }));
  }
  throw new Error('offline test: no network (' + url.slice(0, 60) + ')');
};
const worker = (await imp('worker-agent/index.js')).default;
const waits = [];
const ctx = { waitUntil: (p) => waits.push(Promise.resolve(p).catch(() => {})) };
const call = (p, init = {}) => worker.fetch(new Request('https://agent.brainonbnb.com' + p, init), env, ctx);
const post = (body, ip = '1.2.3.4', headers = {}) => call('/rug-watch', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: JSON.stringify(body) });
const tok = (c) => '0x' + c.repeat(40);
{
  const terms = await (await call('/rug-watch')).json();
  ok('GET /rug-watch: the terms name 1 free, 25 for 1,000,000 $BOBAI holders, the exact message, the header and the cadence',
    terms.tiers.free.watches === 1 && terms.tiers.holder.watches === 25 && /1,000,000 \$BOBAI/.test(terms.tiers.holder.line)
    && terms.tiers.holder.proof.message.startsWith('BOBAI rug watch\nwallet: ') && /x-bobai-signature: sha256=/.test(terms.callback.signature.header) && /15 minutes/.test(terms.cadence));

  const r1 = await post({ token: tok('1'), callback: 'https://hook.example/a' });
  const j1 = await r1.json();
  ok('POST registers a free watch: 201, id, secret shown, tier, expiry in 30 days, baseline, status_url',
    r1.status === 201 && /^[0-9a-f-]{36}$/.test(j1.watch) && /^rws_[0-9a-f]{48}$/.test(j1.secret) && j1.tier === 'free'
    && Math.abs(Date.parse(j1.expires_at) - Date.now() - 30 * 86400e3) < 60e3 && j1.baseline?.gate === 'no_known_stop' && j1.status_url.endsWith(j1.watch), JSON.stringify(j1).slice(0, 300));
  const stored = JSON.parse(store.get(RUG_PREFIX + j1.watch).v);
  ok('… the caller is stored hashed, never as the address', !JSON.stringify(stored).includes('1.2.3.4') && /^c:[0-9a-f]{32}$/.test(stored.owner));
  ok('… and the series starts with the registration read', Array.isArray(stored.series) && stored.series.length === 1 && stored.series[0].h === 100000, JSON.stringify(stored.series));
  const tc = new Set((terms.detects || []).map((x) => x.code));
  ok('the terms name fake_volume, pump, dump, slow_rug, liquidity_draining and insider_selling, and how the history is stored', ['fake_volume', 'pump', 'dump', 'slow_rug', 'liquidity_draining', 'insider_selling'].every((c) => tc.has(c))
    && /once an hour/.test(terms.history || '') && /looks like wash trading/.test((terms.detects || []).find((x) => x.code === 'fake_volume')?.when || '') && /slow rug/.test(terms.what), [...tc].join());
  const r2 = await post({ token: tok('2'), callback: 'https://hook.example/b' });
  ok('a second free watch from the same caller: 429 free_limit', r2.status === 429 && (await r2.json()).code === 'free_limit');
  const r3 = await post({ token: tok('1'), callback: 'https://hook.example/a' });
  const j3 = await r3.json();
  ok('… the same token and callback again renews: same id, no secret', r3.status === 200 && j3.renewed === true && j3.watch === j1.watch && j3.secret === null);
  const r4 = await post({ token: tok('2'), callback: 'https://hook.example/b' }, '5.6.7.8');
  ok('another caller gets its own free watch', r4.status === 201);
  const j4 = await r4.json();
  const r5 = await post({ token: tok('3'), callback: 'https://hook.example/c' }, '2001:db8:1:2::5');
  const r6 = await post({ token: tok('4'), callback: 'https://hook.example/d' }, '2001:db8:1:2::99');
  ok('IPv6 callers are one caller per /64', r5.status === 201 && r6.status === 429);
  const fwd = await post({ token: tok('5'), callback: 'https://hook.example/e' }, '2a06:98c0:3600::103', { 'x-rug-watch-for': '9.9.9.9', 'x-hit-secret': 'hs' });
  const fwdBad = await post({ token: tok('6'), callback: 'https://hook.example/f' }, '2a06:98c0:3600::103', { 'x-rug-watch-for': '9.9.9.8', 'x-hit-secret': 'wrong' });
  const fwdBad2 = await post({ token: tok('7'), callback: 'https://hook.example/g' }, '2a06:98c0:3600::103', { 'x-rug-watch-for': '9.9.9.7', 'x-hit-secret': 'wrong' });
  ok('the site\'s MCP caller is counted by the address it forwards with the secret; without the secret it is not believed', fwd.status === 201 && fwdBad.status === 201 && fwdBad2.status === 429);

  ok('an http callback is refused before anything is read', (await post({ token: tok('8'), callback: 'http://hook.example/x' }, '7.7.7.7')).status === 400);
  ok('a malformed token is refused', (await post({ token: '0x12', callback: 'https://hook.example/x' }, '7.7.7.7')).status === 400);
  answers.set(tok('9'), { status: 200, body: pf({ kind: 'curve', token: { address: tok('9') } }) });
  const curve = await post({ token: tok('9'), callback: 'https://hook.example/x' }, '7.7.7.1');
  ok('a token still on its launch curve: 422 on_launch_curve', curve.status === 422 && (await curve.json()).code === 'on_launch_curve');
  answers.set(tok('8'), { status: 422, body: { error: 'This address is a wallet.', code: 'is_wallet', hint: 'x' } });
  const wal = await post({ token: tok('8'), callback: 'https://hook.example/x' }, '7.7.7.2');
  ok('a preflight refusal comes back with its own code (is_wallet)', wal.status === 422 && (await wal.json()).code === 'is_wallet');
  answers.set(tok('7'), { status: 503, body: { error: 'down', code: 'chain_unavailable' } });
  ok('a preflight that is down: 503, nothing stored', (await post({ token: tok('7'), callback: 'https://hook.example/x' }, '7.7.7.3')).status === 503);

  const st = await call('/rug-watch/' + j1.watch);
  const sj = await st.text();
  ok('GET /rug-watch/<id>: the status, never the secret', st.status === 200 && !sj.includes(j1.secret) && !/"secret"/.test(sj) && JSON.parse(sj).status === 'active');
  ok('DELETE without the right secret: 403', (await call('/rug-watch/' + j4.watch, { method: 'DELETE', headers: { 'x-rug-watch-secret': 'rws_nope' } })).status === 403);
  ok('DELETE with it: cancelled, then 404', (await call('/rug-watch/' + j4.watch, { method: 'DELETE', headers: { 'x-rug-watch-secret': j4.secret } })).status === 200
    && (await call('/rug-watch/' + j4.watch)).status === 404);

  // the holder tier through the route
  const acct = privateKeyToAccount(generatePrivateKey());
  const wallet = acct.address.toLowerCase();
  const issued = new Date().toISOString();
  const signature = await acct.signMessage({ message: proofMessage(wallet, issued) });
  balances.set(wallet, 999999n * 10n ** 18n);
  const low = await post({ token: tok('a'), callback: 'https://hook.example/h0', wallet, signature, issued }, '1.2.3.4');
  ok('a wallet under 1,000,000 $BOBAI: 403 below_holder_line', low.status === 403 && (await low.json()).code === 'below_holder_line');
  balances.set(wallet, 1000000n * 10n ** 18n);
  const hs = [];
  for (let i = 0; i < 3; i++) hs.push(await (await post({ token: '0x' + 'b'.repeat(39) + i, callback: `https://hook.example/h${i}`, wallet, signature, issued }, '1.2.3.4')).json());
  ok('a wallet holding the line registers holder watches beside the caller\'s free one', hs.every((x) => x.tier === 'holder' && x.secret));
  ok('… a wallet with a bad signature is refused', (await post({ token: tok('c'), callback: 'https://hook.example/x', wallet: '0x' + 'd'.repeat(40), signature, issued }, '1.2.3.4')).status === 403);

  // the cron: one sweep, an alert, the signature, a quiet sweep
  await Promise.all(waits);
  answers.set(tok('1'), { status: 200, body: pf({ token: { address: tok('1'), symbol: 'TKN' }, gate: 'stop', stop: [{ code: 'not_sellable', why: 'reverted' }] }) });
  hookDown = new Set(['https://hook.example/b']);
  const t0 = Date.now() + 60e3;
  const run1 = await runRugWatches(env, { now: t0 });
  const a1 = hooks.filter((h) => h.url === 'https://hook.example/a');
  const sigOk = a1.length === 1 && a1[0].headers['x-bobai-signature'] === 'sha256=' + crypto.createHmac('sha256', j1.secret).update(a1[0].body).digest('hex');
  const payload = a1[0] ? JSON.parse(a1[0].body) : {};
  ok('the cron sends sell_blocked to the callback, signed with the watch\'s secret, redirects not followed', sigOk && a1[0].redirect === 'manual' && payload.events?.[0]?.code === 'sell_blocked', JSON.stringify(run1));
  ok('… the body carries watch, token, symbol, events, snapshot, baseline_at, at, docs', ['watch', 'token', 'symbol', 'events', 'snapshot', 'baseline_at', 'at', 'docs'].every((k) => k in payload));
  const after = await (await call('/rug-watch/' + j1.watch)).json();
  ok('… the delivery is recorded (time, status) and the event is in the status', after.last_delivery?.status === 200 && after.events.some((e) => e.code === 'sell_blocked'));
  const putsBefore = kv.puts;
  const run2 = await runRugWatches(env, { now: t0 + 900e3 });
  ok('the next sweep with nothing new sends nothing and writes nothing', hooks.filter((h) => h.url === 'https://hook.example/a').length === 1 && kv.puts === putsBefore && run2.alerts === 0, `${kv.puts - putsBefore} writes, ${run2.alerts} alerts`);

  // a callback that is down never stalls the others
  answers.set(tok('5'), { status: 200, body: pf({ token: { address: tok('5') }, gate: 'stop', stop: [{ code: 'not_buyable' }] }) });
  const dead = { id: crypto.randomUUID(), token: tok('5'), callback: 'https://hook.example/b', secret: 'rws_s', tier: 'free', owner: 'c:z', cb: 'q', created_at: t0, expires_at: t0 + 86400e3, baseline: S(), snapshot: S(), fired: {}, events: [], saved_at: t0 };
  await kv.put(RUG_PREFIX + dead.id, JSON.stringify(dead), { metadata: { t: 'free', o: 'c:z', e: dead.expires_at, k: dead.token, c: 'q' } });
  const before = hooks.length;
  const reads5 = pfCalls.get(tok('5')) || 0;
  await runRugWatches(env, { now: t0 + 1800e3 });
  ok('one preflight per token and sweep, however many watches read it', (pfCalls.get(tok('5')) || 0) - reads5 === 1, String((pfCalls.get(tok('5')) || 0) - reads5));
  const deadAfter = JSON.parse(store.get(RUG_PREFIX + dead.id).v);
  ok('a callback that is down is recorded as failed, and the watches beside it still deliver', deadAfter.last_delivery?.ok === false && hooks.slice(before).some((h) => h.url === 'https://hook.example/e'), JSON.stringify(deadAfter.last_delivery));

  // a failed read is not an alert until the fourth
  for (const t of [tok('1'), tok('3'), tok('5'), tok('6'), '0x' + 'b'.repeat(39) + '0', '0x' + 'b'.repeat(39) + '1', '0x' + 'b'.repeat(39) + '2']) answers.set(t, { throws: true });
  const n0 = hooks.length;
  for (let i = 1; i <= 3; i++) await runRugWatches(env, { now: t0 + (2 + i) * 3600e3 });
  ok('three failed sweeps in a row send nothing', hooks.length === n0, `${hooks.length - n0} sent`);
  await runRugWatches(env, { now: t0 + 6 * 3600e3 });
  ok('… the fourth sends "unreadable"', hooks.slice(n0).some((h) => JSON.parse(h.body).events.some((e) => e.code === 'unreadable')));

  // the holder line, re-read once a day
  answers.clear();
  balances.set(wallet, 10n * 10n ** 18n);
  const n1 = hooks.length;
  await runRugWatches(env, { now: t0 + 26 * 3600e3, rpc: async (method, params) => { const r = await fetch('https://bsc.publicnode.com', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); return (await r.json()).result; } });
  const views = await Promise.all(hs.map(async (x) => (await call('/rug-watch/' + x.watch)).json()));
  ok('a holder under the line: the oldest watch keeps running, the others pause', views[0].status === 'active' && views.slice(1).every((v) => v.status === 'paused'), views.map((v) => v.status).join());
  ok('… and each callback gets a holder_line warning', hs.every((x, i) => hooks.slice(n1).some((h) => h.url === `https://hook.example/h${i}` && JSON.parse(h.body).events.some((e) => e.code === 'holder_line'))));
}

console.log('\nthe site: MCP tool bsc_rug_watch, preflight pointer, discovery');
{
  const site = (await imp('dashboard/_worker.js')).default;
  const senv = { HIT_SECRET: 'hs', ASSETS: { fetch: async () => new Response('asset') } };
  const sctx = { waitUntil: () => {} };
  const quiet = console.log;
  const mcp = async (method, params, ip = '4.4.4.4') => {
    console.log = () => {};
    try {
      const r = await site.fetch(new Request('https://brainonbnb.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), senv, sctx);
      return r.json();
    } finally { console.log = quiet; }
  };
  const list = await mcp('tools/list');
  const t = (list.result?.tools || []).find((x) => x.name === 'bsc_rug_watch');
  ok('tools/list carries bsc_rug_watch, declared NOT read-only', !!t && t.annotations?.readOnlyHint === false && t.inputSchema?.required?.includes('callback'));
  ok('… its description names honeypot/rug-pull, webhook only, one free, 25 for 1,000,000 $BOBAI holders, every 15 minutes and the triggers',
    !!t && /honeypot/i.test(t.description) && /rug-pull/i.test(t.description) && /webhook only/i.test(t.description) && /one .*free/i.test(t.description) && /25/.test(t.description) && /1,000,000 \$BOBAI/.test(t.description) && /15 minutes/.test(t.description) && /liquidity/i.test(t.description) && /owner/i.test(t.description));
  ok('… and names today\'s rugs honestly: fake volume (looks like wash trading), pump and dump, slow rug, insiders',
    !!t && /fake volume/i.test(t.description) && /looks like wash trading/i.test(t.description) && /pump/i.test(t.description) && /dump/i.test(t.description) && /slow rug/i.test(t.description) && /insider/i.test(t.description));
  agentCalls.length = 0;
  const res = await mcp('tools/call', { name: 'bsc_rug_watch', arguments: { token: tok('1'), callback: 'https://hook.example/m' } });
  const fwd = agentCalls.find((c) => c.url.endsWith('/rug-watch'));
  const fh = fwd ? Object.fromEntries(new Headers(fwd.init.headers)) : {};
  ok('tools/call proxies to agent.brainonbnb.com/rug-watch, forwarding the caller with the shared secret', fwd?.url === 'https://agent.brainonbnb.com/rug-watch' && fwd.init.method === 'POST' && fh['x-rug-watch-for'] === '4.4.4.4' && fh['x-hit-secret'] === 'hs' && JSON.parse(fwd.init.body).callback === 'https://hook.example/m');
  ok('… and answers with text and structuredContent', res.result?.structuredContent?.watch === 'id' && /rws_x/.test(res.result?.content?.[0]?.text || ''));

  const { shape } = await imp('dashboard/preflight.js');
  const s = { address: TOKEN, symbol: 'T', quotable: true, block: 1, measuredAt: 'now', pool: { address: '0x' + 'c'.repeat(40), kind: 'v2', venue: 'PancakeSwap', liquidityUsd: 40000 }, tradeCost: [{ sizeUsd: 100, buyCostPct: 0.3, sellCostPct: 0.4 }, { sizeUsd: 1000, buyCostPct: 1, sellCostPct: 1 }], onePercentDepth: { buyUsd: 5000, sellUsd: 5000 }, sellability: { ok: true, sellable: true, buyable: true }, tax: { buyPct: 0, sellPct: 0, measured: true, source: 'm' }, lp: { burnedPct: 99 }, contract: { openSource: true, properties: {} }, holders: { count: 10, wallets: 10, top10PctOfCirculating: 5, largestPct: 1, top: [] } };
  const kw = shape(s, null, 250).keep_watching;
  ok('the preflight names the rug watch next to the pool watch, with this token filled in', !!kw?.how && !!kw?.rug_watch && kw.rug_watch.how.includes(`"token":"${TOKEN}"`) && /rug-watch/.test(kw.rug_watch.how));

  const llms = fs.readFileSync(path.join(ROOT, 'dashboard/llms.txt'), 'utf8');
  const cat = await imp('worker-agent/catalog.js');
  ok('discovery: llms.txt and the catalogue name the rug watch', /agent\.brainonbnb\.com\/rug-watch/.test(llms) && /bsc_rug_watch/.test(llms) && Object.values(cat.CAPABILITIES).flat().some((c) => /rug-watch/.test(c.where || '')));
  const rugLine = llms.split('\n').find((l) => /^- Rug watch/.test(l)) || '';
  const rugCat = Object.values(cat.CAPABILITIES).flat().find((c) => /rug-watch/.test(c.where || ''))?.what || '';
  ok('… and both name fake volume, the pump and the dump after it, and the slow rug', [rugLine, rugCat].every((x) => /fake volume/.test(x) && /pump/.test(x) && /dump/.test(x) && /slow rug/.test(x)), rugLine.slice(0, 80));
  ok('… and the preflight\'s pointer too', /fake/.test(kw.rug_watch.what) && /slow rug/.test(kw.rug_watch.what) && /pump/.test(kw.rug_watch.what));
}

console.log(fails ? `\n${fails} FAILED (${passes} pass)` : `\nrug watch: all ${passes} pins hold`);
process.exit(fails ? 1 : 0);
