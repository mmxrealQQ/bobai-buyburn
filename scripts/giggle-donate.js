// Giggle Academy donation, 20 Nov 2026 (UN World Children's Day).
// Sends exactly the BNB the buyback bot put into the Giggle pot (sum of every giggleBnb in the live burns.json,
// to the wei) from the pot wallet 0x5E41 to the Giggle Academy donation address (read from the QR code on
// giggleacademy.com/support-us, BNB Chain / BNB; a Safe proxy). The pot's older rest (WC26 prize pool) pays the gas.
//
//   node scripts/giggle-donate.js          dry run: shows from, to, amount, gas, nothing is sent
//   node scripts/giggle-donate.js --send   sends it and prints the transaction hash
// Requires PRIZE_PRIVATE_KEY in .env.

require('dotenv').config();
const { createPublicClient, createWalletClient, http, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const POT = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
const GIGGLE = '0xC7f501D25Ea088aeFCa8B4b3ebD936aAe12bF4A4';
const RPC = 'https://bsc-dataseed1.ninicoin.io';
const SEND = process.argv.includes('--send');

(async () => {
  const pc = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 30000 }) });
  const account = privateKeyToAccount(process.env.PRIZE_PRIVATE_KEY.startsWith('0x') ? process.env.PRIZE_PRIVATE_KEY : `0x${process.env.PRIZE_PRIVATE_KEY}`);
  if (account.address.toLowerCase() !== POT.toLowerCase()) throw new Error(`key is ${account.address}, not the pot ${POT}`);

  const log = await (await fetch('https://brainonbnb.com/burns.json')).json();
  const sends = log.filter((x) => x.giggleBnb && Number(x.giggleBnb) > 0);
  const amount = sends.reduce((s, x) => s + parseEther(x.giggleBnb), 0n);

  const [bal, gasPrice, code] = await Promise.all([pc.getBalance({ address: POT }), pc.getGasPrice(), pc.getCode({ address: GIGGLE })]);
  const gas = await pc.estimateGas({ account, to: GIGGLE, value: amount });
  const gasLimit = (gas * 15n) / 10n;
  const fee = gasLimit * gasPrice;

  console.log(`from    ${POT} (Giggle pot)`);
  console.log(`to      ${GIGGLE} (Giggle Academy, ${code && code !== '0x' ? 'contract / Safe' : 'wallet'})`);
  console.log(`amount  ${formatEther(amount)} BNB  (${sends.length} bot sends, ${sends[0].time.slice(0, 10)} .. ${sends.at(-1).time.slice(0, 10)})`);
  console.log(`pot     ${formatEther(bal)} BNB, gas max ${formatEther(fee)} BNB (${gas} est, limit ${gasLimit}), left after ~${formatEther(bal - amount - fee)} BNB`);
  if (bal < amount + fee) throw new Error('pot too small for amount + gas');
  if (!SEND) { console.log('\ndry run, nothing sent. Send with: node scripts/giggle-donate.js --send'); return; }

  const wc = createWalletClient({ account, chain: bsc, transport: http(RPC, { timeout: 30000 }) });
  const hash = await wc.sendTransaction({ to: GIGGLE, value: amount, gas: gasLimit, gasPrice });
  console.log(`\nsent: ${hash}\nhttps://bscscan.com/tx/${hash}`);
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 120000 });
  console.log(`status ${r.status}, block ${r.blockNumber}`);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message); process.exit(1); });
