// BOBAI Safe Liquidity Add + LP Burn Script
// MEV Protection: tight slippage, LP direct to dead address
//
// Usage: node add-liquidity-safe.js
// Requires: PRIVATE_KEY in .env or environment

require('dotenv').config();
const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther, parseUnits } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PANCAKE_PAIR = '0x6eaDD4CB786898B34929444988380ed0CC6fD9A6'; // BOBAI/WBNB V2

// --- CONFIG ---
const KEEP_BOBAI = parseEther('1'); // Keep exactly 1 BOBAI on wallet
const SLIPPAGE_PERCENT = 2; // 2% max slippage (MEV protection)
const SWAP_CHUNKS = 3; // Split swap into 3 chunks for MEV protection
const GAS_LIMIT = 500000n;

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

const ROUTER_ABI = parseAbi([
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
]);

const PAIR_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('[ERROR] No PRIVATE_KEY in .env');
    process.exit(1);
  }

  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);

  console.log('============================================');
  console.log('BOBAI Safe Liquidity Add + LP Burn');
  console.log(`Wallet: ${account.address}`);
  console.log(`Keep:   ${formatEther(KEEP_BOBAI)} BOBAI`);
  console.log(`Slippage:    ${SLIPPAGE_PERCENT}%`);
  console.log(`Swap chunks: ${SWAP_CHUNKS}`);
  console.log('============================================\n');

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(rpcUrl),
  });

  // Step 0: Check BOBAI balance
  const bobaiBalance = await publicClient.readContract({
    address: BOBAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`BOBAI balance: ${formatEther(bobaiBalance)}`);

  if (bobaiBalance <= KEEP_BOBAI) {
    console.log(`[ERROR] Not enough BOBAI. Have ${formatEther(bobaiBalance)}, need more than ${formatEther(KEEP_BOBAI)}`);
    process.exit(1);
  }

  const TOTAL_BOBAI = bobaiBalance - KEEP_BOBAI;
  const SWAP_AMOUNT = TOTAL_BOBAI / 2n;
  const LIQUIDITY_BOBAI = TOTAL_BOBAI - SWAP_AMOUNT;

  const bnbBefore = await publicClient.getBalance({ address: account.address });
  console.log(`BNB balance:   ${formatEther(bnbBefore)}`);

  const minGas = parseEther('0.002');
  if (bnbBefore < minGas) {
    console.log(`[ERROR] Brauche mindestens ${formatEther(minGas)} BNB für Gas! Bitte BNB auf die Wallet senden.`);
    process.exit(1);
  }
  console.log('');

  // Step 1: Approve Router for full amount (swap + liquidity)
  console.log('--- Step 1: Approve Router ---');
  const allowance = await publicClient.readContract({
    address: BOBAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, PANCAKE_ROUTER_V2],
  });

  if (allowance < TOTAL_BOBAI) {
    const approveTx = await walletClient.writeContract({
      address: BOBAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PANCAKE_ROUTER_V2, TOTAL_BOBAI * 2n], // extra buffer for tax
      gas: 100000n,
    });
    console.log(`Approve TX: https://bscscan.com/tx/${approveTx}`);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log('Approved!\n');
  } else {
    console.log('Already approved.\n');
  }

  // Step 2: Swap BOBAI → BNB in chunks (MEV protection)
  console.log('--- Step 2: Swap BOBAI → BNB (chunked) ---');
  const chunkSize = SWAP_AMOUNT / BigInt(SWAP_CHUNKS);

  for (let i = 0; i < SWAP_CHUNKS; i++) {
    const thisChunk = (i === SWAP_CHUNKS - 1) ? (SWAP_AMOUNT - chunkSize * BigInt(SWAP_CHUNKS - 1)) : chunkSize;
    console.log(`\n  Chunk ${i + 1}/${SWAP_CHUNKS}: ${formatEther(thisChunk)} BOBAI`);

    // Get quote with POST-TAX input amount (router only receives 97% due to 3% tax)
    const path = [BOBAI_TOKEN, WBNB];
    try {
      const postTaxInput = (thisChunk * 97n) / 100n;
      const amounts = await publicClient.readContract({
        address: PANCAKE_ROUTER_V2,
        abi: ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [postTaxInput, path],
      });
      const expectedOut = amounts[1];
      console.log(`  Input (pre-tax):  ${formatEther(thisChunk)} BOBAI`);
      console.log(`  Input (post-tax): ${formatEther(postTaxInput)} BOBAI`);
      console.log(`  Expected BNB:     ${formatEther(expectedOut)}`);

      // Set minOut with slippage only (tax already accounted for in quote)
      const minOut = (expectedOut * BigInt(100 - SLIPPAGE_PERCENT)) / 100n;
      console.log(`  Min BNB (${SLIPPAGE_PERCENT}% slippage): ${formatEther(minOut)}`);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const swapTx = await walletClient.writeContract({
        address: PANCAKE_ROUTER_V2,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
        args: [thisChunk, minOut, path, account.address, deadline],
        gas: GAS_LIMIT,
      });
      console.log(`  Swap TX: https://bscscan.com/tx/${swapTx}`);
      await publicClient.waitForTransactionReceipt({ hash: swapTx });
      console.log(`  Swap done!`);
    } catch (e) {
      console.log(`  [ERROR] Swap chunk ${i + 1} failed: ${e.message}`);
      process.exit(1);
    }

    // Wait between chunks to land in different blocks
    if (i < SWAP_CHUNKS - 1) {
      console.log('  Waiting 5s for next chunk...');
      await sleep(5000);
    }
  }

  // Step 3: Add Liquidity
  console.log('\n--- Step 3: Add Liquidity ---');
  // Use current BNB balance minus gas reserve
  const gasReserve = parseEther('0.001');
  const currentBnb = await publicClient.getBalance({ address: account.address });
  console.log(`Current BNB balance: ${formatEther(currentBnb)}`);
  const bnbForLiquidity = currentBnb > gasReserve ? currentBnb - gasReserve : 0n;

  if (bnbForLiquidity <= 0n) {
    console.log('[ERROR] No BNB available for liquidity');
    process.exit(1);
  }

  console.log(`BOBAI for liquidity: ${formatEther(LIQUIDITY_BOBAI)}`);
  console.log(`BNB for liquidity:   ${formatEther(bnbForLiquidity)}`);

  // Slippage tolerance on liquidity add
  // Router adjusts amounts to match pool ratio and refunds excess BNB
  // Set minimums low — the tight slippage on the swap already protects us
  const minToken = 0n; // Router determines actual amount after tax
  const minBnb = 0n; // Router refunds unused BNB
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`Min BOBAI accepted: 0 (router adjusts for tax + ratio)`);
  console.log(`Min BNB accepted:   0 (excess BNB refunded)`);

  let addLiqTx;
  try {
    addLiqTx = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'addLiquidityETH',
      args: [BOBAI_TOKEN, LIQUIDITY_BOBAI, minToken, minBnb, account.address, deadline],
      value: bnbForLiquidity,
      gas: 500000n,
    });
    console.log(`Add Liquidity TX: https://bscscan.com/tx/${addLiqTx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: addLiqTx });
    console.log(`Liquidity added in block ${receipt.blockNumber}!`);
  } catch (e) {
    console.log(`[ERROR] Add liquidity failed: ${e.message}`);
    process.exit(1);
  }

  // Step 4: Burn LP tokens (send to dead address)
  console.log('\n--- Step 4: Burn LP Tokens → Dead Address ---');
  const lpBalance = await publicClient.readContract({
    address: PANCAKE_PAIR,
    abi: PAIR_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`LP tokens to burn: ${formatEther(lpBalance)}`);

  if (lpBalance === 0n) {
    console.log('[WARN] No LP tokens found!');
    process.exit(1);
  }

  try {
    const burnTx = await walletClient.writeContract({
      address: PANCAKE_PAIR,
      abi: PAIR_ABI,
      functionName: 'transfer',
      args: [DEAD_ADDRESS, lpBalance],
      gas: 100000n,
    });
    console.log(`LP Burn TX: https://bscscan.com/tx/${burnTx}`);
    await publicClient.waitForTransactionReceipt({ hash: burnTx });
    console.log(`BURNED ${formatEther(lpBalance)} LP tokens to ${DEAD_ADDRESS}`);
  } catch (e) {
    console.log(`[ERROR] LP burn failed: ${e.message}`);
    process.exit(1);
  }

  // Final summary
  console.log('\n============================================');
  console.log('DONE!');
  console.log(`Swapped:  ${formatEther(SWAP_AMOUNT)} BOBAI → BNB`);
  console.log(`Added:    ${formatEther(LIQUIDITY_BOBAI)} BOBAI + ${formatEther(bnbForLiquidity)} BNB`);
  console.log(`LP Burned: ${formatEther(lpBalance)} Cake-LP → Dead`);
  console.log('============================================');
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
