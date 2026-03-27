// BOB Auto Buy & Burn Bot
// Created autonomously by Claude Opus 4.6
//
// Runs via GitHub Actions every 30 minutes:
// 1. Checks buyback wallet for BNB from BOBAI tax fees
// 2. Buys $BOB with available BNB
// 3. Burns $BOB by sending to dead address
//
// 100% automatic, 100% transparent, 100% on-chain verifiable

const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } = require('viem');
const { bsc } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { execSync } = require('child_process');

const BOB_TOKEN = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const MIN_BNB = parseEther('0.001');     // Minimum BNB to trigger buyback
const GAS_RESERVE = parseEther('0.003'); // Keep for gas (buy + burn = 2 txs)

async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.BUYBACK_PRIVATE_KEY;
  if (!privateKey) {
    console.log('[ERROR] No PRIVATE_KEY or BUYBACK_PRIVATE_KEY set');
    process.exit(1);
  }

  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] BOB Buy & Burn Bot`);
  console.log(`Wallet: ${account.address}`);
  console.log('============================================');

  // Step 1: Check BNB balance
  const client = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });

  const balance = await client.getBalance({ address: account.address });
  console.log(`BNB Balance: ${formatEther(balance)} BNB`);

  if (balance <= GAS_RESERVE + MIN_BNB) {
    console.log('Balance too low for buyback. Waiting for more tax fees...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available for buyback: ${formatEther(available)} BNB`);

  // Step 2: Buy $BOB using fourmeme CLI
  console.log(`\nBuying $BOB with ${formatEther(available)} BNB...`);
  try {
    const buyResult = execSync(
      `npx fourmeme buy ${BOB_TOKEN} funds ${available.toString()} 0`,
      {
        encoding: 'utf8',
        env: { ...process.env, PRIVATE_KEY: privateKey },
        timeout: 60000,
      }
    );
    console.log('Buy result:', buyResult);
  } catch (e) {
    console.log(`Buy failed: ${e.message}`);
    console.log('Will retry next cycle.');
    return;
  }

  // Step 3: Check BOB balance
  const bobBalance = await client.readContract({
    address: BOB_TOKEN,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [account.address],
  });

  console.log(`\nBOB balance to burn: ${formatEther(bobBalance)} BOB`);

  if (bobBalance === 0n) {
    console.log('No BOB to burn.');
    return;
  }

  // Step 4: Burn - send all BOB to dead address
  console.log(`Burning ${formatEther(bobBalance)} BOB -> ${DEAD_ADDRESS}`);
  try {
    const burnResult = execSync(
      `npx fourmeme send ${DEAD_ADDRESS} ${bobBalance.toString()} ${BOB_TOKEN}`,
      {
        encoding: 'utf8',
        env: { ...process.env, PRIVATE_KEY: privateKey },
        timeout: 60000,
      }
    );
    console.log('Burn result:', burnResult);
  } catch (e) {
    console.log(`Burn failed: ${e.message}`);
    return;
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] BUY & BURN COMPLETE`);
  console.log(`${formatEther(bobBalance)} BOB permanently removed from supply`);
  console.log('============================================');
}

main().catch(console.error);
