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

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
