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
const GECKO_TRADES_URL = `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_PAIR}/trades`;
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

function keyedEndpoints(env) {
  return env ? [env.BSC_RPC_KEYED_URL, env.BSC_RPC_KEYED_URL_2].filter(Boolean) : [];
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
// Donation illus served by URL (TG caches them server-side after first fetch)
const PHOTO_DONATION_BNB  = 'https://brainonbnb.com/worldcup/app/illus/donation-bnb.webp?v=2';
const PHOTO_DONATION_USDT = 'https://brainonbnb.com/worldcup/app/illus/donation-usdt.webp';

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

// Addresses we never want to alert ON (alert wenn Wallet→Pair = Sell, das ist ok;
// aber wir wollen die Pair/DEAD-Wallet selbst NICHT als getrackten Holder).
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

// eth_getLogs für ALLE BOBAI Transfer im fromBlock-Fenster (kein Adress-Filter).
// Keyed-first / free-fallback wie bei getSwapLogs — siehe dort.
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
async function fetchBobaiPriceOnchain() {
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

    const bobaiPerBnb = Number(rBOBAI) / Number(rWBNB);
    const price = bnbUsd / bobaiPerBnb;
    return isSanePrice(price) ? price : null;
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

// Resilient price-only fetch (used by burn/donation alerts that only need a number).
async function fetchBobaiPriceUsd() {
  try {
    const res = await fetch(`${GECKO_POOL_URL}?_=${Date.now()}`, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const d = await res.json();
      const p = parseFloat(d?.data?.attributes?.base_token_price_usd);
      if (isSanePrice(p)) return p;
    }
  } catch {}
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${BOBAI_TOKEN}`);
    if (res.ok) {
      const d = await res.json();
      const pair = (d?.pairs || []).find(p => p.pairAddress?.toLowerCase() === BOBAI_PAIR.toLowerCase()) || (d?.pairs || [])[0];
      const p = parseFloat(pair?.priceUsd);
      if (isSanePrice(p)) return p;
    }
  } catch {}
  const p = await fetchBobaiPriceOnchain();
  if (p) { console.log('[price] using on-chain fallback'); return p; }
  return null;
}

// Full pool stats (used by /price command). Gecko primary; DexScreener fallback
// is mapped into Gecko's attribute shape so the rest of the command code is unchanged.
async function fetchPoolData() {
  // 1) GeckoTerminal — richest data
  try {
    const res = await fetch(`${GECKO_POOL_URL}?_=${Date.now()}`, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const attrs = data?.data?.attributes;
      if (attrs && isSanePrice(parseFloat(attrs.base_token_price_usd))) return attrs;
    }
  } catch {}
  // 2) DexScreener — same fields, different shape
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${BOBAI_TOKEN}`);
    if (res.ok) {
      const data = await res.json();
      const p = (data?.pairs || []).find(x => x.pairAddress?.toLowerCase() === BOBAI_PAIR.toLowerCase()) || (data?.pairs || [])[0];
      if (p && isSanePrice(parseFloat(p.priceUsd))) {
        return {
          base_token_price_usd: p.priceUsd,
          base_token_price_native_currency: p.priceNative,
          fdv_usd: p.fdv,
          reserve_in_usd: p.liquidity?.usd,
          volume_usd: { h24: p.volume?.h24 },
          price_change_percentage: p.priceChange || {},
          transactions: { h24: p.txns?.h24 || {} },
        };
      }
    }
  } catch {}
  return null;
}

async function fetchRecentTrades() {
  try {
    const res = await fetch(`${GECKO_TRADES_URL}?_=${Date.now()}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (err) {
    console.error('[GECKO API ERROR]', err.message || err);
    return [];
  }
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

function getDonationEmojis(usdValue, token) {
  const symbol = token === 'BNB' ? '🟡' : '💵';
  const count = Math.max(Math.floor(usdValue / 2), 1);
  const bar = symbol.repeat(count);
  let icon;
  if (usdValue >= 250)      icon = '🐐 GOAT!';
  else if (usdValue >= 100) icon = '🏆 CHAMPION!';
  else if (usdValue >= 50)  icon = '🎯 HAT-TRICK!';
  else if (usdValue >= 25)  icon = '🥅 GOAL!';
  else if (usdValue >= 10)  icon = '🎽 SUPPORTER!';
  else if (usdValue >= 5)   icon = '🏟️ KICKOFF!';
  else                      icon = '🍺 WARMUP!';
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

// ==================== DONATION BOT ====================

async function postDonationAlert(donation, pool, bobaiPriceUsd) {
  try {
    const token     = donation.token; // 'BNB' or 'USDT'
    const amountIn  = parseFloat(donation.amount_in)    || 0;
    const bobaiAdd  = parseFloat(donation.amount_bobai) || 0;
    const hasPrice  = bobaiPriceUsd && bobaiPriceUsd > 0;
    const usdValue  = hasPrice ? bobaiAdd * bobaiPriceUsd : 0;
    const usdStr    = hasPrice ? formatUsd(usdValue) : 'n/a';
    const { bar, icon } = getDonationEmojis(usdValue, token);

    const totalPool    = pool ? parseFloat(pool.total_bobai) || 0 : 0;
    const totalPoolUsdStr = hasPrice ? formatUsd(totalPool * bobaiPriceUsd) : 'n/a';
    const symbol       = token === 'BNB' ? '🟡' : '💵';
    const amountStr    = token === 'BNB' ? amountIn.toFixed(6) : amountIn.toFixed(2);

    const message = `${bar}
<b>${icon}</b>

🪙 <b>+${formatNumber(bobaiAdd)} BOBAI</b> donated <b>(${usdStr})</b>
${symbol} Donation: <b>${amountStr} ${token}</b>
🏆 Prize Pool: <b>${formatNumber(totalPool)} BOBAI</b> (${totalPoolUsdStr})

💡 <i>Every donation fuels the World Cup prize pool!</i>

🔗 <a href="https://bscscan.com/tx/${donation.swap_tx_hash}">TX</a> · <a href="${WORLDCUP_URL}/app/prize-pool.html">Prize Pool</a> · <a href="${WORLDCUP_URL}">Worldcup</a>`;

    const result = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: token === 'BNB' ? PHOTO_DONATION_BNB : PHOTO_DONATION_USDT,
      caption: message,
      parse_mode: 'HTML',
    });
    return result?.ok === true;
  } catch (err) {
    console.error('[POST DONATION ERROR]', err.message || err);
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

  // ⚖️ NET FLOW — on-chain inflows minus outflows. Vorzeichen spricht für sich.
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
    const text = renderDailyRecap(events, tracked, price, /*withDateStamp=*/ true);
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

const COMMANDS_VERSION = 'v8-nft';

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

// ==================== CHAT COMMANDS ====================

async function handleCommand(msg) {
  const rawText = (msg.text || '').trim();
  const text = rawText.toLowerCase().split('@')[0].split(' ')[0];
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
  if (isInternal && WHALE_BARE.includes(text)) {
    return handleWhaleAdmin(rawText, '/' + text, chatId);
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
<i>(3% tax: 1% creator, 2% burn)</i>

📋 CA: <code>${BOBAI_TOKEN}</code>`;
      break;
    }

    case '/price':
    case 'price': {
      const [pool, burn] = await Promise.all([fetchPoolData(), getBurnStats()]);
      if (!pool) {
        reply = '⚠️ Could not fetch price data. Try again in a moment!';
        break;
      }

      const price = parseFloat(pool.base_token_price_usd);
      const priceInBnb = parseFloat(pool.base_token_price_native_currency);
      const fdv = parseFloat(pool.fdv_usd);
      const liq = parseFloat(pool.reserve_in_usd);
      const vol24 = parseFloat(pool.volume_usd?.h24 || 0);
      const pct = pool.price_change_percentage || {};
      const txns = pool.transactions?.h24 || {};

      reply = `📊 <b>BOBAI Live Price</b>

💰 <b>$${price.toFixed(8)}</b>
💎 ${priceInBnb.toFixed(10)} BNB

📈 <b>Price Change</b>
1h: ${priceChangeArrow(pct.h1)}  ·  6h: ${priceChangeArrow(pct.h6)}  ·  24h: ${priceChangeArrow(pct.h24)}

📊 <b>Market Stats</b>
🏷 FDV: ${formatUsd(fdv)}
💧 Liquidity: ${formatUsd(liq)}
📦 24h Volume: ${formatUsd(vol24)}
🔄 24h Trades: ${txns.buys || 0} buys / ${txns.sells || 0} sells

🔥 Burned: ${burn.percent}% (${formatNumber(burn.burnedTokens)} BOBAI)

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
♻️ 3% tax on every buy & sell
🔥 1% BOB burn + 1% BOBAI burn
💰 1% to creator (funds the bot)
👤 Contract ownership renounced

💡 <i>Every trade makes BOBAI more scarce!</i>

🔗 <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${DEAD}">View Burns on BscScan</a>`;
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

⚽ <b>Worldcup Donation Tiers</b>
🍺 &lt;$5 → WARMUP!
🏟️ $5+ → KICKOFF!
🎽 $10+ → SUPPORTER!
🥅 $25+ → GOAL!
🎯 $50+ → HAT-TRICK!
🏆 $100+ → CHAMPION!
🐐 $250+ → GOAT!

💡 <i>Buys under $100 are not alerted.</i>
💡 <i>Donation symbols: 🟡 BNB · 💵 USDT</i>`;
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
          await handleCommand(update.message);
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

    // === ENSURE BOT COMMANDS REGISTERED (idempotent, KV-flagged) ===
    await ensureCommandsRegistered(env);

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

    // === DONATION ALERTS ===
    try {
      const postedDonRaw = await env.KV.get('posted_donations');
      const isBootstrap  = postedDonRaw === null;
      const postedDonSet = new Set(postedDonRaw ? JSON.parse(postedDonRaw) : []);
      const prevDonSize  = postedDonSet.size;

      // Fetch last 10 BNB/USDT donations (TAX excluded)
      const donations = await fetchWorldcupDonations(10, false);
      if (donations.length > 0) {
        const pool = isBootstrap ? null : await fetchWorldcupPool();
        const bobaiPriceUsd = pool ? parseFloat(pool.bobai_price_usd) || 0 : 0;

        // Process oldest-first so the chat order is chronological
        for (const don of donations.slice().reverse()) {
          const txHash = don.swap_tx_hash;
          if (!txHash || postedDonSet.has(txHash)) continue;

          if (isBootstrap) {
            // First run: mark existing donations as seen, don't alert
            postedDonSet.add(txHash);
            continue;
          }

          const sent = await postDonationAlert(don, pool, bobaiPriceUsd);
          if (sent) postedDonSet.add(txHash);
        }

        if (postedDonSet.size > prevDonSize) {
          const postedDonArr = [...postedDonSet].slice(-50);
          await env.KV.put('posted_donations', JSON.stringify(postedDonArr));
        }
      } else if (isBootstrap) {
        // No donations yet — seed empty array so we don't re-bootstrap next cron
        await env.KV.put('posted_donations', '[]');
      }
    } catch (err) {
      console.error('[DONATION BOT ERROR]', err.message || err);
    }

    // === CAPTCHA CLEANUP (every 2 min) ===
    if (new Date().getMinutes() % 2 === 0) {
      await cleanupExpiredCaptchas(env);
    }
  },
};
