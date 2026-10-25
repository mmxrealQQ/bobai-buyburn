// EVERY 402 WE SEND PASSES THE x402 SCHEMA (2026-10-25). Marque read our 402 as "bad_schema": two of the five
// payment options (the direct transfers in USD1 and $BOBAI) had no maxTimeoutSeconds, which x402 requires in v2 and
// v1, and four had no mimeType (v1). A strict client drops the whole 402 over one bad entry. This asks every paid door
// for its terms the way a client does and checks each accepts[] entry for the fields both versions require.
// usage: node scripts/x402-schema-check.mjs [base]   — read only, nothing is paid; exit 1 on any FAIL
const BASE = process.argv[2] || 'https://agent.brainonbnb.com';
const UA = { 'user-agent': 'bobai-smoke-test' }; // not counted as a buyer
const V2 = ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds'];
const V1 = ['scheme', 'network', 'maxAmountRequired', 'resource', 'description', 'mimeType', 'payTo', 'maxTimeoutSeconds', 'asset'];
const doors = [
  ...['health_factor', 'yield_plan', 'grid_plan', 'rebalance_plan', 'lp_tier_plan', 'lp_position_plan'].flatMap((s) => [['GET', `/answer?service=${s}`], ['POST', `/answer?service=${s}`]]),
  ['POST', '/watch'], ['POST', '/scan-pass'], ['POST', '/tip?usd=1'],
];
let fails = 0;
const pin = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };
for (const [method, path] of doors) {
  const r = await fetch(BASE + path, { method, headers: { ...UA, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) }).catch(() => null);
  const h = r && r.headers.get('payment-required');
  let pr = null; try { pr = JSON.parse(Buffer.from(h || '', 'base64').toString()); } catch {}
  if (!r || r.status !== 402 || !pr) { pin(false, `${method} ${path}: a 402 with PAYMENT-REQUIRED (${r ? r.status : 'no answer'})`); continue; }
  const bad = (pr.accepts || []).map((a, i) => {
    const miss = [...new Set([...V2, ...V1])].filter((k) => a[k] == null || a[k] === '');
    const num = ['maxTimeoutSeconds'].filter((k) => a[k] != null && !(Number.isInteger(a[k]) && a[k] > 0));
    return miss.length || num.length ? `#${i} ${a.extra?.assetTransferMethod || '?'} ${String(a.asset).slice(0, 8)} missing ${miss.join(',')}${num.length ? ' bad ' + num.join(',') : ''}` : null;
  }).filter(Boolean);
  pin(pr.x402Version === 2 && pr.accepts?.length > 0 && !bad.length && pr.resource?.url, `${method} ${path}: ${pr.accepts?.length || 0} options, every one complete${bad.length ? ' — ' + bad.join(' | ') : ''}`);
}
console.log(fails ? `${fails} FAIL` : 'all pins hold');
process.exitCode = fails ? 1 : 0;
