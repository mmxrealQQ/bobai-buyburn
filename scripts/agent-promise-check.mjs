#!/usr/bin/env node
// scripts/agent-promise-check.mjs — the cards, llms.txt and the agents say what the agents do (2026-10-18)
//
// Operator rule: "the ecosystem can do 100% of what we say; check every statement against real behaviour like a stranger
// would". An outside review on 18.10. (a fresh agent, no project knowledge, ~130 claims) found 19 mismatches. Each one
// that was fixed is pinned here, live, plus the plain-words reading offline:
//   - the cards' skill ids answer over A2A (were -32601 unknown skill), negotiate reads "task"
//   - "1000 USD of 0x… and 1000 USD of 0x… to 70/30" is two holdings of 1000 and a 70/30 target (was 500/500, no target);
//     "I earn 2% on USDT" keeps the rate and the market (was dropped)
//   - the per-agent MCP paid tools carry the holder pass terms they promise "in the reply"
//   - every text that called the pool scan free without end names the 1,000 a day (llms.txt, skill.md, the grid trader's
//     MCP tool, the watch's free alternative); the tip no longer says "everything else here is free", and says where the
//     money goes as the sweep does it; the root card's holder pass names the scan day pass; the catalogue says POST → 402
//
//   node scripts/agent-promise-check.mjs        exit 1 on any FAIL
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const U = await import(pathToFileURL(path.resolve(import.meta.dirname, '../worker-agent/understand.js')).href);

const AGENT = 'https://agent.brainonbnb.com', SITE = 'https://brainonbnb.com';
const A = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', B = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
const VENUS_ACCT = '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc';
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`); };
const a2a = async (slug, data, text) => (await (await fetch(`${AGENT}${slug ? '/' + slug : ''}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'chk-' + Date.now(), parts: [...(data ? [{ kind: 'data', data }] : []), ...(text ? [{ kind: 'text', text }] : [])] } } }) })).json().catch(() => null));
const dataOf = (r) => (r?.result?.parts || []).find((p) => p.kind === 'data')?.data || r?.result || null;
const mcp = async (slug, method, params) => (await (await fetch(`${AGENT}/${slug}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json().catch(() => null));

// --- offline: the plain-words reading
{
  const reb = { needs: { holdings: 1, targets: 1 } }, yld = { needs: { amountUsd: 1, from: 1, currentApyPct: 1 } };
  const r = U.understand(reb, `rebalance 1000 USD of ${A} and 1000 USD of ${B} to 70/30`);
  check(r.holdings?.length === 2 && r.holdings.every((h) => h.usd === 1000) && r.targets?.[A] === 70 && r.targets?.[B] === 30, '"1000 USD of 0x… and 1000 USD of 0x… to 70/30": two holdings of 1000, target 70/30', JSON.stringify(r));
  const r2 = U.understand(reb, `rebalance ${A} ${B} $2000`);
  check(r2.holdings?.length === 2 && r2.holdings.every((h) => h.usd === 1000) && !r2.targets, 'addresses without their own figures: an even split, no target invented', JSON.stringify(r2));
  const y = U.understand(yld, 'best Venus yield for 5000 USD, I earn 2% on USDT today');
  check(y.amountUsd === 5000 && y.currentApyPct === 2 && y.from === 'USDT', '"I earn 2% on USDT": the rate and the market are kept', JSON.stringify(y));
  const y2 = U.understand(yld, 'amountUsd 5000, from vUSDT, currentApyPct 2');
  check(y2.amountUsd === 5000 && y2.currentApyPct === 2 && y2.from === 'vUSDT', 'the card\'s own field names, written out, are read', JSON.stringify(y2));
}

// --- live: A2A
{
  const hf = dataOf(await a2a('health-factor', { skill: 'health_factor', address: VENUS_ACCT }));
  check(!!hf && hf.free_reading && hf.paid_half?.service === 'health_factor', 'A2A skill:"health_factor" (the card\'s id) gives the free reading and the paid half', hf ? Object.keys(hf).join(',') : 'no answer');
  const root = dataOf(await a2a(null, { skill: 'yield_plan' }));
  check(!!root && /yield-optimizer\/a2a/.test(String(root.free_reading)) && root.paid_half?.pay_per_answer, 'A2A skill:"yield_plan" on the shared endpoint: the terms, and where the free reading is', root ? JSON.stringify(root).slice(0, 120) : 'no answer');
  const wrong = dataOf(await a2a('grid-trader', { skill: 'health_factor' }));
  check(wrong?.accepted === false && /health-factor\/a2a/.test(wrong.reason || ''), 'another agent\'s skill id is pointed to that agent', wrong?.reason);
  const neg = dataOf(await a2a(null, { skill: 'negotiate', task: 'quote finding the best yield for my BNB on BNB Chain' }));
  check(neg?.accepted === true && neg.service === 'yield_plan', 'negotiate with the card\'s example under "task" is quoted', neg ? `${neg.accepted} ${neg.service || neg.reason}` : 'no answer');
  const reb = dataOf(await a2a('rebalancer', null, `rebalance 1000 USD of ${A} and 1000 USD of ${B} to 70/30`));
  const und = reb?.paid_half?.understood?.params || reb?.understood?.params;
  check(und?.holdings?.length === 2 && und.holdings.every((h) => h.usd === 1000) && und.targets?.[A] === 70, 'the rebalancer understands the sentence before you pay', JSON.stringify(und || reb).slice(0, 140));
}

// --- live: MCP, cards, texts
{
  const t = await mcp('health-factor', 'tools/call', { name: 'health_factor', arguments: {} });
  const sc = t?.result?.structuredContent;
  check(!!sc?.holder_pass?.how && sc.payment_required, 'a per-agent MCP paid tool carries the holder pass terms it promises', sc ? Object.keys(sc).join(',') : 'no answer');
  const l = await mcp('grid-trader', 'tools/list', {});
  const ps = (l?.result?.tools || []).find((x) => x.name === 'bsc_pool_scan');
  check(/1,000 scans per caller/.test(ps?.description || '') && !/lays the grid/.test(ps?.description || ''), 'the grid trader\'s bsc_pool_scan names the 1,000 a day', ps?.description?.slice(-120));
  const tip = await (await fetch(`${AGENT}/tip?usd=1`)).json().catch(() => ({}));
  check(!/Everything else here is free/.test(tip.what || '') && /half of it buys \$BOBAI/.test(tip.where_it_goes || ''), 'the tip says what is free and where money goes as the sweep does it', tip.where_it_goes);
  const card = await (await fetch(`${AGENT}/.well-known/agent-card.json`)).json().catch(() => ({}));
  check(/scan-pass/.test(card.holder_pass?.applies_to || ''), 'the root card\'s holder pass names the scan day pass', card.holder_pass?.applies_to);
  check(/"task"/.test((card.skills || []).find((s) => s.id === 'negotiate')?.description || ''), 'the root card says what negotiate reads');
  const llms = await (await fetch(`${SITE}/llms.txt?r=${Date.now()}`)).text();
  check(!/Both are free, need no key/.test(llms) && !/The only recurring charge here/.test(llms), 'llms.txt: no "both are free" and no "only recurring charge"');
  // no stale free-scan count anywhere in it (2026-10-25: "past 50 free scans a day" stood beside the 1,000 above)
  check(!/(?<![\d,])(?!1,000\b)\d[\d,]* free (pool )?scans/.test(llms), 'llms.txt: every free-scan count is the 1,000', (llms.match(/\b[\d,]+ free (pool )?scans[^.]{0,30}/g) || []).join(' | '));
  check(/\d+ free tools \(the count is pinned against tools\/list by a check; `bsc_pool_scan` free for 1,000 scans/.test(llms) && /pool scan day pass \(1 a day\)/.test(llms), 'llms.txt: the 50 a day beside the tool count, the day pass under the holder pass');
  const skill = await (await fetch(`${SITE}/skill.md?r=${Date.now()}`)).text();
  check(/free \(the pool scan 1,000 a caller a day, then a day pass\)/.test(skill), 'skill.md: the heading names the 1,000 a day');
  const cat = await (await fetch(`${AGENT}/.well-known/x402`, { headers: { accept: 'text/markdown' } })).text();
  check(!/Call any of them once \*\*without\*\*/.test(cat), 'the catalogue says which call answers 402');
  const w = await (await fetch(`${AGENT}/watch`)).json().catch(() => ({}));
  check(/1,000 scans per caller a day/.test(w.free_alternative || ''), 'the watch\'s free alternative names the 1,000 a day', w.free_alternative);
}
// THE PROMISE CHECK OF 29.10. (three read-only reviews of llms.txt, the whitepaper, /services, /pancakeswap and the cards;
// every finding checked again): each sentence that said more than the system does, pinned so it cannot come back
{
  const txt = async (u) => fetch(u, { headers: { 'user-agent': 'brainonbnb-check' } }).then((r) => r.text()).catch(() => '');
  const [wp, llms, toko, svc, pcs, defiCard] = await Promise.all([txt('https://brainonbnb.com/whitepaper'), txt('https://brainonbnb.com/llms.txt'), txt('https://brainonbnb.com/api/tokenomics'), txt('https://brainonbnb.com/services'), txt('https://brainonbnb.com/pancakeswap'), txt('https://agent.brainonbnb.com/defi-agent/.well-known/agent-card.json')]);
  check(!/where the marketplace honors ERC-2981/.test(wp) && /no ERC-2981/.test(wp), 'whitepaper: no royalty claimed on chain (the NFT contract has no ERC-2981)');
  check(!/runs entirely in the visitor.s browser/.test(wp) && /Every tool but two is/.test(wp) && !/Nine of them are about this chain/.test(wp), 'whitepaper: the scanner asks this site\'s APIs; two tools write, not one; sixteen are about the chain');
  check(!/51st scan/.test(llms) && /1,001st scan/.test(llms) && /up to 2,000 scans/.test(llms) && /most recent 400 tasks/.test(llms) && /up to 10 per provider and 80 a day/.test(llms), 'llms.txt: the free scans are 1,000, the pass ends at 2,000, /sessions is the last 400, settle and refund name their caps');
  check(/collects in the token contract itself/.test(toko) && !/accumulates in the public buyback wallet/.test(toko), '/api/tokenomics: the tax collects in the token, not the wallet');
  check(/not in USDC/.test(svc), '/services: a plain transfer by hash is taken in USD1 or $BOBAI, not USDC');
  check(!/came out ahead when every width was replayed/.test(pcs) && !/±20% came out ahead/.test(defiCard) && /none came out ahead of holding/.test(defiCard), 'DeFi agent: no width claimed ahead of holding (the width record says none is)');
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
