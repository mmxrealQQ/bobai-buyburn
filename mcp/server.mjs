#!/usr/bin/env node
// $BOBAI MCP server — local stdio transport, zero dependencies (Node >= 18).
//
// This is the same server that runs 24/7 at https://brainonbnb.com/mcp
// (dashboard/_worker.js), packaged to run locally: the MCP protocol
// (initialize / tools / resources / prompts) is handled entirely in this
// process; live on-chain data is read from the public keyless REST mirror
// of the same worker (documented at https://brainonbnb.com/skill.md).
//
//   node mcp/server.mjs
//
// Introspection (initialize, tools/list, prompts/list, resources/list) is
// fully static and works offline; only tools/call and resources/read fetch.

import { createInterface } from 'node:readline';

const BASE = 'https://brainonbnb.com';
const PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'Brain On BNB AI ($BOBAI)', version: '1.2.0' };

const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const TOOLS = [
  { name: 'bobai_token_info', description: '$BOBAI (Brain On BNB AI) on-chain token info: contract, name, symbol, decimals, total & circulating supply, amount burned. BEP-20 on BNB Chain, verified & renounced.', inputSchema: noArgs, rest: '/api/token' },
  { name: 'bobai_burned', description: 'Total $BOBAI permanently burned (sent to the dead/zero address by the autonomous 24/7 buyback-and-burn bot).', inputSchema: noArgs, rest: '/api/token' },
  { name: 'bobai_circulating_supply', description: 'Current circulating $BOBAI supply (total supply minus burned tokens).', inputSchema: noArgs, rest: '/api/token' },
  { name: 'bobai_wallet_balance', description: 'BNB and $BOBAI balance of any BSC wallet address.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'BSC wallet address (0x + 40 hex chars)' } }, required: ['address'], additionalProperties: false }, rest: '/api/wallet' },
  { name: 'bobai_links', description: 'Official $BOBAI links: website, BscScan contract, X, Telegram, DexScreener, GeckoTerminal, CoinGecko, GitHub source, llms.txt.', inputSchema: noArgs, rest: '/api/links' },
  { name: 'bobai_trade_info', description: 'How to swap $BOBAI on-chain: PancakeSwap V2 router, pair, swap paths, and the critical fee-on-transfer parameters (3% tax, min 15% slippage, SupportingFeeOnTransferTokens methods). $BOBAI reverts on a naive swap — use these.', inputSchema: noArgs, rest: '/api/trade' },
  { name: 'bobai_guide', description: 'START HERE. Interactive guide for an agent that just discovered $BOBAI: what you can ask, what you can do, and which tool to call for each — plus the must-know fee-on-transfer rule.', inputSchema: noArgs, rest: '/api/guide' },
  { name: 'bobai_how_to_buy', description: 'Ready-to-run viem code to BUY $BOBAI with BNB on PancakeSwap V2 (on-chain quote + 15% slippage + fee-on-transfer method), so an agent can execute a swap 0-shot.', inputSchema: noArgs, rest: '/api/how-to-buy' },
  { name: 'bobai_tokenomics', description: 'Neutral, verifiable value-accrual mechanics of $BOBAI: the deflationary tax->buyback->burn design + trust properties (renounced, LP burned, fair launch). Describes how the token works, NOT a buy recommendation.', inputSchema: noArgs, rest: '/api/tokenomics' },
  { name: 'bobai_price', description: 'Live $BOBAI price in USD and BNB + market cap, computed fully on-chain (PancakeSwap V2 pair reserves × Chainlink BNB/USD feed) — no off-chain price API to trust.', inputSchema: noArgs, rest: '/api/price' },
  { name: 'bobai_liquidity', description: 'Live $BOBAI liquidity depth: pool reserves, liquidity in USD, LP-burned percentage (perma-locked), and price-impact estimates for common buy sizes (0.1–5 BNB).', inputSchema: noArgs, rest: '/api/liquidity' },
  { name: 'bobai_activity', description: 'Proof the buyback-and-burn flywheel is actually running: last burn (with BscScan tx), burns over the last 7/30 days, total bot runs — from the public audit log, every entry verifiable on-chain.', inputSchema: noArgs, rest: '/api/activity' },
  { name: 'bobai_nft_drop', description: 'On-chain reward an agent can EARN: every $BOBAI buy >= $100 (single swap) auto-mints a capped-supply collectible NFT to the buyer wallet — no claim, no signup. Live remaining supply per buy-tier and rarity, plus the exact steps to earn one.', inputSchema: noArgs, rest: '/api/nft-drop' },
];

const RESOURCES = [
  { uri: 'https://brainonbnb.com/skill.md', name: 'bobai_skill_doc', description: 'Machine-readable skill doc: identity, all tools, trade params, ready-to-run buy code, tokenomics', mimeType: 'text/markdown' },
  { uri: 'https://brainonbnb.com/.well-known/agent-card.json', name: 'bobai_a2a_card', description: 'A2A agent card: skills and capabilities of the $BOBAI agent surface', mimeType: 'application/json' },
];

const PROMPTS = [
  { name: 'evaluate_bobai', description: 'Neutral due-diligence walkthrough of the $BOBAI token: routes through every read tool and ends with a balanced, on-chain-verified assessment (strengths AND risks).', arguments: [] },
  { name: 'prepare_bobai_swap', description: 'Step-by-step preparation of a $BOBAI swap on PancakeSwap V2 (fee-on-transfer safe): trade params, price impact for your size, wallet check, executable code.', arguments: [{ name: 'wallet', description: 'BSC wallet address to check balances for (optional)', required: false }] },
];

async function fetchJson(path) {
  const res = await fetch(BASE + path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function runTool(name, args) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error('Unknown tool: ' + name);
  if (name === 'bobai_wallet_balance') {
    const address = String(args?.address || '');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid BSC address (expected 0x + 40 hex chars)');
    return fetchJson('/api/wallet?address=' + address);
  }
  const data = await fetchJson(tool.rest);
  if (name === 'bobai_burned') return { symbol: data.symbol, burned: data.burned, note: 'Permanently sent to dead/zero address — irreversible' };
  if (name === 'bobai_circulating_supply') return { symbol: 'BOBAI', circulatingSupply: String(data.circulatingSupply ?? data.circulating_supply) };
  return data;
}

async function readResource(uri) {
  const r = RESOURCES.find(x => x.uri === uri);
  if (!r) throw new Error('Unknown resource: ' + uri);
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`GET ${uri} -> HTTP ${res.status}`);
  return { uri, mimeType: r.mimeType, text: await res.text() };
}

function getPrompt(name, args) {
  if (name === 'evaluate_bobai') {
    return {
      description: PROMPTS[0].description,
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
      description: PROMPTS[1].description,
      messages: [{ role: 'user', content: { type: 'text', text: [
        'You are preparing (not necessarily executing) a $BOBAI swap on PancakeSwap V2. $BOBAI is fee-on-transfer (3% tax) — a naive swap reverts.',
        '1. Call bobai_trade_info — router, pair, swap paths, the *SupportingFeeOnTransferTokens methods and slippage >= 15% (1500 bps).',
        '2. Call bobai_price and bobai_liquidity — check the price-impact estimate for your size; the 3% transfer tax comes on top.',
        wallet
          ? '3. Call bobai_wallet_balance with address ' + wallet + ' — confirm it holds the BNB for the swap plus gas.'
          : '3. Optionally call bobai_wallet_balance — confirm the wallet holds the BNB for the swap plus gas.',
        '4. Call bobai_how_to_buy — ready-to-run viem code (on-chain quote minus 15% slippage, explicit RPC).',
        'Sanity rules: test with a small amount first, verify token/router/pair on BscScan yourself, never expose a private key holding significant funds. Not financial advice.',
      ].join('\n') } }],
    };
  }
  throw new Error('Unknown prompt: ' + name);
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(req) {
  const { id, method, params } = req;
  if (typeof method !== 'string') { if (id !== undefined) send(err(id, -32600, 'Invalid request')); return; }
  if (method.startsWith('notifications/')) return;
  try {
    if (method === 'initialize') return send(ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: SERVER_INFO }));
    if (method === 'tools/list') return send(ok(id, { tools: TOOLS.map(({ rest, ...t }) => t) }));
    if (method === 'tools/call') {
      const out = await runTool(params?.name, params?.arguments || {});
      return send(ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }));
    }
    if (method === 'resources/list') return send(ok(id, { resources: RESOURCES }));
    if (method === 'resources/templates/list') return send(ok(id, { resourceTemplates: [] }));
    if (method === 'resources/read') return send(ok(id, { contents: [await readResource(params?.uri)] }));
    if (method === 'prompts/list') return send(ok(id, { prompts: PROMPTS }));
    if (method === 'prompts/get') return send(ok(id, getPrompt(params?.name, params?.arguments || {})));
    if (method === 'ping') return send(ok(id, {}));
    return send(err(id ?? null, -32601, 'Method not found: ' + method));
  } catch (e) {
    return send(err(id ?? null, -32000, e.message || String(e)));
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return send(err(null, -32700, 'Parse error')); }
  handle(req);
});
rl.on('close', () => process.exit(0));
