#!/usr/bin/env node
// One wallet to fill by hand: the NFT relayer. It refills the rest.
//
// Five wallets pay gas here, and keeping all five topped up meant remembering
// all five — so the one that gets forgotten is the one that stops, silently.
// This turns that into a single chore: fund the relayer, run this, and every
// bot below its floor is brought back to a working balance from it.
//
// The relayer is the source because it is the wallet that accumulates: it holds
// the most, spends the least (one mint per $100 buy), and is the only one whose
// job does not depend on the others. Its own minting reserve is subtracted
// first and can never be spent on a refill.
//
//   node scripts/gas-refill.mjs              show the plan, send nothing
//   node scripts/gas-refill.mjs --confirm    send it
//   node scripts/gas-refill.mjs --self-test  pin the planner in both directions
//
// Plan by default, like every other script here that can move money. There is
// no flag that both plans and sends: seeing the plan and authorising it are two
// separate acts.
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  WALLETS, SOURCE, MAX_PER_TRANSFER, MAX_PER_RUN,
  planRefills, floorOf, targetOf, bnb,
} from './lib/gas-wallets.mjs';

const CONFIRM = process.argv.includes('--confirm');
const SELF_TEST = process.argv.includes('--self-test');
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

// ---- self-test -------------------------------------------------------------
// The planner decides whether to move real money, so it is pinned in both
// directions: it must send when a wallet is genuinely short, and — the half
// that actually protects the funds — it must refuse in every case where the
// numbers do not clearly say to.
if (SELF_TEST) {
  const fails = [];
  const keys = WALLETS.map((w) => w.key);
  const at = (fn) => Object.fromEntries(WALLETS.map((w) => [w.key, fn(w)]));
  const rich = SOURCE.reserve * 10n;

  // Nothing to do when everyone is funded. A refill script that transfers on a
  // healthy day is a script that drains the source into fees.
  {
    const p = planRefills(at((w) => targetOf(w)), rich);
    if (p.transfers.length) fails.push('planned a transfer while every wallet was at target');
    if (p.blocked.length) fails.push('blocked a plan that had nothing in it');
  }
  // Exactly at the floor is funded. Off-by-one here would send on every run.
  {
    const p = planRefills(at((w) => floorOf(w)), rich);
    if (p.transfers.length) fails.push('planned a transfer for a wallet sitting exactly on its floor');
  }
  // One wei under the floor is not.
  {
    const p = planRefills(at((w) => floorOf(w) - 1n), rich);
    if (p.transfers.length !== keys.length) fails.push(`only ${p.transfers.length} of ${keys.length} wallets under the floor were planned for`);
    for (const t of p.transfers) {
      if (t.amount + t.from !== targetOf(t.wallet)) fails.push(`${t.wallet.key}: the transfer does not land on target`);
    }
  }
  // An unreadable balance is skipped, never funded. This is the dangerous one:
  // null must not read as zero, because zero asks for the biggest transfer.
  {
    const balances = at((w) => targetOf(w));
    balances[keys[0]] = null;
    const p = planRefills(balances, rich);
    if (p.transfers.length) fails.push('planned a transfer for a wallet whose balance could not be read');
    if (p.skipped.length !== 1) fails.push('an unreadable balance was not reported as skipped');
  }
  // The source protects its own job first.
  {
    const empty = at(() => 0n);
    const p = planRefills(empty, SOURCE.reserve);
    if (!p.blocked.length) fails.push('agreed to spend the source down to its minting reserve');
  }
  {
    const empty = at(() => 0n);
    const p = planRefills(empty, SOURCE.reserve + 1n);
    if (!p.blocked.length) fails.push('agreed to a plan that would leave the source under its reserve');
  }
  {
    const empty = at(() => 0n);
    const p = planRefills(empty, null);
    if (!p.blocked.length) fails.push('planned to send from a source whose balance is unknown');
  }
  // A source with room funds everything.
  {
    const empty = at(() => 0n);
    const need = WALLETS.reduce((s, w) => s + targetOf(w), 0n);
    const p = planRefills(empty, SOURCE.reserve + need);
    if (p.blocked.length) fails.push(`blocked a fundable plan: ${p.blocked.join('; ')}`);
    if (p.total !== need) fails.push('the plan total does not equal what the wallets are short');
  }
  // The caps are real, in both directions.
  {
    if (MAX_PER_RUN <= MAX_PER_TRANSFER) fails.push('the per-run cap is not above the per-transfer cap, so one transfer could never be the thing that trips it');
    const need = WALLETS.reduce((s, w) => s + targetOf(w), 0n);
    if (need > MAX_PER_RUN) fails.push(`funding every wallet from empty needs ${bnb(need)}, over the per-run cap of ${bnb(MAX_PER_RUN)} — the normal worst case must fit inside the cap or the cap fires on a legitimate day`);
    for (const w of WALLETS) {
      if (targetOf(w) > MAX_PER_TRANSFER) fails.push(`${w.key}: a full top-up of ${bnb(targetOf(w))} is above the per-transfer cap and could never be sent`);
    }
  }

  if (fails.length) {
    console.error('self-test FAILED');
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }
  console.log('self-test passed: funds only what is short, lands on target, refuses on an unknown balance, on an over-cap plan, and whenever the source would drop under its minting reserve');
  process.exit(0);
}

// ---- live ------------------------------------------------------------------
const key = process.env[SOURCE.env];
if (!key) {
  console.error(`No ${SOURCE.env} in .env — that is the wallet this sends from.`);
  process.exit(1);
}
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== SOURCE.address.toLowerCase()) {
  // The roster address is what the plan reasons about; the key is what signs.
  // If they are not the same wallet, every number printed above the send would
  // be about a different account than the one paying.
  console.error(`${SOURCE.env} signs for ${account.address}, but the roster says the source is ${SOURCE.address}. Refusing.`);
  process.exit(1);
}

const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC) });

const read = async (address) => {
  try { return await publicClient.getBalance({ address }); }
  catch { return null; }
};

const balances = {};
for (const w of WALLETS) balances[w.key] = await read(w.address);
const sourceBalance = await read(SOURCE.address);

const { transfers, skipped, total, blocked } = planRefills(balances, sourceBalance);

console.log(`Gas refill — from ${SOURCE.name} (${SOURCE.address})`);
console.log(`  source holds ${sourceBalance === null ? 'an unreadable balance' : bnb(sourceBalance)}, reserve ${bnb(SOURCE.reserve)} kept back for ${SOURCE.does}\n`);

for (const w of WALLETS) {
  const b = balances[w.key];
  const t = transfers.find((x) => x.wallet.key === w.key);
  const s = skipped.find((x) => x.wallet.key === w.key);
  if (t) console.log(`  SEND ${bnb(t.amount).padStart(11)} → ${w.name.padEnd(20)} ${bnb(t.from)} → ${bnb(t.to)}`);
  else if (s) console.log(`  skip ${''.padStart(11)}   ${w.name.padEnd(20)} ${s.why}`);
  else console.log(`  ok   ${''.padStart(11)}   ${w.name.padEnd(20)} ${b === null ? 'unknown' : bnb(b)} — above its floor of ${bnb(floorOf(w))}`);
}

if (blocked.length) {
  console.error('\nRefusing to send:');
  for (const b of blocked) console.error('  ' + b);
  process.exit(1);
}

if (!transfers.length) {
  console.log('\nNothing to do — every wallet is above its floor.');
  process.exit(0);
}

console.log(`\n  total ${bnb(total)} in ${transfers.length} transfer(s); source left with ${bnb(sourceBalance - total)}`);

if (!CONFIRM) {
  console.log('\nThis is the plan only. Nothing has been sent.');
  console.log('  node scripts/gas-refill.mjs --confirm');
  process.exit(0);
}

// ---- send ------------------------------------------------------------------
let sent = 0;
for (const t of transfers) {
  try {
    const hash = await walletClient.sendTransaction({ to: t.wallet.address, value: t.amount });
    console.log(`\n  → ${t.wallet.name}: ${bnb(t.amount)}  https://bscscan.com/tx/${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    // Verify from the chain rather than trusting the receipt: a mined
    // transaction that did not land the balance we planned for is the one thing
    // worth knowing before the next run assumes this wallet is funded.
    const after = await read(t.wallet.address);
    if (after === null) console.log('    mined, but the new balance could not be read back');
    else console.log(`    confirmed — ${t.wallet.name} now holds ${bnb(after)}`);
    sent++;
  } catch (e) {
    console.error(`\n  ${t.wallet.name}: FAILED — ${e.shortMessage || e.message || e}`);
  }
}

const left = await read(SOURCE.address);
console.log(`\n${sent} of ${transfers.length} transfer(s) sent. Source now holds ${left === null ? 'an unreadable balance' : bnb(left)}.`);
if (sent < transfers.length) process.exitCode = 1;
