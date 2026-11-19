#!/usr/bin/env node
// "Mach so dass alles korrekt ist" (operator, 2026-11-19, after a stranger test of /mcp/agents):
// (1) a block that names three or more categories is a directory's menu, not a capability — our own MCP server #49467
//     sat in all four categories because its search tools list them; an agent that says one thing still classifies;
// (2) an outside job on a shared address that names no agent counts in the delivery rate of every agent of that
//     address (four expired jobs on 0x7380 stood on nobody's score), while buyers stay each agent's own.
import fs from 'node:fs';
import path from 'node:path';
import { classifyAgent } from '../worker-agent/categories.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const cats = (a) => classifyAgent(a).map((m) => m.category).sort().join(',');

const menuTool = { name: 'bnb_agents_by_evidence', description: 'Agents of one category ranked by evidence: category = rebalancing | grid-trading | yield-optimization | health-factor.' };
check(cats({ name: 'Scanner', description: 'Pool scanner on BNB Chain', tools: [menuTool] }) === '', 'a tool that lists the four categories files the agent under none', cats({ name: 'Scanner', description: 'Pool scanner on BNB Chain', tools: [menuTool] }));
check(cats({ name: 'RangeKeeper', description: 'Rebalances PancakeSwap V3 liquidity on BNB Chain', tools: [] }) === 'rebalancing', 'an agent that says it rebalances still files under rebalancing');
check(cats({ name: 'Guard', description: 'Venus health factor alerts and grid trading plans on BSC', tools: [] }) === 'grid-trading,health-factor', 'two categories in one sentence still count (the menu rule starts at three)');

const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'dashboard', 'api-agent-jobs.json'), 'utf8'));
const withShared = Object.entries(j.agents).filter(([, a]) => a.totals?.shared_address_jobs);
check(withShared.length > 0, 'agents on a shared address with unnamed outside jobs carry shared_address_jobs', `${withShared.length}`);
let bad = [];
for (const [id, a] of withShared) {
  const T = a.totals, s = T.shared_address_jobs, prov = j.providers[s.address];
  const ownF = T.funded_outside_own ?? 0, ownD = Math.round(((T.delivery_rate_outside_pct_own ?? 0) / 100) * ownF);
  const want = Math.round(((ownD + s.delivered) / (ownF + s.funded_outside)) * 1000) / 10;
  if (T.funded_outside !== ownF + s.funded_outside || Math.abs(T.delivery_rate_outside_pct - want) > 0.11 || !prov || !prov.agents.includes(Number(id))) bad.push(`${id}: ${T.delivery_rate_outside_pct} vs ${want}`);
}
check(!bad.length, 'each such agent\'s delivery rate takes the address\'s unnamed outside jobs in', bad.slice(0, 3).join('; '));
const ours = j.agents['363709']?.totals;
check(ours?.shared_address_jobs?.address === '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963' && ours.delivery_rate_outside_pct < ours.delivery_rate_outside_pct_own, 'our DeFi agent #363709 carries the shared 0x7380 jobs and ranks below its own-only rate', `${ours?.delivery_rate_outside_pct} < ${ours?.delivery_rate_outside_pct_own}`);
check(Object.values(j.agents).every((a) => !a.totals?.shared_address_jobs || a.totals.buyers_outside === (a.totals.buyers_outside | 0)), 'buyers stay each agent\'s own count');

console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
