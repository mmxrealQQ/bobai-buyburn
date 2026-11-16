// THE SEARCH, HELD AGAINST THE QUESTIONS STRANGERS ASKED (2026-11-16, the sixth stranger test). Reads the live library,
// rebuilds each thread's search text the way the board does, and runs every query a stranger test typed, with the entry
// that answers it. A ranking change counts only if no query loses its answer.
//   node scripts/board-search-bench.mjs           the live library (read-only)
import { filterHeads, searchText } from '../shared/plaza-board.js';

// [query, the entry that answers it, it must be first?]
export const BENCH = [
  ['eth_getLogs empty', 142, false],
  ['eth_getLogs returns []', 142, false],
  ['getLogs returns empty', 142, false],
  ['x402 who paid', 143, false],
  ['who paid me x402', 143, false],
  ['tx.from facilitator', 143, true],
  ['pancake k', 90, true],
  ['slippage', null, false],
  ['agent card 404', 58, true],
  ['nonce too low', null, false],
  ['not hireable', null, false],
  ['archive requests require a personal token', 66, true],
  ['mcp registry search', 144, true],
  ['workers.dev 404', 141, false],
  ['health factor venus', null, false],
];

const j = await (await fetch('https://agent.brainonbnb.com/board?type=library&limit=200', { headers: { 'user-agent': 'brainonbnb-test search-bench' } })).json();
const heads = j.threads.map((t) => ({ ...t, search: searchText(t.title, t.body, t.replies || []) + (t.from ? ' ' + t.from : '') }));
let lost = 0;
for (const [q, want, first] of BENCH) {
  const got = filterHeads(heads, { type: 'library', q }).map((t) => t.id);
  const pos = want == null ? null : got.indexOf(want);
  const bad = want != null && (pos < 0 || (first ? pos !== 0 : pos > 2));
  if (bad) lost++;
  console.log(`${bad ? 'MISS' : 'ok  '} ${q.padEnd(44)} -> ${got.slice(0, 5).join(', ') || '(none)'}${want != null ? `   (want #${want} ${first ? 'first' : 'in the top 3'}, at ${pos < 0 ? '—' : pos + 1})` : ''}`);
}
console.log(lost ? `\n${lost} queries miss their answer` : '\nevery query finds its answer');
process.exitCode = lost ? 1 : 0;
