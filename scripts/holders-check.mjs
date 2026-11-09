// Pins the $BOBAI holder count (worker-agent/holders.js), both ways (2026-10-22).
// Each pin holds on the real summarize/applyTransfers and must break on a naive count that takes every address with
// a balance. --live also reads agent.brainonbnb.com/holders.
//   node scripts/holders-check.mjs [--live]
import { summarize, applyTransfers, PASS_LINE } from '../worker-agent/holders.js';

const E = 10n ** 18n, w = (n) => String(BigInt(n) * E);
const OUR = '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', DEAD = '0x000000000000000000000000000000000000dead';
const state = { block: 1, code: { [PAIR]: 1 }, bal: { [PAIR]: w(1e8), [DEAD]: w(1e8), [OUR]: w(5e6), '0xa': w(2e6), '0xb': w(999999), '0xc': w(50), '0xd': '0' } };
const naive = (s) => { const p = Object.values(s.bal).filter((x) => BigInt(x) > 0n); return { holders: p.length, holders_1m: p.filter((x) => BigInt(x) >= PASS_LINE).length }; };
let bad = 0;
const pin = (name, ok, okNaive) => { const pass = ok && !okNaive; if (!pass) bad++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — breaks on the real count'}${okNaive ? ' — a naive count passes too' : ''}`); };
const real = summarize(state), nv = naive(state);
pin('people only: the pool, the burn address and empty ones are not holders; our wallet is one (4 people)', real.holders === 4, nv.holders === 4);
pin('1M+ counts people at or over 1,000,000 (ours and 0xa; 0xb is one short)', real.holders_1m === 2, nv.holders_1m === 2);
pin('bands add up to the holders', real.bands.reduce((s, b) => s + b.holders, 0) === real.holders, false);
// a crossing: 0xb buys 2 from the pair -> crosses; 0xa buys more -> no crossing (already over); a contract crossing -> none
const bal = { ...state.bal };
const crossed = applyTransfers(bal, [
  { from: PAIR, to: '0xb', value: 2n * E, block: 2, tx: '0x1' },
  { from: PAIR, to: '0xa', value: 5n * E, block: 2, tx: '0x2' },
  { from: '0xc', to: '0xnewcontract', value: 2n * PASS_LINE, block: 3, tx: '0x3' },
  { from: PAIR, to: '0x15ba17075ef5e0736292b030e3715d9100fe3d38', value: 2n * PASS_LINE, block: 3, tx: '0x4' },
], (a) => a === PAIR || a === '0xnewcontract');
pin('a wallet crossing 1M is recorded once, with its tx — ours like any other; one already over and a contract are not', crossed.length === 2 && crossed[0].address === '0xb' && crossed[0].tx === '0x1' && crossed[1].address === '0x15ba17075ef5e0736292b030e3715d9100fe3d38', crossed.length === 4);
pin('balances move both ways', BigInt(bal['0xb']) === 1000001n * E && BigInt(bal[PAIR]) === BigInt(w(1e8)) - 7n * E - 2n * PASS_LINE, false);
// 4.11.: a chunk that does not answer keeps the chunks read before it (the tick used to throw them away and fell days
// behind on a provider refusing now and then). A fake chain: blocks 1001..21000, the third 5,000-block chunk refuses.
{
  const { holdersTick } = await import('../worker-agent/holders.js');
  const kv = new Map([['holders:state', JSON.stringify({ block: 1000, bal: { '0xaa': w(5) }, code: {} })]]);
  const env = { AGENT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const one = (x) => {
      if (x.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: x.id, result: '0x' + (21003).toString(16) };
      if (x.method === 'eth_getCode') return { jsonrpc: '2.0', id: x.id, result: '0x' };
      if (x.method === 'eth_getLogs') {
        const from = parseInt(x.params[0].fromBlock, 16);
        if (from >= 11001) return { jsonrpc: '2.0', id: x.id, error: { message: 'Request exceeds defined limit.' } };
        const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).padStart(40, '0');
        return { jsonrpc: '2.0', id: x.id, result: [{ topics: ['0x', pad('0x00000000000000000000000000000000000000aa'), pad('0x00000000000000000000000000000000000000bb')], data: '0x' + (10n ** 18n).toString(16), blockNumber: '0x' + (from + 1).toString(16), transactionHash: '0x' + String(from).padStart(64, '0') }] };
      }
      return { jsonrpc: '2.0', id: x.id, error: { message: 'unexpected' } };
    };
    return { json: async () => (Array.isArray(body) ? body.map(one) : one(body)) };
  };
  const r = await holdersTick(env, { now: new Date('2026-11-04T12:00:00Z') });
  globalThis.fetch = realFetch;
  const st = JSON.parse(kv.get('holders:state'));
  const BB = '0x' + '0'.repeat(38) + 'bb';   // the address as a log carries it: 20 bytes, 40 hex
  pin('a chunk that does not answer keeps the two read before it: applied up to block 11000, the transfers in them counted', r.ok === true && st.block === 11000 && BigInt(st.bal[BB] || 0) === 2n * E && /applied up to 11000/.test(r.partial || ''), r.ok === false && st.block === 1000);
}
// ... and with NodeReal set (BSC_RPC_KEYED_URL), the refused chunk is read there in 300-block pieces: the tick
// reaches the end, every transfer counted once. A fake NodeReal refuses any range over 300 blocks, as the real one does.
{
  const { holdersTick } = await import('../worker-agent/holders.js');
  const kv = new Map([['holders:state', JSON.stringify({ block: 1000, bal: { '0xaa': w(5) }, code: {} })]]);
  const env = { BSC_RPC_KEYED_URL: 'https://nodereal.test/v1/key', AGENT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const realFetch = globalThis.fetch;
  let pieces = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body), nr = String(url).startsWith('https://nodereal.test');
    const one = (x) => {
      if (x.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: x.id, result: '0x' + (21003).toString(16) };
      if (x.method === 'eth_getCode') return { jsonrpc: '2.0', id: x.id, result: '0x' };
      if (x.method === 'eth_getLogs') {
        const from = parseInt(x.params[0].fromBlock, 16), to = parseInt(x.params[0].toBlock, 16);
        if (nr && to - from + 1 > 300) return { jsonrpc: '2.0', id: x.id, error: { message: 'exceed maximum block range: 300' } };
        if (!nr && from >= 11001 && from <= 15000) return { jsonrpc: '2.0', id: x.id, error: { message: 'Request exceeds defined limit.' } };
        if (nr) pieces++;
        const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).padStart(40, '0');
        const hit = [1001, 6001, 11001, 16001].filter((blk) => blk >= from && blk <= to);
        return { jsonrpc: '2.0', id: x.id, result: hit.map((blk) => ({ topics: ['0x', pad('0x00000000000000000000000000000000000000aa'), pad('0x00000000000000000000000000000000000000bb')], data: '0x' + (10n ** 18n).toString(16), blockNumber: '0x' + blk.toString(16), transactionHash: '0x' + String(blk).padStart(64, '0') })) };
      }
      return { jsonrpc: '2.0', id: x.id, error: { message: 'unexpected' } };
    };
    return { json: async () => (Array.isArray(body) ? body.map(one) : one(body)) };
  };
  const r = await holdersTick(env, { now: new Date('2026-11-04T12:00:00Z') });
  globalThis.fetch = realFetch;
  const st = JSON.parse(kv.get('holders:state')), BB = '0x' + '0'.repeat(38) + 'bb';
  pin('with NodeReal set, a chunk publicnode refused is read in 300-block pieces: the tick reaches block 21000, all four transfers counted once', r.ok === true && st.block === 21000 && !r.partial && BigInt(st.bal[BB] || 0) === 4n * E && pieces === 17, st.block === 11000);
}
// 9.11.: publicnode answers a range older than its ~10-20 h of logs with an EMPTY list, no error. A tick far behind
// (head 200,003, state at 1,000) must not apply those empty answers: with NodeReal set it reads the old ranges there and
// counts the transfer; without NodeReal it applies nothing and says the logs are unread. The old code took the empty
// list from publicnode, moved the state to 21,000 and lost the transfer.
for (const withNr of [true, false]) {
  const { holdersTick } = await import('../worker-agent/holders.js');
  const kv = new Map([['holders:state', JSON.stringify({ block: 1000, bal: { '0xaa': w(5) }, code: {} })]]);
  const env = { ...(withNr ? { BSC_RPC_KEYED_URL: 'https://nodereal.test/v1/key' } : {}), AGENT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body), nr = String(url).startsWith('https://nodereal.test');
    const one = (x) => {
      if (x.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: x.id, result: '0x' + (200003).toString(16) };
      if (x.method === 'eth_getCode') return { jsonrpc: '2.0', id: x.id, result: '0x' };
      if (x.method === 'eth_getLogs') {
        const from = parseInt(x.params[0].fromBlock, 16), to = parseInt(x.params[0].toBlock, 16);
        if (!nr) return { jsonrpc: '2.0', id: x.id, result: [] }; // pruned: empty, no error
        if (to - from + 1 > 300) return { jsonrpc: '2.0', id: x.id, error: { message: 'exceed maximum block range: 300' } };
        const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).padStart(40, '0');
        return { jsonrpc: '2.0', id: x.id, result: [1001].filter((blk) => blk >= from && blk <= to).map((blk) => ({ topics: ['0x', pad('0x00000000000000000000000000000000000000aa'), pad('0x00000000000000000000000000000000000000bb')], data: '0x' + (10n ** 18n).toString(16), blockNumber: '0x' + blk.toString(16), transactionHash: '0x' + 'ab'.repeat(32) })) };
      }
      return { jsonrpc: '2.0', id: x.id, error: { message: 'unexpected' } };
    };
    return { json: async () => (Array.isArray(body) ? body.map(one) : one(body)) };
  };
  const r = await holdersTick(env, { now: new Date('2026-11-09T12:00:00Z') });
  globalThis.fetch = realFetch;
  const st = JSON.parse(kv.get('holders:state')), BB = '0x' + '0'.repeat(38) + 'bb';
  if (withNr) pin('a range older than its logs is read at NodeReal, not taken empty from publicnode: the old transfer is counted', r.ok === true && BigInt(st.bal[BB] || 0) === E, false);
  else pin('without NodeReal an old range stays unread: nothing applied, the state stays at block 1000', r.ok === false && st.block === 1000 && !st.bal[BB], false);
}
if (process.argv.includes('--live')) {
  const j = await fetch('https://agent.brainonbnb.com/holders?address=0x1afa57').then((r) => r.json()).catch(() => ({}));
  const h = await fetch('https://agent.brainonbnb.com/holders').then((r) => r.json());
  const live = [
    ['read in the last 30 minutes', Date.now() - Date.parse(h.read_at) < 30 * 60e3],
    ['holders and 1M+ are counts, 1M+ <= holders', h.holders > 0 && h.holders_1m > 0 && h.holders_1m <= h.holders],
    ['bands add up', h.bands.reduce((s, b) => s + b.holders, 0) === h.holders],
    ['the top list is sorted and starts at rank 1', h.top[0].rank === 1 && h.top.every((x, i, a) => !i || a[i - 1].bobai >= x.bobai)],
    ['no contract in the top list', !h.top.some((x) => [PAIR, DEAD].includes(x.address))],
    ['a bad address is refused', !!j.error],
    // 4.11.: the tick fell behind 31.10.-3.11. unseen (read_at moved every tick); behind_blocks shows it (~2,000 blocks = 15 min)
    ['the last tick left under 4,000 blocks unread (behind_blocks)', Number.isFinite(h.behind_blocks) && h.behind_blocks < 4000],
    // 4.11.: three buys of 1.11. showed as 3.11. 16:30-17:30 (the catch-up); at is the block's time now, seen_at the tick's
    ['every crossing carries its block time (at) and when it was read (seen_at), at <= seen_at', h.crossings_1m.length > 0 && h.crossings_1m.every((c) => c.seen_at && Date.parse(c.at) <= Date.parse(c.seen_at))],
    ['the 1.11. buy of 0x7dfe…089c shows at its block, 2026-11-01 19:48:02 UTC', h.crossings_1m.some((c) => c.tx === '0xacbfb563684f152df3775e2a676e4cd60d32ac8fb4e8a2ee63de4427ae358786' && c.at === '2026-11-01T19:48:02.000Z')],
  ];
  for (const [n, ok] of live) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  live: ${n}`); }
}
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exit(bad ? 1 : 0);
