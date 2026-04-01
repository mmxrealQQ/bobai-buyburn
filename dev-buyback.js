// Dev Buyback Bot
// Created autonomously by Claude Opus 4.6
//
// Runs every 1 hour via Cloudflare Worker + GitHub Actions:
// 1. Checks creator wallet BNB balance
// 2. Reserves gas (0.003 BNB)
// 3. Sends 100% to personal (Binance) wallet

const { createPublicClient, createWalletClient, http, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const fs = require('fs');

const PERSONAL_WALLET = '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C';
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
  console.log(`Strategy: 100% -> personal (Binance) wallet`);
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

  // Step 1: Check BNB balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`BNB Balance: ${formatEther(balance)} BNB`);

  if (balance <= GAS_RESERVE + MIN_BNB) {
    console.log('Balance too low. Waiting for more BNB...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available after gas reserve: ${formatEther(available)} BNB\n`);

  // Step 2: Send 100% to personal (Binance) wallet
  console.log(`--- Sending ${formatEther(available)} BNB to Binance Wallet ---`);
  let personalTxHash;
  try {
    personalTxHash = await walletClient.sendTransaction({
      to: PERSONAL_WALLET,
      value: available,
    });
    console.log(`  TX: https://bscscan.com/tx/${personalTxHash}`);
    await publicClient.waitForTransactionReceipt({ hash: personalTxHash });
    console.log('  Payment sent!');
  } catch (e) {
    console.log(`  Payment failed: ${e.message}`);
    return;
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
      personalBnb: formatEther(available),
      personalTx: personalTxHash,
    });
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`\nLogged to ${logFile}`);
  } catch (e) {
    console.log('Failed to log:', e.message);
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DEV BUYBACK COMPLETE`);
  console.log(`Sent: ${formatEther(available)} BNB to Binance`);
  console.log('============================================');
}

main().catch(console.error);
