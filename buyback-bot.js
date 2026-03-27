// BOB Auto Buy & Burn Bot
// Created autonomously by Claude Opus 4.6
//
// Runs via GitHub Actions every 30 minutes:
// 1. Checks buyback wallet for BNB from BOBAI tax fees
// 2. Swaps BNB -> $BOB via PancakeSwap V2 Router
// 3. Burns $BOB by sending to dead address
//
// 100% automatic, 100% transparent, 100% on-chain verifiable

const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const BOB_TOKEN = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const MIN_BNB = parseEther('0.001');
const GAS_RESERVE = parseEther('0.003');

const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.BUYBACK_PRIVATE_KEY;
  if (!privateKey) {
    console.log('[ERROR] No PRIVATE_KEY set');
    process.exit(1);
  }

  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] BOB Buy & Burn Bot`);
  console.log(`Wallet: ${account.address}`);
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
    console.log('Balance too low for buyback. Waiting for more tax fees...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available for buyback: ${formatEther(available)} BNB`);

  // Step 2: Get quote from PancakeSwap
  const path = [WBNB, BOB_TOKEN];

  let amountsOut;
  try {
    amountsOut = await publicClient.readContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [available, path],
    });
    console.log(`Expected BOB output: ${formatEther(amountsOut[1])} BOB`);
  } catch (e) {
    console.log(`Quote failed: ${e.message}`);
    return;
  }

  // 5% slippage tolerance
  const minOut = (amountsOut[1] * 95n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min

  // Step 3: Swap BNB -> BOB via PancakeSwap
  console.log(`\nSwapping ${formatEther(available)} BNB -> BOB on PancakeSwap...`);
  try {
    const txHash = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      args: [minOut, path, account.address, deadline],
      value: available,
    });
    console.log(`Swap TX: https://bscscan.com/tx/${txHash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`Swap confirmed in block ${receipt.blockNumber}`);
  } catch (e) {
    console.log(`Swap failed: ${e.message}`);
    return;
  }

  // Step 4: Check BOB balance
  const bobBalance = await publicClient.readContract({
    address: BOB_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  console.log(`\nBOB balance to burn: ${formatEther(bobBalance)} BOB`);

  if (bobBalance === 0n) {
    console.log('No BOB to burn.');
    return;
  }

  // Step 5: Burn - send all BOB to dead address
  console.log(`Burning ${formatEther(bobBalance)} BOB -> ${DEAD_ADDRESS}`);
  try {
    const burnHash = await walletClient.writeContract({
      address: BOB_TOKEN,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [DEAD_ADDRESS, bobBalance],
    });
    console.log(`Burn TX: https://bscscan.com/tx/${burnHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
    console.log(`Burn confirmed in block ${receipt.blockNumber}`);
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
