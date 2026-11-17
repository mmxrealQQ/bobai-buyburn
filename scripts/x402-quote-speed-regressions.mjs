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
// 5. (2026-11-17) the edge as measured: publicnode holds 3 s then says 429, the others answer in ~40 ms, and a Worker
// keeps at most six connections open per request — a seventh waits for one to close. A fresh quote under that: < 1 s.
{
  const PN = new Set(['https://bsc.publicnode.com', 'https://bsc-rpc.publicnode.com']);
  const W = (v) => v.toString(16).padStart(64, '0');
  const reserves = (a, b) => '0x' + W(a) + W(b) + W(0n);
  let open = 0; const waiting = [];
  const slot = () => (open < 6 ? (open++, Promise.resolve()) : new Promise((r) => waiting.push(r)).then(() => { open++; }));
  const free = () => { open--; const n = waiting.shift(); if (n) n(); };
  globalThis.fetch = async (url, init) => {
    await slot();
    try {
      const body = JSON.parse(init.body); const to = body.params[0].to;
      await new Promise((r) => setTimeout(r, PN.has(url) ? 3000 : 40));
      if (PN.has(url)) return { json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Rate limit' } }) };
      // BOBAI pair: 1,000,000 BOBAI / 0.3 BNB; BNB pair: 1,000 WBNB / 600,000 USDT
      const result = to === '0x6eadd4cb786898b34929444988380ed0cc6fd9a6' ? reserves(10n ** 24n, 3n * 10n ** 17n) : reserves(10n ** 21n, 6n * 10n ** 23n);
      return { json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
    } finally { free(); }
  };
  const { usdPerBobaiNow, QUICK_RPCS } = await import('../worker-agent/index.js');
  t = Date.now(); const q = await usdPerBobaiNow(); ms = Date.now() - t;
  ok('a fresh $BOBAI quote with publicnode hanging and six connections: under a second', ms < 1000, `${ms} ms`);
  ok('… and the price is the pairs\' arithmetic: 0.3 BNB x $600 / 1,000,000 = $0.00018', Math.abs(q.usdPerBobai - 0.00018) < 1e-12, String(q.usdPerBobai));
  ok('the quick reads ask a node that answered quickly from the edge first, publicnode last', !PN.has(QUICK_RPCS[0]) && PN.has(QUICK_RPCS[QUICK_RPCS.length - 1]));
}
globalThis.fetch = realFetch;

const src = readFileSync(new URL('../worker-agent/index.js', import.meta.url), 'utf8');
ok('the quote is kept 30 s and says when it was read', QUOTE_KEEP_MS === 30000 && /quoted_at: new Date\(q\.at\)\.toISOString\(\)/.test(src));
ok('the three $BOBAI offers name the quote\'s own time, not the answer\'s', (src.match(/usd_per_bobai: bobai\.usd_per_bobai, quoted_at: bobai\.quoted_at/g) || []).length === 3 && !/usd_per_bobai: bobai\.usd_per_bobai, quoted_at: new Date\(\)/.test(src));
ok('the pricing reads go staggered (bobaiForUsd, bnbUsd)', /callQuick\(BOBAI_PAIR, SEL\.getReserves\)/.test(src) && /callQuick\(BNB_PAIR, SEL\.getReserves\)/.test(src));
ok('token0 is not read per quote (fixed at pair creation: $BOBAI and WBNB are token0)', !/callQuick\([A-Z_]+PAIR, SEL\.token0\)/.test(src) && /const BOBAI_PAIR_TOKEN0 = '0x245c386dcfed896f5c346107596141e5edcbffff'/.test(src) && /const BNB_PAIR_TOKEN0 = WBNB;/.test(src));
ok('the payment check still asks the price at every paid request (line: const bobai = await bobaiForUsd)', /const bobai = await bobaiForUsd\(Number\(ANSWER_PRICE\) \/ 1e18 \* BOBAI_SHARE\)/.test(src));
ok('the tenth of slack on what must arrive is unchanged (atomic = tokens x 0.9)', /atomic: BigInt\(tokens\) \* 9n \* 10n \*\* 17n/.test(src));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
