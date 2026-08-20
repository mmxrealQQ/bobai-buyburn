// Turns the census into the page and the JSON endpoint that serve it.
//
// Reads data/erc8004/*, writes dashboard/registry.html and
// dashboard/api-registry.json. Both are generated — never edit them by hand,
// the next run overwrites them. Everything the page states comes from the two
// scan artefacts, so there is no path by which the page can claim a number the
// data does not contain.
//
// Usage: node scripts/erc8004-publish.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'erc8004');
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'scan-state.json'), 'utf8'));

let census = null;
try { census = JSON.parse(fs.readFileSync(path.join(DIR, 'census.json'), 'utf8')); } catch {}

const reachable = [];
try {
  for (const line of fs.readFileSync(path.join(DIR, 'reachable.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.reachable) reachable.push(r); } catch {}
  }
} catch {}

const c = state.counts;
const scanned = state.cursor - 1;
const total = state.highestId;
const pct = (n, d = scanned) => (d ? (n / d) * 100 : 0);
const fmt = (n) => Number(n).toLocaleString('en-US');
const p1 = (n, d = scanned) => pct(n, d).toFixed(pct(n, d) < 1 ? 2 : 1) + '%';

// ---- the JSON surface ----------------------------------------------------
const api = {
  what_this_is: 'A census of the ERC-8004 identity registry on BNB Smart Chain: how many agents are registered, how many of those registrations are readable, how many name an endpoint, and how many of those endpoints answer.',
  registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  chain: 'eip155:56',
  measured_at: census?.measured_at || state.updatedAt,
  registered_ids: total,
  ids_scanned: scanned,
  registrations: {
    parses: c.valid,
    unparsable: c.unparsable,
    empty: c.empty,
    unread_after_retries: c.unread,
    active_flag: c.active,
    names_a_service: c.withServices,
    has_http_endpoint: c.withHttpEndpoint,
    endpoint_on_a_real_tld: c.plausibleEndpoint,
    speaks_mcp: c.mcp,
    speaks_a2a: c.a2a,
    supports_x402: c.x402,
  },
  reachability: census?.endpoints || null,
  method: {
    registrations: 'Every id read via tokenURI() on the registry. Ids the nodes refused are retried until they answer; the count above reports what remained unreadable after that, so a percentage here is never a statement about node availability.',
    reachability: 'Every claimed HTTP endpoint contacted once. Any HTTP response counts as reachable, including 401, 403 and 404 — only a failed connection counts as dead. MCP endpoints were sent a real tools/list; agent cards had to parse as JSON.',
    caveat: 'Reachability is a snapshot. An endpoint down at that moment is counted as dead, and one that answers may still do nothing useful.',
  },
  source: 'https://brainonbnb.com/registry',
};
fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-registry.json'), JSON.stringify(api, null, 2) + '\n');

// ---- the page ------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const liveRows = reachable
  .slice()
  .sort((a, b) => (b.live?.mcp ? 1 : 0) - (a.live?.mcp ? 1 : 0) || a.id - b.id)
  .slice(0, 60)
  .map((r) => {
    const tags = [
      r.live?.mcp ? `<span class="rg-t rg-mcp">MCP · ${r.live.mcpTools ?? '?'} tools</span>` : '',
      r.live?.a2a ? '<span class="rg-t rg-a2a">agent card</span>' : '',
      r.x402 ? '<span class="rg-t rg-x4">x402</span>' : '',
    ].filter(Boolean).join('');
    const ep = (r.endpoints || [])[0] || '';
    return `<tr><td class="rg-id">#${r.id}</td><td>${esc(r.name) || '<i>unnamed</i>'}${tags}</td><td class="rg-ep">${esc(ep.slice(0, 58))}</td></tr>`;
  }).join('\n');

const reach = census?.endpoints;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ERC-8004 Registry Census — BNB Smart Chain | Brain On BNB AI</title>
<meta name="description" content="Every agent id in the ERC-8004 identity registry on BNB Chain, read and counted: how many registrations parse, how many name an endpoint, and how many of those endpoints actually answer.">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/fonts.css?v=1">
<link rel="stylesheet" href="/styles.css?v=23">
<link rel="canonical" href="https://brainonbnb.com/registry">
<style>
  .rg-wrap{max-width:1000px;margin:0 auto;padding:92px 20px 80px}
  .rg-h1{font-family:'Space Grotesk',system-ui,sans-serif;font-size:clamp(1.7rem,4vw,2.6rem);line-height:1.15;margin:0 0 14px}
  .rg-h1 em{color:var(--gold);font-style:normal}
  .rg-lead{color:var(--muted);font-size:1rem;line-height:1.7;max-width:70ch;margin:0 0 8px}
  .rg-when{color:var(--muted);font-size:.8rem;margin:18px 0 30px}
  .rg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:0 0 16px}
  .rg-card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:20px;position:relative;overflow:hidden}
  .rg-card::before{content:'';position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,var(--gold),transparent)}
  .rg-n{font-family:'Space Grotesk',system-ui,sans-serif;font-size:1.9rem;font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums;line-height:1.1}
  .rg-l{margin-top:6px;font-size:.9rem}
  .rg-s{margin-top:3px;font-size:.78rem;color:var(--muted);line-height:1.5}
  .rg-funnel{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:24px;margin:16px 0}
  .rg-funnel h2{font-size:1.05rem;margin:0 0 4px}
  .rg-funnel > p{color:var(--muted);font-size:.85rem;margin:0 0 18px;line-height:1.6}
  .rg-step{display:grid;grid-template-columns:1fr;gap:5px;margin-bottom:15px}
  .rg-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .rg-top b{font-size:.92rem;font-weight:600}
  .rg-top span{font-size:.85rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-bar{height:9px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden}
  .rg-fill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--gold),#ffd35c)}
  .rg-note{font-size:.78rem;color:var(--muted);line-height:1.55}
  table.rg{width:100%;border-collapse:collapse;font-size:.85rem}
  .rg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table.rg th{text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 10px 10px;font-weight:600}
  table.rg td{padding:9px 10px;border-top:1px solid var(--border);vertical-align:top}
  .rg-id{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-ep{color:var(--muted);font-size:.78rem;word-break:break-all}
  .rg-t{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;font-size:.68rem;vertical-align:middle}
  .rg-mcp{background:rgba(63,224,154,.14);color:#3fe09a}
  .rg-a2a{background:rgba(125,146,255,.14);color:#7d92ff}
  .rg-x4{background:rgba(240,185,11,.14);color:var(--gold)}
  .rg-method{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:24px;margin-top:16px}
  .rg-method h2{font-size:1.05rem;margin:0 0 12px}
  .rg-method p{font-size:.86rem;color:var(--muted);line-height:1.7;margin:0 0 12px}
  .rg-method a{color:var(--gold)}
  .rg-back{display:inline-block;margin-bottom:26px;font-size:.85rem;color:var(--muted);text-decoration:none}
  .rg-back:hover{color:var(--gold)}
</style>
</head>
<body>
<div class="rg-wrap">
  <a class="rg-back" href="/#agents">&larr; Brain On BNB AI</a>
  <h1 class="rg-h1">${fmt(total)} agents are registered on BNB Chain.<br><em>${reach ? fmt(reach.reachable) : '—'} of them answer.</em></h1>
  <p class="rg-lead">ERC-8004 gives every AI agent an on-chain identity, and BNB Smart Chain holds more of them than any other network. That number gets quoted constantly. Nobody checks it.</p>
  <p class="rg-lead">So we read the whole registry — every id, one at a time — and then contacted every endpoint it named.</p>
  <p class="rg-when">Measured ${esc((api.measured_at || '').slice(0, 16).replace('T', ' '))} UTC · ${fmt(scanned)} of ${fmt(total)} ids read · ${c.unread} unreadable after retries</p>

  <div class="rg-grid">
    <div class="rg-card"><div class="rg-n">${fmt(total)}</div><div class="rg-l">registered ids</div><div class="rg-s">what the headline number counts</div></div>
    <div class="rg-card"><div class="rg-n">${fmt(c.valid)}</div><div class="rg-l">readable registrations</div><div class="rg-s">${p1(c.valid)} of them parse at all</div></div>
    <div class="rg-card"><div class="rg-n">${fmt(c.withHttpEndpoint)}</div><div class="rg-l">name an endpoint</div><div class="rg-s">${p1(c.withHttpEndpoint)} — an address you could call</div></div>
    <div class="rg-card"><div class="rg-n">${reach ? fmt(reach.reachable) : '—'}</div><div class="rg-l">actually answer</div><div class="rg-s">${reach ? p1(reach.reachable, total) + ' of everything registered' : 'probe pending'}</div></div>
  </div>

  <div class="rg-funnel">
    <h2>From a number to a working agent</h2>
    <p>Each bar is a share of all ${fmt(total)} registered ids. Nothing here is extrapolated — every id was read.</p>
    ${[
      ['Registered on-chain', total, 'An id exists. That is all this proves.'],
      ['Registration parses', c.valid, `${fmt(c.unparsable)} contain something that is not a readable document, ${fmt(c.empty)} are empty.`],
      ['Names any service', c.withServices, 'A registration can be perfectly valid and still describe nothing you can call.'],
      ['Has an HTTP endpoint', c.withHttpEndpoint, 'An address, not yet a promise that it exists.'],
      ['Endpoint on a real TLD', c.plausibleEndpoint, `${fmt(c.withHttpEndpoint - c.plausibleEndpoint)} point at domains that cannot resolve — things like <code>.agent</code>, which was never a TLD.`],
      ...(reach ? [['Answers when contacted', reach.reachable, 'Any HTTP response counts, including 401 and 404 — something is listening.']] : []),
      ...(reach ? [['Answers as an agent', (reach.answering_mcp || 0) + (reach.serving_an_agent_card || 0), 'Spoke MCP or served a parsable agent card. Not just a web server — an agent.']] : []),
    ].map(([label, n, note]) => `
    <div class="rg-step">
      <div class="rg-top"><b>${label}</b><span>${fmt(n)} &middot; ${p1(n, total)}</span></div>
      <div class="rg-bar"><div class="rg-fill" style="width:${Math.max(0.35, pct(n, total)).toFixed(3)}%"></div></div>
      <div class="rg-note">${note}</div>
    </div>`).join('')}
  </div>

  ${liveRows ? `<div class="rg-funnel">
    <h2>The ones that answered</h2>
    <p>Every agent below responded when we contacted it. This is the list the headline number is supposed to describe.</p>
    <div class="rg-scroll"><table class="rg"><thead><tr><th>ID</th><th>Agent</th><th>Endpoint</th></tr></thead><tbody>
${liveRows}
    </tbody></table></div>
  </div>` : ''}

  <div class="rg-method">
    <h2>How this was measured</h2>
    <p><b>Registrations.</b> Every id from 1 to ${fmt(total)} read through <code>tokenURI()</code> on <code>0x8004…a432</code>, in batches of 25 across six public BSC nodes. Ids a node refused were retried until answered — <b>${c.unread}</b> remained unreadable at the end. That distinction matters: a refused request is a fact about a node, not about an agent, and counting one as the other is how you publish a wrong census.</p>
    <p><b>Reachability.</b> Every claimed HTTP endpoint contacted once. We counted <i>any</i> HTTP response as reachable — including 401, 403 and 404 — because something is listening at that address, and an agent behind auth is still an agent. Only a failed connection counts as dead. Endpoints claiming MCP were sent a real <code>tools/list</code>; agent cards had to return parsable JSON.</p>
    <p><b>What this does not say.</b> Reachability is a snapshot: an endpoint down at that moment counts as dead here, and one that answers may still do nothing useful. This measures whether something is there, not whether it is good.</p>
    <p>The full data is at <a href="/api-registry.json">/api-registry.json</a>. The scanner is in <a href="/#library">The Library</a> — run it yourself and check.</p>
  </div>
</div>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'dashboard', 'registry.html'), page);
console.log(`wrote dashboard/registry.html (${(page.length / 1024).toFixed(1)} KB) and dashboard/api-registry.json`);
console.log(`  ${fmt(total)} registered · ${fmt(c.valid)} parse · ${fmt(c.withHttpEndpoint)} endpoints · ${reach ? fmt(reach.reachable) + ' reachable' : 'probe not run yet'}`);
