#!/usr/bin/env node
// The public settle must read its candidates even when a node rate-limits the batch (2026-10-22). The first run
// (21.10. 21:15 UTC) read none of 405: bsc-dataseed and defibit answer a 50-call batch with an ARRAY holding one
// "method eth_call in batch triggered rate limit" error, batchRead took that as the answer and never asked publicnode.
// Held against: a stubbed fetch (first two nodes rate-limit, the third answers) — every job must come back read;
// and live, the real three nodes on 50 real job ids — every one read.
import { batchRead } from '../worker-agent/public-settle.js';

let pass = 0, fail = 0;
const ok = (name, good, detail = '') => { good ? pass++ : fail++; console.log(`${good ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const ids = Array.from({ length: 50 }, (_, k) => String(56000 + k));
const realFetch = globalThis.fetch;

// stub: the nodes as they answered on 22.10.
let asked = [];
globalThis.fetch = async (url, init) => {
  asked.push(url);
  if (/publicnode/.test(url)) return realFetch(url, init);
  return new Response(JSON.stringify([{ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'method eth_call in batch triggered rate limit' } }]), { headers: { 'content-type': 'application/json' } });
};
const stubbed = await batchRead(ids);
globalThis.fetch = realFetch;
const readS = stubbed.filter((x) => x.job).length;
ok('a rate-limited batch is not taken as the answer: the next node is asked', asked.some((u) => /publicnode/.test(u)), asked.join(' -> '));
ok('every job is read when the first two nodes rate-limit', readS === ids.length, `${readS} of ${ids.length}`);

const live = await batchRead(ids);
const readL = live.filter((x) => x.job).length;
ok('live: the three real nodes read all 50 jobs', readL === ids.length, `${readL} of ${ids.length}`);

// 2026-10-23: the run of 22.10. 21:15 read 17 of 417 — the public nodes rate-limit a run of batches after the first.
// The run must read through the keyed node first (as the job board does) and only fall back to the public ones.
// Held against: a stubbed fetch where every public node rate-limits and only the keyed node answers.
const keyedUrl = 'https://keyed.test/rpc';
const many = Array.from({ length: 420 }, (_, k) => String(56000 + k));
const askedK = [];
globalThis.fetch = async (url, init) => {
  askedK.push(url);
  if (url !== keyedUrl) return new Response(JSON.stringify([{ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'method eth_call in batch triggered rate limit' } }]), { headers: { 'content-type': 'application/json' } });
  const calls = JSON.parse(init.body);
  // a job struct with a non-zero id: decodeJob must accept it (fields beyond the id stay zero)
  return new Response(JSON.stringify(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: '0x' + '0'.repeat(63) + '1' + '0'.repeat(64 * 15) }))), { headers: { 'content-type': 'application/json' } });
};
let viaKeyed = [];
try { viaKeyed = await (await import('../worker-agent/public-settle.js')).readJobs?.(many, { BSC_RPC_KEYED_URL_2: keyedUrl }) || []; } catch { viaKeyed = []; }
globalThis.fetch = realFetch;
const readK = viaKeyed.filter((x) => x.job).length;
ok('the daily run reads through the keyed node when the public nodes rate-limit', readK === many.length, `${readK} of ${many.length}`);
ok('the keyed node is asked before any public node', askedK[0] === keyedUrl, String(askedK[0]));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
