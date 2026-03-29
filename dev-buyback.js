// Dev Buyback Bot
// Created autonomously by Claude Opus 4.6
//
// Runs every 1 hour via Cloudflare Worker + GitHub Actions:
// 1. Checks creator wallet BNB balance
// 2. Reserves gas (0.003 BNB)
// 3. Sends 80% to personal wallet
// 4. Buys $BOBAI with 10% (hold)
// 5. Adds 10% as permanent LP (BOBAI+BNB, LP burned)

const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const fs = require('fs');

const BOB_TOKEN = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PERSONAL_WALLET = '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const GAS_RESERVE = parseEther('0.003');
const MIN_BNB = parseEther('0.001');

const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

const LP_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

const BOBAI_PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';

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

async function addLPAndBurn(walletClient, publicClient, account, bnbForLP) {
  const halfBnb = bnbForLP / 2n;
  const otherHalf = bnbForLP - halfBnb;

  // Step 1: Buy BOBAI with half the BNB
  console.log(`  Buying BOBAI with ${formatEther(halfBnb)} BNB for LP...`);
  const path = [WBNB, BOBAI_TOKEN];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  try {
    const swapTx = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      args: [0n, path, account.address, deadline],
      value: halfBnb,
      gas: 300000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: swapTx });
    console.log(`  LP swap TX: https://bscscan.com/tx/${swapTx}`);
  } catch (e) {
    console.log(`  LP swap failed: ${e.message}`);
    return null;
  }

  // Step 2: Check BOBAI balance and approve router
  const bobaiBalance = await publicClient.readContract({
    address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`  BOBAI balance for LP: ${formatEther(bobaiBalance)}`);

  if (bobaiBalance === 0n) {
    console.log('  No BOBAI to add as LP');
    return null;
  }

  const approveTx = await walletClient.writeContract({
    address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'approve',
    args: [PANCAKE_ROUTER_V2, bobaiBalance], gas: 100000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Step 3: Add liquidity (BOBAI + BNB)
  console.log(`  Adding LP: ${formatEther(bobaiBalance)} BOBAI + ${formatEther(otherHalf)} BNB...`);
  let lpTxHash;
  try {
    lpTxHash = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'addLiquidityETH',
      args: [BOBAI_TOKEN, bobaiBalance, 0n, 0n, account.address, deadline],
      value: otherHalf,
      gas: 500000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: lpTxHash });
    console.log(`  LP add TX: https://bscscan.com/tx/${lpTxHash}`);
  } catch (e) {
    console.log(`  LP add failed: ${e.message}`);
    return null;
  }

  // Step 4: Burn LP tokens (send to dead address)
  const lpBalance = await publicClient.readContract({
    address: BOBAI_PAIR, abi: LP_ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`  LP tokens received: ${formatEther(lpBalance)}`);

  if (lpBalance > 0n) {
    const burnTx = await walletClient.writeContract({
      address: BOBAI_PAIR, abi: LP_ABI, functionName: 'transfer',
      args: [DEAD, lpBalance], gas: 100000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: burnTx });
    console.log(`  LP BURNED: https://bscscan.com/tx/${burnTx}`);
    return { lpTxHash, burnTx, lpAmount: formatEther(lpBalance), bnbUsed: formatEther(bnbForLP) };
  }
  return null;
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
  console.log(`Gas Reserve: ${formatEther(GAS_RESERVE)} BNB`);
  console.log(`Strategy: 80% -> personal wallet | 10% buy BOBAI | 10% LP add+burn`);
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

  // Step 2: Calculate splits (80% personal, 10% BOBAI, 10% LP)
  const personalAmount = (available * 80n) / 100n;
  const bobaiAmount = (available * 10n) / 100n;
  const lpAmount = available - personalAmount - bobaiAmount;

  console.log(`Personal:     ${formatEther(personalAmount)} BNB (80%)`);
  console.log(`Buy BOBAI:    ${formatEther(bobaiAmount)} BNB (10%)`);
  console.log(`LP Add+Burn:  ${formatEther(lpAmount)} BNB (10%)`);

  // Step 3: Send 80% to personal wallet
  console.log(`\n--- Sending ${formatEther(personalAmount)} BNB to Personal Wallet ---`);
  let personalTxHash;
  try {
    personalTxHash = await walletClient.sendTransaction({
      to: PERSONAL_WALLET,
      value: personalAmount,
    });
    console.log(`  TX: https://bscscan.com/tx/${personalTxHash}`);
    await publicClient.waitForTransactionReceipt({ hash: personalTxHash });
    console.log('  Personal payment sent!');
  } catch (e) {
    console.log(`  Personal payment failed: ${e.message}`);
    return;
  }

  // Step 4: Buy $BOBAI (hold)
  console.log(`\n--- Buying $BOBAI (${formatEther(bobaiAmount)} BNB) ---`);
  const bobaiResult = await swapAndHold(walletClient, publicClient, account, bobaiAmount, BOBAI_TOKEN, 'BOBAI');

  // Step 5: Add LP + Burn
  console.log(`\n--- Adding Permanent LP (${formatEther(lpAmount)} BNB) ---`);
  const lpResult = await addLPAndBurn(walletClient, publicClient, account, lpAmount);

  // Step 6: Log
  try {
    const logFile = 'dev-buyback-log.json';
    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    const entry = {
      time: new Date().toISOString(),
      balanceBnb: formatEther(balance),
      availableBnb: formatEther(available),
      personalBnb: formatEther(personalAmount),
      personalTx: personalTxHash,
    };
    if (bobaiResult) {
      entry.bobaiBuyBnb = formatEther(bobaiAmount);
      entry.bobaiEstimated = bobaiResult.estimatedAmount;
      entry.bobaiTx = bobaiResult.txHash;
      entry.bobaiBlock = bobaiResult.block;
    }
    if (lpResult) {
      entry.lpBnb = formatEther(lpAmount);
      entry.lpTokensBurned = lpResult.lpAmount;
      entry.lpAddTx = lpResult.lpTxHash;
      entry.lpBurnTx = lpResult.burnTx;
    }
    logs.push(entry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`\nLogged to ${logFile}`);
  } catch (e) {
    console.log('Failed to log:', e.message);
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DEV BUYBACK COMPLETE`);
  console.log(`Personal: ${formatEther(personalAmount)} BNB`);
  if (bobaiResult) console.log(`BOBAI bought: ~${bobaiResult.estimatedAmount}`);
  if (lpResult) console.log(`LP burned: ${lpResult.lpAmount} (${formatEther(lpAmount)} BNB)`);
  console.log('============================================');
}

main().catch(console.error);
