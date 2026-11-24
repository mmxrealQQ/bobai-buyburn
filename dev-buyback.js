// Dev Buyback Bot
// Created autonomously by Claude Opus 4.6
//
// Runs every 1 hour via Cloudflare Worker + GitHub Actions:
// 1. Checks creator wallet BNB balance
// 2. Reserves gas (0.003 BNB)
// 3. Splits: 80% personal (Binance), 4% builder #1-#4, 2% builder #5 + #6 (#5 out 2026-10-10, back 2026-11-09 on the operator's word)

const { createPublicClient, createWalletClient, http, fallback, formatEther, parseEther, parseAbi } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { resolvePending, mayStillLand } = require('./shared/dev-pending.js');

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const WBNB_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function withdraw(uint256 wad)',
]);
const fs = require('fs');

const PERSONAL_WALLET = '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C';
const BUILDER_1 = '0xede0e2bf714b50f131869c6a39abc5bed1e6ce47';
const BUILDER_2 = '0x7abada2b8430eee0acdce7ce9fc3f83bddb609b6';
const BUILDER_3 = '0x4fa13c52724bcadffefef91676cc429fa6216a48';
const BUILDER_4 = '0x257bA6d47Ae316526448b57d64e4fd18B3Fd4221';
const BUILDER_5 = '0xa2953b3A35B19fb0078A85A6C87b37F43C14fBB2';
const BUILDER_6 = '0xEB3DfBA4b66Cf4fB65420351964C114B9AF9a4F6';   // since 2026-10-01
const GAS_RESERVE = parseEther('0.003');
const MIN_BNB = parseEther('0.001');

// WHAT A SENT TRANSFER CAME TO — the same two helpers as the tax bot
// (worker/index.js): a receipt wait that throws is asked again before the
// transfer is given up, only status 'success' counts, and an error is logged
// without the RPC URL, which carries the key.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitMined(publicClient, hash) {
  try {
    return await publicClient.waitForTransactionReceipt({ hash });
  } catch (e) {
    console.log(`  receipt wait for ${hash} failed (${say(e)}) — asking again`);
  }
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    try {
      const rc = await publicClient.getTransactionReceipt({ hash });
      if (rc) return rc;
    } catch (e) { /* not there yet */ }
  }
  return null;
}
async function mined(publicClient, hash, what) {
  const rc = await waitMined(publicClient, hash);
  if (!rc) throw new Error(`${what}: no receipt for ${hash} — it may still arrive`);
  if (rc.status !== 'success') throw new Error(`${what}: ${hash} reverted`);
  return rc;
}
// ONE NODE WAS THE WHOLE SWEEP (Liste B 2, 2026-11-24) — the tax bot's fallback (worker/index.js), to the letter: the
// public BNB Chain nodes stand behind the first one, asked only when it fails, in this order; 'none' on a fork.
const FALLBACK_RPCS = ['https://bsc-dataseed.binance.org/', 'https://bsc-dataseed1.bnbchain.org', 'https://bsc-dataseed2.bnbchain.org'];
function rpcTransport(primary, fallbacks) {
  const urls = [primary, ...(fallbacks === 'none' ? [] : FALLBACK_RPCS)].filter((u, i, all) => u && all.indexOf(u) === i);
  return urls.length > 1 ? fallback(urls.map((u) => http(u)), { rank: false }) : http(urls[0]);
}
function say(e) {
  return String((e && e.message) || e).replace(/https?:[/][/][^ )"']+/g, '[rpc]');
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
  console.log(`Strategy: 80% -> personal (Binance), 4% -> builder #1-#4, 2% -> builder #5 + #6`);
  console.log('============================================');

  const publicClient = createPublicClient({
    chain: bsc,
    transport: rpcTransport(rpcUrl, process.env.BSC_RPC_FALLBACKS),
  });

  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport: rpcTransport(rpcUrl, process.env.BSC_RPC_FALLBACKS),
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
      await mined(publicClient, unwrapHash, 'unwrap');
      console.log(`  Unwrapped ${formatEther(wbnbBalance)} WBNB → BNB`);
    } catch (e) {
      console.log(`  Unwrap failed: ${say(e)}`);
    }
  }

  // the owed shares (see the split below), kept in dev-owed.json beside the log (the worker keeps them in KV)
  const loadPending = async () => { try { return fs.existsSync('dev-pending.json') ? JSON.parse(fs.readFileSync('dev-pending.json', 'utf8')) : {}; } catch { return {}; } };
  const savePending = async (o) => { try { if (Object.keys(o).length) fs.writeFileSync('dev-pending.json', JSON.stringify(o, null, 2)); else if (fs.existsSync('dev-pending.json')) fs.unlinkSync('dev-pending.json'); } catch (e) { console.log(`pending transfers not kept: ${say(e)}`); } };
  const loadOwed = async () => { try { return fs.existsSync('dev-owed.json') ? JSON.parse(fs.readFileSync('dev-owed.json', 'utf8')) : {}; } catch { return {}; } };
  const saveOwed = async (o) => { try { if (Object.keys(o).length) fs.writeFileSync('dev-owed.json', JSON.stringify(o, null, 2)); else if (fs.existsSync('dev-owed.json')) fs.unlinkSync('dev-owed.json'); } catch (e) { console.log(`owed shares not saved (${e.message}): ${JSON.stringify(o)}`); } };

  // A liquidity run on this wallet is not swept away (the worker waits up to 6 h; by hand: --force sweeps anyway)
  const bobaiHere = await publicClient.readContract({ address: BOBAI_TOKEN, abi: WBNB_ABI, functionName: 'balanceOf', args: [account.address] }).catch(() => null);
  if (bobaiHere !== null && bobaiHere > parseEther('809.41') && !process.argv.includes('--force')) {
    console.log(`${formatEther(bobaiHere)} BOBAI on the wallet: a liquidity run is waiting or under way — not swept (--force to sweep anyway).`);
    return;
  }

  // Step 1: Check BNB balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`BNB Balance: ${formatEther(balance)} BNB`);

  if (balance <= GAS_RESERVE + MIN_BNB) {
    console.log('Balance too low. Waiting for more BNB...');
    return;
  }

  const available = balance - GAS_RESERVE;
  console.log(`Available after gas reserve: ${formatEther(available)} BNB\n`);

  // WHAT A BUILDER IS STILL OWED IS PAID FIRST (A-Z 2026-11-21). A builder's transfer that failed left its share on the
  // wallet, and the next run split that BNB again: 80% of the builder's money went to the first wallet. Now a failed share
  // is written down by address, the next run pays it on top of the builder's new share, and only the rest is split.
  // TRANSFERS OF EARLIER RUNS WHOSE FATE WAS UNKNOWN (Liste B 2, shared/dev-pending.js): asked of the chain before anything
  // is paid — landed: paid; reverted or dropped: owed; still in the pool or no clear answer: this run waits
  {
    const pendingIn = await loadPending();
    if (Object.keys(pendingIn).length) {
      const rp = await resolvePending(pendingIn, await loadOwed(), publicClient);
      for (const n of rp.notes) console.log('  pending: ' + n);
      await saveOwed(rp.owed); await savePending(rp.pending);
      if (rp.waiting) { console.log('A builder transfer of an earlier run is not settled yet — waiting, nothing paid.'); return; }
    }
  }
  const owed = await loadOwed();
  const pendingNow = {};
  const owedTotal = Object.values(owed).reduce((a, v) => a + BigInt(v), 0n);
  if (owedTotal > 0n) console.log(`Owed from earlier runs: ${formatEther(owedTotal)} BNB`);
  if (owedTotal >= available) {
    console.log('Not enough to pay what is still owed — waiting for more BNB.');
    return;
  }
  const base = available - owedTotal;
  const due = (addr) => BigInt(owed[addr.toLowerCase()] || '0');

  // Split: 80% personal, 4% each builder #1-#4, 2% builder #5 + #6 — of what is not owed
  const builder1Amount = (base * 4n) / 100n;
  const builder2Amount = (base * 4n) / 100n;
  const builder3Amount = (base * 4n) / 100n;
  const builder4Amount = (base * 4n) / 100n;
  const builder5Amount = (base * 2n) / 100n;
  const builder6Amount = (base * 2n) / 100n;
  const personalAmount = base - builder1Amount - builder2Amount - builder3Amount - builder4Amount - builder5Amount - builder6Amount;

  const sends = [
    { label: 'Binance Wallet (80%)', to: PERSONAL_WALLET, value: personalAmount },
    { label: 'Builder #1 (4%)', to: BUILDER_1, value: builder1Amount + due(BUILDER_1) },
    { label: 'Builder #2 (4%)', to: BUILDER_2, value: builder2Amount + due(BUILDER_2) },
    { label: 'Builder #3 (4%)', to: BUILDER_3, value: builder3Amount + due(BUILDER_3) },
    { label: 'Builder #4 (4%)', to: BUILDER_4, value: builder4Amount + due(BUILDER_4) },
    { label: 'Builder #5 (2%)', to: BUILDER_5, value: builder5Amount + due(BUILDER_5) },
    { label: 'Builder #6 (2%)', to: BUILDER_6, value: builder6Amount + due(BUILDER_6) },
  ];

  // ONE BUILDER'S FAILED TRANSFER IS NOT EVERY BUILDER'S (2026-09-18). The loop
  // returned on the first failure. The first wallet goes first: if THAT fails
  // nothing has been sent, everything stays and the next run splits it — so it
  // still returns. A builder's transfer failing no longer stops the others, and
  // since 2026-11-21 its share is owed to it (paid first next run), not split.
  // A first-wallet transfer sent but never seen mined (it may still land) writes
  // every builder's share down as owed before it returns.
  let personalTxHash;
  const txs = {}, failed = [];
  for (const s of sends) {
    console.log(`--- Sending ${formatEther(s.value)} BNB to ${s.label} ---`);
    let hash = null;
    try {
      hash = await walletClient.sendTransaction({ to: s.to, value: s.value });
      console.log(`  TX: https://bscscan.com/tx/${hash}`);
      await mined(publicClient, hash, s.label);
      console.log('  Payment sent!');
      txs[s.label] = hash;
      if (s.to === PERSONAL_WALLET) personalTxHash = hash;
      else delete owed[s.to.toLowerCase()];
    } catch (e) {
      console.log(`  Payment failed: ${say(e)}`);
      if (s.to === PERSONAL_WALLET) {
        if (/no receipt/.test(String((e && e.message) || ''))) {
          for (const b of sends.slice(1)) owed[b.to.toLowerCase()] = String(b.value);
          await saveOwed(owed);
        }
        return;
      }
      // sent, but no receipt: it may still land — pending, asked of the chain next run, never owed blind (Liste B 2)
      if (hash && mayStillLand(e)) { pendingNow[s.to.toLowerCase()] = { hash, value: String(s.value) }; failed.push(`${s.label} (pending)`); continue; }
      owed[s.to.toLowerCase()] = String(s.value);
      failed.push(s.label);
    }
  }
  await saveOwed(owed);
  await savePending(pendingNow);

  // Step 3: Log
  try {
    const logFile = 'dev-buyback-log.json';
    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    logs.push({
      time: new Date().toISOString(),
      balanceBnb: formatEther(balance),
      availableBnb: formatEther(available),
      personalBnb: formatEther(personalAmount),
      builder1Bnb: formatEther(builder1Amount),
      builder2Bnb: formatEther(builder2Amount),
      builder3Bnb: formatEther(builder3Amount),
      builder4Bnb: formatEther(builder4Amount),
      builder5Bnb: formatEther(builder5Amount),
      builder6Bnb: formatEther(builder6Amount),
      personalTx: personalTxHash,
      txs,
      failed,
    });
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`\nLogged to ${logFile}`);
  } catch (e) {
    console.log('Failed to log:', e.message);
  }

  console.log('\n============================================');
  console.log(`[${new Date().toISOString()}] DEV BUYBACK COMPLETE`);
  console.log(`Sent: ${formatEther(personalAmount)} BNB Binance / ${formatEther(builder1Amount)} #1 / ${formatEther(builder2Amount)} #2 / ${formatEther(builder3Amount)} #3 / ${formatEther(builder4Amount)} #4 / ${formatEther(builder5Amount)} #5 / ${formatEther(builder6Amount)} #6`);
  console.log('============================================');
}

main().catch(console.error);
