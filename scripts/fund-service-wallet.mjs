// Send a small amount of BNB from the NFT relayer wallet to the x402 service
// wallet, so the service wallet can pay its own gas.
//
// WHY THIS EXISTS
// The first earning outside the tax — 0.50 USD1 — is sitting on the service
// wallet 0x690E…4dE4, and that wallet holds exactly 0 BNB. It cannot move a
// single token until somebody funds its gas. Step 3 of the money flow (service
// wallet -> buyback wallet -> buy & burn) is handwork by design, and this is
// the one prerequisite for it.
//
// WHY THE NFT RELAYER WALLET
// Same reason as scripts/x402-test-payment.mjs: it is the only project wallet
// with BNB to spare (~0.047). The creator, buyback and prize wallets hold two
// or three thousandths each, and that is the gas the burns and the liquidity
// runs run on — spending it here would stop the flywheel.
//
// HOW THE AMOUNT IS DECIDED
// A USD amount (default 2) converted at the Chainlink BNB/USD feed — the same
// feed the dashboard, the bots and the TG bot read, so this number cannot
// disagree with the numbers on the site. The feed's own staleness is checked.
//
// SAFETY — a bare run changes nothing
//   Does nothing without --confirm. A bare run prints the plan and exits.
//   Refuses if the Chainlink answer is stale (> 1 h) or outside $100–$5000.
//   Refuses if the computed amount leaves the relayer below MIN_REMAINING —
//     the relayer mints NFTs on every $100+ buy and must not run dry.
//   Refuses if the computed amount is outside 0.0002–0.01 BNB, which is the
//     range a sane feed can produce for a few dollars. A feed that lies in a
//     way the price bounds miss still cannot drain the wallet.
//
// Usage:
//   node scripts/fund-service-wallet.mjs                 # show the plan
//   node scripts/fund-service-wallet.mjs --usd 2         # same, different size
//   node scripts/fund-service-wallet.mjs --confirm       # actually send
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

// Explicit RPC, never viem's default: a silent fallback to a public node with
// different behaviour is how a script starts failing for reasons nobody can see.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const SERVICE_WALLET = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'; // BSC mainnet feed, 8 decimals

const MIN_REMAINING = 0.02;   // BNB the relayer must keep for NFT mints
const MIN_SEND = 0.0002;      // sanity floor on the computed amount
const MAX_SEND = 0.01;        // sanity ceiling — a bad feed cannot drain the wallet
const MAX_FEED_AGE_S = 3600;  // a Chainlink answer older than this is not a price

const FEED_ABI = [{
  name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
  outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
}];

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const usdArg = args.indexOf('--usd');
const usd = usdArg === -1 ? 2 : Number(args[usdArg + 1]);

// A refusal throws rather than calling process.exit: an abrupt exit while an
// RPC socket is still open trips a libuv assertion on Windows, which turns a
// clean "no" into a crash report.
class Refused extends Error {}
function die(msg) { throw new Refused(msg); }

const bnb = (v) => `${Number(formatEther(v)).toFixed(6)} BNB`;

(async () => {
  if (!Number.isFinite(usd) || usd <= 0 || usd > 20) die(`--usd ${args[usdArg + 1]} is not a sane amount (0 < usd <= 20).`);

  const pk = process.env.NFT_RELAYER_PRIVATE_KEY;
  if (!pk) die('No NFT_RELAYER_PRIVATE_KEY in .env');
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });

  // --- price -------------------------------------------------------------
  const [, answer, , updatedAt] = await publicClient.readContract({
    address: CHAINLINK_BNB_USD, abi: FEED_ABI, functionName: 'latestRoundData',
  });
  const bnbUsd = Number(answer) / 1e8;
  const ageS = Math.floor(Date.now() / 1000) - Number(updatedAt);
  if (ageS > MAX_FEED_AGE_S) die(`Chainlink BNB/USD is ${Math.round(ageS / 60)} min old — that is not a live price.`);
  if (bnbUsd < 100 || bnbUsd > 5000) die(`Chainlink reports BNB at $${bnbUsd} — outside the plausible range, not trusting it.`);

  const amountBnb = usd / bnbUsd;
  if (amountBnb < MIN_SEND || amountBnb > MAX_SEND) {
    die(`$${usd} works out to ${amountBnb.toFixed(6)} BNB, outside the allowed ${MIN_SEND}–${MAX_SEND} window.`);
  }
  const value = parseEther(amountBnb.toFixed(18));

  // --- balances and cost -------------------------------------------------
  const [fromBalance, toBalance, gasPrice] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getBalance({ address: SERVICE_WALLET }),
    publicClient.getGasPrice(),
  ]);
  const gasCost = gasPrice * 21000n;
  const remaining = fromBalance - value - gasCost;

  console.log('\nFund the x402 service wallet');
  console.log('----------------------------');
  console.log(`  BNB/USD (Chainlink)  $${bnbUsd.toFixed(2)}   (${ageS}s old)`);
  console.log(`  from   NFT relayer   ${account.address}   ${bnb(fromBalance)}`);
  console.log(`  to     x402 service  ${SERVICE_WALLET}   ${bnb(toBalance)}`);
  console.log(`  send                 ${bnb(value)}  (~$${usd})`);
  console.log(`  gas                  ${bnb(gasCost)}  at ${Number(gasPrice) / 1e9} gwei`);
  console.log(`  relayer left with    ${bnb(remaining)}`);

  if (remaining < parseEther(String(MIN_REMAINING))) {
    die(`That would leave the relayer under ${MIN_REMAINING} BNB — it mints NFTs and must keep its gas.`);
  }

  if (!confirm) {
    console.log('\nNothing sent. Re-run with --confirm to actually send.');
    return;
  }

  // --- send --------------------------------------------------------------
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC) });
  console.log('\nSending…');
  const hash = await walletClient.sendTransaction({ to: SERVICE_WALLET, value });
  console.log(`  tx  https://bscscan.com/tx/${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') die(`Transaction reverted (block ${receipt.blockNumber}).`);

  const [afterFrom, afterTo] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getBalance({ address: SERVICE_WALLET }),
  ]);
  console.log(`\n  confirmed in block ${receipt.blockNumber}`);
  console.log(`  NFT relayer    ${bnb(afterFrom)}`);
  console.log(`  x402 service   ${bnb(afterTo)}   <- can pay its own gas now`);
})().catch((e) => {
  console.log(e instanceof Refused ? `
[REFUSED] ${e.message}` : `
[ERROR] ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});
