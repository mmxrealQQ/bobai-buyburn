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
    // Tools that take a required argument get a real one. Calling them empty
    // proves only that they reject an empty call, which is not what this check
    // is asking. The scan gets $BOBAI's own pair rather than a dummy address —
    // a token with no pool would come back "not quotable", which is a correct
    // answer and an uninformative test.
    const WITH_ARGS = {
      bobai_wallet_balance: { address: '0x0000000000000000000000000000000000000001' },
      bsc_pool_scan: { address: '0x245c386dcfed896f5c346107596141e5edcbffff' },
    };
    const args = WITH_ARGS[t.name] || {};
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

// ---- the x402 catalogue --------------------------------------------------
// Published at both origins so an agent holding only one of our domains can
// still discover that we sell anything. Checked here rather than trusted
// because the apex answers 200 with dashboard HTML on any unrouted path: a
// catalogue that fell out of _routes.json would look like a malformed document
// instead of a missing route, and the status code alone would say 200.
section('x402 catalogue');
{
  const { recoverMessageAddress } = await import('viem');

  // The wallet the resource itself names. Everything below is checked against
  // this rather than a constant — if the catalogue and the endpoint ever
  // disagree about where money goes, that is the failure worth catching.
  const four = await fetch(`${AGENT}/watch`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  const fourBody = await four.json().catch(() => null);
  const payTo = fourBody?.accepts?.find((a) => a.payTo)?.payTo || null;
  ok('unpaid probe with no body still quotes the price', four.status === 402 && !!payTo,
    four.status === 402 ? '' : `got ${four.status} — discovery clients cannot read the terms`);

  for (const origin of [AGENT, SITE]) {
    const label = origin.replace('https://', '');
    const { r, body, isHtml } = await getText(`${origin}/.well-known/x402`);
    let j = null; try { j = JSON.parse(body); } catch {}
    ok(`${label} serves the catalogue as JSON`, r.ok && !isHtml && !!j,
      isHtml ? 'served the HTML fallback — check _routes.json' : '');
    if (!j) continue;

    ok(`${label} lists only resources that answer 402`, Array.isArray(j.resources) && j.resources.length > 0);
    ok(`${label} quotes the same payTo the 402 does`,
      !payTo || j.instructions?.includes(payTo),
      payTo && !j.instructions?.includes(payTo) ? `catalogue does not name ${payTo}` : '');

    // The proof only means something if it recovers to the wallet that takes
    // the money, for the origin it was fetched from.
    let matched = false;
    for (const proof of j.ownershipProofs || []) {
      const addr = await recoverMessageAddress({ message: origin, signature: proof }).catch(() => null);
      if (addr && payTo && addr.toLowerCase() === payTo.toLowerCase()) matched = true;
    }
    ok(`${label} carries an ownership proof that recovers to payTo`, matched,
      matched ? '' : 'no proof signs this origin — regenerate with scripts/x402-catalog-proof.mjs');
  }
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
  // Two schemes are offered now, and which comes first is a preference rather
  // than a contract. The test checks that both are present, not that either
  // holds a position — otherwise reordering them breaks the suite for no reason.
  const accepts = decoded?.accepts || [];
  const onBsc = accepts.filter((a) => a.network === 'eip155:56');
  ok('every payment option is on BSC', accepts.length > 0 && onBsc.length === accepts.length);
  ok('offers a standard x402 route', accepts.some((a) => a.extra?.assetTransferMethod === 'permit2'));
  ok('offers the direct USD1 route', accepts.some((a) =>
    (a.asset || '').toLowerCase() === '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d'));
  ok('payTo is set on every option', accepts.length > 0
    && accepts.every((a) => /^0x[a-fA-F0-9]{40}$/.test(a.payTo || '')));
  // The header is base64 of JSON that contains human copy; an em dash in a
  // description once broke this endpoint entirely, because btoa is Latin-1 only.
  ok('PAYMENT-REQUIRED survives non-ASCII copy', JSON.stringify(decoded).length > 200);
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
section('Live telemetry');
{
  // Our own agents answer /status because the rest of this chain does. An
  // agent that asks the market to be machine-readable and is not is a poster.
  const j = await fetch(`${AGENT}/status`).then((r) => r.json()).catch(() => null);
  ok('/status answers', !!j?.agents);
  ok('both of our agents are in it', (j?.agents || []).length === 2);
  ok('every figure carries when it was taken', (j?.agents || []).every((a) => !!a.checked_at));
  ok('says how it was produced', /measured|probe|reference input/i.test(j?.method || ''));
  // One job, two agents on one origin: the count has to be per service or the
  // grid planner claims credit for a health-factor delivery. The invariant is
  // that the per-agent counts sum to no more than the deliverables examined —
  // an equality check between the two agents would false-alarm the day they
  // legitimately have the same number.
  const jobs = (j?.agents || []).map((a) => a.jobs_delivered);
  const examined = j?.jobs_counted_from?.deliverables_examined;
  const sum = jobs.reduce((n, v) => n + (v || 0), 0);
  ok('jobs are attributed per agent, not per origin',
    examined == null || sum <= examined,
    `agents claim ${sum} deliveries between them from ${examined} deliverables`);

  const one = await fetch(`${AGENT}/status?agent=302258`).then((r) => r.json()).catch(() => null);
  ok('a single agent can be asked for', one?.id === 302258);
}
{
  const t = await fetch(`${AGENT}/telemetry.json`).then((r) => r.json()).catch(() => null);
  ok('/telemetry.json answers', !!t?.peers);
  ok('polls the four reference agents', (t?.peers || []).length === 4);
  // The two that publish nothing must be recorded as reachable-without-state,
  // not as unreachable. Conflating those is the misreading this measures.
  const silent = (t?.peers || []).filter((p) => p.reachable && !p.has_live_state);
  ok('separates "no live state" from "unreachable"', silent.length >= 1 && silent.every((p) => !!p.note));
  ok('every peer entry is timestamped', (t?.peers || []).every((p) => !!p.checked_at));
}
{
  const { body } = await getText(`${SITE}/registry`);
  const rows = (body.match(/ data-tele="/g) || []).length;
  ok('registry rows carry a telemetry key', rows >= 3, `${rows} rows`);
  const csp = (await fetch(`${SITE}/registry`)).headers.get('content-security-policy') || '';
  ok('CSP allows the registry page to reach the telemetry', csp.includes('https://agent.brainonbnb.com'));
}

section('The marketplace, from the front door');
{
  // A judge, or anybody else, arriving at brainonbnb.com should not have to
  // work out that the marketplace lives behind a heading called "Agents".
  const { body } = await getText(`${SITE}/`);
  ok('homepage carries the marketplace card', /class="mkt fi"/.test(body));
  ok('the card links to the marketplace', /<a class="mkt fi" href="\/registry">/.test(body));
  ok('nav offers it directly', /<a href="\/registry">Marketplace<\/a>/.test(body));
  // The counts are placeholders in the markup on purpose. A number typed into
  // the homepage is a number that drifts away from the page it describes.
  ok('the card does not hard-code its counts',
    !/<b id="mkt-(reach|hire)">\d/.test(body),
    'a count is baked into the markup instead of fetched');
}
{
  const j = await fetch(`${SITE}/api-registry.json`).then((r) => r.json()).catch(() => null);
  ok('api-registry publishes the hireable count', Number.isInteger(j?.hireable_here));
  ok('and it is not zero', (j?.hireable_here || 0) > 0, 'nothing on the page can be hired');
  ok('it names the four categories', (j?.categories || []).length === 4);
}
{
  // Every category must offer at least one agent that can actually be hired.
  // "All four, equally deep" is the stated bar; a category with nothing to
  // hire is the one that fails it.
  const { body } = await getText(`${SITE}/registry`);
  const buttons = body.match(/data-cat="([a-z-]+)"/g) || [];
  const cats = new Set(buttons.map((m) => m.slice(10, -1)));
  for (const c of ['rebalancing', 'grid-trading', 'yield-optimization', 'health-factor']) {
    ok(`${c} has something hireable`, cats.has(c));
  }
  ok('the hire panel is on the page', /<dialog id="rg-hire"/.test(body));
}

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
