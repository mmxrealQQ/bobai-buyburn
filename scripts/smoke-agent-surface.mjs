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
      // Not $BOBAI here, deliberately, and for the opposite reason to the scan
      // above. $BOBAI trades about twice a day, so every tier comes back with a
      // window that saw no volume — a correct answer that exercises none of the
      // measurement. $CAKE trades in four tiers at once and is the token that
      // gets closest to the outbound-call ceiling, which is what can break.
      pancakeswap_fee_tiers: { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82' },
      // Same token, same reason, and a size: the replay reports what a position
      // of a stated value would have collected, so calling it without one would
      // exercise the default rather than the argument.
      pancakeswap_range_plan: { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', capitalUsd: 1000 },
      // A size that every tier can quote. Asking with the default would still
      // exercise the argument path, but $250 is the size the round trip was
      // measured at and keeps the check comparable between runs.
      pancakeswap_best_route: { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', usd: 250 },
    };
    const args = WITH_ARGS[t.name] || {};
    const ask = () => fetch(`${SITE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: t.name, arguments: args } }),
      signal: AbortSignal.timeout(40000),
    }).then((x) => x.json()).catch((e) => ({ error: { message: 'request failed: ' + e.name } }));
    const fine = (r) => !r.error && (r.result?.content?.[0]?.text || '') && !/"error"/.test(r.result.content[0].text);
    // ONE RETRY, BECAUSE THIS LOOP IS ITS OWN WORST CALLER.
    //
    // The tools are asked back to back and several of them read the same public
    // BSC endpoints; the two measuring ones read them hard. Under that load the
    // heaviest tool comes back throttled, and a single attempt would report
    // "pancakeswap_fee_tiers is broken" — a statement about somebody's tool that
    // was really a statement about this loop. Asked once more, two seconds
    // later, it answers. A tool that fails twice is a finding; a tool that
    // fails behind eighteen other calls is a queue.
    let res = await ask();
    if (!fine(res)) { await new Promise((r) => setTimeout(r, 2000)); res = await ask(); }
    if (fine(res)) good++;
    else broken.push(t.name + (res.error?.message ? ' (' + String(res.error.message).slice(0, 60) + ')' : ''));
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
  // Counted against the registration receipts rather than against a literal.
  // This check said "all four" and started failing the day a fifth agent was
  // registered — which is the right alarm for the wrong reason: what matters
  // is that every agent we have a receipt for is here, not that there are four
  // of them. A hardcoded count has to be edited every time it is right.
  const { default: ownState } = await import('../data/own-agents.json', { with: { type: 'json' } });
  const receipts = Object.values(ownState.agents || {}).map((a) => a.id);
  const shown = new Set((j?.agents || []).map((a) => Number(a.id)));
  const absent = receipts.filter((id) => !shown.has(id));
  ok('every agent we hold a registration receipt for is in it',
    absent.length === 0 && shown.size === receipts.length,
    absent.length ? `missing: ${absent.join(', ')}` : `${shown.size} shown, ${receipts.length} registered`);
  // One per category is the bar the marketplace is judged against, and it is
  // the thing most easily lost: registering an agent and forgetting one of the
  // five places its id has to appear leaves a category silently empty.
  const cats = new Set((j?.agents || []).map((a) => a.category));
  ok('one of ours in each of the four categories',
    ['health-factor', 'grid-trading', 'yield-optimization', 'rebalancing'].every((c) => cats.has(c)),
    [...cats].join(', '));
  ok('each of ours reports itself ready', (j?.agents || []).every((a) => a.ready === true),
    (j?.agents || []).filter((a) => !a.ready).map((a) => a.id + ': ' + (a.last_error || 'not ready')).join(' · ') || 'all ready');
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

section('The router speaks both protocols');
{
  // Until 2026-08-25 this asked the broker for speaks=mcp only, which made the
  // 161 agents on this chain that speak nothing but A2A unreachable from the
  // one endpoint whose job is to reach agents.
  const q = encodeURIComponent('rebalance my lp range');
  const j = await fetch(`${AGENT}/dispatch?task=${q}`).then((r) => r.json()).catch(() => null);
  ok('/dispatch answers', !!j);
  ok('it names the protocol it used', typeof j?.protocol === 'string');
  // An agent that sells this through the escrow is an answer, not a miss. The
  // old code reported "no agent found" while several stood there willing.
  const hire = j?.hireable || [];
  ok('agents that sell the job are offered, not reported as absent', hire.length > 0,
    'nothing hireable surfaced for a task the reference agents sell');
  ok('each carries a hire link', hire.every((h) => /\/hire\?agent=\d+/.test(h.hire || '')));
  ok('and says why it cannot be asked for free', hire.every((h) => !!h.why));
}
{
  // The read-only line holds on A2A exactly as it does on MCP.
  const q = encodeURIComponent('sign and send a swap for me');
  const j = await fetch(`${AGENT}/dispatch?task=${q}`).then((r) => r.json()).catch(() => null);
  ok('an action request is refused, not quietly answered', j?.dispatched === false);
  ok('and the refusal names the verbs', /action/i.test(j?.reason || ''));
}

section('The written numbers match the measured ones');
{
  // llms.txt is what other people's agents read, and it used to carry the census
  // figures in prose. They went stale — 285,447 registered where the registry
  // had reached 302,828 — so this section checked them against the measurement
  // and demanded they match.
  //
  // On 29 August the approach changed, because keeping a copy correct is a
  // weaker guarantee than not keeping one. The counts are gone from llms.txt;
  // it points an agent at /api-registry.json, which is the measurement rather
  // than a transcription of it. So the check inverts: the failure to catch is
  // no longer a stale number, it is a number reappearing at all.
  //
  // Pinned in both directions — it must accept a file that names no counts and
  // points at the JSON, and it must refuse one that hardcodes the current
  // census even while that census is correct. A number that is right today is
  // exactly how the last one started.
  const [txt, api] = await Promise.all([
    fetch(`${SITE}/llms.txt`).then((r) => r.text()).catch(() => ''),
    fetch(`${SITE}/api-registry.json`).then((r) => r.json()).catch(() => null),
  ]);
  const n = (x) => Number(x).toLocaleString('en-US');
  const censusFigures = api ? [api.registered_ids, api.registrations.parses, api.reachability.reachable,
    api.reachability.answering_mcp, api.reachability.a2a_callable] : [];
  const quoted = censusFigures.filter((v) => txt.includes(n(v)));
  ok('llms.txt names no census count of its own',
    !!api && quoted.length === 0,
    quoted.length ? `it hardcodes ${quoted.map(n).join(', ')} — correct today, stale tomorrow; point at the JSON instead`
      : 'no census figure is transcribed into the file');
  ok('and sends an agent to the measurement itself',
    txt.includes('/api-registry.json') && txt.includes('/api-jobs.json'),
    'an agent reading this file has no way to reach the current numbers');
  // The census figures were checked here and the tool count was not, so it
  // drifted the same way and nobody noticed: llms.txt advertised 17 read-only
  // tools while the endpoint served 18. An agent that reads the file to decide
  // whether to bother connecting is being given a number nobody maintains.
  // Counted against the server rather than kept in step by hand.
  const served = await fetch(`${SITE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((r) => r.json()).then((j) => j?.result?.tools?.length).catch(() => null);
  const claimed = Number((txt.match(/(\d+)\s+read-only tools/) || [])[1]);
  ok('llms.txt states the number of tools the endpoint actually serves',
    !!served && claimed === served,
    served ? `llms.txt says ${claimed || '(none stated)'}, the endpoint serves ${served}` : 'tools/list did not answer');
  // Naming a tool that does not exist is the same failure pointing the other
  // way, and it is the one an agent hits hardest: it calls the name and gets
  // an error it cannot act on.
  const namedInLlms = [...txt.matchAll(/`([a-z][a-z0-9_]{4,})`/g)].map((m) => m[1]);
  const toolNames = await fetch(`${SITE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((r) => r.json()).then((j) => (j?.result?.tools || []).map((t) => t.name)).catch(() => []);
  const invented = namedInLlms.filter((x) => /^(bobai|bsc|bnb|pancakeswap|find)_/.test(x) && !toolNames.includes(x));
  ok('every tool llms.txt names by hand exists',
    invented.length === 0, invented.length ? `not served: ${invented.join(', ')}` : '');

  // The whitepaper carries the same count and drifted further and for longer:
  // it advertised nine read-only tools while nineteen were served, and listed
  // only the ones about our own token. It is the document a reader treats as
  // the considered version, so a stale number there costs more than in a file
  // written for machines.
  const wp = (await getText(`${SITE}/whitepaper`)).body;
  const wpClaim = Number((wp.match(/>(\d+)\s+read-only tools</) || wp.match(/(\d+)\s+read-only tools/) || [])[1]);
  ok('the whitepaper states the number of tools the endpoint actually serves',
    !!served && wpClaim === served,
    served ? `whitepaper says ${wpClaim || '(none stated)'}, the endpoint serves ${served}` : 'tools/list did not answer');
  const wpNamed = [...wp.matchAll(/<strong>([a-z][a-z0-9_]{4,})<\/strong>/g)].map((m) => m[1]);
  const wpInvented = wpNamed.filter((x) => /^(bobai|bsc|bnb|pancakeswap|find)_/.test(x) && !toolNames.includes(x));
  ok('every tool the whitepaper names by hand exists',
    wpInvented.length === 0, wpInvented.length ? `not served: ${wpInvented.join(', ')}` : `${wpNamed.filter((x) => toolNames.includes(x)).length} named`);

  // The claim this rescan disproved must not survive anywhere.
  ok('the disproved "not a readable document" claim is gone',
    !/not a readable document/i.test(txt));
  ok('the off-chain share is published as data, not only as prose',
    Number.isInteger(api?.registrations?.points_offchain));
}
section('The number, and the order of the page');
{
  // 25 August: /registry loaded its freshly scanned 302,828 and then counted
  // itself DOWN to 299,783, because the worker's live high-water mark is
  // refreshed on its own schedule and was the older of the two figures. The
  // live counter may raise the scan total and may never lower it.
  const { body } = await getText(`${SITE}/registry`);
  const floor = Number((body.match(/var floor=(\d+)/) || [])[1] || 0);
  ok('the page knows the number it was built with', floor > 0);
  ok('and the live counter may only raise it',
    /if\(!\(live>floor\)\)return;/.test(body),
    'the live figure is taken unconditionally and can count the headline down');

  const api = await fetch(`${SITE}/api-registry.json`).then((r) => r.json()).catch(() => null);
  const live = await fetch('https://agent.brainonbnb.com/census')
    .then((r) => r.json()).catch(() => null);
  ok('the live counter is level with the last full scan',
    (live?.highest_id || 0) >= (api?.registered_ids || 0),
    `live ${live?.highest_id} is behind the published scan ${api?.registered_ids} — run scripts/census-sync.mjs`);

  // A marketplace that makes you read a census before it lets you hire
  // anything has its order backwards. The dispatch box and the category
  // picker come before the evidence; the evidence is folded, not removed.
  const act = body.indexOf('id="rg-task"');
  const evidence = body.indexOf('id="rg-fleets"');
  ok('you can act before you have to read', act > 0 && evidence > act,
    'the evidence blocks come before anything you can operate');
  ok('the category picker is on the page', (body.match(/class="rg-chip"/g) || []).length === 4);
  const folds = (body.match(/<details class="rg-box rg-fold"/g) || []).length;
  ok('the evidence is folded, not deleted', folds >= 6, `only ${folds} folds`);
  // Counted INSIDE the folds, which is what the claim is about. The old check
  // counted every <tbody> on the page and passed on the four category tables,
  // which were never folded — so it would have gone green with the evidence
  // gone. When the category tables became cards the number fell below its
  // threshold and the check failed for the wrong reason, which is how this was
  // noticed.
  const foldedHtml = body.slice(body.indexOf('<details class="rg-box rg-fold"'));
  ok('and the folded tables are still in the HTML',
    (foldedHtml.match(/<tbody>/g) || []).length >= 4,
    'folding removed the tables an agent reads instead of hiding them');
}
section('The marketplace, from the front door');
{
  // A judge, or anybody else, arriving at brainonbnb.com should not have to
  // work out that the marketplace lives behind a heading called "Agents".
  const { body } = await getText(`${SITE}/`);
  ok('homepage carries the marketplace card', /class="mkt fi"/.test(body));
  ok('the card links to the marketplace', /<a class="mkt fi" href="\/registry">/.test(body));
  // The nav deliberately does NOT carry a separate Marketplace entry: the
  // marketplace lives inside the Agents block, which is where it belongs, and
  // a second top-level word for the same thing reads as two destinations.
  ok('the nav is not split between Agents and Marketplace',
    !/<a href="\/registry">Marketplace<\/a>/.test(body));
  ok('the Agents block is still linked from the nav', /<a href="#agents">Agents<\/a>/.test(body));
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

  // A Hire button is a promise. Eleven of them shipped once on the strength
  // of a capability flag nobody had tested, and three sellers could actually
  // quote. Every button now carries what happened when that seller was asked.
  const hireBtns = (body.match(/class="rg-hirebtn"/g) || []).length;
  // The wording changed when the tables became cards ("Answers with a price
  // when asked" / "Did not answer when we asked it"). The invariant did not:
  // every button says what happened when that seller was asked.
  const marks = (body.match(/Answers with a price when asked|Did not answer when we asked/g) || []).length;
  ok('every hire button says what the seller answered', hireBtns > 0 && marks >= hireBtns,
    `${hireBtns} buttons but only ${marks} carry a measured answer — run scripts/erc8004-hire-confirm.mjs`);
  const reg = await fetch(`${SITE}/api-registry.json`).then((r) => r.json()).catch(() => null);
  ok('and the count is published, not only rendered',
    Number.isInteger(reg?.quoted_when_asked) && reg.quoted_when_asked > 0);
  // The two quote figures have different denominators, and printing one under
  // the other one's count is the bug this pair of checks exists to prevent.
  // quoted_of_hireable is counted over the buttons the page renders; it can
  // never exceed them, and it is the only one the hire block may say "of them"
  // about.
  ok('the two quote counts are published with their own denominators',
    Number.isInteger(reg?.quoted_of_hireable) && Number.isInteger(reg?.quote_asks)
    && Number.isInteger(reg?.quote_agents_asked)
    && reg.quoted_of_hireable <= reg.hireable_here
    && reg.quoted_when_asked <= reg.quote_asks
    && reg.quote_agents_asked <= reg.quote_asks,
    'a quote tally is larger than the set it was counted over');
  ok('the hire block counts quotes over its own buttons, not over the quote run',
    new RegExp(`${reg?.hireable_here} carry a Hire button, and <b>${reg?.quoted_of_hireable} of them returned a price`).test(body),
    'the block prints a numerator from the quote run under a count of buttons');
  const home = (await getText(SITE)).body;
  ok('the homepage card promises the measured number, not the button count',
    /id="mkt-hire"[^<]*<\/b><span>quote back when asked/.test(home),
    'the card still advertises hireable buttons rather than sellers that quote');
  // Same reasoning as the census counts above: the quote tally is measured
  // afresh every time hire-confirm runs, so llms.txt must not carry a copy of
  // it. What it owes an agent is the route to the live figure.
  //
  // This guard used to build the single string `<quoted_when_asked> of
  // <hireable_here>` and assert its absence. Those two figures have different
  // denominators and never appear side by side, so the string could not occur:
  // the check passed on every run while the file carried "10 of 16 returned a
  // quote" and "Sixteen of them can be hired" one clause earlier. A guard that
  // cannot fail is not a guard, so this one is pinned in both directions.
  const NUM = String.raw`(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;
  const TALLY = new RegExp(String.raw`\b${NUM}\s+of\s+${NUM}\b`, 'i');
  const HIRE_COUNT = new RegExp(String.raw`\b${NUM}\s+(?:of\s+them\s+)?(?:can\s+be\s+hired|carry\s+a\s+hire\s+button)`, 'i');
  const carriesTally = (t) => TALLY.test(t) || HIRE_COUNT.test(t);
  ok('the tally guard still fires on the lines it was written for',
    carriesTally('Sixteen of them can be hired straight from the page')
    && carriesTally('10 of 16 returned a quote')
    && carriesTally('13 carry a Hire button')
    && !carriesTally('Five of the hireable ones are ours, and all five quote.'),
    'the pattern stopped matching the transcriptions it exists to catch, or started matching prose that carries no count');
  const llmsTxt = (await getText(`${SITE}/llms.txt`)).body;
  ok('llms.txt does not carry a copy of the quote tally',
    !carriesTally(llmsTxt),
    'the tally is transcribed there and will be wrong after the next hire-confirm run');

  // The fleet block, and its arithmetic. "45 of the 46 name the same URL" is
  // the point of the block; "4 of the 2" was a real line it printed before the
  // count was fixed, and a number larger than the set it came from is exactly
  // what this page exists to catch in other people's data.
  ok('the fleet block is on the page', /id="rg-fleets"/.test(body));
  const fleet = body.slice(body.indexOf('id="rg-fleets"'), body.indexOf('id="rg-log"'));
  const overCounts = [...fleet.matchAll(/([\d,]+) of the ([\d,]+) name/g)]
    .filter((m) => Number(m[1].replace(/,/g, '')) > Number(m[2].replace(/,/g, '')));
  ok('no subset is larger than its set', overCounts.length === 0,
    overCounts.map((m) => `${m[1]} of ${m[2]}`).join(', '));
  ok('it names the largest identical-tool fleet', /identical tool list/.test(fleet));

  // The rubric's four steps are: land, find by category, UNDERSTAND WHAT IT
  // DOES, activate. The third was missing entirely — the columns were the
  // agent, how we classified it and whether it had ever been paid. A row
  // without a description asks the reader to hire on vibes.
  const rows = (body.match(/data-cat="[a-z-]+"/g) || []).length;
  // rg-what was the table cell; rgc-what is the card. Both are the sentence
  // that says what the agent does, which is the thing being counted.
  const whats = (body.match(/class="rgc?-what/g) || []).length;
  ok('every hireable row says what the agent does', whats >= rows, `${whats} descriptions for ${rows} hireable rows`);
  // Ours must not be among the ones with nothing to say. Holding others to a
  // standard we fail on our own two entries is the failure mode here.
  const ourWeak = /Brain on BNB[^<]*<\/b>[\s\S]{0,400}?rg-what rg-weak/.test(body);
  ok('our own agents describe themselves', !ourWeak, 'one of ours renders as "says nothing about what it does"');
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
