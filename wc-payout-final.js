// $BOBAI Worldcup '26 — End-Pool + Crypto-Pot Payout Script (after the Final)
//
// End-Pool: top-4 wallet-linked players by total_points (match + bonus),
//   tiered 50/25/15/10, 26x holder-cap cascade within the pot
//   (cap 0 → forfeit, share redistributes proportionally — group-pot precedent,
//   user-confirmed 2026-07-20 for Dgn).
// Crypto: 3 sub-pots (crypto_pot / 3), winner-take-all per coin. Winner = closest
//   guess vs. frozen Final-kickoff price among wallet-linked players WITH BOBAI
//   holdings (cap 0 → next closest wins — user-confirmed 2026-07-20: Havy → Beso2025).
//
// Usage:
//   node -r dotenv/config wc-payout-final.js                  # DRY-RUN (default)
//   node -r dotenv/config wc-payout-final.js --write-rows     # insert wc_payouts rows (tx=null)
//   node -r dotenv/config wc-payout-final.js --sign           # broadcast TXs (resume-safe)
//
// Env: SUPABASE_SERVICE_ROLE_KEY, PRIZE_PRIVATE_KEY (--sign only)

const fs = require('fs');
const path = require('path');
const {
  createPublicClient, createWalletClient, http, parseAbi, parseUnits,
} = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

// ─── Constants ──────────────────────────────────────────────────────────────
const PRIZE_WALLET = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
const BOBAI        = '0x245c386dcfed896f5c346107596141e5edcbffff';
const END_TIERS    = [0.50, 0.25, 0.15, 0.10];
const HOLDER_CAP_MULTIPLE = 26;
// Frozen Final-kickoff prices (2026-07-19T19:00:00.000Z) — see wc-final-kickoff-prices.json
const KICKOFF = { btc: 64420.00, bnb: 567.47, bobai: 0.0000553231784899214 };
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aerffjhdsbxpvuulkryr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SIGN       = args.includes('--sign');
const WRITE_ROWS = args.includes('--write-rows');
const FORCE      = args.includes('--force');
const JSON_OUT   = 'wc-payout-final-snapshot.json';

// ─── Supabase REST helpers ──────────────────────────────────────────────────
async function sbReq(method, urlPath, body){
  if (!SB_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${urlPath}`, {
    method,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${urlPath} → ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function sbRpc(name, params){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC ${name} → ${res.status}: ${text.slice(0,200)}`);
  return JSON.parse(text);
}

// ─── On-chain ───────────────────────────────────────────────────────────────
const BSC_RPC = process.env.BSC_RPC || 'https://bsc-dataseed.binance.org/';
const transport = http(BSC_RPC, { batch: false, retryCount: 3, retryDelay: 600 });
const publicClient = createPublicClient({ chain: bsc, transport });

async function readBobaiBalance(addr){
  try {
    const wei = await publicClient.readContract({
      address: BOBAI, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr],
    });
    return Number(wei) / 1e18;
  } catch (e) {
    console.warn(`  [balance] ${addr.slice(0,8)}… failed: ${e.message}`);
    return 0;
  }
}

// ─── 26x cap cascade (same as group payout) ─────────────────────────────────
function applyCapCascade(winners){
  winners.forEach(w => { w.final = 0; w.locked = w.cap <= 0; });
  let remaining = winners.reduce((s, w) => s + w._raw, 0);
  let rounds = 0;
  while (remaining > 1e-6 && rounds++ < 100) {
    const unlocked = winners.filter(w => !w.locked);
    if (!unlocked.length) break;
    const totalRaw = unlocked.reduce((s, w) => s + w._raw, 0);
    if (totalRaw <= 0) break;
    let distributed = 0, newCap = false;
    for (const w of unlocked) {
      const slice = remaining * w._raw / totalRaw;
      const room = w.cap - w.final;
      if (slice >= room) { w.final = w.cap; w.locked = true; distributed += room; newCap = true; }
      else { w.final += slice; distributed += slice; }
    }
    remaining -= distributed;
    if (!newCap) break;
  }
  return { rounds, residualBobai: Math.max(0, remaining) };
}

const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pad = (s, n) => String(s ?? '').padEnd(n);

// ─── Build snapshot ─────────────────────────────────────────────────────────
async function buildSnapshot(){
  const pool = (await sbReq('GET', 'wc_pool?select=*'))[0];
  const endPot    = Number(pool.endpool);
  const cryptoPot = Number(pool.crypto_pot);
  const coinPot   = cryptoPot / 3;
  const priceUsd  = Number(pool.bobai_price_usd) || null;

  // END-POOL: top-4 wallet-linked by total_points
  const lb = await sbRpc('wc_overall_leaderboard_ranked', {});
  const eligible = lb.filter(r => r.has_wallet);
  const top4 = eligible.slice(0, 4);
  if (top4.length !== 4) throw new Error(`Expected 4 end-pool winners, got ${top4.length}`);

  // CRYPTO: ranked by |tip - kickoff| per coin, wallet-linked only
  const crypto = await sbReq('GET', 'wc_crypto?select=user_id,btc_price,bnb_price,bobai_price');
  const users  = await sbReq('GET', 'wc_users?select=id,username,avatar_country,wallet');
  const userById = new Map(users.map(u => [u.id, u]));

  // Collect every wallet we might need a balance for
  const winners = [];
  for (let i = 0; i < top4.length; i++) {
    const u = userById.get(top4[i].user_id);
    winners.push({
      pot: 'end', position: `end_${i+1}`, user_id: top4[i].user_id,
      username: u.username, country_code: u.avatar_country, wallet: u.wallet,
      points: Number(top4[i].total_points), _raw: endPot * END_TIERS[i],
    });
  }

  const coinRankings = {};
  for (const coin of ['btc', 'bnb', 'bobai']) {
    coinRankings[coin] = crypto
      .filter(r => r[coin + '_price'] != null)
      .map(r => ({ ...r, _diff: Math.abs(Number(r[coin + '_price']) - KICKOFF[coin]), _u: userById.get(r.user_id) }))
      .filter(r => r._u && r._u.wallet)
      .sort((a, b) => a._diff - b._diff);
  }

  // Balances for everyone potentially involved (top4 + top-5 per coin ranking)
  const addrs = new Set(winners.map(w => w.wallet.toLowerCase()));
  Object.values(coinRankings).forEach(rk => rk.slice(0, 5).forEach(r => addrs.add(r._u.wallet.toLowerCase())));
  console.log(`Reading on-chain BOBAI balance for ${addrs.size} unique wallets…`);
  const balMap = new Map();
  for (const a of addrs) balMap.set(a, await readBobaiBalance(a));

  // END-POOL cascade
  for (const w of winners) {
    w.balance = balMap.get(w.wallet.toLowerCase()) || 0;
    w.cap = w.balance * HOLDER_CAP_MULTIPLE;
  }
  const endCascade = applyCapCascade(winners);
  winners.forEach(w => { w.capHit = w.locked && w._raw > w.cap; });

  // CRYPTO: winner-take-all per coin — first ranked player with cap > pot-share… no:
  // cap 0 → skip to next; cap between 0 and pot → they win but payout is capped,
  // residual per-pot → LP+burn (per published per-pot overflow rule).
  const skipped = [];
  for (const coin of ['btc', 'bnb', 'bobai']) {
    let winner = null;
    for (const cand of coinRankings[coin]) {
      const bal = balMap.get(cand._u.wallet.toLowerCase());
      if (bal === undefined) { balMap.set(cand._u.wallet.toLowerCase(), await readBobaiBalance(cand._u.wallet)); }
      const balance = balMap.get(cand._u.wallet.toLowerCase()) || 0;
      if (balance * HOLDER_CAP_MULTIPLE <= 0) {
        skipped.push({ coin, username: cand._u.username, reason: 'holds 0 BOBAI → cap 0 → next closest' });
        continue;
      }
      winner = { cand, balance };
      break;
    }
    if (!winner) throw new Error(`No eligible ${coin} winner with holdings found`);
    const cap = winner.balance * HOLDER_CAP_MULTIPLE;
    const final = Math.min(coinPot, cap);
    winners.push({
      pot: 'crypto', position: `crypto_${coin}`, user_id: winner.cand.user_id,
      username: winner.cand._u.username, country_code: winner.cand._u.avatar_country,
      wallet: winner.cand._u.wallet, tip: Number(winner.cand[coin + '_price']),
      diff: winner.cand._diff, balance: winner.balance, cap,
      _raw: coinPot, final, capHit: final < coinPot,
    });
  }

  const totals = {
    rawTotal: winners.reduce((s, w) => s + w._raw, 0),
    toSend:   winners.reduce((s, w) => s + w.final, 0),
  };
  const residual = totals.rawTotal - totals.toSend;

  return {
    generatedAt: new Date().toISOString(),
    pots: { endPot, cryptoPot, coinPot },
    kickoffPrices: KICKOFF,
    bobaiPriceUsd: priceUsd,
    endCascade, totals, residual, skipped,
    winners: winners.map(w => ({
      pot: w.pot, position: w.position, user_id: w.user_id, username: w.username,
      country_code: w.country_code, wallet: w.wallet,
      points: w.points ?? null, tip: w.tip ?? null, diff: w.diff ?? null,
      balance: w.balance, cap: w.cap, raw: w._raw, _raw: w._raw,
      final: w.final, capHit: !!w.capHit, tx_hash: null, paid_at: null,
    })),
  };
}

function printSummary(s){
  console.log('\n===========================================================');
  console.log(`  $BOBAI WORLDCUP '26 — END-POOL + CRYPTO PAYOUT SNAPSHOT`);
  console.log('===========================================================');
  console.log(`  generated:   ${s.generatedAt}`);
  console.log(`  end-pool:    ${fmt(s.pots.endPot)} BOBAI  (tiers 50/25/15/10)`);
  console.log(`  crypto-pot:  ${fmt(s.pots.cryptoPot)} BOBAI  (${fmt(s.pots.coinPot)} per coin)`);
  console.log(`  to send:     ${fmt(s.totals.toSend)} BOBAI`);
  console.log(`  residual:    ${fmt(s.residual)} BOBAI  (→ LP add + burn)`);
  if (s.skipped.length) s.skipped.forEach(x => console.log(`  skipped:     [${x.coin}] ${x.username} — ${x.reason}`));
  console.log('');
  console.log('  ' + pad('slot', 14) + pad('user', 16) + pad('wallet', 14) + pad('balance', 14) + pad('raw', 13) + pad('final', 13) + 'note');
  for (const w of s.winners) {
    console.log('  '
      + pad(w.position, 14) + pad(w.username, 16)
      + pad(w.wallet.slice(0, 6) + '…' + w.wallet.slice(-4), 14)
      + pad(fmt(w.balance), 14) + pad(fmt(w.raw), 13) + pad(fmt(w.final), 13)
      + (w.capHit ? '26x CAP' : (w.final > w.raw + 1 ? 'cascade +' + fmt(w.final - w.raw) : '')));
  }
  const usd = s.bobaiPriceUsd;
  if (usd) {
    console.log('');
    for (const w of s.winners) if (w.final > 0) console.log(`  ${pad(w.position, 14)}${pad(w.username, 16)}≈ $${(w.final * usd).toFixed(2)}`);
  }
  console.log('');
}

// ─── Sign loop (resume-safe, mirrors wc-payout-group.js) ────────────────────
async function runSignLoop(snapshot){
  if (!process.env.PRIZE_PRIVATE_KEY) throw new Error('PRIZE_PRIVATE_KEY missing for --sign');
  const account = privateKeyToAccount(process.env.PRIZE_PRIVATE_KEY);
  if (account.address.toLowerCase() !== PRIZE_WALLET.toLowerCase()) {
    throw new Error(`Key does not match PRIZE_WALLET (key=${account.address})`);
  }

  console.log('\n[pre-flight] cross-checking snapshot tx_hashes with wc_payouts…');
  const dbRows = await sbReq('GET', 'wc_payouts?pot=in.(end,crypto)&select=id,position,tx_hash');
  if (dbRows.length !== snapshot.winners.length) {
    throw new Error(`[pre-flight] DB has ${dbRows.length} end/crypto rows, snapshot has ${snapshot.winners.length}. Run --write-rows first.`);
  }
  const dbBySlot = new Map(dbRows.map(r => [r.position, r]));
  const mismatches = [];
  for (const w of snapshot.winners) {
    const r = dbBySlot.get(w.position);
    if (!r) { mismatches.push(`${w.position}: missing in DB`); continue; }
    if ((w.tx_hash || null) !== (r.tx_hash || null)) mismatches.push(`${w.position}: snapshot/db tx mismatch`);
    if (!w.payout_row_id) w.payout_row_id = r.id;
  }
  if (mismatches.length) {
    mismatches.forEach(m => console.error(`  ${m}`));
    throw new Error('Pre-flight failed. Sync snapshot and DB before signing.');
  }
  const toSend = snapshot.winners.filter(w => w.final > 0 && !w.tx_hash);
  console.log(`[pre-flight] OK · ${toSend.length} to send:`);
  toSend.forEach(w => console.log(`    ${w.position}  ${w.username}  ${fmt(w.final)} BOBAI`));
  const wallet = createWalletClient({ chain: bsc, transport, account });
  console.log(`\nSign mode armed. Account: ${account.address}`);
  console.log('Press Ctrl+C now to abort. Sending in 5 seconds…');
  await new Promise(r => setTimeout(r, 5000));

  // Randomized TX order (payout privacy, same as group run)
  const order = snapshot.winners.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const w of order) {
    if (w.final <= 0) { console.log(`  [skip] ${w.position} ${w.username} — zero final (26x cap)`); continue; }
    if (w.tx_hash)    { console.log(`  [skip] ${w.position} ${w.username} — already sent`); continue; }
    const amountWei = parseUnits(w.final.toFixed(8), 18);
    try {
      const txHash = await wallet.writeContract({
        address: BOBAI, abi: ERC20_ABI, functionName: 'transfer', args: [w.wallet, amountWei],
      });
      console.log(`  [send] ${w.position} ${w.username} → ${w.wallet}  ${fmt(w.final)} BOBAI  tx=${txHash}`);
      const rcpt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (rcpt.status !== 'success') throw new Error(`reverted in block ${rcpt.blockNumber}`);
      w.tx_hash = txHash;
      w.paid_at = new Date().toISOString();
      fs.writeFileSync(JSON_OUT, JSON.stringify(snapshot, null, 2));
      await sbReq('PATCH', `wc_payouts?id=eq.${w.payout_row_id}`, { tx_hash: txHash, paid_at: w.paid_at });
      console.log(`         ↳ wc_payouts row #${w.payout_row_id} updated`);
    } catch (e) {
      console.error(`  [FAIL] ${w.position} ${w.username}: ${e.message}`);
    }
  }
  console.log('\nAll transfers attempted. Re-run --sign to retry FAILs.');
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Mode: ${SIGN ? 'LIVE SIGN' : (WRITE_ROWS ? 'WRITE-ROWS' : 'DRY-RUN')}  |  json-out=${JSON_OUT}`);

  // RESUME for --sign: reuse existing snapshot (keeps row ids + tx hashes)
  if (SIGN && fs.existsSync(JSON_OUT)) {
    console.log(`\n[resume] reusing existing snapshot at ${JSON_OUT}`);
    const snapshot = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
    printSummary(snapshot);
    await runSignLoop(snapshot);
    return;
  }
  if (SIGN) throw new Error('No snapshot found — run dry-run + --write-rows first.');

  const snapshot = await buildSnapshot();
  fs.writeFileSync(JSON_OUT, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot saved → ${path.resolve(JSON_OUT)}`);
  printSummary(snapshot);

  if (WRITE_ROWS) {
    const existing = await sbReq('GET', 'wc_payouts?pot=in.(end,crypto)&select=id');
    if (existing.length && !FORCE) {
      console.error(`[write-rows] aborted: ${existing.length} end/crypto rows already exist. Pass --force to delete + re-insert.`);
      process.exit(2);
    }
    if (existing.length && FORCE) {
      console.log(`[write-rows] --force: deleting ${existing.length} existing rows…`);
      await sbReq('DELETE', 'wc_payouts?pot=in.(end,crypto)');
    }
    console.log(`[write-rows] inserting ${snapshot.winners.length} rows (tx_hash=null)…`);
    const inserted = await sbReq('POST', 'wc_payouts', snapshot.winners.map(w => ({
      pot: w.pot, group_letter: null, position: w.position,
      user_id: w.user_id, username: w.username, country_code: w.country_code,
      wallet: w.wallet.toLowerCase(), bobai_amount: w.final,
      usd_at_payout: snapshot.bobaiPriceUsd ? +(w.final * snapshot.bobaiPriceUsd).toFixed(2) : null,
      tx_hash: null,
      notes: w.capHit ? '26x cap applied — forfeit'
           : (w.final > w.raw + 1 ? 'received redistributed share (26x cap cascade)'
           : (w.position === 'crypto_bobai' ? 'closest holder — closer guess forfeited (0 BOBAI, cap 0)' : null)),
    })));
    inserted.forEach(row => {
      const w = snapshot.winners.find(x => x.position === row.position);
      if (w) w.payout_row_id = row.id;
    });
    fs.writeFileSync(JSON_OUT, JSON.stringify(snapshot, null, 2));
    console.log(`  inserted ${inserted.length} rows. Snapshot re-saved with row IDs.`);
  }

  if (!SIGN) console.log('\n--- DRY-RUN complete. No on-chain transfers were sent. ---');
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
