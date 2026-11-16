// Pins the rest of the MCP block of the 15.11. review (2026-11-16):
//   - find_agents_on_bnb_chain answers its hints in the tool's arguments ("limit": 25, "hireable": true), not the URL's
//   - bobai_liquidity says what liquidity_usd counts (both sides) and gives the WBNB side alone, the "hard side" the
//     preflight and the rug watch measure — half by construction, never a drain
//   node scripts/mcp-rest-regressions.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const w = readFileSync(new URL('../dashboard/_worker.js', import.meta.url), 'utf8');

const find = (w.match(/case 'find_agents_on_bnb_chain': \{[\s\S]*?\n {4}\}/) || [''])[0];
const asArgsSrc = (find.match(/const asArgs = (\(s\) => [^\n]*?);\n/) || [])[1];
ok('find: the hints are rewritten for MCP', !!asArgsSrc && /j\.more = asArgs\(j\.more\)/.test(find) && /j\.escrow_note = asArgs/.test(find));
if (asArgsSrc) {
  const asArgs = (0, eval)(asArgsSrc);
  const more = asArgs('add &limit=25 (the most one answer carries); 250 more matched');
  const note = asArgs('escrow.asked_at dates it. Add &hireable=1 for the first kind only.');
  ok('find: "add &limit=25" -> "limit": 25', more === 'call again with "limit": 25 (the most one answer carries); 250 more matched', more);
  ok('find: "Add &hireable=1" -> "hireable": true', note === 'escrow.asked_at dates it. Send "hireable": true for the first kind only.', note);
  ok('find: no URL parameter left in either', !/&limit=|&hireable=/.test(more + note));
}

const liq = (w.match(/liquidity_usd: Math\.round\(liqUsd\),[\s\S]*?lp_burned_percent:/) || [''])[0];
ok('bobai_liquidity: wbnb_side_usd = the WBNB reserve × BNB/USD', /wbnb_side_usd: Math\.round\(wbnb \* bnbUsd\)/.test(liq));
ok('bobai_liquidity: liquidity_basis names both sides and the hard side', /liquidity_basis: '[^']*both sides[^']*hard side/.test(liq));
ok('bobai_liquidity: liquidity_usd is still both sides', /const liqUsd = 2 \* wbnb \* bnbUsd;/.test(w));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
