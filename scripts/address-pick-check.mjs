#!/usr/bin/env node
// The address inside what was sent (2026-11-05): bad_address was the most common refusal of the measurements.
// Offline pins on pickAddress / addressShape (dashboard/_worker.js); with --live, the preflight over MCP and REST
// given a bscscan link must answer, and a symbol must still be refused.
import path from 'node:path';
import { registerHooks } from 'node:module';
// dashboard/*.js are ES modules under a package.json that does not say so (as in stats-detail-regressions)
registerHooks({ load(url, context, nextLoad) { return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? nextLoad(url, { ...context, format: 'module' }) : nextLoad(url, context); } });
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pickAddress, addressShape } = await import(pathToFileURL(path.join(ROOT, 'dashboard/_worker.js')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', C2 = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';

ok('a clean address stays as it is (case kept)', pickAddress(C2) === C2);
ok('padded or quoted', pickAddress(`  ${CAKE} `) === CAKE && pickAddress(`"${CAKE}"`) === CAKE);
ok('a bscscan link', pickAddress(`https://bscscan.com/token/${C2}`) === CAKE);
ok('bsc:0x… and a sentence', pickAddress(`bsc:${CAKE}`) === CAKE && pickAddress(`check ${CAKE} please`) === CAKE);
ok('the same address twice is one', pickAddress(`${CAKE} / ${C2}`) === CAKE);
ok('two different addresses stay as sent (no guess)', pickAddress(`${CAKE} ${'0x' + '1'.repeat(40)}`) === `${CAKE} ${'0x' + '1'.repeat(40)}`);
ok('a tx hash is not cut into an address', pickAddress('0x' + 'a'.repeat(64)) === '0x' + 'a'.repeat(64));
ok('a symbol is never turned into an address', pickAddress('CAKE') === 'CAKE' && pickAddress('$BOBAI') === '$BOBAI');
ok('shapes: empty, symbol, hex_short, tx_hash, number, two_addresses, other',
  addressShape('') === 'empty' && addressShape('CAKE') === 'symbol' && addressShape('$BOBAI') === 'symbol' && addressShape('0x1234') === 'hex_short'
  && addressShape('0x' + 'a'.repeat(64)) === 'tx_hash' && addressShape('12345') === 'number'
  && addressShape(`${CAKE} ${'0x' + '1'.repeat(40)}`) === 'two_addresses' && addressShape('what is cake?') === 'other',
  ['', 'CAKE', '0x1234', '12345', 'what is cake?'].map(addressShape).join());

if (process.argv.includes('--live')) {
  const UA = { 'user-agent': 'brainonbnb-address-pick-check/1' };
  const mcp = async (args) => (await (await fetch('https://brainonbnb.com/mcp', { method: 'POST', headers: { ...UA, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bsc_token_preflight', arguments: args } }) })).json()).result;
  const a = await mcp({ address: `https://bscscan.com/token/${C2}`, usd: 100 });
  ok('live MCP: a bscscan link gets a preflight', !a?.isError && /"gate"/.test(a?.content?.[0]?.text || ''), (a?.content?.[0]?.text || '').slice(0, 80));
  const b = await mcp({ address: 'CAKE' });
  ok('live MCP: a symbol is still refused as bad_address', b?.isError && b?.structuredContent?.code === 'bad_address', b?.structuredContent?.code);
  const r = await fetch(`https://brainonbnb.com/api/fee-tiers?address=${encodeURIComponent('bsc:' + CAKE)}`, { headers: UA });
  ok('live REST: fee-tiers with bsc:0x… answers 200', r.status === 200, String(r.status));
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
