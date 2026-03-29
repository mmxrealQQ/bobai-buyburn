// Dev Buyback Bot
// Created autonomously by Claude Opus 4.6
//
// Runs every 10 hours via Cloudflare Worker + GitHub Actions:
// 1. Checks creator wallet BNB balance
// 2. If above 0.01 BNB floor, takes the excess
// 3. Keeps 50% as BNB reserve
// 4. Buys $BOB with 25% (hold, not burn)
// 5. Buys $BOBAI with 25% (hold, not burn)
//
// Builds dev position over time — visible on-chain as creator buyback

const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const fs = require('fs');

const BOB_TOKEN = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const BNB_FLOOR = parseEther('0.01');

const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
]);

async function swapAndHold(walletClient, publicClient, account, bnbAmount, tokenAddress, tokenName) {
  const path = [WBNB, tokenAddress];

  let amountsOut;
  try {
    amountsOut = await publicClient.readContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [bnbAmount, path],
    });
    console.log(`  Expected ${tokenName} output: ${formatEther(amountsOut[1])}`);
  } catch (e) {
    console.log(`  Quote failed for ${tokenName}: ${e.message}`);
    return null;
  }

  const minOut = (amountsOut[1] * 90n) / 100n; // 10% slippage for tax tokens
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  try {
    const txHash = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      args: [minOut, path, account.address, deadline],
      value: bnbAmount,
      gas: 300000n,
    });
    console.log(`  Swap TX: https://bscscan.com/tx/${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`  Bought ${tokenName} in block ${receipt.blockNumber}`);
    return { txHash, estimatedAmount: formatEther(amountsOut[1]), block: Number(receipt.blockNumber) };
  } catch (e) {
    console.log(`  Swap failed for ${tokenName}: ${e.message}`);
    return null;
  }
}

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
  console.log(`Floor: ${formatEther(BNB_FLOOR)} BNB`);
  console.log(`Strategy: 50% hold BNB | 25% buy BOB | 25% buy BOBAI`);
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

  if (balance <= BNB_FLOOR) {
    console.log(`Balance at or below floor (${formatEther(BNB_FLOOR)} BNB). Nothing to do.`);
    return;
  }

  const excess = balance - BNB_FLOOR;
  console.log(`Excess above floor: ${formatEther(excess)} BNB\n`);

  // Step 2: Calculate splits (50% hold, 25% BOB, 25% BOBAI)
  const bobAmount = excess / 4n;
  const bobaiAmount = excess / 4n;
  const holdAmount = excess - bobAmount - bobaiAmount; // remainder stays as BNB

  console.log(`Hold as BNB:  ${formatEther(holdAmount)} BNB (50%)`);
  console.log(`Buy BOB:      ${formatEther(bobAmount)} BNB (25%)`);
  console.log(`Buy BOBAI:    ${formatEther(bobaiAmount)} BNB (25%)`);

  // Step 3: Buy $BOB (hold)
  console.log(`\n--- Buying $BOB (${formatEther(bobAmount)} BNB) ---`);
  const bobResult = await swapAndHold(walletClient, publicClient, account, bobAmount, BOB_TOKEN, 'BOB');

  // Step 4: Buy $BOBAI (hold)
  console.log(`\n--- Buying $BOBAI (${formatEther(bobaiAmount)} BNB) ---`);
  const bobaiResult = await swapAndHold(walletClient, publicClient, account, bobaiAmount, BOBAI_TOKEN, 'BOBAI');

  // Step 5: Log
  try {
    const logFile = 'dev-buyback-log.json';
    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    const entry = {
      time: new Date().toISOString(),
      balanceBnb: formatEther(balance),
      excessBnb: formatEther(excess),
      heldBnb: formatEther(holdAmount),
    };
    if (bobResult) {
      entry.bobBuyBnb = formatEther(bobAmount);
      entry.bobEstimated = bobResult.estimatedAmount;
      entry.bobTx = bobResult.txHash;
      entry.bobBlock = bobResult.block;
    }
    if (bobaiResult) {
      entry.bobaiBuyBnb = formatEther(bobaiAmount);
      entry.bobaiEstimated = bobaiResult.estimatedAmount;
      entry.bobaiTx = bobaiResult.txHash;
      entry.bobaiBlock = bobaiResult.block;
    }
    logs.push(entry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`\nLogged to ${logFile}`);
  } catch (e) {
    console.log('Failed to log:', e.message);
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DEV BUYBACK COMPLETE`);
  console.log(`Held: ${formatEther(holdAmount)} BNB`);
  if (bobResult) console.log(`BOB bought: ~${bobResult.estimatedAmount}`);
  if (bobaiResult) console.log(`BOBAI bought: ~${bobaiResult.estimatedAmount}`);
  console.log('============================================');
}

main().catch(console.error);
