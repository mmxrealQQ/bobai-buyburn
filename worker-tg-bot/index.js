// BOBAI Telegram Bot — Cloudflare Worker
// Combined: Buy Alert Bot + Burn Alert Bot + Anti-Spam Guard Bot
// Runs 24/7 via cron (every minute) + Telegram Webhook

let TG_BOT_TOKEN = '';
let TG_INTERNAL_CHAT_ID = '';
const TG_CHAT_ID = '-1003791636543';
const BOBAI_PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '0x000000000000000000000000000000000000dead';
// NFT Buy Drops — auto-minted to buyer wallets on every BOBAI buy ≥ $100
const NFT_CONTRACT = '0xd56226b3b8297a57f4361fca28aa43babdc9789d';
// idx → [emoji, label, threshold USD]
const NFT_TIERS = [
  ['💰', 'NICE',    100],
  ['💎', 'BIG',     150],
  ['🚀', 'HUGE',    250],
  ['🐋', 'WHALE',   500],
  ['⚡️', 'THUNDER', 1000],
  ['🦑', 'KRAKEN',  2500],
];
// idx → [emoji, label] — matches drop matrix in worker-nft-mint
// 7-step rarity gradient (cool → warm): 🤍 🩵 💙 💜 🩷 ❤️ 💛
const NFT_RARITIES = [
  ['🤍', 'Common'],
  ['🩵', 'Uncommon'],
  ['💙', 'Rare'],
  ['💜', 'Mythical'],
  ['🩷', 'Legendary'],
  ['❤️', 'Ancient'],
  ['💛', 'Immortal'],
];
// Fetch via Pages route (brainonbnb.com), NOT bobai-nft-mint.workers.dev —
// worker-to-worker on the same *.workers.dev subdomain 404s (CF loopback).
const NFT_STATE_URL = 'https://brainonbnb.com/api/nft/state';
const NFT_DASHBOARD_URL = 'https://brainonbnb.com/nft';
const CAPTCHA_TIMEOUT = 60;

// PancakeSwap V2 Swap event topic. In this pair BOBAI is token0, WBNB is token1,
// so a BUY = WBNB in (amount1In > 0) & BOBAI out (amount0Out > 0).
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
// ERC20 Transfer(address indexed from, address indexed to, uint256 value)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// GeckoTerminal API
const GECKO_POOL_URL = `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_PAIR}`;

// Worldcup tipgame (Supabase — public anon key, RLS-protected)
const WORLDCUP_URL = 'https://brainonbnb.com/worldcup';
const SUPABASE_URL = 'https://aerffjhdsbxpvuulkryr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ne0MFzyCQb6MvFWur2X-Vw_vG9JH76_';

// Multiple BSC RPC endpoints for burn queries
const RPC_ENDPOINTS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc-dataseed4.binance.org',
  'https://bsc-dataseed1.bnbchain.org',
];

// getLogs-capable endpoints. The Binance dataseed nodes above reject eth_getLogs
// ("limit exceeded"), so on-chain buy detection uses these instead. A browser-like
// User-Agent is required (publicnode blocks default/bot user-agents).
// 2026-06-19: free publicnode/pokt endpoints tightened getLogs to <100 blocks
// ("Archive requests require a personal token"). Keyed primary via NodeReal
// (env.BSC_RPC_KEYED_URL) prepended at call time; freebies kept as fallback.
const LOGS_RPC_ENDPOINTS = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-pokt.nodies.app',
  'https://bsc.publicnode.com',
];
const LOGS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// URL_2 (Allnodes/PublicNode personal token) is asked first, URL (NodeReal
// MegaNode) second. Both answer the same query identically; the order only
// decides whose meter runs. NodeReal bills per request against a monthly CU
// quota that dropped below 20% on 2026-08-23, the PublicNode token does not
// meter at all, so the metered provider is kept as the reserve rather than
// spent on routine polling. If URL_2 fails for any reason, NodeReal serves the
// call exactly as before.
function keyedEndpoints(env) {
  return env ? [env.BSC_RPC_KEYED_URL_2, env.BSC_RPC_KEYED_URL].filter(Boolean) : [];
}

// Free endpoints cap getLogs at ~50 blocks since 2026-06-19. If both keyed
// providers fail, narrow the requested range so the free fallback can still
// serve at least the most recent ~50 blocks. Strictly better than silence.
function narrowToRecent(fromBlock, maxBlocks = 50) {
  const from = parseInt(fromBlock, 16);
  return '0x' + Math.max(0, from + 300 - maxBlocks).toString(16); // = latest - maxBlocks
}

// Photo file_ids (uploaded once via bot, reusable)
const PHOTO_WELCOME = 'AgACAgQAAyEGAATh_8g_AAPfadI1EORIV-4JDTPKnQmo3il3NPsAAkYNaxtDCplSMrzv51Lm4QEBAAMCAAN4AAM7BA';
const PHOTO_BIGBUY = 'AgACAgQAAyEGAATh_8g_AAPgadI1EEm5Qa4VhE6mqWf0m6PuFMYAAkcNaxtDCplSLzBgWf5z1mMBAAMCAAN4AAM7BA';
const PHOTO_BURN = 'AgACAgQAAyEGAATh_8g_AAIB0mnWDmHKwNjMTlDUC3WLJRO30ii_AAKBDGsbUeywUgNqPnsGFkssAQADAgADeAADOwQ';

// Known bot/system wallets to ignore in buy alerts
const IGNORED_WALLETS = new Set([
  '0xdefc0e900dfc83e207902cf22265ae63f94c01ce', // buyback bot
  '0x15ba17075ef5e0736292b030e3715d9100fe3d38', // dev buyback bot
]);

// ==================== TELEGRAM API ====================

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ==================== RPC HELPERS ====================

async function rpcCall(method, params) {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const data = await res.json();
      if (data.result !== undefined && data.result !== null) return data.result;
    } catch {}
  }
  return null;
}

async function tryGetLogs(rpc, fromBlock, address, topic, tag) {
  const params = [{ address, topics: [topic], fromBlock, toBlock: 'latest' }];
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': LOGS_UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.result)) return null;
    console.log(`[${tag}] getLogs ok via`, rpc, '-', data.result.length, 'logs');
    return data.result;
  } catch (e) {
    console.error(`[${tag}] getLogs error via`, rpc, '-', e.message || e);
    return null;
  }
}

// eth_getLogs with keyed-first / free-fallback. Keyed endpoints get the full
// requested fromBlock; if all keyed fail, freebies get retried with the most
// recent 50 blocks only (their current archive cap).
async function getSwapLogs(fromBlock, env) {
  for (const rpc of keyedEndpoints(env)) {
    const r = await tryGetLogs(rpc, fromBlock, BOBAI_PAIR, SWAP_TOPIC, 'BUY');
    if (r !== null) return r;
  }
  const narrow = narrowToRecent(fromBlock);
  for (const rpc of LOGS_RPC_ENDPOINTS) {
    const r = await tryGetLogs(rpc, narrow, BOBAI_PAIR, SWAP_TOPIC, 'BUY-fb');
    if (r !== null) return r;
  }
  console.error('[BUY] getLogs failed on ALL endpoints');
  return null;
}

function hexToBigInt(hex) {
  return BigInt(hex || '0x0');
}

// ==================== WHALE WATCHER HELPERS ====================

function addrToTopic(addr) {
  return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
}

function topicToAddr(topic) {
  return '0x' + topic.slice(-40).toLowerCase();
}

// Addresses we never want to alert ON. A wallet→pair transfer is a sell and is
// worth an alert; the pair and the dead address themselves are not holders and
// must never end up on the tracked list.
const WHALE_NEVER_TRACK = new Set([
  BOBAI_PAIR.toLowerCase(),
  DEAD.toLowerCase(),
  BOBAI_TOKEN.toLowerCase(),                    // BOBAI contract
  '0xdefc0e900dfc83e207902cf22265ae63f94c01ce', // buyback bot (3% tax recipient — 100% of tax routes here)
  '0x15ba17075ef5e0736292b030e3715d9100fe3d38', // dev buyback bot (= creator wallet)
  '0x5e4102520a71b2aa18a1208330d4848dea4bd105', // WC26 prize pool wallet
  '0x5c82d2f12ee6ac09297784f94ebf9331277bdc3c', // dev personal wallet (dev-buyback share)
  '0x0000000000000000000000000000000000000000', // null
]);

// Initial Seed: Whale Main + 5 recipients geseedet 2026-06-17.
const DEFAULT_TRACKED = [
  '0x1afa5725f77b64f7a75882ffe94b1bdf1a5174f4', // Whale Main (36% Cluster)
  '0x71e5de5a4720fa438c50261c6023a89f766b382b', // Recipient 1 (57M @ 2026-06-17)
  '0x7fbb2e47ce5b3f653e4d079b5380897b1f81c792', // Recipient 2 (41M @ 2026-06-17)
  '0xdfd2d0eacf78706f5f004d8b715cd510a8a6c719', // Recipient 3 (64M @ 2026-06-17)
  '0xfc3ee9b7928e0ecc6d9c446c343766d5c299594e', // Recipient 4 (44M @ 2026-06-17)
  '0x7f473820b854ed3959e59934af617929ebf06331', // Recipient 5 (42M @ 2026-06-17)
];

// Whale-Threshold in raw wei (10M BOBAI). Adresses that cross this via any
// incoming transfer are auto-added to the watch-set.
const WHALE_THRESHOLD_WEI = 10_000_000n * 10n ** 18n;

// eth_getLogs for EVERY BOBAI transfer in the fromBlock window, unfiltered by
// address. Keyed endpoint first, free endpoints as fallback — same arrangement
// as getSwapLogs above, and for the same reasons.
async function getAllRecentTransfers(fromBlock, env) {
  for (const rpc of keyedEndpoints(env)) {
    const r = await tryGetLogs(rpc, fromBlock, BOBAI_TOKEN, TRANSFER_TOPIC, 'WHALE');
    if (r !== null) return r;
  }
  const narrow = narrowToRecent(fromBlock);
  for (const rpc of LOGS_RPC_ENDPOINTS) {
    const r = await tryGetLogs(rpc, narrow, BOBAI_TOKEN, TRANSFER_TOPIC, 'WHALE-fb');
    if (r !== null) return r;
  }
  return [];
}

// balanceOf(addr) → raw wei BigInt
async function getBobaiBalance(addr) {
  const data = '0x70a08231' + '0'.repeat(24) + addr.slice(2).toLowerCase();
  const r = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data }, 'latest']);
  if (!r) return 0n;
  try { return BigInt(r); } catch { return 0n; }
}

// True if addr is a contract (eth_getCode returns non-empty bytecode). On RPC
// failure we conservatively return `true` so cascade-adds skip rather than risk
// adding an aggregator router (1inch / OKX DEX / 0x). EOAs always return `false`.
async function isContract(addr) {
  if (!/^0x[a-f0-9]{40}$/i.test(addr)) return true;
  try {
    const code = await rpcCall('eth_getCode', [addr, 'latest']);
    if (code === null || code === undefined) return true;
    return code !== '0x' && code !== '0x0' && code !== '0x00';
  } catch {
    return true;
  }
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

function formatUsd(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function shortenAddress(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function priceChangeArrow(pct) {
  const n = parseFloat(pct);
  if (n > 0) return `🟢 +${n.toFixed(1)}%`;
  if (n < 0) return `🔴 ${n.toFixed(1)}%`;
  return `⚪ 0%`;
}

// ==================== PRICE DATA (Gecko → DexScreener → On-Chain) ====================
// Chainlink BNB/USD feed on BSC (8 decimals)
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';
// BOBAI realistic USD range — protects against absurd values if any source goes haywire
const PRICE_MIN_USD = 1e-7;
const PRICE_MAX_USD = 1e-2;
function isSanePrice(p) { return Number.isFinite(p) && p >= PRICE_MIN_USD && p <= PRICE_MAX_USD; }

// On-chain BOBAI/USD: pair reserves × Chainlink BNB/USD. Last-resort fallback when
// both Gecko and DexScreener are down. BOBAI is token0 in this pair (verified on-chain).
// Reads the pair reserves and the Chainlink feed in one go. Returns the USD price,
// the BNB price and the BNB side of the pool, or null when either read fails.
async function readPairOnchain() {
  try {
    // getReserves() selector = 0x0902f1ac → packed (uint112 r0, uint112 r1, uint32 ts)
    const rHex = await rpcCall('eth_call', [{ to: BOBAI_PAIR, data: '0x0902f1ac' }, 'latest']);
    if (!rHex) return null;
    const rBOBAI = BigInt('0x' + rHex.slice(2, 66));
    const rWBNB  = BigInt('0x' + rHex.slice(66, 130));
    if (rBOBAI === 0n || rWBNB === 0n) return null;

    // Chainlink latestAnswer() selector = 0x50d25bcd → int256 (8 decimals)
    const aHex = await rpcCall('eth_call', [{ to: CHAINLINK_BNB_USD, data: '0x50d25bcd' }, 'latest']);
    if (!aHex) return null;
    const bnbUsd = Number(BigInt(aHex)) / 1e8;
    if (!(bnbUsd > 0)) return null;

    const priceInBnb = Number(rWBNB) / Number(rBOBAI);
    const price = priceInBnb * bnbUsd;
    if (!isSanePrice(price)) return null;
    return { price, priceInBnb, bnbUsd, wbnbReserve: Number(rWBNB) / 1e18 };
  } catch (e) {
    console.log('[price] onchain error:', e.message || e);
    return null;
  }
}

// BNB/USD from the Chainlink feed (8 decimals). Used to value on-chain buys.
async function getBnbUsd() {
  try {
    const aHex = await rpcCall('eth_call', [{ to: CHAINLINK_BNB_USD, data: '0x50d25bcd' }, 'latest']);
    if (!aHex) return null;
    const v = Number(BigInt(aHex)) / 1e8;
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

// Indexer figures (24h change, volume, trade counts) plus the indexer's own
// price, mapped into GeckoTerminal's attribute shape. DexScreener first:
// GeckoTerminal answers this Worker's shared Cloudflare egress with 429 for
// most of the day, DexScreener does not. Null when neither answers — the
// caller must never depend on it for the price itself, that comes from the
// chain. The last good answer is kept in KV for half an hour, so one refused
// minute prints "as of 05:40 UTC" rather than n/a; older than that is n/a,
// because a stale figure without a time on it is a wrong figure.
const INDEXER_CACHE_KEY = 'price_24h';
const INDEXER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
async function fetchIndexerStats(env = null) {
  let attrs = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${BOBAI_TOKEN}`);
    if (res.ok) {
      const data = await res.json();
      const p = (data?.pairs || []).find(x => x.pairAddress?.toLowerCase() === BOBAI_PAIR.toLowerCase()) || (data?.pairs || [])[0];
      if (p && isSanePrice(parseFloat(p.priceUsd))) {
        attrs = {
          source: 'DexScreener',
          base_token_price_usd: p.priceUsd,
          base_token_price_native_currency: p.priceNative,
          fdv_usd: p.fdv,
          reserve_in_usd: p.liquidity?.usd,
          volume_usd: { h24: p.volume?.h24 },
          price_change_percentage: p.priceChange || {},
          transactions: { h24: p.txns?.h24 || {} },
        };
      } else {
        console.log('[price] dexscreener unusable:', JSON.stringify(p?.priceUsd), (data?.pairs || []).length, 'pairs');
      }
    } else {
      console.log('[price] dexscreener status', res.status, (await res.text()).slice(0, 200));
    }
  } catch (e) { console.log('[price] dexscreener error:', e.message || e); }
  if (!attrs) {
    try {
      const res = await fetch(`${GECKO_POOL_URL}?_=${Date.now()}`, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const a = data?.data?.attributes;
        if (a && isSanePrice(parseFloat(a.base_token_price_usd))) attrs = { source: 'GeckoTerminal', ...a };
        else console.log('[price] gecko unusable:', JSON.stringify(a?.base_token_price_usd));
      } else {
        console.log('[price] gecko status', res.status, (await res.text()).slice(0, 200));
      }
    } catch (e) { console.log('[price] gecko error:', e.message || e); }
  }
  if (attrs) {
    if (env?.KV) {
      try { await env.KV.put(INDEXER_CACHE_KEY, JSON.stringify({ at: Date.now(), attrs }), { expirationTtl: 3600 }); }
      catch (e) { console.log('[price] cache write failed:', e.message || e); }
    }
    return attrs;
  }
  if (env?.KV) {
    try {
      const raw = await env.KV.get(INDEXER_CACHE_KEY);
      const c = raw ? JSON.parse(raw) : null;
      if (c && Date.now() - c.at < INDEXER_CACHE_MAX_AGE_MS) {
        console.log('[price] indexers refused, using figures from', new Date(c.at).toISOString());
        return { ...c.attrs, as_of: c.at };
      }
    } catch (e) { console.log('[price] cache read failed:', e.message || e); }
  }
  return null;
}

// ==================== THE BOT'S OWN 24-HOUR LEDGER ====================
// /price used to take its 24h volume, trade counts and price change from
// GeckoTerminal or DexScreener. GeckoTerminal answers this Worker with 429
// for most of the day and DexScreener has its minutes too, and on those
// minutes the command printed n/a — to the person who had just typed it.
// A figure that depends on somebody else's rate limiter is not a figure.
//
// So the bot keeps its own record. Every tenth minute the cron reads the
// pair's Swap events since the last bucket (the same keyed endpoints the
// buy alerts already use), counts buys and sells, sums the BNB that moved,
// reads the pool price from the reserves, and appends one bucket. Buckets
// older than a day are dropped. /price then reads one KV key and computes
// everything from it: 24h volume and trades from the buckets, price change
// from the bucket price nearest to an hour, six hours and a day ago. The
// first day it says how many hours it has. Nothing here can be rate-limited
// by a third party; a missed tick shows as a gap, not as a wrong number.
const SWAP_LEDGER_KEY = 'swap_buckets';
const LEDGER_HOURS = 24;
const BUCKET_MINUTES = 10;
// BSC clears a block every ~0.45 s in 2026: ten minutes is ~1,330 blocks.
// 1,600 leaves headroom so a late tick never opens a hole; a bucket carries
// its block range, so overlaps are cut on read, never counted twice.
const BUCKET_BLOCKS = 1600;

async function readSwapLedger(env) {
  try { const raw = await env.KV.get(SWAP_LEDGER_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

// One tick of the ledger. Reads the Swap events from the block after the last
// bucket (or the last ten minutes, if there is no bucket or the gap is too
// wide to read in one call), and appends what it found.
async function recordSwapBucket(env) {
  const latestHex = await rpcCall('eth_blockNumber', []);
  if (!latestHex) throw new Error('no block number');
  const latest = parseInt(latestHex, 16);
  const ledger = await readSwapLedger(env);
  const last = ledger[ledger.length - 1];
  let from = last && latest - last.to <= BUCKET_BLOCKS * 2 ? last.to + 1 : latest - BUCKET_BLOCKS;
  if (from > latest) return { added: false, why: 'no new blocks' };
  const logs = await getSwapLogs('0x' + from.toString(16), env);
  if (!Array.isArray(logs)) throw new Error('swap logs unavailable');
  let buys = 0, sells = 0, volWei = 0n;
  for (const log of logs) {
    const b = parseInt(log.blockNumber, 16);
    if (b < from || b > latest) continue;
    const d = log.data.slice(2);
    if (d.length < 256) continue;
    const amount0In = BigInt('0x' + d.slice(0, 64)), amount1In = BigInt('0x' + d.slice(64, 128));
    const amount0Out = BigInt('0x' + d.slice(128, 192)), amount1Out = BigInt('0x' + d.slice(192, 256));
    if (amount1In > 0n && amount0Out > 0n) buys++;
    else if (amount0In > 0n && amount1Out > 0n) sells++;
    else continue;
    volWei += amount1In + amount1Out;
  }
  const pair = await readPairOnchain();
  const bucket = { t: Date.now(), from, to: latest, buys, sells, vol_bnb: Number(volWei) / 1e18, price_bnb: pair ? pair.priceInBnb : null, price_usd: pair ? pair.price : null, bnb_usd: pair ? pair.bnbUsd : null };
  const cutoff = Date.now() - LEDGER_HOURS * 3600 * 1000;
  const kept = ledger.filter((x) => x.t >= cutoff).concat(bucket);
  await env.KV.put(SWAP_LEDGER_KEY, JSON.stringify(kept));
  console.log('[LEDGER] bucket', from, '-', latest, buys, 'buys', sells, 'sells', bucket.vol_bnb.toFixed(4), 'BNB');
  return { added: true, buys, sells, buckets: kept.length };
}

// What the ledger says right now. `priceNow` is today's pool price in BNB;
// the change over a window is against the bucket whose age is nearest to
// that window, and only if one exists within half the window — a "24h
// change" measured against a nine-hour-old price would be a lie with a
// label on it.
function ledgerStats(ledger, priceNowBnb) {
  const now = Date.now();
  const cutoff = now - LEDGER_HOURS * 3600 * 1000;
  const rows = (ledger || []).filter((x) => x.t >= cutoff).sort((a, b) => a.t - b.t);
  if (!rows.length) return null;
  let buys = 0, sells = 0, volBnb = 0, lastTo = 0;
  for (const r of rows) {
    if (r.to <= lastTo) continue;       // an overlapping re-read is one observation
    buys += r.buys; sells += r.sells; volBnb += r.vol_bnb; lastTo = r.to;
  }
  const hours = Math.min(LEDGER_HOURS, (now - rows[0].t) / 36e5 + BUCKET_MINUTES / 60);
  const change = (h) => {
    const target = now - h * 36e5;
    let best = null;
    for (const r of rows) {
      if (!(r.price_bnb > 0)) continue;
      if (!best || Math.abs(r.t - target) < Math.abs(best.t - target)) best = r;
    }
    if (!best || Math.abs(best.t - target) > (h * 36e5) / 2 || !(priceNowBnb > 0)) return null;
    return (priceNowBnb / best.price_bnb - 1) * 100;
  };
  return { hours, buys, sells, trades: buys + sells, vol_bnb: volBnb, h1: change(1), h6: change(6), h24: change(24), first_at: rows[0].t, last_at: rows[rows.length - 1].t };
}

// BOBAI/USD for alerts that only need a number. The chain is the source: pair
// reserves times the Chainlink BNB feed, the same maths as the dashboard. An
// indexer price is only a stand-in when the RPC endpoints are all down.
async function fetchBobaiPriceUsd() {
  const pair = await readPairOnchain();
  if (pair) return pair.price;
  const ix = await fetchIndexerStats();
  const p = ix ? parseFloat(ix.base_token_price_usd) : NaN;
  if (isSanePrice(p)) { console.log('[price] chain unreadable, using indexer price'); return p; }
  return null;
}

// ==================== WORLDCUP TIPGAME ====================

// ISO country code → flag emoji. Special-cased UK constituents (ENG/SCT/WAL).
function isoToFlag(iso) {
  if (!iso) return '🏳️';
  if (iso === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
  if (iso === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
  if (iso === 'WAL') return '🏴󠁧󠁢󠁷󠁬󠁳󠁿';
  if (iso.length !== 2) return '🏳️';
  return iso.toUpperCase()
    .split('')
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

async function sbSelect(table, query) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error('[SB]', e.message || e);
    return [];
  }
}

async function fetchWorldcupPool() {
  const rows = await sbSelect('wc_pool', 'id=eq.1&select=total_bobai,group_pot,endpool,crypto_pot,bobai_price_usd,updated_at');
  return rows[0] || null;
}

async function fetchWorldcupLeaderboard(n = 10) {
  return sbSelect('wc_leaderboard', `select=username,avatar_country,total_points,has_wallet&order=total_points.desc&limit=${n}`);
}

// Total registered players = row count of the wc_leaderboard view (1 row per wc_users row).
// Uses PostgREST exact-count via the Content-Range header (no full table fetch).
async function fetchWorldcupPlayerCount() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/wc_leaderboard?select=user_id&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    if (!res.ok) return null;
    const cr = res.headers.get('content-range'); // e.g. "0-0/142"
    const total = cr ? parseInt(cr.split('/')[1], 10) : NaN;
    return Number.isFinite(total) ? total : null;
  } catch (e) {
    console.error('[SB count]', e.message || e);
    return null;
  }
}

// Returns last N rows; `taxOnly` true → TAX only, false → BNB+USDT (donations), null → both.
async function fetchWorldcupDonations(n = 3, taxOnly = null) {
  let tokenFilter = '';
  if (taxOnly === true)  tokenFilter = '&token=eq.TAX';
  if (taxOnly === false) tokenFilter = '&token=in.(BNB,USDT)';
  return sbSelect('wc_donations',
    `select=token,amount_in,amount_bobai,swap_tx_hash,created_at${tokenFilter}&order=created_at.desc&limit=${n}`);
}

// ==================== BURN STATS ====================

async function getBurnedTokens() {
  const balanceData = '0x70a08231' + DEAD.slice(2).padStart(64, '0');
  const burnedHex = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data: balanceData }, 'latest']);
  return Number(hexToBigInt(burnedHex)) / 1e18;
}

async function getTotalSupply() {
  const totalData = '0x18160ddd';
  const totalHex = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data: totalData }, 'latest']);
  return Number(hexToBigInt(totalHex)) / 1e18;
}

async function getBurnStats() {
  try {
    const [burnedTokens, totalSupply] = await Promise.all([getBurnedTokens(), getTotalSupply()]);
    const percent = totalSupply > 0 ? (burnedTokens / totalSupply * 100).toFixed(1) : '?';
    return { burnedTokens, percent };
  } catch {
    return { burnedTokens: 0, percent: '?' };
  }
}

// ==================== LIQUIDITY DEPTH ====================
// Same maths as the dashboard's liquidity block: every number is derived from the live
// pair reserves, nothing is hardcoded. PancakeSwap V2 (factory verified on-chain) keeps
// 0.25% of the input inside the pool; the 3% BOBAI tax never touches the reserves.
const LP_FEE = 0.9975;
const TAX_KEEP = 0.97;
// Deliberately the same steps as the buy-alert tiers and the dashboard bars.
const DEPTH_SIZES = [100, 150, 250, 500, 1000, 2500];

// Trade size that moves the price by (k - 1). Closed form of
// (r + x)(r + FEE*x) = k*r^2  ->  FEE*x^2 + r*(1 + FEE)*x + r^2*(1 - k) = 0.
// Mirrors onePctV2() in dashboard/scanner-chain.js — change both together.
function onePctSize(r, k) {
  const b = 1 + LP_FEE;
  const disc = b * b - 4 * LP_FEE * (1 - k);
  return r * (Math.sqrt(disc) - b) / (2 * LP_FEE);
}

async function fetchLiquidityStats() {
  const balDead = '0x70a08231' + DEAD.slice(2).padStart(64, '0');
  const [rHex, lpTotalHex, lpDeadHex, supplyHex, burnedHex, bnbUsd, blockHex] = await Promise.all([
    rpcCall('eth_call', [{ to: BOBAI_PAIR, data: '0x0902f1ac' }, 'latest']),
    rpcCall('eth_call', [{ to: BOBAI_PAIR, data: '0x18160ddd' }, 'latest']),
    rpcCall('eth_call', [{ to: BOBAI_PAIR, data: balDead }, 'latest']),
    rpcCall('eth_call', [{ to: BOBAI_TOKEN, data: '0x18160ddd' }, 'latest']),
    rpcCall('eth_call', [{ to: BOBAI_TOKEN, data: balDead }, 'latest']),
    getBnbUsd(),
    rpcCall('eth_blockNumber', []),
  ]);
  if (!rHex || !bnbUsd) return null;

  // BOBAI is token0 in this pair (verified on-chain)
  const rTok = Number(BigInt('0x' + rHex.slice(2, 66))) / 1e18;
  const rBnb = Number(BigInt('0x' + rHex.slice(66, 130))) / 1e18;
  if (!(rTok > 0) || !(rBnb > 0)) return null;

  const price = (rBnb / rTok) * bnbUsd;
  const bnbSide = rBnb * bnbUsd;   // hard BNB backing — the half that isn't our own token
  const tvl = bnbSide * 2;

  const supply = Number(hexToBigInt(supplyHex)) / 1e18;
  const burned = Number(hexToBigInt(burnedHex)) / 1e18;
  const mcap = supply > 0 ? (supply - burned) * price : null;

  const lpTotal = Number(hexToBigInt(lpTotalHex)) / 1e18;
  const lpDead = Number(hexToBigInt(lpDeadHex)) / 1e18;
  const lpBurnedPct = lpTotal > 0 ? (lpDead / lpTotal) * 100 : null;

  // "What does one percent cost" — the reverse of the impact bars. A buy needs no tax
  // correction (incoming BNB is untaxed); a sell does, because only 97% of the tokens
  // sent ever reach the reserves.
  const up1 = onePctSize(rBnb, 1.01) * bnbUsd;
  const dn1 = (onePctSize(rTok, 1 / 0.99) / TAX_KEEP) * price;

  // Two different things per size, the way the dashboard splits them:
  //   impact = how far this trade alone moves the price. The 3% tax is taken from the
  //            tokens, never from the reserves, so it moves nothing; the 0.25% fee stays
  //            in the pool and counts. A sell moves less — the pair only sees 97%.
  //   cost   = what the trader gives up against spot (fill + fee + tax). Not symmetric:
  //            on a buy the tax hits the tokens leaving, on a sell the ones going in.
  //            Both tend to 1 - TAX*FEE = 3.24% as the size goes to zero.
  const depth = DEPTH_SIZES.map(usd => {
    const dBnb = usd / bnbUsd;
    const dTok = usd / price;
    const sTok = dTok * TAX_KEEP;
    return {
      usd,
      impactBuy: ((rBnb + dBnb) * (rBnb + LP_FEE * dBnb) / (rBnb * rBnb) - 1) * 100,
      impactSell: (rTok * rTok / ((rTok + sTok) * (rTok + LP_FEE * sTok)) - 1) * 100,
      costBuy: (1 - TAX_KEEP * LP_FEE * rBnb / (rBnb + LP_FEE * dBnb)) * 100,
      costSell: (1 - TAX_KEEP * LP_FEE * rTok / (rTok + TAX_KEEP * LP_FEE * dTok)) * 100,
    };
  });

  // The block this was read at. A chat message stays in the group forever, so it
  // has to say which state of the chain it describes — otherwise a reader three
  // hours later compares it against a pool that has moved since.
  let block = null;
  try { block = parseInt(blockHex, 16) || null; } catch { }

  return { price, rBnb, rTok, bnbSide, tvl, mcap, lpBurnedPct, up1, dn1, depth, block };
}

// ==================== BUY BOT ====================

function getBuyEmojis(usdValue) {
  // Each 🧠 = $10, no max
  const count = Math.max(Math.floor(usdValue / 10), 1);
  const bar = '🧠'.repeat(count);
  let icon;
  if (usdValue >= 2500) icon = '🦑 KRAKEN BUY!';
  else if (usdValue >= 1000) icon = '⚡ THUNDER BUY!';
  else if (usdValue >= 500) icon = '🐋 WHALE BUY!';
  else if (usdValue >= 250) icon = '🚀 HUGE BUY!';
  else if (usdValue >= 150) icon = '💎 BIG BUY!';
  else icon = '💰 NICE BUY!';
  return { bar, icon };
}

function getBurnEmojis(usdValue) {
  const count = Math.max(Math.floor(usdValue / 2), 1);
  const bar = '🔥'.repeat(count);
  let icon;
  if (usdValue >= 250) icon = '💥 SUPERNOVA BURN!';
  else if (usdValue >= 150) icon = '☄️ APOCALYPSE BURN!';
  else if (usdValue >= 50) icon = '💀 MEGA BURN!';
  else if (usdValue >= 15) icon = '🌋 BIG BURN!';
  else if (usdValue >= 5) icon = '🕯️ NICE BURN!';
  else icon = '♻️ BURN';
  return { bar, icon };
}

// One-shot fetch of the full NFT state (tiers + drops) from the dashboard API.
// Returns { minted, cap, drops } or null on failure.
async function fetchNftState() {
  try {
    const res = await fetch(NFT_STATE_URL, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) {
      console.error('[NFT state] non-ok', res.status);
      return null;
    }
    const body = await res.json();
    return {
      minted: Array.isArray(body.minted) ? body.minted : null,
      cap:    Array.isArray(body.cap)    ? body.cap    : null,
      drops:  Array.isArray(body.drops)  ? body.drops  : [],
      holders: typeof body.holders === 'number' ? body.holders : null,
    };
  } catch (e) {
    console.error('[NFT state] err', e.message || e);
    return null;
  }
}


// 10-char ▰░ progress bar
function nftProgressBar(minted, cap) {
  if (cap <= 0) return '░░░░░░░░░░';
  const filled = Math.min(10, Math.round((minted / cap) * 10));
  return '▰'.repeat(filled) + '░'.repeat(10 - filled);
}

async function postBuyAlert(trade, burnedPct, nftLine = '') {
  const { bnbAmount, bobaiAmount, usdValue, buyer, txHash } = trade;
  const { bar, icon } = getBuyEmojis(usdValue);
  const pricePerToken = bobaiAmount > 0 ? usdValue / bobaiAmount : 0;

  const message = `${bar}
<b>${icon}</b>

🪙 <b>${formatNumber(bobaiAmount)} BOBAI</b>
💎 ${bnbAmount.toFixed(4)} BNB <b>(${formatUsd(usdValue)})</b>
💵 Price: $${pricePerToken.toFixed(8)}
👤 <a href="https://bscscan.com/address/${buyer}">${shortenAddress(buyer)}</a>${nftLine}

🔗 <a href="https://bscscan.com/tx/${txHash}">TX</a> · <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a> · <a href="https://four.meme/token/${BOBAI_TOKEN}">Four.Meme</a>

🔥 Burned: ${burnedPct}% of supply`;

  // 1) Try the rich photo alert
  try {
    const photoRes = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: PHOTO_BIGBUY,
      caption: message,
      parse_mode: 'HTML',
    });
    if (photoRes?.ok === true) {
      console.log('[BUY] photo alert sent', txHash);
      return true;
    }
    console.error('[BUY] sendPhoto failed, falling back to text:', JSON.stringify(photoRes));
  } catch (err) {
    console.error('[BUY] sendPhoto threw, falling back to text:', err.message || err);
  }

  // 2) Fallback: text-only alert so a buy alert ALWAYS goes out, even if the
  // photo file_id is ever rejected by Telegram. Same content, no image.
  try {
    const textRes = await tg('sendMessage', {
      chat_id: TG_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    if (textRes?.ok === true) {
      console.log('[BUY] text fallback sent', txHash);
      return true;
    }
    console.error('[BUY] text fallback failed:', JSON.stringify(textRes));
  } catch (err) {
    console.error('[BUY] text fallback threw:', err.message || err);
  }

  return false;
}

// ==================== BURN BOT ====================

async function postBurnAlert(newBurned, prevBurned, totalSupply, tokenPrice) {
  try {
    const burnedDelta = newBurned - prevBurned;
    const hasPrice = tokenPrice && tokenPrice > 0;
    const burnedUsd = hasPrice ? burnedDelta * tokenPrice : 0;
    const burnedUsdStr = hasPrice ? formatUsd(burnedUsd) : 'n/a';
    const percent = totalSupply > 0 ? (newBurned / totalSupply * 100).toFixed(1) : '?';
    // When price unavailable, fall back to the smallest burn emoji bucket
    const { bar, icon } = getBurnEmojis(burnedUsd);

    const message = `${bar}
<b>${icon}</b>

🪙 <b>+${formatNumber(burnedDelta)} BOBAI</b> burned <b>(${burnedUsdStr})</b>
📊 Total burned: <b>${formatNumber(newBurned)} BOBAI</b>
🔥 That's <b>${percent}%</b> of total supply!

💡 <i>Every trade makes BOBAI more scarce!</i>

🔗 <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${DEAD}">View Burns</a> · <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a>`;

    const result = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: PHOTO_BURN,
      caption: message,
      parse_mode: 'HTML',
    });
    return result?.ok === true;
  } catch (err) {
    console.error('[POST BURN ERROR]', err.message || err);
    return false;
  }
}

// ==================== WHALE ADMIN COMMANDS ====================

const ADDR_RE  = /0x[a-fA-F0-9]{40}/;
const ADDR_REG = /0x[a-fA-F0-9]{40}/g;

async function loadTrackedWallets(env) {
  try {
    const raw = await env.KV.get('tracked_wallets');
    if (raw) {
      // Self-heal: filter never-track on read so addresses added to the never-track
      // set in later deploys (e.g. the BOBAI contract) drop out automatically.
      return JSON.parse(raw).filter(a => !WHALE_NEVER_TRACK.has(a));
    }
  } catch {}
  return [...DEFAULT_TRACKED];
}

async function saveTrackedWallets(env, list) {
  // Dedup + lowercase, exclude never-track
  const cleaned = [...new Set(list.map(a => a.toLowerCase()))]
    .filter(a => /^0x[a-f0-9]{40}$/.test(a) && !WHALE_NEVER_TRACK.has(a));
  await env.KV.put('tracked_wallets', JSON.stringify(cleaned));
  return cleaned;
}

async function loadWalletEdges(env) {
  try {
    const raw = await env.KV.get('wallet_edges');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

async function saveWalletEdges(env, edges) {
  await env.KV.put('wallet_edges', JSON.stringify(edges));
}

// ---- Daily whale balance snapshots (holdings history + trend) ----
// One snapshot per UTC day: live balanceOf() of every tracked wallet, stored in
// KV so 1d/7d/30d holdings-trends can be computed without an archive node.
// Correctness rules:
//  - Deltas compare only wallets present in BOTH snapshots — the watchlist grows
//    over time, comparing raw totals would fake an "inflow" whenever a new whale
//    gets tracked.
//  - A delta window is only reported when a snapshot of that actual age exists
//    (±12h) — a 2-day-old history never masquerades as a "7d" trend.
//  - If any balanceOf fails, the whole snapshot is aborted (retried next run) —
//    a failed call must never be recorded as balance 0.
const WHALE_SNAPSHOTS_MAX = 120;

async function loadWhaleSnapshots(env) {
  try {
    const raw = await env.KV.get('whale_snapshots');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function getBobaiBalanceStrict(addr) {
  const data = '0x70a08231' + '0'.repeat(24) + addr.slice(2).toLowerCase();
  const r = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data }, 'latest']);
  if (r === null) throw new Error('balanceOf failed for ' + addr);
  return BigInt(r);
}

async function takeWhaleSnapshotIfDue(env, tracked) {
  const snaps = await loadWhaleSnapshots(env);
  const today = new Date().toISOString().slice(0, 10);
  if (snaps.length && snaps[snaps.length - 1].date === today) return snaps;
  const wallets = {};
  let total = 0;
  for (let i = 0; i < tracked.length; i += 8) {
    const chunk = tracked.slice(i, i + 8);
    const bals = await Promise.all(chunk.map(a => getBobaiBalanceStrict(a))); // throws on any failure → abort
    chunk.forEach((a, j) => { const t = Number(bals[j] / 10n ** 18n); wallets[a] = t; total += t; });
  }
  snaps.push({ date: today, ts: Date.now(), total, wallets });
  const trimmed = snaps.slice(-WHALE_SNAPSHOTS_MAX);
  await env.KV.put('whale_snapshots', JSON.stringify(trimmed));
  console.log('[WHALE-SNAP] snapshot', today, '-', tracked.length, 'wallets,', total, 'BOBAI');
  return trimmed;
}

// Change vs. the snapshot closest to `days` ago (±12h), intersection basis.
function snapshotDelta(snaps, days) {
  if (snaps.length < 2) return null;
  const last = snaps[snaps.length - 1];
  const target = last.ts - days * 86400e3;
  let ref = null;
  for (const s of snaps.slice(0, -1)) {
    if (Math.abs(s.ts - target) <= 12 * 3600e3 && (!ref || Math.abs(s.ts - target) < Math.abs(ref.ts - target))) ref = s;
  }
  if (!ref) return null;
  let before = 0, after = 0, n = 0;
  for (const a of Object.keys(last.wallets)) {
    if (ref.wallets[a] === undefined) continue;
    before += ref.wallets[a];
    after += last.wallets[a];
    n++;
  }
  if (!n) return null;
  return {
    window_days: days,
    wallets_compared: n,
    bobai_change: after - before,
    percent_change: before > 0 ? Math.round((after - before) / before * 10000) / 100 : null,
  };
}

function snapshotHoldings(snaps) {
  if (!snaps.length) return null;
  const last = snaps[snaps.length - 1];
  return {
    as_of_date: last.date,
    tracked_total_bobai: last.total,
    percent_of_total_supply: Math.round(last.total / 1e9 * 10000) / 100,
    change_1d: snapshotDelta(snaps, 1),
    change_7d: snapshotDelta(snaps, 7),
    change_30d: snapshotDelta(snaps, 30),
    method: 'Daily balanceOf() snapshot of every tracked wallet. Deltas compare only wallets present in both snapshots, so watchlist growth never fakes an inflow; a window is only reported once history of that actual age exists.',
  };
}

// ---- Whale event log (for 24h summaries) ----
// Keeps the last 500 alert-worthy events (raw, with timestamp) so we can render
// rolling 24h breakdowns without re-scanning the chain.

const WHALE_EVENTS_MAX = 500;

async function loadWhaleEvents(env) {
  try {
    const raw = await env.KV.get('whale_events');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function saveWhaleEvents(env, events) {
  await env.KV.put('whale_events', JSON.stringify(events.slice(-WHALE_EVENTS_MAX)));
}

function recentEvents(events, hours = 24) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return events.filter(e => (e.ts || 0) >= cutoff);
}

// addrs of wallets that moved (sent OR received) in the last `hours`
function activeAddrSet(events, hours = 24) {
  const r = recentEvents(events, hours);
  const s = new Set();
  for (const e of r) { if (e.from) s.add(e.from); if (e.to) s.add(e.to); }
  return s;
}

// 24h activity summary for a single cluster (set of addresses). Returns net
// USD flow + event count, considering only events where at least one side is
// in the cluster. Internal moves count as 1 event, no net change.
function summarizeClusterActivity(events, clusterSet, hours = 24) {
  const r = recentEvents(events, hours);
  let count = 0, usdIn = 0, usdOut = 0, internal = 0;
  for (const e of r) {
    const fromIn = e.from && clusterSet.has(e.from);
    const toIn   = e.to   && clusterSet.has(e.to);
    if (!fromIn && !toIn) continue;
    count++;
    const u = e.usdValue || 0;
    if (e.kind === 'INTERNAL_T') {
      if (fromIn && toIn) internal++;        // intra-cluster, neutral
      else if (fromIn)    usdOut += u;       // crossed to another cluster
      else                usdIn  += u;       // crossed from another cluster
      continue;
    }
    if (e.kind === 'BUY' || e.kind === 'TRANSFER_IN') {
      if (toIn) usdIn += u;
    } else if (e.kind === 'SELL' || e.kind === 'BURN' || e.kind === 'TRANSFER_OUT') {
      if (fromIn) usdOut += u;
    }
  }
  return { count, usdIn, usdOut, netUsd: usdIn - usdOut, internal };
}

function summarize24h(events) {
  const r = recentEvents(events, 24);
  const counts = {
    BUY: 0, SELL: 0, BURN: 0, INTERNAL_T: 0,
    TRANSFER_OUT: 0, TRANSFER_IN: 0,
    NEW_WHALE: 0, EX_WHALE: 0,
  };
  let usdIn = 0, usdOut = 0;
  let amtIn = 0, amtOut = 0;
  for (const e of r) {
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    const u = e.usdValue || 0;
    const a = e.amount   || 0;
    if (e.kind === 'BUY' || e.kind === 'TRANSFER_IN') { usdIn += u; amtIn += a; }
    if (e.kind === 'SELL' || e.kind === 'BURN' || e.kind === 'TRANSFER_OUT') { usdOut += u; amtOut += a; }
  }
  // Top 3 movers ranked by USD impact (any kind with amount, ignore NEW/EX which are balance snapshots)
  const movers = r.filter(e => ['BUY','SELL','BURN','TRANSFER_OUT','TRANSFER_IN','INTERNAL_T'].includes(e.kind))
    .slice()
    .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
    .slice(0, 3);
  return {
    total: r.length, counts,
    usdIn, usdOut, netUsd: usdIn - usdOut,
    amtIn, amtOut, netAmt: amtIn - amtOut,
    movers,
  };
}

function netEmoji(net) {
  if (net > 0) return '🟢';
  if (net < 0) return '🔴';
  return '⚪';
}

function netStr(net) {
  const sign = net > 0 ? '+' : (net < 0 ? '-' : '');
  return `${sign}${formatUsd(Math.abs(net))}`;
}

const KIND_LABEL = {
  BUY:          { icon: '🟢', label: 'Buy' },
  SELL:         { icon: '🔴', label: 'Sell' },
  BURN:         { icon: '🔥', label: 'Burn' },
  TRANSFER_OUT: { icon: '🟠', label: 'Out' },
  TRANSFER_IN:  { icon: '⚪', label: 'In' },
  INTERNAL_T:   { icon: '🟣', label: 'Internal' },
  NEW_WHALE:    { icon: '💡', label: 'New whale' },
  EX_WHALE:     { icon: '💀', label: 'Ex-whale' },
};

// Compact "who is this wallet" descriptor for alert FROM/TO lines.
// Special wallets get a human label; tracked wallets get cluster tag + balance + USD.
function describeAddr(addr, clusterTag, balTokens, priceUsd) {
  const a = addr.toLowerCase();
  if (a === BOBAI_PAIR.toLowerCase()) return 'PancakeSwap LP';
  if (a === DEAD.toLowerCase())      return '💀 DEAD';
  if (a === BOBAI_TOKEN.toLowerCase()) return 'BOBAI contract';
  if (a === '0xdefc0e900dfc83e207902cf22265ae63f94c01ce') return 'Buyback bot (tax collector)';
  if (a === '0x15ba17075ef5e0736292b030e3715d9100fe3d38') return 'Dev-buyback bot';
  if (a === '0x5e4102520a71b2aa18a1208330d4848dea4bd105') return 'WC26 prize pool';
  if (a === '0x5c82d2f12ee6ac09297784f94ebf9331277bdc3c') return 'Dev personal';
  const tag = clusterTag ? `🔗${clusterTag}` : 'Solo';
  if (balTokens == null) return tag;
  const usdPart = priceUsd ? ` · ${formatUsd(balTokens * priceUsd)}` : '';
  return `${tag} · ${formatNumber(balTokens)} BOBAI${usdPart}`;
}

function describeMover(e) {
  const k = KIND_LABEL[e.kind] || { icon: '·', label: e.kind };
  const amt = formatNumber(e.amount || 0);
  const usd = e.usdValue ? formatUsd(e.usdValue) : 'n/a';
  const who = shortenAddress(e.kind === 'SELL' || e.kind === 'BURN' || e.kind === 'TRANSFER_OUT' ? e.from : e.to);
  const link = `<a href="https://bscscan.com/tx/${e.txHash}">${who}</a>`;
  return `${k.icon} ${link} · ${amt} BOBAI (${usd})`;
}

// Full daily recap — used by /whales24h AND by the auto-posted daily summary.
// `withDateStamp` true → header reads "Daily Recap · YYYY-MM-DD" (auto-post).
function renderDailyRecap(events, tracked, price, withDateStamp) {
  const sum = summarize24h(events);
  const c = sum.counts;
  const head = withDateStamp
    ? `📅 <b>Daily Whale Recap</b> · ${new Date().toISOString().slice(0, 10)}`
    : `📅 <b>Whale Watcher · Last 24h</b>`;

  if (sum.total === 0) {
    return `${head}

<i>No whale activity in the last 24 hours.</i>

🐋 ${tracked.length} wallets tracked`;
  }

  const usdBy = {
    BUY:          sumKindUsd(events, 'BUY'),
    SELL:         sumKindUsd(events, 'SELL'),
    BURN:         sumKindUsd(events, 'BURN'),
    TRANSFER_OUT: sumKindUsd(events, 'TRANSFER_OUT'),
    TRANSFER_IN:  sumKindUsd(events, 'TRANSFER_IN'),
    INTERNAL_T:   sumKindUsd(events, 'INTERNAL_T'),
  };
  const amtBy = {
    BUY:          sumKindAmt(events, 'BUY'),
    SELL:         sumKindAmt(events, 'SELL'),
    BURN:         sumKindAmt(events, 'BURN'),
    TRANSFER_OUT: sumKindAmt(events, 'TRANSFER_OUT'),
    TRANSFER_IN:  sumKindAmt(events, 'TRANSFER_IN'),
    INTERNAL_T:   sumKindAmt(events, 'INTERNAL_T'),
  };

  const sections = [];

  // 📥 INFLOWS — whales receiving (Buys from LP + Transfers in from unknown wallets)
  const inflowItems = [];
  if (c.BUY)         inflowItems.push(`🟢 Buys from LP: <b>${c.BUY}</b> · ${formatUsd(usdBy.BUY)} (${formatNumber(amtBy.BUY)} BOBAI)`);
  if (c.TRANSFER_IN) inflowItems.push(`⚪ Transfers in: <b>${c.TRANSFER_IN}</b> · ${formatUsd(usdBy.TRANSFER_IN)} (${formatNumber(amtBy.TRANSFER_IN)} BOBAI)`);
  if (inflowItems.length) {
    sections.push(`📥 <b>INFLOWS</b> <i>(whales receiving)</i>
${inflowItems.join('\n')}
Total: <b>+${formatUsd(sum.usdIn)}</b> (+${formatNumber(sum.amtIn)} BOBAI)`);
  }

  // 📤 OUTFLOWS — whales sending (Sells, Burns, Cascade-Out to fresh wallets)
  const outflowItems = [];
  if (c.SELL)         outflowItems.push(`🔴 Sells to LP: <b>${c.SELL}</b> · ${formatUsd(usdBy.SELL)} (${formatNumber(amtBy.SELL)} BOBAI)`);
  if (c.BURN)         outflowItems.push(`🔥 Burns: <b>${c.BURN}</b> · ${formatUsd(usdBy.BURN)} (${formatNumber(amtBy.BURN)} BOBAI)`);
  if (c.TRANSFER_OUT) outflowItems.push(`🟠 Cascade out: <b>${c.TRANSFER_OUT}</b> · ${formatUsd(usdBy.TRANSFER_OUT)} (${formatNumber(amtBy.TRANSFER_OUT)} BOBAI)`);
  if (outflowItems.length) {
    sections.push(`📤 <b>OUTFLOWS</b> <i>(whales sending)</i>
${outflowItems.join('\n')}
Total: <b>-${formatUsd(sum.usdOut)}</b> (-${formatNumber(sum.amtOut)} BOBAI)`);
  }

  // NET FLOW — on-chain inflows minus outflows. The sign speaks for itself.
  let netCaption;
  if      (sum.netUsd > 0) netCaption = 'Whales net accumulating.';
  else if (sum.netUsd < 0) netCaption = 'Whales net offloading.';
  else                     netCaption = 'Perfectly balanced.';
  sections.push(`⚖️ <b>NET FLOW</b>: ${netEmoji(sum.netUsd)} <b>${netStr(sum.netUsd)}</b> (${formatNumber(Math.abs(sum.netAmt))} BOBAI ${sum.netAmt >= 0 ? 'in' : 'out'})
<i>${netCaption}</i>`);

  // 🔄 INTERNAL — cluster moves (don't affect net, but signal coordination)
  if (c.INTERNAL_T) {
    sections.push(`🔄 <b>INTERNAL</b> <i>(tracked → tracked, neutral)</i>
🟣 Cluster moves: <b>${c.INTERNAL_T}</b> · ${formatNumber(amtBy.INTERNAL_T)} BOBAI`);
  }

  // ⚠️ STATUS CHANGES — new/ex whales
  if (c.NEW_WHALE || c.EX_WHALE) {
    const lines = [];
    if (c.NEW_WHALE) lines.push(`💡 <b>${c.NEW_WHALE}</b> new whale${c.NEW_WHALE === 1 ? '' : 's'} crossed 10M`);
    if (c.EX_WHALE)  lines.push(`💀 <b>${c.EX_WHALE}</b> ex-whale${c.EX_WHALE === 1 ? '' : 's'} dropped below 10M`);
    sections.push(`⚠️ <b>STATUS CHANGES</b>\n${lines.join('\n')}`);
  }

  // 🏆 TOP MOVES — biggest USD movers
  if (sum.movers.length) {
    sections.push(`🏆 <b>TOP MOVES</b>\n${sum.movers.map((e, i) => `<code>${i + 1}.</code> ${describeMover(e)}`).join('\n')}`);
  }

  const footer = `🐋 ${tracked.length} wallets tracked${price ? ` · BOBAI $${price.toFixed(8)}` : ''}`;
  return `${head}

${sections.join('\n\n')}

${footer}`;
}

function sumKindUsd(events, kind) {
  return recentEvents(events, 24)
    .filter(e => e.kind === kind)
    .reduce((s, e) => s + (e.usdValue || 0), 0);
}

function sumKindAmt(events, kind) {
  return recentEvents(events, 24)
    .filter(e => e.kind === kind)
    .reduce((s, e) => s + (e.amount || 0), 0);
}

// Add bi-directional edge a↔b to the edges map.
function addEdgeInMemory(edges, a, b) {
  if (a === b) return false;
  edges[a] = edges[a] || [];
  edges[b] = edges[b] || [];
  let changed = false;
  if (!edges[a].includes(b)) { edges[a].push(b); changed = true; }
  if (!edges[b].includes(a)) { edges[b].push(a); changed = true; }
  return changed;
}

// Connected components over the tracked subset. Returns array of Set<addr>.
function computeClusters(addrs, edges) {
  const inSet = new Set(addrs);
  const visited = new Set();
  const clusters = [];
  for (const start of addrs) {
    if (visited.has(start)) continue;
    const cluster = new Set();
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      cluster.add(cur);
      for (const n of (edges[cur] || [])) {
        if (inSet.has(n) && !visited.has(n)) queue.push(n);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// Map address → cluster label ('A','B',...) for clusters of size >= 2.
function labelClusters(clusters) {
  const labels = new Map();
  let letter = 0;
  // Sort biggest first so the "main" whale cluster is A
  const sorted = clusters.slice().sort((a, b) => b.size - a.size);
  for (const c of sorted) {
    if (c.size < 2) continue;
    const tag = String.fromCharCode(65 + (letter % 26));
    for (const addr of c) labels.set(addr, tag);
    letter++;
  }
  return labels;
}

async function handleWhaleAdmin(rawText, cmd, chatId) {
  const env = WHALE_ENV; // captured at scheduled/fetch entry
  if (!env) return;

  let reply;

  if (cmd === '/whalehelp') {
    reply = `🐋 <b>Whale Watcher — Admin Commands</b>

<code>/whales</code> — tracked wallets (grouped by cluster, with 24h dots)
<code>/whales24h</code> — full breakdown of the last 24 hours
<code>/whaleadd 0x...</code> — add wallet(s) to the watch-set
<code>/whalerm 0x...</code> — remove wallet(s)
<code>/whalecleanup</code> — drop any contract addresses that slipped in
<code>/whalehelp</code> — this help

<b>How it works:</b>
• Scans every minute. Groups all BOBAI transfers <b>per tx</b> so aggregator hops (1inch / OKX DEX / 0x) collapse into ONE clean alert against the LP, DEAD, or the real end-EOA.
• Classifies: 🟢 Buy · 🔴 Sell · 🔥 Burn · 🟠 Transfer-Out · ⚪ Transfer-In · 🟣 Internal · 🟡 Dust (&lt; $50).
• <b>Daily Recap</b> posted here every morning at 06:00 UTC (08:00 CEST).

<b>Auto-tracking:</b>
• 💡 <b>NEW WHALE</b> — EOA crosses <b>10M BOBAI</b>, auto-added.
• 💀 <b>EX-WHALE</b> — tracked wallet drops below 10M (stays in set; /whalerm to drop).
• 🟠 <b>Cascade (Hop 1)</b> — fresh EOAs a tracked wallet sends to are auto-added.
• 🤖 <b>Contracts blocked</b> — router/aggregator contracts (eth_getCode) are never tracked.

<b>Never tracked</b> (always excluded):
• PancakeSwap LP · DEAD burn · BOBAI contract (tax collector)
• Buyback bot &amp; Dev-Buyback bot · Any contract address

<i>Internal-only. Alerts post to this chat, never public.</i>`;
  }

  else if (cmd === '/whales') {
    const list = await loadTrackedWallets(env);
    if (!list.length) {
      reply = '🐋 No wallets currently tracked.\nUse <code>/whaleadd 0x...</code> to start.';
    } else {
      const [balances, price, edges, events, totalSupply] = await Promise.all([
        Promise.all(list.map(a => getBobaiBalance(a).catch(() => 0n))),
        fetchBobaiPriceUsd().catch(() => null),
        loadWalletEdges(env),
        loadWhaleEvents(env),
        getTotalSupply().catch(() => 0),
      ]);
      const tokens = balances.map(b => Number(b / 10n ** 18n));
      const balByAddr = new Map(list.map((a, i) => [a, tokens[i]]));
      const totalTokens = tokens.reduce((s, t) => s + t, 0);
      const totalUsd = price ? totalTokens * price : null;
      // %-share is computed against TOTAL SUPPLY (more meaningful than vs. tracked).
      const supplyBase = totalSupply > 0 ? totalSupply : totalTokens || 1;

      const clusters = computeClusters(list, edges);
      const clusterTag = labelClusters(clusters);
      const active = activeAddrSet(events, 24);
      const sum = summarize24h(events);

      // Sort clusters: size desc (biggest first), but solo wallets aggregated separately
      const labeled = clusters.filter(c => c.size >= 2).sort((a, b) => b.size - a.size);
      const solo = clusters.filter(c => c.size === 1).flatMap(c => [...c]);

      // --- Header ---
      const totalUsdStr = totalUsd != null ? formatUsd(totalUsd) : 'n/a';
      const totalPctOfSupply = ((totalTokens / supplyBase) * 100).toFixed(1);
      const header = `🐋 <b>Whale Watcher</b>
<b>${list.length}</b> wallets · <b>${formatNumber(totalTokens)}</b> BOBAI · <b>${totalUsdStr}</b>
<b>${totalPctOfSupply}%</b> of total supply`;

      // --- 24h inline summary ---
      const c = sum.counts;
      const has24h = sum.total > 0;
      const flagLine = (c.NEW_WHALE || c.EX_WHALE) ? `
💡 ${c.NEW_WHALE} new whale${c.NEW_WHALE === 1 ? '' : 's'} · 💀 ${c.EX_WHALE} ex-whale${c.EX_WHALE === 1 ? '' : 's'}` : '';
      const summary24h = has24h ? `
📅 <b>Last 24h</b> · ${sum.total} events
📥 <b>+${formatUsd(sum.usdIn)}</b> in · 📤 <b>-${formatUsd(sum.usdOut)}</b> out
⚖️ Net: ${netEmoji(sum.netUsd)} <b>${netStr(sum.netUsd)}</b>${flagLine}` : `
📅 <i>No whale activity in the last 24h.</i>`;

      // --- Cluster + Solo sections ---
      const WHALE_THRESHOLD_TOKENS = 10_000_000;
      const renderWallet = (addr, rankInGroup) => {
        const bal = balByAddr.get(addr) || 0;
        const usd = price ? bal * price : null;
        const usdStr = usd != null ? formatUsd(usd) : 'n/a';
        const pct = ((bal / supplyBase) * 100).toFixed(2);
        // Size marker (💀 below 10M) and activity marker (🟢 active 24h / 💤 dormant) are independent.
        // Small + active → 💀🟢 so cascade-hop traffic on sub-10M wallets stays visible.
        const small = bal < WHALE_THRESHOLD_TOKENS;
        const isActive = active.has(addr);
        const dot = small
          ? (isActive ? '💀🟢' : '💀')
          : (isActive ? '🟢' : '💤');
        const rank = String(rankInGroup).padStart(2, ' ');
        return `<code>${rank}.</code> <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${addr}">${shortenAddress(addr)}</a> · ${formatNumber(bal)} (${usdStr}) · ${pct}% ${dot}`;
      };

      const renderActivity = (act) => {
        if (act.count === 0) return '<i>💤 quiet (24h)</i>';
        const parts = [];
        if (act.netUsd !== 0) parts.push(`${netEmoji(act.netUsd)} net <b>${netStr(act.netUsd)}</b>`);
        else if (act.usdIn || act.usdOut) parts.push(`⚪ flat`);
        if (act.usdIn)  parts.push(`+${formatUsd(act.usdIn)} in`);
        if (act.usdOut) parts.push(`-${formatUsd(act.usdOut)} out`);
        if (act.internal) parts.push(`🟣 ${act.internal} internal`);
        // Fallback: events touched the cluster but contributed no USD flow
        // (typically historical status events or zero-value transfers).
        if (!parts.length) parts.push(`${act.count} event${act.count === 1 ? '' : 's'}`);
        return `<i>24h: ${parts.join(' · ')}</i>`;
      };

      const sections = [];
      for (const cluster of labeled) {
        const tag = clusterTag.get([...cluster][0]) || '?';
        const addrs = [...cluster].sort((a, b) => (balByAddr.get(b) || 0) - (balByAddr.get(a) || 0));
        const sumTokens = addrs.reduce((s, a) => s + (balByAddr.get(a) || 0), 0);
        const sharePct = ((sumTokens / supplyBase) * 100).toFixed(2);
        const act = summarizeClusterActivity(events, cluster, 24);
        const head = `🔗 <b>Cluster ${tag}</b> · ${addrs.length} wallets · ${sharePct}% of supply
${renderActivity(act)}`;
        const lines = addrs.map((a, i) => renderWallet(a, i + 1)).join('\n');
        sections.push(head + '\n' + lines);
      }
      if (solo.length) {
        const sorted = solo.slice().sort((a, b) => (balByAddr.get(b) || 0) - (balByAddr.get(a) || 0));
        const sumTokens = sorted.reduce((s, a) => s + (balByAddr.get(a) || 0), 0);
        const sharePct = ((sumTokens / supplyBase) * 100).toFixed(2);
        const soloSet = new Set(sorted);
        const act = summarizeClusterActivity(events, soloSet, 24);
        const head = `🔘 <b>Solo</b> · ${sorted.length} wallets · ${sharePct}% of supply
${renderActivity(act)}`;
        const lines = sorted.map((a, i) => renderWallet(a, i + 1)).join('\n');
        sections.push(head + '\n' + lines);
      }

      reply = `${header}
${summary24h}

${sections.join('\n\n')}

<i>% = share of total supply · 🟢 active (24h) · 💤 dormant · 💀 below 10M (combine: 💀🟢 = small + active) · 🔗 linked cluster
ℹ️ <code>/whales24h</code> for full daily breakdown · <code>/whalehelp</code></i>`;
    }
  }

  else if (cmd === '/whales24h') {
    const events = await loadWhaleEvents(env);
    const tracked = await loadTrackedWallets(env);
    const price   = await fetchBobaiPriceUsd().catch(() => null);
    reply = renderDailyRecap(events, tracked, price, /*withDateStamp=*/ false);
  }

  else if (cmd === '/whaleadd') {
    const matches = rawText.match(ADDR_REG);
    if (!matches || !matches.length) {
      reply = '❌ Need at least one valid address.\nUsage: <code>/whaleadd 0x...</code>\nBatch: paste multiple 0x... in one message.';
    } else {
      const list = await loadTrackedWallets(env);
      const before = new Set(list);
      const candidates = [...new Set(matches.map(a => a.toLowerCase()))];
      // Block aggregator routers / contracts upfront — they're never wallets.
      const contractFlags = await Promise.all(candidates.map(a =>
        WHALE_NEVER_TRACK.has(a) ? Promise.resolve(false) : isContract(a)
      ));
      const isContractMap = new Map(candidates.map((a, i) => [a, contractFlags[i]]));
      const added = [], dup = [], skipped = [], contracts = [];
      for (const addr of candidates) {
        if (WHALE_NEVER_TRACK.has(addr))   skipped.push(addr);
        else if (isContractMap.get(addr))  contracts.push(addr);
        else if (before.has(addr))         dup.push(addr);
        else                               { added.push(addr); list.push(addr); }
      }
      const cleaned = await saveTrackedWallets(env, list);
      const blocks = [];
      if (added.length) {
        blocks.push(`✅ <b>Added ${added.length}</b>:\n` + added.map(a =>
          `• <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${a}">${shortenAddress(a)}</a>`).join('\n'));
      }
      if (dup.length) {
        blocks.push(`ℹ️ <b>Already tracked (${dup.length})</b>:\n` + dup.map(a => `• <code>${shortenAddress(a)}</code>`).join('\n'));
      }
      if (contracts.length) {
        blocks.push(`🤖 <b>Skipped (contract — router/aggregator) — ${contracts.length}</b>:\n` + contracts.map(a => `• <code>${shortenAddress(a)}</code>`).join('\n'));
      }
      if (skipped.length) {
        blocks.push(`🚫 <b>Skipped (never-track: LP/DEAD/Bot) — ${skipped.length}</b>:\n` + skipped.map(a => `• <code>${shortenAddress(a)}</code>`).join('\n'));
      }
      blocks.push(`\n📊 Now tracking <b>${cleaned.length}</b> wallets total.`);
      reply = blocks.join('\n\n');
    }
  }

  else if (cmd === '/whalecleanup') {
    const list = await loadTrackedWallets(env);
    if (!list.length) {
      reply = '🐋 No wallets to clean up.';
    } else {
      const flags = await Promise.all(list.map(isContract));
      const contracts = list.filter((_, i) => flags[i]);
      const eoas      = list.filter((_, i) => !flags[i]);
      if (!contracts.length) {
        reply = `✅ All <b>${list.length}</b> tracked addresses are EOAs. Nothing to clean.`;
      } else {
        const cleaned = await saveTrackedWallets(env, eoas);
        // Prune edges referencing the removed contracts.
        const edges = await loadWalletEdges(env);
        let edgesPruned = false;
        const rmSet = new Set(contracts);
        for (const a of contracts) {
          if (edges[a]) { delete edges[a]; edgesPruned = true; }
        }
        for (const k of Object.keys(edges)) {
          const before = edges[k].length;
          edges[k] = edges[k].filter(x => !rmSet.has(x));
          if (edges[k].length !== before) edgesPruned = true;
          if (edges[k].length === 0) delete edges[k];
        }
        if (edgesPruned) await saveWalletEdges(env, edges);
        reply = `🧹 <b>Cleanup done</b>\n\nRemoved <b>${contracts.length}</b> contract address${contracts.length === 1 ? '' : 'es'} (routers/aggregators):\n` +
          contracts.map(a => `• <a href="https://bscscan.com/address/${a}">${shortenAddress(a)}</a>`).join('\n') +
          `\n\n📊 Now tracking <b>${cleaned.length}</b> EOA wallet${cleaned.length === 1 ? '' : 's'}.`;
      }
    }
  }

  else if (cmd === '/whalerm') {
    const matches = rawText.match(ADDR_REG);
    if (!matches || !matches.length) {
      reply = '❌ Need at least one valid address.\nUsage: <code>/whalerm 0x...</code>';
    } else {
      const list = await loadTrackedWallets(env);
      const before = new Set(list);
      const rmSet = new Set(matches.map(a => a.toLowerCase()));
      const removed = [], notFound = [];
      for (const addr of rmSet) {
        if (before.has(addr)) removed.push(addr);
        else notFound.push(addr);
      }
      const cleaned = await saveTrackedWallets(env, list.filter(a => !rmSet.has(a)));
      const blocks = [];
      if (removed.length) {
        blocks.push(`🗑️ <b>Removed ${removed.length}</b>:\n` + removed.map(a => `• <code>${shortenAddress(a)}</code>`).join('\n'));
      }
      if (notFound.length) {
        blocks.push(`ℹ️ <b>Not in set (${notFound.length})</b>:\n` + notFound.map(a => `• <code>${shortenAddress(a)}</code>`).join('\n'));
      }
      blocks.push(`\n📊 Now tracking <b>${cleaned.length}</b> wallets total.`);
      reply = blocks.join('\n\n');
    }
  }

  if (reply) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: reply,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}

// Captured at top of fetch() / scheduled() so handleWhaleAdmin has KV access.
let WHALE_ENV = null;

// ==================== WHALE WATCHER POSTER ====================

// Auto-posted to BOBAI Intern once per day at 06:00 UTC (08:00 CEST).
async function postDailyWhaleRecap(env) {
  if (!TG_INTERNAL_CHAT_ID) return false;
  try {
    const [events, tracked, price] = await Promise.all([
      loadWhaleEvents(env),
      loadTrackedWallets(env),
      fetchBobaiPriceUsd().catch(() => null),
    ]);
    let text = renderDailyRecap(events, tracked, price, /*withDateStamp=*/ true);
    // Holdings trend from the daily snapshots — silent until history exists.
    try {
      const snaps = await takeWhaleSnapshotIfDue(env, tracked);
      const h = snapshotHoldings(snaps);
      if (h) {
        const d = h.change_7d || h.change_1d;
        const trend = d ? ` · ${d.window_days}d: ${d.bobai_change >= 0 ? '+' : ''}${formatNumber(d.bobai_change)} BOBAI (${d.percent_change >= 0 ? '+' : ''}${d.percent_change}%)` : '';
        text += `\n💼 <b>Holdings</b>: ${formatNumber(h.tracked_total_bobai)} BOBAI tracked (${h.percent_of_total_supply}% of supply)${trend}`;
      }
    } catch (e) {
      console.error('[WHALE-SNAP RECAP ERROR]', e.message || e);
    }
    const r = await tg('sendMessage', {
      chat_id: TG_INTERNAL_CHAT_ID,
      text, parse_mode: 'HTML', disable_web_page_preview: true,
    });
    return r?.ok === true;
  } catch (e) {
    console.error('[WHALE DAILY ERROR]', e.message || e);
    return false;
  }
}

// Mover-first alert layout: who moved, in which cluster, how much, what's their
// position now. Each alert focuses on the tracked wallet — the LP/DEAD or fresh
// counterparty is shown as a one-line context, not as a co-equal "FROM/TO" row.
async function postWhaleAlert(data) {
  if (!TG_INTERNAL_CHAT_ID) return false;
  const { kind, from, to, amount, usdValue, txHash } = data;
  const DUST_USD = 50;
  const isDust = usdValue > 0 && usdValue < DUST_USD;
  const usdStr = usdValue ? formatUsd(usdValue) : 'n/a';
  const txLink = `<a href="https://bscscan.com/tx/${txHash}">View TX</a>`;

  // moverAddr = the tracked wallet at the center of this alert.
  // Inflows (BUY / TRANSFER_IN): mover = `to`, counterparty = `from`.
  // Outflows (SELL / BURN / TRANSFER_OUT): mover = `from`, counterparty = `to`.
  // INTERNAL_T: mover = sender (from), counterparty = recipient (to).
  const isInflowKind = (kind === 'BUY' || kind === 'TRANSFER_IN');
  const moverAddr = isInflowKind ? to : from;
  const otherAddr = isInflowKind ? from : to;
  const moverTag  = isInflowKind ? data.toTag : data.fromTag;
  const moverBal  = isInflowKind ? data.toBal : data.fromBal;
  const otherTag  = isInflowKind ? data.fromTag : data.toTag;
  const otherBal  = isInflowKind ? data.fromBal : data.toBal;
  const priceUsd  = data.priceUsd;

  const moverLink = `<a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${moverAddr}">${shortenAddress(moverAddr)}</a>`;
  const otherLink = `<a href="https://bscscan.com/address/${otherAddr}">${shortenAddress(otherAddr)}</a>`;
  const moverCluster = moverTag ? `🔗 Cluster ${moverTag}` : '🔸 Solo';
  const moverHolds = moverBal != null
    ? `<b>${formatNumber(moverBal)} BOBAI</b>${priceUsd ? ` · ${formatUsd(moverBal * priceUsd)}` : ''}`
    : null;
  const otherDesc = describeAddr(otherAddr, otherTag, otherBal, priceUsd);

  // NEW_WHALE & EX_WHALE keep their own focused layouts.
  if (kind === 'NEW_WHALE') {
    const msg = `💡 <b>NEW WHALE · auto-tracked</b>

🐋 ${moverLink} just crossed <b>10M BOBAI</b>.
📊 Holds: <b>${formatNumber(amount)} BOBAI</b> · ${usdStr}

<i>Added to watch-set. All future activity will alert.</i>

🔗 ${txLink}`;
    return await tgSend(msg);
  }
  if (kind === 'EX_WHALE') {
    const moverDownLink = `<a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${from}">${shortenAddress(from)}</a>`;
    const msg = `💀 <b>EX-WHALE · dropped below 10M</b>

📉 ${moverDownLink}
📊 Balance now: <b>${formatNumber(amount)} BOBAI</b> · ${usdStr}

<i>Still in watch-set — use /whalerm to drop.</i>

🔗 ${txLink}`;
    return await tgSend(msg);
  }

  // Action verb + headline icon, by kind.
  let headline, contextLine;
  switch (kind) {
    case 'BUY':
      headline = `🟢 <b>BUY</b> · ${usdStr}`;
      contextLine = `↩ from PancakeSwap LP`;
      break;
    case 'SELL':
      headline = `🔴 <b>SELL</b> · ${usdStr}`;
      contextLine = `↪ into PancakeSwap LP`;
      break;
    case 'BURN':
      headline = `🔥 <b>BURN</b> · ${usdStr}`;
      contextLine = `↪ to 💀 DEAD address`;
      break;
    case 'INTERNAL_T':
      headline = `🟣 <b>INTERNAL MOVE</b> · ${usdStr}`;
      contextLine = `→ ${otherLink} · <i>${otherDesc}</i>`;
      break;
    case 'TRANSFER_OUT':
      if (isDust) {
        headline = `🟡 <b>PRE-FUNDING</b> · ${usdStr} <i>(dust)</i>`;
        contextLine = `→ ${otherLink} · <i>fresh wallet — bigger TX likely incoming</i>`;
      } else {
        headline = `🟠 <b>TRANSFER OUT</b> · ${usdStr}`;
        contextLine = `→ ${otherLink} · <i>new wallet, auto-added to watch-set</i>`;
      }
      break;
    case 'TRANSFER_IN':
      headline = `⚪ <b>RECEIVED</b> · ${usdStr}`;
      contextLine = `← ${otherLink} · <i>${otherDesc}</i>`;
      break;
    default:
      return false;
  }

  const lines = [
    headline,
    `${moverCluster} · ${moverLink}`,
  ];
  if (moverHolds) lines.push(`📊 Now holds: ${moverHolds}`);
  const sign =
    (kind === 'SELL' || kind === 'BURN' || kind === 'TRANSFER_OUT') ? '−' :
    (kind === 'BUY'  || kind === 'TRANSFER_IN')                      ? '+' :
    '';  // INTERNAL_T → neutral (intra-cluster redistribution)
  lines.push('', `🪙 ${sign}${formatNumber(amount)} BOBAI · ${usdStr}`);
  lines.push(contextLine);
  lines.push('', `🔗 ${txLink}`);

  return await tgSend(lines.join('\n'));
}

async function tgSend(text) {
  try {
    const r = await tg('sendMessage', {
      chat_id: TG_INTERNAL_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return r?.ok === true;
  } catch (e) {
    console.error('[WHALE ALERT ERROR]', e.message || e);
    return false;
  }
}

// ==================== GUARD BOT ====================

function generateCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  return { question: `${a} + ${b}`, answer: (a + b).toString() };
}

function generateButtons(correctAnswer) {
  const correct = parseInt(correctAnswer);
  const options = new Set([correct]);
  while (options.size < 4) {
    const wrong = correct + Math.floor(Math.random() * 7) - 3;
    if (wrong > 0 && wrong !== correct) options.add(wrong);
  }
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  return [shuffled.map(n => ({ text: n.toString(), callback_data: `cap_${n}` }))];
}

// ==================== CAPTCHA INDEX HELPERS ====================

async function getCaptchaIndex(env) {
  const raw = await env.KV.get('captcha_index');
  return raw ? JSON.parse(raw) : [];
}

async function addToCaptchaIndex(env, userId) {
  const index = await getCaptchaIndex(env);
  if (!index.includes(userId)) {
    index.push(userId);
    await env.KV.put('captcha_index', JSON.stringify(index));
  }
}

async function removeFromCaptchaIndex(env, userId) {
  const index = await getCaptchaIndex(env);
  const filtered = index.filter(id => id !== userId);
  await env.KV.put('captcha_index', JSON.stringify(filtered));
}

// ==================== GUARD BOT HANDLERS ====================

async function handleNewMember(msg, env) {
  const members = msg.new_chat_members || [];
  for (const member of members) {
    if (member.is_bot) continue;

    const userId = member.id;
    const name = member.first_name || 'User';
    const { question, answer } = generateCaptcha();

    await tg('restrictChatMember', {
      chat_id: TG_CHAT_ID,
      user_id: userId,
      permissions: { can_send_messages: false, can_send_media_messages: false, can_send_other_messages: false },
    });

    const result = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: PHOTO_WELCOME,
      caption: `👋 Welcome <b>${name}</b> to BOBAI!\n\n🛡 Quick verification — solve this:\n\n🧮 <b>${question} = ?</b>\n\n⏱ You have 60 seconds`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: generateButtons(answer) },
    });

    await env.KV.put(`captcha_${userId}`, JSON.stringify({
      answer,
      messageId: result.result?.message_id,
      name,
      timestamp: Date.now(),
    }), { expirationTtl: 600 });

    await addToCaptchaIndex(env, userId);
  }
}

async function handleCallback(callback, env) {
  const userId = callback.from.id;
  const data = callback.data;
  if (!data.startsWith('cap_')) return;

  const stored = await env.KV.get(`captcha_${userId}`);
  if (!stored) {
    await tg('answerCallbackQuery', { callback_query_id: callback.id, text: 'Expired or not for you.' });
    return;
  }

  const entry = JSON.parse(stored);
  const selected = data.replace('cap_', '');

  if (selected === entry.answer) {
    await env.KV.delete(`captcha_${userId}`);
    await removeFromCaptchaIndex(env, userId);

    await tg('restrictChatMember', {
      chat_id: TG_CHAT_ID,
      user_id: userId,
      permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true },
    });

    await tg('answerCallbackQuery', { callback_query_id: callback.id, text: '✅ Verified! Welcome!' });

    if (entry.messageId) {
      await tg('deleteMessage', { chat_id: TG_CHAT_ID, message_id: entry.messageId });
    }

    await tg('sendMessage', {
      chat_id: TG_CHAT_ID,
      text: `✅ <b>${entry.name}</b> joined the BOBAI community! Welcome! 🚀`,
      parse_mode: 'HTML',
    });
  } else {
    await env.KV.delete(`captcha_${userId}`);
    await removeFromCaptchaIndex(env, userId);
    await tg('answerCallbackQuery', { callback_query_id: callback.id, text: '❌ Wrong answer. Try joining again.' });
    await tg('banChatMember', { chat_id: TG_CHAT_ID, user_id: userId });
    await tg('unbanChatMember', { chat_id: TG_CHAT_ID, user_id: userId });
    if (entry.messageId) {
      await tg('deleteMessage', { chat_id: TG_CHAT_ID, message_id: entry.messageId });
    }
  }
}

async function cleanupExpiredCaptchas(env) {
  // Uses captcha_index (KV.get = read) instead of KV.list (= write-category)
  const index = await getCaptchaIndex(env);
  const remaining = [];

  for (const userId of index) {
    const data = await env.KV.get(`captcha_${userId}`);
    if (!data) {
      // Already expired via TTL or handled — skip
      continue;
    }
    const entry = JSON.parse(data);
    if (Date.now() - entry.timestamp > CAPTCHA_TIMEOUT * 1000) {
      await env.KV.delete(`captcha_${userId}`);
      try {
        if (entry.messageId) {
          await tg('deleteMessage', { chat_id: TG_CHAT_ID, message_id: entry.messageId });
        }
        await tg('sendMessage', {
          chat_id: TG_CHAT_ID,
          text: `👋 <b>${entry.name}</b> didn't verify in time. Bye bye!`,
          parse_mode: 'HTML',
        });
        await tg('banChatMember', { chat_id: TG_CHAT_ID, user_id: parseInt(userId) });
        await tg('unbanChatMember', { chat_id: TG_CHAT_ID, user_id: parseInt(userId) });
      } catch {}
    } else {
      remaining.push(userId);
    }
  }

  // Update index to only keep active captchas
  if (remaining.length !== index.length) {
    await env.KV.put('captcha_index', JSON.stringify(remaining));
  }
}

// ==================== BOT COMMAND MENU SETUP ====================

const BOT_COMMANDS = [
  { command: 'alerts',   description: 'Buy & burn alert tiers' },
  { command: 'burn',     description: 'Burn stats & progress' },
  { command: 'buy',      description: 'How to buy BOBAI' },
  { command: 'ca',       description: 'Contract address' },
  { command: 'help',     description: 'Show all commands' },
  { command: 'liq',      description: 'Liquidity depth, price impact & trade cost' },
  { command: 'nft',      description: 'Buy Drops NFT — tier progress & latest mints' },
  { command: 'price',    description: 'Live price, volume & market stats' },
  { command: 'security', description: 'Anti-scam reminder & official links' },
  { command: 'social',   description: 'All project links' },
  { command: 'worldcup', description: 'Tipgame pool, top 10 & latest credits' },
];

// Whale watcher menu — only registered for the BOBAI Intern chat (scope=chat).
// Overrides the public BOT_COMMANDS list inside that chat, so the "/" menu shows
// only these four entries.
const WHALE_COMMANDS = [
  { command: 'help',         description: 'Whale watcher help' },
  { command: 'whales',       description: 'Tracked wallets (clustered, with 24h dots)' },
  { command: 'whales24h',    description: 'Detailed last-24h breakdown' },
  { command: 'whaleadd',     description: 'Add wallet(s) to watch-set' },
  { command: 'whalerm',      description: 'Remove wallet(s) from watch-set' },
  { command: 'whalecleanup', description: 'Drop contract addresses from watch-set' },
];

const COMMANDS_VERSION = 'v11-no-scan';

// Telegram can sign every webhook call with a secret it sends back in the
// X-Telegram-Bot-Api-Secret-Token header. Without it, anyone who knows the
// Worker URL can post a fake update and make the bot answer into any chat it
// sits in. The secret is a Worker secret (TG_WEBHOOK_SECRET); this registers
// it with Telegram once per value, keeping the webhook URL Telegram already
// has, so the token never leaves Cloudflare and no script needs it.
async function ensureWebhookSecret(env) {
  const secret = env.TG_WEBHOOK_SECRET || '';
  if (!secret) return;
  const want = 'v1:' + secret.slice(0, 8);
  const have = await env.KV.get('webhook_secret_version');
  if (have === want) return;
  const info = await tg('getWebhookInfo', {});
  const url = info?.result?.url;
  if (!url) { console.error('[WEBHOOK] no webhook url registered, cannot attach secret'); return; }
  const res = await tg('setWebhook', { url, secret_token: secret, allowed_updates: info.result.allowed_updates || [] });
  if (res?.ok) {
    await env.KV.put('webhook_secret_version', want);
    console.log('[WEBHOOK] secret attached to', url);
  } else {
    console.error('[WEBHOOK] setWebhook failed:', JSON.stringify(res));
  }
}

async function ensureCommandsRegistered(env) {
  const current = await env.KV.get('commands_version');
  if (current === COMMANDS_VERSION) return;
  const res1 = await tg('setMyCommands', { commands: BOT_COMMANDS });
  let res2 = { ok: true };
  if (TG_INTERNAL_CHAT_ID) {
    res2 = await tg('setMyCommands', {
      commands: WHALE_COMMANDS,
      scope: { type: 'chat', chat_id: TG_INTERNAL_CHAT_ID },
    });
  }
  if (res1?.ok && res2?.ok) {
    await env.KV.put('commands_version', COMMANDS_VERSION);
    console.log('[COMMANDS] Registered', COMMANDS_VERSION);
  } else {
    console.error('[COMMANDS] Failed:', JSON.stringify({ res1, res2 }));
  }
}

// ==================== LP AGENT ALERT ====================

// The text for one LP agent record that acted. Pure, so it can be rendered
// against a real record without posting. Returns null when nothing moved.
// The entry to announce is the newest one that acted or failed — the record
// keeps those in `history` — not `last`: since the range is checked hourly,
// an hourly re-set is folded into the daily record without changing its
// timestamp, and keying on that timestamp is how the first automatic re-set
// (2026-09-04 07:50 UTC) went unannounced.
export function lpAlertEntry(rec) {
  const hist = rec && Array.isArray(rec.history) ? rec.history : [];
  return hist.length ? hist[hist.length - 1] : (rec && rec.last) || null;
}

export function formatLpAgentAlert(rec) {
  const last = lpAlertEntry(rec);
  if (!last || !last.acted) return null;
  const st = last.steps || {};
  const f = (v, d = 4) => Number(v || 0).toFixed(d);
  const lines = [];
  for (const s of Array.isArray(st.sweep) ? st.sweep : []) {
    if (s.acted && !s.error) lines.push(`💵 Sold <b>${f(s.sold, 2)} ${s.token}</b> earned by the AI side → <b>${f(s.received_bnb)} BNB</b> into the liquidity wallet`);
  }
  if (st.collect && st.collect.acted && !st.collect.error && (Number(st.collect.forwarded_bnb) > 0 || Number(st.collect.kept_bnb) > 0)) {
    lines.push(`💧 Collected the position's fees → <b>${f(st.collect.forwarded_bnb)} BNB</b> sent to the buyback bot, which buys $BOBAI and burns it${Number(st.collect.kept_bnb) > 0 ? `, <b>${f(st.collect.kept_bnb)} BNB</b> kept as capital` : ''}`);
  }
  if (st.rebalance && st.rebalance.acted && !st.rebalance.error) {
    lines.push(`🎯 Range re-set around today's price: ±${st.rebalance.width_pct}%${st.rebalance.new_position ? `, position #${st.rebalance.new_position}` : ''}`);
  }
  if (st.increase && st.increase.acted && !st.increase.error) {
    lines.push(`📈 Added <b>${f(st.increase.wbnb_used)} BNB</b> and ${f(st.increase.other_used, 3)} of the other side to the position`);
  }
  if (!lines.length) return null;
  return `🤖 <b>LP Agent — ${String(last.at || '').slice(0, 16).replace('T', ' ')} UTC</b>
The project's own liquidity position, run by a bot: AI income goes in as capital; of the fees, half comes out as $BOBAI burn and half stays to grow the position. Today it moved:

${lines.join('\n')}

Every step is a transaction on BNB Chain. Record: <a href="https://agent.brainonbnb.com/lp/agent">agent.brainonbnb.com/lp/agent</a>`;
}

// Once a day, after the 05:23 run, the state of the position in five lines —
// whether anything moved or not. The action alert above fires only when
// money moved; this is the report the operator asked for on 2026-09-04:
// "nur wenn etwas geaendert wurde, und taeglich ein rapport".
export function formatLpDailyReport(rec) {
  const last = rec && rec.last;
  if (!last || !last.at) return null;
  const st = last.steps || {}, c = st.collect || {}, rb = st.rebalance || {}, inc = st.increase || {};
  // The totals are the record's own money-flow figures (rec.flow, computed
  // once on the agent worker and shared with the liquidity page).
  const flow = rec.flow || {}, fin = flow['in'] || {}, fout = flow.out || {};
  const forwarded = fout.buyback_bnb || 0, kept = fout.kept_as_capital_bnb || 0, fees = (fin.fees && fin.fees.bnb) || 0;
  const swept = fin.income_bnb || 0, inPos = fout.into_position_bnb || 0;
  const gas = flow.gas || {};
  const f = (v, d = 5) => Number(v || 0).toFixed(d);
  const reset = rb.acted && !rb.error && rb.new_position;
  const pos = reset ? rb.new_position : (c.position || rb.position);
  const inRange = reset ? true : (c.in_range != null ? c.in_range : rb.in_range);
  const waiting = (Array.isArray(st.sweep) ? st.sweep : []).filter((s) => s.balance > 0).map((s) => `${f(s.balance, 2)} ${s.token || s.source}`).join(' + ');
  return `📋 <b>LP Agent — daily report ${String(last.at || '').slice(0, 10)}</b>

🎯 Position <b>#${pos || '—'}</b>${rb.value_bnb != null ? `, worth ${f(rb.value_bnb, 4)} BNB` : ''} · ${inRange === false ? 'out of range (the hourly check re-sets it after 2 h outside)' : 'in range and earning'}
💧 Fees owed now: <b>${f(c.owed && c.owed.bnb_equivalent, 6)} BNB</b> · ${fees > 0 ? `collected so far <b>${f(fees)} BNB</b>: ${f(forwarded)} to the buyback bot, ${f(kept)} kept as capital` : 'nothing collected yet — fees are left to grow until collecting beats the gas'}
💵 AI income waiting: ${waiting || 'none'} · ${swept > 0 ? `swept in so far: <b>${f(swept)} BNB</b>` : 'nothing swept yet'}${inPos ? ` · put into the position: <b>${f(inPos)} BNB</b>` : ''}
⛽ Cost so far: ${gas.transactions || 0} transaction${gas.transactions === 1 ? '' : 's'}, ${f(gas.bnb, 6)} BNB of gas
🤖 Today's run: ${last.acted ? 'it acted' : 'nothing to move — every step was under its floor'}${last.ok === false ? ' · one step failed, the operator has been told' : ''}

Record: <a href="https://agent.brainonbnb.com/lp/agent">agent.brainonbnb.com/lp/agent</a> · <a href="https://brainonbnb.com/liquidity">how it works</a>`;
}

async function postLpDailyReport(env) {
  const today = new Date().toISOString().slice(0, 10);
  const done = await env.KV.get('lp_report_date');
  if (done === today) return false;
  const r = await fetch('https://agent.brainonbnb.com/lp/agent', { cf: { cacheTtl: 60 } });
  if (!r.ok) return false;
  const rec = await r.json();
  // The report is about today's daily run; if it has not landed yet, wait for
  // the next tick rather than reporting yesterday twice.
  if (!rec.last || String(rec.last.at || '').slice(0, 10) !== today) return false;
  const text = formatLpDailyReport(rec);
  if (!text) return false;
  await env.KV.put('lp_report_date', today);
  await tg('sendMessage', { chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true });
  return true;
}

async function postLpAgentAlert(env) {
  const r = await fetch('https://agent.brainonbnb.com/lp/agent', { cf: { cacheTtl: 60 } });
  if (!r.ok) return false;
  const rec = await r.json();
  const ev = lpAlertEntry(rec);
  const at = ev && ev.at;
  if (!at) return false;
  const seen = await env.KV.get('lp_alert_at');
  if (seen === at) return false;
  const text = formatLpAgentAlert(rec);
  // Remember quiet records too, or every tenth minute re-reads the same one.
  await env.KV.put('lp_alert_at', at);
  if (!text) return false;
  await tg('sendMessage', { chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true });
  return true;
}

// ==================== CHAT COMMANDS ====================

async function handleCommand(msg, env) {
  const rawText = (msg.text || '').trim();
  const firstWord = rawText.toLowerCase().split('@')[0].split(' ')[0];
  // A slash command is a command wherever it stands. A bare word ("price",
  // "buy", "help") only counts when it is the whole message — "buy the dip"
  // or "help me out" in the group is conversation, not a request to the bot.
  const singleWord = !/\s/.test(rawText);
  const text = (firstWord.startsWith('/') || singleWord) ? firstWord : '';
  const chatId = msg.chat.id;
  let reply = null;

  // ===== Admin-only whale commands (only inside TG_INTERNAL_CHAT_ID) =====
  const isInternal = TG_INTERNAL_CHAT_ID && String(chatId) === String(TG_INTERNAL_CHAT_ID);

  // Slash-prefixed (work everywhere, but silent-ignore outside internal chat)
  const WHALE_SLASH = ['/whales', '/whales24h', '/whaleadd', '/whalerm', '/whalecleanup', '/whalehelp'];
  if (WHALE_SLASH.includes(text)) {
    if (!isInternal) return;
    return handleWhaleAdmin(rawText, text, chatId);
  }

  // Bare-word triggers inside the internal chat only — typing `whales`, `whales24h`,
  // `whaleadd 0x...`, `whalerm 0x...`, `whalehelp` works without the leading slash.
  const WHALE_BARE = ['whales', 'whales24h', 'whaleadd', 'whalerm', 'whalecleanup', 'whalehelp'];
  if (isInternal && WHALE_BARE.includes(firstWord)) {
    return handleWhaleAdmin(rawText, '/' + firstWord, chatId);
  }

  // Inside the internal chat: route /help and /start to whale help instead of public help.
  if (isInternal && (text === '/help' || text === '/start' || text === 'help')) {
    return handleWhaleAdmin(rawText, '/whalehelp', chatId);
  }

  switch (text) {
    case '/buy':
    case 'buy': {
      reply = `🛒 <b>How to Buy BOBAI</b>

<b>Step 1:</b> Get BNB in your wallet
<i>MetaMask, Trust Wallet, or any Web3 Wallet (Binance / Bitget / Gate / OKX)</i>

<b>Step 2:</b> Swap BNB → BOBAI
🔶 <a href="https://web3.binance.com/en/token/bsc/${BOBAI_TOKEN}">Binance Web3 Wallet</a>
🟦 <a href="https://web3.bitget.com/en/swap/bnb/${BOBAI_TOKEN}">Bitget Wallet</a>
🔵 <a href="https://web3.gate.com/trade/bsc/${BOBAI_TOKEN}">Gate DEX</a>
🟩 <a href="https://web3.okx.com/token/bsc/${BOBAI_TOKEN}">OKX Wallet</a>
🤚 <a href="https://four.meme/token/${BOBAI_TOKEN}">Four.Meme</a>
🥞 <a href="https://pancakeswap.finance/swap?outputCurrency=${BOBAI_TOKEN}">PancakeSwap</a>

<b>Step 3:</b> Set slippage to 4-5%
<i>(3% on-chain tax on every trade)</i>

📋 CA: <code>${BOBAI_TOKEN}</code>`;
      break;
    }

    case '/price':
    case 'price': {
      // Everything from the chain and from the bot's own ledger. No indexer
      // is asked: a third party's rate limiter must never decide whether the
      // person who typed /price gets a number.
      const [pair, burn, ledger] = await Promise.all([readPairOnchain(), getBurnStats(), readSwapLedger(env)]);
      if (!pair) {
        reply = '⚠️ Could not read the pool from the chain right now. Try again in a moment!';
        break;
      }
      let supply = 0;
      try { supply = await getTotalSupply(); } catch {}
      const price = pair.price, priceInBnb = pair.priceInBnb;
      const fdv = supply > 0 ? price * supply : null;
      // Market cap the way BscScan shows it under "Circulating Supply Market Cap":
      // total minus what sits in the dead address, times the price. FDV counts the
      // burned tokens too, so the two drift apart with every burn.
      const mcap = supply > 0 && burn.percent !== '?' ? price * (supply - burn.burnedTokens) : null;
      const liq = 2 * pair.wbnbReserve * pair.bnbUsd;
      const st = ledgerStats(ledger, priceInBnb);
      const usdOrNa = (v) => Number.isFinite(v) ? formatUsd(v) : 'n/a';
      const change = (v) => v == null ? 'n/a' : priceChangeArrow(v);
      const hoursTxt = st ? (st.hours >= LEDGER_HOURS - 0.5 ? '24h' : `${st.hours < 1 ? Math.max(1, Math.round(st.hours * 60)) + ' min' : st.hours.toFixed(1).replace(/\.0$/, '') + 'h'}`) : '24h';
      const volumeUsd = st ? st.vol_bnb * pair.bnbUsd : null;

      reply = `📊 <b>BOBAI Live Price</b>

💰 <b>$${price.toFixed(8)}</b>
💎 ${priceInBnb.toFixed(10)} BNB

📈 <b>Price Change</b>
1h: ${change(st && st.h1)}  ·  6h: ${change(st && st.h6)}  ·  24h: ${change(st && st.h24)}

📊 <b>Market Stats</b>
🏷 Market Cap: ${usdOrNa(mcap)}
🏷 FDV: ${usdOrNa(fdv)}
💧 Liquidity: ${usdOrNa(liq)}
📦 ${hoursTxt} Volume: ${st ? usdOrNa(volumeUsd) : 'n/a'}
🔄 ${hoursTxt} Trades: ${st ? `${st.buys} buys / ${st.sells} sells` : 'n/a'}

🔥 Burned: ${burn.percent}% (${formatNumber(burn.burnedTokens)} BOBAI)

⛓ <i>Read from the chain by this bot: price and liquidity from the pool's reserves and the Chainlink BNB feed, market cap from the supply minus the dead address, volume and trades from the pool's own swap events${st ? (st.hours >= LEDGER_HOURS - 0.5 ? ' over the last 24 hours' : ` over the last ${hoursTxt} (the record is still filling)`) : ' (the record starts with the next tick)'}. Nothing here comes from a price site.</i>

📈 <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a> · 🦎 <a href="https://www.geckoterminal.com/bsc/pools/${BOBAI_PAIR}">GeckoTerminal</a>`;
      break;
    }

    case '/burn':
    case 'burn': {
      const burn = await getBurnStats();

      reply = `🔥 <b>BOBAI Burn Dashboard</b>

🔥 Burned: <b>${formatNumber(burn.burnedTokens)} BOBAI</b>
📊 That's <b>${burn.percent}%</b> of total supply!

⚙️ <b>How it works:</b>
♻️ 3% tax on every buy & sell, fixed in the contract
🔥 The buyback bot burns BOBAI from it around the clock
🔥 The rest burns BOB, funds liquidity and the creator — the split changes by phase
👤 Contract ownership renounced

💡 <i>Every trade makes BOBAI more scarce!</i>

🔗 <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${DEAD}">View Burns on BscScan</a> · <a href="https://brainonbnb.com/#tokenomics">Current split</a>`;
      break;
    }

    case '/liq':
    case 'liq':
    case '/liquidity':
    case 'liquidity':
    case '/depth': {
      const lq = await fetchLiquidityStats();
      if (!lq) {
        reply = '⚠️ Could not read the pool right now. Try again in a moment!';
        break;
      }

      // Explicit 'en-US' everywhere — never let the runtime pick the separators.
      const usd0 = n => '$' + Math.round(n).toLocaleString('en-US');
      const usd2 = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const pc = n => n.toFixed(2) + '%';
      const signed = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
      const row = (d, imp, cost) =>
        `$${d.usd.toLocaleString('en-US')} · ${signed(imp)} · costs ${pc(cost)}`;

      const ratios = [];
      if (lq.mcap) ratios.push(`💧 Liq / Mcap: <b>${(lq.tvl / lq.mcap * 100).toFixed(1)}%</b>`);
      if (lq.mcap) ratios.push(`🔒 Hard BNB backing: <b>${(lq.bnbSide / lq.mcap * 100).toFixed(1)}%</b> of mcap`);
      // 99.9996% is not 100.000% (the dashboard says the same, pcEdge in app.js).
      if (lq.lpBurnedPct !== null) ratios.push(`🔥 LP burned: <b>${lq.lpBurnedPct >= 99.9995 && lq.lpBurnedPct < 100 ? '>99.999' : lq.lpBurnedPct.toFixed(3)}%</b>`);

      reply = `💧 <b>BOBAI Liquidity Depth</b>
<i>Read from the pool contract${lq.block ? ' at block ' + lq.block.toLocaleString('en-US') : ' just now'} — the pool moves with every trade, so run /liq again rather than trusting an older message.</i>

💎 Pool: <b>${usd0(lq.tvl)}</b> (both sides)
🟡 BNB side: <b>${usd0(lq.bnbSide)}</b> · ${lq.rBnb.toFixed(2)} BNB
🧠 BOBAI side: ${formatNumber(lq.rTok)} BOBAI
${ratios.join('\n')}

<b>What moves the price 1%</b>
🟢 A buy of <b>${usd2(lq.up1)}</b> → +1%
🔴 A sell of <b>${usd2(lq.dn1)}</b> → −1%

<b>Buying — price up</b>
${lq.depth.map(d => row(d, d.impactBuy, d.costBuy)).join('\n')}

<b>Selling — price down</b>
${lq.depth.map(d => row(d, d.impactSell, d.costSell)).join('\n')}

💡 <i>Impact = how far the trade moves the price. Cost = what you give up vs spot (3% tax + 0.25% LP fee + fill) — 3.24% of it applies at any size.</i>
💡 <i>Every LP add is burned to the dead address. Nobody can pull it.</i>

📊 <a href="https://brainonbnb.com/#tokenomics">Full depth panel</a> · 🔍 <a href="https://bscscan.com/address/${BOBAI_PAIR}">Pool contract</a>`;
      break;
    }

    case '/social':
    case 'social':
    case 'socials':
    case '/links':
    case 'links': {
      reply = `🧠 <b>BOBAI — All Links</b>

🌍 <a href="https://brainonbnb.com">Website & Dashboard</a>

🐦 <a href="https://birdeye.so/token/${BOBAI_TOKEN}?chain=bsc">Birdeye</a>
🔷 <a href="https://blockspot.io/coin/brain-on-bnb-ai/">Blockspot.io</a>
🫧 <a href="https://v2.bubblemaps.io/map?address=${BOBAI_TOKEN}&amp;chain=bsc">Bubblemaps</a>
🔍 <a href="https://bscscan.com/token/${BOBAI_TOKEN}">BscScan</a>
🦎 <a href="https://www.coingecko.com/en/coins/brain-on-bnb-ai">CoinGecko</a>
🌙 <a href="https://coinmun.com/coins/bob-6">CoinMun</a>
🦅 <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">DEX Screener</a>
🌐 <a href="https://www.dextools.io/token/bobai">DEXTools.io</a>
😉 <a href="https://funtok.io/coins/bob-6">FunTok</a>
🦎 <a href="https://www.geckoterminal.com/bsc/pools/${BOBAI_PAIR}">GeckoTerminal</a>
🐊 <a href="https://gmgn.ai/bsc/token/${BOBAI_TOKEN}">GMGN.AI</a>
🫆 <a href="https://app.insightx.network/atlas/bsc/${BOBAI_TOKEN}">InsightX</a>

🔶 <a href="https://web3.binance.com/en/token/bsc/${BOBAI_TOKEN}">Binance Web3 Wallet</a>
🟦 <a href="https://web3.bitget.com/en/swap/bnb/${BOBAI_TOKEN}">Bitget Wallet</a>
🔵 <a href="https://web3.gate.com/trade/bsc/${BOBAI_TOKEN}">Gate DEX</a>
🟩 <a href="https://web3.okx.com/token/bsc/${BOBAI_TOKEN}">OKX Wallet</a>
🤚 <a href="https://four.meme/token/${BOBAI_TOKEN}">Four.Meme</a>
🥞 <a href="https://pancakeswap.finance/swap?outputCurrency=${BOBAI_TOKEN}">PancakeSwap</a>

🐦 <a href="https://x.com/BrainOnBNB">X Official</a>
🗣 <a href="https://x.com/BrainOnBNBAI">X Community</a>
🎮 <a href="https://brainonbnb.com/game">Game</a>
⚽ <a href="https://brainonbnb.com/worldcup">Worldcup '26</a>
🎁 <a href="${NFT_DASHBOARD_URL}">Buy Drops NFT</a>
🧠 <a href="https://brainonbnb.com/brainscreener/">brainScreener</a>
📊 <a href="https://brainonbnb.com/scanner">Pool Scanner (Beta)</a>

📋 CA: <code>${BOBAI_TOKEN}</code>`;
      break;
    }

    case '/contract':
    case 'contract':
    case '/ca':
    case 'ca': {
      reply = `📋 <b>BOBAI Contract</b>

<code>${BOBAI_TOKEN}</code>

<i>Tap to copy — paste in your DEX</i>

🔍 <a href="https://bscscan.com/token/${BOBAI_TOKEN}">View on BscScan</a>`;
      break;
    }

    case '/security':
    case 'security':
    case '/scam':
    case 'scam': {
      reply = `⚠️ <b>BOBAI Security Notice</b>

🚫 Admins will <b>NEVER</b> DM you first
🚫 <b>NEVER</b> share your seed phrase or private key
🚫 <b>NEVER</b> connect your wallet to unknown sites
🚫 No giveaways, no presales, no airdrops via DM

✅ <b>Official Links Only</b>
🌍 brainonbnb.com
💬 t.me/bobai_official
🐦 x.com/BrainOnBNB

📋 <b>Official CA:</b>
<code>${BOBAI_TOKEN}</code>

<i>Anything else = scam. Stay safe.</i>`;
      break;
    }

    case '/alerts':
    case 'alerts': {
      reply = `🔔 <b>BOBAI Alert Tiers</b>

🧠 <b>Buy Alert Tiers</b>
💰 $100+ → NICE BUY!
💎 $150+ → BIG BUY!
🚀 $250+ → HUGE BUY!
🐋 $500+ → WHALE BUY!
⚡ $1000+ → THUNDER BUY!
🦑 $2500+ → KRAKEN BUY!

🔥 <b>Burn Alert Tiers</b>
♻️ &lt; $5 → BURN
🕯️ $5+ → NICE BURN!
🌋 $15+ → BIG BURN!
💀 $50+ → MEGA BURN!
☄️ $150+ → APOCALYPSE BURN!
💥 $250+ → SUPERNOVA BURN!

💡 <i>Buys under $100 are not alerted.</i>`;
      break;
    }

    case '/help':
    case 'help':
    case '/start': {
      reply = `🤖 <b>Welcome to the BOBAI Bot!</b>

Here's what I can do:

🔔 /alerts — Buy & burn alert tiers
🔥 /burn — Burn stats & progress
🛒 /buy — How to buy BOBAI
📋 /ca — Contract address
💧 /liq — Liquidity depth, price impact & trade cost
🎁 /nft — Buy Drops NFT — tier progress & latest mints
📊 /price — Live price, volume & market stats
⚠️ /security — Anti-scam reminder & official links
🧠 /social — All project links
🏆 /worldcup — Tipgame pool, top 10 & latest credits

💡 <i>I also post alerts for buys & burns!</i>

🌍 <a href="https://brainonbnb.com">Website</a> · 📈 <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a>`;
      break;
    }

    case '/chatid':
    case 'chatid': {
      const info = {
        chat_id: msg.chat.id,
        chat_type: msg.chat.type,
        chat_title: msg.chat.title || null,
        from_user: msg.from?.username || msg.from?.id || null,
      };
      console.log('[CHATID]', JSON.stringify(info));
      reply = `🆔 <b>Chat Info</b>
<code>chat_id: ${msg.chat.id}</code>
type: ${msg.chat.type}
title: ${msg.chat.title || '(private)'}`;
      break;
    }

    case '/worldcup':
    case 'worldcup':
    case '/wc':
    case 'wc': {
      const [pool, top10, playerCount, donations, taxAdds] = await Promise.all([
        fetchWorldcupPool(),
        fetchWorldcupLeaderboard(10),
        fetchWorldcupPlayerCount(),
        fetchWorldcupDonations(3, false),
        fetchWorldcupDonations(3, true),
      ]);
      const regLine = playerCount != null ? ` <i>(of ${playerCount})</i>` : '';

      const total = pool ? parseFloat(pool.total_bobai) || 0 : 0;
      const price = pool ? parseFloat(pool.bobai_price_usd) || 0 : 0;
      const hasPrice = price > 0;
      const usd = (amount) => hasPrice ? formatUsd(amount * price) : 'n/a';
      const groupPot  = pool ? parseFloat(pool.group_pot)  || 0 : 0;
      const endPool   = pool ? parseFloat(pool.endpool)    || 0 : 0;
      const cryptoPot = pool ? parseFloat(pool.crypto_pot) || 0 : 0;

      let leaderboardLines;
      if (top10.length === 0) {
        leaderboardLines = '<i>No players yet — be the first!</i>';
      } else {
        const medals = ['🥇','🥈','🥉'];
        leaderboardLines = top10.map((r, i) => {
          const rank = medals[i] || `<code>#${String(i+1).padStart(2,' ')}</code>`;
          const flag = isoToFlag(r.avatar_country);
          const wallet = r.has_wallet ? ' ⚽' : '';
          const pts = (r.total_points || 0);
          return `${rank} ${flag} <b>${r.username}</b>${wallet} ${pts} pts`;
        }).join('\n');
      }

      const fmtTxLine = (row) => {
        const when = new Date(row.created_at).toISOString().slice(5,16).replace('T',' ');
        const inAmt = parseFloat(row.amount_in) || 0;
        const bobai = parseFloat(row.amount_bobai) || 0;
        const unit  = row.token === 'TAX' ? 'BNB' : row.token;
        const link  = row.swap_tx_hash
          ? `<a href="https://bscscan.com/tx/${row.swap_tx_hash}">↗</a>`
          : '';
        return `<code>${when}</code> · ${inAmt.toFixed(4)} ${unit} → ${formatNumber(bobai)} BOBAI ${link}`;
      };

      const donLines = donations.length
        ? donations.map(fmtTxLine).join('\n')
        : '<i>None yet</i>';
      const taxLines = taxAdds.length
        ? taxAdds.map(fmtTxLine).join('\n')
        : '<i>Tax routing starts 11 June 2026</i>';

      reply = `🏆 <b>BOBAI Worldcup '26 — Prize Pool</b>

💰 <b>${formatNumber(total)} BOBAI</b> ≈ ${usd(total)}

📊 <b>Pots</b>
🅰️ Group · 60 %: ${formatNumber(groupPot)} BOBAI (${usd(groupPot)})
🏁 End pool · 30/90 %: ${formatNumber(endPool)} BOBAI (${usd(endPool)})
📈 Crypto · 10 %: ${formatNumber(cryptoPot)} BOBAI (${usd(cryptoPot)})

🏅 <b>Top 10 Overall</b>${regLine}
${leaderboardLines}

💚 <b>Latest donations</b>
${donLines}

⚙️ <b>Latest tax adds</b>
${taxLines}

🎮 <a href="${WORLDCUP_URL}">Play at brainonbnb.com/worldcup</a>

<i>⚽ = wallet linked (payout-eligible)</i>`;
      break;
    }

    case '/nft':
    case 'nft': {
      const state = await fetchNftState();
      const tiers = state && state.minted && state.cap ? { minted: state.minted, cap: state.cap } : null;
      const allDrops = state?.drops || [];
      const drops = allDrops.slice(0, 3);

      let progressLines, totalMinted = 0, totalCap = 0;
      if (!tiers) {
        progressLines = '<i>Tier data unavailable — try again in a moment.</i>';
      } else {
        progressLines = NFT_TIERS.map(([emoji, label, thr], i) => {
          const m = tiers.minted[i], c = tiers.cap[i];
          totalMinted += m; totalCap += c;
          const labelPad = `${emoji} ${label}`.padEnd(12, ' ');
          const thrPad   = `$${thr}+`.padEnd(7, ' ');
          return `<code>${labelPad} ${thrPad} ${nftProgressBar(m, c)}  ${m} / ${c}</code>`;
        }).join('\n');
      }
      if (totalCap === 0) totalCap = 1925; // fallback so header still reads sensibly on fetch fail

      // Prefer live on-chain holder count (picks up secondary transfers like donations).
      // Fall back to unique mint recipients if the API didn't return it.
      const uniqueHolders = (typeof state?.holders === 'number')
        ? state.holders
        : new Set(allDrops.map(d => d.to).filter(Boolean)).size;
      const dropLines = drops.length
        ? drops.map(d => {
            const when = new Date(d.ts * 1000).toISOString().slice(5, 16).replace('T', ' ');
            const [tEmoji, tLabel] = NFT_TIERS[d.tier] || ['?', '?'];
            const [rEmoji, rLabel] = NFT_RARITIES[d.rarity] || ['?', '?'];
            const txHash = d.mintTx || d.tx;
            const idLabel = d.tokenId != null ? `#${d.tokenId}` : '↗';
            const idLink  = txHash ? `<a href="https://bscscan.com/tx/${txHash}">${idLabel}</a>` : idLabel;
            return `<code>${when}</code> · ${tEmoji} <b>${tLabel}</b> × ${rEmoji} ${rLabel} · $${d.usd} · ${idLink}`;
          }).join('\n')
        : '<i>No drops yet — be the first!</i>';

      const holdersLine = uniqueHolders > 0
        ? ` · ${uniqueHolders} unique holder${uniqueHolders === 1 ? '' : 's'}`
        : '';

      reply = `🎁 <b>BOBAI Buy Drops — NFT Collection</b>

🟢 <b>${totalMinted} / ${totalCap}</b> minted${holdersLine}

📊 <b>Tier Progress</b>
${progressLines}

🎰 <b>Latest Drops</b>
${dropLines}

🎯 <b>How it works</b>
Buy ≥$100 of $BOBAI → auto-mint NFT to your wallet.
Tier = buy size · Rarity = rolled probabilistically.
Sold out tiers stop minting (no refund, no promote).

🖼 <a href="${NFT_DASHBOARD_URL}">brainonbnb.com/nft</a> · 📜 <a href="https://bscscan.com/token/${NFT_CONTRACT}">BscScan</a>`;
      break;
    }
  }

  if (reply) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: reply,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}

// ==================== WORKER ENTRY ====================

export default {
  // Webhook handler (Telegram sends updates here)
  async fetch(request, env) {
    TG_BOT_TOKEN = env.BOT_TOKEN;
    TG_INTERNAL_CHAT_ID = env.TG_INTERNAL_CHAT_ID || '';
    WHALE_ENV = env;

    // === /broadcast — authenticated "brain update" announcement endpoint ===
    // POST /broadcast with header `X-Broadcast-Secret: <env.BROADCAST_SECRET>`
    // and JSON body `{ text: "<HTML>" , prefixBrain?: true, disablePreview?: true }`.
    // Sends a lone 🧠 first (Telegram renders 1-3 emoji-only messages as JUMBO size,
    // which acts as the visual "this is an update" header) followed by the announcement.
    // Used by tg-update.js to broadcast workshop updates without exposing BOT_TOKEN locally.
    const url = new URL(request.url);

    // === /health — liveness, readable by anyone, secrets by nobody ===
    // Reports the last cron tick (written every tenth minute by scheduled()),
    // its age, and whether the bot is configured to post at all. A check that
    // only proved the worker answers HTTP would be worthless: a worker whose
    // cron has stopped still answers HTTP perfectly.
    // /health?sources=1 additionally probes every price source from inside
    // the Worker: the chain read and the two indexers, with the HTTP status
    // each one returns to Cloudflare. That is the view the bot has, not the
    // view a laptop has — the two differ whenever an indexer blocks Workers.
    if (url.pathname === '/health' && request.method === 'GET' && url.searchParams.get('sources')) {
      const probe = async (name, u) => {
        const t0 = Date.now();
        try {
          const r = await fetch(u, { headers: { 'Accept': 'application/json' } });
          const body = (await r.text()).slice(0, 160);
          return { name, status: r.status, ms: Date.now() - t0, body: r.ok ? undefined : body };
        } catch (e) { return { name, status: null, ms: Date.now() - t0, error: e.message || String(e) }; }
      };
      const [pair, gecko, dex] = await Promise.all([
        readPairOnchain(),
        probe('geckoterminal', `${GECKO_POOL_URL}?_=${Date.now()}`),
        probe('dexscreener', `https://api.dexscreener.com/latest/dex/tokens/${BOBAI_TOKEN}`),
      ]);
      return new Response(JSON.stringify({
        ok: true,
        chain: pair ? { price_usd: pair.price, bnb_usd: pair.bnbUsd } : null,
        indexers: [gecko, dex],
        ledger: await (async () => { const l = await readSwapLedger(env); const st = ledgerStats(l, pair ? pair.priceInBnb : 0); return st ? { buckets: l.length, hours: Number(st.hours.toFixed(2)), trades: st.trades, vol_bnb: Number(st.vol_bnb.toFixed(4)), h1: st.h1, h6: st.h6, h24: st.h24 } : { buckets: 0 }; })(),
      }, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      const last = await env.KV.get('last_cron');
      const ageSeconds = last ? Math.round((Date.now() - new Date(last).getTime()) / 1000) : null;
      return new Response(JSON.stringify({
        ok: true,
        worker: 'bobai-tg-bot',
        last_cron: last || null,
        age_seconds: ageSeconds,
        // A heartbeat older than a quarter hour means the every-minute cron has
        // missed its ten-minute write, which is a stopped worker, not a lull.
        cron_alive: ageSeconds !== null && ageSeconds < 900,
        channel_configured: Boolean(env.BOT_TOKEN && TG_CHAT_ID),
        alerts: ['buys', 'burns'],
        webhook_secured: Boolean(env.TG_WEBHOOK_SECRET) && Boolean(await env.KV.get('webhook_secret_version')),
      }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      const want = env.BROADCAST_SECRET || '';
      if (!want || got !== want) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      let body = {};
      try { body = await request.json(); } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const text = (body.text || '').toString().trim();
      if (!text) {
        return new Response(JSON.stringify({ ok: false, error: 'missing text' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      // target: 'internal' routes to TG_INTERNAL_CHAT_ID (BOBAI Intern).
      // Default = public group (TG_CHAT_ID). Brain prefix defaults off for internal.
      const targetChat = body.target === 'internal' ? TG_INTERNAL_CHAT_ID : TG_CHAT_ID;
      if (!targetChat) {
        return new Response(JSON.stringify({ ok: false, error: `target chat not configured` }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const wantBrain = body.target === 'internal' ? body.prefixBrain === true : body.prefixBrain !== false;
      try {
        if (wantBrain) {
          await tg('sendMessage', {
            chat_id: targetChat,
            text: '🧠',
            disable_notification: true,
          });
        }
        const r = await tg('sendMessage', {
          chat_id: targetChat,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: body.disablePreview !== false,
        });
        return new Response(JSON.stringify({ ok: true, message_id: r?.result?.message_id || null }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        console.error('[BROADCAST ERROR]', err.message || err);
        return new Response(JSON.stringify({ ok: false, error: 'send failed' }), {
          status: 500, headers: { 'content-type': 'application/json' },
        });
      }
    }

    // === /broadcastphoto — authenticated announcement with an image ===
    // POST multipart/form-data with header `X-Broadcast-Secret: <env.BROADCAST_SECRET>`
    // and fields: `photo` (image file), `caption` (HTML, optional, max 1024 chars —
    // Telegram's caption limit), `target` ('internal' routes to TG_INTERNAL_CHAT_ID),
    // `prefixBrain` ('0' disables the jumbo 🧠 header).
    // Mirrors /broadcast but sends one sendPhoto message instead of text, so a report
    // card and its numbers arrive together. BOT_TOKEN never leaves Cloudflare.
    if (url.pathname === '/broadcastphoto' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      let inForm;
      try { inForm = await request.formData(); } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'expected multipart form' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const file = inForm.get('photo');
      if (!file || typeof file === 'string') {
        return new Response(JSON.stringify({ ok: false, error: 'missing photo file' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const caption = (inForm.get('caption') || '').toString().trim();
      if (caption.length > 1024) {
        return new Response(JSON.stringify({ ok: false, error: `caption too long: ${caption.length}/1024` }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const target = (inForm.get('target') || '').toString();
      const targetChat = target === 'internal' ? TG_INTERNAL_CHAT_ID : TG_CHAT_ID;
      if (!targetChat) {
        return new Response(JSON.stringify({ ok: false, error: 'target chat not configured' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const wantBrain = target === 'internal'
        ? (inForm.get('prefixBrain') || '').toString() === '1'
        : (inForm.get('prefixBrain') || '').toString() !== '0';
      try {
        if (wantBrain) {
          await tg('sendMessage', { chat_id: targetChat, text: '🧠', disable_notification: true });
        }
        const tgForm = new FormData();
        tgForm.append('chat_id', targetChat);
        tgForm.append('photo', file, 'report.png');
        if (caption) {
          tgForm.append('caption', caption);
          tgForm.append('parse_mode', 'HTML');
        }
        const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
          method: 'POST', body: tgForm,
        });
        const j = await r.json();
        if (!j.ok) {
          console.error('[BROADCASTPHOTO] telegram rejected:', JSON.stringify(j));
          return new Response(JSON.stringify({ ok: false, error: j.description || 'send failed' }), {
            status: 502, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, message_id: j.result?.message_id || null }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        console.error('[BROADCASTPHOTO ERROR]', err.message || err);
        return new Response(JSON.stringify({ ok: false, error: 'send failed' }), {
          status: 500, headers: { 'content-type': 'application/json' },
        });
      }
    }

    // === /rpclogs — authenticated eth_getLogs proxy over the keyed endpoints ===
    // POST JSON `{ address, topics, fromBlock, toBlock }` with header
    // `X-Broadcast-Secret`. The free BSC endpoints cap getLogs at ~50 blocks and the
    // Binance dataseeds refuse ranges outright, so historical scans are impossible
    // from a laptop — the keyed NodeReal URLs only exist as Cloudflare secrets.
    // This forwards a single getLogs call and nothing else: the caller does the
    // paging, so no Worker request ever runs long. Read-only by construction —
    // the method is hardcoded, only the range and filter come from the body.
    if (url.pathname === '/rpclogs' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      let body = {};
      try { body = await request.json(); } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const filter = {
        address: body.address,
        topics: Array.isArray(body.topics) ? body.topics : [],
        fromBlock: body.fromBlock,
        toBlock: body.toBlock,
      };
      if (!filter.address || !filter.fromBlock || !filter.toBlock) {
        return new Response(JSON.stringify({ ok: false, error: 'need address, fromBlock, toBlock' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const endpoints = [...keyedEndpoints(env), ...LOGS_RPC_ENDPOINTS];
      let lastErr = 'no endpoint answered';
      for (const rpc of endpoints) {
        try {
          const r = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': LOGS_UA },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [filter] }),
          });
          const j = await r.json();
          if (Array.isArray(j.result)) {
            return new Response(JSON.stringify({ ok: true, logs: j.result }), {
              headers: { 'content-type': 'application/json' },
            });
          }
          lastErr = j.error?.message || 'no result';
        } catch (e) {
          lastErr = e.message || String(e);
        }
      }
      return new Response(JSON.stringify({ ok: false, error: lastErr }), {
        status: 502, headers: { 'content-type': 'application/json' },
      });
    }

    // === /whale-summary — public read-only whale-flow aggregates ===
    // Consumed by the dashboard worker's bobai_smart_money MCP tool. Exposes
    // only aggregates + top movers from the same KV event log that powers
    // /whales24h — no admin data, no secrets. Events are on-chain-derived
    // (BOBAI Transfer logs, scanned every minute by the cron).
    if (url.pathname === '/whale-summary' && request.method === 'GET') {
      try {
        const [events, tracked] = await Promise.all([loadWhaleEvents(env), loadTrackedWallets(env)]);
        // Holdings snapshot: self-heals if today's cron snapshot is missing
        // (first request of the day takes it — date-guarded, so at most once).
        let snaps = [];
        try { snaps = await takeWhaleSnapshotIfDue(env, tracked); }
        catch (e) { console.error('[WHALE-SNAP LAZY ERROR]', e.message || e); snaps = await loadWhaleSnapshots(env); }
        const round2 = (x) => Math.round(x * 100) / 100;
        const win = (hours) => {
          const r = recentEvents(events, hours);
          let usdIn = 0, usdOut = 0, buys = 0, sells = 0, burns = 0, transfers = 0;
          for (const e of r) {
            const u = e.usdValue || 0;
            if (e.kind === 'BUY') { buys++; usdIn += u; }
            else if (e.kind === 'TRANSFER_IN') { transfers++; usdIn += u; }
            else if (e.kind === 'SELL') { sells++; usdOut += u; }
            else if (e.kind === 'BURN') { burns++; usdOut += u; }
            else if (e.kind === 'TRANSFER_OUT') { transfers++; usdOut += u; }
          }
          return { events: r.length, buys, sells, burns, transfers, usd_in: round2(usdIn), usd_out: round2(usdOut), net_usd: round2(usdIn - usdOut) };
        };
        const moverWallet = (e) => (e.kind === 'SELL' || e.kind === 'BURN' || e.kind === 'TRANSFER_OUT') ? e.from : e.to;
        const movers = recentEvents(events, 24)
          .filter(e => ['BUY', 'SELL', 'BURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'INTERNAL_T'].includes(e.kind))
          .slice()
          .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
          .slice(0, 3)
          .map(e => ({
            kind: e.kind,
            bobai: e.amount || 0,
            usd: round2(e.usdValue || 0),
            wallet: moverWallet(e),
            tx: e.txHash ? 'https://bscscan.com/tx/' + e.txHash : null,
            time_utc: e.ts ? new Date(e.ts).toISOString() : null,
          }));
        const last = events[events.length - 1];
        return new Response(JSON.stringify({
          as_of: new Date().toISOString(),
          tracked_wallets: tracked.length,
          tracking_threshold: '10,000,000 BOBAI (1% of supply) — wallets enter the watchlist automatically when they cross it',
          holdings: snapshotHoldings(snaps),
          last_24h: win(24),
          last_7d: win(168),
          top_movers_24h: movers,
          last_event: last ? { kind: last.kind, usd: round2(last.usdValue || 0), time_utc: last.ts ? new Date(last.ts).toISOString() : null } : null,
        }, null, 2), {
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' },
        });
      } catch (e) {
        console.error('[WHALE-SUMMARY ERROR]', e.message || e);
        return new Response(JSON.stringify({ error: 'whale summary unavailable' }), {
          status: 502, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        });
      }
    }

    // === /sendsticker — authenticated one-off sticker upload (preview tool) ===
    // POST multipart/form-data with header `X-Broadcast-Secret: <env.BROADCAST_SECRET>`
    // and fields: `chat_id` (string) + `sticker` (the .webm file). The worker forwards
    // it to Telegram sendSticker so the BOT_TOKEN never leaves Cloudflare. Used by
    // tg-send-sticker.js to preview animated stickers without exposing the token.
    if (url.pathname === '/sendsticker' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      let inForm;
      try { inForm = await request.formData(); } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'expected multipart form' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const chatId = (inForm.get('chat_id') || '').toString().trim();
      const file = inForm.get('sticker');
      if (!chatId || !file || typeof file === 'string') {
        return new Response(JSON.stringify({ ok: false, error: 'missing chat_id or sticker file' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      try {
        const tgForm = new FormData();
        tgForm.append('chat_id', chatId);
        tgForm.append('sticker', file, 'sticker.webm');
        const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendSticker`, {
          method: 'POST', body: tgForm,
        });
        const j = await r.json();
        return new Response(JSON.stringify(j), {
          status: j.ok ? 200 : 502, headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        console.error('[SENDSTICKER ERROR]', err.message || err);
        return new Response(JSON.stringify({ ok: false, error: 'send failed' }), {
          status: 500, headers: { 'content-type': 'application/json' },
        });
      }
    }

    // === /deletemessage — authenticated message delete (cleanup for previews) ===
    // POST JSON `{ chat_id, message_id }` with header `X-Broadcast-Secret`.
    // Forwards to Telegram deleteMessage. Used to remove preview stickers on request.
    if (url.pathname === '/deletemessage' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      let body = {};
      try { body = await request.json(); } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const chatId = (body.chat_id || '').toString().trim();
      const messageId = body.message_id;
      if (!chatId || !messageId) {
        return new Response(JSON.stringify({ ok: false, error: 'missing chat_id or message_id' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      const j = await tg('deleteMessage', { chat_id: chatId, message_id: messageId });
      return new Response(JSON.stringify(j), {
        status: j.ok ? 200 : 502, headers: { 'content-type': 'application/json' },
      });
    }

    // === /stickerset/* — authenticated sticker set creation endpoints ===
    // POST with header `X-Broadcast-Secret`. Used by tg-create-stickerset.js to
    // build an installable Telegram sticker pack from local .webm files without
    // leaking the BOT_TOKEN. Endpoints:
    //   GET  /stickerset/getbot         → { ok, username }
    //   POST /stickerset/upload         → uploadStickerFile (multipart: user_id, sticker)
    //   POST /stickerset/create  (JSON) → createNewStickerSet
    //   POST /stickerset/add     (JSON) → addStickerToSet
    if (url.pathname.startsWith('/stickerset/')) {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      const jres = (j) => new Response(JSON.stringify(j), {
        status: j.ok ? 200 : 502, headers: { 'content-type': 'application/json' },
      });

      if (url.pathname === '/stickerset/title' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        if (!body.name || !body.title) {
          return new Response(JSON.stringify({ ok: false, error: 'missing name/title' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return jres(await tg('setStickerSetTitle', { name: body.name, title: body.title }));
      }

      if (url.pathname === '/stickerset/replace' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        const { user_id, name, old_sticker, file_id, emoji } = body;
        if (!user_id || !name || !old_sticker || !file_id || !emoji) {
          return new Response(JSON.stringify({ ok: false, error: 'missing user_id/name/old_sticker/file_id/emoji' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return jres(await tg('replaceStickerInSet', {
          user_id, name, old_sticker,
          sticker: { sticker: file_id, format: 'video', emoji_list: [emoji] },
        }));
      }

      if (url.pathname === '/stickerset/delete' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        if (!body.name) {
          return new Response(JSON.stringify({ ok: false, error: 'missing name' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return jres(await tg('deleteStickerSet', { name: body.name }));
      }

      if (url.pathname === '/stickerset/getbot') {
        const me = await tg('getMe', {});
        return new Response(JSON.stringify({
          ok: !!me.ok, username: me.result?.username || null,
        }), { status: me.ok ? 200 : 502, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname === '/stickerset/upload' && request.method === 'POST') {
        let inForm;
        try { inForm = await request.formData(); } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: 'expected multipart form' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        const userId = (inForm.get('user_id') || '').toString().trim();
        const file = inForm.get('sticker');
        if (!userId || !file || typeof file === 'string') {
          return new Response(JSON.stringify({ ok: false, error: 'missing user_id or sticker file' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        const tgForm = new FormData();
        tgForm.append('user_id', userId);
        tgForm.append('sticker', file, 'sticker.webm');
        tgForm.append('sticker_format', 'video');
        const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/uploadStickerFile`, {
          method: 'POST', body: tgForm,
        });
        return jres(await r.json());
      }

      if (url.pathname === '/stickerset/create' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        const { user_id, name, title, file_id, emoji } = body;
        if (!user_id || !name || !title || !file_id || !emoji) {
          return new Response(JSON.stringify({ ok: false, error: 'missing user_id/name/title/file_id/emoji' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return jres(await tg('createNewStickerSet', {
          user_id, name, title,
          stickers: [{ sticker: file_id, format: 'video', emoji_list: [emoji] }],
        }));
      }

      if (url.pathname === '/stickerset/get' && request.method === 'GET') {
        const name = url.searchParams.get('name');
        if (!name) {
          return new Response(JSON.stringify({ ok: false, error: 'missing name' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return jres(await tg('getStickerSet', { name }));
      }

      if (url.pathname === '/stickerset/add' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        const { user_id, name, file_id, emoji } = body;
        if (!user_id || !name || !file_id || !emoji) {
          return new Response(JSON.stringify({ ok: false, error: 'missing user_id/name/file_id/emoji' }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return jres(await tg('addStickerToSet', {
          user_id, name,
          sticker: { sticker: file_id, format: 'video', emoji_list: [emoji] },
        }));
      }

      return new Response(JSON.stringify({ ok: false, error: 'unknown stickerset endpoint' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }

    // === /media/* — retrieve reference media the owner sent the bot in private chat ===
    // The webhook stores the last owner-sent file (animation/video/document/photo/sticker)
    // as KV `incoming_media`. Endpoints (header `X-Broadcast-Secret`):
    //   GET /media/last     → { ok, type, file_id, name, ts }
    //   GET /media/download → raw file bytes (proxied via getFile, token stays on CF)
    if (url.pathname.startsWith('/media/')) {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      const raw = await env.KV.get('incoming_media');
      if (!raw) {
        return new Response(JSON.stringify({ ok: false, error: 'no media received yet' }), {
          status: 404, headers: { 'content-type': 'application/json' },
        });
      }
      const meta = JSON.parse(raw);

      if (url.pathname === '/media/last') {
        return new Response(JSON.stringify({ ok: true, ...meta }), {
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname === '/media/download') {
        const gf = await tg('getFile', { file_id: meta.file_id });
        if (!gf.ok) {
          return new Response(JSON.stringify({ ok: false, error: 'getFile failed', detail: gf }), {
            status: 502, headers: { 'content-type': 'application/json' },
          });
        }
        const fr = await fetch(`https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${gf.result.file_path}`);
        if (!fr.ok) {
          return new Response(JSON.stringify({ ok: false, error: `file fetch ${fr.status}` }), {
            status: 502, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(fr.body, {
          headers: {
            'content-type': 'application/octet-stream',
            'x-media-name': encodeURIComponent(meta.name || 'ref.bin'),
            'x-media-type': meta.type || 'document',
          },
        });
      }

      return new Response(JSON.stringify({ ok: false, error: 'unknown media endpoint' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }

    // === Telegram webhook (default POST route — unchanged behaviour) ===
    if (request.method === 'POST') {
      // Once the secret is registered with Telegram, every genuine update
      // carries it. Before that (first deploy, secret not yet attached) the
      // check must stay open, or the bot would go silent between the two.
      if (env.TG_WEBHOOK_SECRET) {
        const armed = await env.KV.get('webhook_secret_version');
        const got = request.headers.get('x-telegram-bot-api-secret-token') || '';
        if (armed && got !== env.TG_WEBHOOK_SECRET) {
          console.error('[WEBHOOK] rejected update without valid secret');
          return new Response('unauthorized', { status: 401 });
        }
      }
      try {
        const update = await request.json();

        if (update.message?.new_chat_members) {
          await handleNewMember(update.message, env);
        }

        // Capture reference media sent by the owner in private chat → KV incoming_media
        // (picked up locally via GET /media/download; used as style refs for stickers/GIFs)
        const OWNER_USER_ID = '7334850816';
        const pm = update.message;
        if (pm && pm.chat?.type === 'private' && String(pm.from?.id) === OWNER_USER_ID) {
          const media =
            pm.animation ? { type: 'animation', file_id: pm.animation.file_id, name: pm.animation.file_name || 'ref.mp4' } :
            pm.video     ? { type: 'video',     file_id: pm.video.file_id,     name: pm.video.file_name || 'ref.mp4' } :
            pm.document  ? { type: 'document',  file_id: pm.document.file_id,  name: pm.document.file_name || 'ref.bin' } :
            pm.sticker   ? { type: 'sticker',   file_id: pm.sticker.file_id,   name: 'ref.webm' } :
            pm.photo     ? { type: 'photo',     file_id: pm.photo[pm.photo.length - 1].file_id, name: 'ref.jpg' } : null;
          if (media) {
            await env.KV.put('incoming_media', JSON.stringify({ ...media, ts: Date.now() }));
            await tg('sendMessage', {
              chat_id: pm.chat.id,
              text: `✅ Reference saved (${media.type}) — ready for pickup.`,
            });
          }
        }

        if (update.message?.text) {
          await handleCommand(update.message, env);
        }

        if (update.callback_query) {
          await handleCallback(update.callback_query, env);
        }
      } catch (err) {
        console.error('[WEBHOOK ERROR]', err.message || err);
      }
    }

    return new Response('OK');
  },

  // Cron handler (every 1 min)
  async scheduled(event, env) {
    TG_BOT_TOKEN = env.BOT_TOKEN;
    TG_INTERNAL_CHAT_ID = env.TG_INTERNAL_CHAT_ID || '';
    WHALE_ENV = env;

    // === HEARTBEAT ===
    // This bot was in no health check at all: it posts buys and burns into the
    // channel, and a stopped cron looks exactly like a quiet market. Every
    // other bot proves liveness through logs.brainonbnb.com/health; this one
    // had nothing to prove it with, so it writes its own timestamp and serves
    // it on GET /health below.
    //
    // Every tenth minute, not every minute. The cron runs 1,440 times a day and
    // a KV write per tick would spend the daily write budget on a heartbeat
    // nobody reads that often — 144 is plenty to tell a running worker from a
    // stopped one, and the freshness check downstream allows for it.
    if (new Date().getMinutes() % 10 === 0) {
      try { await env.KV.put('last_cron', new Date().toISOString()); }
      catch (e) { console.error('[HEARTBEAT ERROR]', e.message || e); }
      // The bot's own 24-hour ledger, one bucket per tenth minute. Its
      // failure is logged, never fatal: the alerts below do not depend on it.
      try { await recordSwapBucket(env); }
      catch (e) { console.error('[LEDGER ERROR]', e.message || e); }
    }

    // === ENSURE BOT COMMANDS REGISTERED (idempotent, KV-flagged) ===
    await ensureCommandsRegistered(env);
    try { await ensureWebhookSecret(env); }
    catch (e) { console.error('[WEBHOOK SECRET ERROR]', e.message || e); }

    // === LP AGENT — when it acts, the channel hears it ===
    // The daily tick (worker-lp, 05:23 UTC) writes one record; the agent
    // worker serves it at /lp/agent. Read it a few minutes past each tenth
    // minute — cheap, one fetch — and post ONCE per record that actually moved
    // money: income swept into the liquidity wallet, fees forwarded to the
    // buyback bot, the range re-set, capital added. A quiet day posts nothing;
    // a channel that hears "nothing happened" every morning stops listening.
    if (new Date().getMinutes() % 10 === 5) {
      try { await postLpAgentAlert(env); }
      catch (e) { console.error('[LP ALERT ERROR]', e.message || e); }
      // The daily report, once, in the hour after the 05:23 run.
      if (new Date().getUTCHours() === 5 || new Date().getUTCHours() === 6) {
        try { await postLpDailyReport(env); }
        catch (e) { console.error('[LP REPORT ERROR]', e.message || e); }
      }
    }

    // === DAILY WHALE RECAP (06:00 UTC = 08:00 CEST, idempotent via KV flag) ===
    if (TG_INTERNAL_CHAT_ID) {
      try {
        const now = new Date();
        if (now.getUTCHours() === 6) {
          const today = now.toISOString().slice(0, 10);
          const last  = await env.KV.get('last_daily_summary');
          if (last !== today) {
            const sent = await postDailyWhaleRecap(env);
            if (sent) await env.KV.put('last_daily_summary', today);
          }
        }
      } catch (e) {
        console.error('[WHALE DAILY GATE ERROR]', e.message || e);
      }

      // Daily holdings snapshot — own date-guard inside takeWhaleSnapshotIfDue,
      // independent of recap success. /whale-summary self-heals if this misses.
      try {
        if (new Date().getUTCHours() === 6) {
          await takeWhaleSnapshotIfDue(env, await loadTrackedWallets(env));
        }
      } catch (e) {
        console.error('[WHALE-SNAP GATE ERROR]', e.message || e);
      }
    }

    // === WHALE WATCHER (internal-only alerts + auto-detect new whales) ===
    // Per-TX coalescing: aggregator swaps (1inch / OKX DEX / 0x) emit several
    // Transfer events in a single tx (LP → Router → Router → final EOA). We
    // group by tx, compute net flow per address, and emit ONE alert per moving
    // wallet against its LOGICAL counterparty (LP, DEAD, or another EOA) —
    // router hops are filtered via eth_getCode and never appear in the chat.
    if (TG_INTERNAL_CHAT_ID) {
      try {
        const tracked = await loadTrackedWallets(env);
        const trackedSet = new Set(tracked);
        const postedWhaleRaw = await env.KV.get('posted_whale_txs');
        const postedWhaleSet = new Set(postedWhaleRaw ? JSON.parse(postedWhaleRaw) : []);
        const prevWhaleSize = postedWhaleSet.size;

        const edges = await loadWalletEdges(env);
        let edgesChanged = false;

        const whaleEvents = await loadWhaleEvents(env);
        const prevEventCount = whaleEvents.length;

        let clusterLabels = labelClusters(computeClusters([...trackedSet], edges));

        const latestHex = await rpcCall('eth_blockNumber', []);
        if (latestHex) {
          const latest = parseInt(latestHex, 16);
          const fromBlock = '0x' + Math.max(0, latest - 300).toString(16);
          const logs = await getAllRecentTransfers(fromBlock, env);

          // Group transfers by tx, preserve chronological order across txs.
          const txOrder = [];
          const byTx = new Map();
          const sortedLogs = logs.slice().sort((a, b) => {
            const blkA = parseInt(a.blockNumber, 16);
            const blkB = parseInt(b.blockNumber, 16);
            if (blkA !== blkB) return blkA - blkB;
            return parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16);
          });
          for (const log of sortedLogs) {
            const txHash = log.transactionHash;
            if (!byTx.has(txHash)) { byTx.set(txHash, []); txOrder.push(txHash); }
            byTx.get(txHash).push(log);
          }

          // Migrate the prior per-log dedup format ("txHash:logIndex") so we
          // don't re-fire alerts for txs already processed by the old code.
          const postedTxPrefixSet = new Set();
          for (const k of postedWhaleSet) {
            const colon = k.indexOf(':');
            postedTxPrefixSet.add(colon === -1 ? k : k.slice(0, colon));
          }

          let bobaiPriceUsd = null;
          let alerts = 0;
          const MAX_WHALE_ALERTS = 10;
          let setChanged = false;

          // Per-cron caches — eth_getCode and balanceOf are pure for the run.
          const contractCache = new Map();
          const balanceCache = new Map();
          const isContractCached = async (addr) => {
            if (contractCache.has(addr)) return contractCache.get(addr);
            const r = await isContract(addr);
            contractCache.set(addr, r);
            return r;
          };
          const getBalCached = async (addr) => {
            if (balanceCache.has(addr)) return balanceCache.get(addr);
            try {
              const b = await getBobaiBalance(addr);
              balanceCache.set(addr, b);
              return b;
            } catch { return null; }
          };
          const isSpecial = (a) => WHALE_NEVER_TRACK.has(a.toLowerCase());

          const pair = BOBAI_PAIR.toLowerCase();
          const dead = DEAD.toLowerCase();

          for (const txHash of txOrder) {
            if (postedTxPrefixSet.has(txHash)) continue;
            if (alerts >= MAX_WHALE_ALERTS) break;

            const txLogs = byTx.get(txHash);

            // Compute net flow per address within this tx.
            const netFlow = new Map();
            let pairOut = 0n, pairIn = 0n, deadIn = 0n;
            for (const log of txLogs) {
              const from = topicToAddr(log.topics[1]);
              const to   = topicToAddr(log.topics[2]);
              const amtWei = BigInt(log.data || '0x0');
              if (!(amtWei > 0n)) continue;
              netFlow.set(from, (netFlow.get(from) || 0n) - amtWei);
              netFlow.set(to,   (netFlow.get(to)   || 0n) + amtWei);
              if (from === pair) pairOut += amtWei;
              if (to   === pair) pairIn  += amtWei;
              if (to   === dead) deadIn  += amtWei;
            }

            // Movers = addresses with non-zero net flow, excluding hard-skip
            // set (LP, DEAD, BOBAI contract, bots). Sort by |net| desc so the
            // biggest mover is alerted first when MAX is hit.
            const movers = [...netFlow.entries()]
              .filter(([addr, n]) => n !== 0n && !isSpecial(addr))
              .sort((a, b) => {
                const aa = a[1] < 0n ? -a[1] : a[1];
                const bb = b[1] < 0n ? -b[1] : b[1];
                return bb > aa ? 1 : bb < aa ? -1 : 0;
              });

            // Guard against double-emitting an INTERNAL_T (once per side).
            const alertedThisTx = new Set();

            for (const [addr, netWei] of movers) {
              if (alerts >= MAX_WHALE_ALERTS) break;
              if (alertedThisTx.has(addr)) continue;

              const isTracked = trackedSet.has(addr);
              const isInflow  = netWei > 0n;
              const absWei = isInflow ? netWei : -netWei;
              const absAmt = Number(absWei) / 1e18;

              let kind = null;
              let counterparty = null;

              // Ratio gate: ≥50% of the mover's net flow must hit pair/dead for
              // the alert to classify as a real swap/burn. BOBAI's tax routes
              // 100% to the buyback bot (NEVER_TRACK) and never directly to
              // LP/DEAD, so this gate is rarely hit in practice — kept as
              // defense-in-depth against future config changes or edge txs.
              const TAX_RATIO = 2n;
              const isRealSell = pairIn  * TAX_RATIO >= absWei;
              const isRealBuy  = pairOut * TAX_RATIO >= absWei;
              const isRealBurn = deadIn  * TAX_RATIO >= absWei;

              if (isTracked && isInflow && isRealBuy) {
                kind = 'BUY'; counterparty = pair;
              } else if (isTracked && !isInflow && isRealSell) {
                kind = 'SELL'; counterparty = pair;
              } else if (isTracked && !isInflow && isRealBurn) {
                kind = 'BURN'; counterparty = dead;
              } else if (isTracked && !isInflow) {
                // Tracked outflow not into LP/DEAD — internal move or cascade.
                const inflows = movers.filter(([a, n]) => a !== addr && n > 0n);
                const trackedSink = inflows.find(([a]) => trackedSet.has(a));
                if (trackedSink) {
                  kind = 'INTERNAL_T'; counterparty = trackedSink[0];
                } else {
                  // Pick the largest non-contract inflow EOA as the recipient.
                  let pickedRecipient = null;
                  for (const [a] of inflows) {
                    if (!(await isContractCached(a))) { pickedRecipient = a; break; }
                  }
                  if (!pickedRecipient) continue; // outflow only to contracts
                  kind = 'TRANSFER_OUT'; counterparty = pickedRecipient;
                }
              } else if (isTracked && isInflow) {
                // Tracked inflow not from LP — find the source EOA.
                const outflows = movers.filter(([a, n]) => a !== addr && n < 0n);
                const trackedSource = outflows.find(([a]) => trackedSet.has(a));
                if (trackedSource) continue; // INTERNAL_T fires from the sender side
                let pickedSource = null;
                for (const [a] of outflows) {
                  if (!(await isContractCached(a))) { pickedSource = a; break; }
                }
                if (!pickedSource) continue;
                kind = 'TRANSFER_IN'; counterparty = pickedSource;
              } else if (!isTracked && isInflow) {
                // NEW_WHALE detection: non-tracked EOA receiving — crossed 10M?
                if (await isContractCached(addr)) continue;
                const bal = await getBalCached(addr);
                if (bal === null || bal < WHALE_THRESHOLD_WEI) continue;

                trackedSet.add(addr);
                setChanged = true;
                if (bobaiPriceUsd === null) bobaiPriceUsd = await fetchBobaiPriceUsd();
                const balTokens = Number(bal / 10n ** 18n);
                const usd = bobaiPriceUsd ? balTokens * bobaiPriceUsd : 0;
                console.log('[WHALE] NEW_WHALE detected', addr.slice(0, 10), formatNumber(balTokens));
                const sent = await postWhaleAlert({
                  kind: 'NEW_WHALE', from: pair, to: addr,
                  amount: balTokens, usdValue: usd, txHash,
                });
                if (sent) {
                  alerts++;
                  whaleEvents.push({ kind: 'NEW_WHALE', from: pair, to: addr, amount: balTokens, usdValue: usd, txHash, ts: Date.now() });
                  alertedThisTx.add(addr);
                }
                continue;
              } else {
                continue;
              }

              if (!kind) continue;

              // Cascade-add (TRANSFER_OUT counterparty already EOA-verified).
              let labelsDirty = false;
              if (kind === 'TRANSFER_OUT' && !trackedSet.has(counterparty)) {
                trackedSet.add(counterparty);
                setChanged = true;
                if (addEdgeInMemory(edges, addr, counterparty)) { edgesChanged = true; labelsDirty = true; }
              }
              if (kind === 'INTERNAL_T') {
                if (addEdgeInMemory(edges, addr, counterparty)) { edgesChanged = true; labelsDirty = true; }
              }
              if (labelsDirty) {
                clusterLabels = labelClusters(computeClusters([...trackedSet], edges));
              }

              if (bobaiPriceUsd === null) bobaiPriceUsd = await fetchBobaiPriceUsd();
              const usdValue = bobaiPriceUsd ? absAmt * bobaiPriceUsd : 0;

              // Display orientation: sender on left, receiver on right.
              const senderAddr   = isInflow ? counterparty : addr;
              const receiverAddr = isInflow ? addr : counterparty;
              const fromBalWei = isSpecial(senderAddr)   ? null : await getBalCached(senderAddr);
              const toBalWei   = isSpecial(receiverAddr) ? null : await getBalCached(receiverAddr);
              const fromBal = fromBalWei != null ? Number(fromBalWei / 10n ** 18n) : null;
              const toBal   = toBalWei   != null ? Number(toBalWei   / 10n ** 18n) : null;
              const fromTag = clusterLabels.get(senderAddr)   || null;
              const toTag   = clusterLabels.get(receiverAddr) || null;

              console.log('[WHALE]', kind, senderAddr.slice(0,8), '→', receiverAddr.slice(0,8), formatNumber(absAmt), 'BOBAI');
              const sent = await postWhaleAlert({
                kind, from: senderAddr, to: receiverAddr,
                amount: absAmt, usdValue, txHash,
                fromTag, toTag, fromBal, toBal, priceUsd: bobaiPriceUsd,
              });
              if (sent) {
                alerts++;
                whaleEvents.push({ kind, from: senderAddr, to: receiverAddr, amount: absAmt, usdValue, txHash, ts: Date.now() });
                alertedThisTx.add(addr);
                if (kind === 'INTERNAL_T') alertedThisTx.add(counterparty);
              } else {
                console.error('[WHALE] alert NOT sent, retry next cron', txHash);
              }

              // EX_WHALE: tracked wallet crossed from ≥10M to <10M this tx.
              if (isTracked && (kind === 'SELL' || kind === 'BURN' || kind === 'TRANSFER_OUT')) {
                try {
                  const balAfter = await getBobaiBalance(addr); // fresh, post-tx
                  if (balAfter < WHALE_THRESHOLD_WEI && (balAfter + absWei) >= WHALE_THRESHOLD_WEI) {
                    const balTokens = Number(balAfter / 10n ** 18n);
                    console.log('[WHALE] EX_WHALE crossed', addr.slice(0, 10), formatNumber(balTokens));
                    if (alerts < MAX_WHALE_ALERTS) {
                      const usd = bobaiPriceUsd ? balTokens * bobaiPriceUsd : 0;
                      const exSent = await postWhaleAlert({
                        kind: 'EX_WHALE', from: addr, to: counterparty,
                        amount: balTokens, usdValue: usd, txHash,
                      });
                      if (exSent) {
                        alerts++;
                        whaleEvents.push({ kind: 'EX_WHALE', from: addr, to: counterparty, amount: balTokens, usdValue: usd, txHash, ts: Date.now() });
                      }
                    }
                  }
                } catch { /* skip */ }
              }
            }

            // Mark tx processed even if no alert was emitted (avoid re-scan).
            postedWhaleSet.add(txHash);
          }

          if (setChanged) await saveTrackedWallets(env, [...trackedSet]);
          if (edgesChanged) await saveWalletEdges(env, edges);
          if (postedWhaleSet.size > prevWhaleSize) {
            await env.KV.put('posted_whale_txs', JSON.stringify([...postedWhaleSet].slice(-300)));
          }
          if (whaleEvents.length > prevEventCount) {
            await saveWhaleEvents(env, whaleEvents);
          }
        }
      } catch (err) {
        console.error('[WHALE WATCHER ERROR]', err.message || err);
      }
    }

    // === BUY ALERTS (on-chain Swap logs — near-instant, like burns/donations) ===
    // Two-phase pipeline for buys ≥ $100 (NFT mint threshold):
    //   1) Detect buy on chain → push into `pending_nft_buys` queue (no alert yet)
    //   2) Each cron, pull /api/nft/state and match queued buys by `buyTx` →
    //      fire alert once the mint-worker has minted the NFT. The alert then
    //      carries the real #tokenId, so /nft, dashboard and TG stay consistent.
    // Sold-out tiers and stuck mints (>5 min) get fired immediately with a
    // graceful fallback line so no alert is ever lost.
    const postedRaw = await env.KV.get('posted_txs');
    const postedSet = new Set(postedRaw ? JSON.parse(postedRaw) : []);
    const prevSize = postedSet.size;

    const pendingRaw = await env.KV.get('pending_nft_buys');
    let pending = pendingRaw ? JSON.parse(pendingRaw) : [];
    let pendingDirty = false;
    const NFT_PENDING_TIMEOUT_MS = 5 * 60 * 1000;

    // Fetch state once — used for both queue draining and sold-out checks
    const nftState = await fetchNftState();
    const dropByBuyTx = new Map(
      (nftState?.drops || []).map(d => [String(d.buyTx || '').toLowerCase(), d])
    );

    // Tier index from USD (highest matching threshold)
    const tierFromUsd = (usd) => {
      for (let i = NFT_TIERS.length - 1; i >= 0; i--) {
        if (usd >= NFT_TIERS[i][2]) return i;
      }
      return -1;
    };

    // Build the NFT line for the buy alert, given a matched drop OR a fallback
    const nftLineFromDrop = (drop) => {
      const tier = drop.tier;
      const [emoji, label] = NFT_TIERS[tier] || ['?', '?'];
      const [rEmoji, rLabel] = NFT_RARITIES[drop.rarity] || ['?', '?'];
      const minted = nftState?.minted?.[tier] ?? '?';
      const cap    = nftState?.cap?.[tier]    ?? '?';
      return `\n🎁 +1 NFT <b>#${drop.tokenId}</b> · ${emoji} <b>${label}</b> × ${rEmoji} ${rLabel} · ${minted}/${cap}`;
    };
    const nftLineSoldOut = (tier) => {
      const [emoji, label] = NFT_TIERS[tier] || ['?', '?'];
      const cap = nftState?.cap?.[tier] ?? '?';
      return `\n🎁 ${emoji} ${label} NFTs <b>sold out</b> (${cap}/${cap})`;
    };
    const nftLineTimeout = () => `\n🎁 NFT mint pending — check the dashboard`;

    let burnedPctCached = null;
    const burnedPct = async () => {
      if (burnedPctCached === null) burnedPctCached = (await getBurnStats()).percent;
      return burnedPctCached;
    };

    let alertsThisRun = 0;
    const MAX_ALERTS_PER_RUN = 5;

    // --- Phase 1: drain pending queue ----------------------------------------
    const nowMs = Date.now();
    const stillPending = [];
    for (const p of pending) {
      if (alertsThisRun >= MAX_ALERTS_PER_RUN) { stillPending.push(p); continue; }
      const drop = dropByBuyTx.get(String(p.txHash || '').toLowerCase());
      if (drop) {
        const sent = await postBuyAlert(p, await burnedPct(), nftLineFromDrop(drop));
        if (sent) { alertsThisRun++; console.log('[BUY] minted-alert', p.txHash, '→ #' + drop.tokenId); }
        else { stillPending.push(p); console.error('[BUY] minted-alert send failed, will retry', p.txHash); }
        continue;
      }
      if (nowMs - p.queuedAt > NFT_PENDING_TIMEOUT_MS) {
        const sent = await postBuyAlert(p, await burnedPct(), nftLineTimeout());
        if (sent) { alertsThisRun++; console.log('[BUY] timeout-alert', p.txHash); }
        else { stillPending.push(p); console.error('[BUY] timeout-alert send failed, will retry', p.txHash); }
        continue;
      }
      stillPending.push(p);
    }
    if (stillPending.length !== pending.length) pendingDirty = true;
    pending = stillPending;

    // --- Phase 2: scan new swap logs -----------------------------------------
    try {
      const latestHex = await rpcCall('eth_blockNumber', []);
      if (latestHex) {
        const latest = parseInt(latestHex, 16);
        // ~300 blocks ≈ 4-7 min (BSC ~0.75-1.5s/block) — comfortably covers the
        // 1-min cron with margin; dedup via posted_txs prevents repeats.
        const fromBlock = '0x' + Math.max(0, latest - 300).toString(16);
        const logs = await getSwapLogs(fromBlock, env);

        if (Array.isArray(logs) && logs.length) {
          let bnbUsd = null;               // lazy-load once

          // Logs are returned oldest-first → chat order stays chronological.
          for (const log of logs) {
            const txHash = log.transactionHash;
            if (postedSet.has(txHash)) continue;

            // data = 4 packed uint256: amount0In, amount1In, amount0Out, amount1Out
            const d = log.data.slice(2);
            if (d.length < 256) continue;
            const amount1In  = BigInt('0x' + d.slice(64, 128));   // WBNB in
            const amount0Out = BigInt('0x' + d.slice(128, 192));  // BOBAI out

            // BUY = WBNB in AND BOBAI out (sells are the opposite direction).
            if (!(amount1In > 0n && amount0Out > 0n)) continue;

            const bnbAmount   = Number(amount1In)  / 1e18;
            const bobaiAmount = Number(amount0Out) / 1e18;

            if (bnbUsd === null) bnbUsd = await getBnbUsd();
            const usdValue = bnbUsd ? bnbAmount * bnbUsd : 0;
            if (usdValue < 100) continue;  // below threshold — don't even dedup-store

            // Real buyer = tx sender (the `to` topic is often the router contract).
            const tx = await rpcCall('eth_getTransactionByHash', [txHash]);
            const buyer = (tx?.from || '').toLowerCase();
            if (buyer && IGNORED_WALLETS.has(buyer)) { postedSet.add(txHash); continue; }

            if (alertsThisRun >= MAX_ALERTS_PER_RUN) { postedSet.add(txHash); continue; }

            const tradeBase = {
              bnbAmount,
              bobaiAmount,
              usdValue,
              buyer: tx?.from || DEAD,
              txHash,
            };

            const tierIdx = tierFromUsd(usdValue);
            const tierMinted = nftState?.minted?.[tierIdx];
            const tierCap    = nftState?.cap?.[tierIdx];
            const soldOut    = tierIdx >= 0 && Number.isFinite(tierMinted) && Number.isFinite(tierCap) && tierMinted >= tierCap;

            console.log('[BUY] on-chain buy', txHash, '$' + usdValue.toFixed(2), 'tier=' + tierIdx, soldOut ? 'SOLD-OUT' : 'queue');

            if (soldOut) {
              // No mint will happen — fire immediately with sold-out line
              const sent = await postBuyAlert(tradeBase, await burnedPct(), nftLineSoldOut(tierIdx));
              if (sent) { postedSet.add(txHash); alertsThisRun++; }
              else console.error('[BUY] sold-out alert NOT sent, will retry next cron', txHash);
            } else {
              // Queue for matching with mint-worker drop — alert fires once #tokenId known
              postedSet.add(txHash);   // dedup so the next cron's log scan skips this tx
              pending.push({ ...tradeBase, queuedAt: Date.now() });
              pendingDirty = true;
            }
          }
        }
      }
    } catch (err) {
      console.error('[BUY BOT ERROR]', err.message || err);
    }

    // Persist queue (keep small) and seen-set
    if (pendingDirty) {
      await env.KV.put('pending_nft_buys', JSON.stringify(pending.slice(-50)));
    }
    if (postedSet.size > prevSize) {
      const postedArr = [...postedSet].slice(-100);
      await env.KV.put('posted_txs', JSON.stringify(postedArr));
    }

    // === BURN ALERTS ===
    // Check if burned amount increased since last check (1 KV read + RPC calls)
    try {
      const [currentBurned, totalSupply, lastBurnedRaw, tokenPrice] = await Promise.all([
        getBurnedTokens(),
        getTotalSupply(),
        env.KV.get('last_burned'),
        fetchBobaiPriceUsd(),
      ]);

      const lastBurned = lastBurnedRaw ? parseFloat(lastBurnedRaw) : 0;

      // Only alert if burn increased by at least 1000 BOBAI (avoid spam from rounding)
      if (currentBurned > lastBurned + 1000) {
        const sent = await postBurnAlert(currentBurned, lastBurned, totalSupply, tokenPrice);
        if (sent) {
          await env.KV.put('last_burned', currentBurned.toString());
        }
      }
    } catch (err) {
      console.error('[BURN BOT ERROR]', err.message || err);
    }

    // Donation alerts retired 2026-08-29: the WC26 prize pool closed with the
    // tournament (payout 2026-07-20), so no new donations can arrive. The
    // /worldcup command still serves the frozen final numbers on demand.

    // === CAPTCHA CLEANUP (every 2 min) ===
    if (new Date().getMinutes() % 2 === 0) {
      await cleanupExpiredCaptchas(env);
    }
  },
};
