// The pool scan, imported rather than reimplemented. This is the same module
// the installable skill ships and the same chain layer the browser scanner
// runs, so the cost of a trade is computed in exactly one place no matter
// which of the three doors an agent came through.
import { scan as poolScan } from './scanner-scan.js';
import { useKeyedRpcs } from './scanner-chain.js';
import { feeTiers } from './tier-scan.js';
import { rangePlan } from './range-scan.js';
import { swapRoute } from './swap-route.js';
import { registrations } from '../shared/agent-registrations.js';

const TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const ZERO = '0x0000000000000000000000000000000000000000';
const RPC = 'https://bsc-dataseed.binance.org';

const NFT_CONTRACT  = '0xd56226b3b8297a57f4361fca28aa43babdc9789d';
const NFT_GET_TIERS = '0xde170570';
const NFT_DEPLOY_BLOCK = 105703880;
const NFT_BUYDROP_TOPIC = '0x799b2cd04630260020ee5b9f8e761cdf644383855739696bf8f1aadbc73dfd2a';
const LOGS_RPC = 'https://bsc-rpc.publicnode.com';
const LOGS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function ethCall(data) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: TOKEN, data }, 'latest'] }),
  });
  const json = await res.json();
  return BigInt(json.result);
}

async function getCirculating() {
  const totalSupply = await ethCall('0x18160ddd');
  const deadBal = await ethCall('0x70a08231000000000000000000000000' + DEAD.slice(2));
  const zeroBal = await ethCall('0x70a08231000000000000000000000000' + ZERO.slice(2));
  return (totalSupply - deadBal - zeroBal) / BigInt(1e18);
}

async function rpcJson(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function getNftState() {
  // 1) Tier counts/caps via on-chain eth_call (cheap, no archive issue)
  const [tiersResp, blockResp, dropsResp, holdersResp, cellsResp] = await Promise.all([
    rpcJson(RPC, {
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: NFT_CONTRACT, data: NFT_GET_TIERS }, 'latest'],
    }),
    rpcJson(RPC, { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }),
    // 2) Drop ledger from mint-worker's KV (avoids publicnode archive limits + saves keyed-RPC quota)
    fetch('https://bobai-nft-mint.bobbuildonbnb.workers.dev/drops').then(r => r.ok ? r.json() : { drops: [] }).catch(() => ({ drops: [] })),
    // 3) Live holder count from mint-worker (scans Transfer events, picks up secondary transfers like donations)
    fetch('https://bobai-nft-mint.bobbuildonbnb.workers.dev/holders').then(r => r.ok ? r.json() : null).catch(() => null),
    // 4) Per-cell (tier × rarity) minted counts — chain-truth, for the drop matrix
    fetch('https://bobai-nft-mint.bobbuildonbnb.workers.dev/cells').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  const minted = [0, 0, 0, 0, 0, 0];
  const cap    = [0, 0, 0, 0, 0, 0];
  const r = tiersResp?.result;
  if (r && r.length >= 2 + 12 * 64) {
    const hex = r.slice(2);
    for (let i = 0; i < 6; i++) minted[i] = parseInt(hex.slice(i*64, (i+1)*64), 16);
    for (let i = 0; i < 6; i++) cap[i] = parseInt(hex.slice((6+i)*64, (7+i)*64), 16);
  }

  const latest = parseInt(blockResp?.result || '0x0', 16);
  const rawDrops = Array.isArray(dropsResp?.drops) ? dropsResp.drops : [];
  // Normalize for the dashboard UI (which expects tokenId + tx fields).
  // usd + mintTx kept verbatim so the TG bot can render dollar amounts.
  const drops = rawDrops.map((d, i) => ({
    to: d.to,
    // Prefer an explicit tokenId stored on the drop; fall back to positional
    // (newest = highest id = total minted - i) for legacy entries without one.
    // The explicit id makes the ledger robust to out-of-band mints (e.g. a
    // manual gift mint) that would otherwise shift every positional number.
    tokenId: Number.isInteger(d.tokenId) ? d.tokenId : (minted.reduce((a, b) => a + b, 0) - i),
    tier: d.tier,
    rarity: d.rarity,
    block: d.block,
    ts: d.ts || 0, // unix seconds at mint time
    tx: d.mintTx || d.buyTx,
    mintTx: d.mintTx,
    buyTx: d.buyTx,
    usd: d.usd,
    note: d.note, // optional provenance badge (e.g. gift/re-roll), rendered in the ledger
  }));

  const buyers = new Set(drops.map(d => d.to));
  // `holders` = live on-chain owner count (reflects transfers like the BscScan donation).
  // `buyers` kept for backwards-compat = unique original mint recipients.
  const holders = (holdersResp && typeof holdersResp.holders === 'number') ? holdersResp.holders : buyers.size;
  const cells = (cellsResp && Array.isArray(cellsResp.cells)) ? cellsResp.cells : null;
  return { minted, cap, drops, holders, buyers: buyers.size, latestBlock: latest, cells };
}

// ─── BOBAI agent surface (MCP + A2A) — additive, read-only on-chain ───
const OFFICIAL_LINKS = {
  website: 'https://brainonbnb.com/',
  token_address: TOKEN,
  contract: 'https://bscscan.com/token/' + TOKEN,
  chain: 'BNB Smart Chain (BSC)',
  twitter: 'https://x.com/BrainOnBNB',
  telegram: 'https://t.me/bobai_official',
  dexscreener: 'https://dexscreener.com/bsc/' + TOKEN,
  geckoterminal: 'https://www.geckoterminal.com/bsc/pools/0x6eadd4cb786898b34929444988380ed0cc6fd9a6',
  coingecko: 'https://www.coingecko.com/en/coins/brain-on-bnb-ai',
  source: 'https://bscscan.com/address/' + TOKEN + '#code',
  audit_log: 'https://logs.brainonbnb.com/logs/burns.json',
  llms_txt: 'https://brainonbnb.com/llms.txt',
  skill_md: 'https://brainonbnb.com/skill.md',
};

// DEX execution facts for agents that want to actually swap $BOBAI.
// $BOBAI is a fee-on-transfer token (3% tax) — a naive swap with default
// slippage/router method WILL revert. These fields spell out what's needed.
const PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6'; // PancakeSwap V2 BOBAI/WBNB
const ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // PancakeSwap V2 router
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const TRADE_INFO = {
  token_address: TOKEN,
  chain: 'BNB Smart Chain (BSC)',
  chain_id: 56,
  dex: 'PancakeSwap V2',
  router: ROUTER_V2,
  pair: PAIR,
  quote_token: 'WBNB',
  quote_token_address: WBNB,
  swap_path_buy: [WBNB, TOKEN],
  swap_path_sell: [TOKEN, WBNB],
  fee_on_transfer: true,
  tax_percent: 3,
  min_slippage_bps: 1500,
  buy_method: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
  sell_method: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
  note: '$BOBAI charges a 3% transfer tax. You MUST use the *SupportingFeeOnTransferTokens router methods and set slippage tolerance >= 15% (1500 bps), otherwise the swap reverts. Live reserves: call getReserves() on the pair. Not financial advice.',
};

// Live price + liquidity — computed fully on-chain (pair reserves × Chainlink
// BNB/USD), same math as the dashboard workers. No off-chain price API.
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'; // BSC mainnet feed, 8 decimals

async function getReservesAndBnbUsd() {
  const [rHex, aHex] = await Promise.all([
    ethCallRaw(PAIR, '0x0902f1ac'),          // getReserves() → (r0, r1, ts)
    ethCallRaw(CHAINLINK_BNB_USD, '0x50d25bcd'), // latestAnswer() → int256, 8 decimals
  ]);
  const rBOBAI = BigInt('0x' + rHex.slice(2, 66));  // token0 = BOBAI (verified on-chain)
  const rWBNB = BigInt('0x' + rHex.slice(66, 130)); // token1 = WBNB
  const bnbUsd = Number(BigInt(aHex)) / 1e8;
  if (rBOBAI === 0n || rWBNB === 0n) throw new Error('zero reserves');
  if (!(bnbUsd > 0)) throw new Error('bad BNB/USD from Chainlink');
  return { rBOBAI, rWBNB, bnbUsd };
}

async function getPrice() {
  const { rBOBAI, rWBNB, bnbUsd } = await getReservesAndBnbUsd();
  const priceBnb = Number(rWBNB) / Number(rBOBAI); // both 18 decimals → ratio cancels
  const priceUsd = priceBnb * bnbUsd;
  if (!isFinite(priceUsd) || priceUsd < 1e-7 || priceUsd > 1e-2) throw new Error('price failed sanity bounds');
  const circulating = await getCirculating();
  return {
    symbol: 'BOBAI',
    price_usd: Number(priceUsd.toPrecision(6)),
    price_bnb: Number(priceBnb.toPrecision(6)),
    bnb_usd: Number(bnbUsd.toFixed(2)),
    market_cap_usd: Math.round(Number(circulating) * priceUsd),
    circulating_supply: circulating.toString(),
    source: 'on-chain: PancakeSwap V2 pair reserves × Chainlink BNB/USD feed — no off-chain price API',
    pair: PAIR,
    chainlink_feed: CHAINLINK_BNB_USD,
    note: 'Spot price from live reserves. Your execution price differs: 3% transfer tax + price impact (see bobai_liquidity). Not financial advice.',
  };
}

async function getLiquidity() {
  const [{ rBOBAI, rWBNB, bnbUsd }, lpTotalHex, lpDeadHex, lpZeroHex] = await Promise.all([
    getReservesAndBnbUsd(),
    ethCallRaw(PAIR, '0x18160ddd'),
    ethCallRaw(PAIR, '0x70a08231000000000000000000000000' + DEAD.slice(2)),
    ethCallRaw(PAIR, '0x70a08231000000000000000000000000' + ZERO.slice(2)),
  ]);
  const lpTotal = BigInt(lpTotalHex);
  const lpBurned = BigInt(lpDeadHex) + BigInt(lpZeroHex);
  const lpBurnedPct = lpTotal > 0n ? Number(lpBurned * 10000n / lpTotal) / 100 : 0;
  const wbnb = Number(rWBNB) / 1e18;
  const liqUsd = 2 * wbnb * bnbUsd;
  // constant-product impact of a BNB-side buy: in / (reserve + in)
  const impact = (bnb) => (bnb / (wbnb + bnb) * 100).toFixed(2) + '%';
  return {
    pair: PAIR,
    dex: 'PancakeSwap V2',
    reserves: { bobai: (rBOBAI / BigInt(1e18)).toString(), wbnb: Number(wbnb.toFixed(4)) },
    liquidity_usd: Math.round(liqUsd),
    lp_burned_percent: Number(lpBurnedPct.toFixed(2)),
    lp_note: 'LP tokens sit at the dead address — permanently locked, nobody can pull this liquidity. Verify: balanceOf(0x…dEaD) on the pair.',
    price_impact_estimate: { '0.1 BNB buy': impact(0.1), '0.5 BNB buy': impact(0.5), '1 BNB buy': impact(1), '5 BNB buy': impact(5) },
    impact_note: 'Constant-product estimate before the 3% transfer tax and LP fee. Verify live via getReserves() on the pair. Not financial advice.',
  };
}

// Live proof the buyback-and-burn flywheel runs — from the bot's public audit
// log (burns.json, written to KV by the CF-Worker bot).
let WORKER_ENV = null; // set per-request in fetch(); used for the ASSETS fallback and the GoPlus account key
async function getActivity() {
  // Primary: live log served by the bot worker (custom domain — worker-to-worker fetchable)
  let r = await fetch('https://logs.brainonbnb.com/logs/burns.json', { cf: { cacheTtl: 60 } }).catch(() => null);
  // Fallback: same-origin static copy bundled with the deploy. (The old
  // raw.githubusercontent copy was dropped — the repo has been unreachable
  // since the account flag, so it only cost a round trip on every miss.)
  if ((!r || !r.ok) && WORKER_ENV) r = await WORKER_ENV.ASSETS.fetch('https://brainonbnb.com/burns.json').catch(() => null);
  if (!r || !r.ok) throw new Error('burn log unavailable (HTTP ' + (r ? r.status : 'fetch failed') + ')');
  const runs = await r.json();
  const now = Date.now();
  const within = (days) => runs.filter(e => now - Date.parse(e.time) < days * 86400e3);
  const sum = (arr, f) => arr.reduce((a, e) => a + (parseFloat(e[f]) || 0), 0);
  const period = (arr) => ({ burn_runs: arr.length, bobai_burned: Math.round(sum(arr, 'bobaiBurned')), bob_burned: Math.round(sum(arr, 'bobBurned')) });
  const last = runs[runs.length - 1];
  return {
    buyback_bot: 'autonomous, checks every 10 minutes 24/7 — executes a buyback+burn whenever the collected 3% tax reaches the swap threshold',
    buyback_wallet: '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',
    buyback_wallet_note: 'The 3% trade tax accumulates in this public wallet between burn runs — check its live balance (bobai_wallet_balance / BscScan) to watch the next buyback charging up.',
    last_burn: last ? { time: last.time, bobai_burned: Math.round(parseFloat(last.bobaiBurned) || 0), burn_tx: 'https://bscscan.com/tx/' + last.bobaiBurnTx, bnb_spent: last.totalBnb } : null,
    last_7_days: period(within(7)),
    last_30_days: period(within(30)),
    bot_burn_runs_total: runs.length,
    audit_log: 'https://logs.brainonbnb.com/logs/burns.json',
    note: 'Burn cadence follows trading volume — the 3% tax funds the buybacks, so more volume means more frequent burns. $BOB is the sister token (1% of the tax burns $BOB). Every burn_tx is verifiable on BscScan. Not financial advice.',
  };
}

// BOBAI Buy NFT drop — the on-chain reward mechanic, exposed as verifiable
// facts. Any wallet (including an agent's) that buys >= $100 in one swap gets
// an auto-minted collectible. Live counts come from the same chain + mint-worker
// sources the dashboard uses.
const NFT_TIERS = [
  { label: 'NICE BUY',    min_buy_usd: 100 },
  { label: 'BIG BUY',     min_buy_usd: 150 },
  { label: 'HUGE BUY',    min_buy_usd: 250 },
  { label: 'WHALE BUY',   min_buy_usd: 500 },
  { label: 'THUNDER BUY', min_buy_usd: 1000 },
  { label: 'KRAKEN BUY',  min_buy_usd: 2500 },
];
const NFT_RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythical', 'Legendary', 'Ancient', 'Immortal'];
const NFT_RARITY_CAPS = [799, 496, 297, 162, 90, 56, 25];

async function getNftDrop() {
  const s = await getNftState();
  const tiers = NFT_TIERS.map((t, i) => ({
    tier: t.label,
    min_buy_usd: t.min_buy_usd,
    minted: s.minted[i],
    cap: s.cap[i],
    remaining: Math.max(0, s.cap[i] - s.minted[i]),
  }));
  const totalMinted = s.minted.reduce((a, b) => a + b, 0);
  const totalCap = s.cap.reduce((a, b) => a + b, 0);
  // Remaining per rarity (rarity is drawn from a weighted, hard-capped matrix)
  let rarities = null;
  if (Array.isArray(s.cells)) {
    rarities = NFT_RARITIES.map((name, r) => {
      const minted = s.cells.reduce((a, row) => a + (row?.[r] || 0), 0);
      return { rarity: name, minted, cap: NFT_RARITY_CAPS[r], remaining: Math.max(0, NFT_RARITY_CAPS[r] - minted) };
    });
  }
  const last = s.drops && s.drops[0];
  return {
    what_it_is: 'On-chain reward mechanic: every $BOBAI buy of >= $100 (single swap, USD value at swap time) auto-mints a collectible NFT to the buyer wallet. No claim step, no extra cost, no signup — works for ANY wallet, including an agent-controlled one.',
    nft_contract: NFT_CONTRACT,
    standard: 'ERC-721 (BEP-721) on BNB Smart Chain',
    contract_renounced: true,
    total: { minted: totalMinted, cap: totalCap, remaining: Math.max(0, totalCap - totalMinted) },
    tiers,
    tier_note: 'The buy size fixes the tier motif; higher tiers have far smaller caps. Rarity (7 levels, Common -> Immortal) is drawn from a weighted matrix with hard per-cell caps — once a cell is minted out, that combination can never exist again.',
    ...(rarities ? { rarities } : {}),
    holders: s.holders,
    last_mint: last ? { time_utc: last.ts ? new Date(last.ts * 1000).toISOString() : null, tier: NFT_TIERS[last.tier]?.label ?? last.tier, tx: last.tx ? 'https://bscscan.com/tx/' + last.tx : null } : null,
    how_an_agent_earns_one: [
      '1. Call bobai_price to convert the tier threshold to BNB (e.g. $100 / bnb_usd, add ~5% headroom for tax + impact).',
      '2. Execute ONE swap of that size via bobai_purchase_guide (fee-on-transfer safe — see bobai_dex_info).',
      '3. The NFT is auto-minted to the buying wallet within ~1 minute. Verify: token transfers of ' + NFT_CONTRACT + ' on BscScan, or the live ledger on the collection page.',
    ],
    collection_page: 'https://brainonbnb.com/nft',
    verify_contract: 'https://bscscan.com/token/' + NFT_CONTRACT,
    note: 'Facts about a live, renounced contract — supply is hard-capped and shrinking as cells mint out. The NFT is a collectible with no promised value or utility. Not financial advice.',
  };
}

// Machine-readable smart-money signals — the trader-agent view of $BOBAI.
// Aggregates verifiable on-chain flows nobody has to trust: the tax reserve
// charging the next buyback, the NFT-mint ledger (= immutable log of every
// $100+ buy with wallet + tx), and burn momentum. Descriptive, not a rec.
const BUYBACK_WALLET = '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce';
async function getSmartMoney() {
  const [price, nft, activity, reserve, taxQueuedRaw, whales] = await Promise.all([
    getPrice().catch(() => null),
    getNftState().catch(() => null),
    getActivity().catch(() => null),
    getWalletBalance(BUYBACK_WALLET).catch(() => null),
    // Tax collected by the token contract itself, waiting to be swept to the
    // buyback wallet — same source as the dashboard's "tax queued" sub-line.
    ethCall('0x70a08231000000000000000000000000' + TOKEN.slice(2)).catch(() => null),
    // Whale-flow aggregates from the whale watcher (worker-tg-bot): on-chain
    // Transfer logs scanned every minute, wallets >= 10M BOBAI auto-tracked.
    fetch('https://bobai-tg-bot.bobbuildonbnb.workers.dev/whale-summary').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  const now = Date.now() / 1000;
  const drops = (nft?.drops || []).filter(d => d.ts && d.usd);
  const inWindow = (days) => drops.filter(d => now - d.ts < days * 86400);
  const agg = (arr) => ({ count: arr.length, usd_total: Math.round(arr.reduce((a, d) => a + (parseFloat(d.usd) || 0), 0)) });
  const fmt = (d) => ({
    time_utc: new Date(d.ts * 1000).toISOString(),
    usd: Math.round(parseFloat(d.usd) || 0),
    tier: NFT_TIERS[d.tier]?.label ?? d.tier,
    buyer: d.to,
    tx: d.tx ? 'https://bscscan.com/tx/' + d.tx : null,
  });
  const reserveBnb = reserve ? parseFloat(reserve.bnb) : null;
  const reserveBobai = reserve ? parseInt(reserve.bobai, 10) : null;
  const taxQueuedBobai = taxQueuedRaw !== null ? Number(taxQueuedRaw / BigInt(1e18)) : null;
  const reserveUsd = (reserve && price)
    ? Math.round((reserveBnb * price.bnb_usd + (reserveBobai + (taxQueuedBobai || 0)) * price.price_usd) * 100) / 100
    : null;
  return {
    what_this_is: 'Live smart-money signals for $BOBAI — every number below is on-chain-verifiable (contract, tx or public audit log). Descriptive market data for agents, not a recommendation.',
    next_buyback_charging: reserve ? {
      buyback_wallet: BUYBACK_WALLET,
      wallet_bnb: reserveBnb,
      wallet_bobai: reserveBobai,
      tax_queued_bobai_in_contract: taxQueuedBobai,
      reserve_usd_estimate: reserveUsd,
      how_it_works: 'Two stages, both public: the 3% trade tax first collects inside the token contract itself (tax_queued_bobai_in_contract = balanceOf(the token contract)), then gets swept to the buyback wallet where an autonomous bot checks every 10 minutes and converts it into buyback+burn once the swap threshold is met. Contract queue + wallet balance together = pending, predictable buy pressure.',
      verify: {
        wallet: 'https://bscscan.com/address/' + BUYBACK_WALLET,
        tax_queued: 'balanceOf(' + TOKEN + ') on the token contract itself — https://bscscan.com/token/' + TOKEN + '?a=' + TOKEN,
      },
    } : null,
    large_buys: {
      source: 'Every $BOBAI buy >= $100 (single swap, USD at swap time) auto-mints an NFT — an immutable on-chain ledger of large buys. Tier = buy size (see bobai_nft_drop).',
      last_24h: agg(inWindow(1)),
      last_7d: agg(inWindow(7)),
      latest: drops.slice(0, 5).map(fmt),
      all_time_by_tier: nft ? NFT_TIERS.map((t, i) => ({ tier: t.label, min_buy_usd: t.min_buy_usd, count: nft.minted[i] })) : null,
    },
    whale_flows: whales ? {
      methodology: 'A watcher scans every BOBAI Transfer log on-chain once per minute. Wallets holding >= 10,000,000 BOBAI (1% of supply) enter the watchlist automatically when they cross the threshold. Numbers below aggregate only those tracked wallets — every underlying event is a real on-chain tx.',
      as_of: whales.as_of,
      tracked_wallets: whales.tracked_wallets,
      holdings: whales.holdings || null,
      last_24h: whales.last_24h,
      last_7d: whales.last_7d,
      top_movers_24h: whales.top_movers_24h,
      last_event: whales.last_event,
      limitation: 'Holders can split into fresh wallets below the threshold; cluster analysis catches more than a threshold watcher. Cross-check independently:',
      independent_cross_checks: {
        holders_onchain: 'https://bscscan.com/token/' + TOKEN + '#balances',
        insightx: 'https://app.insightx.network/atlas/bsc/' + TOKEN,
        bubblemaps: 'https://v2.bubblemaps.io/map?address=' + TOKEN + '&chain=bsc',
      },
    } : null,
    burn_momentum: activity ? {
      last_burn: activity.last_burn,
      last_7_days: activity.last_7_days,
      last_30_days: activity.last_30_days,
      audit_log: activity.audit_log,
    } : null,
    structural: {
      lp_permanently_locked: 'LP tokens are burned to the dead address — pool depth only grows, nobody can pull it. Live LP-burned % via bobai_liquidity.',
      supply_only_shrinks: 'Renounced contract, no mint function; buybacks burn supply continuously. Live totals via bobai_burned.',
    },
    how_agents_use_this: [
      'reserve rising + steady burn cadence = the flywheel is being fed by real volume, not claims.',
      'large_buys.latest gives size, buyer wallet and tx of every recent $100+ buy — follow those wallets on-chain if you track smart money.',
      'Cross-check any number: every field carries a contract address, tx link or audit-log source.',
    ],
    not_financial_advice: true,
  };
}

// Interactive entry point for any agent that discovers $BOBAI.
// Answers "what can I ask? / what can I do?" and routes to the exact tool.
const AGENT_GUIDE = {
  agent: 'Brain On BNB AI ($BOBAI)',
  what_this_is: 'A read-only, verifiable on-chain data surface for the $BOBAI token on BNB Chain (BSC). Not a trading bot — a source of truth other agents can call before they act.',
  what_you_can_know: [
    { ask: 'Live price in USD/BNB + market cap, computed fully on-chain', call: 'bobai_price' },
    { ask: 'Liquidity depth: reserves, USD liquidity, LP-burned %, price impact per buy size', call: 'bobai_liquidity' },
    { ask: 'Is the buyback-and-burn flywheel actually running? Last burn (tx), burns last 7/30 days', call: 'bobai_activity' },
    { ask: 'Smart-money signals: pending buyback reserve (buy pressure), live whale flows + holdings trends (24h/7d flows, 1d/7d/30d holdings), recent $100+ buys with wallet + tx, burn momentum', call: 'bobai_smart_money' },
    { ask: 'Token basics: contract, name, symbol, decimals, supply, amount burned', call: 'bobai_token_info' },
    { ask: 'How much $BOBAI has been permanently burned', call: 'bobai_burned' },
    { ask: 'Current circulating supply (total minus burned)', call: 'bobai_circulating_supply' },
    { ask: "Any BSC wallet's BNB and $BOBAI balance", call: 'bobai_wallet_balance', args: { address: '0x…' } },
    { ask: 'Official verified links: site, contract, socials, DEX, source', call: 'bobai_links' },
    { ask: 'How the token accrues value: deflationary tax->buyback->burn design + trust properties', call: 'bobai_tokenomics' },
  ],
  what_you_can_do: [
    { action: 'Get the raw DEX execution parameters (router, pair, paths, slippage, methods)', call: 'bobai_dex_info' },
    { action: 'Get ready-to-run code to BUY $BOBAI with BNB', call: 'bobai_purchase_guide' },
    { action: 'EARN an on-chain collectible: any buy >= $100 auto-mints a capped-supply NFT to the buying wallet — live remaining supply + steps', call: 'bobai_nft_drop' },
  ],
  guided_prompts: [
    { prompt: 'evaluate_bobai', does: 'full neutral due-diligence walkthrough (prompts/get)' },
    { prompt: 'prepare_bobai_swap', does: 'fee-on-transfer-safe swap preparation, optional wallet arg (prompts/get)' },
  ],
  must_know: '$BOBAI is a fee-on-transfer token (3% tax). Any swap MUST use the *SupportingFeeOnTransferTokens router methods with slippage >= 15% (1500 bps) or it reverts. Everything here is verifiable on-chain. Not financial advice.',
};

// Neutral, verifiable value-accrual mechanics — the "how it works" thesis
// an agent needs to evaluate the token. NOT a buy recommendation.
const TOKENOMICS = {
  model: 'deflationary — circulating supply shrinks as trading volume grows',
  mechanism: [
    '3% tax on every $BOBAI trade (rate hardcoded, distribution transparent & published)',
    'the tax accumulates in the public buyback wallet 0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',
    'an autonomous bot runs every 10 minutes and splits it — base split ~1% creator / 1% $BOB burn / 1% $BOBAI burn; campaign phases may re-route slices (e.g. liquidity adds + LP burn, WC26 prize pool) — live schedule on the dashboard',
    'bought-back $BOBAI is sent to the dead address = permanent, irreversible burn',
    'more volume -> more buybacks -> more burned -> lower circulating supply',
  ],
  trust_properties: [
    'ownership renounced — no mint, no pause, no proxy/upgrade path',
    'LP tokens burned (perma-locked at the dead address), not a timelock',
    'fair launch on Four.Meme — no presale, no private sale, no team allocation',
    'contract source verified and published on BscScan — readable line by line',
  ],
  verify_yourself: {
    burned: 'call bobai_burned',
    circulating_supply: 'call bobai_circulating_supply',
    contract: 'https://bscscan.com/token/' + TOKEN,
    contract_source: 'https://bscscan.com/address/' + TOKEN + '#code',
    burn_audit_log: 'https://logs.brainonbnb.com/logs/burns.json',
  },
  disclaimer: "Describes the token's design, not a recommendation to buy. Meme tokens are high-risk. Not financial advice — verify everything on-chain.",
};

function howToBuy() {
  const code = [
    "// Buy $BOBAI with BNB on PancakeSwap V2 (BNB Chain).",
    "// $BOBAI is fee-on-transfer (3% tax): use the *SupportingFeeOnTransferTokens",
    "// method and >=15% slippage, or the swap reverts.",
    "import { createWalletClient, createPublicClient, http, parseEther } from 'viem';",
    "import { privateKeyToAccount } from 'viem/accounts';",
    "import { bsc } from 'viem/chains';",
    "",
    "const ROUTER = '" + ROUTER_V2 + "';",
    "const WBNB   = '" + WBNB + "';",
    "const BOBAI  = '" + TOKEN + "';",
    "const RPC    = 'https://bsc-dataseed.binance.org'; // pass an explicit URL",
    "",
    "const routerAbi = [",
    "  { name: 'getAmountsOut', type: 'function', stateMutability: 'view',",
    "    inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }],",
    "    outputs: [{ name: 'amounts', type: 'uint256[]' }] },",
    "  { name: 'swapExactETHForTokensSupportingFeeOnTransferTokens', type: 'function', stateMutability: 'payable',",
    "    inputs: [{ name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' },",
    "             { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [] },",
    "];",
    "",
    "const account = privateKeyToAccount(process.env.PRIVATE_KEY);",
    "const pub    = createPublicClient({ chain: bsc, transport: http(RPC) });",
    "const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });",
    "",
    "const path = [WBNB, BOBAI];",
    "const amountIn = parseEther('0.05'); // spend 0.05 BNB",
    "",
    "// Quote on-chain, then subtract 15% slippage (FoT-safe).",
    "const amounts = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: 'getAmountsOut', args: [amountIn, path] });",
    "const amountOutMin = (amounts[1] * 8500n) / 10000n; // -15%",
    "const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min",
    "",
    "const hash = await wallet.writeContract({",
    "  address: ROUTER, abi: routerAbi,",
    "  functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',",
    "  args: [amountOutMin, path, account.address, deadline], value: amountIn,",
    "});",
    "console.log('swap tx:', hash);",
  ].join('\n');
  return {
    summary: 'Buy $BOBAI with BNB on PancakeSwap V2. Fee-on-transfer (3% tax) → use swapExactETHForTokensSupportingFeeOnTransferTokens with >=15% slippage.',
    language: 'javascript (viem)',
    code,
    to_sell: "Reverse the path to [BOBAI, WBNB], approve the router for $BOBAI first, then call swapExactTokensForETHSupportingFeeOnTransferTokens.",
    params: TRADE_INFO,
    warning: 'Not financial advice. Test with a small amount first. Verify token/router/pair on BscScan. Never expose a private key holding significant funds.',
  };
}

// Machine-readable skill doc for agents that read URLs/text instead of
// calling MCP. Mirrors the MCP tools in plain Markdown.
function skillMd() {
  const buy = howToBuy();
  return `# $BOBAI Agent Skill — Brain On BNB AI

> A read-only, verifiable on-chain data surface for the **$BOBAI** token on BNB Chain (BSC).
> **Not a trading bot** — the source of truth other agents call *before* they act.

## Identity
- ERC-8004 Agent: **#49467** on BNB Chain Identity Registry (\`eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432#49467\`)
- Token contract: \`${TOKEN}\` (BEP-20, BNB Smart Chain, verified & renounced, fair launch on Four.Meme)
- Explorer: https://8004scan.io/agents/bsc/49467

## How to query me
- **MCP** (JSON-RPC 2.0, protocol 2025-06-18): \`POST https://brainonbnb.com/mcp\`
- **A2A agent card**: https://brainonbnb.com/.well-known/agent-card.json
- Example — list tools:
\`\`\`bash
curl -s https://brainonbnb.com/mcp -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
\`\`\`
- Example — call a tool:
\`\`\`bash
curl -s https://brainonbnb.com/mcp -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bobai_token_info"}}'
\`\`\`

## No MCP client? Plain REST (just GET these URLs)
Every read tool is also mirrored as a plain JSON GET endpoint — no MCP, no auth, CORS open:
- https://brainonbnb.com/api/price — live price (USD/BNB) + market cap, computed fully on-chain
- https://brainonbnb.com/api/liquidity — reserves, USD liquidity, LP-burned %, price impact per buy size
- https://brainonbnb.com/api/activity — proof the buyback-and-burn flywheel runs: last burn tx, burns last 7/30 days
- https://brainonbnb.com/api/nft-drop — earnable NFT reward: live remaining supply per buy-tier/rarity + how to earn one
- https://brainonbnb.com/api/smart-money — smart-money signals: pending buyback reserve, live whale flows, recent $100+ buys (wallet + tx), burn momentum
- https://brainonbnb.com/api/token — contract, supply, burned, renounced/verified flags
- https://brainonbnb.com/api/trade — DEX execution params (router, pair, paths, slippage, FoT methods)
- https://brainonbnb.com/api/tokenomics — value-accrual mechanics + trust properties
- https://brainonbnb.com/api/wallet?address=0x… — BNB + $BOBAI balance of any BSC wallet
- https://brainonbnb.com/api/links · /api/guide · /api/how-to-buy
- https://brainonbnb.com/api/circulating-supply · /api/total-supply — bare numbers as text/plain (aggregator-style supply endpoints)

## What you can ASK (read-only, all on-chain)
- \`bobai_price\` — live price in USD/BNB + market cap (pair reserves × Chainlink BNB/USD — no off-chain price API)
- \`bobai_liquidity\` — pool reserves, liquidity in USD, LP-burned % (perma-locked), price impact per buy size
- \`bobai_activity\` — is the flywheel running? Last burn (BscScan tx), burns last 7/30 days, full audit log
- \`bobai_smart_money\` — smart-money signals: the tax reserve charging the next buyback (wallet + contract queue = pending buy pressure), live whale flows & holdings (auto-tracked 1%-of-supply wallets, 24h/7d in/outflows, top movers with tx, daily balance snapshots with 1d/7d/30d holdings trends), an immutable ledger of recent $100+ buys with buyer wallet + tx, burn momentum
- \`bobai_token_info\` — contract, name, symbol, decimals, total & circulating supply, amount burned
- \`bobai_burned\` — total $BOBAI permanently burned by the autonomous 24/7 buyback bot
- \`bobai_circulating_supply\` — total minus burned
- \`bobai_wallet_balance\` — BNB and $BOBAI balance of any BSC wallet (arg: \`address\`)
- \`bobai_links\` — official verified links (site, contract, socials, DEX, source)
- \`bobai_tokenomics\` — how the token accrues value (deflationary mechanics + trust properties), verifiable, not a recommendation

## What you can DO
- \`bobai_dex_info\` — raw DEX execution params (below)
- \`bobai_purchase_guide\` — ready-to-run buy code (below)
- \`bobai_nft_drop\` — EARN an on-chain collectible (below)
- \`bobai_guide\` — interactive menu that routes each intent to a tool

## Earnable on-chain reward: the NFT buy drop
This is not a promo claim — it's a live, renounced ERC-721 contract you can verify:
- **Every $BOBAI buy of >= $100 in a single swap auto-mints a collectible NFT to the buying wallet.** No claim step, no signup, no extra cost — an agent-controlled wallet earns one exactly like a human's.
- 1,925 max supply · 6 buy-tier motifs ($100 / $150 / $250 / $500 / $1000 / $2500+) · 7 rarities (Common → Immortal) from a weighted matrix with **hard per-cell caps** — minted-out combinations can never exist again, so supply only shrinks.
- To earn one: \`bobai_price\` (convert the tier threshold to BNB, add ~5% headroom) → one swap via \`bobai_purchase_guide\` → the NFT lands in the wallet within ~1 minute.
- Live remaining supply per tier and rarity: \`bobai_nft_drop\` / https://brainonbnb.com/api/nft-drop · collection: https://brainonbnb.com/nft
- The NFT is a collectible with no promised value or utility. Not financial advice.

## FoT-safe swapping on BSC (general reference — works for any tax token)
Agents routinely lose gas to reverted swaps on BSC because **fee-on-transfer (FoT) tax tokens break the standard swap flow**. The rules below apply to *every* FoT token on a UniswapV2-style DEX; $BOBAI (3% tax) is the worked example throughout this doc.
1. **Why naive swaps revert:** the token contract skims its tax during \`transfer\`, so the router receives fewer tokens than the constant-product math predicted. The standard \`swapExactETHForTokens\` enforces the predicted output → the K-check/\`amountOutMin\` fails → revert.
2. **Use the FoT router methods:** \`swapExactETHForTokensSupportingFeeOnTransferTokens\` (buy) / \`swapExactTokensForETHSupportingFeeOnTransferTokens\` (sell). These validate balances instead of predicted amounts.
3. **Slippage must cover tax + impact + buffer:** \`min_slippage_bps ≈ tax_bps + price_impact_bps + ~200 buffer\`. Quote via \`getAmountsOut\` on-chain, then \`amountOutMin = quote × (10000 − slippage_bps) / 10000\`. (For $BOBAI: 300 tax + impact → we publish 1500 bps as the safe floor.)
4. **Selling needs an ERC-20 \`approve\` on the router first** — buys don't.
5. **Detect the tax before trading an unknown token:** compare a static-call quote against a tiny real transfer, or read the verified contract on BscScan. Never assume 0% on a meme token.

## Prompts & resources (MCP)
- Prompt \`evaluate_bobai\` — guided neutral due-diligence walkthrough through all read tools
- Prompt \`prepare_bobai_swap\` — fee-on-transfer-safe swap preparation (optional \`wallet\` argument)
- Resources: this skill doc (\`text/markdown\`) and the A2A agent card (\`application/json\`) are readable via \`resources/read\`

## ⚠️ Must know before swapping
$BOBAI is a **fee-on-transfer** token (3% tax). A naive swap **reverts**. You MUST:
- use \`swapExactETHForTokensSupportingFeeOnTransferTokens\` (buy) / \`swapExactTokensForETHSupportingFeeOnTransferTokens\` (sell)
- set slippage tolerance **>= 15% (1500 bps)**

## Trade parameters
- DEX: **PancakeSwap V2**
- Router: \`${TRADE_INFO.router}\`
- Pair: \`${TRADE_INFO.pair}\` (token0 = $BOBAI, token1 = WBNB)
- Buy path: \`[${TRADE_INFO.quote_token_address}, ${TOKEN}]\`
- Sell path: \`[${TOKEN}, ${TRADE_INFO.quote_token_address}]\`

## How to buy (viem)
\`\`\`javascript
${buy.code}
\`\`\`
To sell: reverse the path, approve the router for $BOBAI first, then call \`swapExactTokensForETHSupportingFeeOnTransferTokens\`.

## Tokenomics (how it works — verify, don't trust)
- **Model:** deflationary — circulating supply shrinks as trading volume grows.
- **Mechanism:** 3% trade tax → autonomous 24/7 buyback → bought $BOBAI sent to the dead address (permanent burn). More volume → more burned → lower supply.
- **Trust:** ownership renounced (no mint/pause/proxy) · LP burned (perma-locked) · fair launch on Four.Meme (no presale, no team allocation) · contract source verified and published on BscScan.
- Verify: \`bobai_burned\`, \`bobai_circulating_supply\`, and BscScan. Describes the design, not a recommendation — meme tokens are high-risk, not financial advice.

## Verify everything yourself
- Contract: https://bscscan.com/token/${TOKEN}
- DexScreener: https://dexscreener.com/bsc/${TOKEN}
- Contract source (verified): https://bscscan.com/address/${TOKEN}#code
- Burn audit log (live): https://logs.brainonbnb.com/logs/burns.json

_Not financial advice. Everything here is verifiable on-chain — don't trust, verify._
`;
}

function decodeAbiString(hex) {
  if (!hex || hex === '0x') return '';
  const h = hex.slice(2);
  if (h.length < 128) return '';
  const len = parseInt(h.slice(64, 128), 16);
  const data = h.slice(128, 128 + len * 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

async function ethCallRaw(to, data) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  return (await res.json()).result;
}

async function getTokenInfo() {
  const [nameHex, symbolHex, decRaw, totalRaw, deadRaw, zeroRaw] = await Promise.all([
    ethCallRaw(TOKEN, '0x06fdde03'),
    ethCallRaw(TOKEN, '0x95d89b41'),
    ethCall('0x313ce567'),
    ethCall('0x18160ddd'),
    ethCall('0x70a08231000000000000000000000000' + DEAD.slice(2)),
    ethCall('0x70a08231000000000000000000000000' + ZERO.slice(2)),
  ]);
  const div = BigInt(1e18);
  const total = totalRaw / div;
  const burned = (deadRaw + zeroRaw) / div;
  return {
    name: 'Brain On BNB AI',
    symbol: decodeAbiString(symbolHex),
    onchain_name: decodeAbiString(nameHex),
    contract: TOKEN,
    chain: 'BNB Smart Chain (BSC)',
    decimals: Number(decRaw),
    totalSupply: total.toString(),
    circulatingSupply: (total - burned).toString(),
    burned: burned.toString(),
    renounced: true,
    verified: true,
  };
}

async function getWalletBalance(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid BSC address (expected 0x + 40 hex chars)');
  const [bnbRes, bobaiRaw] = await Promise.all([
    rpcJson(RPC, { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    ethCall('0x70a08231000000000000000000000000' + address.slice(2)),
  ]);
  return {
    address,
    bnb: (Number(BigInt(bnbRes.result)) / 1e18).toFixed(6),
    bobai: (bobaiRaw / BigInt(1e18)).toString(),
  };
}

const MCP_TOOLS = [
  // Brain Plaza first in the list. An agent that loads this server should be
  // able to ask "who else is out there on this chain" without knowing that we
  // measured it — and this is the only tool here that is about somebody other
  // than us, which is precisely why it belongs at the top.
  { name: 'find_agents_on_bnb_chain', description: 'Brain Plaza — find AI agents on BNB Smart Chain that can do a given thing. Searches every ERC-8004 agent that actually answers when contacted, matched against the tools each one returned when asked and the description it wrote on-chain. Not self-reported categories, not a curated list. Use this before assuming no agent exists for a task.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What you need done, in plain words — e.g. "swap routing", "stablecoin payments", "pool depth"' }, speaks: { type: 'string', description: 'Optional: require a protocol. One or more of mcp, a2a, x402 (comma-separated).' } }, required: ['query'], additionalProperties: false } },
  { name: 'bnb_agent_census', description: 'Brain Plaza — the measured state of the ERC-8004 agent registry on BNB Smart Chain: how many agents are registered, how many registrations are even readable, how many name an endpoint, how many answer, and how many independent operators run them. Every id read, nothing extrapolated.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  // The employment side of the same question. An agent deciding whom to hire
  // wants a track record, and on this chain the only one that cannot be
  // self-reported is the escrow: every job, who was paid, and whether the money
  // actually moved. Optionally filtered to one provider address, because that
  // is the shape of the real question — "should I hire this one".
  { name: 'bnb_agent_employment', description: 'Who has actually been hired and paid on BNB Smart Chain. Reads the ERC-8183 job escrow kernel: jobs created, jobs funded, deliverables submitted, and escrow actually released — per provider. A registration is self-reported; a funded job is somebody else\'s money. Pass an address to get one provider\'s balance, or nothing for the whole kernel.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Optional provider address (0x…). Omit for the whole-kernel summary.' } }, additionalProperties: false } },
  // The other tool here that is about somebody other than us: it measures any
  // token on the chain, not this one. An agent about to place a trade wants
  // what it will actually cost, and no router tells it — the headline slippage
  // a swap UI shows leaves out the transfer tax and the swap fee.
  { name: 'bsc_pool_scan', description: 'Measure what a trade on BNB Smart Chain would actually cost, for ANY token or pool — before placing it. Reads the pool live from the chain and returns: real cost per trade size (price impact + swap fee + transfer tax together, not the headline slippage a router shows), the USD size that moves the price 1% in each direction, the transfer tax MEASURED from executed trades rather than taken from a label, how much of the token\'s liquidity the readable pool actually holds, and whether the LP is burned or still withdrawable — plus our own sell simulation on the router from a fresh address (sellability). A token still raising on four.meme with no pool yet is measured from four.meme\'s own contract instead (curve: raise progress, price, buy/sell cost per size, fee). Works on PancakeSwap V2/V3, Uniswap V2 and Biswap. No API key, nothing cached.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'A BSC token address, a pool/pair address, or any BscScan / DexScreener / PancakeSwap link containing one' } }, required: ['address'], additionalProperties: false } },
  { name: 'pancakeswap_fee_tiers', description: 'For a liquidity provider deciding WHERE to put liquidity on PancakeSwap. A pair lives in up to five pools at once — V2 at 0.25% and V3 at 0.01%, 0.05%, 0.25% and 1.00% — and every source ranks them by the money already parked in them, which does not say which one pays. This measures each tier over a live window: swaps, turnover, the fees the pool actually paid out, and those fees per $1,000 of capital — over TWO denominators. The first is everything the pool holds, which is what every interface shows. The second is the capital standing within 2% of the current price, reconstructed by walking the tick book of the pool itself, because concentrated liquidity parked far from the price earns nothing and a new dollar only competes with the capital that is at the price. The two rankings disagree often, and both are returned. It also names tiers holding real money that did not trade at all. Measured, never annualised: the window is about an hour of chain and is reported with the answer.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'A BSC token address, or a PancakeSwap pool address to pin the pair' } }, required: ['address'], additionalProperties: false } },
  { name: 'pancakeswap_range_plan', description: 'For a liquidity provider who has picked a PancakeSwap V3 pool and now has to pick a PRICE RANGE - the decision concentrated liquidity actually forces, and the one every interface answers with a preset. This does not model and does not forecast. It replays: the V3 Swap event carries the liquidity that was active when each trade went through, so a position of a stated size is walked through the swaps that really happened in a live window and asked, at each one, whether it was in range and what share of the active liquidity it was. Returns per candidate width the fees it would have collected, how much of the window it stayed in range, and how many times the price walked out. Impermanent loss is not in it, and it is worst exactly where the fees are best. The window is about an hour and travels with the answer.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'A BSC token address, or a PancakeSwap V3 pool address to pin the pool' }, capitalUsd: { type: 'number', description: 'Size of the position in dollars, optional - defaults to 1000' } }, required: ['address'], additionalProperties: false } },
  // NAMED best_route AND NOT swap_route, deliberately. Our own dispatcher — and
  // any other router built the same way — refuses a tool with a mutating verb
  // anywhere in its NAME, which is the rule that stops `get_swap_calldata` from
  // being called by mistake. It is a good rule and it does not get bent for us:
  // this tool was unreachable as `pancakeswap_swap_route` and the name was the
  // debt, exactly as it was for the two tools renamed on 2026-08-29.
  { name: 'pancakeswap_best_route', description: 'For an agent about to swap on PancakeSwap, and for the two questions it has to answer before signing. FIRST: which of the up-to-five pools the pair lives in actually returns the most AT THIS SIZE, quoted by the venue itself rather than ranked by depth - the deepest pool is regularly not the cheapest one for the trade being made. SECOND: what comes back if the proceeds are sold straight back on the same route, with the transfer tax measured from executed trades applied to the amounts carried between the legs, because the tax is taken outside the pool where no quoter can see it. Returns the best route, what every other route would have cost, the round trip with and without the tax, and the slippage this size really needs. It is not a safety certificate and does not use the word: it cannot see an owner who has not acted yet, and it says so.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'A BSC token address, or a PancakeSwap pool address to pin the pair' }, usd: { type: 'number', description: 'Trade size in dollars, optional - defaults to 250' } }, required: ['address'], additionalProperties: false } },
  { name: 'bobai_token_info', description: '$BOBAI (Brain On BNB AI) on-chain token info: contract, name, symbol, decimals, total & circulating supply, amount burned. BEP-20 on BNB Chain, verified & renounced.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_burned', description: 'Total $BOBAI permanently burned (sent to the dead/zero address by the autonomous 24/7 buyback-and-burn bot).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_circulating_supply', description: 'Current circulating $BOBAI supply (total supply minus burned tokens).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_wallet_balance', description: 'BNB and $BOBAI balance of any BSC wallet address.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'BSC wallet address (0x + 40 hex chars)' } }, required: ['address'], additionalProperties: false } },
  { name: 'bobai_links', description: 'Official $BOBAI links: website, BscScan contract + verified source, X, Telegram, DexScreener, GeckoTerminal, CoinGecko, live burn audit log, llms.txt.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_dex_info', description: 'The DEX parameters a $BOBAI trade needs, read from the chain: PancakeSwap V2 router, pair, both swap paths, and the fee-on-transfer settings (3% tax, minimum 15% slippage, the SupportingFeeOnTransferTokens method names). Reports the numbers; a naive swap reverts without them.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_guide', description: 'START HERE. Interactive guide for an agent that just discovered $BOBAI: what you can ask, what you can do, and which tool to call for each — plus the must-know fee-on-transfer rule.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_purchase_guide', description: 'Ready-to-run viem code for a $BOBAI purchase with BNB on PancakeSwap V2. Reports a live on-chain quote, the 15% slippage floor and the fee-on-transfer method name, so an agent has everything it needs zero-shot. Returns text; this tool holds no key and moves nothing.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_tokenomics', description: 'Neutral, verifiable value-accrual mechanics of $BOBAI: the deflationary tax->buyback->burn design + trust properties (renounced, LP burned, fair launch). Describes how the token works, NOT a buy recommendation.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_price', description: 'Live $BOBAI price in USD and BNB + market cap, computed fully on-chain (PancakeSwap V2 pair reserves × Chainlink BNB/USD feed) — no off-chain price API to trust.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_liquidity', description: 'Live $BOBAI liquidity depth: pool reserves, liquidity in USD, LP-burned percentage (perma-locked), and price-impact estimates for common buy sizes (0.1–5 BNB).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_activity', description: 'Proof the buyback-and-burn flywheel is actually running: last burn (with BscScan tx), burns over the last 7/30 days, total bot runs — from the public audit log, every entry verifiable on-chain.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_nft_drop', description: 'On-chain reward an agent can EARN: every $BOBAI buy >= $100 (single swap) auto-mints a capped-supply collectible NFT to the buyer wallet — no claim, no signup. Live remaining supply per buy-tier and rarity, plus the exact steps to earn one.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_smart_money', description: 'Live smart-money signals for $BOBAI: the tax reserve charging the next buyback (wallet + contract queue = pending buy pressure), whale flows & holdings (auto-tracked 1%-of-supply wallets: 24h/7d in/outflows, top movers with tx, daily balance snapshots with 1d/7d/30d holdings trends), an immutable on-chain ledger of recent $100+ buys (size, buyer wallet, tx), and burn momentum. All verifiable, no API key.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

// Two tools were unroutable for two years' worth of a reason that had nothing
// to do with what they do: the router's name check refuses any tool with a
// mutating verb in its name, and `bobai_trade_info` and `bobai_how_to_buy`
// carried "trade" and "buy". The rule is correct and stays — it is what stops
// `get_swap_calldata` — so the debt was ours, in the names. They now read as
// what they are, and the old names keep answering for anything that already
// hardcoded them. Deprecated, not advertised: tools/list carries the new names
// only, so the tool count does not double.
const DEPRECATED_TOOL_NAMES = {
  bobai_trade_info: 'bobai_dex_info',
  bobai_how_to_buy: 'bobai_purchase_guide',
};

async function runTool(rawName, args) {
  const name = DEPRECATED_TOOL_NAMES[rawName] || rawName;
  switch (name) {
    case 'find_agents_on_bnb_chain': {
      const q = encodeURIComponent(String(args?.query || '').slice(0, 200));
      const sp = args?.speaks ? '&speaks=' + encodeURIComponent(String(args.speaks).slice(0, 40)) : '';
      const r = await fetch(`https://agent.brainonbnb.com/find?q=${q}${sp}&limit=10`, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error('Brain Plaza search is unavailable right now');
      return await r.json();
    }
    case 'bsc_pool_scan': {
      const m = String(args?.address || '').match(/0x[a-fA-F0-9]{40}/);
      if (!m) throw new Error('Give a BSC token or pool address (0x followed by 40 hex characters), or a link containing one.');
      try {
        return await poolScan(m[0].toLowerCase(), WORKER_ENV);
      } catch (e) {
        // A scan is a few dozen outbound calls, and this account's plan cuts
        // them off at fifty per request. Measured: 16 for a single-venue token,
        // 40 for the busiest ones. So it fits today and can stop fitting for a
        // token listed in more places than any we tested — and when it does,
        // saying so beats a truncated answer that reads like a complete one.
        if (/too many subrequests/i.test(String(e?.message || ''))) {
          throw new Error(
            'This token trades in too many places to measure inside one request here. ' +
            'The browser scanner at https://brainonbnb.com/scanner and the installable skill ' +
            '(npx skills add https://brainonbnb.com) run the identical measurement with no such ceiling.',
          );
        }
        // A ScanError carries a headline and the reason behind it; both are
        // worth passing on, because "that pool cannot be priced" and "the chain
        // did not answer" call for completely different next steps.
        throw new Error(e?.detail ? `${e.headline} ${e.detail}` : (e?.message || 'Scan failed.'));
      }
    }
    case 'pancakeswap_fee_tiers': {
      const m = String(args?.address || '').match(/0x[a-fA-F0-9]{40}/);
      if (!m) throw new Error('Give a BSC token or PancakeSwap pool address (0x followed by 40 hex characters), or a link containing one.');
      try {
        return await feeTiers(m[0].toLowerCase());
      } catch (e) {
        // Same ceiling as the pool scan, and the same reason for naming it: a
        // truncated answer about where to put money reads like a complete one.
        if (/too many subrequests/i.test(String(e?.message || ''))) {
          throw new Error(
            'This token trades in too many places to measure inside one request here. ' +
            'The installable skill (npx skills add https://brainonbnb.com) runs the identical measurement with no such ceiling.',
          );
        }
        throw new Error(e?.detail ? `${e.headline} ${e.detail}` : (e?.message || 'Tier scan failed.'));
      }
    }
    case 'pancakeswap_range_plan': {
      const m = String(args?.address || '').match(/0x[a-fA-F0-9]{40}/);
      if (!m) throw new Error('Give a BSC token or PancakeSwap V3 pool address (0x followed by 40 hex characters), or a link containing one.');
      const capitalUsd = Number(args?.capitalUsd);
      try {
        return await rangePlan(m[0].toLowerCase(), { capitalUsd: capitalUsd > 0 ? capitalUsd : undefined });
      } catch (e) {
        throw new Error(e?.detail ? `${e.headline} ${e.detail}` : (e?.message || 'Range replay failed.'));
      }
    }
    case 'pancakeswap_best_route': {
      const m = String(args?.address || '').match(/0x[a-fA-F0-9]{40}/);
      if (!m) throw new Error('Give a BSC token or PancakeSwap pool address (0x followed by 40 hex characters), or a link containing one.');
      const usd = Number(args?.usd);
      try {
        return await swapRoute(m[0].toLowerCase(), { usd: usd > 0 ? usd : undefined });
      } catch (e) {
        throw new Error(e?.detail ? `${e.headline} ${e.detail}` : (e?.message || 'Route check failed.'));
      }
    }
    case 'bnb_agent_census': {
      const r = await fetch('https://brainonbnb.com/api-registry.json', { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error('census unavailable');
      const j = await r.json();
      return {
        registered_ids: j.registered_ids,
        registrations_that_parse: j.registrations?.parses,
        name_an_endpoint: j.registrations?.has_http_endpoint,
        answered_when_contacted: j.reachability?.reachable,
        independent_operators: j.independent_operators,
        speak_mcp: j.reachability?.answering_mcp,
        serve_an_agent_card: j.reachability?.serving_an_agent_card,
        measured_at: j.measured_at,
        full_data: 'https://brainonbnb.com/api-operators.json',
        human_readable: 'https://brainonbnb.com/registry',
        method: j.method,
      };
    }
    case 'bnb_agent_employment': {
      const r = await fetch('https://brainonbnb.com/api-jobs.json', { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error('employment census unavailable');
      const j = await r.json();
      const want = String(args?.address || '').toLowerCase();
      if (want) {
        const p = (j.providers || []).find((x) => x.address === want);
        if (!p) {
          // Not an error. "This address has never been hired through the
          // kernel" is a real and useful answer, and returning it as a failure
          // would let a caller mistake it for an outage.
          return { address: want, jobs: 0, note: 'This address does not appear as a provider on any job in the kernel.', measured_at: j.measured_at, source: j.source };
        }
        return { ...p, of_all_jobs: j.jobs?.read, measured_at: j.measured_at, method: j.method, source: j.source };
      }
      return {
        ...j.jobs,
        top_providers: (j.providers || []).slice(0, 10),
        measured_at: j.measured_at,
        method: j.method,
        full_data: 'https://brainonbnb.com/api-jobs.json',
        human_readable: 'https://brainonbnb.com/registry',
      };
    }
    case 'bobai_token_info': return await getTokenInfo();
    case 'bobai_burned': { const t = await getTokenInfo(); return { symbol: t.symbol, burned: t.burned, note: 'Permanently sent to dead/zero address — irreversible' }; }
    case 'bobai_circulating_supply': return { symbol: 'BOBAI', circulatingSupply: (await getCirculating()).toString() };
    case 'bobai_wallet_balance': return await getWalletBalance(String(args?.address || ''));
    case 'bobai_links': return OFFICIAL_LINKS;
    case 'bobai_dex_info': return TRADE_INFO;
    case 'bobai_guide': return AGENT_GUIDE;
    case 'bobai_purchase_guide': return howToBuy();
    case 'bobai_tokenomics': return TOKENOMICS;
    case 'bobai_price': return await getPrice();
    case 'bobai_liquidity': return await getLiquidity();
    case 'bobai_activity': return await getActivity();
    case 'bobai_nft_drop': return await getNftDrop();
    case 'bobai_smart_money': return await getSmartMoney();
    default: throw new Error('Unknown tool: ' + name);
  }
}

// MCP resources — documents an MCP client can read/subscribe to directly.
const MCP_RESOURCES = [
  { uri: 'https://brainonbnb.com/skill.md', name: 'bobai_skill_doc', description: 'Machine-readable skill doc: identity, all tools, trade params, ready-to-run buy code, tokenomics', mimeType: 'text/markdown' },
  { uri: 'https://brainonbnb.com/.well-known/agent-card.json', name: 'bobai_a2a_card', description: 'A2A agent card: skills and capabilities of the $BOBAI agent surface', mimeType: 'application/json' },
];

function readResource(uri) {
  if (uri === 'https://brainonbnb.com/skill.md') return { uri, mimeType: 'text/markdown', text: skillMd() };
  if (uri === 'https://brainonbnb.com/.well-known/agent-card.json') return { uri, mimeType: 'application/json', text: JSON.stringify(A2A_CARD, null, 2) };
  throw new Error('Unknown resource: ' + uri);
}

// MCP prompts — guided walkthroughs that route an agent through the tools.
const MCP_PROMPTS = [
  { name: 'evaluate_bobai', description: 'Neutral due-diligence walkthrough of the $BOBAI token: routes through every read tool and ends with a balanced, on-chain-verified assessment (strengths AND risks).', arguments: [] },
  { name: 'prepare_bobai_swap', description: 'Step-by-step preparation of a $BOBAI swap on PancakeSwap V2 (fee-on-transfer safe): trade params, price impact for your size, wallet check, executable code.', arguments: [{ name: 'wallet', description: 'BSC wallet address to check balances for (optional)', required: false }] },
];

function getPrompt(name, args) {
  if (name === 'evaluate_bobai') {
    return {
      description: MCP_PROMPTS[0].description,
      messages: [{ role: 'user', content: { type: 'text', text: [
        'You are evaluating the $BOBAI token (Brain On BNB AI) on BNB Chain. Use this server\'s tools and stay neutral — verify, don\'t trust.',
        '1. Call bobai_token_info — confirm contract, supply, amount burned, renounced/verified flags.',
        '2. Call bobai_price and bobai_liquidity — note liquidity depth, LP-burned %, and the price impact for your intended size.',
        '3. Call bobai_activity — open the last burn tx on BscScan to confirm the buyback flywheel actually runs.',
        '4. Call bobai_tokenomics — understand the value-accrual design and its trust properties.',
        '5. Cross-check at least one claim independently on-chain (e.g. balanceOf(0x…dEaD) on the token contract, or getReserves() on the pair).',
        'Then give a balanced assessment: strengths, risks (meme token, small liquidity means high price impact, burn cadence depends on volume), and anything you could not verify. This is research, not financial advice.',
      ].join('\n') } }],
    };
  }
  if (name === 'prepare_bobai_swap') {
    const wallet = args?.wallet && /^0x[0-9a-fA-F]{40}$/.test(args.wallet) ? args.wallet : null;
    return {
      description: MCP_PROMPTS[1].description,
      messages: [{ role: 'user', content: { type: 'text', text: [
        'You are preparing (not necessarily executing) a $BOBAI swap on PancakeSwap V2. $BOBAI is fee-on-transfer (3% tax) — a naive swap reverts.',
        '1. Call bobai_dex_info — router, pair, swap paths, the *SupportingFeeOnTransferTokens methods and slippage >= 15% (1500 bps).',
        '2. Call bobai_price and bobai_liquidity — check the price-impact estimate for your size; the 3% transfer tax comes on top.',
        wallet
          ? '3. Call bobai_wallet_balance with address ' + wallet + ' — confirm it holds the BNB for the swap plus gas.'
          : '3. Optionally call bobai_wallet_balance — confirm the wallet holds the BNB for the swap plus gas.',
        '4. Call bobai_purchase_guide — ready-to-run viem code (on-chain quote minus 15% slippage, explicit RPC).',
        'Sanity rules: test with a small amount first, verify token/router/pair on BscScan yourself, never expose a private key holding significant funds. Not financial advice.',
      ].join('\n') } }],
    };
  }
  throw new Error('Unknown prompt: ' + name);
}

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleMcp(request) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ name: 'Brain On BNB AI ($BOBAI)', protocol: '2025-06-18', tools: MCP_TOOLS.map(t => t.name), prompts: MCP_PROMPTS.map(p => p.name), resources: MCP_RESOURCES.map(r => r.uri) }), { headers: cors });
  }
  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify(rpcErr(null, -32700, 'Parse error')), { headers: cors }); }
  const { id, method, params } = body || {};
  if (method && method.startsWith('notifications/')) return new Response(null, { status: 202, headers: cors });
  try {
    if (method === 'initialize') {
      console.log('[mcp] initialize', body?.params?.clientInfo?.name || 'unknown-client');
      return new Response(JSON.stringify(rpcOk(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'Brain On BNB AI ($BOBAI)', version: '1.3.0' },
      })), { headers: cors });
    }
    // Every tool in MCP_TOOLS reads and none of them writes — this worker has
    // no key, no signer and nothing to spend, so that is a property of the
    // array rather than something to assert per entry. It is declared with
    // MCP's own annotation because routers have to decide whether calling a
    // stranger's tool is safe, and the alternative is guessing from the name.
    //
    // Guessing from the name is not hypothetical. Our own router required a
    // reading verb in the tool name and therefore refused to call `bsc_pool_scan`,
    // `bobai_price` and thirteen others — 16 of our own 19 tools — while
    // happily routing anything called `get_*`. A tool that says what it is
    // should not have to be named a particular way to be reachable.
    if (method === 'tools/list') {
      const tools = MCP_TOOLS.map((t) => ({ ...t, annotations: { readOnlyHint: true, destructiveHint: false, ...(t.annotations || {}) } }));
      return new Response(JSON.stringify(rpcOk(id, { tools })), { headers: cors });
    }
    if (method === 'tools/call') {
      console.log('[mcp] tools/call', params?.name);
      const out = await runTool(params?.name, params?.arguments || {});
      return new Response(JSON.stringify(rpcOk(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })), { headers: cors });
    }
    if (method === 'resources/list') return new Response(JSON.stringify(rpcOk(id, { resources: MCP_RESOURCES })), { headers: cors });
    if (method === 'resources/templates/list') return new Response(JSON.stringify(rpcOk(id, { resourceTemplates: [] })), { headers: cors });
    if (method === 'resources/read') {
      console.log('[mcp] resources/read', params?.uri);
      return new Response(JSON.stringify(rpcOk(id, { contents: [readResource(params?.uri)] })), { headers: cors });
    }
    if (method === 'prompts/list') return new Response(JSON.stringify(rpcOk(id, { prompts: MCP_PROMPTS })), { headers: cors });
    if (method === 'prompts/get') {
      console.log('[mcp] prompts/get', params?.name);
      return new Response(JSON.stringify(rpcOk(id, getPrompt(params?.name, params?.arguments || {}))), { headers: cors });
    }
    if (method === 'ping') return new Response(JSON.stringify(rpcOk(id, {})), { headers: cors });
    return new Response(JSON.stringify(rpcErr(id ?? null, -32601, 'Method not found: ' + method)), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify(rpcErr(id ?? null, -32000, e.message || String(e))), { headers: cors });
  }
}

const A2A_CARD = {
  name: 'Brain On BNB AI ($BOBAI)',
  description: 'Read-only agent surface for $BOBAI, plus Brain Plaza — a census of every ERC-8004 agent on BNB Chain, which of them actually answer, and what they expose. Free, no key, open to any agent.',
  url: 'https://brainonbnb.com/',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  documentationUrl: 'https://brainonbnb.com/skill.md',
  provider: { organization: 'Brain On BNB AI', url: 'https://brainonbnb.com/' },
  capabilities: { streaming: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    // Brain Plaza first: it is the skill another agent is most likely to want
    // from us, and the one nothing else on this chain offers. An agent reading
    // this card should not have to scroll past thirteen token endpoints to
    // discover that it can ask us who else is out there.
    { id: 'find_agents', name: 'Find an agent on BNB Chain',
      description: 'Search every reachable ERC-8004 agent on BNB Smart Chain by capability. Matched against the tools each one returned when asked and the description it wrote on-chain — not self-reported categories. GET https://agent.brainonbnb.com/find?q=<what you need>',
      tags: ['agents', 'erc-8004', 'discovery', 'mcp', 'bnb-chain', 'broker'] },
    { id: 'agent_census', name: 'Brain Plaza census',
      description: 'The state of the ERC-8004 registry on BNB Chain: how many agents are registered, how many answer, who runs them, and what they can do. Full data at https://brainonbnb.com/api-operators.json',
      tags: ['agents', 'erc-8004', 'census', 'bnb-chain'] },
    { id: 'pool_depth', name: 'Measure any BSC pool',
      description: 'What a trade actually costs on any BNB Chain pool: price impact per size, swap fee, and the transfer tax measured from executed trades rather than read off a label. Installable as a skill: npx skills add https://brainonbnb.com',
      tags: ['defi', 'bsc', 'liquidity', 'trading'] },
    // The one paid skill. Listed among the free ones on purpose: a card that
    // advertises only what costs nothing leaves an agent to discover the paid
    // service by accident, and the price belongs in the first sentence so that
    // deciding whether to call it never requires calling it.
    { id: 'pool_watch', name: 'Watch a pool (paid)',
      description: 'PAID, 0.50 USD1 for 30 days. Continuous monitoring of one PancakeSwap pool: depth recorded every 15 minutes, callback fired when the pool can no longer absorb a trade of your size. Paid over x402 on BNB Chain — standard scheme via a public facilitator, or a direct USD1 transfer. POST https://agent.brainonbnb.com/watch once without payment to be quoted the terms; full catalogue at https://brainonbnb.com/.well-known/x402',
      tags: ['defi', 'bsc', 'liquidity', 'monitoring', 'x402', 'paid'] },
    { id: 'token_info', name: 'Token info', description: '$BOBAI contract, supply, decimals, amount burned', tags: ['crypto', 'bsc', 'token'] },
    { id: 'burns', name: 'Burn stats', description: 'Total $BOBAI permanently burned', tags: ['crypto', 'deflationary'] },
    { id: 'wallet_balance', name: 'Wallet balance', description: 'BNB + $BOBAI balance of any BSC wallet', tags: ['crypto', 'bsc'] },
    { id: 'links', name: 'Official links', description: 'Verified $BOBAI site, socials, DEX, source', tags: ['links'] },
    { id: 'trade_info', name: 'Trade info', description: 'PancakeSwap V2 router, pair & fee-on-transfer params (3% tax, min 15% slippage) to swap $BOBAI without reverting', tags: ['crypto', 'bsc', 'dex', 'trade'] },
    { id: 'guide', name: 'Agent guide', description: 'Start here — interactive map of what you can ask/do about $BOBAI and which tool to call', tags: ['guide', 'onboarding'] },
    { id: 'how_to_buy', name: 'How to buy', description: 'Ready-to-run viem code to buy $BOBAI with BNB (fee-on-transfer safe)', tags: ['crypto', 'bsc', 'dex', 'trade', 'code'] },
    { id: 'tokenomics', name: 'Tokenomics', description: 'Neutral value-accrual mechanics: deflationary tax->buyback->burn design + trust properties (renounced, LP burned, fair launch)', tags: ['crypto', 'tokenomics', 'deflationary'] },
    { id: 'price', name: 'Live price', description: 'Live $BOBAI price in USD/BNB + market cap, computed fully on-chain (pair reserves × Chainlink BNB/USD)', tags: ['crypto', 'bsc', 'price', 'market-data'] },
    { id: 'liquidity', name: 'Liquidity depth', description: 'Pool reserves, USD liquidity, LP-burned % (perma-locked) and price-impact estimates per buy size', tags: ['crypto', 'bsc', 'liquidity', 'market-data'] },
    { id: 'activity', name: 'Burn activity', description: 'Proof the buyback-and-burn flywheel runs: last burn tx, burns last 7/30 days, public audit log', tags: ['crypto', 'bsc', 'burns', 'audit'] },
    { id: 'nft_drop', name: 'NFT buy drop', description: 'Earnable on-chain reward: every $BOBAI buy >= $100 auto-mints a capped-supply collectible NFT to the buyer wallet — live remaining supply per tier/rarity + how to earn one', tags: ['crypto', 'bsc', 'nft', 'reward'] },
    { id: 'smart_money', name: 'Smart-money signals', description: 'Pending buyback reserve (= predictable buy pressure), live whale flows & holdings (24h/7d in/outflows, top movers with tx, 1d/7d/30d holdings trends from daily balance snapshots), immutable on-chain ledger of recent $100+ buys (size, buyer wallet, tx), and burn momentum — all verifiable', tags: ['crypto', 'bsc', 'smart-money', 'whales', 'signals', 'market-data'] },
  ],
};

// ERC-8004 domain proof. The spec lets an agent prove control of an endpoint
// domain by serving /.well-known/agent-registration.json with a registrations
// list that points back at the on-chain agentId + registry. Without it every
// brainonbnb.com service (MCP, A2A) stays domain_verified:false on indexers
// like 8004scan, because the Pages SPA answers unknown paths with 200 + HTML.
const AGENT_REGISTRATION = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Brain On BNB AI ($BOBAI)',
  description: 'AI-built deflationary meme token on BNB Chain. A 3% trade tax funds an autonomous 24/7 buyback-and-burn cycle. Contract source verified on BscScan and ownership renounced, LP perma-locked, fair launch on Four.Meme with no presale or team allocation. Every burn run is written to a public audit log.',
  image: 'https://brainonbnb.com/logo-200x200.png',
  active: true,
  // Every agent id this domain claims. The ERC-8004 verifier fetches exactly
  // this file and matches the ids in it against the registry — a claim only the
  // domain owner can publish, which is what makes it a proof rather than a
  // label. The four 30xxxx ids are the hireable agents we run — one per category
  // this marketplace has to cover. They are owned by a separate signing wallet
  // on purpose (its key sits in a worker secret and must never be near the token
  // wallet), so this list is the thing that ties them back to us.
  //
  // An id registered on-chain and missing here is an anonymous agent, whatever
  // its document claims. The list itself lives in shared/agent-registrations.js
  // and is served identically by worker-agent on the agent origin, because the
  // verifier fetches whichever host the agent names as its endpoint.
  registrations: registrations(),
  supportedTrust: ['reputation'],
};

// Plain REST mirror of the MCP tools — the lowest common denominator for
// agents that can GET a URL but don't speak MCP yet (documented in skill.md).
const REST_TOOLS = {
  '/api/price': 'bobai_price',
  '/api/liquidity': 'bobai_liquidity',
  '/api/activity': 'bobai_activity',
  '/api/nft-drop': 'bobai_nft_drop',
  '/api/smart-money': 'bobai_smart_money',
  '/api/token': 'bobai_token_info',
  '/api/trade': 'bobai_dex_info',
  '/api/dex-info': 'bobai_dex_info',
  '/api/tokenomics': 'bobai_tokenomics',
  '/api/links': 'bobai_links',
  '/api/guide': 'bobai_guide',
  '/api/how-to-buy': 'bobai_purchase_guide',
  '/api/purchase-guide': 'bobai_purchase_guide',
};

// An ETag is a fingerprint of a response. The browser sends it back next time
// ("If-None-Match"), and if nothing changed we answer 304 with no body — a few
// hundred bytes instead of the whole file. The log proxy below rebuilds its
// responses from scratch, so it has to supply its own; without one, every poll
// pays for the full payload and the page can only stay fresh by not caching at
// all. That is the difference between "refresh re-downloads everything" and
// "refresh just asks and is done".
async function etagOf(buf) {
  const d = await crypto.subtle.digest('SHA-1', buf);
  const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return '"' + hex.slice(0, 20) + '"';
}
// If-None-Match may carry several values and a W/ prefix. Tolerate both, or the
// revalidation never matches and we ship the full body every single time.
function etagMatches(header, tag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((v) => v.trim().replace(/^W\//, '') === tag);
}

export default {
  async fetch(request, env, ctx) {
    WORKER_ENV = env;
    // The chain layer asks a keyed BSC endpoint first when this project has
    // one as a Pages secret (BSC_RPC_KEYED_URL_2 = Allnodes/PublicNode token,
    // unmetered, then BSC_RPC_KEYED_URL = NodeReal, metered — the same two
    // names the Telegram bot and the mint worker bind). Without them the free
    // list is used exactly as before. The key never reaches the browser page
    // or the skill bundle: it is read here, in the Worker, and nowhere else.
    useKeyedRpcs([env.BSC_RPC_KEYED_URL_2, env.BSC_RPC_KEYED_URL]);
    const url = new URL(request.url);

    // Count what agents ask us for, so the public transparency block has real
    // numbers instead of a claim. Fire-and-forget via waitUntil: a request must
    // never be slower, or fail, because a counter was unreachable. Nothing
    // identifying is sent — only which kind of surface was used.
    // Our own smoke test identifies itself and is not counted. The public
    // figure is meant to answer "how much did other people ask us for", and a
    // run of the test suite would add forty requests of our own to it. The
    // header can only ever cause UNDER-counting, never over-counting, which is
    // the safe direction for a number we publish.
    const isSelfTest = request.headers.get('user-agent') === 'bobai-smoke-test';
    const count = (kind) => {
      if (!env.HIT_SECRET || isSelfTest) return;
      ctx.waitUntil(
        fetch('https://agent.brainonbnb.com/hit', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-hit-secret': env.HIT_SECRET },
          body: JSON.stringify({ kind }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => {}),
      );
    };
    if (url.pathname === '/mcp') count('mcp');
    else if (url.pathname.startsWith('/api/')) count('rest');
    else if (url.pathname === '/skill.md') count('skill_doc');
    else if (url.pathname.startsWith('/skills/')) count('skill_download');
    else if (url.pathname.startsWith('/.well-known/')) count('discovery');

    if (url.pathname === '/mcp') return handleMcp(request);

    // Same-origin proxy for the bot-worker log store (KV via logs.brainonbnb.com).
    // Keeps the page independent of the visitor's DNS/CORS for the logs subdomain.
    const logMatch = url.pathname.match(/^\/logs\/([a-z0-9-]+\.json)$/);
    if (logMatch) {
      // These files ARE the page's live numbers: burns and liquidity adds.
      // They used to be served as "fresh for two minutes", plus ten more via
      // stale-while-revalidate — so after a burn the page could sit on the old
      // figures for a quarter of an hour and only a manual reload helped.
      // Now the browser revalidates every time: unchanged means an empty 304
      // (as cheap as the old caching), changed means it shows up at once.
      // cacheTtl keeps the log worker out of it no matter how many visitors
      // are asking at the same moment.
      const LOG_CACHE = 'public, max-age=0, must-revalidate';
      const inm = request.headers.get('If-None-Match');
      const deliver = async (buf) => {
        const tag = await etagOf(buf);
        const headers = {
          'Content-Type': 'application/json',
          'Cache-Control': LOG_CACHE,
          'ETag': tag,
          'Access-Control-Allow-Origin': '*',
        };
        if (etagMatches(inm, tag)) return new Response(null, { status: 304, headers });
        return new Response(buf, { headers });
      };
      const upstream = await fetch('https://logs.brainonbnb.com/logs/' + logMatch[1], { cf: { cacheTtl: 20, cacheEverything: true } }).catch(() => null);
      if (upstream && upstream.ok) return deliver(await upstream.arrayBuffer());
      // Fallback: static copy bundled with the deploy
      const fallback = await env.ASSETS.fetch('https://brainonbnb.com/' + logMatch[1]).catch(() => null);
      if (fallback && fallback.ok) return deliver(await fallback.arrayBuffer());
      return new Response('[]', { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // The two address-taking endpoints are named here rather than in
    // REST_TOOLS, because that table maps a path to a tool that needs no
    // arguments and these need one from the query string.
    const WITH_ADDRESS = {
      '/api/wallet': 'bobai_wallet_balance',
      '/api/pool-scan': 'bsc_pool_scan',
      '/api/fee-tiers': 'pancakeswap_fee_tiers',
      '/api/range-plan': 'pancakeswap_range_plan',
      '/api/best-route': 'pancakeswap_best_route',
    };
    if (REST_TOOLS[url.pathname] || WITH_ADDRESS[url.pathname]) {
      // A pool scan is a live measurement of a pool that moves every block, so
      // it is not cached the way the static answers are. Sixty seconds of a
      // stale depth figure is exactly the kind of number somebody would trade
      // on and be wrong about.
      const isScan = url.pathname === '/api/pool-scan' || url.pathname === '/api/fee-tiers'
        || url.pathname === '/api/range-plan' || url.pathname === '/api/best-route';
      const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': isScan ? 'no-store' : 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      };
      try {
        const out = WITH_ADDRESS[url.pathname]
          ? await runTool(WITH_ADDRESS[url.pathname], { address: url.searchParams.get('address') || '' })
          : await runTool(REST_TOOLS[url.pathname], {});
        return new Response(JSON.stringify(out, null, 2), { headers });
      } catch (e) {
        // 400 for a malformed address, 503 when the chain or a log endpoint
        // did not answer, 422 for every determinate answer ("that address is
        // not a token", "no pool") — never 502: Cloudflare replaces a Worker's
        // 502 body with its own "error code: 502" text, so the plain-words
        // answer never reached an agent (MCP delivered it, REST did not).
        const msg = e.message || String(e);
        const bad = /Invalid BSC address|Give a BSC token/.test(msg);
        const infra = /refused|unavailable|did not answer|every BSC endpoint|too many subrequests|multicall returned|empty aggregate|http \d{3}|failed\.?$/i.test(msg);
        return new Response(JSON.stringify({ error: msg }), { status: bad ? 400 : infra ? 503 : 422, headers });
      }
    }

    if (url.pathname === '/skill.md') {
      return new Response(skillMd(), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Agent-skill discovery. `npx skills add brainonbnb.com` looks for
    // .well-known/agent-skills/index.json first and .well-known/skills/index.json
    // second, so both are answered from the one manifest that
    // scripts/build-skill.mjs writes — the digests in it have to match the
    // tarballs byte for byte, and a second hand-maintained copy would not.
    //
    // Served here rather than as a static file because the catch-all below
    // answers any unrouted path with the dashboard HTML at status 200. An
    // installer receiving that reports "no skills found", which reads exactly
    // like a missing manifest and is why this needs a real route.
    if (url.pathname === '/.well-known/skills/index.json' ||
        url.pathname === '/.well-known/agent-skills/index.json') {
      const src = await env.ASSETS.fetch('https://brainonbnb.com/skills/index.json').catch(() => null);
      if (!src || !src.ok) return new Response(JSON.stringify({ error: 'skill manifest unavailable' }), {
        status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
      return new Response(await src.text(), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // The x402 catalogue — what we sell, at what price, to which wallet.
    //
    // Served from the agent worker rather than written out a second time here.
    // That worker answers the 402 itself and reads payTo from its own binding,
    // so proxying its bytes is what keeps the catalogue and the actual price
    // from ever disagreeing. A hardcoded copy on this domain would be one
    // deploy away from quoting a price we do not charge.
    //
    // The document carries ownership proofs for both origins, so the same bytes
    // verify whether an agent found it here or on the subdomain.
    if (url.pathname === '/.well-known/x402') {
      const src = await fetch('https://agent.brainonbnb.com/.well-known/x402', {
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      if (!src || !src.ok) {
        // Never fall through to the catch-all: it answers 200 with dashboard
        // HTML, and a discovery client reading that reports a malformed
        // catalogue instead of an outage it could retry.
        return new Response(JSON.stringify({
          error: 'catalogue temporarily unavailable',
          see: 'https://agent.brainonbnb.com/.well-known/x402',
        }, null, 2), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return new Response(await src.text(), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/.well-known/agent-card.json') {
      return new Response(JSON.stringify(A2A_CARD, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/.well-known/agent-registration.json') {
      return new Response(JSON.stringify(AGENT_REGISTRATION, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/api/total-supply' || url.pathname === '/api/circulating-supply') {
      const supply = await getCirculating();
      return new Response(supply.toString(), {
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (url.pathname === '/api/nft/state') {
      try {
        const state = await getNftState();
        return new Response(JSON.stringify(state), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30, s-maxage=30',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message || String(e) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // The public source repository, served over git's plain-HTTP protocol.
    //
    // This needs its own branch for one reason: Pages answers an unknown path
    // with index.html and HTTP 200, and a git client reading the dumb protocol
    // asks for loose objects BEFORE it falls back to the pack. Every one of
    // those misses came back as 110 KB of dashboard with a success code, so
    // git concluded the objects were corrupt and the clone died — measured
    // live on 2026-08-26, after the repository itself was perfectly fine.
    //
    // A 404 is the whole fix: it is what tells the client to look in the pack
    // instead. Detected by content type rather than by listing what exists,
    // because nothing under source.git is ever HTML.
    // The bare clone URL, with no path after it. git never asks for this — it
    // appends /info/refs — so anyone requesting it is a person or an agent who
    // copied the link out of llms.txt. Answering with the dashboard page and a
    // 200, which is what an unrouted path gets here, is exactly the kind of
    // confusion this project keeps documenting in other people's endpoints.
    if (url.pathname === '/source.git' || url.pathname === '/source.git/') {
      return new Response(
        'This is a git endpoint, not a page.\n\n'
        + '  git clone https://brainonbnb.com/source.git\n\n'
        + 'What is in it, and why it is not on a platform:\n'
        + '  https://brainonbnb.com/source\n',
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } },
      );
    }

    if (url.pathname.startsWith('/source.git/')) {
      const asset = await env.ASSETS.fetch(request);
      const type = asset.headers.get('content-type') || '';
      if (!asset.ok || type.includes('text/html')) {
        return new Response('Not found\n', {
          status: 404,
          headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      const out = new Response(asset.body, asset);
      // Git reads bytes; a guessed type on a pack file only invites a proxy to
      // transform it. Say octet-stream and let it through untouched.
      out.headers.set('Content-Type', 'application/octet-stream');
      out.headers.set('X-Content-Type-Options', 'nosniff');
      return out;
    }

    const response = await env.ASSETS.fetch(request);
    const secure = (h) => {
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('X-Frame-Options', 'SAMEORIGIN');
      h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      return h;
    };

    // DON'T TRY THIS AGAIN: attaching our own ETag to the HTML so a refresh can
    // be answered with an empty 304 does not work here. Cloudflare runs HTML
    // through its own post-processing and drops ETag and Content-Length on the
    // way out — measured live twice on 2026-08-09, including with no-transform
    // and on pages without a mailto link. That is why the fix went the other
    // way, through file size: stylesheet (styles.css) and code (app.js) sit
    // versioned in the device cache, and the HTML carries only content.
    const newResponse = new Response(response.body, response);
    secure(newResponse.headers);
    return newResponse;
  },
};
