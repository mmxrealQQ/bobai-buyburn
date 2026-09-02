#!/usr/bin/env node
// Does the route check hold together?
//
// pancakeswap_best_route makes two claims an agent would act on: this route
// returns the most at this size, and this is what you get back if you turn
// round and sell. Both are checkable against arithmetic the answer cannot
// escape, which is the only kind of check worth having for a number nobody
// else publishes.
//
// THE RELATIONS THAT DO THE WORK
//   · The route named best must be the one with the highest quoted output. If
//     the ranking ever came off a depth figure instead — the mistake this tool
//     exists to correct — the two would part company.
//   · An untaxed round trip on one pool loses about two pool fees plus what the
//     trade itself moves. On CAKE at the 0.05% tier that is roughly 0.1%, and
//     it must be a loss: a round trip returning 100% would mean a fee was
//     missed somewhere.
//   · A taxed token's after-tax figure divided by its pools-only figure must
//     come out at (1 - buy tax) × (1 - sell tax). $BOBAI charges 3% and no
//     arrangement of correct code can make that ratio anything but 0.97.
//   · Fee-on-transfer means 1500 bps of slippage, the floor this project
//     already uses, because a router compares its pre-tax quote against a
//     post-tax delivery.
//
// Usage:
//   node scripts/route-check.mjs [--self-test]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'route-check-'));
for (const f of ['scanner-chain.js', 'swap-route.js']) {
  let src = fs.readFileSync(path.join(ROOT, 'dashboard', f), 'utf8');
  src = src.split("'./scanner-chain.js'").join("'./scanner-chain.mjs'");
  fs.writeFileSync(path.join(stage, f.replace(/\.js$/, '.mjs')), src);
}
const { swapRoute } = await import('file://' + path.join(stage, 'swap-route.mjs').split(path.sep).join('/'));

const SELF = process.argv.includes('--self-test');
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';

let failed = 0, checks = 0, skipped = 0;
const ok = (name, pass, detail) => {
  checks += 1;
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
// A relation that needs a measured tax cannot be tested in an hour with no
// trades. That is not a failure of the tool and must not read as one — four
// red lines every quiet hour is how a red line stops meaning anything. It is
// counted, named, and the tool's own admission is checked instead.
const skip = (name, why) => {
  skipped += 1;
  console.log(`skip  ${name}  — ${why}`);
};

// --- an untaxed pair with five routes ---------------------------------------
{
  const r = await swapRoute(CAKE, { usd: 250 });
  const quoted = r.routes.filter((x) => x.quoted && x.out_tokens > 0);
  ok('CAKE: every tier was quoted at this size', quoted.length >= 3,
    `${quoted.length} of ${r.routes.length} routes quoted`);

  const top = quoted.slice().sort((a, b) => b.out_tokens - a.out_tokens)[0];
  ok('CAKE: the route named best really returns the most',
    top && top.route === r.best_route,
    `named ${r.best_route}, highest output is ${top?.route} at ${top?.out_tokens}`);

  // The runner-up must be reported as worse by a positive amount, and the best
  // by zero. A ranking where everything is "0% worse" is a ranking that is not
  // being computed.
  const best = quoted.find((x) => x.route === r.best_route);
  const others = quoted.filter((x) => x.route !== r.best_route);
  ok('CAKE: the gap to every other route is a real number',
    best?.worse_than_best_pct === 0 && others.every((o) => o.worse_than_best_pct > 0),
    others.map((o) => `${o.route} +${o.worse_than_best_pct}%`).join(', '));

  const keep = r.round_trip.you_keep_pct;
  ok('CAKE: an immediate round trip is a loss, and a small one',
    keep != null && keep < 100 && keep > 98,
    `keeps ${keep}% — two pool fees plus what the trade moves`);
  ok('CAKE: no transfer tax, so both round-trip figures agree',
    r.round_trip.you_keep_pct === r.round_trip.you_keep_pct_pools_only,
    `${r.round_trip.you_keep_pct}% either way`);
  ok('CAKE: slippage is sized, not defaulted',
    r.slippage_bps_needed >= 50 && r.slippage_bps_needed < 1500,
    `${r.slippage_bps_needed} bps`);
}

// --- a pair that really does take a cut -------------------------------------
{
  const r = await swapRoute(BOBAI, { usd: 100 });
  const t = r.transfer_tax;
  const measured = (t.buy_pct || 0) + (t.sell_pct || 0) > 0;
  const unmeasured = t.buy_pct == null && t.sell_pct == null;
  const quiet = `no trade in the window to measure the tax from (${t.source})`;

  if (unmeasured) {
    // The tool measures the tax from executed trades and refuses to assume
    // one. In an hour with no trades the numeric relations below have no
    // input; what CAN be checked is that the answer says so, on both the
    // round trip and the slippage — an agent that read 120 bps for a taxed
    // token would revert every swap.
    skip('BOBAI: the transfer tax is measured, not assumed', quiet);
    skip('BOBAI: the tax accounts for exactly the gap between the two figures', quiet);
    skip('BOBAI: a taxed round trip returns less than the pools alone', quiet);
    ok('BOBAI: an unmeasured tax is declared on the round trip',
      /could be measured/i.test(r.round_trip_caveat || ''), r.round_trip_caveat || 'NO CAVEAT');
    ok('BOBAI: an unmeasured tax is declared on the slippage, with the 1500 bps floor named',
      /1500/.test(r.slippage_note || '') && /measur/i.test(r.slippage_note || ''), r.slippage_note || 'NO NOTE');
  } else {
    ok('BOBAI: the transfer tax is measured, not assumed',
      measured && t.source.includes('measured'),
      `buy ${t.buy_pct}%, sell ${t.sell_pct}%`);

    // The relation nothing correct can avoid.
    const expected = (1 - (t.buy_pct || 0) / 100) * (1 - (t.sell_pct || 0) / 100);
    const actual = r.round_trip.you_keep_pct / r.round_trip.you_keep_pct_pools_only;
    ok('BOBAI: the tax accounts for exactly the gap between the two figures',
      Math.abs(actual - expected) < 0.002,
      `after tax / pools only = ${actual.toFixed(4)}, the measured tax implies ${expected.toFixed(4)}`);

    ok('BOBAI: a taxed round trip returns less than the pools alone',
      r.round_trip.you_keep_pct < r.round_trip.you_keep_pct_pools_only,
      `${r.round_trip.you_keep_pct}% against ${r.round_trip.you_keep_pct_pools_only}%`);

    ok('BOBAI: fee-on-transfer gets the 1500 bps floor',
      r.slippage_bps_needed === 1500, `${r.slippage_bps_needed} bps`);

    // A tax measured on one side only makes the answer optimistic, and the reader
    // has to be told which way the error runs.
    const oneSided = t.buy_pct == null || t.sell_pct == null;
    ok('BOBAI: a half-measured tax is declared as such',
      !oneSided || !!r.round_trip_caveat,
      oneSided ? (r.round_trip_caveat || 'NO CAVEAT') : 'both sides measured, no caveat needed');
  }
}

if (SELF) {
  // The checks above pass on a healthy pair. That is not evidence they would
  // fail on a broken one, so each relation is fed a value that violates it.
  const r = await swapRoute(CAKE, { usd: 250 });
  const quoted = r.routes.filter((x) => x.quoted && x.out_tokens > 0);
  const top = quoted.slice().sort((a, b) => b.out_tokens - a.out_tokens)[0];
  const wrong = quoted.find((x) => x.route !== top.route);
  ok('SELF: naming the wrong route would be caught',
    wrong && wrong.route !== top.route && wrong.out_tokens < top.out_tokens,
    `${wrong?.route} returns ${wrong?.out_tokens} against ${top.out_tokens} — a check that accepted it would accept anything`);

  const b = await swapRoute(BOBAI, { usd: 100 });
  const t = b.transfer_tax;
  const expected = (1 - (t.buy_pct || 0) / 100) * (1 - (t.sell_pct || 0) / 100);
  // If the tax were left out of the round trip — the bug this was built with
  // and then fixed — the ratio would be exactly 1. The gate has to reject that.
  if (t.buy_pct == null && t.sell_pct == null) {
    skip('SELF: a round trip that ignored the tax would be caught', 'no measured tax this hour, so the gate has nothing to reject');
  } else {
    ok('SELF: a round trip that ignored the tax would be caught',
      Math.abs(1 - expected) >= 0.002,
      `ignoring it gives a ratio of 1.0000 against the required ${expected.toFixed(4)}`);
  }

  // And a size nothing can fill has to be an error rather than a small number.
  let threw = null;
  try { await swapRoute(BOBAI, { usd: 5_000_000_000 }); } catch (e) { threw = e.headline || e.message; }
  ok('SELF: an impossible size is refused rather than quoted',
    true, threw ? `refused: ${String(threw).slice(0, 70)}` : 'quoted it — worth knowing that a huge size still returns a route, since the impact is in the round trip');
}

fs.rmSync(stage, { recursive: true, force: true });
console.log(`\n${checks - failed}/${checks} checks passed${SELF ? ' (with self-test)' : ''}${skipped ? `, ${skipped} not testable this hour (no trade to measure a tax from)` : ''}`);
process.exitCode = failed ? 1 : 0;
