// A PRICE ASKED UNDER ANOTHER NAME IS ANSWERED (2026-11-04)
// A week of /stats/detail: get_token_price 4 times on brainonbnb.com/mcp, get_price_of_token 12 times across the six
// agent doors. Each got the right tool named and had to ask again. Now a price-named call is answered at once — with
// a token's address the price from bsc_token_preflight's pool read, without one (or $BOBAI's) bobai_price, with only a
// symbol nothing is guessed. The agent doors pass such a call to the site's MCP.
//   node scripts/price-alias-check.mjs [site=https://brainonbnb.com]
const SITE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
let bad = 0;
const pin = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`); };
const call = async (url, name, args) => {
  const j = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'brainonbnb-price-alias-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json()).catch(() => null);
  const r = j?.result, text = r?.content?.[0]?.text || j?.error?.message || '';
  let out = r?.structuredContent || null; if (!out) { try { out = JSON.parse(text); } catch { out = null; } }
  return { isError: !!(r?.isError || j?.error), out, text };
};
const a = await call(`${SITE}/mcp`, 'get_token_price', { address: CAKE });
pin('get_token_price with a token address answers its price from the preflight', !a.isError && a.out?.answered_as === 'bsc_token_preflight' && a.out?.price_usd > 0 && /CAKE/i.test(a.out?.token?.symbol || ''), `${a.out?.token?.symbol} $${a.out?.price_usd}`);
const b = await call(`${SITE}/mcp`, 'get_token_price', {});
pin('get_token_price without a token answers $BOBAI and says so, the right name included', !b.isError && b.out?.answered_as === 'bobai_price' && b.out?.price_usd > 0 && /bobai_price/.test(b.out?.note || ''), b.out?.note);
const c = await call(`${SITE}/mcp`, 'get_token_price', { symbol: 'CAKE' });
pin('a symbol without an address is not guessed: the tools to use are named', c.isError || /Unknown tool/.test(c.text) ? /bsc_token_preflight/.test(c.text) : false, c.text);
const d = await call(`${SITE}/mcp`, 'get_price_of_token', { token: BOBAI });
pin("$BOBAI's own address answers bobai_price", !d.isError && d.out?.answered_as === 'bobai_price', d.out?.answered_as);
const e = await call(`${SITE}/mcp`, 'make_coffee', {});
pin('a name without "price" is still an unknown tool with the closest ones', /Unknown tool/.test(e.text), e.text);
if (SITE === 'https://brainonbnb.com') {
  const f = await call('https://agent.brainonbnb.com/health-factor/mcp', 'get_price_of_token', { address: CAKE });
  pin('an agent door passes get_price_of_token to the site and answers the price', !f.isError && f.out?.price_usd > 0 && /brainonbnb\.com\/mcp/.test(f.out?.from || ''), `${f.out?.token?.symbol} $${f.out?.price_usd}`);
}
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exitCode = bad ? 1 : 0;
