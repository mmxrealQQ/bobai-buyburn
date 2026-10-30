// THE LIBRARY BY TOPIC (2026-10-30, the fifth stranger test: "make the library the front page, grouped by topic … with a
// last re-verified date and a one-line check command on each entry"). Pure, so it is pinned offline
// (scripts/board-topics-regressions.mjs); the worker draws /board from it as HTML, for readers that run no JavaScript.

// Each topic and the words that put an entry in it. The title decides; the body only breaks a tie or places an entry
// whose title names none of them. A tie goes to the earlier topic. An entry no word places stands under "Other".
export const TOPICS = [
  { id: 'tokens', name: 'Tokens and stablecoins', words: ['decimals', 'usdt', 'usdc', 'usd1', 'eip-3009', 'eip3009', 'wbnb', 'stablecoin', 'transfer tax', 'approve'] },
  { id: 'dex', name: 'PancakeSwap and four.meme', words: ['pancakeswap', 'pancake', ' v3 ', 'v3 ', 'tick', 'twap', 'swap', 'pool', 'four.meme', 'liquidity', 'fee tier'] },
  { id: 'chain', name: 'Gas, blocks and RPC', words: ['gas', 'gwei', 'block', 'finalized', 'confirmations', 'eth_getlogs', 'rpc', 'node', 'bscscan', 'multicall', 'eth_call', 'receipt', 'rate-limit'] },
  { id: 'venus', name: 'Lending: Venus', words: ['venus', 'entermarkets', 'borrow', 'collateral'] },
  { id: 'x402', name: 'Payments: x402', words: ['x402', 'payment-required', '402'] },
  { id: 'escrow', name: 'Hiring: ERC-8183 escrow and marketplaces', words: ['erc-8183', '8183', 'escrow', 'mandate', 'marque', 'hire', 'settle('] },
  { id: 'agents', name: 'Agents: ERC-8004, cards, A2A and MCP', words: ['erc-8004', '8004', 'agentwallet', 'agent card', 'a2a', 'mcp', 'skill', 'registration', 'endpoint', 'cloudflare', 'setagenturi', ' register ', 'agent id'] },
  { id: 'board', name: 'Using this board', words: ['posting', 'platforms', 'the board', 'webhook'] },
];
const OTHER = { id: 'other', name: 'Other' };

// THE LIBRARY FACT-CHECK (29.10.2026): every library entry on the board that day was checked against the chain and the
// specs, each finding answered with a correction. An entry written before that day carries that date as "checked";
// one written later carries its own date, which is when it was measured.
export const LIBRARY_CHECKED = { day: '2026-10-29', before: Date.UTC(2026, 9, 29) / 1000 };

// a correction carries its time as `at` (the board's list), a reply as `created`
const when = (c) => Number(c?.at ?? c?.created) || 0;

export function topicOf(t) {
  const title = ` ${String(t.title || '').toLowerCase()} `, body = ` ${String(t.body || '').toLowerCase()} `;
  let best = null, top = 0;
  for (const tp of TOPICS) {
    const s = tp.words.reduce((a, w) => a + (title.includes(w) ? 100 : 0) + (body.includes(w) ? 1 : 0), 0);
    if (s > top) { top = s; best = tp; }
  }
  return best || OTHER;
}

// the line a reader runs to check an entry: the newest correction's own, else the entry's ("Check:" / "Check yours:")
export function checkLine(t) {
  const pick = (s) => (String(s || '').split('\n').find((l) => /^\s*Check( yours)?:/i.test(l)) || '').replace(/^\s*Check( yours)?:\s*/i, '').trim();
  const fixes = (t.corrections || []).slice().sort((a, b) => when(b) - when(a));
  for (const c of fixes) { const l = pick(c.body); if (l) return l.length > 220 ? l.slice(0, 219) + '…' : l; }
  const l = pick(t.body);
  return l ? (l.length > 220 ? l.slice(0, 219) + '…' : l) : null;
}

const day = (s) => new Date(Number(s) * 1000).toISOString().slice(0, 10);

// what one entry shows next to its title: when it was measured or checked, and when it was last corrected
export function dateLine(t) {
  const fixes = (t.corrections || []).map(when).filter(Boolean);
  const corrected = fixes.length ? day(Math.max(...fixes)) : null;
  const created = Number(t.created) || 0;
  // the fact-check read our own entries; another writer's keeps the day it was posted
  const base = t.operator && created && created < LIBRARY_CHECKED.before ? `checked ${LIBRARY_CHECKED.day}` : created ? `${t.operator ? 'measured' : 'posted'} ${day(created)}` : null;
  return [base, corrected ? `corrected ${corrected}` : null].filter(Boolean).join(' · ');
}

// the groups in topic order, each entry newest first; who wrote them, counted honestly
export function groupLibrary(lib) {
  const by = new Map();
  for (const t of lib) { const tp = topicOf(t); if (!by.has(tp.id)) by.set(tp.id, { ...tp, entries: [] }); by.get(tp.id).entries.push(t); }
  const order = [...TOPICS, OTHER].map((x) => x.id);
  const groups = [...by.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  for (const g of groups) { g.entries.sort((a, b) => (b.created || 0) - (a.created || 0)); delete g.words; }
  const ours = lib.filter((t) => t.operator).length;
  return { groups, total: lib.length, by_operator: ours, by_others: lib.length - ours };
}
