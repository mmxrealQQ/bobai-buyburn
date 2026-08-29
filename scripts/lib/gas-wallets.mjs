// The wallets that need gas to do their job, and how much is "enough".
//
// WHY THIS EXISTS
// Nothing in this project checked whether a bot could still pay for a
// transaction. That is the failure mode that hides best: a wallet at zero does
// not throw, it simply stops producing transactions, and a bot that has burned
// nothing for a day looks exactly like a market with no volume. The provider
// wallet is the sharpest case — an ERC-8183 job that cannot be delivered
// on-chain fails silently on our side and reads as an unreliable provider on
// theirs.
//
// WHERE THE THRESHOLDS COME FROM
// They are derived, not chosen. Each wallet declares the gas one full cycle of
// its work costs, taken from the gas limits in the code that spends it, and the
// thresholds are that cycle priced at PLANNING_GAS_PRICE.
//
// BSC settled at 0.05 gwei — one 500k-gas transaction costs 0.000025 BNB. That
// is the wrong number to plan with: a wallet stocked for today's price is
// stranded by a busy hour. PLANNING_GAS_PRICE is 1 gwei, twenty times the
// current floor and the price BSC charged for years, so a spike costs headroom
// rather than uptime.
//
// The liquidity wallet's floor is the number this project already used before
// this file existed — 0.0015 BNB, the figure the liquidity-add runbook checks
// against. It is reproduced here by the same rule that sets every other floor
// (one full cycle at the planning price), rather than restated as a constant,
// so the rule and the established number agree instead of competing.
//
// A NOTE ON WHAT IS NOT HERE
// Only *_PRIVATE_KEY entries in .env are wallets. HIT_SECRET and
// BROADCAST_SECRET are also 64 hex characters and are NOT keys — anything that
// discovers wallets by scanning .env for hex will treat a secret as an account.
// This roster is written out by hand for that reason.

import { formatEther, parseEther } from 'viem';

// 1 gwei, as wei. Deliberately above the live price; see above.
export const PLANNING_GAS_PRICE = 1_000_000_000n;

const cost = (gasUnits) => PLANNING_GAS_PRICE * BigInt(gasUnits);

export const WALLETS = [
  {
    key: 'liquidity',
    name: 'creator / liquidity',
    env: 'PRIVATE_KEY',
    address: '0x15Ba17075ef5E0736292b030e3715d9100fe3d38',
    // One liquidity-add run: swap (500k) + approve (100k) + addLiquidity (500k)
    // + LP burn transfer (100k), plus room. Matches the 0.0015 BNB floor the
    // liquidity runbook already checks before a run.
    cycleGas: 1_500_000,
    floorCycles: 1,
    targetCycles: 4,
    does: 'liquidity adds and the LP burn that follows them',
  },
  {
    key: 'buyback',
    name: 'buyback bot',
    env: 'BUYBACK_PRIVATE_KEY',
    address: '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',
    // A tax cycle: unwrap (100k) + swap (500k) + burn (300k) + the transfers
    // that split the rest (3 × 100k). Runs every ten minutes, so an empty
    // wallet here stops the flywheel that the whole token is built on.
    cycleGas: 1_400_000,
    floorCycles: 1,
    targetCycles: 4,
    does: 'the 24/7 buyback-and-burn cycle',
  },
  {
    key: 'provider',
    name: 'agent provider',
    env: 'AGENT_PROVIDER_PRIVATE_KEY',
    address: '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963',
    // One ERC-8183 deliverable: a single submitResult transaction. Cheap, but
    // the failure is the most expensive one we have — a job accepted and never
    // delivered is a reputation loss on a public registry. Hence four cycles of
    // floor instead of one: this wallet gets warned about early.
    cycleGas: 250_000,
    floorCycles: 4,
    targetCycles: 16,
    does: 'delivering hired jobs on-chain (ERC-8183)',
  },
  {
    key: 'x402',
    name: 'x402 service',
    env: 'X402_PRIVATE_KEY',
    address: '0x690E950214980BC329823A2DB2fD90C06Bd54dE4',
    // Settles paid agent requests. Same shape as the provider: rare, small, and
    // a failure that a paying caller sees.
    cycleGas: 250_000,
    floorCycles: 4,
    targetCycles: 16,
    does: 'settling paid agent requests',
  },
];

// The wallet the refills come from. It is not a spare purse: it mints the buy
// NFTs, so it has to keep enough to do that after every transfer it makes.
export const SOURCE = {
  key: 'relayer',
  name: 'NFT relayer / minter',
  env: 'NFT_RELAYER_PRIVATE_KEY',
  address: '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2',
  // One mintTo() is roughly 200k gas. The reserve is a hundred of them at the
  // planning price — enough that funding every other wallet to target can never
  // cost the collection a mint.
  cycleGas: 200_000,
  reserve: cost(200_000) * 100n,
  does: 'minting the buy-drop NFTs',
};

// Wallets deliberately NOT refilled, listed so the omission is a decision on
// the record rather than an oversight:
//   0x5E4102520A71B2AA18a1208330d4848dea4BD105  WC26 prize pool — paid out
//     2026-07-20 and frozen. It should not receive anything again.
//   0xEAC21928DE023677A25eb925D1cb1b0786FaF946  ecosystem buyback — zero
//     balance, zero transactions ever. Nothing runs on it (databrain was shut
//     down), so funding it would be funding an idea, not a bot.
export const NOT_REFILLED = [
  { address: '0x5E4102520A71B2AA18a1208330d4848dea4BD105', why: 'WC26 prize pool, frozen since the payout' },
  { address: '0xEAC21928DE023677A25eb925D1cb1b0786FaF946', why: 'ecosystem buyback, never used' },
];

// Safety rails on the sending script. A gas top-up is a small, boring transfer;
// anything that asks to move more than this is a bug in the plan, not a busy
// day, and it should stop rather than proceed.
export const MAX_PER_TRANSFER = parseEther('0.01');
export const MAX_PER_RUN = parseEther('0.03');

export const floorOf = (w) => cost(w.cycleGas) * BigInt(w.floorCycles);
export const targetOf = (w) => cost(w.cycleGas) * BigInt(w.targetCycles);
export const cyclesLeft = (w, balance) => Number(balance / cost(w.cycleGas));

// Balance may legitimately be unknown — an RPC can fail. Unknown must never
// collapse into zero: a wallet whose balance did not read looks empty, and an
// empty wallet is exactly what triggers the largest top-up. Every consumer of
// this module has to handle `null` as its own state.
export function assess(w, balance) {
  if (balance === null || balance === undefined) {
    return { state: 'unknown', short: null, cycles: null };
  }
  const floor = floorOf(w);
  const target = targetOf(w);
  if (balance >= floor) return { state: 'ok', short: 0n, cycles: cyclesLeft(w, balance) };
  return { state: 'low', short: target - balance, cycles: cyclesLeft(w, balance) };
}

export const bnb = (v) => `${Number(formatEther(v)).toFixed(5)} BNB`;

// What to send, given balances that have already been read. Pure on purpose:
// the decision to move money is the part worth testing without a network, and a
// planner that needs a live chain to be exercised is a planner that only gets
// exercised in production.
//
// `balances` maps wallet key -> bigint or null. `sourceBalance` may be null too.
// Every refusal is returned as a reason rather than thrown, so the caller can
// print the whole picture instead of the first problem it hit.
export function planRefills(balances, sourceBalance) {
  const transfers = [];
  const skipped = [];

  for (const w of WALLETS) {
    const balance = balances[w.key] ?? null;
    const a = assess(w, balance);
    if (a.state === 'unknown') {
      // The one case that must never become a transfer. An unread balance looks
      // identical to an empty wallet, and an empty wallet asks for the largest
      // top-up on the list.
      skipped.push({ wallet: w, why: 'balance could not be read — skipped, not topped up' });
      continue;
    }
    if (a.state === 'ok') continue;
    if (a.short > MAX_PER_TRANSFER) {
      skipped.push({ wallet: w, why: `top-up of ${bnb(a.short)} exceeds the ${bnb(MAX_PER_TRANSFER)} per-transfer cap — refusing rather than sending it` });
      continue;
    }
    transfers.push({ wallet: w, amount: a.short, from: balance, to: targetOf(w) });
  }

  const total = transfers.reduce((s, t) => s + t.amount, 0n);
  const blocked = [];

  if (sourceBalance === null) {
    blocked.push('the source wallet balance could not be read — nothing is sent on an unknown balance');
  } else if (sourceBalance < SOURCE.reserve) {
    blocked.push(`the source holds ${bnb(sourceBalance)}, at or below its own ${bnb(SOURCE.reserve)} reserve — it needs that to keep minting`);
  } else if (sourceBalance - total < SOURCE.reserve) {
    blocked.push(`sending ${bnb(total)} would leave the source under its ${bnb(SOURCE.reserve)} minting reserve`);
  }
  if (total > MAX_PER_RUN) {
    blocked.push(`the plan totals ${bnb(total)}, over the ${bnb(MAX_PER_RUN)} cap for one run`);
  }

  return { transfers, skipped, total, blocked };
}
