#!/usr/bin/env node
// scripts/holder-pass-check.mjs — the $BOBAI holder pass on the live services (2026-10-16)
//
// Live, with a fresh key that holds no $BOBAI (nothing is sent, a signature only): the paid answer and the pool watch
// read a holder proof where a payment goes and refuse it for the reason that is true — below the line, another signer,
// too old — not as an unreadable payment; their 402s carry the terms; the pool scan's offer names the pass. The
// accepting path (a wallet at the line) is pinned offline in holder-pass-regressions.mjs: no wallet of ours with a
// local key holds 1,000,000 $BOBAI.
//
//   node scripts/holder-pass-check.mjs      exit 1 on any FAIL
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const AGENT = 'https://agent.brainonbnb.com';
const H = { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' };
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const msg = (w, issued) => `BOBAI holder pass\nwallet: ${w}\nissued: ${issued}`;
const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey());
const w = a.address.toLowerCase();
const proof = async (signer, issued = new Date().toISOString()) => `bobai-holder ${w} ${issued} ${await signer.signMessage({ message: msg(w, issued) })}`;
const post = async (url, body, sig) => {
  const r = await fetch(url, { method: 'POST', headers: { ...H, ...(sig ? { 'PAYMENT-SIGNATURE': sig } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const ANSWER = `${AGENT}/answer?service=grid_plan`, TASK = { task: 'grid plan for WBNB/USDT, 8% either side, 10 levels, 1000 USD' };
const WATCH = `${AGENT}/watch`, SPEC = { token: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', depthBelowUsd: 1000 };

{
  const { status, j } = await post(ANSWER, TASK);
  check(status === 402 && /1,000,000 \$BOBAI/.test(j.holder_pass?.line || '') && /bobai-holder/.test(j.holder_pass?.how || ''), 'answer 402 carries the holder pass terms', j.holder_pass ? j.holder_pass.allowance : 'no holder_pass');
}
{
  const { status, j } = await post(WATCH, SPEC);
  check(status === 402 && /bobai-holder/.test(j.holder_pass?.how || ''), 'watch 402 carries the holder pass terms', j.holder_pass ? 'present' : 'no holder_pass');
}
{
  const { status, j } = await post(ANSWER, TASK, await proof(a));
  check(status === 402 && j.code === 'below_line', 'answer: a wallet under the line is refused as below_line', `${status} ${j.code || j.reason || j.error}`);
}
{
  const { status, j } = await post(WATCH, SPEC, await proof(a));
  check(status === 402 && j.code === 'below_line', 'watch: the same', `${status} ${j.code || j.reason || j.error}`);
}
{
  const { status, j } = await post(ANSWER, TASK, await proof(b));
  check(status === 402 && j.code === 'wrong_signer', 'answer: another wallet\'s signature is refused as wrong_signer', `${status} ${j.code || j.reason || j.error}`);
}
{
  const { status, j } = await post(ANSWER, TASK, await proof(a, new Date(Date.now() - 20 * 60e3).toISOString()));
  check(status === 402 && j.code === 'stale_proof', 'answer: a 20-minute-old proof is refused as stale_proof', `${status} ${j.code || j.reason || j.error}`);
}
{
  const r = await fetch(`${AGENT}/tip?usd=1`, { headers: { ...H, 'PAYMENT-SIGNATURE': await proof(a) } });
  const j = await r.json().catch(() => ({}));
  check(r.status !== 200 && !/thank/i.test(j.message || ''), 'a tip is not taken by a holder pass', `${r.status} ${j.code || j.reason || j.error || ''}`);
}
{
  const j = await (await fetch('https://brainonbnb.com/api/pool-scan?address=0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', { headers: H })).json().catch(() => null);
  check(/1,000,000 \$BOBAI/.test(j?.watch_this_pool?.price || ''), 'the pool scan\'s watch offer names the holder pass', String(j?.watch_this_pool?.price || 'no offer').slice(0, 90));
}
{
  const t = await (await fetch('https://brainonbnb.com/llms.txt')).text();
  check(/\$BOBAI holder pass/.test(t) && /bobai-holder <address> <issued> <signature>/.test(t), 'llms.txt says how to use it');
}
// WHERE BUYERS LOOK (2026-10-16): the pass is only worth something if it is seen before a hire. The seven A2A cards
// carry holder_pass and say it at the price; each agent's own MCP names it in its paid tool (Mandate reads that
// list); the six agents' entries in the official MCP registry say it in their description.
const SLUGS = ['defi-agent', 'health-factor', 'grid-trader', 'yield-optimizer', 'rebalancer', 'lp-placement'];
{
  const main = await (await fetch(`${AGENT}/.well-known/agent-card.json`, { headers: H })).json().catch(() => ({}));
  check(/bobai-holder/.test(main.holder_pass?.how || '') && /not the ERC-8183 escrow/.test(main.holder_pass?.applies_to || ''), 'the main A2A card carries holder_pass and says what it covers');
  for (const slug of SLUGS) {
    const c = await (await fetch(`${AGENT}/${slug}/.well-known/agent-card.json`, { headers: H })).json().catch(() => ({}));
    const sk = (c.skills || []).find((s) => /1,000,000 \$BOBAI/.test(s.price || ''));
    check(!!c.holder_pass?.how && !!sk && /\/answer\?service=/.test(c.holder_pass?.x402 || ''), `${slug}: card carries holder_pass, the price names it`, sk ? sk.id : 'no price names it');
  }
  for (const slug of SLUGS) {
    const r = await (await fetch(`${AGENT}/${slug}/mcp`, { method: 'POST', headers: { ...H, accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json().catch(() => ({}));
    const paid = (r.result?.tools || [])[1];
    check(/1,000,000 \$BOBAI/.test(paid?.description || ''), `${slug}: its MCP's paid tool names the pass`, paid ? paid.name : 'no paid tool');
  }
  const reg = await (await fetch('https://registry.modelcontextprotocol.io/v0/servers?search=com.brainonbnb&version=latest', { headers: H })).json().catch(() => ({}));
  // every version comes back; the one the registry marks isLatest is what a client shows
  const isLatest = (x) => !!(x._meta || x.server?._meta || {})['io.modelcontextprotocol.registry/official']?.isLatest;
  const latest = new Map((reg.servers || []).filter(isLatest).map((x) => x.server || x).map((x) => [x.name, x]));
  for (const slug of SLUGS) {
    const e = latest.get(`com.brainonbnb/${slug}`);
    check(/1M \$BOBAI/.test(e?.description || ''), `MCP registry com.brainonbnb/${slug}: the description names the pass`, e ? `${e.version}: ${e.description}` : 'not found');
  }
}
console.log(`holder-pass live: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
