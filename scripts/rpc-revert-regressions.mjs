#!/usr/bin/env node
// A revert is an answer, a rate limit is not (dashboard/scanner-chain.js rpc(), 2026-11-15). Every node answers a
// reverting eth_call the same way; asking all five one after the other cost a BTCB preflight 1.4-3.2 s before
// multicall() fell back to its plain batch. Offline: fetch is a fake node set that counts who was asked.
//   node scripts/rpc-revert-regressions.mjs      (self-tests.mjs runs it as it is)
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({
  load(url, ctx, next) { return /\/(dashboard|shared)\/(?:i18n\/)?[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); },
});
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

let mode = 'revert', asked = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init?.body || '{}');
  asked.push({ url: String(url), batch: Array.isArray(body) });
  const reply = (x) => ({ ok: true, json: async () => x });
  if (Array.isArray(body)) return reply(body.map((q) => ({ jsonrpc: '2.0', id: q.id, result: '0x' + '0'.repeat(63) + '7' })));
  if (mode === 'revert') return reply({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted: Multicall3: call failed', data: '0x08c379a0' } });
  if (mode === 'throttle-then-ok') return asked.length === 1 ? reply({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'limit exceeded' } }) : reply({ jsonrpc: '2.0', id: body.id, result: '0x2a' });
  return reply({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'header not found' } });
};
const C = await import(pathToFileURL(path.resolve(import.meta.dirname, '../dashboard/scanner-chain.js')).href);

mode = 'revert'; asked = [];
let err = null; try { await C.rpc('eth_call', [{ to: '0x' + '1'.repeat(40), data: '0x0902f1ac' }, 'latest']); } catch (e) { err = e; }
ok('a revert is answered by the first node, not asked of all of them', asked.length === 1, `${asked.length} nodes asked`);
ok('… and comes back as a revert, with its data', err?.reverted === true && /Multicall3/.test(err?.message) && err?.data === '0x08c379a0', String(err?.message));

mode = 'throttle-then-ok'; asked = [];
const got = await C.rpc('eth_blockNumber', []).catch((e) => 'ERR ' + e.message);
ok('a rate limit still moves on to the next node', got === '0x2a' && asked.length === 2, `${got} after ${asked.length}`);

mode = 'other'; asked = [];
err = null; try { await C.rpc('eth_blockNumber', []); } catch (e) { err = e; }
ok('any other error still tries every node before it gives up', asked.length >= 5 && /every BSC endpoint refused/.test(err?.message || ''), `${asked.length} nodes, ${err?.message}`);

mode = 'revert'; asked = [];
const mc = await C.multicall([{ to: '0x' + '2'.repeat(40), data: '0x0902f1ac' }, { to: '0x' + '3'.repeat(40), data: '0x0dfe1681' }]);
ok('a multicall whose read reverts falls back to the plain batch after ONE aggregate call', asked.filter((a) => !a.batch).length === 1 && asked.filter((a) => a.batch).length === 1 && mc.length === 2, JSON.stringify(asked.map((a) => a.batch ? 'batch' : 'single')));

console.log(`\nrpc-revert: ${fails ? fails + ' FAIL' : 'all pins hold'}`);
process.exit(fails ? 1 : 0);
