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
  const [tiersResp, blockResp, dropsResp, holdersResp] = await Promise.all([
    rpcJson(RPC, {
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: NFT_CONTRACT, data: NFT_GET_TIERS }, 'latest'],
    }),
    rpcJson(RPC, { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }),
    // 2) Drop ledger from mint-worker's KV (avoids publicnode archive limits + saves keyed-RPC quota)
    fetch('https://bobai-nft-mint.bobbuildonbnb.workers.dev/drops').then(r => r.ok ? r.json() : { drops: [] }).catch(() => ({ drops: [] })),
    // 3) Live holder count from mint-worker (scans Transfer events, picks up secondary transfers like donations)
    fetch('https://bobai-nft-mint.bobbuildonbnb.workers.dev/holders').then(r => r.ok ? r.json() : null).catch(() => null),
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
    // tokenId is sequential: newest = highest id (= total minted - i)
    tokenId: minted.reduce((a, b) => a + b, 0) - i,
    tier: d.tier,
    rarity: d.rarity,
    block: d.block,
    ts: d.ts || 0, // unix seconds at mint time
    tx: d.mintTx || d.buyTx,
    mintTx: d.mintTx,
    buyTx: d.buyTx,
    usd: d.usd,
  }));

  const buyers = new Set(drops.map(d => d.to));
  // `holders` = live on-chain owner count (reflects transfers like the BscScan donation).
  // `buyers` kept for backwards-compat = unique original mint recipients.
  const holders = (holdersResp && typeof holdersResp.holders === 'number') ? holdersResp.holders : buyers.size;
  return { minted, cap, drops, holders, buyers: buyers.size, latestBlock: latest };
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
  source: 'https://github.com/mmxrealQQ/bobai-buyburn',
  llms_txt: 'https://brainonbnb.com/llms.txt',
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

// Interactive entry point for any agent that discovers $BOBAI.
// Answers "what can I ask? / what can I do?" and routes to the exact tool.
const AGENT_GUIDE = {
  agent: 'Brain On BNB AI ($BOBAI)',
  what_this_is: 'A read-only, verifiable on-chain data surface for the $BOBAI token on BNB Chain (BSC). Not a trading bot — a source of truth other agents can call before they act.',
  what_you_can_know: [
    { ask: 'Token basics: contract, name, symbol, decimals, supply, amount burned', call: 'bobai_token_info' },
    { ask: 'How much $BOBAI has been permanently burned', call: 'bobai_burned' },
    { ask: 'Current circulating supply (total minus burned)', call: 'bobai_circulating_supply' },
    { ask: "Any BSC wallet's BNB and $BOBAI balance", call: 'bobai_wallet_balance', args: { address: '0x…' } },
    { ask: 'Official verified links: site, contract, socials, DEX, source', call: 'bobai_links' },
  ],
  what_you_can_do: [
    { action: 'Get the raw DEX execution parameters (router, pair, paths, slippage, methods)', call: 'bobai_trade_info' },
    { action: 'Get ready-to-run code to BUY $BOBAI with BNB', call: 'bobai_how_to_buy' },
  ],
  must_know: '$BOBAI is a fee-on-transfer token (3% tax). Any swap MUST use the *SupportingFeeOnTransferTokens router methods with slippage >= 15% (1500 bps) or it reverts. Everything here is verifiable on-chain. Not financial advice.',
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
  { name: 'bobai_token_info', description: '$BOBAI (Brain On BNB AI) on-chain token info: contract, name, symbol, decimals, total & circulating supply, amount burned. BEP-20 on BNB Chain, verified & renounced.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_burned', description: 'Total $BOBAI permanently burned (sent to the dead/zero address by the autonomous 24/7 buyback-and-burn bot).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_circulating_supply', description: 'Current circulating $BOBAI supply (total supply minus burned tokens).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_wallet_balance', description: 'BNB and $BOBAI balance of any BSC wallet address.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'BSC wallet address (0x + 40 hex chars)' } }, required: ['address'], additionalProperties: false } },
  { name: 'bobai_links', description: 'Official $BOBAI links: website, BscScan contract, X, Telegram, DexScreener, GeckoTerminal, CoinGecko, GitHub source, llms.txt.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_trade_info', description: 'How to swap $BOBAI on-chain: PancakeSwap V2 router, pair, swap paths, and the critical fee-on-transfer parameters (3% tax, min 15% slippage, SupportingFeeOnTransferTokens methods). $BOBAI reverts on a naive swap — use these.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_guide', description: 'START HERE. Interactive guide for an agent that just discovered $BOBAI: what you can ask, what you can do, and which tool to call for each — plus the must-know fee-on-transfer rule.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bobai_how_to_buy', description: 'Ready-to-run viem code to BUY $BOBAI with BNB on PancakeSwap V2 (on-chain quote + 15% slippage + fee-on-transfer method), so an agent can execute a swap 0-shot.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

async function runTool(name, args) {
  switch (name) {
    case 'bobai_token_info': return await getTokenInfo();
    case 'bobai_burned': { const t = await getTokenInfo(); return { symbol: t.symbol, burned: t.burned, note: 'Permanently sent to dead/zero address — irreversible' }; }
    case 'bobai_circulating_supply': return { symbol: 'BOBAI', circulatingSupply: (await getCirculating()).toString() };
    case 'bobai_wallet_balance': return await getWalletBalance(String(args?.address || ''));
    case 'bobai_links': return OFFICIAL_LINKS;
    case 'bobai_trade_info': return TRADE_INFO;
    case 'bobai_guide': return AGENT_GUIDE;
    case 'bobai_how_to_buy': return howToBuy();
    default: throw new Error('Unknown tool: ' + name);
  }
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
    return new Response(JSON.stringify({ name: 'Brain On BNB AI ($BOBAI)', protocol: '2025-06-18', tools: MCP_TOOLS.map(t => t.name) }), { headers: cors });
  }
  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify(rpcErr(null, -32700, 'Parse error')), { headers: cors }); }
  const { id, method, params } = body || {};
  if (method && method.startsWith('notifications/')) return new Response(null, { status: 202, headers: cors });
  try {
    if (method === 'initialize') {
      return new Response(JSON.stringify(rpcOk(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'Brain On BNB AI ($BOBAI)', version: '1.0.0' },
      })), { headers: cors });
    }
    if (method === 'tools/list') return new Response(JSON.stringify(rpcOk(id, { tools: MCP_TOOLS })), { headers: cors });
    if (method === 'tools/call') {
      const out = await runTool(params?.name, params?.arguments || {});
      return new Response(JSON.stringify(rpcOk(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })), { headers: cors });
    }
    if (method === 'ping') return new Response(JSON.stringify(rpcOk(id, {})), { headers: cors });
    return new Response(JSON.stringify(rpcErr(id ?? null, -32601, 'Method not found: ' + method)), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify(rpcErr(id ?? null, -32000, e.message || String(e))), { headers: cors });
  }
}

const A2A_CARD = {
  name: 'Brain On BNB AI ($BOBAI)',
  description: 'Read-only agent surface for $BOBAI — on-chain token info, burns, circulating supply, wallet balances, and official links.',
  url: 'https://brainonbnb.com/',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  provider: { organization: 'Brain On BNB AI', url: 'https://brainonbnb.com/' },
  capabilities: { streaming: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    { id: 'token_info', name: 'Token info', description: '$BOBAI contract, supply, decimals, amount burned', tags: ['crypto', 'bsc', 'token'] },
    { id: 'burns', name: 'Burn stats', description: 'Total $BOBAI permanently burned', tags: ['crypto', 'deflationary'] },
    { id: 'wallet_balance', name: 'Wallet balance', description: 'BNB + $BOBAI balance of any BSC wallet', tags: ['crypto', 'bsc'] },
    { id: 'links', name: 'Official links', description: 'Verified $BOBAI site, socials, DEX, source', tags: ['links'] },
    { id: 'trade_info', name: 'Trade info', description: 'PancakeSwap V2 router, pair & fee-on-transfer params (3% tax, min 15% slippage) to swap $BOBAI without reverting', tags: ['crypto', 'bsc', 'dex', 'trade'] },
    { id: 'guide', name: 'Agent guide', description: 'Start here — interactive map of what you can ask/do about $BOBAI and which tool to call', tags: ['guide', 'onboarding'] },
    { id: 'how_to_buy', name: 'How to buy', description: 'Ready-to-run viem code to buy $BOBAI with BNB (fee-on-transfer safe)', tags: ['crypto', 'bsc', 'dex', 'trade', 'code'] },
  ],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/mcp') return handleMcp(request);

    if (url.pathname === '/.well-known/agent-card.json') {
      return new Response(JSON.stringify(A2A_CARD, null, 2), {
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

    const response = await env.ASSETS.fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Content-Type-Options', 'nosniff');
    newResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');
    newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newResponse.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return newResponse;
  },
};
