// Dev Buyback Bot
// Created autonomously by Claude Opus 4.6
//
// Runs every 1 hour via Cloudflare Worker + GitHub Actions:
// 1. Checks creator wallet BNB balance
// 2. Reserves gas (0.003 BNB)
// 3. Splits: 84% personal (Binance), 8% builder #1, 8% builder #2

const { createPublicClient, createWalletClient, http, formatEther, parseEther, parseAbi } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const WBNB_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function withdraw(uint256 wad)',
]);
const fs = require('fs');

const PERSONAL_WALLET = '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C';
const BUILDER_1 = '0xede0e2bf714b50f131869c6a39abc5bed1e6ce47';
const BUILDER_2 = '0x7abada2b8430eee0acdce7ce9fc3f83bddb609b6';
const GAS_RESERVE = parseEther('0.003');
const MIN_BNB = parseEther('0.001');

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('[ERROR] No PRIVATE_KEY set');
    process.exit(1);
  }

  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] Dev Buyback Bot`);
  console.log(`Wallet: ${account.address}`);
  console.log(`Gas Reserve: ${formatEther(GAS_RESERVE)} BNB`);
  console.log(`Strategy: 84% -> personal (Binance), 8% -> builder #1, 8% -> builder #2`);
  console.log('============================================');

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(rpcUrl),
  });

  // Step 0: Unwrap any WBNB to native BNB
  const wbnbBalance = await publicClient.readContract({
    address: WBNB,
    abi: WBNB_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (wbnbBalance > 0n) {
    console.log(`Found ${formatEther(wbnbBalance)} WBNB — unwrapping to native BNB...`);
    try {
      const unwrapHash = await walletClient.writeContract({
        address: WBNB,
        abi: WBNB_ABI,
        functionName: 'withdraw',
        args: [wbnbBalance],
        gas: 50000n,
      });
      console.log(`  Unwrap TX: https://bscscan.com/tx/${unwrapHash}`);
      await publicClient.waitForTransactionReceipt({ hash: unwrapHash });
      console.log(`  Unwrapped ${formatEther(wbnbBalance)} WBNB → BNB`);
    } catch (e) {
      console.log(`  Unwrap failed: ${e.message}`);
    }
  }

  // Step 1: Check BNB balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`BNB Balance: ${formatEther(balance)} BNB`);

  if (balance <= GAS_RESERVE + MIN_BNB) {
    console.log('Balance too low. Waiting for more BNB...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available after gas reserve: ${formatEther(available)} BNB\n`);

  // Split: 84% personal, 8% builder #1, 8% builder #2
  const builder1Amount = (available * 8n) / 100n;
  const builder2Amount = (available * 8n) / 100n;
  const personalAmount = available - builder1Amount - builder2Amount;

  const sends = [
    { label: 'Binance Wallet (84%)', to: PERSONAL_WALLET, value: personalAmount },
    { label: 'Builder #1 (8%)', to: BUILDER_1, value: builder1Amount },
    { label: 'Builder #2 (8%)', to: BUILDER_2, value: builder2Amount },
  ];

  let personalTxHash;
  for (const s of sends) {
    console.log(`--- Sending ${formatEther(s.value)} BNB to ${s.label} ---`);
    try {
      const hash = await walletClient.sendTransaction({ to: s.to, value: s.value });
      console.log(`  TX: https://bscscan.com/tx/${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log('  Payment sent!');
      if (s.to === PERSONAL_WALLET) personalTxHash = hash;
    } catch (e) {
      console.log(`  Payment failed: ${e.message}`);
      return;
    }
  }

  // Step 3: Log
  try {
    const logFile = 'dev-buyback-log.json';
    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    logs.push({
      time: new Date().toISOString(),
      balanceBnb: formatEther(balance),
      availableBnb: formatEther(available),
      personalBnb: formatEther(personalAmount),
      builder1Bnb: formatEther(builder1Amount),
      builder2Bnb: formatEther(builder2Amount),
      personalTx: personalTxHash,
    });
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`\nLogged to ${logFile}`);
  } catch (e) {
    console.log('Failed to log:', e.message);
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DEV BUYBACK COMPLETE`);
  console.log(`Sent: ${formatEther(personalAmount)} BNB Binance / ${formatEther(builder1Amount)} #1 / ${formatEther(builder2Amount)} #2`);
  console.log('============================================');
}

main().catch(console.error);
