#!/usr/bin/env node
// Can every bot still pay for a transaction?
//
// This is the check that did not exist. Every other kind of failure in this
// project announces itself — a worker throws, an endpoint 500s, a test goes
// red. A wallet running out of gas announces nothing at all: the bot keeps
// waking up on its cron, keeps reading the chain, and simply stops producing
// transactions. From the outside that is indistinguishable from a quiet market,
// which is why the liquidity runbook has a hand-checked gas line in it and the
// provider wallet sat at five deliverables' worth of BNB for a week.
//
// Reads only. It reports how many more full work cycles each wallet can pay
// for, which is a more useful number than a balance: 0.0008 BNB means nothing,
// "three more deliverables" means something.
//
//   node scripts/gas-check.mjs
//   node scripts/gas-check.mjs --self-test    pin the thresholds in both directions
//   node scripts/gas-check.mjs --json         machine-readable, for other checks
//
// Exit code is 1 when a wallet is below its floor or could not be read, so this
// can gate a deploy. An unreadable balance is a failure, never an "ok" — see
// the self-test.
import { createPublicClient, http, parseEther } from 'viem';
import { bsc } from 'viem/chains';
import {
  WALLETS, SOURCE, NOT_REFILLED, PLANNING_GAS_PRICE,
  assess, floorOf, targetOf, bnb,
} from './lib/gas-wallets.mjs';

const SELF_TEST = process.argv.includes('--self-test');
const AS_JSON = process.argv.includes('--json');

// Explicit URL on purpose: viem's default transport for a chain is not this
// project's RPC, and a check that silently reads a different node than the bots
// do is measuring the wrong thing.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

// ---- self-test -------------------------------------------------------------
// Pinned in BOTH directions. A threshold check that only proves it fires is
// half a test: the half that matters on a normal day is that it stays quiet.
if (SELF_TEST) {
  const fails = [];
  const w = WALLETS.find((x) => x.key === 'liquidity');
  const floor = floorOf(w);
  const target = targetOf(w);

  // Fires when it should.
  if (assess(w, floor - 1n).state !== 'low') fails.push('a balance one wei under the floor did not read as low');
  if (assess(w, 0n).state !== 'low') fails.push('an empty wallet did not read as low');

  // Stays quiet when it should. This is the direction that gets skipped.
  if (assess(w, floor).state !== 'ok') fails.push('a balance exactly at the floor was called low — the floor is a minimum, not an exclusive bound');
  if (assess(w, floor + 1n).state !== 'ok') fails.push('a balance above the floor was called low');
  if (assess(w, target * 10n).state !== 'ok') fails.push('a well-funded wallet was called low');

  // The established number this project already used has to survive the rule
  // that replaced it. If someone retunes cycleGas or the planning price, this
  // is what says so out loud instead of quietly moving the runbook's floor.
  if (floor !== parseEther('0.0015')) {
    fails.push(`the liquidity floor is ${bnb(floor)}, but the liquidity runbook checks against 0.0015 BNB — one of the two moved`);
  }

  // Unknown is its own state and must never behave like zero. A failed RPC read
  // that collapses to 0 would report a healthy wallet as empty and, in the
  // refill script next door, ask to send it a full top-up.
  const unknown = assess(w, null);
  if (unknown.state !== 'unknown') fails.push('an unreadable balance did not report as unknown');
  if (unknown.short !== null) fails.push('an unreadable balance produced a top-up amount — silence must not be spendable');

  // The top-up is to target, not to floor. Topping up to the floor would put
  // the wallet one transaction away from being low again, and this script would
  // ask for another transfer on its next run.
  const shortAtZero = assess(w, 0n).short;
  if (shortAtZero !== target) fails.push(`an empty wallet asks for ${bnb(shortAtZero)}, expected the full target ${bnb(target)}`);

  // Every roster entry has to be complete, or a wallet is silently unwatched.
  for (const x of [...WALLETS, SOURCE]) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(x.address)) fails.push(`${x.key}: address is not an address`);
    if (!x.env) fails.push(`${x.key}: no env var named — the refill script could not sign for it`);
  }
  // A wallet that is both refilled and excluded would be a contradiction.
  for (const x of NOT_REFILLED) {
    if (WALLETS.some((r) => r.address.toLowerCase() === x.address.toLowerCase())) {
      fails.push(`${x.address} is on the refill roster and on the excluded list at the same time`);
    }
  }

  if (fails.length) {
    console.error('self-test FAILED');
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }
  console.log(`self-test passed: ${WALLETS.length} wallets rostered, thresholds fire below the floor and stay quiet at or above it, unknown never reads as empty`);
  process.exit(0);
}

// ---- live ------------------------------------------------------------------
const client = createPublicClient({ chain: bsc, transport: http(RPC) });

const read = async (address) => {
  try { return await client.getBalance({ address }); }
  catch { return null; }   // unknown, not zero
};

const rows = [];
for (const w of [...WALLETS, SOURCE]) {
  const balance = await read(w.address);
  const isSource = w === SOURCE;
  const a = isSource ? null : assess(w, balance);
  rows.push({ w, balance, a, isSource });
}

if (AS_JSON) {
  console.log(JSON.stringify({
    measured_at: new Date().toISOString(),
    planning_gas_price_gwei: Number(PLANNING_GAS_PRICE) / 1e9,
    wallets: rows.map(({ w, balance, a, isSource }) => ({
      key: w.key,
      name: w.name,
      address: w.address,
      balance_bnb: balance === null ? null : Number(balance) / 1e18,
      state: isSource ? (balance === null ? 'unknown' : (balance >= SOURCE.reserve ? 'ok' : 'low')) : a.state,
      cycles_left: isSource ? null : a?.cycles,
      does: w.does,
    })),
  }, null, 2));
} else {
  console.log(`Gas — can each bot still pay? (thresholds priced at ${Number(PLANNING_GAS_PRICE) / 1e9} gwei, BSC is currently far below that)\n`);
  for (const { w, balance, a, isSource } of rows) {
    if (isSource) continue;
    const mark = a.state === 'ok' ? 'ok  ' : a.state === 'low' ? 'LOW ' : '????';
    const left = a.cycles === null ? 'balance unreadable' : `${a.cycles} more ${a.cycles === 1 ? 'cycle' : 'cycles'} of ${w.does}`;
    const need = a.state === 'low' ? `  → needs ${bnb(a.short)} to reach target` : '';
    console.log(`  ${mark} ${w.name.padEnd(20)} ${balance === null ? '   unknown' : bnb(balance).padStart(11)}   ${left}${need}`);
  }
  const src = rows.find((r) => r.isSource);
  const srcState = src.balance === null ? 'unreadable' : src.balance >= SOURCE.reserve ? 'ok' : 'BELOW RESERVE';
  console.log(`\n  source: ${SOURCE.name} ${src.balance === null ? 'unknown' : bnb(src.balance)} — ${srcState} (reserve ${bnb(SOURCE.reserve)} for ${SOURCE.does})`);
  const low = rows.filter((r) => !r.isSource && r.a.state === 'low');
  if (low.length) {
    const total = low.reduce((s, r) => s + r.a.short, 0n);
    console.log(`\n  ${low.length} wallet(s) below floor, ${bnb(total)} short in total.`);
    console.log('  node scripts/gas-refill.mjs            shows the plan');
    console.log('  node scripts/gas-refill.mjs --confirm  sends it');
  } else {
    console.log('\n  every wallet is above its floor.');
  }
}

const bad = rows.filter(({ a, isSource, balance }) =>
  isSource ? (balance === null || balance < SOURCE.reserve) : a.state !== 'ok');
if (bad.length) process.exitCode = 1;
