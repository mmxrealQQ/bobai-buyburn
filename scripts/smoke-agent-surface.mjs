// End-to-end check of everything this project offers a machine.
//
// Written because "it worked when I built it" is not a state you can hand to
// other people's agents. Every check reads a response BODY, never a status
// code: brainonbnb.com answers any unrouted path with 200 and the dashboard
// HTML, so a status-only check reports success for endpoints that do not exist.
//
// Run: node scripts/smoke-agent-surface.mjs
const SITE = 'https://brainonbnb.com';
// Identifies this run to the dashboard worker, which then leaves the public
// counters alone. Without it, running the suite adds ~40 requests of our own
// to a figure that is supposed to mean "asked for by other people".
const UA = { 'user-agent': 'bobai-smoke-test' };
const _fetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) =>
  _fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });
const AGENT = 'https://agent.brainonbnb.com';

let pass = 0;
const fails = [];

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push([name, detail]); console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
};

const getText = async (url, init) => {
  const r = await fetch(url, init);
  const body = await r.text();
  const isHtml = /^\s*<!doctype html/i.test(body);
  return { r, body, isHtml };
};

const section = (t) => console.log(`\n${t}`);

// ---- the free surface ----------------------------------------------------
section('Free surface');
{
  const { r, body, isHtml } = await getText(`${SITE}/skill.md`);
  ok('skill.md serves markdown', r.ok && !isHtml && body.startsWith('#'));
}
{
  const r = await fetch(`${SITE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const j = await r.json().catch(() => ({}));
  const tools = j.result?.tools || [];
  ok('MCP lists tools', tools.length >= 14, `${tools.length} tools`);

  // Every tool actually called, not just listed. A tool that lists but throws
  // is worse than one that is missing.
  let good = 0;
  const broken = [];
  for (const t of tools) {
    const args = t.name === 'bobai_wallet_balance' ? { address: '0x0000000000000000000000000000000000000001' } : {};
    const res = await fetch(`${SITE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: t.name, arguments: args } }),
    }).then((x) => x.json()).catch(() => ({}));
    const txt = res.result?.content?.[0]?.text || '';
    if (!res.error && txt && !/"error"/.test(txt)) good++;
    else broken.push(t.name);
  }
  ok('every MCP tool returns data', broken.length === 0, broken.join(', '));
}
for (const p of ['/api/price', '/api/liquidity', '/api/token', '/api/activity', '/api/tokenomics', '/api/trade', '/api/links', '/api/guide', '/api/how-to-buy', '/api/smart-money', '/api/nft-drop']) {
  const { r, body, isHtml } = await getText(SITE + p);
  let parsed = false;
  try { JSON.parse(body); parsed = true; } catch {}
  ok(`REST ${p}`, r.ok && !isHtml && parsed);
}
{
  const { r, body, isHtml } = await getText(`${SITE}/api/circulating-supply`);
  ok('REST /api/circulating-supply is a bare number', r.ok && !isHtml && /^\d+$/.test(body.trim()));
}

// ---- discovery and the installable skill ---------------------------------
section('Discovery & skill');
for (const p of ['/.well-known/agent-skills/index.json', '/.well-known/skills/index.json', '/.well-known/agent-card.json']) {
  const { r, body, isHtml } = await getText(SITE + p);
  let j = null;
  try { j = JSON.parse(body); } catch {}
  ok(`${p} serves JSON`, r.ok && !isHtml && !!j);
}
{
  const j = await fetch(`${SITE}/.well-known/skills/index.json`).then((r) => r.json()).catch(() => null);
  const entry = j?.skills?.[0];
  ok('manifest carries the discovery $schema', j?.$schema === 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  ok('manifest entry has type + digest', entry?.type === 'archive' && /^sha256:[a-f0-9]{64}$/.test(entry?.digest || ''));

  const r = await fetch(entry?.url || `${SITE}/skills/bsc-pool-depth.tar.gz`);
  const buf = Buffer.from(await r.arrayBuffer());
  const { createHash } = await import('node:crypto');
  const got = 'sha256:' + createHash('sha256').update(buf).digest('hex');
  ok('tarball is served and matches its digest', r.ok && got === entry?.digest, got === entry?.digest ? '' : 'digest mismatch — redeploy after rebuilding');
  ok('tarball is gzip, not the HTML fallback', buf[0] === 0x1f && buf[1] === 0x8b);
}

// ---- the paid surface ----------------------------------------------------
section('Paid surface');
{
  const { r, body } = await getText(`${AGENT}/`);
  let j = null; try { j = JSON.parse(body); } catch {}
  ok('agent service root answers', r.ok && !!j?.capabilities);
}
{
  const r = await fetch(`${AGENT}/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', depthBelowUsd: 5000 }),
  });
  const hdr = r.headers.get('PAYMENT-REQUIRED');
  let decoded = null;
  try { decoded = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch {}
  ok('unpaid request answers 402', r.status === 402, `got ${r.status}`);
  ok('PAYMENT-REQUIRED header decodes', !!decoded?.accepts?.length);
  ok('accepts names USD1 on BSC', decoded?.accepts?.[0]?.network === 'eip155:56'
    && (decoded?.accepts?.[0]?.asset || '').toLowerCase() === '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d');
  ok('payTo is set', /^0x[a-fA-F0-9]{40}$/.test(decoded?.accepts?.[0]?.payTo || ''));
}
// Payment verification must refuse everything that is not a real payment to us.
for (const [label, sig, want] of [
  ['garbage hash', 'not-a-hash', /malformed/],
  ['invented hash', '0x' + '11'.repeat(32), /not found/],
  // A real, confirmed 96 USD1 transfer — to somebody else. The one case a
  // naive implementation waves through.
  ['real payment to a stranger', '0xe206ac61b08090b356670c081da260abebc11e449f7d39f8f9d2646c4e59ab76', /need 0\.50/],
]) {
  const j = await fetch(`${AGENT}/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': sig },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', depthBelowUsd: 5000 }),
  }).then((r) => r.json()).catch(() => ({}));
  ok(`rejects ${label}`, want.test(j.reason || ''), j.reason || 'no reason given');
}
{
  const r = await fetch(`${AGENT}/hit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"x"}' });
  ok('counter endpoint refuses without the secret', r.status === 403, `got ${r.status}`);
  const r2 = await fetch(`${AGENT}/run-checks`, { method: 'POST' });
  ok('sweep trigger refuses without the secret', r2.status === 403, `got ${r2.status}`);
}

// ---- the public numbers --------------------------------------------------
section('Transparency');
{
  const j = await fetch(`${AGENT}/stats`).then((r) => r.json()).catch(() => null);
  ok('/stats answers', !!j);
  ok('counts requests by others separately from our own sweeps',
    j?.asked?.by_kind && !('watch_checks' in j.asked.by_kind));
  ok('states the money flow', Object.keys(j?.money_flow || {}).length >= 4);
  ok('flow admits the manual step', /by hand/i.test(j?.money_flow?.note || ''));
  ok('lists free and paid capabilities', (j?.capabilities?.free || []).length >= 4 && (j?.capabilities?.paid || []).length >= 1);
}
{
  const { body } = await getText(`${SITE}/`);
  ok('page carries the Agents block', /Block 05 &middot; Agents/.test(body));
  ok('nav links to it', /href="#agents"/.test(body));
  const csp = (await fetch(`${SITE}/`)).headers.get('content-security-policy') || '';
  ok('CSP allows the stats endpoint', csp.includes('https://agent.brainonbnb.com'));
}
{
  const { r, body, isHtml } = await getText(`${SITE}/_mobtest.html`);
  ok('temporary test harness is gone', !r.ok || isHtml, 'still served');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(([n, d]) => console.log(`  - ${n}${d ? ': ' + d : ''}`)); process.exit(1); }
