// List one of our ERC-8004 agents on Marque (marque.trade/builders), the five
// checks its builder page runs, from a script. Read out of the live page
// 2026-10-04: claim/identity -> personal_sign of its message by the owner ->
// claim/verify (claimToken) -> probe (callable) -> declare (category) ->
// claim/test (the category's assertion test, e.g. MCS-REB-1). One off-chain
// signature by the owner wallet; no transaction, nothing spent.
// Usage (repo root): node scripts/bnb-sdk/list-marque.mjs <tokenId> <endpoint> <category>
import path from 'node:path';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const SITE = 'https://marque.trade';
const TESTS = { yield: 'MCS-YIELD-1', grid: 'MCS-GRID-1', rebalancing: 'MCS-REB-1', health_factor: 'MCS-HF-1' };
const [tokenId, endpoint, category] = process.argv.slice(2);
if (!/^\d+$/.test(tokenId || '') || !/^https:\/\//.test(endpoint || '') || !TESTS[category]) {
  console.log('usage: node scripts/bnb-sdk/list-marque.mjs <tokenId> <https endpoint> <yield|grid|rebalancing|health_factor>');
  process.exit(1);
}
const pk = process.env.AGENT_PROVIDER_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const post = async (p, body) => {
  const r = await fetch(SITE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
};

const id = await post('/api/v1/builders/claim/identity', { input: tokenId, chainId: 56 });
if (!id.ok) { console.log('identity:', id.j.detail || JSON.stringify(id.j)); process.exit(1); }
console.log(`identity     #${tokenId} agentId ${id.j.identity?.agentId}`);
console.log(`message      ${String(id.j.message).split('\n')[0].slice(0, 100)}…`);
const signature = await account.signMessage({ message: id.j.message });
const ver = await post('/api/v1/builders/claim/verify', { agentId: id.j.identity.agentId, nonceToken: id.j.nonceToken, message: id.j.message, signature });
if (!ver.ok) { console.log('verify:', ver.j.detail || JSON.stringify(ver.j)); process.exit(1); }
const claimToken = ver.j.claimToken;
console.log('proved       ownership signed by', account.address);
const probe = await post('/api/v1/builders/probe', { chainId: 56, tokenId, endpoint });
console.log('callable    ', probe.j.ok ? `answered in ${probe.j.latencyMs} ms` : `NO (${probe.j.liveness}): ${probe.j.detail || JSON.stringify(probe.j).slice(0, 200)}`);
const dec = await post('/api/v1/builders/declare', { claimToken, category });
console.log('classified  ', dec.ok ? `declared ${category}` : `NO: ${dec.j.detail || JSON.stringify(dec.j).slice(0, 200)}`);
const test = await post('/api/v1/builders/claim/test', { claimToken, endpoint, testId: TESTS[category], kind: /\/mcp\b/i.test(endpoint) ? 'mcp' : 'a2a' });
if (!test.ok) console.log('tested       NO:', test.j.detail || JSON.stringify(test.j).slice(0, 300));
else if (test.j.error) console.log(`tested       ${TESTS[category]}: no gradable answer (${String(test.j.error).slice(0, 300)})`);
else console.log(`tested       ${TESTS[category]}: ${test.j.pass ? 'passed every field' : 'failed fields: ' + JSON.stringify((test.j.diffs || []).filter((d) => !d.pass)).slice(0, 600)}`);
const checks = await (await fetch(`${SITE}/api/v1/builders/checks?wallet=${account.address}&chainId=56&tokenId=${tokenId}`)).json().catch(() => null);
console.log('checks      ', JSON.stringify(checks?.identities?.[0]?.checks ?? checks).slice(0, 700));
