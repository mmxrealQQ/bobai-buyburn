// A HIRE BUTTON THAT NAMES NOTHING (2026-10-14). Mandate's "Hire for $0.10" pays over x402 and sends no words: the
// DeFi agent answered 422 "needs `position`" before looking at the payment, so the hire never happened (Mandate's
// page: "Refused a payment Mandate paid", eight times). Now the paying wallet is the input (lpDefaultTarget).
// This sends the paid request with NO input and a payment that cannot settle (a zero signature — no money moves),
// for the DeFi agent and the health factor, and passes when the answer is about the PAYMENT, not the missing input.
// usage: node scripts/x402-noinput-check.mjs [base=https://agent.brainonbnb.com]   exit 1 on any FAIL
const BASE = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const PAYER = '0xfceafec082f9e8b17cdb51f33c3d5c9759a25e03'; // a stranger's wallet from job 56955 — nothing is signed for it
let fail = 0;
for (const service of ['lp_position_plan', 'health_factor']) {
  const terms = await fetch(`${BASE}/answer?service=${service}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const t = await terms.json().catch(() => ({}));
  const acc = (t.accepts || [])[0] || {};
  const payload = { x402Version: 1, scheme: 'exact', network: acc.network || 'bsc', payload: {
    signature: '0x' + '00'.repeat(65),
    authorization: { from: PAYER, to: acc.payTo || acc.pay_to, value: String(acc.maxAmountRequired || acc.amount || '100000000000000000'), validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: '0x' + '11'.repeat(32) } } };
  const r = await fetch(`${BASE}/answer?service=${service}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': Buffer.from(JSON.stringify(payload)).toString('base64') }, body: '{}' });
  const b = await r.json().catch(() => ({}));
  const aboutInput = r.status === 422 && /needs/.test(String(b.error || ''));
  const ok = terms.status === 402 && !aboutInput && r.status !== 200;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${service}: paid with no input -> ${r.status} ${String(b.error || b.reason || JSON.stringify(b)).slice(0, 140)}${aboutInput ? ' (refused for the missing input before the payment)' : ''}`);
  if (!ok) fail++;
}
// $BOBAI IS THE CHEAPER WAY TO PAY (2026-10-14): the 402 asks half the USD1 price in $BOBAI (0.05 USD worth, the
// tokens rounded up), never the full price
{
  const t = await (await fetch(`${BASE}/answer?service=yield_plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json().catch(() => ({}));
  const usd = t.in_bobai ? t.in_bobai.tokens * t.in_bobai.usd_per_bobai : null, ok = usd != null && usd >= 0.049 && usd <= 0.052;
  console.log(`${ok ? 'PASS' : 'FAIL'} an answer costs half in $BOBAI: ${t.in_bobai ? `${t.in_bobai.tokens} $BOBAI ≈ $${usd.toFixed(4)}` : 'no $BOBAI price on the 402'}`);
  if (!ok) fail++;
  // ... and says so where an x402 client or an index reads it: the $BOBAI entry in accepts[] and the GET index
  // (until 2026-10-14 both said "the same price in $BOBAI" beside a half-price amount, so nobody saw the discount)
  const bob = (t.accepts || []).find((a) => /^0x245c/i.test(a.asset || '')) || {};
  const idx = await (await fetch(`${BASE}/answer`)).json().catch(() => ({}));
  const said = /half price in \$BOBAI/.test(bob.description || '') && !/same price/.test(bob.description || '') && /half that price in \$BOBAI/.test(idx.price || '');
  console.log(`${said ? 'PASS' : 'FAIL'} the 402 entry and the index say half price: ${String(bob.description || '').split(' — ').slice(2).join(' — ').slice(0, 90) || 'no $BOBAI entry'}`);
  if (!said) fail++;
}
// THE POOL WATCH TOO (2026-10-14): its 402 offers half its USD1 price in $BOBAI (0.25 USD worth), as a direct transfer
{
  const r = await fetch(`${BASE}/watch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', depthBelowUsd: 1000 }) });
  const t = await r.json().catch(() => ({}));
  const bob = (t.accepts || []).find((a) => /^0x245c/i.test(a.asset || '')) || {};
  const usd = t.in_bobai ? t.in_bobai.tokens * t.in_bobai.usd_per_bobai : null;
  const ok = r.status === 402 && usd != null && usd >= 0.245 && usd <= 0.26 && /half price in \$BOBAI/.test(bob.description || '');
  console.log(`${ok ? 'PASS' : 'FAIL'} the pool watch costs half in $BOBAI: ${t.in_bobai ? `${t.in_bobai.tokens} $BOBAI ≈ $${usd.toFixed(4)}` : `no $BOBAI price on the 402 (${r.status})`}`);
  if (!ok) fail++;
  // and a hash that pays nothing still buys nothing (the $BOBAI door must not open the watch for free)
  const f = await fetch(`${BASE}/watch`, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': '0x' + 'ab'.repeat(32) }, body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', depthBelowUsd: 1000 }) });
  const fb = await f.json().catch(() => ({}));
  const shut = f.status !== 200 && !fb.watch;
  console.log(`${shut ? 'PASS' : 'FAIL'} a receipt that is no payment buys no watch: ${f.status} ${String(fb.reason || fb.error || '').slice(0, 90)}`);
  if (!shut) fail++;
}
// MANDATE'S CHECK, REDONE (2026-10-14): it compares "in range" and "current tick" of an answer with its own chain
// reading. The DeFi agent's free MCP tool must carry both at the top, and the tick must be the pool's slot0 tick.
{
  const MCP = BASE.replace(/\/$/, '') + '/defi-agent/mcp';
  const j = await (await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lp_position_look', arguments: {} } }) })).json().catch(() => ({}));
  const s = j.result?.structuredContent || {};
  let chainTick = null;
  if (s.pool?.address) {
    const r = await (await fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: s.pool.address, data: '0x3850c7bd' }, 'latest'] }) })).json();
    const w = BigInt('0x' + r.result.slice(66, 130)); chainTick = Number(BigInt.asIntN(24, w));
  }
  const ok = typeof s.in_range === 'boolean' && Number.isInteger(s.current_tick) && chainTick != null && Math.abs(s.current_tick - chainTick) <= 50;
  console.log(`${ok ? 'PASS' : 'FAIL'} the DeFi agent's free look carries in_range and current_tick at the top, the tick as on chain: ${s.in_range} / ${s.current_tick} vs slot0 ${chainTick}`);
  if (!ok) fail++;
}
console.log(`x402-noinput: ${7 - fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
