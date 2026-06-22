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
  const [tiersResp, blockResp, dropsResp] = await Promise.all([
    rpcJson(RPC, {
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: NFT_CONTRACT, data: NFT_GET_TIERS }, 'latest'],
    }),
    rpcJson(RPC, { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }),
    // 2) Drop ledger from mint-worker's KV (avoids publicnode archive limits + saves keyed-RPC quota)
    fetch('https://bobai-nft-mint.bobbuildonbnb.workers.dev/drops').then(r => r.ok ? r.json() : { drops: [] }).catch(() => ({ drops: [] })),
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
  // Normalize for the dashboard UI (which expects tokenId + tx fields)
  const drops = rawDrops.map((d, i) => ({
    to: d.to,
    // tokenId is sequential: newest = highest id (= total minted - i)
    tokenId: minted.reduce((a, b) => a + b, 0) - i,
    tier: d.tier,
    rarity: d.rarity,
    block: d.block,
    ts: d.ts || 0, // unix seconds at mint time
    tx: d.mintTx || d.buyTx,
  }));

  const buyers = new Set(drops.map(d => d.to));
  return { minted, cap, drops, buyers: buyers.size, latestBlock: latest };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
