// Send gas to the provider wallet our own agents sign as.
//
// WHY THIS EXISTS
// The provider wallet holds nothing when it is created. It has to register two
// ERC-8004 identities and then pay for one submit() per delivered job, and it
// cannot do either with a zero balance.
//
// HOW LITTLE THIS ACTUALLY IS
// BSC gas sat at 0.05 gwei when this was written: a registration costs about
// 0.000015 BNB and a submit about 0.000006. One dollar of BNB is therefore
// several thousand deliveries. The amount is deliberately not "enough to be
// safe" but "enough to be useless to steal" — this key lives in a Cloudflare
// secret, and the cheapest way to make an automated signer boring is to give it
// nothing worth taking.
//
// WHY THE NFT RELAYER WALLET
// Same reason scripts/fund-service-wallet.mjs uses it: it is the only project
// wallet with BNB to spare. The creator, buyback and prize wallets hold two or
// three thousandths each, and that is the gas the burns and the liquidity runs
// depend on.
//
// WHY THIS IS NOT MERGED WITH fund-service-wallet.mjs
// It very nearly could be, and the guards below are deliberately the same
// shape. It is separate because that script is a working money path with a
// different recipient and a different reason to exist, and refactoring a script
// that moves funds in order to save eighty lines is a bad trade.
//
// SAFETY — a bare run changes nothing
//   Does nothing without --confirm. A bare run prints the plan and exits.
//   Refuses if the Chainlink answer is stale (> 1 h) or outside $100–$5000.
//   Refuses if it would leave the relayer below MIN_REMAINING.
//   Refuses if the computed amount falls outside MIN_SEND–MAX_SEND, so a feed
//     that lies in a way the price bounds miss still cannot drain the wallet.
//   Refuses if the provider wallet already holds enough gas — topping up a
//     wallet that does not need it is just moving the key's value up.
//
// Usage:
//   node scripts/fund-provider-wallet.mjs             # show the plan
//   node scripts/fund-provider-wallet.mjs --usd 1     # same, different size
//   node scripts/fund-provider-wallet.mjs --confirm   # actually send
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

// Explicit RPC, never viem's default: a silent fallback to a public node with
// different behaviour is how a script starts failing for reasons nobody can see.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'; // BSC mainnet feed, 8 decimals

const MIN_REMAINING = 0.02;    // BNB the relayer must keep for NFT mints
const MIN_SEND = 0.0002;
const MAX_SEND = 0.005;        // lower ceiling than the service wallet: this one only ever pays gas
const ALREADY_ENOUGH = 0.002;  // ~130 registrations or ~330 deliveries at 0.05 gwei
const MAX_FEED_AGE_S = 3600;

const FEED_ABI = [{
  name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
  outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
}];

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const usdArg = args.indexOf('--usd');
const usd = usdArg === -1 ? 1 : Number(args[usdArg + 1]);

// A refusal throws rather than calling process.exit: an abrupt exit while an
// RPC socket is still open trips a libuv assertion on Windows, which turns a
// clean "no" into a crash report.
class Refused extends Error {}
function die(msg) { throw new Refused(msg); }

const bnb = (v) => `${Number(formatEther(v)).toFixed(6)} BNB`;

(async () => {
  if (!Number.isFinite(usd) || usd <= 0 || usd > 5) die(`--usd ${args[usdArg + 1]} is not a sane amount for gas (0 < usd <= 5).`);

  const provider = process.env.AGENT_PROVIDER_WALLET;
  if (!provider) die('No AGENT_PROVIDER_WALLET in .env — run scripts/create-provider-wallet.mjs first.');

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
    publicClient.getBalance({ address: provider }),
    publicClient.getGasPrice(),
  ]);
  const gasCost = gasPrice * 21000n;
  const remaining = fromBalance - value - gasCost;
  const perRegistration = gasPrice * 300000n;
  const perDelivery = gasPrice * 120000n;

  console.log('\nFund the agent provider wallet');
  console.log('------------------------------');
  console.log(`  BNB/USD (Chainlink)  $${bnbUsd.toFixed(2)}   (${ageS}s old)`);
  console.log(`  from   NFT relayer   ${account.address}   ${bnb(fromBalance)}`);
  console.log(`  to     provider      ${provider}   ${bnb(toBalance)}`);
  console.log(`  send                 ${bnb(value)}  (~$${usd})`);
  console.log(`  gas                  ${bnb(gasCost)}  at ${Number(gasPrice) / 1e9} gwei`);
  console.log(`  relayer left with    ${bnb(remaining)}`);
  console.log(`\n  that buys roughly    ${Math.floor(Number(value) / Number(perRegistration))} registrations`);
  console.log(`  or                   ${Math.floor(Number(value) / Number(perDelivery))} deliveries at today's gas price`);

  if (toBalance >= parseEther(String(ALREADY_ENOUGH))) {
    die(`The provider wallet already holds ${bnb(toBalance)} — that is plenty of gas. Not topping it up.`);
  }
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
  const hash = await walletClient.sendTransaction({ to: provider, value });
  console.log(`  tx  https://bscscan.com/tx/${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') die(`Transaction reverted (block ${receipt.blockNumber}).`);

  const [afterFrom, afterTo] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getBalance({ address: provider }),
  ]);
  console.log(`\n  confirmed in block ${receipt.blockNumber}`);
  console.log(`  NFT relayer    ${bnb(afterFrom)}`);
  console.log(`  provider       ${bnb(afterTo)}   <- can register and deliver now`);
})().catch((e) => {
  console.log(e instanceof Refused ? `\n[REFUSED] ${e.message}` : `\n[ERROR] ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});
