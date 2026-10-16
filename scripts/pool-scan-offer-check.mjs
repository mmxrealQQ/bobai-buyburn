#!/usr/bin/env node
// scripts/pool-scan-offer-check.mjs — the free pool scan ends with the paid pool watch on that pool (2026-10-15)
//
// The pool scan is the tool other agents call most, and it was all free. Its reading stays as it was; for a pool that
// can be priced, `watch_this_pool` follows with the watch filled in (this token, half today's 1% depth). This checks:
// REST and MCP carry the offer with the scanned token and the depth from the reading itself, the reading's own fields
// are all still there, the site's own pages get the reading alone, and the offer's request really opens a purchase
// (HTTP 402 naming the watch).
//
//   node scripts/pool-scan-offer-check.mjs [base]     (default https://brainonbnb.com)   exit 1 on any FAIL
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
const FIELDS = ['address', 'quotable', 'price', 'pool', 'tradeCost', 'onePercentDepth', 'sellability', 'tax', 'lp'];
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const offerOk = (j) => {
  const w = j?.watch_this_pool, depth = Number(j?.onePercentDepth?.buyUsd), want = depth > 0 ? Math.max(50, Math.round(depth / 2 / 10) * 10) : 1000;
  return !!w && w.buy?.url === 'https://agent.brainonbnb.com/watch' && String(w.buy?.body?.token).toLowerCase() === CAKE.toLowerCase() && w.buy.body.depthBelowUsd === want && /\$BOBAI/.test(w.price);
};
{
  const j = await (await fetch(`${BASE}/api/pool-scan?address=${CAKE}`, { headers: { accept: 'application/json' } })).json().catch(() => null);
  check(offerOk(j), 'REST: the scan ends with the watch on this pool, filled in', j?.watch_this_pool ? `depthBelowUsd ${j.watch_this_pool.buy?.body?.depthBelowUsd} (1% depth ${j.onePercentDepth?.buyUsd})` : 'no watch_this_pool');
  check(!!j && FIELDS.every((f) => f in j), 'REST: the reading itself is whole', FIELDS.filter((f) => !(j && f in j)).join(', ') || 'all fields');
}
{
  const r = await (await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bsc_pool_scan', arguments: { address: CAKE } } }) })).json().catch(() => null);
  const s = r?.result?.structuredContent || (() => { try { return JSON.parse(r?.result?.content?.[0]?.text); } catch { return null; } })();
  check(offerOk(s), 'MCP bsc_pool_scan: the same offer', s?.watch_this_pool ? 'present' : 'missing');
}
{
  const j = await (await fetch(`${BASE}/api/pool-scan?address=${CAKE}`, { headers: { accept: 'application/json', referer: 'https://brainonbnb.com/scanner' } })).json().catch(() => null);
  check(!!j && j.quotable && !j.watch_this_pool, 'the site\'s own scanner page gets the reading alone', j?.watch_this_pool ? 'offer shown on our own page' : 'no offer');
}
{
  const body = { token: CAKE, depthBelowUsd: 1000, callback: 'https://example.com/hook' };
  const r = await fetch('https://agent.brainonbnb.com/watch', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' }, body: JSON.stringify(body) });
  const t = await r.json().catch(() => ({}));
  check(r.status === 402 && /depth/i.test(t.what || '') && t.in_bobai?.tokens > 0, 'the offer\'s request opens the purchase (402, the watch, the $BOBAI price)', `${r.status} ${String(t.what || t.error || '').slice(0, 60)}`);
}
// THE OFFER AS IT ARRIVES (2026-10-16). The check above sent a body of its own, with a real callback — the offer's own
// body carried 'https://<your endpoint>', which the watch refuses, and named no pair, so the watch took the token's
// V2 pair with WBNB: on CAKE another pool than the one scanned, on a V3 market (ETH) a V2 pair at a V3 threshold.
// Now the offer's body is sent exactly as given: it has to open the purchase on the very pool the scan read, and a
// market the watch cannot read (V3) gets no offer at all.
// The same day the watch learned PancakeSwap V3 (worker-agent/v3-depth.js): ETH's V3 pool is offered too, and the
// depth the watch reads (would_watch.depth_now_usd, by the sweep's own function) is the scan's 1% depth — within 5%,
// as the two reads are a few blocks apart. V2 shows the same within its own measure (reserve × (√1.01 − 1)).
const ETH = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
for (const [label, addr] of [['CAKE (V2 · BNB)', CAKE], ['ETH (PancakeSwap V3)', ETH]]) {
  const j = await (await fetch(`${BASE}/api/pool-scan?address=${addr}`, { headers: { accept: 'application/json', 'user-agent': 'bobai-smoke-test' } })).json().catch(() => null);
  const body = j?.watch_this_pool?.buy?.body;
  const watchable = j?.pool?.kind === 'v2' || (j?.pool?.kind === 'v3' && j?.pool?.venue === 'PancakeSwap V3');
  if (!watchable) { check(!!j && !body, `${label}: a pool the watch cannot read gets no offer`, body ? `offer on a ${j?.pool?.kind} pool` : `${j?.pool?.kind}, no offer`); continue; }
  if (!body) { check(false, `${label}: the offer's body, as given, opens the purchase on the scanned pool`, `no offer on a ${j?.pool?.kind} pool`); continue; }
  const r = await fetch('https://agent.brainonbnb.com/watch', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' }, body: JSON.stringify(body) });
  const t = await r.json().catch(() => ({}));
  const ww = t.would_watch || {};
  check(r.status === 402 && !ww.refused && ww.pair === String(j.pool.address).toLowerCase(), `${label}: the offer's body, as given, opens the purchase on the scanned pool`, ww.refused ? `refused: ${ww.refused}` : `${r.status} watches ${ww.pair} · scanned ${String(j.pool.address).toLowerCase()}`);
  const scanD = Number(j.onePercentDepth?.buyUsd), watchD = Number(ww.depth_now_usd);
  check(scanD > 0 && watchD > 0 && Math.abs(watchD / scanD - 1) < 0.05, `${label}: the watch reads the depth the scan reported`, `watch $${watchD} · scan $${scanD}`);
}
console.log(`pool-scan-offer: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
