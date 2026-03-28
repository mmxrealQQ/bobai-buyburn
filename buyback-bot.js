// BOBAI Tax Distribution Bot
// Created autonomously by Claude Opus 4.6
//
// Runs via GitHub Actions every 10 minutes:
// 1. Checks buyback wallet for BNB from BOBAI 3% tax
// 2. Splits BNB three ways:
//    - 50% (1.5%) -> Creator wallet (revenue)
//    - 33% (1.0%) -> Buy $BOB + burn to dead address
//    - 17% (0.5%) -> Buy $BOBAI + burn to dead address (deflationary)
//
// 100% automatic, 100% transparent, 100% on-chain verifiable

const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const fs = require('fs');

const BOB_TOKEN = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const CREATOR_WALLET = '0x15Ba17075ef5E0736292b030e3715d9100fe3d38';
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const MIN_BNB = parseEther('0.001');
const GAS_RESERVE = parseEther('0.003');

// Split ratios (must sum to 100)
const CREATOR_SHARE = 50;  // 1.5% of trade -> creator revenue
const BOB_BURN_SHARE = 33; // 1.0% of trade -> buy & burn $BOB
const BOBAI_BURN_SHARE = 17; // 0.5% of trade -> buy & burn $BOBAI

const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

async function swapAndBurn(walletClient, publicClient, account, bnbAmount, tokenAddress, tokenName) {
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

  const minOut = (amountsOut[1] * 95n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // Swap BNB -> token
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      args: [minOut, path, account.address, deadline],
      value: bnbAmount,
      gas: 300000n,
    });
    console.log(`  Swap TX: https://bscscan.com/tx/${txHash}`);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e) {
    console.log(`  Swap failed for ${tokenName}: ${e.message}`);
    return null;
  }

  // Check token balance
  const tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (tokenBalance === 0n) {
    console.log(`  No ${tokenName} to burn.`);
    return null;
  }

  // Burn to dead address
  let burnHash;
  try {
    burnHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [DEAD_ADDRESS, tokenBalance],
      gas: 200000n,
    });
    console.log(`  Burn TX: https://bscscan.com/tx/${burnHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
    console.log(`  Burned ${formatEther(tokenBalance)} ${tokenName} in block ${receipt.blockNumber}`);
    return { txHash, burnHash, amount: formatEther(tokenBalance), block: Number(receipt.blockNumber) };
  } catch (e) {
    console.log(`  Burn failed for ${tokenName}: ${e.message}`);
    return null;
  }
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.BUYBACK_PRIVATE_KEY;
  if (!privateKey) {
    console.log('[ERROR] No PRIVATE_KEY set');
    process.exit(1);
  }

  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] BOBAI Tax Distribution Bot`);
  console.log(`Wallet: ${account.address}`);
  console.log(`Split: ${CREATOR_SHARE}% Creator | ${BOB_BURN_SHARE}% BOB Burn | ${BOBAI_BURN_SHARE}% BOBAI Burn`);
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
    console.log('Balance too low. Waiting for more tax fees...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available for distribution: ${formatEther(available)} BNB\n`);

  // Step 2: Calculate splits
  const creatorAmount = (available * BigInt(CREATOR_SHARE)) / 100n;
  const bobBurnAmount = (available * BigInt(BOB_BURN_SHARE)) / 100n;
  const bobaiBurnAmount = available - creatorAmount - bobBurnAmount; // remainder to avoid rounding loss

  console.log(`Creator share:    ${formatEther(creatorAmount)} BNB (${CREATOR_SHARE}%)`);
  console.log(`BOB burn share:   ${formatEther(bobBurnAmount)} BNB (${BOB_BURN_SHARE}%)`);
  console.log(`BOBAI burn share: ${formatEther(bobaiBurnAmount)} BNB (${BOBAI_BURN_SHARE}%)`);

  // Step 3: Send creator share
  console.log(`\n--- Sending ${formatEther(creatorAmount)} BNB to Creator ---`);
  let creatorTxHash;
  try {
    creatorTxHash = await walletClient.sendTransaction({
      to: CREATOR_WALLET,
      value: creatorAmount,
    });
    console.log(`  TX: https://bscscan.com/tx/${creatorTxHash}`);
    await publicClient.waitForTransactionReceipt({ hash: creatorTxHash });
    console.log('  Creator payment sent!');
  } catch (e) {
    console.log(`  Creator payment failed: ${e.message}`);
    return;
  }

  // Step 4: Buy & burn $BOB
  console.log(`\n--- Buying & Burning $BOB (${formatEther(bobBurnAmount)} BNB) ---`);
  const bobResult = await swapAndBurn(walletClient, publicClient, account, bobBurnAmount, BOB_TOKEN, 'BOB');

  // Step 5: Buy & burn $BOBAI
  console.log(`\n--- Buying & Burning $BOBAI (${formatEther(bobaiBurnAmount)} BNB) ---`);
  const bobaiResult = await swapAndBurn(walletClient, publicClient, account, bobaiBurnAmount, BOBAI_TOKEN, 'BOBAI');

  // Step 6: Log to burns.json
  try {
    let burns = [];
    if (fs.existsSync('burns.json')) {
      burns = JSON.parse(fs.readFileSync('burns.json', 'utf8'));
    }
    const entry = {
      time: new Date().toISOString(),
      totalBnb: formatEther(available),
      creatorBnb: formatEther(creatorAmount),
      creatorTx: creatorTxHash,
    };
    if (bobResult) {
      entry.bobBurnBnb = formatEther(bobBurnAmount);
      entry.bobBurned = bobResult.amount;
      entry.bobSwapTx = bobResult.txHash;
      entry.bobBurnTx = bobResult.burnHash;
      entry.bobBlock = bobResult.block;
    }
    if (bobaiResult) {
      entry.bobaiBurnBnb = formatEther(bobaiBurnAmount);
      entry.bobaiBurned = bobaiResult.amount;
      entry.bobaiSwapTx = bobaiResult.txHash;
      entry.bobaiBurnTx = bobaiResult.burnHash;
      entry.bobaiBlock = bobaiResult.block;
    }
    burns.push(entry);
    fs.writeFileSync('burns.json', JSON.stringify(burns, null, 2));
    console.log('\nBurn logged to burns.json');
  } catch (e) {
    console.log('Failed to log:', e.message);
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DISTRIBUTION COMPLETE`);
  console.log(`Creator: ${formatEther(creatorAmount)} BNB`);
  if (bobResult) console.log(`BOB burned: ${bobResult.amount}`);
  if (bobaiResult) console.log(`BOBAI burned: ${bobaiResult.amount}`);
  console.log('============================================');
}

main().catch(console.error);
