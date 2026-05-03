const TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const ZERO = '0x0000000000000000000000000000000000000000';
const RPC = 'https://bsc-dataseed.binance.org';

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

    const response = await env.ASSETS.fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Content-Type-Options', 'nosniff');
    newResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');
    newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newResponse.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return newResponse;
  },
};
