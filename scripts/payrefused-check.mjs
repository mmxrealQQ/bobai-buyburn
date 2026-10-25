// A PAYMENT THAT DID NOT BUY IS KEPT WITH ITS REASON (2026-10-25). On 24.10. eight payments on two answers came back
// 402 and nothing said why. This sends one payment that cannot verify (an empty x402 v1 payload, a real address as
// input), then reads GET /buys/refused: the attempt must be there with its product, status 402, the reason the paying
// path gave, our user agent and the proof's shape — and the proof itself must not be.
// usage: node scripts/payrefused-check.mjs [base]   — exit 1 on any FAIL
const BASE = process.argv[2] || 'https://agent.brainonbnb.com';
const UA = 'brainonbnb-paycheck/' + Date.now();
const PROOF = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'bsc', payload: {} })).toString('base64');
let fails = 0;
const pin = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };
const r = await fetch(`${BASE}/answer?service=health_factor`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, 'X-PAYMENT': PROOF }, body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001' }) });
pin(r.status === 402, `the unverifiable payment is refused (${r.status})`);
let rec = null;
for (let i = 0; i < 8 && !rec; i++) {
  await new Promise((s) => setTimeout(s, 1500));
  const g = await fetch(`${BASE}/buys/refused?r=${Date.now()}`).catch(() => null);
  const j = g && g.ok ? await g.json().catch(() => null) : null;
  rec = (j?.refused || []).find((x) => x.ua === UA) || null;
}
pin(!!rec, 'GET /buys/refused holds the attempt');
pin(rec?.product === 'answer:health_factor' && rec?.status === 402, `product and status kept (${rec?.product}, ${rec?.status})`);
pin(!!rec?.why && rec.why.length > 5, `the reason kept (${rec?.why})`);
pin(/^x402 v1/.test(rec?.proof || ''), `the proof's shape kept (${rec?.proof})`);
pin(!!rec && !JSON.stringify(rec).includes(PROOF), 'the proof itself is not kept');
const buys = await (await fetch(`${BASE}/buys?r=${Date.now()}`)).json().catch(() => ({}));
pin(buys.refused === `${BASE}/buys/refused` && Array.isArray(buys.payments), `/buys links the refused ones beside the payments (${buys.refused})`);
console.log(fails ?`${fails} FAIL` : 'all pins hold');
process.exitCode = fails ? 1 : 0; // not process.exit: on Windows it trips libuv while fetch handles close
