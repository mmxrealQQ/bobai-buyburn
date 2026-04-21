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
const MIN_BNB = parseEther('0.001');
const GAS_RESERVE = parseEther('0.003');

// Liq Boost campaign window (UTC)
const LIQ_BOOST_START = new Date('2026-04-21T00:01:00Z').getTime();
const LIQ_BOOST_END = new Date('2026-06-04T23:59:00Z').getTime();

function isLiqBoostActive() {
  const now = Date.now();
  return now >= LIQ_BOOST_START && now <= LIQ_BOOST_END;
}

// Split ratios (must sum to 100)
const CREATOR_SHARE = 34;  // ~1% of trade -> creator revenue
const BOB_BURN_SHARE = 33; // ~1% of trade -> buy & burn $BOB
const BOBAI_BURN_SHARE = 33; // ~1% of trade -> buy & burn $BOBAI

// During liq boost: creator 34% splits into 17% creator + 17% liq add
const CREATOR_SHARE_BOOST = 17;
const LIQ_ADD_SHARE_BOOST = 17;

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

async function addLiquidityAndBurn(walletClient, publicClient, account, bnbAmount) {
  const SLIPPAGE_PERCENT = 2;
  const SWAP_CHUNKS = 3;
  const halfBnb = bnbAmount / 2n;
  const liqBnb = bnbAmount - halfBnb;

  // Step 1: Buy BOB with half the BNB — chunked for MEV protection
  console.log(`  Buying BOB with ${formatEther(halfBnb)} BNB in ${SWAP_CHUNKS} chunks...`);
  const path = [WBNB, BOB_TOKEN];
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
      console.log(`    Expected BOB: ${formatEther(amountsOut[1])}`);
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

  // Step 2: Check BOB balance
  const bobBalance = await publicClient.readContract({
    address: BOB_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (bobBalance === 0n) {
    console.log('  No BOB received.');
    return null;
  }
  console.log(`  BOB received: ${formatEther(bobBalance)}`);

  // Step 3: Approve BOB for Router
  try {
    const approveTx = await walletClient.writeContract({
      address: BOB_TOKEN,
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      functionName: 'approve',
      args: [PANCAKE_ROUTER_V2, bobBalance * 2n],
      gas: 100000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log('  BOB approved for Router');
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
      args: [BOB_TOKEN, bobBalance, 0n, 0n, account.address, addDeadline],
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
    address: BOB_WBNB_PAIR,
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
      address: BOB_WBNB_PAIR,
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
    bobBought: formatEther(bobBalance),
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

  const liqBoostActive = isLiqBoostActive();
  const activeCreatorShare = liqBoostActive ? CREATOR_SHARE_BOOST : CREATOR_SHARE;
  const activeLiqShare = liqBoostActive ? LIQ_ADD_SHARE_BOOST : 0;

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] BOBAI Tax Distribution Bot`);
  console.log(`Wallet: ${account.address}`);
  if (liqBoostActive) {
    console.log(`MODE: LIQ BOOST ACTIVE`);
    console.log(`Split: ${activeCreatorShare}% Creator | ${activeLiqShare}% Liq Add | ${BOB_BURN_SHARE}% BOB Burn | ${BOBAI_BURN_SHARE}% BOBAI Burn`);
  } else {
    console.log(`Split: ${CREATOR_SHARE}% Creator | ${BOB_BURN_SHARE}% BOB Burn | ${BOBAI_BURN_SHARE}% BOBAI Burn`);
  }
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
    console.log('Balance too low. Waiting for more tax fees...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available for distribution: ${formatEther(available)} BNB\n`);

  // Step 2: Calculate splits
  const creatorAmount = (available * BigInt(activeCreatorShare)) / 100n;
  const liqAddAmount = liqBoostActive ? (available * BigInt(activeLiqShare)) / 100n : 0n;
  const bobBurnAmount = (available * BigInt(BOB_BURN_SHARE)) / 100n;
  const bobaiBurnAmount = available - creatorAmount - liqAddAmount - bobBurnAmount;

  console.log(`Creator share:    ${formatEther(creatorAmount)} BNB (${activeCreatorShare}%)`);
  if (liqBoostActive) console.log(`Liq Add share:    ${formatEther(liqAddAmount)} BNB (${activeLiqShare}%)`);
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

  // Step 3b: Liq Add (only during boost campaign)
  let liqResult = null;
  const MIN_LIQ = parseEther('0.0003');
  if (liqBoostActive && liqAddAmount > MIN_LIQ) {
    console.log(`\n--- Adding BOB/BNB Liquidity (${formatEther(liqAddAmount)} BNB) → LP to Dead ---`);
    liqResult = await addLiquidityAndBurn(walletClient, publicClient, account, liqAddAmount);
    if (liqResult) {
      console.log('  Liq Add SUCCESS!');
    } else {
      console.log('  Liq Add FAILED — BNB stays on wallet for next run.');
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

  // Log liq boost if active and successful
  if (liqResult) {
    try {
      let liqLog = [];
      if (fs.existsSync('liq-boost-log.json')) {
        liqLog = JSON.parse(fs.readFileSync('liq-boost-log.json', 'utf8'));
      }
      liqLog.push({
        time: new Date().toISOString(),
        bnb: liqResult.bnb,
        bobBought: liqResult.bobBought,
        lpBurned: liqResult.lpBurned,
        addLiqTx: liqResult.addLiqTx,
        lpBurnTx: liqResult.lpBurnTx,
      });
      fs.writeFileSync('liq-boost-log.json', JSON.stringify(liqLog, null, 2));
      console.log('Liq boost logged to liq-boost-log.json');
    } catch (e) {
      console.log('Failed to log liq boost:', e.message);
    }
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DISTRIBUTION COMPLETE`);
  console.log(`Creator: ${formatEther(creatorAmount)} BNB`);
  if (liqResult) console.log(`Liq Add: ${liqResult.bnb} BNB → BOB/BNB LP burned`);
  if (bobResult) console.log(`BOB burned: ${bobResult.amount}`);
  if (bobaiResult) console.log(`BOBAI burned: ${bobaiResult.amount}`);
  console.log('============================================');
}

main().catch(console.error);
