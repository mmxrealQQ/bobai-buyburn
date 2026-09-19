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
const KEEP_BOBAI = parseEther('808.41'); // Keep exactly 808.41 BOBAI on wallet
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
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
]);

// THREE THINGS THIS SCRIPT TOOK ON TRUST (2026-09-18).
// The wallet: it ran on whatever PRIVATE_KEY opened. It is written for the
// creator wallet (the KEEP amount, the record in liq-runs.json, the page's
// count are all that wallet's) and now says so before anything is read.
const CREATOR_WALLET = '0x15Ba17075ef5E0736292b030e3715d9100fe3d38';
// The receipts: none was looked at. A reverted swap printed "Swap done!", a
// reverted LP burn would have gone into liq-runs.json as burned — the page's
// permanent-liquidity figure would have counted LP that still sat on the
// wallet. Only status 'success' counts now; anything else stops the run.
function mustSucceed(receipt, what) {
  if (!receipt || receipt.status !== 'success') throw new Error(`${what} did not succeed (status ${receipt ? receipt.status : 'unknown'}) — nothing after it was sent`);
  return receipt;
}
// The hour: the dev sweep (worker-dev-buyback, minute 0 of every hour) sends
// everything above 0.003 BNB on this same wallet to the 82/4/4/4/4/2 split. A
// run across the full hour would have had the BNB it had just sold for swept
// away before the add, and two senders on one nonce. A run takes two to three
// minutes; it does not START from five minutes before the hour to three after.
function inSweepWindow(now = new Date()) {
  const m = now.getUTCMinutes();
  return m >= 55 || m < 3;
}

// What the router will take of the two amounts, from the pair's reserves, and
// 5% below it — to the letter the function the tax bot's own add uses
// (worker/index.js, pinned by scripts/buyback-fork-test.mjs).
function liqMins(tokenAmount, bnbAmount, reserveToken, reserveBnb) {
  if (reserveToken <= 0n || reserveBnb <= 0n) return null;
  const bnbOptimal = (tokenAmount * reserveBnb) / reserveToken;
  const used = bnbOptimal <= bnbAmount
    ? { token: tokenAmount, bnb: bnbOptimal }
    : { token: (bnbAmount * reserveToken) / reserveBnb, bnb: bnbAmount };
  return { tokenUsed: used.token, bnbUsed: used.bnb, tokenMin: (used.token * 95n) / 100n, bnbMin: (used.bnb * 95n) / 100n };
}

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
  if (account.address.toLowerCase() !== CREATOR_WALLET.toLowerCase()) {
    console.error('[ERROR] PRIVATE_KEY does not open the creator wallet — nothing was sent.');
    console.error(`  Expected: ${CREATOR_WALLET}`);
    console.error(`  Got:      ${account.address}`);
    process.exit(1);
  }
  if (inSweepWindow()) {
    console.error('[WAIT] The dev sweep runs on this wallet at the full hour and would take the BNB this run sells for.');
    console.error('  Start again from minute 03 on (UTC). Nothing was sent.');
    process.exit(1);
  }

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

  const minGas = parseEther('0.0015');
  if (bnbBefore < minGas) {
    console.log(`[ERROR] Need at least ${formatEther(minGas)} BNB for gas. Send BNB to the wallet first.`);
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
    mustSucceed(await publicClient.waitForTransactionReceipt({ hash: approveTx }), 'the approve');
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
      mustSucceed(await publicClient.waitForTransactionReceipt({ hash: swapTx }), `swap chunk ${i + 1}`);
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

  // THE MINIMUMS OF THE ADD (2026-09-19). Both were 0 — "the tight slippage on
  // the swap already protects us". It protects the swap. Between the last chunk
  // and this transaction the price can still be moved, and an add with no
  // minimum mints its LP at whatever ratio it finds. liqMins (the same text as
  // in worker/index.js, where the tax bot's own add uses it) works out from the
  // reserves as they stand what the router will take — all the BNB when that is
  // the short side, which it usually is here, the sale having paid tax and fee —
  // and allows 5% below it. A price moved further than that stops the add: it
  // costs the gas of one reverted transaction, the BOBAI and the BNB stay on
  // the wallet, and the script is simply started again. The router checks these
  // minimums BEFORE the token's transfer tax, so the 3% is not in them.
  // Amounts, chunks, the swap's slippage and the record are unchanged.
  let mins;
  try {
    const [reserves, token0] = await Promise.all([
      publicClient.readContract({ address: PANCAKE_PAIR, abi: PAIR_ABI, functionName: 'getReserves' }),
      publicClient.readContract({ address: PANCAKE_PAIR, abi: PAIR_ABI, functionName: 'token0' }),
    ]);
    const tokenIs0 = token0.toLowerCase() === BOBAI_TOKEN.toLowerCase();
    mins = liqMins(LIQUIDITY_BOBAI, bnbForLiquidity, tokenIs0 ? reserves[0] : reserves[1], tokenIs0 ? reserves[1] : reserves[0]);
  } catch (e) {
    console.log(`[ERROR] The pair's reserves could not be read: ${e.message} — nothing was added, start again.`);
    process.exit(1);
  }
  if (!mins) {
    console.log('[ERROR] The pair reports no reserves — nothing was added.');
    process.exit(1);
  }
  const minToken = mins.tokenMin;
  const minBnb = mins.bnbMin;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log(`Router will use:    ${formatEther(mins.tokenUsed)} BOBAI + ${formatEther(mins.bnbUsed)} BNB (the rest stays on the wallet)`);
  console.log(`Min BOBAI accepted: ${formatEther(minToken)} (95%)`);
  console.log(`Min BNB accepted:   ${formatEther(minBnb)} (95%)`);

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
    const receipt = mustSucceed(await publicClient.waitForTransactionReceipt({ hash: addLiqTx }), 'the liquidity add');
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

  let burnTx;
  try {
    burnTx = await walletClient.writeContract({
      address: PANCAKE_PAIR,
      abi: PAIR_ABI,
      functionName: 'transfer',
      args: [DEAD_ADDRESS, lpBalance],
      gas: 100000n,
    });
    console.log(`LP Burn TX: https://bscscan.com/tx/${burnTx}`);
    mustSucceed(await publicClient.waitForTransactionReceipt({ hash: burnTx }), 'the LP burn');
    console.log(`BURNED ${formatEther(lpBalance)} LP tokens to ${DEAD_ADDRESS}`);
  } catch (e) {
    console.log(`[ERROR] LP burn failed: ${e.message}`);
    process.exit(1);
  }

  // Record the run so the dashboard can show what the manual side has added.
  // The bot's adds are logged by the bot itself; these were only ever written
  // down by hand, which is why the dashboard had no figure for them.
  try {
    const fs = require('fs');
    const logPath = require('path').join(__dirname, 'dashboard', 'liq-runs.json');
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    log.runs.push({
      time: new Date().toISOString(),
      lp: formatEther(lpBalance),
      bobai: formatEther(LIQUIDITY_BOBAI),
      bnb: formatEther(bnbForLiquidity),
      addLiqTx,
      lpBurnTx: burnTx,
    });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
    // The dashboard derives the dev LP total as a remainder against the live dead
    // balance, so the figure is already right without this file. Only the burn
    // count comes from here, which is why publishing it is useful but not urgent.
    console.log(`\nLogged to dashboard/liq-runs.json (add #${log.dev.burns + log.runs.length}) — deploy the dashboard to update the count.`);
  } catch (e) {
    console.log(`\n[WARN] Could not write dashboard/liq-runs.json: ${e.message}`);
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
