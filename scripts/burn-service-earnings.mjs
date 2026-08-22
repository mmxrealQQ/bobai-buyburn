// Step 3 of the money flow: turn what the agent service earned into a $BOBAI
// burn, from the service wallet, exactly as agent.brainonbnb.com/stats says.
//
// WHAT THE PAGE PROMISES, and this script keeps
//   2. "it lands at 0x690E...4dE4 - a wallet used for nothing else"
//   3. "from there it buys $BOBAI and burns it, the same thing the buyback bot
//       does with the trade tax"
//   4. "every step is a public transaction, verifiable on BscScan"
// So the buy happens FROM the service wallet, not by routing the money through
// the buyback wallet first. Two reasons that matters. The buyback worker only
// acts above 0.004 BNB and would sit on this amount forever, and it splits what
// it spends between creator, $BOB and $BOBAI - the page promises this earning
// is burned, not split.
//
// WHY NOT AUTOMATED
// Because the page says it is not, and the honest order is: do it by hand while
// the amounts are small, automate when the volume argues for it, change the
// line on the page in the same breath. Not the reverse.
//
// WHAT IT DOES, in order
//   1. Reads the USD1 sitting on the service wallet. Spends that, never a
//      hardcoded figure - the wallet is the source of truth for what was earned.
//   2. Quotes USD1 -> WBNB -> BOBAI and checks the quote against Chainlink.
//   3. Approves exactly that amount, swaps with the fee-on-transfer method.
//   4. Burns every BOBAI received to the dead address.
//   5. Measures the dead address before and after, so the burned figure is what
//      the chain says arrived, not what we hoped to send.
//   6. Writes burn-entry.json as a local record of the run.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not append to burns.json. That log is the buyback bot's own record -
// the runs the wallet at 0xdeFC...01ce made on its own, unattended. A burn a
// human triggered from a laptop does not belong in it, and putting one there
// once made bot_burn_runs_total say 348 when the bot had run 347 times. The
// burn is public either way: it is a transaction on BscScan, and /stats links
// to it.
//
// SAFETY - a bare run changes nothing
//   Does nothing without --confirm. A bare run prints the plan and exits.
//   Refuses on an empty balance, on more than MAX_USD1 (this is the small-
//     amounts path; a larger balance deserves a human deciding again), on too
//     little gas, on a stale or implausible Chainlink answer, and on a quote
//     whose implied USD1 price is outside 0.90-1.10.
//   None of those refusals can be provoked on a healthy wallet, which is
//     exactly why they need --self-test: a guard nobody has ever seen fire is
//     a guess. It feeds synthetic states through the same function the real
//     run uses and checks each one is refused for the right reason.
//
// Usage:
//   node scripts/burn-service-earnings.mjs             # show the plan
//   node scripts/burn-service-earnings.mjs --self-test # prove the guards fire
//   node scripts/burn-service-earnings.mjs --confirm   # buy and burn
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createWalletClient, createPublicClient, http, formatUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // PancakeSwap V2
const DEAD = '0x000000000000000000000000000000000000dEaD';
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'; // BSC mainnet feed, 8 decimals

const MAX_USD1 = 5;           // above this, a human decides again
const MIN_GAS = 0.0004;       // BNB the service wallet needs for approve+swap+burn
const SLIPPAGE_BPS = 1500n;   // 15% - $BOBAI takes 3% on transfer, so the router
                              // always receives less than it quoted; anything
                              // tighter reverts on a fee-on-transfer token.
const MAX_FEED_AGE_S = 3600;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const ROUTER_ABI = [
  { name: 'getAmountsOut', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'swapExactTokensForTokensSupportingFeeOnTransferTokens', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [] },
];
const FEED_ABI = [{
  name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
  outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
}];

const confirm = process.argv.includes('--confirm');

// A refusal throws rather than calling process.exit: an abrupt exit while an
// RPC socket is still open trips a libuv assertion on Windows, which turns a
// clean "no" into a crash report.
class Refused extends Error {}
function die(msg) { throw new Refused(msg); }

const n = (v, d = 18) => Number(formatUnits(v, d));
const fmt = (v, d = 18) => n(v, d).toLocaleString('en-US', { maximumFractionDigits: 6 });

// Every refusal lives here, as one pure function over plain numbers, so the
// self-test can exercise the same code the real run does. A guard reimplemented
// in a test is a test of the reimplementation.
function refusalFor({ usd1, gasBnb, bnbUsd, feedAgeS, impliedUsd1 }) {
  if (usd1 === 0) return 'The service wallet holds no USD1 - nothing earned, nothing to burn.';
  if (usd1 > MAX_USD1) return `${usd1} USD1 is more than the ${MAX_USD1} this small-amounts path is for. Decide deliberately.`;
  if (gasBnb < MIN_GAS) return `Service wallet has ${gasBnb} BNB - under ${MIN_GAS} it cannot pay for approve + swap + burn. Run scripts/fund-service-wallet.mjs first.`;
  if (feedAgeS > MAX_FEED_AGE_S) return `Chainlink BNB/USD is ${Math.round(feedAgeS / 60)} min old - that is not a live price.`;
  if (bnbUsd < 100 || bnbUsd > 5000) return `Chainlink reports BNB at $${bnbUsd} - outside the plausible range, not trusting it.`;
  // Only checked once a quote exists; the plan stage passes it as null.
  if (impliedUsd1 !== null && (impliedUsd1 < 0.9 || impliedUsd1 > 1.1)) return `The route prices USD1 at $${impliedUsd1.toFixed(4)} - outside 0.90-1.10, refusing.`;
  return null;
}

const HEALTHY = { usd1: 0.5, gasBnb: 0.0029, bnbUsd: 700, feedAgeS: 20, impliedUsd1: 1.0 };

function selfTest() {
  const cases = [
    ['a healthy wallet is not refused', {}, null],
    ['empty balance', { usd1: 0 }, 'nothing earned'],
    ['balance above the small-amounts ceiling', { usd1: 6 }, 'Decide deliberately'],
    ['not enough gas for three transactions', { gasBnb: 0.0001 }, 'cannot pay for approve'],
    ['a stale Chainlink answer', { feedAgeS: 7200 }, 'not a live price'],
    ['an absurd BNB price', { bnbUsd: 12 }, 'not trusting it'],
    ['USD1 quoted far under a dollar', { impliedUsd1: 0.4 }, 'outside 0.90-1.10'],
    ['USD1 quoted far over a dollar', { impliedUsd1: 2.5 }, 'outside 0.90-1.10'],
  ];
  let failed = 0;
  for (const [name, patch, expect] of cases) {
    const got = refusalFor({ ...HEALTHY, ...patch });
    const pass = expect === null ? got === null : (got !== null && got.includes(expect));
    if (!pass) failed++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${pass ? '' : `\n          expected ${expect === null ? 'no refusal' : `"${expect}"`}, got ${got === null ? 'no refusal' : `"${got}"`}`}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} guards behave as written`);
  if (failed) process.exitCode = 1;
}

(async () => {
  if (process.argv.includes('--self-test')) return selfTest();

  const pk = process.env.X402_PRIVATE_KEY;
  if (!pk) die('No X402_PRIVATE_KEY in .env');
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const path = [USD1, WBNB, BOBAI];

  const [usd1Balance, gasBalance, feed] = await Promise.all([
    publicClient.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: CHAINLINK_BNB_USD, abi: FEED_ABI, functionName: 'latestRoundData' }),
  ]);

  const bnbUsd = Number(feed[1]) / 1e8;
  const feedAgeS = Math.floor(Date.now() / 1000) - Number(feed[3]);
  const state = { usd1: n(usd1Balance), gasBnb: n(gasBalance), bnbUsd, feedAgeS, impliedUsd1: null };

  // Checked before the quote: no reason to ask the router about a wallet we
  // are not going to trade from anyway.
  const early = refusalFor(state);
  if (early) die(early);

  const amounts = await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [usd1Balance, path] });
  const [, wbnbLeg, bobaiOut] = amounts;

  // The route says how much BNB our USD1 is worth; Chainlink says how much a BNB
  // is worth in dollars. Multiply and we have the pool's opinion of the USD1
  // price. If that is not roughly a dollar, something is wrong with the route,
  // the feed, or the pool - and none of those is a thing to trade through.
  const impliedUsd1 = (n(wbnbLeg) * bnbUsd) / n(usd1Balance);
  const late = refusalFor({ ...state, impliedUsd1 });
  if (late) die(late);

  const minOut = (bobaiOut * (10000n - SLIPPAGE_BPS)) / 10000n;

  console.log('\nBurn the agent service earnings');
  console.log('-------------------------------');
  console.log(`  service wallet   ${account.address}`);
  console.log(`  earned           ${fmt(usd1Balance)} USD1`);
  console.log(`  route            USD1 -> WBNB -> BOBAI   (${fmt(wbnbLeg)} BNB leg)`);
  console.log(`  BNB/USD          $${bnbUsd.toFixed(2)}   (${feedAgeS}s old)  -> USD1 priced at $${impliedUsd1.toFixed(4)}`);
  console.log(`  quote            ${fmt(bobaiOut)} BOBAI   (before the 3% transfer tax)`);
  console.log(`  accept at least  ${fmt(minOut)} BOBAI   (${Number(SLIPPAGE_BPS) / 100}% slippage)`);
  console.log(`  then             transfer every BOBAI received to ${DEAD}`);
  console.log(`  gas available    ${formatEther(gasBalance)} BNB`);

  if (!confirm) {
    console.log('\nNothing sent. Re-run with --confirm to buy and burn.');
    return;
  }

  const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC) });
  const wait = (hash) => publicClient.waitForTransactionReceipt({ hash });

  // Approve exactly the amount being spent. An unlimited approval on a wallet
  // that will keep receiving payments is a standing invitation.
  console.log('\n1/3 approving...');
  const approveTx = await walletClient.writeContract({ address: USD1, abi: ERC20_ABI, functionName: 'approve', args: [ROUTER, usd1Balance] });
  if ((await wait(approveTx)).status !== 'success') die(`Approve reverted: ${approveTx}`);
  console.log(`    https://bscscan.com/tx/${approveTx}`);

  console.log('2/3 swapping...');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const swapTx = await walletClient.writeContract({
    address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
    args: [usd1Balance, minOut, path, account.address, deadline],
  });
  const swapReceipt = await wait(swapTx);
  if (swapReceipt.status !== 'success') die(`Swap reverted: ${swapTx}`);
  console.log(`    https://bscscan.com/tx/${swapTx}`);

  const received = await publicClient.readContract({ address: BOBAI, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  if (received === 0n) die('Swap succeeded but the wallet holds no BOBAI - refusing to continue.');
  console.log(`    received ${fmt(received)} BOBAI`);

  // Measure the dead address around the burn. $BOBAI takes a cut on transfer,
  // so what we send and what arrives are two different numbers, and only the
  // second one is the burn.
  const deadBefore = await publicClient.readContract({ address: BOBAI, abi: ERC20_ABI, functionName: 'balanceOf', args: [DEAD] });

  console.log('3/3 burning...');
  const burnTx = await walletClient.writeContract({ address: BOBAI, abi: ERC20_ABI, functionName: 'transfer', args: [DEAD, received] });
  const burnReceipt = await wait(burnTx);
  if (burnReceipt.status !== 'success') die(`Burn reverted: ${burnTx}`);
  console.log(`    https://bscscan.com/tx/${burnTx}`);

  const deadAfter = await publicClient.readContract({ address: BOBAI, abi: ERC20_ABI, functionName: 'balanceOf', args: [DEAD] });
  const burned = deadAfter - deadBefore;

  const entry = {
    time: new Date().toISOString(),
    source: 'x402',
    note: 'Agent service earnings, bought and burned by hand from the service wallet. Not a bot run - deliberately NOT appended to burns.json, which is the buyback bot\'s own log.',
    usd1Spent: formatUnits(usd1Balance, 18),
    bnbLeg: formatUnits(wbnbLeg, 18),
    bobaiBurned: formatUnits(burned, 18),
    swapTx,
    burnTx,
    block: Number(burnReceipt.blockNumber),
  };
  writeFileSync('burn-entry.json', `${JSON.stringify(entry, null, 2)}\n`);

  console.log(`\n  burned  ${fmt(burned)} BOBAI  (arrived at the dead address)`);
  console.log(`  block   ${burnReceipt.blockNumber}`);
  console.log('\nRecord written to burn-entry.json. It does NOT go into burns.json - that');
  console.log('log is the bot\'s unattended runs only. Put the burn tx on /stats instead.');
})().catch((e) => {
  console.log(e instanceof Refused ? `\n[REFUSED] ${e.message}` : `\n[ERROR] ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});
