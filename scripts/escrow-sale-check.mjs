// THE SET AND EARN PRICE (2026-10-27, operator's go: "Preis auf 0.01 bis 5.11."): every escrow quote is 0.01 $U until
// 5 Nov 2026 12:00 UTC and 0.10 after it, by itself; a job owes the price of the hour its quote was signed, so a quote
// signed in the sale and delivered after it is still delivered, and one signed after it at the sale price is not.
//   node scripts/escrow-sale-check.mjs           the rules, offline
//   node scripts/escrow-sale-check.mjs --live    and a real quote from each of our endpoints names the price of today
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const S = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'sell.js')).href);
let pass = 0, fail = 0;
const is = (name, ok, why = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !why ? '' : ' — ' + why}`); };

const END = Date.UTC(2026, 10, 5, 12) / 1000, SALE = 10n ** 16n, BASE = 10n ** 17n;
is('ES1 the sale ends 5 Nov 2026 12:00 UTC', S.SALE_UNTIL === END, String(S.SALE_UNTIL));
is('ES2 a minute before the end it is 0.01 $U, at the end and after it 0.10 $U', S.escrowWei(END - 60) === SALE && S.escrowWei(END) === BASE && S.escrowWei(END + 86400) === BASE);
const sale = S.onSale();
const want = sale ? SALE : BASE;
const svc = Object.values(S.SERVICES);
is(`ES3 every service quotes the price of today (${sale ? '0.01, the sale' : '0.10'}), its own copy too`, svc.every((s) => BigInt(s.price) === want && BigInt({ ...s }.price) === want), svc.map((s) => s.price).join(','));
is('ES4 while the sale runs the shown price names its end, so a page built today stays true after it', svc.every((s) => (sale ? /^0\.01 \S+ \(until 5 Nov 12:00 UTC, then 0\.10\)$/ : /^0\.10 \S+$/).test(s.price_display)), svc.map((s) => s.price_display).join(' | '));
const desc = (t) => JSON.stringify({ chain_id: 56, negotiated_at: t, price: '10000000000000000' });
is('ES5 a job whose quote was signed in the sale owes 0.01, even delivered after it', S.dueFor(desc(END - 3600), END + 7 * 86400) === SALE);
is('ES6 a job whose quote was signed after the sale owes 0.10 — 0.01 does not buy it', S.dueFor(desc(END + 60), END + 120) === BASE);
is('ES7 a description with no signed hour owes the price of now', S.dueFor('plain words, no quote', END - 60) === SALE && S.dueFor('plain words, no quote', END + 60) === BASE);

if (process.argv.includes('--live')) {
  const ask = (url, task) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'brainonbnb-test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: 'es', parts: [{ kind: 'data', data: { skill: 'negotiate-erc8183-job', task_description: task, terms: { deliverables: 'the standard deliverable', quality_standards: 'measured on chain' } } }] } } }) })
    .then((r) => r.json()).then((j) => { const p = j.result?.parts || []; const d = (p.find((x) => x.kind === 'data') || {}).data || {}; const c = d.content ? JSON.parse(d.content) : d; return d.response?.terms?.price ?? c.price ?? d.price ?? null; }).catch(() => null);
  for (const [name, url, task] of [['shared endpoint (health factor)', 'https://agent.brainonbnb.com/a2a', 'Venus health factor of my wallet'], ['DeFi agent', 'https://agent.brainonbnb.com/defi-agent/a2a', 'the DeFi agent on my PancakeSwap V3 position'], ['grid planner', 'https://agent.brainonbnb.com/grid-trader/a2a', 'Quote your standard deliverable']]) {
    const p = await ask(url, task);
    is(`ESL live: the ${name} signs ${sale ? '0.01' : '0.10'} $U today`, p != null && BigInt(p) === want, String(p));
  }
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
