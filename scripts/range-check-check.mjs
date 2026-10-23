#!/usr/bin/env node
// THE RANGE CHECK (2026-10-23). Pokter asked our Rebalancer (#304494) "Range check for the PancakeSwap v3 positions held
// by 0x…: which are in range, and what should be re-centred?" and "Quote your standard deliverable so a buyer can see the
// price before hiring" — it declined both (0x03 "ask the DeFi agent", 0x04 "needs holdings") and Pokter marked it
// seller-declined; the DeFi agent declined the first too (not a WBNB pair). Pins (the code before 2026-10-23 FAILs 1-5):
//   1  rangeVerdict: in range with its room, near an edge, out below / above, re-centred = same width, aligned to spacing
//   2  extractParams: range words + a wallet = a range check of that wallet, no holdings made up; a real list stays a list
//   3  the Rebalancer quotes both Pokter requests (it reaches the signature: no 0x03, no 0x04)        [live: reads BSC]
//   4  the Rebalancer's delivery for range words is the range check, read live (our own DeFi wallet)  [live]
//   5  the DeFi agent no longer declines a pair for not being WBNB; it delivers the range check
// usage: node scripts/range-check-check.mjs [--offline]
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const offline = process.argv.includes('--offline');
const lp = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'lp-service.js')).href);
const sell = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'sell.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };

// 1
const rv = lp.rangeVerdict;
if (typeof rv !== 'function') is('1  rangeVerdict exists', false);
else {
  const a = rv(-60370, -56730, -58443, 10);
  is('1  in range: room to each edge in percent', a.in_range && a.room.to_lower_pct === 17.53 && a.room.to_upper_pct === 18.68 && a.recentre === 'no', JSON.stringify(a.room));
  is('1  re-centred: the same width, aligned to the spacing', a.recentred_ticks[1] - a.recentred_ticks[0] === 3640 && a.recentred_ticks[0] % 10 === 0, JSON.stringify(a.recentred_ticks));
  const e = rv(-1000, 1000, 900, 10);
  is('1  near an edge: less than a tenth of the width left', e.in_range && e.near_edge && e.recentre === 'soon');
  const b = rv(-1000, 1000, -1500, 10), c = rv(-1000, 1000, 1000, 10);
  is('1  out of range below / at the upper tick: re-centre yes', !b.in_range && b.out_of_range.side === 'below' && b.recentre === 'yes' && !c.in_range && c.out_of_range.side === 'above', `${b.verdict} | ${c.verdict}`);
}

// 2
const pokter = 'Range check for the PancakeSwap v3 positions held by 0xab7ed4d30757baa7d3d65d9e0aaba2c827a69e9c: which are in range, and what should be re-centred?';
const p2 = sell.extractParams(pokter, {});
is('2  range words + a wallet: a range check, no made-up holdings', p2.range === true && /0xab7e/i.test(p2.address || '') && !p2.holdings, JSON.stringify(p2));
const list = sell.extractParams('rebalance [{"token":"0x55d398326f99059fF775485246999027B3197955","usd":500},{"token":"0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c","usd":500}] out of range', {});
is('2  a real list of holdings stays a portfolio rebalance', Array.isArray(list.holdings) && list.holdings.length === 2 && !list.range);
is('2  missingInput: a range check with a wallet is enough', sell.missingInput('rebalance_plan', p2) === null);

// 3 + 4
if (offline) console.log('skip  3-4 (live)');
else {
  const store = new Map();
  const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async () => {}, list: async () => ({ keys: [] }) };
  const env = { AGENT: KV, AGENT_PROVIDER_PRIVATE_KEY: '0x' + '11'.repeat(32) };   // a throwaway key: signing stops at 0x05, as intended
  const ask = async (task) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'm', parts: [{ kind: 'data', data: { skill: 'negotiate-erc8183-job', task_description: task, terms: { deliverables: 'A JSON assessment with assumptions and data sources.', quality_standards: 'Read-only analysis only. Execute no transaction and move no funds.' }, chain_id: 56 } }] } } });
    const r = await (await sell.handleA2A(new Request('https://x/', { method: 'POST', body }), env, { agent: 'rebalancer' })).json();
    return r.result?.parts?.[0]?.data || {};
  };
  const q1 = await ask(pokter), q2 = await ask('Quote your standard deliverable so a buyer can see the price before hiring.');
  const quoted = (d) => d.accepted !== false || d.reason_code === '0x05';
  is('3  the Rebalancer quotes the range check', quoted(q1), q1.reason_code ? `${q1.reason_code} ${String(q1.reason).slice(0, 90)}` : 'accepted');
  is('3  the Rebalancer quotes "your standard deliverable"', quoted(q2), q2.reason_code ? `${q2.reason_code} ${String(q2.reason).slice(0, 90)}` : 'accepted');
  let w = null;
  try { w = await sell.doWork('rebalance_plan', sell.extractParams('range check for the v3 positions held by 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', {})); } catch (e) { w = { error: e.message }; }
  is('4  delivery for range words: the range check, read live', w?.mode === 'range_check' && w.plan.positions.some((p) => Array.isArray(p.ticks)), w?.error || w?.plan?.summary);
}

// 5
const lpSrc = fs.readFileSync(path.join(ROOT, 'worker-agent', 'lp-service.js'), 'utf8');
const sellSrc = fs.readFileSync(path.join(ROOT, 'worker-agent', 'sell.js'), 'utf8');
is('5  the DeFi agent: not a WBNB pair = the range check, not a decline', /if \(!facts\.against_wbnb\) \{\s*const rc = await lpRangeCheck/.test(lpSrc) && !/is not against WBNB\. The DeFi agent plans only WBNB pairs/.test(sellSrc));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
