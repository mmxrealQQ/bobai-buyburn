// BOBAI Worldcup '26 — Prize-Pool Donation Bot
//
// Runs every 10 min via GitHub Actions (triggered by worker-wc Cron Worker):
// 1. Reads BNB + USDT balance of PRIZE_WALLET (0x5E41…D105)
// 2. If BNB > MIN_SWAP_BNB + GAS_RESERVE: swap (balance - GAS_RESERVE) → BOBAI
// 3. If USDT > MIN_SWAP_USDT and BNB ≥ GAS_RESERVE: approve + swap USDT → BNB → BOBAI
// 4. Logs each swap to Supabase `wc_donations` (one row per swap)
//
// Donations + tax adds (incoming txs) are NOT tracked by this bot — the UI shows
// them live by querying BscScan for the prize wallet. wc_donations only logs the
// bot's swap actions (what BNB/USDT got converted to how much BOBAI).
//
// 100% transparent — every swap tx is on-chain and linked from the prize-pool UI.

const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther, parseUnits, formatUnits } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

// ─── Constants ──────────────────────────────────────────────────────────────
const PRIZE_WALLET    = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
const BOBAI           = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB            = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT            = '0x55d398326f99059fF775485246999027B3197955';
const PANCAKE_ROUTER  = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const GAS_RESERVE      = parseEther('0.003');       // keep 0.003 BNB after a BNB swap
const MIN_SWAP_GAS     = parseEther('0.0015');      // approve+swap can hit ~0.0009 BNB on busy blocks — 0.0015 gives buffer
const MIN_SWAP_BNB     = parseEther('0.002');       // swap if balance > GAS_RESERVE + this (i.e. > 0.005 BNB)
const MIN_SWAP_USDT    = parseUnits('2', 18);       // swap only if ≥2 USDT (BSC USDT = 18 dec)
const SLIPPAGE_BPS     = 1000n;                     // 10 % (covers BOBAI 3 % tax + market slip)
const TX_DEADLINE_SEC  = 600;                       // 10 min

const ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
]);
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint)',
]);
const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 r0, uint112 r1, uint32 ts)',
]);
const CHAINLINK_ABI = parseAbi([
  'function latestAnswer() view returns (int256)',
]);

// Chainlink BNB/USD feed on BSC (8 decimals). Used as last-resort price fallback.
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';

// Sanity bounds for BOBAI/USD (refuse to write absurd values during edge cases)
const PRICE_MIN_USD = 1e-7;
const PRICE_MAX_USD = 1e-2;
function isSanePrice(p){ return Number.isFinite(p) && p >= PRICE_MIN_USD && p <= PRICE_MAX_USD; }

// ─── Supabase REST helpers ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SB_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbInsert(table, row){
  if (!SUPABASE_URL || !SB_KEY) { console.log('[sb] missing credentials — skipping insert'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.log(`[sb] insert ${table} failed: ${res.status} ${await res.text()}`);
  } catch (e) { console.log(`[sb] insert error: ${e.message}`); }
}

async function sbPatch(table, query, row){
  if (!SUPABASE_URL || !SB_KEY) { console.log('[sb] missing credentials — skipping patch'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.log(`[sb] patch ${table} failed: ${res.status} ${await res.text()}`);
  } catch (e) { console.log(`[sb] patch error: ${e.message}`); }
}

// ─── Prize-pool sync (mirrors worker-wc syncPool — keep in lockstep!) ───────
// Why inline: worker-wc cron runs */10 independently of this script. Without
// this, dashboards & TG alerts would show stale total_bobai for up to 10 min
// after a swap. Patching wc_pool here BEFORE the wc_donations insert means
// any reader who notices the new donation row also sees the fresh pool total.
const BOBAI_PAIR  = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const KICKOFF_UTC   = new Date('2026-06-11T19:00:00Z').getTime();
const GROUP_END_UTC = new Date('2026-06-27T00:00:00Z').getTime();
const FINAL_END_UTC = new Date('2026-07-20T00:00:00Z').getTime();

function computePots(total, now){
  if (now < GROUP_END_UTC) return { group: total*0.60, end: total*0.30, crypto: total*0.10 };
  if (now < FINAL_END_UTC) return { group: 0,           end: total*0.90, crypto: total*0.10 };
  return { group: 0, end: 0, crypto: 0 };
}

async function fetchBobaiPriceOnchain(publicClient){
  try {
    const [r0, r1] = await publicClient.readContract({ address: BOBAI_PAIR, abi: PAIR_ABI, functionName: 'getReserves' });
    // BOBAI is token0 in this pair (BOBAI hex < WBNB hex, verified on-chain 2026-05-21)
    if (r0 === 0n || r1 === 0n) { console.log('[price] onchain: zero reserves'); return null; }
    const bnbUsdRaw = await publicClient.readContract({ address: CHAINLINK_BNB_USD, abi: CHAINLINK_ABI, functionName: 'latestAnswer' });
    const bnbUsd = Number(bnbUsdRaw) / 1e8;
    if (!(bnbUsd > 0)) { console.log('[price] onchain: bad BNB/USD'); return null; }
    const bobaiPerBnb = Number(r0) / Number(r1);
    const price = bnbUsd / bobaiPerBnb;
    if (!isSanePrice(price)) { console.log(`[price] onchain: sanity check failed (${price})`); return null; }
    return price;
  } catch (e) { console.log(`[price] onchain: ${e.message}`); return null; }
}

async function fetchBobaiPriceUsd(publicClient){
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_PAIR}?_=${Date.now()}`,
      { headers: { Accept: 'application/json' } });
    if (r.ok) {
      const d = await r.json();
      const p = parseFloat(d?.data?.attributes?.base_token_price_usd);
      if (isSanePrice(p)) return p;
    }
  } catch (e) { console.log(`[price] gecko: ${e.message}`); }
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${BOBAI}`);
    if (r.ok) {
      const d = await r.json();
      const pair = (d?.pairs || []).find(p => p.pairAddress?.toLowerCase() === BOBAI_PAIR.toLowerCase()) || (d?.pairs || [])[0];
      const p = parseFloat(pair?.priceUsd);
      if (isSanePrice(p)) return p;
    }
  } catch (e) { console.log(`[price] dexscreener: ${e.message}`); }
  // On-chain last-resort fallback (pair reserves × Chainlink BNB/USD)
  if (publicClient) {
    const onchain = await fetchBobaiPriceOnchain(publicClient);
    if (onchain) { console.log('[price] using on-chain fallback'); return onchain; }
  }
  return null;
}

async function syncPool(publicClient){
  try {
    const balWei = await publicClient.readContract({ address: BOBAI, abi: ERC20_ABI, functionName: 'balanceOf', args: [PRIZE_WALLET] });
    const total  = Number(balWei) / 1e18;
    const price  = await fetchBobaiPriceUsd(publicClient);
    const pots   = computePots(total, Date.now());
    await sbPatch('wc_pool', 'id=eq.1', {
      total_bobai:     total,
      group_pot:       pots.group,
      endpool:         pots.end,
      crypto_pot:      pots.crypto,
      bobai_price_usd: price,
      updated_at:      new Date().toISOString(),
    });
    console.log(`[pool] synced: ${total.toFixed(0)} BOBAI @ $${price ?? '?'}`);
  } catch (e) { console.log(`[pool] sync failed: ${e.message}`); }
}

// ─── Receipt parsing — extract BOBAI received from Transfer logs ────────────
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function parseBobaiReceived(receipt, recipient){
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== BOBAI.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    const to = '0x' + log.topics[2].slice(26);
    if (to.toLowerCase() !== recipient.toLowerCase()) continue;
    total += BigInt(log.data);
  }
  return total;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main(){
  const pk = process.env.PRIZE_PRIVATE_KEY;
  if (!pk) { console.log('[ERROR] PRIZE_PRIVATE_KEY not set'); process.exit(1); }

  const rpcUrl  = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
  if (account.address.toLowerCase() !== PRIZE_WALLET.toLowerCase()) {
    console.log(`[ERROR] Wallet mismatch — key derives ${account.address}, expected ${PRIZE_WALLET}`);
    process.exit(1);
  }

  const publicClient = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(rpcUrl) });

  console.log('============================================');
  console.log(`[${new Date().toISOString()}] Worldcup Donation Bot`);
  console.log(`Wallet: ${account.address}`);
  console.log('============================================');

  const bnbBalance  = await publicClient.getBalance({ address: account.address });
  const usdtBalance = await publicClient.readContract({ address: USDT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  console.log(`BNB balance:  ${formatEther(bnbBalance)}`);
  console.log(`USDT balance: ${formatUnits(usdtBalance, 18)}`);

  let didAnything = false;

  // ─── BNB → BOBAI ──────────────────────────────────────────────────────────
  if (bnbBalance > GAS_RESERVE + MIN_SWAP_BNB) {
    const amountIn = bnbBalance - GAS_RESERVE;
    console.log(`\n--- Swapping ${formatEther(amountIn)} BNB → BOBAI ---`);
    const path = [WBNB, BOBAI];
    try {
      const amounts = await publicClient.readContract({
        address: PANCAKE_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut',
        args: [amountIn, path],
      });
      const expected   = amounts[1];
      const amountMin  = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
      console.log(`Expected: ${formatEther(expected)} BOBAI`);
      console.log(`Min out:  ${formatEther(amountMin)} BOBAI (10 % slippage)`);

      const hash = await walletClient.writeContract({
        address: PANCAKE_ROUTER, abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [amountMin, path, account.address, BigInt(Math.floor(Date.now()/1000) + TX_DEADLINE_SEC)],
        value: amountIn,
      });
      console.log(`Swap TX: https://bscscan.com/tx/${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const got = parseBobaiReceived(receipt, account.address);
      console.log(`Received: ${formatEther(got)} BOBAI`);

      // Sync wc_pool BEFORE inserting the donation row so any reader who sees
      // the new wc_donations entry also sees the matching total_bobai.
      await syncPool(publicClient);

      await sbInsert('wc_donations', {
        from_address: account.address,
        token: 'BNB',
        amount_in: formatEther(amountIn),
        amount_bobai: formatEther(got),
        tx_hash: hash,
        swap_tx_hash: hash,
      });
      didAnything = true;
    } catch (e) {
      console.log(`BNB swap failed: ${e.message}`);
    }
  } else {
    console.log(`BNB below threshold (need ${formatEther(GAS_RESERVE + MIN_SWAP_BNB)} BNB) — skipping.`);
  }

  // ─── USDT → BNB → BOBAI (multi-hop) ───────────────────────────────────────
  // Only need ~0.0007 BNB gas for the swap, not the full GAS_RESERVE — checking
  // against MIN_SWAP_GAS lets us swap even if a prior BNB-swap tx nibbled the reserve.
  const bnbAfter = await publicClient.getBalance({ address: account.address });
  if (usdtBalance >= MIN_SWAP_USDT && bnbAfter >= MIN_SWAP_GAS) {
    console.log(`\n--- Swapping ${formatUnits(usdtBalance, 18)} USDT → BNB → BOBAI ---`);
    try {
      // Approve USDT to router if needed
      const allowance = await publicClient.readContract({
        address: USDT, abi: ERC20_ABI, functionName: 'allowance',
        args: [account.address, PANCAKE_ROUTER],
      });
      if (allowance < usdtBalance) {
        console.log('Approving USDT to PancakeRouter…');
        const approveHash = await walletClient.writeContract({
          address: USDT, abi: ERC20_ABI, functionName: 'approve',
          args: [PANCAKE_ROUTER, parseUnits('1000000000000', 18)],  // ~max
        });
        console.log(`Approve TX: https://bscscan.com/tx/${approveHash}`);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const path = [USDT, WBNB, BOBAI];
      const amounts = await publicClient.readContract({
        address: PANCAKE_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut',
        args: [usdtBalance, path],
      });
      const expected  = amounts[2];
      const amountMin = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
      console.log(`Expected: ${formatEther(expected)} BOBAI`);
      console.log(`Min out:  ${formatEther(amountMin)} BOBAI`);

      const hash = await walletClient.writeContract({
        address: PANCAKE_ROUTER, abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
        args: [usdtBalance, amountMin, path, account.address, BigInt(Math.floor(Date.now()/1000) + TX_DEADLINE_SEC)],
      });
      console.log(`Swap TX: https://bscscan.com/tx/${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const got = parseBobaiReceived(receipt, account.address);
      console.log(`Received: ${formatEther(got)} BOBAI`);

      // Sync wc_pool BEFORE inserting the donation row (see BNB branch).
      await syncPool(publicClient);

      await sbInsert('wc_donations', {
        from_address: account.address,
        token: 'USDT',
        amount_in: formatUnits(usdtBalance, 18),
        amount_bobai: formatEther(got),
        tx_hash: hash,
        swap_tx_hash: hash,
      });
      didAnything = true;
    } catch (e) {
      console.log(`USDT swap failed: ${e.message}`);
    }
  } else if (usdtBalance >= MIN_SWAP_USDT) {
    console.log(`USDT swap skipped — not enough BNB for gas (${formatEther(bnbAfter)} < ${formatEther(MIN_SWAP_GAS)}).`);
  } else {
    console.log(`USDT below threshold (need ${formatUnits(MIN_SWAP_USDT, 18)} USDT) — skipping.`);
  }

  console.log('\n============================================');
  console.log(`Done. ${didAnything ? 'Swap(s) executed.' : 'Nothing to swap.'}`);
  console.log('============================================');
}

main().catch(e => { console.error(e); process.exit(1); });
