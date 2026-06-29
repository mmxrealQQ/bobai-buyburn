// $BOBAI Worldcup '26 — Group-Pot Payout Script
//
// Reads the final group standings from Supabase, applies the 26x holder cap
// cascade per pot, and (in --sign mode) sends one BOBAI ERC-20 transfer per
// rank from PRIZE_WALLET to each winner. Logs each successful TX to wc_payouts.
//
// Usage:
//   node -r dotenv/config wc-payout-group.js                 # DRY-RUN (default)
//   node -r dotenv/config wc-payout-group.js --sign          # broadcast TXs
//   node -r dotenv/config wc-payout-group.js --json snapshot.json
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — Supabase admin reads/writes
//   ADMIN_TOKEN                              — worker /admin/* token (for log-payout)
//   PRIZE_PRIVATE_KEY                        — required only with --sign
//   WC_ADMIN_URL                             — defaults to bobai-worldcup-sync.bobbuildonbnb.workers.dev

const fs = require('fs');
const path = require('path');
const {
  createPublicClient, createWalletClient, http, parseAbi,
  formatUnits, parseUnits,
} = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

// ─── Constants ──────────────────────────────────────────────────────────────
const PRIZE_WALLET     = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
const BOBAI            = '0x245c386dcfed896f5c346107596141e5edcbffff';
const GROUP_LETTERS    = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const GROUP_POT_FROZEN = 3472587.05;
const POOL_SPLIT       = { groupTop1: 0.55, groupTop2: 0.30, groupBest3: 0.15 };
const SLOTS            = { top1: 12, top2: 12, best3: 8 };
const RAW = {
  top1:  (GROUP_POT_FROZEN * POOL_SPLIT.groupTop1)  / SLOTS.top1,   // ≈ 159 202
  top2:  (GROUP_POT_FROZEN * POOL_SPLIT.groupTop2)  / SLOTS.top2,   // ≈  86 815
  best3: (GROUP_POT_FROZEN * POOL_SPLIT.groupBest3) / SLOTS.best3,  // ≈  65 111
};
const HOLDER_CAP_MULTIPLE = 26;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aerffjhdsbxpvuulkryr.supabase.co';
const SB_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;
const WC_ADMIN_URL = process.env.WC_ADMIN_URL || 'https://bobai-worldcup-sync.bobbuildonbnb.workers.dev';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SIGN        = args.includes('--sign');
const WRITE_ROWS  = args.includes('--write-rows');
const RESET_ROWS  = args.includes('--reset-rows');
const FORCE       = args.includes('--force');
const JSON_OUT = (args.find(a => a.startsWith('--json='))?.split('=')[1])
              || (args.includes('--json') ? args[args.indexOf('--json')+1] : null)
              || 'wc-payout-snapshot.json';
const SKIP_LOG = args.includes('--skip-log');

// ─── Supabase REST helpers ──────────────────────────────────────────────────
async function sbReq(method, urlPath, body){
  if (!SB_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${urlPath}`, {
    method,
    headers: {
      apikey:        SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${urlPath} → ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function sbRpc(name, params){
  if (!SB_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey:        SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC ${name} → ${res.status}: ${text.slice(0,200)}`);
  return JSON.parse(text);
}

// ─── On-chain helpers ───────────────────────────────────────────────────────
// Use explicit BSC RPC list — viem's default falls back to a rate-limited
// public-good gateway (thirdweb) that 429s on bursts of 32 TXs.
const BSC_RPCS = [
  process.env.BSC_RPC || 'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc-dataseed3.binance.org/',
];
function makeTransport(){
  // Round-robin across the dataseed URLs to spread load.
  return http(BSC_RPCS[0], { batch: false, retryCount: 3, retryDelay: 600 });
}
const publicClient = createPublicClient({ chain: bsc, transport: makeTransport() });

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

// ─── Snapshot ───────────────────────────────────────────────────────────────
async function loadAllGroupStandings(){
  const groups = [];
  for (const letter of GROUP_LETTERS) {
    const rows = await sbRpc('wc_group_leaderboard_ranked', { p_letter: letter });
    groups.push({ letter, rows: rows || [] });
  }
  return groups;
}

async function loadWalletsForUsers(userIds){
  if (!userIds.length) return new Map();
  const inList = '(' + userIds.map(id => `"${id}"`).join(',') + ')';
  const rows = await sbReq('GET', `wc_users?select=id,username,avatar_country,wallet&id=in.${inList}`);
  const m = new Map();
  rows.forEach(r => m.set(r.id, r));
  return m;
}

// Pick the 32 group winners following the leaderboard's skip+promote rule:
// eligible = wallet-linked players. Within each group, top 3 eligible.
// Across all 12 groups, the top 8 by group_points among the 3rd-eligible qualify.
function pickWinners(groups){
  const top1 = [], top2 = [], best3candidates = [];
  for (const g of groups) {
    const eligible = (g.rows || []).filter(r => r.has_wallet);
    if (eligible[0]) top1.push({ ...eligible[0], _letter: g.letter, _position: '1st',  _raw: RAW.top1  });
    if (eligible[1]) top2.push({ ...eligible[1], _letter: g.letter, _position: '2nd',  _raw: RAW.top2  });
    if (eligible[2]) best3candidates.push({ ...eligible[2], _letter: g.letter });
  }
  const best3 = best3candidates
    .slice()
    .sort((a, b) => (b.group_points || 0) - (a.group_points || 0))
    .slice(0, SLOTS.best3)
    .map(r => ({ ...r, _position: 'best_3rd', _raw: RAW.best3 }));
  return [...top1, ...top2, ...best3];
}

// ─── 26x holder-cap cascade ─────────────────────────────────────────────────
function applyCapCascade(winners){
  winners.forEach(w => { w.final = 0; w.locked = w.cap <= 0; });
  let remaining = winners.reduce((s, w) => s + w._raw, 0);
  const HARD_STOP = 100;
  let rounds = 0;
  while (remaining > 1e-6 && rounds++ < HARD_STOP) {
    const unlocked = winners.filter(w => !w.locked);
    if (!unlocked.length) break;
    const totalRaw = unlocked.reduce((s, w) => s + w._raw, 0);
    if (totalRaw <= 0) break;
    let distributed = 0;
    let newCap = false;
    for (const w of unlocked) {
      const slice = remaining * w._raw / totalRaw;
      const room  = w.cap - w.final;
      if (slice >= room) {
        w.final = w.cap;
        w.locked = true;
        distributed += room;
        newCap = true;
      } else {
        w.final += slice;
        distributed += slice;
      }
    }
    remaining -= distributed;
    if (!newCap) break;  // any remaining is float roundoff; safe to stop
  }
  return { rounds, residualBobai: Math.max(0, remaining) };
}

// ─── Logging payouts back to Supabase ───────────────────────────────────────
async function logPayoutRow(row){
  if (SKIP_LOG) return { ok: true, skipped: true };
  if (!ADMIN_TOKEN) throw new Error('ADMIN_TOKEN missing (or pass --skip-log)');
  const res = await fetch(`${WC_ADMIN_URL}/admin/log-payout?token=${ADMIN_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`log-payout ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Console formatters ─────────────────────────────────────────────────────
const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pad = (s, n) => String(s ?? '').padEnd(n);

function printSummary(snapshot){
  const { winners, totals, residual, generatedAt } = snapshot;
  console.log('');
  console.log('===========================================================');
  console.log(`  $BOBAI WORLDCUP '26 — GROUP POT PAYOUT SNAPSHOT`);
  console.log('===========================================================');
  console.log(`  generated:  ${generatedAt}`);
  console.log(`  pot frozen: ${fmt(GROUP_POT_FROZEN)} BOBAI`);
  console.log(`  winners:    ${winners.length} of 32 expected`);
  console.log(`  to send:    ${fmt(totals.toSend)} BOBAI`);
  console.log(`  residual:   ${fmt(residual)} BOBAI  (→ LP add + burn)`);
  console.log(`  pre-cap:    ${fmt(totals.rawTotal)} BOBAI`);
  console.log('');
  const byPos = { '1st': [], '2nd': [], 'best_3rd': [] };
  for (const w of winners) byPos[w.position]?.push(w);
  for (const pos of ['1st', '2nd', 'best_3rd']) {
    console.log(`-- ${pos.toUpperCase()} (${byPos[pos].length}) ----------------------------`);
    console.log('  '
      + pad('grp', 4)
      + pad('user', 22)
      + pad('country', 8)
      + pad('wallet', 14)
      + pad('balance', 14)
      + pad('raw', 12)
      + pad('final', 12)
      + 'cap-hit');
    for (const w of byPos[pos]) {
      console.log('  '
        + pad(w.group_letter, 4)
        + pad((w.username || '').slice(0, 20), 22)
        + pad(w.country_code || '—', 8)
        + pad(w.wallet ? (w.wallet.slice(0, 6) + '…' + w.wallet.slice(-4)) : '—', 14)
        + pad(fmt(w.balance), 14)
        + pad(fmt(w._raw), 12)
        + pad(fmt(w.final), 12)
        + (w.capHit ? 'YES' : '')
      );
    }
  }
  console.log('');
}

// ─── Sign loop (called from both fresh-build and resume-from-snapshot paths)
async function runSignLoop(snapshot){
  if (!process.env.PRIZE_PRIVATE_KEY) throw new Error('PRIZE_PRIVATE_KEY missing for --sign');
  const account = privateKeyToAccount(process.env.PRIZE_PRIVATE_KEY);
  if (account.address.toLowerCase() !== PRIZE_WALLET.toLowerCase()) {
    throw new Error(`Key does not match PRIZE_WALLET (key=${account.address})`);
  }

  // ─── PRE-FLIGHT: snapshot vs DB tx_hash invariant ─────────────────────────
  // Abort if the snapshot's tx_hash set doesn't match wc_payouts exactly.
  // Prevents double-paying if the snapshot file ever drifts from the DB.
  console.log('\n[pre-flight] cross-checking snapshot tx_hashes with wc_payouts…');
  const dbRows = await sbReq('GET', 'wc_payouts?pot=eq.group&select=id,group_letter,position,tx_hash');
  if (dbRows.length !== snapshot.winners.length) {
    throw new Error(`[pre-flight] DB has ${dbRows.length} group rows, snapshot has ${snapshot.winners.length}. Aborting.`);
  }
  const dbBySlot = new Map(dbRows.map(r => [`${r.group_letter}|${r.position}`, r]));
  const mismatches = [];
  for (const w of snapshot.winners) {
    const key = `${w.group_letter}|${w.position}`;
    const r = dbBySlot.get(key);
    if (!r) { mismatches.push(`${key}: missing in DB`); continue; }
    const snapTx = w.tx_hash || null;
    const dbTx   = r.tx_hash || null;
    if (snapTx !== dbTx) {
      mismatches.push(`${key}: snapshot=${snapTx ? snapTx.slice(0,12)+'…' : 'null'}  db=${dbTx ? dbTx.slice(0,12)+'…' : 'null'}`);
    }
    // Attach row id from DB so we PATCH the correct row
    if (!w.payout_row_id) w.payout_row_id = r.id;
  }
  if (mismatches.length) {
    console.error('[pre-flight] tx_hash MISMATCH between snapshot and DB:');
    mismatches.forEach(m => console.error(`  ${m}`));
    throw new Error('Pre-flight failed. Sync snapshot and DB before signing.');
  }
  const already = snapshot.winners.filter(w => w.tx_hash).length;
  const zero    = snapshot.winners.filter(w => w.final === 0).length;
  const toSend  = snapshot.winners.filter(w => w.final > 0 && !w.tx_hash);
  console.log(`[pre-flight] OK · ${already} already paid · ${zero} cap-zero · ${toSend.length} to send`);
  console.log('[pre-flight] About to send:');
  toSend.forEach(w => console.log(`    ${w.group_letter}/${w.position}  ${w.username}  ${fmt(w.final)} BOBAI`));
  const wallet = createWalletClient({ chain: bsc, transport: makeTransport(), account });
  console.log(`\nSign mode armed. Account: ${account.address}`);
  console.log('Press Ctrl+C now to abort. Sending in 5 seconds…');
  await new Promise(r => setTimeout(r, 5000));

  // Randomize TX order (privacy: on-chain timeline can't reveal slot order).
  const order = snapshot.winners.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const w of order) {
    if (w.final <= 0) {
      console.log(`  [skip] ${w.group_letter}/${w.position} ${w.username} — zero final (26x cap)`);
      continue;
    }
    if (w.tx_hash) {
      console.log(`  [skip] ${w.group_letter}/${w.position} ${w.username} — already sent tx=${w.tx_hash.slice(0,10)}…`);
      continue;
    }
    const amountWei = parseUnits(w.final.toFixed(8), 18);
    try {
      const txHash = await wallet.writeContract({
        address: BOBAI, abi: ERC20_ABI, functionName: 'transfer',
        args: [w.wallet, amountWei],
      });
      console.log(`  [send] ${w.group_letter}/${w.position} ${w.username} → ${w.wallet}  ${fmt(w.final)} BOBAI  tx=${txHash}`);
      const rcpt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (rcpt.status !== 'success') throw new Error(`reverted in block ${rcpt.blockNumber}`);
      w.tx_hash = txHash;
      w.paid_at = new Date().toISOString();
      fs.writeFileSync(JSON_OUT, JSON.stringify(snapshot, null, 2));
      if (w.payout_row_id) {
        await sbReq('PATCH', `wc_payouts?id=eq.${w.payout_row_id}`, {
          tx_hash: txHash, paid_at: w.paid_at,
        });
        console.log(`         ↳ wc_payouts row #${w.payout_row_id} updated`);
      } else {
        await logPayoutRow({
          pot: 'group', group_letter: w.group_letter, position: w.position,
          user_id: w.user_id, username: w.username, country_code: w.country_code,
          wallet: w.wallet, bobai_amount: w.final, usd_at_payout: null,
          tx_hash: txHash, notes: w.capHit ? '26x cap applied' : null,
        });
        console.log(`         ↳ wc_payouts row inserted (no pre-stage id)`);
      }
    } catch (e) {
      console.error(`  [FAIL] ${w.group_letter}/${w.position} ${w.username}: ${e.message}`);
    }
  }
  console.log('\nAll transfers attempted. Re-run --sign on the same snapshot to retry FAILs.');
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Mode: ${SIGN ? 'LIVE SIGN' : 'DRY-RUN'}  |  json-out=${JSON_OUT}`);

  // RESUME MODE: if --sign without --write-rows and snapshot exists, reuse it
  // as the source of truth. Critical because regenerating the snapshot loses
  // payout_row_id and tx_hash already committed on-chain — re-running would
  // either double-pay or detach the DB row.
  if (SIGN && !WRITE_ROWS && !RESET_ROWS && fs.existsSync(JSON_OUT)) {
    console.log(`\n[resume] reusing existing snapshot at ${JSON_OUT}`);
    const snapshot = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
    const already  = snapshot.winners.filter(w => w.tx_hash).length;
    const zero     = snapshot.winners.filter(w => w.final === 0).length;
    const todo     = snapshot.winners.filter(w => w.final > 0 && !w.tx_hash).length;
    console.log(`  with tx_hash: ${already}  cap-zero: ${zero}  still-to-send: ${todo}`);
    printSummary(snapshot);
    await runSignLoop(snapshot);
    return;
  }

  const groups   = await loadAllGroupStandings();
  const winners  = pickWinners(groups);
  console.log(`Picked ${winners.length} winners across 12 groups.`);

  // Resolve wallets
  const ids = [...new Set(winners.map(w => w.user_id))];
  const userMap = await loadWalletsForUsers(ids);
  for (const w of winners) {
    const u = userMap.get(w.user_id) || {};
    w.wallet       = u.wallet || null;
    w.username     = u.username || w.username || null;
    w.country_code = u.avatar_country || null;
  }

  // Drop any winner that somehow lost their wallet between RPC + here
  const dropped = winners.filter(w => !w.wallet);
  if (dropped.length) {
    console.warn(`⚠  Dropping ${dropped.length} winners without wallet (post-resolve):`);
    dropped.forEach(d => console.warn(`     ${d._letter}/${d._position} ${d.username}`));
  }
  const live = winners.filter(w => w.wallet);

  // On-chain balance (for cap). One read per unique wallet.
  const uniq = [...new Set(live.map(w => w.wallet.toLowerCase()))];
  console.log(`Reading on-chain BOBAI balance for ${uniq.length} unique wallets…`);
  const balMap = new Map();
  for (const addr of uniq) {
    balMap.set(addr, await readBobaiBalance(addr));
  }
  for (const w of live) {
    w.balance = balMap.get(w.wallet.toLowerCase()) || 0;
    w.cap = w.balance * HOLDER_CAP_MULTIPLE;
  }

  // Per-pot cap cascade — group pot is a single pot. End-pool / Crypto pot use
  // separate runs after the final.
  const cascade = applyCapCascade(live);
  live.forEach(w => { w.capHit = (w.locked && w.final >= w.cap - 1e-3 && w._raw > w.cap); });

  // Build snapshot
  const snapshot = {
    generatedAt: new Date().toISOString(),
    pot: 'group',
    potFrozenBobai: GROUP_POT_FROZEN,
    cascade,
    totals: {
      rawTotal: live.reduce((s, w) => s + w._raw, 0),
      toSend:   live.reduce((s, w) => s + w.final, 0),
    },
    residual: cascade.residualBobai,
    winners: live.map(w => ({
      group_letter: w._letter,
      position:     w._position,
      user_id:      w.user_id,
      username:     w.username,
      country_code: w.country_code,
      wallet:       w.wallet,
      group_points: w.group_points,
      balance:      w.balance,
      cap:          w.cap,
      raw:          w._raw,
      _raw:         w._raw,
      final:        w.final,
      capHit:       w.capHit,
      tx_hash:      null,
      paid_at:      null,
    })),
    droppedNoWallet: dropped.map(d => ({
      group_letter: d._letter, position: d._position, user_id: d.user_id, username: d.username,
    })),
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot saved → ${path.resolve(JSON_OUT)}`);
  printSummary(snapshot);

  // ─── Optional: write/reset wc_payouts rows ──────────────────────────────
  if (RESET_ROWS) {
    console.log('\n[reset-rows] deleting existing pot=group rows from wc_payouts…');
    await sbReq('DELETE', 'wc_payouts?pot=eq.group');
    console.log('  done.');
  }
  if (WRITE_ROWS) {
    // Check for existing group rows to avoid duplicates (unless --force).
    const existing = await sbReq('GET', 'wc_payouts?pot=eq.group&select=id,position,group_letter,user_id');
    if (existing.length && !FORCE) {
      console.error(`\n[write-rows] aborted: ${existing.length} pot=group rows already exist. Pass --force to overwrite (it will DELETE all and re-insert), or use --reset-rows first.`);
      process.exit(2);
    }
    if (existing.length && FORCE) {
      console.log(`[write-rows] --force on: deleting ${existing.length} existing rows…`);
      await sbReq('DELETE', 'wc_payouts?pot=eq.group');
    }
    console.log(`[write-rows] inserting ${snapshot.winners.length} rows (tx_hash=null) so the UI reflects cascade results…`);
    const inserted = await sbReq('POST', 'wc_payouts', snapshot.winners.map(w => ({
      pot:           'group',
      group_letter:  w.group_letter,
      position:      w.position,
      user_id:       w.user_id,
      username:      w.username,
      country_code:  w.country_code,
      wallet:        w.wallet.toLowerCase(),
      bobai_amount:  w.final,
      usd_at_payout: null,
      tx_hash:       null,
      notes:         w.capHit ? '26x cap applied — forfeit' : (w.final > w.raw ? 'received redistributed share' : null),
    })));
    // Re-key snapshot.winners with the freshly inserted row id so --sign can UPDATE by id later
    inserted.forEach(row => {
      const w = snapshot.winners.find(x =>
        x.group_letter === row.group_letter
        && x.position === row.position
        && x.user_id === row.user_id);
      if (w) w.payout_row_id = row.id;
    });
    fs.writeFileSync(JSON_OUT, JSON.stringify(snapshot, null, 2));
    console.log(`  inserted ${inserted.length} rows. snapshot re-saved with row IDs.`);
  }

  if (!SIGN) {
    console.log('\n--- No --sign flag set. No on-chain transfers were sent. ---');
    console.log('Next: re-run with --sign (and --write-rows if not yet done).');
    return;
  }
  await runSignLoop(snapshot);
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
