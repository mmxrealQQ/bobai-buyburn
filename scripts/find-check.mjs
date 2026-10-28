// /find, as a stranger hiring through it reads it (2026-10-27, the Plaza stranger test: "maybe — /find gives no price and
// no hireable flag, a fleet takes four places, my agent cannot choose from /find alone"). Offline, against the census
// file the worker reads (dashboard/api-agents.json):
//   FC1 every result carries escrow: the answer when last asked for a price (quotes / input / none / not asked)
//   FC2 hireable=1 keeps only agents that answered with a price, and says so
//   FC3 one fleet (the same name on the same host) stands once, the others named under fleet
//   FC4 a question that names a category does not put an agent outside it ahead of one inside it on equal words
//   node scripts/find-check.mjs [--file worker-agent/find.next.js]
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const fi = process.argv.indexOf('--file');
const FILE = path.join(ROOT, fi > 0 ? process.argv[fi + 1] : 'worker-agent/find.js');
const data = fs.readFileSync(path.join(ROOT, 'dashboard', 'api-agents.json'), 'utf8');
globalThis.fetch = async () => new Response(data, { headers: { 'content-type': 'application/json' } });
const { handleFind } = await import(pathToFileURL(FILE).href);
let pass = 0, fail = 0;
const is = (name, ok, why = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !why ? '' : ' — ' + why}`); };
const find = async (qs) => (await handleFind(new URL('https://agent.brainonbnb.com/find?' + qs))).body;

const hf = await find('q=' + encodeURIComponent('check the health factor of my Venus position'));
is('FC1 every result carries escrow with an answer (quotes / input / none / not asked)', hf.results.length > 0 && hf.results.every((r) => r.escrow && ['quotes', 'input', 'none', 'not asked'].includes(r.escrow.answer)), JSON.stringify(hf.results.map((r) => r.escrow?.answer)));
is('FC1b a quoting result names its price and the day it was asked; an input one says what it wanted', hf.results.filter((r) => r.escrow?.answer === 'quotes').every((r) => r.escrow.price && r.escrow.asked_at) && hf.results.filter((r) => r.escrow?.answer === 'input').every((r) => r.escrow.said));
const hq = await find('q=grid&hireable=1');
is('FC2 hireable=1 keeps only agents that answered with a price, and says so', hq.results.length > 0 && hq.results.every((r) => r.escrow?.answer === 'quotes') && /hireable=1/.test(hq.only || ''), JSON.stringify({ n: hq.results.length, only: hq.only }));
const gr = await find('q=' + encodeURIComponent('plan a grid for a token') + '&limit=25');
const key = (r) => { let h = ''; try { h = new URL((r.endpoints || [])[0]).hostname.replace(/^www\./, ''); } catch {} return `${String(r.name).trim().toLowerCase()}|${h}`; };
const keys = gr.results.map(key);
is('FC3 one fleet stands once: no two results share a name and a host, and a collapsed one names the others', new Set(keys).size === keys.length && gr.results.some((r) => r.fleet && r.fleet.size > 1 && r.fleet.other_ids.length === r.fleet.size - 1), JSON.stringify(keys.filter((k, i) => keys.indexOf(k) !== i)));
const lp = gr;   // the stranger's own question
const idx = (id) => lp.results.findIndex((r) => r.id === id);
// Lattice (#341554, Marque's grid reference) is filed under grid; the check wants every agent ahead of it filed there too
const { classifyAgent } = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'categories.js')).href);
const agents = JSON.parse(data).agents;
const filed = (id) => classifyAgent(agents.find((a) => a.id === id) || {}).some((m) => m.category === 'grid-trading');
const ahead = lp.results.slice(0, Math.max(0, idx(341554))).filter((r) => !filed(r.id));
is('FC4 "plan a grid for a token": nobody outside grid trading stands ahead of Lattice (#341554, filed there)', idx(341554) >= 0 && !ahead.length, `Lattice at ${idx(341554) + 1}; ahead and not grid: ${ahead.map((r) => r.id).join(',')}`);
// FC5/FC6 (2026-10-28): "Grid Agent 1/2/3 by 4LPHA" still took three places, and 4lpha.tech ten of 25 for "grid"
const hostOf = (r) => { try { return new URL((r.endpoints || [])[0]).hostname.replace(/^www\./, ''); } catch { return ''; } };
const numless = gr.results.map((r) => `${String(r.name).trim().toLowerCase().replace(/\d+/g, '#')}|${hostOf(r)}`);
is('FC5 a numbered fleet stands once: no two results share a host and a name that differs only in its numbers', new Set(numless).size === numless.length, JSON.stringify(numless.filter((k, i) => numless.indexOf(k) !== i)));
const SHARED = /(^|\.)amazonaws\.com$/;
const spread = (res) => { const n = new Map(); const nth = res.map((r) => { const h = hostOf(r); const k = h && !SHARED.test(h) ? h : `#${r.id}`; n.set(k, (n.get(k) || 0) + 1); return n.get(k); });
  const firstThird = nth.findIndex((x) => x > 2); return firstThird < 0 || nth.slice(firstThird).every((x) => x > 2); };
for (const q of ['grid', 'plan a grid for a token', 'grid trading bot']) {
  const r = await find('q=' + encodeURIComponent(q) + '&limit=25');
  is(`FC6 "${q}": no host's third result stands ahead of another operator's first or second`, spread(r.results), r.results.map((x) => hostOf(x).slice(0, 14)).join(' '));
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
