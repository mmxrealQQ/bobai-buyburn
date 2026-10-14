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
console.log(`x402-noinput: ${4 - fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
