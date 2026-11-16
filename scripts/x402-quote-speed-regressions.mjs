// Pins the speed of the 402 (2026-11-16, Liste B "x402 402-Terms"): every unpaid /answer took 3.1 or 6.1 s, the $BOBAI
// quote's reads waiting on a hung node before the next was asked. Now: reads staggered across the nodes (the first good
// answer counts), and the quote kept 30 s with the time it was read. A payment's receipt keeps its own list, untouched.
//   node scripts/x402-quote-speed-regressions.mjs      (offline: fetch is a stand-in)
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const realFetch = globalThis.fetch;
// a stand-in node set: per endpoint, a delay and an answer (or an error)
let NODES = {};
globalThis.fetch = async (url, init) => {
  const n = NODES[url] || { ms: 0, fail: 'unknown node' };
  await new Promise((r, j) => { const t = setTimeout(r, n.ms); init?.signal?.addEventListener?.('abort', () => { clearTimeout(t); j(new Error('aborted')); }); });
  if (n.fail) throw new Error(n.fail);
  return { json: async () => ({ jsonrpc: '2.0', id: 1, result: n.result }) };
};
const { rpcRace, QUOTE_KEEP_MS } = await import('../worker-agent/index.js');

// 1. a hung first node and a quick second: the answer comes from the second, in about the stagger, not after the hang
NODES = { 'https://a': { ms: 3000, result: '0xslow' }, 'https://b': { ms: 50, result: '0xquick' }, 'https://c': { ms: 50, result: '0xthird' } };
let t = Date.now(); let r = await rpcRace('eth_call', [], ['https://a', 'https://b', 'https://c']); let ms = Date.now() - t;
ok('a hung first node: the second answers, in well under a second', r === '0xquick' && ms < 1000, `${r} in ${ms} ms`);
// 2. a quick first node: no wait at all
NODES = { 'https://a': { ms: 30, result: '0xfirst' }, 'https://b': { ms: 30, result: '0xsecond' } };
t = Date.now(); r = await rpcRace('eth_call', [], ['https://a', 'https://b']); ms = Date.now() - t;
ok('a quick first node answers alone, at once', r === '0xfirst' && ms < 300, `${r} in ${ms} ms`);
// 3. a failing first node: the next is tried without waiting out the stagger's whole list
NODES = { 'https://a': { ms: 10, fail: 'limit exceeded' }, 'https://b': { ms: 10, result: '0xok' } };
r = await rpcRace('eth_call', [], ['https://a', 'https://b']);
ok('a refusing first node: the next one answers', r === '0xok', r);
// 4. every node down: an error, never a silent undefined
NODES = { 'https://a': { ms: 10, fail: 'down a' }, 'https://b': { ms: 10, fail: 'down b' } };
let err = null; try { await rpcRace('eth_call', [], ['https://a', 'https://b']); } catch (e) { err = e; }
ok('every node down: it throws (the $BOBAI door then stays shut, the USD1 terms still go out)', !!err, String(err));
globalThis.fetch = realFetch;

const src = readFileSync(new URL('../worker-agent/index.js', import.meta.url), 'utf8');
ok('the quote is kept 30 s and says when it was read', QUOTE_KEEP_MS === 30000 && /quoted_at: new Date\(q\.at\)\.toISOString\(\)/.test(src));
ok('the three $BOBAI offers name the quote\'s own time, not the answer\'s', (src.match(/usd_per_bobai: bobai\.usd_per_bobai, quoted_at: bobai\.quoted_at/g) || []).length === 3 && !/usd_per_bobai: bobai\.usd_per_bobai, quoted_at: new Date\(\)/.test(src));
ok('the pricing reads go staggered (bobaiForUsd, bnbUsd)', /callQuick\(BOBAI_PAIR, SEL\.getReserves\)/.test(src) && /callQuick\(BNB_PAIR, SEL\.getReserves\)/.test(src));
ok('the payment check still asks the price at every paid request (line: const bobai = await bobaiForUsd)', /const bobai = await bobaiForUsd\(Number\(ANSWER_PRICE\) \/ 1e18 \* BOBAI_SHARE\)/.test(src));
ok('the tenth of slack on what must arrive is unchanged (atomic = tokens x 0.9)', /atomic: BigInt\(tokens\) \* 9n \* 10n \*\* 17n/.test(src));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
