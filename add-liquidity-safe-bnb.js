// BOBAI Safe Liquidity Add + LP Burn — FROM BNB
// The twin of add-liquidity-safe.js for fresh money (operator, 2026-11-21: "ich schicke nur BNB an den d38 ... nicht
// bobai zu bnb sondern bnb zu bobai, sonst alles gleich"). Send BNB to the creator wallet, then start this: it BUYS
// $BOBAI with part of the BNB (3 chunks, 2% slippage), adds the bought BOBAI with the rest of the BNB, and burns the
// LP to dead — the add, the minimums, the burn, the 808.41 that stay and the record in liq-runs.json are those of
// add-liquidity-safe.js. Nothing of the BOBAI already on the wallet (808.41) is touched.
//
// Usage: node add-liquidity-safe-bnb.js            (buy, add, burn)
//        node add-liquidity-safe-bnb.js --resume   (a run that stopped after its buy: add the BOBAI over 808.41 with the
//                                                    BNB on the wallet, burn the LP — no new buy, nothing sold)
//        node add-liquidity-safe-bnb.js --hold     (BEFORE sending the BNB: the dev sweep leaves the wallet alone, 6 h)
//        node add-liquidity-safe-bnb.js --release  (lift that hold when no run follows)
// Requires: PRIVATE_KEY in .env or environment

require('dotenv').config();
const { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PANCAKE_PAIR = '0x6eaDD4CB786898B34929444988380ed0CC6fD9A6'; // BOBAI/WBNB V2
const CREATOR_WALLET = '0x15Ba17075ef5E0736292b030e3715d9100fe3d38';

// --- CONFIG (as in add-liquidity-safe.js) ---
const KEEP_BOBAI = parseEther('808.41');
const SLIPPAGE_PERCENT = 2;
const SWAP_CHUNKS = 3;
const GAS_LIMIT = 500000n;
const GAS_RESERVE = parseEther('0.003'); // stays on the wallet for gas, as in add-liquidity-safe.js
const GAS_FLOOR = parseEther('0.002');   // the add may touch the reserve down to this, never below
const MIN_SPEND = parseEther('0.005');   // below this a run costs more in gas and tax than it is worth
// How much of the BNB buys BOBAI: worked out from the pair's reserves (V2 0.25% fee, 3% token tax on the bought
// BOBAI) so that what is left is just what the router needs to take ALL the bought BOBAI, plus this margin for a price
// that moves. The router sends back the BNB it does not take; that small rest stays on the wallet.
const MARGIN_BPS = 150n; // 1.5%

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);
const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
]);
const PAIR_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
]);

function mustSucceed(receipt, what) {
  if (!receipt || receipt.status !== 'success') throw new Error(`${what} did not succeed (status ${receipt ? receipt.status : 'unknown'}) — nothing after it was sent`);
  return receipt;
}
// The dev sweep (minute 0 of every hour) sends everything above 0.003 BNB on this wallet to the builder split — here
// that would be the very BNB sent for this run. Same window as add-liquidity-safe.js.
function inSweepWindow(now = new Date()) {
  const m = now.getUTCMinutes();
  return m >= 55 || m < 3;
}
// Same text as add-liquidity-safe.js / worker/index.js.
function liqMins(tokenAmount, bnbAmount, reserveToken, reserveBnb) {
  if (reserveToken <= 0n || reserveBnb <= 0n) return null;
  const bnbOptimal = (tokenAmount * reserveBnb) / reserveToken;
  const used = bnbOptimal <= bnbAmount
    ? { token: tokenAmount, bnb: bnbOptimal }
    : { token: (bnbAmount * reserveToken) / reserveBnb, bnb: bnbAmount };
  return { tokenUsed: used.token, bnbUsed: used.bnb, tokenMin: (used.token * 95n) / 100n, bnbMin: (used.bnb * 95n) / 100n };
}
// The BNB to spend on the buy: the largest s with s + (BNB the add needs for what s buys) x (1 + margin) <= spendable.
function buyShare(spendable, reserveToken, reserveBnb) {
  const out = (s) => (s * 9975n * reserveToken) / (reserveBnb * 10000n + s * 9975n);
  const fits = (s) => {
    const o = out(s);
    const received = (o * 97n) / 100n;
    const need = (received * (reserveBnb + s)) / (reserveToken - o);
    return s + (need * (10000n + MARGIN_BPS)) / 10000n <= spendable;
  };
  let lo = 0n, hi = spendable;
  for (let i = 0; i < 128 && hi - lo > 1n; i++) {
    const mid = (lo + hi) / 2n;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}
async function readReserves(publicClient) {
  const [reserves, token0] = await Promise.all([
    publicClient.readContract({ address: PANCAKE_PAIR, abi: PAIR_ABI, functionName: 'getReserves' }),
    publicClient.readContract({ address: PANCAKE_PAIR, abi: PAIR_ABI, functionName: 'token0' }),
  ]);
  const tokenIs0 = token0.toLowerCase() === BOBAI_TOKEN.toLowerCase();
  return { reserveToken: tokenIs0 ? reserves[0] : reserves[1], reserveBnb: tokenIs0 ? reserves[1] : reserves[0] };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RESUME, NOT SELL (Liste B 3, 2026-11-24): a run that stopped after buying told the operator to start
// add-liquidity-safe.js — which SELLS 51% of the BOBAI for BNB first. The BNB for the add is already on the wallet; selling
// the bought BOBAI back costs the 3% tax twice and the slippage. --resume skips the buy and adds what was bought.
const RESUME = process.argv.includes('--resume');
const RESUME_HINT = 'start  node add-liquidity-safe-bnb.js --resume  to add it (no new buy, nothing sold; the dev sweep waits up to 6 h while BOBAI lies here)';

// THE HOLD ON THE DEV SWEEP (Liste B 4, 2026-11-24): BNB sent here for this run lies here as plain BNB until the run buys,
// and the hourly dev sweep (worker-dev-buyback) took it 80/20 when a full hour fell in between. `--hold` (before the BNB
// is sent) and every run set liq-hold in the logs KV the sweep reads; the sweep waits while it stands. It ends by itself
// after 6 h, when a run is done, or with --release. Written with wrangler (logged in on this machine), no secret needed.
// LIQ_HOLD=off: a fork test, where no real KV may be touched.
const LOGS_KV = '630df426f6d84503b40460f13ab4b9f3', HOLD_TTL = 6 * 3600;
function liqHold(on) {
  if (process.env.LIQ_HOLD === 'off') return true;
  const { spawnSync } = require('child_process');
  const args = on
    ? ['wrangler', 'kv', 'key', 'put', 'liq-hold', new Date().toISOString(), '--namespace-id', LOGS_KV, '--ttl', String(HOLD_TTL), '--remote']
    : ['wrangler', 'kv', 'key', 'delete', 'liq-hold', '--namespace-id', LOGS_KV, '--remote'];
  // one command line (fixed words and an ISO time only — nothing from outside goes into it); npx is a .cmd on Windows
  const r = spawnSync(['npx', ...args].join(' '), { cwd: __dirname, encoding: 'utf8', shell: true, timeout: 120000 });
  return r.status === 0;
}

async function main() {
  if (process.argv.includes('--hold') || process.argv.includes('--release')) {
    const on = process.argv.includes('--hold');
    if (!liqHold(on)) { console.log(`[ERROR] The hold could not be ${on ? 'set' : 'lifted'} (wrangler kv). ${on ? 'Do not send BNB yet.' : 'It ends by itself 6 h after it was set.'}`); process.exit(1); }
    console.log(on ? `Hold set: the dev sweep leaves this wallet alone for ${HOLD_TTL / 3600} h. Send the BNB now, then start  node add-liquidity-safe-bnb.js  (from minute 03 of an hour).` : 'Hold lifted: the dev sweep runs again at the next full hour.');
    return;
  }
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) { console.log('[ERROR] No PRIVATE_KEY in .env'); process.exit(1); }
  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== CREATOR_WALLET.toLowerCase()) {
    console.error('[ERROR] PRIVATE_KEY does not open the creator wallet — nothing was sent.');
    console.error(`  Expected: ${CREATOR_WALLET}`);
    console.error(`  Got:      ${account.address}`);
    process.exit(1);
  }
  if (inSweepWindow()) {
    console.error('[WAIT] The dev sweep runs on this wallet at the full hour and would take the BNB of this run.');
    console.error('  Start again from minute 03 on (UTC). Nothing was sent.');
    process.exit(1);
  }
  // the run holds the sweep off itself too (a run that stops keeps the hold until --resume is done, or 6 h)
  if (!liqHold(true)) console.log('[WARN] The hold on the dev sweep could not be set (wrangler kv) — the run goes on; it is well before the full hour.');

  console.log('============================================');
  console.log('BOBAI Safe Liquidity Add + LP Burn — from BNB');
  console.log(`Wallet: ${account.address}`);
  console.log(`Keep:   ${formatEther(KEEP_BOBAI)} BOBAI, ${formatEther(GAS_RESERVE)} BNB for gas`);
  console.log(`Slippage:    ${SLIPPAGE_PERCENT}%`);
  console.log(`Swap chunks: ${SWAP_CHUNKS}`);
  console.log('============================================\n');

  const publicClient = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(rpcUrl) });

  const bobaiStart = await publicClient.readContract({ address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const bnbStart = await publicClient.getBalance({ address: account.address });
  console.log(`BOBAI balance: ${formatEther(bobaiStart)}`);
  console.log(`BNB balance:   ${formatEther(bnbStart)}`);
  // BOBAI over 808.41 already on the wallet is added too (it belongs in the pool, like add-liquidity-safe.js does);
  // under 808.41 nothing is taken from it — the run only adds what it buys.
  let BUY_AMOUNT = 0n;
  if (RESUME) {
    if (bobaiStart <= KEEP_BOBAI + parseEther('1')) { console.log(`[ERROR] --resume: no BOBAI over ${formatEther(KEEP_BOBAI)} on the wallet — nothing to add. Nothing was sent.`); process.exit(1); }
    console.log(`--resume: no buy — adding the ${formatEther(bobaiStart - KEEP_BOBAI)} BOBAI over ${formatEther(KEEP_BOBAI)} with the BNB on the wallet\n`);
  } else {
  const spendable = bnbStart > GAS_RESERVE ? bnbStart - GAS_RESERVE : 0n;
  if (spendable < MIN_SPEND) {
    console.log(`[ERROR] Only ${formatEther(spendable)} BNB above the ${formatEther(GAS_RESERVE)} gas reserve; send at least ${formatEther(MIN_SPEND)} BNB first. Nothing was sent.`);
    process.exit(1);
  }

  let r0;
  try { r0 = await readReserves(publicClient); } catch (e) { console.log(`[ERROR] The pair's reserves could not be read: ${e.message} — nothing was sent.`); process.exit(1); }
  BUY_AMOUNT = buyShare(spendable, r0.reserveToken, r0.reserveBnb);
  if (BUY_AMOUNT <= 0n) { console.log('[ERROR] No buy amount could be worked out — nothing was sent.'); process.exit(1); }
  console.log(`BNB for the run: ${formatEther(spendable)} -> buy ${formatEther(BUY_AMOUNT)} (${(Number((BUY_AMOUNT * 10000n) / spendable) / 100).toFixed(2)}%), the rest goes into the add\n`);

  // Step 1: Buy BOBAI with BNB in chunks
  console.log('--- Step 1: Swap BNB → BOBAI (chunked) ---');
  const chunkSize = BUY_AMOUNT / BigInt(SWAP_CHUNKS);
  const path = [WBNB, BOBAI_TOKEN];
  for (let i = 0; i < SWAP_CHUNKS; i++) {
    const thisChunk = (i === SWAP_CHUNKS - 1) ? (BUY_AMOUNT - chunkSize * BigInt(SWAP_CHUNKS - 1)) : chunkSize;
    console.log(`\n  Chunk ${i + 1}/${SWAP_CHUNKS}: ${formatEther(thisChunk)} BNB`);
    try {
      const amounts = await publicClient.readContract({ address: PANCAKE_ROUTER_V2, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [thisChunk, path] });
      const expectedPreTax = amounts[1];
      const expected = (expectedPreTax * 97n) / 100n; // the wallet receives 97% (3% token tax)
      const minOut = (expected * BigInt(100 - SLIPPAGE_PERCENT)) / 100n;
      console.log(`  Expected BOBAI (post-tax): ${formatEther(expected)}`);
      console.log(`  Min BOBAI (${SLIPPAGE_PERCENT}% slippage):  ${formatEther(minOut)}`);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const swapTx = await walletClient.writeContract({
        address: PANCAKE_ROUTER_V2, abi: ROUTER_ABI, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [minOut, path, account.address, deadline], value: thisChunk, gas: GAS_LIMIT,
      });
      console.log(`  Swap TX: https://bscscan.com/tx/${swapTx}`);
      mustSucceed(await publicClient.waitForTransactionReceipt({ hash: swapTx }), `swap chunk ${i + 1}`);
      console.log('  Swap done!');
    } catch (e) {
      console.log(`  [ERROR] Swap chunk ${i + 1} failed: ${e.message}`);
      if (i > 0) console.log(`  What the first ${i} chunk(s) bought stays on the wallet — ${RESUME_HINT}.`);
      process.exit(1);
    }
    if (i < SWAP_CHUNKS - 1) { console.log('  Waiting 5s for next chunk...'); await sleep(5000); }
  }

  }

  // Step 2: Approve Router for the BOBAI to add
  const bobaiNow = await publicClient.readContract({ address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  if (bobaiNow <= KEEP_BOBAI) { console.log(`[ERROR] No BOBAI over ${formatEther(KEEP_BOBAI)} after the buy — nothing was added.`); process.exit(1); }
  const LIQUIDITY_BOBAI = bobaiNow - KEEP_BOBAI;
  console.log('\n--- Step 2: Approve Router ---');
  const allowance = await publicClient.readContract({ address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, PANCAKE_ROUTER_V2] });
  if (allowance < LIQUIDITY_BOBAI) {
    const approveTx = await walletClient.writeContract({ address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'approve', args: [PANCAKE_ROUTER_V2, LIQUIDITY_BOBAI * 2n], gas: 100000n });
    console.log(`Approve TX: https://bscscan.com/tx/${approveTx}`);
    mustSucceed(await publicClient.waitForTransactionReceipt({ hash: approveTx }), 'the approve');
    console.log('Approved!');
  } else {
    console.log('Already approved.');
  }

  // Step 3: Add Liquidity — the same as add-liquidity-safe.js
  console.log('\n--- Step 3: Add Liquidity ---');
  const currentBnb = await publicClient.getBalance({ address: account.address });
  console.log(`Current BNB balance: ${formatEther(currentBnb)}`);
  let bnbForLiquidity = currentBnb > GAS_RESERVE ? currentBnb - GAS_RESERVE : 0n;
  let mins;
  try {
    const { reserveToken, reserveBnb } = await readReserves(publicClient);
    if (reserveToken > 0n) {
      const wanted = (((LIQUIDITY_BOBAI * reserveBnb) / reserveToken) * 101n) / 100n;
      const spendNow = currentBnb > GAS_FLOOR ? currentBnb - GAS_FLOOR : 0n;
      if (bnbForLiquidity < wanted) bnbForLiquidity = wanted < spendNow ? wanted : (spendNow > bnbForLiquidity ? spendNow : bnbForLiquidity);
    }
    mins = liqMins(LIQUIDITY_BOBAI, bnbForLiquidity, reserveToken, reserveBnb);
  } catch (e) {
    console.log(`[ERROR] The pair's reserves could not be read: ${e.message} — nothing was added, the BOBAI stays on the wallet; ${RESUME_HINT}.`);
    process.exit(1);
  }
  if (!mins || bnbForLiquidity <= 0n) { console.log(`[ERROR] No BNB available for liquidity — the bought BOBAI stays on the wallet; ${RESUME_HINT}.`); process.exit(1); }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  console.log(`BOBAI for liquidity: ${formatEther(LIQUIDITY_BOBAI)}`);
  console.log(`BNB for liquidity:   ${formatEther(bnbForLiquidity)}`);
  console.log(`Router will use:    ${formatEther(mins.tokenUsed)} BOBAI + ${formatEther(mins.bnbUsed)} BNB (the rest stays on the wallet)`);
  console.log(`Min BOBAI accepted: ${formatEther(mins.tokenMin)} (95%)`);
  console.log(`Min BNB accepted:   ${formatEther(mins.bnbMin)} (95%)`);
  let addLiqTx;
  try {
    addLiqTx = await walletClient.writeContract({
      address: PANCAKE_ROUTER_V2, abi: ROUTER_ABI, functionName: 'addLiquidityETH',
      args: [BOBAI_TOKEN, LIQUIDITY_BOBAI, mins.tokenMin, mins.bnbMin, account.address, deadline], value: bnbForLiquidity, gas: 500000n,
    });
    console.log(`Add Liquidity TX: https://bscscan.com/tx/${addLiqTx}`);
    const receipt = mustSucceed(await publicClient.waitForTransactionReceipt({ hash: addLiqTx }), 'the liquidity add');
    console.log(`Liquidity added in block ${receipt.blockNumber}!`);
  } catch (e) {
    console.log(`[ERROR] Add liquidity failed: ${e.message} — the bought BOBAI stays on the wallet; ${RESUME_HINT}.`);
    process.exit(1);
  }

  // Step 4: Burn LP tokens
  console.log('\n--- Step 4: Burn LP Tokens → Dead Address ---');
  const lpBalance = await publicClient.readContract({ address: PANCAKE_PAIR, abi: PAIR_ABI, functionName: 'balanceOf', args: [account.address] });
  console.log(`LP tokens to burn: ${formatEther(lpBalance)}`);
  if (lpBalance === 0n) { console.log('[WARN] No LP tokens found!'); process.exit(1); }
  let burnTx;
  try {
    burnTx = await walletClient.writeContract({ address: PANCAKE_PAIR, abi: PAIR_ABI, functionName: 'transfer', args: [DEAD_ADDRESS, lpBalance], gas: 100000n });
    console.log(`LP Burn TX: https://bscscan.com/tx/${burnTx}`);
    mustSucceed(await publicClient.waitForTransactionReceipt({ hash: burnTx }), 'the LP burn');
    console.log(`BURNED ${formatEther(lpBalance)} LP tokens to ${DEAD_ADDRESS}`);
  } catch (e) {
    console.log(`[ERROR] LP burn failed: ${e.message}`);
    process.exit(1);
  }

  const bobaiLeft = await publicClient.readContract({ address: BOBAI_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const bnbLeft = await publicClient.getBalance({ address: account.address });
  const bobaiAdded = LIQUIDITY_BOBAI - (bobaiLeft - KEEP_BOBAI);
  console.log(`\nBOBAI left on wallet: ${formatEther(bobaiLeft)}`);
  console.log(`BNB left on wallet:   ${formatEther(bnbLeft)}`);
  if (bobaiLeft !== KEEP_BOBAI) console.log(`[WARN] Not exactly ${formatEther(KEEP_BOBAI)}: ${formatEther(bobaiLeft - KEEP_BOBAI)} BOBAI over — start add-liquidity-safe.js once.`);

  // done: the dev sweep may run again
  if (liqHold(false)) console.log('The hold on the dev sweep is lifted.');
  else console.log('[WARN] The hold on the dev sweep could not be lifted — it ends by itself 6 h after it was set (or: node add-liquidity-safe-bnb.js --release).');

  // The record, as add-liquidity-safe.js writes it (LIQ_RUNS_LOG only for a fork test, so it never touches the real file).
  try {
    const fs = require('fs');
    const logPath = process.env.LIQ_RUNS_LOG || require('path').join(__dirname, 'dashboard', 'liq-runs.json');
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    log.runs.push({ time: new Date().toISOString(), lp: formatEther(lpBalance), bobai: formatEther(bobaiAdded), bnb: formatEther(mins.bnbUsed), addLiqTx, lpBurnTx: burnTx, from: 'bnb' });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
    console.log(`\nLogged to ${process.env.LIQ_RUNS_LOG ? logPath : 'dashboard/liq-runs.json'} (add #${log.dev.burns + log.runs.length}) — deploy the dashboard to update the count.`);
  } catch (e) {
    console.log(`\n[WARN] Could not write the run log: ${e.message}`);
  }

  console.log('\n============================================');
  console.log('DONE!');
  console.log(RESUME ? "Bought:   nothing (--resume)" : `Bought:   ${formatEther(BUY_AMOUNT)} BNB → BOBAI`);
  console.log(`Added:    ${formatEther(bobaiAdded)} BOBAI + ${formatEther(mins.bnbUsed)} BNB`);
  console.log(`LP Burned: ${formatEther(lpBalance)} Cake-LP → Dead`);
  console.log('============================================');
}

if (require.main === module) {
  main().catch((e) => { console.error('[FATAL]', e.message); process.exit(1); });
}
module.exports = { buyShare, liqMins };
