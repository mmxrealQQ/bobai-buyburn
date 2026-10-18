#!/usr/bin/env node
// scripts/listing-open-check.mjs — the agent listing is open (operator, 2026-10-18: "ja listing freischalten")
//
// Hidden since 12.10. (75ec392: /list 302 -> /registry, out of the sitemap, llms.txt and the routes) until the agent chart
// was built. Open now: /list serves its page, the sitemap and llms.txt name it, the routes carry it (it opens in a window
// too), the Plaza's "Featured (paid)" strip shows with its link even before the first paid listing (our own agents never
// fill it), and the listing path answers as the page promises — the check, a quote in each of the three currencies to
// the project wallet at $95, the listing record. Nothing is paid or signed here.
//
//   node scripts/listing-open-check.mjs        exit 1 on any FAIL
const SITE = 'https://brainonbnb.com', AGENT = 'https://agent.brainonbnb.com';
const PAYEE = '0x5c82d2f12ee6ac09297784f94ebf9331277bdc3c';
const OUTSIDE = '269223';   // an outside agent that answers A2A (Portfolio Rebalancer, chainhelix), checked 18.10.
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`); };
const bust = () => `r=${Date.now()}${Math.random().toString(16).slice(2, 6)}`;

{
  const r = await fetch(`${SITE}/list?${bust()}`, { redirect: 'manual' });
  const t = r.status === 200 ? await r.text() : '';
  check(r.status === 200 && /\$95 once/.test(t) && /never for sale/.test(t), '/list serves the listing page (no redirect)', `${r.status} ${r.headers.get('location') || ''}`);
  const sm = await (await fetch(`${SITE}/sitemap.xml?${bust()}`)).text();
  check(sm.includes('<loc>https://brainonbnb.com/list</loc>'), 'the sitemap names /list');
  const llms = await (await fetch(`${SITE}/llms.txt?${bust()}`)).text();
  check(/List an agent you built and keep running on Brain Plaza: https:\/\/brainonbnb\.com\/list — \$95 once/.test(llms), 'llms.txt names /list and its price');
  const reg = await (await fetch(`${SITE}/registry?${bust()}`)).text();
  check(/No paid listing yet\. Yours could be the first\./.test(reg) && /href="\/list">List your agent/.test(reg) && !/strip\.remove\(\);return\} \/\/ only paid listings/.test(reg), 'the Plaza strip shows with its /list link before the first paid listing');
}
{
  const c = await (await fetch(`${AGENT}/listing/check?agent=${OUTSIDE}`)).json().catch(() => ({}));
  check(c.ok === true && c.answers?.ok, `the check passes an outside agent that answers (#${OUTSIDE})`, c.reasons?.join('; ') || c.name);
  const ours = await (await fetch(`${AGENT}/listing/check?agent=363709`)).json().catch(() => ({}));
  check(ours.ok === false && /own agents/.test((ours.reasons || []).join(' ')), 'our own agent cannot take the paid path', (ours.reasons || []).join('; '));
  for (const cur of ['usd1', 'bnb', 'bobai']) {
    const q = await (await fetch(`${AGENT}/listing/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: OUTSIDE, currency: cur }) })).json().catch(() => ({}));
    check(String(q.pay?.to).toLowerCase() === PAYEE && BigInt(q.pay?.amount_atomic || 0) > 0n && /Brain Plaza listing/.test(q.sign || ''), `a quote in ${cur} pays the project wallet`, q.pay?.label || q.error);
  }
  const L = await (await fetch(`${AGENT}/listings`)).json().catch(() => ({}));
  check(L.price_usd === 95 && String(L.pays_to).toLowerCase() === PAYEE && (L.listings || []).every((x) => !x.house || x.paid?.currency === 'house'), '/listings: $95, the project wallet, our own marked as not paid', `${(L.listings || []).length} listed, ${(L.listings || []).filter((x) => !x.house).length} paid`);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
