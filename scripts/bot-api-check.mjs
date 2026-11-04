// THE REST TOOLS EXPLAIN THEMSELVES TO A BOT (2026-11-04, operator: "trading bots")
// /api/ listed bare route names; nothing told a bot builder what to send. Now /api/ carries, per trading route, one
// line, its parameters, a real example and the limits, and /openapi.json is the same as OpenAPI 3.1. This walks it the
// way a bot would: read /api/, call every example, read /openapi.json. Our UA (brainonbnb-*) so it counts as own.
//   node scripts/bot-api-check.mjs [base=https://brainonbnb.com]
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const H = { 'user-agent': 'brainonbnb-bot-api-check' };
let bad = 0;
const pin = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const get = (u) => fetch(u, { headers: H, signal: AbortSignal.timeout(60000) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch(() => ({ status: 0, body: null }));
// a live example names brainonbnb.com; on a preview the same path is called there
const onBase = (u) => u.replace('https://brainonbnb.com', BASE);

const idx = await get(`${BASE}/api/`);
const tr = idx.body?.trading || [];
pin('/api/ answers 200 with the trading routes', idx.status === 200 && tr.length === 5, `${tr.length} routes`);
pin('/api/ says how to start (preflight, branch on gate)', /preflight/.test(idx.body?.start || '') && /gate/.test(idx.body?.start || ''));
pin('/api/ names the limits: no key, pool-scan alone counts, the day pass', /no key/.test(idx.body?.limits?.key || '') && /pool-scan alone/.test(idx.body?.limits?.free || '') && /X-Scan-Pass/.test(idx.body?.limits?.day_pass || ''));
pin('every trading route has one short line (under 200 characters)', tr.length > 0 && tr.every((t) => t.does && t.does.length < 200));
pin('every trading route names address as required', tr.length > 0 && tr.every((t) => t.params?.some((p) => p.name === 'address' && p.required)));
for (const t of tr) {
  const r = await get(onBase(t.example));
  const ok = r.status === 200 && r.body && !r.body.error && (t.path !== '/api/preflight' || ['stop', 'weigh', 'no_known_stop'].includes(r.body.gate));
  pin(`the example of ${t.path} answers a measurement`, ok, `${r.status}${r.body?.error ? ' ' + String(r.body.error).slice(0, 80) : ''}${t.path === '/api/preflight' ? ' gate ' + r.body?.gate : ''}`);
}
const oa = await get(`${BASE}/openapi.json`);
const paths = Object.keys(oa.body?.paths || {});
pin('/openapi.json is OpenAPI 3.1 with the five trading routes', oa.status === 200 && oa.body?.openapi === '3.1.0' && paths.length === 5, `${oa.status} ${oa.body?.openapi} ${paths.length}`);
pin('every OpenAPI route has an operationId, a required address and an example', paths.length > 0 && paths.every((p) => { const g = oa.body.paths[p].get; return g.operationId && g.parameters.some((x) => x.name === 'address' && x.required) && g['x-example']; }));
pin('only pool-scan documents the day pass header and the 402', paths.length > 0 && paths.every((p) => { const g = oa.body.paths[p].get, scan = p === '/api/pool-scan'; return scan === g.parameters.some((x) => x.name === 'X-Scan-Pass') && scan === !!g.responses[402]; }));
const bad404 = await get(`${BASE}/api/nope`);
pin('an unknown /api/ path is still a 404 with the routes', bad404.status === 404 && Array.isArray(bad404.body?.routes));
const llms = await fetch(`${BASE}/llms.txt`, { headers: H }).then((r) => r.text()).catch(() => '');
pin('llms.txt points a bot builder to /api/ and /openapi.json', /Building a trading bot\?/.test(llms) && llms.includes('/openapi.json'));
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exitCode = bad ? 1 : 0;
