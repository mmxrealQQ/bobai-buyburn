// One command that answers "is everything actually running".
//
// The project is now eight workers, a Pages site, a paid agent service and a
// census — and the state of each lived in a different place. Checking meant
// remembering which endpoint proves what, which is exactly how a stopped bot
// goes unnoticed for a week.
//
// Every check reads a response BODY and applies a real criterion. Two habits
// this codebase learned the hard way and that are enforced here:
//
//   A status code proves nothing. brainonbnb.com answers any unrouted path
//   with 200 and the dashboard HTML, so "200 OK" is compatible with the
//   endpoint not existing.
//
//   Silence is not health. A bot that has burned nothing in thirty hours is
//   either idle or dead, and those look identical from the burn log alone.
//   Liveness comes from the heartbeat; the burn log only says how busy it was.
//
// Usage: node scripts/health.mjs
const SITE = 'https://brainonbnb.com';
const AGENT = 'https://agent.brainonbnb.com';
const LOGS = 'https://logs.brainonbnb.com';

const UA = { 'user-agent': 'bobai-smoke-test' }; // not counted in public stats
const _fetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) =>
  _fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });

const results = [];
const ok = (area, name, good, detail = '') => results.push({ area, name, good, detail });

const getJson = async (url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (/^\s*<!doctype html/i.test(text)) return { html: true, status: r.status };
    try { return { json: JSON.parse(text), status: r.status }; }
    catch { return { text, status: r.status }; }
  } catch (e) { return { error: String(e.message || e) }; }
};

const ageHours = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;
const fmtAge = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

// ---- the bots -------------------------------------------------------------
{
  const h = await getJson(`${LOGS}/health`);
  const j = h.json;
  ok('Bots', 'heartbeat endpoint answers', !!j, h.error || (h.html ? 'HTML fallback' : ''));
  if (j) {
    // Cron every 10 min and hourly. Two missed cycles is noise; six hours is a
    // stopped worker, and that is the distinction worth alarming on.
    const b = j.buyback ? ageHours(j.buyback) : null;
    const d = j.devBuyback ? ageHours(j.devBuyback) : null;
    ok('Bots', 'buyback bot ran recently', b !== null && b < 1, b === null ? 'no timestamp' : `last run ${fmtAge(b)} ago`);
    ok('Bots', 'dev-buyback bot ran recently', d !== null && d < 3, d === null ? 'no timestamp' : `last run ${fmtAge(d)} ago`);
  }
}
{
  const r = await getJson(`${LOGS}/logs/burns.json`);
  const items = Array.isArray(r.json) ? r.json : (r.json?.burns || r.json?.items || []);
  ok('Bots', 'burn audit log readable', items.length > 0, `${items.length} entries`);
  if (items.length) {
    const last = items[items.length - 1];
    const t = last?.time || last?.timestamp;
    // Deliberately NOT a failure: no burn means no volume, not a broken bot.
    // Reported so a long gap is visible without being called an outage.
    const h = t ? ageHours(t) : null;
    ok('Bots', 'last burn (informational)', true, h === null ? 'no timestamp' : `${fmtAge(h)} ago — idle is normal when volume is low`);
  }
}

// ---- the money numbers ----------------------------------------------------
{
  const p = await getJson(`${SITE}/api/price`);
  const price = p.json?.price_usd;
  ok('Token', 'price endpoint returns a live price', typeof price === 'number' && price > 0, price ? `$${price}` : '');

  const l = await getJson(`${SITE}/api/liquidity`);
  const liq = l.json?.liquidity_usd ?? l.json?.liquidityUsd;
  ok('Token', 'liquidity endpoint answers', liq != null, liq != null ? `$${Math.round(Number(liq)).toLocaleString('en-US')}` : '');

  // Fetched as raw text, not through getJson: a bare number is valid JSON, so
  // JSON.parse succeeds and the value lands in .json rather than .text. The
  // first version of this check asked for .text, found nothing, and reported a
  // working endpoint as broken — a false alarm in a health check is worse than
  // no check, because people learn to ignore red.
  const supplyRaw = await fetch(`${SITE}/api/circulating-supply`)
    .then((r) => r.text()).catch(() => '');
  ok('Token', 'circulating supply is a bare number', /^\d+$/.test(supplyRaw.trim()), supplyRaw.trim().slice(0, 20));

  // The same figure reached two ways must agree. A drift here means one surface
  // is reading a stale or different source, which is the failure this project
  // treats as most serious.
  const t = await getJson(`${SITE}/api/token`);
  const fromToken = Number(t.json?.circulating_supply ?? t.json?.circulatingSupply);
  const fromBare = Number(supplyRaw.trim());
  ok('Token', 'supply agrees across two endpoints',
    Number.isFinite(fromToken) && Number.isFinite(fromBare) && Math.abs(fromToken - fromBare) / fromBare < 0.001,
    Number.isFinite(fromToken) ? `${fromToken.toLocaleString('en-US')} vs ${fromBare.toLocaleString('en-US')}` : '');
}

// ---- the agent surface ----------------------------------------------------
{
  const r = await fetch(`${SITE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((x) => x.json()).catch(() => null);
  const tools = r?.result?.tools || [];
  ok('Agents', 'MCP server lists tools', tools.length >= 16, `${tools.length} tools`);
  ok('Agents', 'Brain Plaza tools are exposed',
    tools.some((t) => t.name === 'find_agents_on_bnb_chain') && tools.some((t) => t.name === 'bnb_agent_census'));

  const sk = await getJson(`${SITE}/.well-known/skills/index.json`);
  const entry = sk.json?.skills?.[0];
  ok('Agents', 'skill manifest serves JSON', !!entry, sk.html ? 'HTML fallback' : '');
  if (entry) {
    const tar = await fetch(entry.url).then((x) => x.arrayBuffer()).catch(() => null);
    const buf = tar ? Buffer.from(tar) : null;
    ok('Agents', 'skill tarball is gzip and matches its digest',
      !!buf && buf[0] === 0x1f && buf[1] === 0x8b
      && 'sha256:' + (await import('node:crypto')).createHash('sha256').update(buf).digest('hex') === entry.digest);
  }
}

// ---- the paid service -----------------------------------------------------
{
  const r = await fetch(`${AGENT}/watch`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6' }),
  }).catch(() => null);
  ok('Paid', 'unpaid request is refused with 402', r?.status === 402, r ? `got ${r.status}` : 'no response');
  const hdr = r?.headers.get('PAYMENT-REQUIRED');
  let decoded = null;
  try { decoded = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch {}
  ok('Paid', 'PAYMENT-REQUIRED decodes', !!decoded?.accepts?.length, `${decoded?.accepts?.length ?? 0} payment options`);

  const fake = await getJson(`${AGENT}/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': '0x' + '11'.repeat(32) },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6' }),
  });
  ok('Paid', 'invented payment is rejected', /not found|malformed|need/i.test(fake.json?.reason || ''), fake.json?.reason || '');

  const guard = await fetch(`${AGENT}/run-checks`, { method: 'POST' }).catch(() => null);
  ok('Paid', 'admin trigger needs the secret', guard?.status === 403, guard ? `got ${guard.status}` : '');
}

// ---- brain plaza ----------------------------------------------------------
{
  const c = await getJson(`${SITE}/api-registry.json`);
  ok('Plaza', 'census data served', !!c.json?.registered_ids, c.html ? 'HTML fallback' : '');
  ok('Plaza', 'census scan was complete', c.json?.ids_scanned === c.json?.registered_ids,
    c.json ? `${c.json.ids_scanned?.toLocaleString('en-US')} of ${c.json.registered_ids?.toLocaleString('en-US')}` : '');
  ok('Plaza', 'nothing left unreadable', c.json?.registrations?.unread_after_retries === 0);

  const o = await getJson(`${SITE}/api-operators.json`);
  ok('Plaza', 'operator view served', (o.json?.operators || []).length > 0, `${o.json?.independent_operators ?? 0} operators`);

  const f = await getJson(`${AGENT}/find?q=protocol%20stats&limit=3`);
  ok('Plaza', 'broker returns candidates', (f.json?.results || []).length > 0, `${f.json?.returned ?? 0} of ${f.json?.searched ?? 0}`);

  // The safety rule the dispatcher exists to enforce, checked live rather than
  // trusted: a task naming an action must be declined, not answered sideways.
  const d = await getJson(`${AGENT}/dispatch`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'build swap calldata and sign it' }),
  });
  ok('Plaza', 'dispatcher refuses action requests', d.json?.dispatched === false,
    (d.json?.reason || '').slice(0, 60));

  const cen = await getJson(`${AGENT}/census`);
  const last = cen.json?.last_checked_at;
  ok('Plaza', 'self-update ran in the last 48h', last ? ageHours(last) < 48 : false,
    last ? `${fmtAge(ageHours(last))} ago` : 'never');
}

// ---- the site -------------------------------------------------------------
{
  for (const [name, path] of [['homepage', '/'], ['Brain Plaza', '/registry'], ['scanner', '/scanner'], ['whitepaper', '/whitepaper']]) {
    const r = await fetch(SITE + path).catch(() => null);
    const body = r ? await r.text() : '';
    ok('Site', `${name} serves real content`, !!r?.ok && body.length > 2000 && /<title>/.test(body));
  }
  const csp = (await fetch(SITE).catch(() => null))?.headers.get('content-security-policy') || '';
  ok('Site', 'CSP allows the agent subdomain', csp.includes('agent.brainonbnb.com'));
}

// ---- report ---------------------------------------------------------------
const areas = [...new Set(results.map((r) => r.area))];
let bad = 0;
console.log('');
for (const a of areas) {
  console.log(a);
  for (const r of results.filter((x) => x.area === a)) {
    if (!r.good) bad++;
    console.log(`  ${r.good ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(42)} ${r.detail}`);
  }
  console.log('');
}
console.log(bad === 0
  ? `${results.length} checks, everything running\n`
  : `${results.length} checks, ${bad} FAILING\n`);
process.exit(bad ? 1 : 0);
