/**
 * LP origin scan — proves who ever locked liquidity, and who still holds LP.
 *
 * The dashboard derives the dev figure as a remainder against the live dead-address
 * balance, which makes the three source cards add up by construction. That is right
 * for a live page, but it can never notice a fourth party: anything new would simply
 * be counted as dev. This script is the audit that can.
 *
 * Run it whenever the locked total moves unexpectedly, or before making a public
 * claim about where the liquidity came from.
 *
 *   node -r dotenv/config scripts/lp-origin-scan.js
 *
 * Needs BROADCAST_SECRET from .env. A historical getLogs scan is impossible from a
 * laptop — the Binance dataseeds refuse ranges and the free endpoints cap at ~50
 * blocks — so it goes through the /rpclogs proxy on the Telegram worker, which holds
 * the keyed endpoints as Cloudflare secrets. Paging happens here, so no worker
 * request ever runs long.
 *
 * Last full run 2026-08-11 (blocks 88,990,359 - 115,262,182, 526 chunks, no
 * failures): exactly three origins — launch mint 59,396.97, dev 15,461.53, bot
 * 1,069.42 — summing to the dead balance to six decimals. The 1.58 LP that was
 * never burned sits in 0x0ed943ce…9706, a launch contract, and in neither of our
 * wallets.
 */
const PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEAD = '0x000000000000000000000000000000000000dead';
const ZERO = '0x0000000000000000000000000000000000000000';
const PROXY = 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/rpclogs';
const DATASEED = 'https://bsc-dataseed.binance.org/';
const POOL_CREATED = 88990359;
const CHUNK = 50000;

// Known wallets, so the output says whose LP it is instead of printing raw hex.
const KNOWN = {
  [ZERO]: 'launch mint',
  [DEAD]: 'dead address (burned)',
  '0x15ba17075ef5e0736292b030e3715d9100fe3d38': 'dev wallet',
  '0xdefc0e900dfc83e207902cf22265ae63f94c01ce': 'buyback bot',
  [PAIR]: 'the pair itself',
};

const label = (a) => KNOWN[a] ? `${a}  (${KNOWN[a]})` : a;

async function getLogs(fromBlock, toBlock) {
  const r = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Broadcast-Secret': process.env.BROADCAST_SECRET,
    },
    body: JSON.stringify({
      address: PAIR,
      topics: [TRANSFER],
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
    }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(String(j.error).slice(0, 100));
  return j.logs;
}

async function head() {
  const r = await fetch(DATASEED, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  return Number(BigInt((await r.json()).result));
}

async function main() {
  if (!process.env.BROADCAST_SECRET) {
    console.error('BROADCAST_SECRET missing — run with -r dotenv/config from the repo root.');
    process.exit(1);
  }
  const end = await head();
  const chunks = Math.ceil((end - POOL_CREATED) / CHUNK);
  console.log(`Scanning ${POOL_CREATED} -> ${end} in ${chunks} chunks\n`);

  const balance = new Map();   // net LP per address = what it holds today
  const burned = new Map();    // LP each address ever sent to the dead address
  const failed = [];
  let events = 0, done = 0;

  for (let from = POOL_CREATED; from <= end; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, end);
    let logs = null;
    // Transient failures are normal over 500+ requests, so a chunk gets several
    // attempts before it is recorded as a hole. A silent hole would understate a
    // source, which is the one failure mode this script must not have.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { logs = await getLogs(from, to); break; }
      catch (e) {
        if (attempt === 4) failed.push(`${from}-${to}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    if (logs) {
      events += logs.length;
      for (const l of logs) {
        const src = '0x' + l.topics[1].slice(26).toLowerCase();
        const dst = '0x' + l.topics[2].slice(26).toLowerCase();
        const v = Number(BigInt(l.data)) / 1e18;
        balance.set(src, (balance.get(src) || 0) - v);
        balance.set(dst, (balance.get(dst) || 0) + v);
        if (dst === DEAD) burned.set(src, (burned.get(src) || 0) + v);
      }
    }
    if (++done % 60 === 0) console.error(`   ...${done}/${chunks}`);
  }

  console.log(`Transfer events: ${events} | failed chunks: ${failed.length}`);
  if (failed.length) {
    console.log('\nINCOMPLETE — these ranges never answered, so the totals below are lower bounds:');
    failed.forEach((f) => console.log('  ' + f));
  }

  const fmt = (v) => v.toFixed(6).padStart(16);
  let sum = 0;
  console.log('\n=== EVER LOCKED LP (sent to the dead address) ===');
  for (const [a, v] of [...burned.entries()].sort((x, y) => y[1] - x[1])) {
    sum += v;
    console.log('  ' + fmt(v) + '  ' + label(a));
  }
  console.log('  ' + fmt(sum) + '  TOTAL');

  console.log('\n=== STILL HOLDING UNBURNED LP ===');
  const holders = [...balance.entries()].filter(([a, v]) => v > 1e-9 && a !== DEAD && a !== ZERO);
  if (!holders.length) console.log('  nobody — every LP token ever minted is burned');
  for (const [a, v] of holders.sort((x, y) => y[1] - x[1])) {
    console.log('  ' + fmt(v) + '  ' + label(a));
  }
  console.log('\nA source that is not listed above has never locked LP here.');
}

main().catch((e) => { console.error('[FATAL]', e.message); process.exit(1); });
