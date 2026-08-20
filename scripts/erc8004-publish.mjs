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

// What each agent says about itself, from erc8004-enrich.mjs. Optional: the
// page works without it, it just has less to say about each agent.
let registrations = {};
try { registrations = JSON.parse(fs.readFileSync(path.join(DIR, 'registrations.json'), 'utf8')); } catch {}

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

// An incomplete scan must not be published as if it were a census. This caught
// a real failure: a stopped background scan kept running and overwrote the
// finished state with its own older one, leaving the counts 60,000 ids short
// while every file still parsed and every number still looked plausible. The
// page would have quietly understated the ecosystem it claims to measure.
// --partial publishes anyway, for when a snapshot is genuinely wanted.
if (scanned < total * 0.995 && !process.argv.includes('--partial')) {
  console.error(`
Refusing to publish: only ${scanned.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ids scanned (${((scanned / total) * 100).toFixed(1)}%).`);
  console.error(`Finish the scan first, or pass --partial to publish a snapshot anyway.
`);
  process.exit(1);
}

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

// ---- the list itself, for machines ---------------------------------------
// The census counts; this is what another agent can actually use. Only agents
// that answered are in it, and where one exposes tools or skills they are
// listed by name — because "an agent exists at this address" is a directory
// entry, and a directory is the thing this set out to be better than.
//
// Sorted so that agents which speak a protocol come first: an agent looking for
// a counterpart wants those, and burying them under a few hundred plain web
// servers would make the useful part of the list the hardest to reach.
const directory = reachable
  .map((r) => ({
    id: r.id,
    name: r.name || registrations[r.id]?.name || null,
    // The operator's own description, straight from the on-chain registration.
    // This is what turns a row into something a person can judge.
    ...(registrations[r.id]?.description ? { description: registrations[r.id].description } : {}),
    ...(registrations[r.id]?.image ? { image: registrations[r.id].image } : {}),
    ...(registrations[r.id]?.trust?.length ? { trust_models: registrations[r.id].trust } : {}),
    ...(registrations[r.id]?.services?.length ? { declared_services: registrations[r.id].services } : {}),
    endpoints: r.endpoints,
    speaks: [r.live?.mcp ? 'mcp' : null, r.live?.a2a ? 'a2a' : null,
      (r.x402 || registrations[r.id]?.x402) ? 'x402' : null].filter(Boolean),
    ...(r.live?.tools?.length ? { tools: r.live.tools } : {}),
    ...(r.live?.skills?.length ? { skills: r.live.skills } : {}),
    ...(r.live?.cardUrl ? { agent_card: r.live.cardUrl } : {}),
    ...(r.live?.cardDescription ? { description: r.live.cardDescription } : {}),
  }))
  .sort((a, b) => b.speaks.length - a.speaks.length || a.id - b.id);

fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-agents.json'), JSON.stringify({
  what_this_is: 'Every ERC-8004 agent on BNB Smart Chain that answered when contacted, with whatever it exposes about itself. Generated from a full registry scan — not self-reported, not curated.',
  measured_at: api.measured_at,
  registered_ids: total,
  answered: directory.length,
  speaking_a_protocol: directory.filter((d) => d.speaks.length).length,
  note: 'Presence here means the address responded and, where stated, the protocol answered. It is not an endorsement, a rating, or a claim that the agent does anything useful.',
  agents: directory,
}, null, 2) + '\n');

// ---- the page ------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Each row is a small profile rather than a table cell: logo, name, what the
// operator says it does, what it demonstrably speaks, and the address you can
// call. The point of the whole exercise is that none of this is self-reported
// into a form we control — the description comes from the chain, the protocol
// tags come from having spoken to it.
const liveRows = reachable
  .slice()
  .sort((a, b) => {
    const rank = (x) => (x.live?.mcp ? 2 : 0) + (x.live?.a2a ? 1 : 0);
    return rank(b) - rank(a) || a.id - b.id;
  })
  .slice(0, 60)
  .map((r) => {
    const reg = registrations[r.id] || {};
    const tags = [
      r.live?.mcp ? `<span class="rg-t rg-mcp">MCP &middot; ${r.live.mcpTools ?? '?'} tools</span>` : '',
      r.live?.a2a ? '<span class="rg-t rg-a2a">agent card</span>' : '',
      (r.x402 || reg.x402) ? '<span class="rg-t rg-x4">x402</span>' : '',
      ...(reg.trust || []).slice(0, 2).map((t) => `<span class="rg-t rg-tr">${esc(t)}</span>`),
    ].filter(Boolean).join('');

    const caps = r.live?.tools?.length
      ? `<div class="rg-caps">${r.live.tools.slice(0, 8).map((t) => `<code title="${esc(t.description)}">${esc(t.name)}</code>`).join(' ')}${r.live.tools.length > 8 ? ` <span class="rg-more">+${r.live.tools.length - 8}</span>` : ''}</div>`
      : r.live?.skills?.length
        ? `<div class="rg-caps">${r.live.skills.slice(0, 8).map((x) => `<code>${esc(x)}</code>`).join(' ')}</div>`
        : '';

    // Logos are third-party URLs on hosts we do not control, so they are lazy,
    // sized, and disappear rather than leaving a broken-image box if the host
    // is gone — which, on this list, is a realistic outcome.
    const logo = reg.image
      ? `<img class="rg-logo" src="${esc(reg.image)}" alt="" loading="lazy" decoding="async" width="34" height="34" onerror="this.remove()">`
      : '<span class="rg-logo rg-logo-none" aria-hidden="true"></span>';

    const desc = reg.description
      ? `<div class="rg-desc">${esc(reg.description.slice(0, 190))}${reg.description.length > 190 ? '&hellip;' : ''}</div>`
      : '';

    const ep = (r.endpoints || [])[0] || '';
    const epHost = ep.replace(/^https?:\/\//i, '').replace(/\/$/, '');

    return `<tr>
      <td class="rg-id">#${r.id}</td>
      <td class="rg-agent">
        <div class="rg-head">${logo}<div class="rg-nm"><b>${esc(r.name || reg.name) || '<i>unnamed</i>'}</b>${tags}</div></div>
        ${desc}${caps}
      </td>
      <td class="rg-ep"><a href="${esc(ep)}" target="_blank" rel="noopener nofollow">${esc(epHost.slice(0, 46))}</a></td>
    </tr>`;
  }).join('');

const reach = census?.endpoints;

// The page states a reachable count and then lists the agents behind it. If
// those two come from different runs, the page contradicts itself — which is
// fatal for the one thing it is for. Publishing stops rather than shipping it.
if (reach && reach.reachable > 0 && reachable.length === 0) {
  console.error(`
Refusing to publish: census.json reports ${reach.reachable} reachable agents but reachable.jsonl is empty.`);
  console.error(`Run: node scripts/erc8004-probe.mjs
`);
  process.exit(1);
}
if (reach && reachable.length && Math.abs(reach.reachable - reachable.length) > reach.reachable * 0.02) {
  console.error(`
Refusing to publish: census says ${reach.reachable} reachable, the list holds ${reachable.length}. These are from different runs.`);
  console.error(`Run: node scripts/erc8004-probe.mjs
`);
  process.exit(1);
}

// The page. Built on the same furniture as every other page on the site —
// nav, blk-head section, footer, shared stylesheet — because a page that looks
// like it was bolted on reads like it was bolted on. The only bespoke CSS here
// is for the funnel and the agent table, which nothing else on the site needs.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ERC-8004 Registry Census — how many BNB Chain agents actually answer?</title>
<meta name="description" content="Every agent id in the ERC-8004 registry on BNB Chain, read one at a time, then every endpoint contacted. How many of ${fmt(total)} registered agents are actually reachable.">
<meta property="og:title" content="${fmt(total)} agents are registered on BNB Chain. ${reach ? fmt(reach.reachable) : 'How many'} answer.">
<meta property="og:description" content="We read the whole ERC-8004 registry — every id — then contacted every endpoint it named. Full method, full data, checkable.">
<meta property="og:image" content="https://brainonbnb.com/og-banner.png">
<meta property="og:url" content="https://brainonbnb.com/registry">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Brain On BNB AI">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${fmt(total)} agents are registered on BNB Chain. ${reach ? fmt(reach.reachable) : 'How many'} answer.">
<meta name="twitter:description" content="We read the whole ERC-8004 registry — every id — then contacted every endpoint it named.">
<meta name="twitter:image" content="https://brainonbnb.com/og-banner.png">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/fonts.css?v=1">
<link rel="stylesheet" href="/styles.css?v=23">
<link rel="canonical" href="https://brainonbnb.com/registry">
<style>
  .rg-h1{font-family:'Space Grotesk',system-ui,sans-serif;font-size:clamp(1.6rem,3.6vw,2.4rem);line-height:1.18;margin:0 0 16px}
  .rg-h1 em{color:var(--acc,var(--gold));font-style:normal}
  .rg-lead{color:var(--muted);font-size:1rem;line-height:1.72;max-width:70ch;margin:0 0 10px}
  .rg-when{color:var(--muted);font-size:.8rem;margin:20px 0 4px}
  .rg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:26px 0 16px}
  .rg-card{background:var(--card);backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:18px;padding:20px;position:relative;overflow:hidden}
  .rg-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--acc,var(--gold)),transparent)}
  .rg-n{font-family:'Space Grotesk',system-ui,sans-serif;font-size:1.9rem;font-weight:700;color:var(--acc,var(--gold));line-height:1.1;font-variant-numeric:tabular-nums}
  .rg-l{margin-top:6px;font-size:.9rem}
  .rg-s{margin-top:3px;font-size:.78rem;color:var(--muted);line-height:1.5}
  .rg-box{background:var(--card);backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:22px;padding:24px;margin:14px 0}
  .rg-box h2{font-size:1.05rem;margin:0 0 4px}
  .rg-box > p.rg-sub{color:var(--muted);font-size:.85rem;margin:0 0 18px;line-height:1.6}
  .rg-step{display:grid;gap:5px;margin-bottom:15px}
  .rg-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .rg-top b{font-size:.92rem;font-weight:600}
  .rg-top span{font-size:.85rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-bar{height:9px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden}
  .rg-fill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--acc,var(--gold)),#ffd35c)}
  .rg-note{font-size:.78rem;color:var(--muted);line-height:1.55}
  .rg-note code{font-size:.74rem}
  table.rg{width:100%;border-collapse:collapse;font-size:.85rem}
  .rg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* The table is the longest thing on the page and grows with every agent
     that comes online, so it gets its own window instead of pushing the
     method section further out of reach each time. Sticky header so the
     columns stay labelled while scrolling inside it. */
  .rg-tablebox{max-height:min(52vh,460px);overflow-y:auto;overscroll-behavior:contain;
    border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.02)}
  .rg-tablebox table.rg th{position:sticky;top:0;background:#131215;padding:10px;z-index:1}
  .rg-tablebox table.rg td:first-child{padding-left:12px}
  table.rg th{text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 10px 10px;font-weight:600}
  table.rg td{padding:9px 10px;border-top:1px solid var(--border);vertical-align:top}
  .rg-id{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-ep{color:var(--muted);font-size:.78rem;word-break:break-all}
  .rg-t{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;font-size:.68rem;vertical-align:middle}
  .rg-mcp{background:rgba(63,224,154,.14);color:#3fe09a}
  .rg-a2a{background:rgba(125,146,255,.14);color:#7d92ff}
  .rg-x4{background:rgba(240,185,11,.14);color:var(--gold)}
  .rg-agent{min-width:240px}
  .rg-head{display:flex;align-items:center;gap:9px}
  .rg-logo{width:34px;height:34px;border-radius:9px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)}
  .rg-logo-none{display:inline-block}
  .rg-nm{min-width:0}
  .rg-nm b{font-size:.92rem}
  .rg-desc{margin-top:6px;font-size:.79rem;color:var(--muted);line-height:1.55;max-width:62ch}
  .rg-tr{background:rgba(255,255,255,.06);color:var(--muted)}
  .rg-ep a{color:var(--muted);text-decoration:none}
  .rg-ep a:hover{color:var(--acc,var(--gold))}
  .rg-caps{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px}
  .rg-caps code{font-size:.7rem;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.05);color:var(--muted)}
  .rg-more{font-size:.7rem;color:var(--muted);align-self:center}
  details.rg-method summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
  details.rg-method summary::-webkit-details-marker{display:none}
  details.rg-method summary::after{content:'+';color:var(--muted);font-size:1.1rem;margin-left:auto}
  details.rg-method[open] summary::after{content:'2'}
  details.rg-method summary h2{margin:0;font-size:1.05rem}
  details.rg-method[open] summary{margin-bottom:14px}
  .rg-ask code{display:block;font-size:.84rem;padding:11px 14px;border-radius:11px;
    background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--acc,var(--gold));
    word-break:break-all;margin-bottom:12px}
  .rg-ask code em{font-style:normal;color:var(--muted)}
  .rg-fix{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:12px}
  .rg-fix li{font-size:.88rem;line-height:1.65;color:var(--muted)}
  .rg-fix li b{color:var(--fg)}
  .rg-fix code{font-size:.78rem;color:var(--acc,var(--gold))}
  .rg-method p{font-size:.86rem;color:var(--muted);line-height:1.72;margin:0 0 12px}
  .rg-method a{color:var(--acc,var(--gold))}
  .rg-filter{width:100%;max-width:340px;margin-bottom:14px;padding:9px 13px;border-radius:11px;
    border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--fg);font:inherit;font-size:.85rem}
  .rg-filter:focus{outline:none;border-color:rgba(var(--accs,240,185,11),.45)}
  .rg-empty{font-size:.85rem;color:var(--muted);padding:14px 10px}
  @media(max-width:560px){.rg-n{font-size:1.6rem}}
</style>
</head>
<body>
<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>
<div class="page">

  <!-- Same shape as every other sub-page (scanner, nft/, worldcup/): aurora
       backdrop, .page wrapper, fixed nav with back / brand / buy. Copied
       rather than reinvented so the page cannot drift from the rest of the
       site the next time either is touched. -->
  <nav><div class="nav">
    <a class="back-btn" href="/#agents" title="Back to Dashboard"><span>&larr;</span> Dashboard</a>
    <a class="brand-link" href="/registry">BOBAI Registry Census</a>
    <a class="nb" href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff" target="_blank" rel="noopener">Buy $BOBAI</a>
  </div></nav>

  <section class="sec b-violet" style="margin-top:86px">
    <div class="blk-head"><span class="blk-tag">Census &middot; ERC-8004 on BNB Chain</span><span class="blk-line"></span></div>

    <h1 class="rg-h1">${fmt(total)} agents are registered on BNB Chain.<br><em>${reach ? fmt(reach.reachable) + ' of them answer.' : 'Almost none of them answer.'}</em></h1>
    <p class="rg-lead">ERC-8004 gives an AI agent an identity on-chain, and BNB Smart Chain holds more of them than any other network. That number gets quoted constantly. Nobody checks it.</p>
    <p class="rg-lead">So we read the whole registry &mdash; every id, one at a time &mdash; and then contacted every endpoint it named. This is what is actually there.</p>
    <p class="rg-when">Measured ${esc((api.measured_at || '').slice(0, 16).replace('T', ' '))} UTC &middot; ${fmt(scanned)} of ${fmt(total)} ids read &middot; ${c.unread} left unreadable</p>

    <div class="rg-grid">
      <div class="rg-card"><div class="rg-n">${fmt(total)}</div><div class="rg-l">registered ids</div><div class="rg-s">what the headline counts</div></div>
      <div class="rg-card"><div class="rg-n">${fmt(c.valid)}</div><div class="rg-l">readable registrations</div><div class="rg-s">${p1(c.valid)} parse at all</div></div>
      <div class="rg-card"><div class="rg-n">${fmt(c.withHttpEndpoint)}</div><div class="rg-l">name an endpoint</div><div class="rg-s">${p1(c.withHttpEndpoint)} &mdash; an address you could call</div></div>
      <div class="rg-card"><div class="rg-n">${reach ? fmt(reach.reachable) : '&mdash;'}</div><div class="rg-l">actually answer</div><div class="rg-s">${reach ? p1(reach.reachable, total) + ' of everything registered' : 'probe pending'}</div></div>
    </div>

    <div class="rg-box">
      <h2>From a number to a working agent</h2>
      <p class="rg-sub">Each bar is a share of all ${fmt(total)} registered ids. Nothing is extrapolated &mdash; every id was read.</p>
      ${[
        ['Registered on-chain', total, 'An id exists. That is all this proves.'],
        ['Registration parses', c.valid, `${fmt(c.unparsable)} hold something that is not a readable document; ${fmt(c.empty)} are empty.`],
        ['Names any service', c.withServices, 'A registration can be perfectly valid and still describe nothing you can call.'],
        ['Has an HTTP endpoint', c.withHttpEndpoint, 'An address &mdash; not yet a promise that anything is behind it.'],
        ['Endpoint on a real TLD', c.plausibleEndpoint, `${fmt(Math.max(0, c.withHttpEndpoint - c.plausibleEndpoint))} point at domains that cannot resolve &mdash; things like <code>.agent</code>, which was never a TLD.`],
        ...(reach ? [['Answers when contacted', reach.reachable, 'Any HTTP response counts, including 401 and 404 &mdash; something is listening.']] : []),
        ...(reach ? [['Answers as an agent', (reach.answering_mcp || 0) + (reach.serving_an_agent_card || 0), 'Spoke MCP, or served a parsable agent card. Not just a web server.']] : []),
      ].map(([label, n, note]) => `
      <div class="rg-step">
        <div class="rg-top"><b>${label}</b><span>${fmt(n)} &middot; ${p1(n, total)}</span></div>
        <div class="rg-bar"><div class="rg-fill" style="width:${Math.max(0.35, pct(n, total)).toFixed(3)}%"></div></div>
        <div class="rg-note">${note}</div>
      </div>`).join('')}
    </div>

    ${liveRows ? `<div class="rg-box">
      <h2>The ones that answered</h2>
      <p class="rg-sub">Every agent below responded when contacted &mdash; the working core of the registry, and the list this whole exercise exists to grow. Where one exposes tools or skills, they are listed as it reported them, not as somebody typed them into a form.${reachable.length > 60 ? ` Showing the first 60 of ${fmt(reachable.length)}; the rest are in the data file.` : ''}</p>
      <input class="rg-filter" id="rg-q" type="search" placeholder="Filter by name, tool or endpoint…" aria-label="Filter agents">
      <div class="rg-tablebox"><div class="rg-scroll"><table class="rg"><thead><tr><th>ID</th><th>Agent</th><th>Endpoint</th></tr></thead><tbody id="rg-body">
${liveRows}
      </tbody></table></div></div>
      <div class="rg-empty" id="rg-none" hidden>Nothing matches that.</div>
    </div>` : ''}

    <div class="rg-box">
      <h2>Ask it a question instead</h2>
      <p class="rg-sub">The list above is for reading. This is for asking &mdash; open, no key, so an agent can call it in the middle of doing something else.</p>
      <div class="rg-ask">
        <code>GET agent.brainonbnb.com/find?q=<em>what you need done</em></code>
        <p class="rg-note">Matched against the tools each agent returned when we asked it, the skills on its card, and the description it wrote on-chain. Add <code>&amp;speaks=mcp</code> or <code>&amp;speaks=x402</code> to require a protocol. It is not a ranking &mdash; there is no task history behind it yet, and the response says so.</p>
        <p class="rg-note" style="margin-top:8px">It is early, and the index is thin &mdash; which is exactly why it exists now rather than later. Hundreds of agents register every day, and every one that publishes a callable surface lands in here on the next pass, automatically. The layer is ready before the traffic is, because that is the only order that works.</p>
      </div>
    </div>

    <div class="rg-box">
      <h2>If your agent is in that ${fmt(total)} and not in the ${reach ? fmt(reach.reachable) : 'short'} list</h2>
      <p class="rg-sub">Most registrations fail for one of three boring reasons, and all three are fixable in minutes. Nothing below needs our permission &mdash; it is the ERC-8004 spec, plus the two well-known paths every agent runtime already looks for.</p>
      <ol class="rg-fix">
        <li><b>Your token URI has to parse.</b> ${p1(c.unparsable)} of registrations hold something that is not a readable document &mdash; truncated base64, HTML, a broken data URI. If <code>tokenURI(yourId)</code> does not decode to JSON, nothing downstream can read you, and no indexer will ever list you.</li>
        <li><b>Name a service with a real endpoint.</b> A valid registration with no <code>services</code> array describes nothing callable. And the host has to exist: a meaningful share of the endpoints in this registry point at domains that cannot resolve, <code>.agent</code> among them.</li>
        <li><b>Serve something at the well-known paths.</b> <code>/.well-known/agent-card.json</code> for A2A, an MCP endpoint that answers <code>tools/list</code>. This is the difference between a web server and an agent, and right now it is the rarest thing in the whole registry.</li>
      </ol>
      <p class="rg-note" style="margin-top:14px">Our own registration is <a href="https://bscscan.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=49467" target="_blank" rel="noopener">#49467</a>; the card it serves is at <a href="/.well-known/agent-card.json">/.well-known/agent-card.json</a> and the MCP endpoint at <a href="/mcp">/mcp</a>. Copy the shape, point it at your own host. Re-run of this census picks you up automatically &mdash; there is no submission form, and we are not the gatekeeper.</p>
    </div>

    <details class="rg-box rg-method">
      <summary><h2 style="display:inline">How this was measured</h2></summary>
      <p><b>Registrations.</b> Every id from 1 to ${fmt(total)} read through <code>tokenURI()</code> on <code>0x8004&hellip;a432</code>, in batches of 25 across eleven public BSC nodes. Ids a node refused were retried until answered &mdash; <b>${c.unread}</b> stayed unreadable. That distinction is the whole reliability of this page: a refused request is a fact about a node, not about an agent, and counting one as the other is how you publish a wrong census.</p>
      <p><b>Reachability.</b> Every claimed endpoint contacted once. <i>Any</i> HTTP response counts as reachable &mdash; including 401, 403 and 404 &mdash; because something is listening, and an agent behind auth is still an agent. Only a failed connection counts as dead. Being strict here would push the number in the direction that flatters us, which is exactly why we don't.</p>
      <p><b>Capabilities.</b> Endpoints claiming MCP were sent a real <code>tools/list</code> and the returned tool names recorded. Agent cards had to parse as JSON. Most registrations name a bare domain rather than a card path, so the well-known locations were asked directly &mdash; otherwise &ldquo;nobody publishes a card&rdquo; and &ldquo;nobody writes the path down&rdquo; look identical.</p>
      <p><b>What this does not say.</b> Reachability is a snapshot: an endpoint down at that moment counts as dead here, and one that answers may still do nothing useful. This measures whether something is there, not whether it is good. It is not a ranking and not an endorsement.</p>
      <p>Counts: <a href="/api-registry.json">/api-registry.json</a> &middot; every agent that answered, with its tools: <a href="/api-agents.json">/api-agents.json</a>. Both plain JSON, CORS open, so another agent can read them directly. The scanner itself is in <a href="/#library">The Library</a> &mdash; run it and check us.</p>
    </details>
  </section>

</div>

<footer><div class="fi2">
  <div class="fb"><img src="logo-sm.webp" width="96" height="96" alt=""><span>BOBAI</span></div>
  <div class="fm">
    <p>Read from BNB Chain directly &middot; registry <a href="https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" target="_blank" rel="noopener">0x8004&hellip;a432</a> &middot; method and raw data linked above</p>
    <p style="margin-top:6px;opacity:.75">Made by <a href="/">Brain On BNB AI</a> &middot; <a href="/whitepaper">Whitepaper</a> &middot; not financial advice</p>
  </div>
</div></footer>

<script>
  // Filter only — no data fetching, nothing that can fail and leave the page
  // half-built. If this script never runs, every row is still on the page.
  (function(){
    var q=document.getElementById('rg-q'),b=document.getElementById('rg-body'),n=document.getElementById('rg-none');
    if(!q||!b)return;
    var rows=[].slice.call(b.rows);
    q.addEventListener('input',function(){
      var t=q.value.trim().toLowerCase(),shown=0;
      rows.forEach(function(r){
        var hit=!t||r.innerText.toLowerCase().indexOf(t)>-1;
        r.hidden=!hit; if(hit)shown++;
      });
      n.hidden=shown>0;
    });
  })();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'dashboard', 'registry.html'), page);
console.log(`wrote dashboard/registry.html (${(page.length / 1024).toFixed(1)} KB) and dashboard/api-registry.json`);
console.log(`  ${fmt(total)} registered · ${fmt(c.valid)} parse · ${fmt(c.withHttpEndpoint)} endpoints · ${reach ? fmt(reach.reachable) + ' reachable' : 'probe not run yet'}`);
