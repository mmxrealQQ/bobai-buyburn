#!/usr/bin/env node
// Pins the /registry (Brain Plaza) category section against the six changes
// of 2026-10-09, on the generated page and on the classifier behind it and
// behind /find. Offline: reads dashboard/registry.html (or the file given) and
// imports worker-agent/categories.js. Run by scripts/self-tests.mjs (the name
// ends in -regressions).
//
//   node scripts/registry-regressions.mjs                  the page as built
//   node scripts/registry-regressions.mjs <file.html>      another build, e.g.
//        git show HEAD~1:dashboard/registry.html > old.html — an older page
//        must FAIL here, which is how each check was shown to see something.
//
// 1 quotes   three answers (Quotes / Answers… / Did not answer), never the old
//            single "No price when asked"; red rows carry a muted "Try anyway";
//            within a list the answers come in that order.
// 2 category Pretium #126728, HyperliquidVault #338253 and Moments #116171 are
//            not in the yield list (folded under "possibly related" at most);
//            classifyAgent fixtures for the loose-word rule.
// 3 leader   every category opens with one "Best evidence: <first other
//            operator's row>" sentence, or says there is none.
// 4 phone    every card outside a fold has proven itself (quotes, paid out) or
//            is ours; the rest are folded.
// 5 hero     the "actually answer" share names the scanned total and its date.
// 6 recency  hire chips say "last delivery …" with a unix-seconds timestamp.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
// --categories <file>: run the classifier fixtures against another copy of
// categories.js (git show HEAD~1:worker-agent/categories.js > old.js).
const catArg = argv.includes('--categories') ? argv[argv.indexOf('--categories') + 1] : null;
const { classifyAgent } = await import(catArg ? pathToFileURL(path.resolve(catArg)).href : '../worker-agent/categories.js');
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--categories') || path.join(ROOT, 'dashboard', 'registry.html');
const html = fs.readFileSync(file, 'utf8');
const fails = [];
const ok = [];
const check = (name, pass, why) => (pass ? ok.push(name) : fails.push(`${name}: ${why}`));

// Category boxes, each with its articles and the folds around each article.
const boxes = [...html.matchAll(/<div class="rg-box" id="cat-([a-z-]+)">([\s\S]*?)GET \/find\?category=/g)].map(([, id, body]) => {
  const arts = [];
  const stack = [];
  const re = /<details class="([^"]*)"|<\/details>|<article class="([^"]*)"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[0].startsWith('<details')) stack.push(m[1]);
    else if (m[0] === '</details>') stack.pop();
    else {
      const t = m[0];
      arts.push({
        html: t,
        ours: /\brg-ours\b/.test(m[2]),
        folds: [...stack],
        label: ((t.match(/<b>([^<]*)<\/b>/) || [])[1] || '').trim(),
        id: (t.match(/data-hire="(\d+)"/) || [])[1] || null,
        quote: /class="rgc-yes"/.test(t) ? 0 : /class="rgc-input"/.test(t) ? 1 : /class="rgc-no"/.test(t) ? 2 : null,
        paid: /(\d[\d,]*) paid out/.test(t) && Number(t.match(/(\d[\d,]*) paid out/)[1].replace(/,/g, '')) > 0,
      });
    }
  }
  return { id, body, arts };
});
check('page has the four categories', boxes.length === 4, `${boxes.length} category boxes found`);

// 1 quote states
{
  const all = boxes.flatMap((b) => b.arts);
  const old = (html.match(/No price when asked/g) || []).length;
  const amber = all.filter((a) => a.quote === 1).length;
  const redNoTry = all.filter((a) => a.quote === 2 && !/rg-hire-muted[^>]*>Try anyway/.test(a.html)).map((a) => a.label);
  const tryOnGreen = all.filter((a) => a.quote !== 2 && /Try anyway/.test(a.html)).map((a) => a.label);
  let order = [];
  for (const b of boxes) {
    for (const list of [b.arts.filter((a) => !a.ours && !a.folds.length), b.arts.filter((a) => !a.ours && a.folds.includes('rgc-more'))]) {
      const qs = list.map((a) => (a.quote == null ? 2 : a.quote));
      for (let i = 1; i < qs.length; i++) if (qs[i] < qs[i - 1]) order.push(`${b.id}: ${list[i].label} after ${list[i - 1].label}`);
    }
  }
  check('1 quotes: no single red "No price when asked"', old === 0, `${old} times on the page`);
  check('1 quotes: amber "Answers…" state exists', amber > 0, 'no rgc-input chip');
  check('1 quotes: every "Did not answer" card offers a muted "Try anyway"', !redNoTry.length && all.some((a) => a.quote === 2), redNoTry.length ? redNoTry.join(', ') : 'no red card at all');
  check('1 quotes: "Try anyway" only on red cards', !tryOnGreen.length, tryOnGreen.join(', '));
  check('1 quotes: quotes > structured input > no answer, per list', !order.length, order.slice(0, 4).join('; '));
}

// 2 wrong categories
{
  const y = boxes.find((b) => b.id === 'yield-optimization');
  const wrong = ['126728', '338253', '116171'];
  const listed = (y?.arts || []).filter((a) => wrong.includes(a.id) && !a.folds.includes('rgc-maybe')).map((a) => `${a.label} #${a.id}`);
  check('2 category: Pretium, HyperliquidVault, Moments not in the yield list', y && !listed.length, listed.join(', ') || 'no yield box');
  const fixtures = [
    // [what, agent, category, expected: 'in' | 'weak' | 'out']
    ['Pretium (fiat payouts, "APY" in tool names)', { name: 'Pretium', description: 'Pay with stablecoins powered by AI agents.', skills: ['Agent Fiat Payout', 'Agent Earn APY'], tools: [{ name: 'get_available_apys', description: 'Top Aave V3 supply APYs on Celo, Base, BNB' }] }, 'yield-optimization', 'weak'],
    ['Moments (trading; yield words only in strategy names)', { name: 'Moments', description: 'Autonomous trading agent. AI agent for autonomous DeFi trading on BNB Chain.', skills: ['USDD Yield Vault', 'Leveraged Yield Loop', 'Venus Fixed Vault'] }, 'yield-optimization', 'weak'],
    ['HyperliquidVault (another chain)', { name: 'HyperliquidVault', description: "Hyperliquid Vault Strategy Intelligence: a vault's TVL, APR", tools: [{ name: 'list_vaults' }] }, 'yield-optimization', 'weak'],
    ['Sluicegate ("net APR" on BNB Smart Chain)', { name: 'Sluicegate', description: 'Routes idle stablecoins on BNB Smart Chain by NET APR at your size', skills: ['Net APR at a stated size'] }, 'yield-optimization', 'in'],
    ['Tidemark (two loose hits, own description, BNB Chain)', { name: 'Tidemark', description: 'Measures the yield BNB Chain venues actually paid', skills: ['Realised yield over a trailing window'] }, 'yield-optimization', 'in'],
    ['Hevo Yield (name only) without a quote', { name: 'Hevo Yield', description: 'ERC-8183 seller agent (hevoyield-agent) — negotiate + notify_funded over A2A.' }, 'yield-optimization', 'weak'],
    ['Hevo Yield (name only) that quoted for yield', { name: 'Hevo Yield', description: 'ERC-8183 seller agent', quoted_for: ['yield-optimization'] }, 'yield-optimization', 'in'],
    ['Grid Agent 3 (one loose word)', { name: 'Grid Agent 3' }, 'grid-trading', 'weak'],
    ['Health Factor Monitor (strong, unchanged)', { name: 'Health Factor Monitor' }, 'health-factor', 'in'],
    ['a "yield" in prose only files nothing', { name: 'Agent X', description: 'yield yield on BNB' }, 'yield-optimization', 'out'],
  ];
  const bad = [];
  for (const [what, agent, cat, want] of fixtures) {
    const plain = classifyAgent(agent).find((m) => m.category === cat);
    const withWeak = classifyAgent(agent, null, { withWeak: true }).find((m) => m.category === cat);
    const got = plain ? (plain.weak ? 'LEAK' : 'in') : withWeak?.weak ? 'weak' : withWeak ? 'LEAK' : 'out';
    if (got !== want) bad.push(`${what}: ${got}, expected ${want}`);
  }
  check('2 category: classifyAgent loose-word rule (fixtures; /find calls it without withWeak)', !bad.length, bad.join('; '));
}

// 3 leader line
{
  const bad = [];
  for (const b of boxes) {
    const lead = (b.body.match(/<p class="rg-catlead">([\s\S]*?)<\/p>/) || [])[1];
    const first = b.arts.find((a) => !a.ours && !a.folds.includes('rgc-maybe'));
    if (!lead) { bad.push(`${b.id}: no leader line`); continue; }
    if (first && !lead.includes(`Best evidence: ${first.label}</b>`)) bad.push(`${b.id}: leader line does not name ${first.label}`);
    if (!first && !/No other operator/.test(lead)) bad.push(`${b.id}: no other operator's row, and the line does not say so`);
  }
  check('3 leader: one "Best evidence" sentence per category, naming the first other operator\'s row', !bad.length, bad.join('; '));
}

// 4 phone length
{
  const bad = [];
  let open = 0, total = 0;
  for (const b of boxes) {
    for (const a of b.arts) {
      total++;
      if (a.folds.length) continue;
      open++;
      if (!(a.ours || a.quote === 0 || a.paid)) bad.push(`${b.id}: ${a.label}`);
    }
  }
  check(`4 phone: cards outside a fold are proven or ours (${open} of ${total} open)`, !bad.length && open < total, bad.length ? `${bad.length} unproven open: ${bad.slice(0, 4).join(', ')}` : 'nothing folded');
}

// 5 hero wording
{
  const sub = (html.match(/actually answer<\/div><div class="rg-s">([^<]*)</) || [])[1] || '';
  check('5 hero: the answer share names "of the N scanned <date>"', /of the [\d,]+ scanned \d{1,2} [A-Z][a-z]{2}/.test(sub) && !/last full scan/.test(sub), JSON.stringify(sub));
}

// 6 recency
{
  const agos = [...html.matchAll(/last delivery <span class="rg-ago" data-t="(\d+)">([^<]*)<\/span>/g)];
  const badT = agos.filter(([, t]) => !(Number(t) > 1.5e9 && Number(t) < 1e10)).length;
  check('6 recency: hire chips say "last delivery N days ago" (unix seconds)', agos.length > 0 && !badT, agos.length ? `${badT} timestamps out of range` : 'no "last delivery" on the page');
}

// OURS LAST (operator's rule; found 2026-10-09: ours sat above the other operators' folded cards)
{
  const bad = [...html.matchAll(/<div class="rg-box" id="cat-([a-z-]+)">([\s\S]*?)GET \/find\?category=/g)]
    .filter(([, , body]) => { const fold = body.lastIndexOf('rgc-more'), ours = body.indexOf('rg-ours'); return fold >= 0 && ours >= 0 && ours < fold; })
    .map(([, id]) => id);
  check('7 ours last: no own card above another operator’s folded card', !bad.length, `ours above the fold in ${bad.join(', ')}`);
}

for (const n of ok) console.log(`  ok    ${n}`);
for (const f of fails) console.log(`  FAIL  ${f}`);
if (fails.length) {
  console.error(`\nregistry regressions FAILED (${fails.length}) on ${path.relative(ROOT, file) || file}`);
  process.exit(1);
}
console.log(`registry regressions: ${ok.length}/${ok.length} pass`);
