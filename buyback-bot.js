// BOBAI Tax Distribution Bot
// Created autonomously by Claude Opus 4.6
//
// Runs via GitHub Actions every 10 minutes:
// 1. Checks buyback wallet for BNB from BOBAI 3% tax
// 2. Splits BNB three ways:
//    - 34% (1.0%) -> Creator wallet (revenue)
//    - 33% (1.0%) -> Buy $BOB + burn to dead address
//    - 33% (1.0%) -> Buy $BOBAI + burn to dead address (deflationary)
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
const BOB_WBNB_PAIR = '0x3c79593e01A7f7FeD5d0735B16621e2D52A6bC58';
const BOBAI_WBNB_PAIR = '0x6eaDD4CB786898B34929444988380ed0CC6fD9A6';
const PRIZE_POOL_WALLET = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
const MIN_BNB = parseEther('0.001');
const GAS_RESERVE = parseEther('0.003');

// ============================================
// Phase windows (UTC). Bot auto-switches based on current time.
// ============================================
// BOB Liq Boost: 0.5% of trade -> BOB/BNB perma liq + LP burn (from creator share)
const LIQ_BOOST_START = new Date('2026-04-21T00:01:00Z').getTime();
const LIQ_BOOST_END   = new Date('2026-06-04T23:59:00Z').getTime();

// BOBAI Liq Boost: 0.5% of trade -> BOBAI/BNB perma liq + LP burn (from BOB burn share)
const BOBAI_LIQ_BOOST_START = new Date('2026-06-01T00:00:00Z').getTime();
const BOBAI_LIQ_BOOST_END   = new Date('2026-08-01T23:59:59Z').getTime();

// WC26 Prize Pool: 0.52% of trade -> direct BNB to prize pool wallet (0.26% from creator + 0.26% from BOB burn)
const WC26_START = new Date('2026-06-11T00:01:00Z').getTime();
const WC26_END   = new Date('2026-07-19T23:59:00Z').getTime();

function isLiqBoostActive() {
  const now = Date.now();
  return now >= LIQ_BOOST_START && now <= LIQ_BOOST_END;
}
function isBobaiLiqBoostActive() {
  const now = Date.now();
  return now >= BOBAI_LIQ_BOOST_START && now <= BOBAI_LIQ_BOOST_END;
}
function isWc26Active() {
  const now = Date.now();
  return now >= WC26_START && now <= WC26_END;
}

// ============================================
// Tax allocation in basis points of trade (TAX_BPS = 300 means 3% total).
// Phase splits are built dynamically in main() and MUST sum to TAX_BPS.
//   Baseline (Standard): BOBAI burn 100 | BOB burn 100 | Creator 100
//   + BOB Liq Boost:     Creator -50, BOB liq +50
//   + BOBAI Liq Boost:   BOB burn -50, BOBAI liq +50
//   + WC26 Prize Pool:   Creator -26, BOB burn -26, WC26 pool +52
// Sum is verified before any on-chain action — bot aborts on mismatch.
// ============================================
const TAX_BPS = 300;

// ============================================
// Supabase REST helper (used to record WC26 TAX adds in wc_donations).
// Worldcup-bot picks pending TAX rows up at swap time and fills in amount_bobai.
// ============================================
async function sbInsert(table, row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('[sb] missing credentials — skipping insert'); return; }
  try {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.log(`[sb] insert ${table} failed: ${res.status} ${await res.text()}`);
  } catch (e) { console.log(`[sb] insert error: ${e.message}`); }
}

const WBNB_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function withdraw(uint256 wad)',
]);

const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
]);

const PAIR_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
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
      gas: 500000n,
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function addLiquidityAndBurn(walletClient, publicClient, account, bnbAmount, tokenAddress, pairAddress, tokenName) {
  const SLIPPAGE_PERCENT = 5;
  const SWAP_CHUNKS = 3;
  const halfBnb = bnbAmount / 2n;
  const liqBnb = bnbAmount - halfBnb;

  // Step 1: Buy token with half the BNB — chunked for MEV protection
  console.log(`  Buying ${tokenName} with ${formatEther(halfBnb)} BNB in ${SWAP_CHUNKS} chunks...`);
  const path = [WBNB, tokenAddress];
  const chunkSize = halfBnb / BigInt(SWAP_CHUNKS);

  for (let i = 0; i < SWAP_CHUNKS; i++) {
    const thisChunk = (i === SWAP_CHUNKS - 1) ? (halfBnb - chunkSize * BigInt(SWAP_CHUNKS - 1)) : chunkSize;
    console.log(`  Chunk ${i + 1}/${SWAP_CHUNKS}: ${formatEther(thisChunk)} BNB`);

    let amountsOut;
    try {
      amountsOut = await publicClient.readContract({
        address: PANCAKE_ROUTER_V2,
        abi: ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [thisChunk, path],
      });
      console.log(`    Expected ${tokenName}: ${formatEther(amountsOut[1])}`);
    } catch (e) {
      console.log(`    Quote failed: ${e.message}`);
      return null;
    }

    const minOut = (amountsOut[1] * BigInt(100 - SLIPPAGE_PERCENT)) / 100n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    try {
      const swapTx = await walletClient.writeContract({
        address: PANCAKE_ROUTER_V2,
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [minOut, path, account.address, deadline],
        value: thisChunk,
        gas: 300000n,
      });
      console.log(`    Swap TX: https://bscscan.com/tx/${swapTx}`);
      await publicClient.waitForTransactionReceipt({ hash: swapTx });
    } catch (e) {
      console.log(`    Swap chunk ${i + 1} failed: ${e.message}`);
      return null;
    }

    if (i < SWAP_CHUNKS - 1) {
      console.log('    Waiting 5s for next chunk...');
      await sleep(5000);
    }
  }

  // Step 2: Check token balance
  const tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (tokenBalance === 0n) {
    console.log(`  No ${tokenName} received.`);
    return null;
  }
  console.log(`  ${tokenName} received: ${formatEther(tokenBalance)}`);

  // Step 3: Approve token for Router
  try {
    const approveTx = await walletClient.writeContract({
      address: tokenAddress,
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      functionName: 'approve',
      args: [PANCAKE_ROUTER_V2, tokenBalance * 2n],
      gas: 100000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`  ${tokenName} approved for Router`);
  } catch (e) {
    console.log(`  Approve failed: ${e.message}`);
    return null;
  }

  // Step 4: Add Liquidity ETH — LP to own wallet first
  const addDeadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  let addLiqTxHash;
  try {
    addLiqTxHash = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2,
      abi: ROUTER_ABI,
      functionName: 'addLiquidityETH',
      args: [tokenAddress, tokenBalance, 0n, 0n, account.address, addDeadline],
      value: liqBnb,
      gas: 500000n,
    });
    console.log(`  Add Liq TX: https://bscscan.com/tx/${addLiqTxHash}`);
    await publicClient.waitForTransactionReceipt({ hash: addLiqTxHash });
    console.log('  Liquidity added!');
  } catch (e) {
    console.log(`  Add liquidity failed: ${e.message}`);
    return null;
  }

  // Step 5: Burn LP tokens — transfer to dead address
  const lpBalance = await publicClient.readContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (lpBalance === 0n) {
    console.log('  [WARN] No LP tokens on wallet!');
    return null;
  }

  let lpBurnTxHash;
  try {
    lpBurnTxHash = await walletClient.writeContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'transfer',
      args: [DEAD_ADDRESS, lpBalance],
      gas: 100000n,
    });
    console.log(`  LP Burn TX: https://bscscan.com/tx/${lpBurnTxHash}`);
    await publicClient.waitForTransactionReceipt({ hash: lpBurnTxHash });
    console.log(`  BURNED ${formatEther(lpBalance)} LP tokens to dead address`);
  } catch (e) {
    console.log(`  LP burn failed: ${e.message}`);
    return null;
  }

  return {
    bnb: formatEther(bnbAmount),
    tokensBought: formatEther(tokenBalance),
    lpBurned: formatEther(lpBalance),
    addLiqTx: addLiqTxHash,
    lpBurnTx: lpBurnTxHash,
  };
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.BUYBACK_PRIVATE_KEY;
  if (!privateKey) {
    console.log('[ERROR] No PRIVATE_KEY set');
    process.exit(1);
  }

  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);

  // Detect active phases (date-based, UTC, auto-switching)
  const bobLiqBoost   = isLiqBoostActive();
  const bobaiLiqBoost = isBobaiLiqBoostActive();
  const wc26Active    = isWc26Active();

  // Build per-phase BPS allocation from baseline (1/1/1)
  let bobaiBurnBps = 100;
  let bobBurnBps   = 100;
  let creatorBps   = 100;
  let bobLiqBps    = 0;
  let bobaiLiqBps  = 0;
  let wc26PoolBps  = 0;

  if (bobLiqBoost)   { creatorBps -= 50; bobLiqBps   += 50; }
  if (bobaiLiqBoost) { bobBurnBps -= 50; bobaiLiqBps += 50; }
  if (wc26Active)    { creatorBps -= 26; bobBurnBps  -= 26; wc26PoolBps += 52; }

  const bpsSum = bobaiBurnBps + bobBurnBps + creatorBps + bobLiqBps + bobaiLiqBps + wc26PoolBps;

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] BOBAI Tax Distribution Bot`);
  console.log(`Wallet: ${account.address}`);
  const phases = [];
  if (bobLiqBoost)   phases.push('BOB Liq Boost');
  if (bobaiLiqBoost) phases.push('BOBAI Liq Boost');
  if (wc26Active)    phases.push('WC26 Prize Pool');
  console.log(`Active phases: ${phases.length ? phases.join(' + ') : 'Standard 1/1/1'}`);
  console.log(`Split (bps of trade, total=${bpsSum}):`);
  console.log(`  BOBAI burn ${bobaiBurnBps}  |  BOB burn ${bobBurnBps}  |  Creator ${creatorBps}`);
  if (bobLiqBps)   console.log(`  BOB liq    ${bobLiqBps}`);
  if (bobaiLiqBps) console.log(`  BOBAI liq  ${bobaiLiqBps}`);
  if (wc26PoolBps) console.log(`  WC26 pool  ${wc26PoolBps}`);
  console.log('============================================');

  // SAFETY: refuse to act if shares don't sum to TAX_BPS.
  if (bpsSum !== TAX_BPS) {
    console.log(`[ABORT] BPS sum ${bpsSum} != ${TAX_BPS}. Config error — no TX sent.`);
    return;
  }

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
    console.log('Balance too low. Waiting for more tax fees...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available for distribution: ${formatEther(available)} BNB\n`);

  // Step 2: Compute BNB amounts per bucket.
  // BOBAI burn = residual so all wei are accounted for (no dust left on wallet).
  const creatorAmount     = (available * BigInt(creatorBps))   / BigInt(TAX_BPS);
  const bobBurnAmount     = (available * BigInt(bobBurnBps))   / BigInt(TAX_BPS);
  const bobLiqAddAmount   = (available * BigInt(bobLiqBps))    / BigInt(TAX_BPS);
  const bobaiLiqAddAmount = (available * BigInt(bobaiLiqBps))  / BigInt(TAX_BPS);
  const wc26PoolAmount    = (available * BigInt(wc26PoolBps))  / BigInt(TAX_BPS);
  const bobaiBurnAmount   = available - creatorAmount - bobBurnAmount
                                      - bobLiqAddAmount - bobaiLiqAddAmount - wc26PoolAmount;

  console.log(`Creator:     ${formatEther(creatorAmount)} BNB (${creatorBps} bps)`);
  console.log(`BOB burn:    ${formatEther(bobBurnAmount)} BNB (${bobBurnBps} bps)`);
  console.log(`BOBAI burn:  ${formatEther(bobaiBurnAmount)} BNB (${bobaiBurnBps} bps + dust residual)`);
  if (bobLiqBps)   console.log(`BOB liq:     ${formatEther(bobLiqAddAmount)} BNB (${bobLiqBps} bps)`);
  if (bobaiLiqBps) console.log(`BOBAI liq:   ${formatEther(bobaiLiqAddAmount)} BNB (${bobaiLiqBps} bps)`);
  if (wc26PoolBps) console.log(`WC26 pool:   ${formatEther(wc26PoolAmount)} BNB (${wc26PoolBps} bps)`);

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

  // Step 3b: BOB Liq Add (only during BOB Liq Boost window)
  // Run BEFORE WC26 send so the pool is deeper when worldcup-bot swaps the
  // prize-pool BNB → BOBAI in the same minute (less slippage on that swap).
  let bobLiqResult = null;
  const MIN_LIQ = parseEther('0.0003');
  if (bobLiqAddAmount > MIN_LIQ) {
    console.log(`\n--- Adding BOB/BNB Liquidity (${formatEther(bobLiqAddAmount)} BNB) → LP to Dead ---`);
    bobLiqResult = await addLiquidityAndBurn(walletClient, publicClient, account, bobLiqAddAmount, BOB_TOKEN, BOB_WBNB_PAIR, 'BOB');
    if (bobLiqResult) {
      console.log('  BOB Liq Add SUCCESS!');
    } else {
      console.log('  BOB Liq Add FAILED — BNB stays on wallet for next run.');
    }
  }

  // Step 3c: BOBAI Liq Add (only during BOBAI Liq Boost window)
  let bobaiLiqResult = null;
  if (bobaiLiqAddAmount > MIN_LIQ) {
    console.log(`\n--- Adding BOBAI/BNB Liquidity (${formatEther(bobaiLiqAddAmount)} BNB) → LP to Dead ---`);
    bobaiLiqResult = await addLiquidityAndBurn(walletClient, publicClient, account, bobaiLiqAddAmount, BOBAI_TOKEN, BOBAI_WBNB_PAIR, 'BOBAI');
    if (bobaiLiqResult) {
      console.log('  BOBAI Liq Add SUCCESS!');
    } else {
      console.log('  BOBAI Liq Add FAILED — BNB stays on wallet for next run.');
    }
  }

  // Step 3d: Send WC26 Prize Pool share (only during WC26 window).
  // Last in the funding chain so any Liq-Add above has already deepened the
  // pool before worldcup-bot picks up the BNB and swaps it → BOBAI.
  let wc26TxHash = null;
  if (wc26PoolAmount > 0n) {
    console.log(`\n--- Sending ${formatEther(wc26PoolAmount)} BNB to WC26 Prize Pool ---`);
    try {
      wc26TxHash = await walletClient.sendTransaction({
        to: PRIZE_POOL_WALLET,
        value: wc26PoolAmount,
      });
      console.log(`  TX: https://bscscan.com/tx/${wc26TxHash}`);
      await publicClient.waitForTransactionReceipt({ hash: wc26TxHash });
      console.log('  WC26 pool funded!');
      // Track this TAX add in wc_donations. amount_bobai stays null —
      // worldcup-bot fills it in (proportional) when it swaps the pool's BNB.
      await sbInsert('wc_donations', {
        from_address: account.address.toLowerCase(),
        token: 'TAX',
        amount_in: formatEther(wc26PoolAmount),
        amount_bobai: null,
        tx_hash: wc26TxHash,
        swap_tx_hash: null,
      });
    } catch (e) {
      console.log(`  WC26 pool send failed: ${e.message}`);
      wc26TxHash = null;
    }
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
    console.log('Failed to log burns:', e.message);
  }

  // Step 7: Log BOB liq boost (existing file, unchanged shape)
  if (bobLiqResult) {
    try {
      let liqLog = [];
      if (fs.existsSync('liq-boost-log.json')) {
        liqLog = JSON.parse(fs.readFileSync('liq-boost-log.json', 'utf8'));
      }
      liqLog.push({
        time: new Date().toISOString(),
        bnb: bobLiqResult.bnb,
        bobBought: bobLiqResult.tokensBought,
        lpBurned: bobLiqResult.lpBurned,
        addLiqTx: bobLiqResult.addLiqTx,
        lpBurnTx: bobLiqResult.lpBurnTx,
      });
      fs.writeFileSync('liq-boost-log.json', JSON.stringify(liqLog, null, 2));
      console.log('BOB liq boost logged to liq-boost-log.json');
    } catch (e) {
      console.log('Failed to log BOB liq boost:', e.message);
    }
  }

  // Step 8: Log BOBAI liq boost (new file, same shape)
  if (bobaiLiqResult) {
    try {
      let liqLog = [];
      if (fs.existsSync('bobai-liq-log.json')) {
        liqLog = JSON.parse(fs.readFileSync('bobai-liq-log.json', 'utf8'));
      }
      liqLog.push({
        time: new Date().toISOString(),
        bnb: bobaiLiqResult.bnb,
        bobaiBought: bobaiLiqResult.tokensBought,
        lpBurned: bobaiLiqResult.lpBurned,
        addLiqTx: bobaiLiqResult.addLiqTx,
        lpBurnTx: bobaiLiqResult.lpBurnTx,
      });
      fs.writeFileSync('bobai-liq-log.json', JSON.stringify(liqLog, null, 2));
      console.log('BOBAI liq boost logged to bobai-liq-log.json');
    } catch (e) {
      console.log('Failed to log BOBAI liq boost:', e.message);
    }
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DISTRIBUTION COMPLETE`);
  console.log(`Creator:    ${formatEther(creatorAmount)} BNB`);
  if (wc26TxHash)     console.log(`WC26 pool:  ${formatEther(wc26PoolAmount)} BNB`);
  if (bobLiqResult)   console.log(`BOB liq:    ${bobLiqResult.bnb} BNB → BOB/BNB LP burned`);
  if (bobaiLiqResult) console.log(`BOBAI liq:  ${bobaiLiqResult.bnb} BNB → BOBAI/BNB LP burned`);
  if (bobResult)      console.log(`BOB burned:   ${bobResult.amount}`);
  if (bobaiResult)    console.log(`BOBAI burned: ${bobaiResult.amount}`);
  console.log('============================================');
}

main().catch(console.error);
