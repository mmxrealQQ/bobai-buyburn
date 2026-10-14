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
console.log(`x402-noinput: ${2 - fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
