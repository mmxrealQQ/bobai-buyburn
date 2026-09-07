#!/usr/bin/env node
// Builds /services — the one page that answers "what can you actually do for me".
//
// WHY THIS PAGE EXISTS
// Everything this operator offers was already published, and none of it was in
// one place. The pool scanner lived on /scanner, the marketplace on /registry,
// the paid deliveries only as five rows inside a category table, the agent
// surfaces only inside a JSON document, and two of the five capability groups
// were not rendered anywhere at all. Nobody had to be lying for that to be a
// real problem: a visitor asking the plainest question a business gets had to
// assemble the answer from four pages and an API.
//
// ONE SOURCE, NOT A FOURTH COPY
// Every word of the offering below comes from worker-agent/catalog.js, which is
// the same module the worker serves at /stats. A page that retyped it would
// become the fifth surface and the first one to be wrong. Only the framing —
// which question each thing answers — is written here, because that is the part
// this page adds.
//
// The counts are the exception and they are fetched live, from the same
// endpoints anyone else can call, and they degrade to a dash. A number baked
// into a static file at build time is a number that starts drifting the moment
// the file is written; "–" is an unanswered question and "0" is a claim.
//
// SAFETY
// The build refuses to write if the agent ids in the catalog disagree with
// data/own-agents.json. A hire button that opens the wrong agent is worse than
// no hire button, and that exact bug has been paid for once already.
//
//   node scripts/build-services.mjs
//   node scripts/build-services.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';
import { CAPABILITIES, DELIVERIES, SOLD_BY } from '../worker-agent/catalog.js';
import { SERVICE_BY_SLUG } from './lib/own-agents.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dashboard', 'services.html');
const SELFTEST = process.argv.includes('--self-test');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── the check that stops a wrong hire button ─────────────────────────────
// Three files have to agree about which agent sells which service: the catalog
// the worker serves, the registration receipts, and the slug map the registry
// page uses. They are separate on purpose — one is shipped code, one is a
// receipt written by the registration script — so the only safe thing is to
// compare them on every build.
export function checkAgentIds(own) {
  const problems = [];
  for (const [serviceId, { slug, agent }] of Object.entries(SOLD_BY)) {
    const registered = own.agents?.[slug];
    if (!registered) { problems.push(`catalog sells ${serviceId} through slug "${slug}", which is not a registered agent`); continue; }
    if (Number(registered.id) !== Number(agent)) {
      problems.push(`catalog says ${serviceId} is agent ${agent}, the registration receipt says ${registered.id}`);
    }
    if (SERVICE_BY_SLUG[slug] !== serviceId) {
      problems.push(`slug "${slug}" maps to ${SERVICE_BY_SLUG[slug]} on the registry page but to ${serviceId} in the catalog`);
    }
  }
  for (const slug of Object.keys(SERVICE_BY_SLUG)) {
    if (!Object.values(SOLD_BY).some((v) => v.slug === slug)) {
      problems.push(`the registry page sells slug "${slug}", the catalog does not offer it`);
    }
  }
  return problems;
}

// What each thing is FOR, in the words somebody would use before they know our
// vocabulary. This is the only prose this file owns: the descriptions of the
// services themselves come from the catalog, and duplicating them here is how
// two descriptions of one service start to disagree.
const ASKS = {
  health_factor: 'How close is my Venus position to being liquidated?',
  grid_plan: 'Can a grid actually make money in this pool, after costs?',
  yield_plan: 'Where should this sit to earn most — and is moving it worth the gas?',
  rebalance_plan: 'What would it cost me to get back to my target weights?',
  lp_tier_plan: 'Which fee tier should I put liquidity in?',
  lp_position_plan: 'What would the liquidity agent decide about my position?',
};

// The count in words, so the copy cannot say "five" over a list of six
// (which it did from 3 September, the day the sixth was added).
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const N_DELIVERIES = WORDS[DELIVERIES.length] || String(DELIVERIES.length);
const N_DELIVERIES_CAP = N_DELIVERIES.charAt(0).toUpperCase() + N_DELIVERIES.slice(1);

// The free surfaces a person uses with a browser. Not in the catalog because
// the catalog describes what a machine can call; these are pages.
const PAGES = [
  {
    href: '/scanner',
    name: 'Pool Scanner',
    ask: 'What would a trade of my size actually cost in this pool?',
    what: 'Measures any BNB Chain pool from the chain itself: depth, price impact at your size, and the transfer tax read from trades that really executed rather than from a label. Also compares all five PancakeSwap fee tiers a pair can live in and says which one actually paid its liquidity providers.',
    cost: 'Free, no account, no key.',
  },
  {
    href: '/registry',
    name: 'Brain Plaza',
    ask: 'Is there an agent on this chain that can do the thing I need?',
    what: 'Every ERC-8004 agent on BNB Chain, read one id at a time and contacted at the endpoint it names, sorted into the four things people hire an agent for. Each row says how we know, whether it answered when asked for a price, and what it has actually been paid for.',
    cost: 'Free to read. Hiring runs over the escrow and costs whatever that agent quotes.',
  },
  {
    href: '/advantage',
    name: 'Agent Advantage Report',
    ask: 'Is any of this faster than just doing it myself?',
    what: 'Three real tasks on BNB Chain, each done twice — once by asking an agent, once by hand — with wall-clock, request counts and, more usefully, what the hand-done route could not answer at all.',
    cost: 'Free.',
  },
  {
    href: '/session',
    name: 'Session keys',
    ask: 'Can I let an agent spend, without handing it my wallet?',
    what: 'A spending session with an allowlist, a cap and an expiry, registered on-chain and revocable in one transaction. Ours are live on mainnet with the transactions to prove each step.',
    cost: 'Free to read; the transactions are yours to send.',
  },
  {
    href: '/source',
    name: 'The source',
    ask: 'Can I check that any of this does what it says?',
    what: 'The whole repository, clonable from this domain: git clone https://brainonbnb.com/source.git — every measurement on this site is produced by a script in there.',
    cost: 'Free.',
  },
];

// ── the page ─────────────────────────────────────────────────────────────
const card = (p) => `      <article class="sv-card">
        <h3><a href="${esc(p.href)}">${esc(p.name)}</a></h3>
        <p class="sv-ask">${esc(p.ask)}</p>
        <p class="sv-what">${esc(p.what)}</p>
        <p class="sv-cost">${esc(p.cost)}</p>
      </article>`;

const needsList = (needs) => {
  const items = Object.entries(needs || {});
  if (!items.length) return '';
  return `        <dl class="sv-needs">${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
};

const delivery = (d) => `      <article class="sv-buy">
        <div class="sv-buy-h">
          <h3>${esc(d.name)}</h3>
          <span class="sv-price">${esc(d.price)}</span>
        </div>
        ${ASKS[d.id] ? `<p class="sv-ask">${esc(ASKS[d.id])}</p>` : ''}
        <p class="sv-what">${esc(d.what)}</p>
        <p class="sv-needs-h">What it needs from you</p>
${needsList(d.needs)}
        ${d.agent ? `<p class="sv-cost">Delivered by agent <a href="https://8004scan.io/agents/bsc/${d.agent}" rel="noopener">#${d.agent}</a> &middot; <a href="${esc(d.where)}">hire it on Brain Plaza &rarr;</a></p>`
          : `<p class="sv-cost">Sold per answer only, no escrow: <code>${esc(d.x402)}</code> &middot; paid in USD1 or $BOBAI &middot; <a href="/liquidity">what the agent does on our own position &rarr;</a></p>`}
      </article>`;

const capRow = (c) => {
  const isCmd = c.where && !/^(https?:\/\/|POST |GET )/i.test(c.where);
  const url = c.where && /^(POST|GET)\s+/i.test(c.where) ? c.where.replace(/^\w+\s+/, '').split(/\s+/)[0] : c.where;
  // A URL with a placeholder in it (<id>, 0x..., /api/*) is the shape of a
  // call, not a page: linking it sent a visitor to a 400 (found 2026-09-04).
  // The shape is shown as code; the catalogue's working example is the link.
  const isShape = !!url && /[<>*]|0x\.\.\./.test(url);
  const head = url && !isCmd && !isShape
    ? `<a href="${esc(url)}" rel="noopener">${esc(c.name)}</a>`
    : (c.example ? `<a href="${esc(c.example)}" rel="noopener">${esc(c.name)}</a>` : esc(c.name));
  return `        <li><b>${head}</b>${c.price ? ` <span class="sv-price sv-price-s">${esc(c.price)}</span>` : ''}
          <span>${esc(c.what)}</span>${isCmd || (isShape && !/^(POST|GET)\s/i.test(c.where || '')) ? `<code>${esc(c.where)}</code>` : ''}${
  /^(POST|GET)\s/i.test(c.where || '') ? `<code>${esc(c.where)}</code>` : ''}${
  c.example && isShape ? `<span class="sv-limit">Try it: <a href="${esc(c.example)}" rel="noopener">${esc(c.example.replace(/^https?:\/\//, ''))}</a></span>` : ''}${
  c.limit ? `<span class="sv-limit">${esc(c.limit)}</span>` : ''}${
  c.why_paid ? `<span class="sv-limit">Paid because ${esc(c.why_paid)}.</span>` : ''}</li>`;
};

const GROUPS = [
  ['free', 'Free, and staying free', 'Reading public chain data costs us almost nothing, so none of this has a key, an account or a signup.'],
  ['broker', 'Finding somebody else', 'We will happily point you at an agent that is not ours.'],
  ['hire', 'Handing over a task', 'One call, and it finds the agent, runs the task and names who produced the answer.'],
  ['record', 'Checking our claims', 'The track record is derived from a log, not typed in by the operator it flatters.'],
  ['paid', 'The one thing that costs money', 'Everything else here is a measurement taken once. This one keeps running after you close the tab, which is the whole reason it is not free.'],
];

function page() {
  return `<!DOCTYPE html>
<!-- Generated by scripts/build-services.mjs from worker-agent/catalog.js, which
     is the same module the worker serves at agent.brainonbnb.com/stats.
     Do not edit by hand: an offer described in two places is an offer that will
     eventually describe itself two different ways. -->
<html lang="en" style="background:#0c0b0c">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/spacegrotesk-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css?v=1">
<title>What we can do for you — Brain on BNB</title>
<meta name="description" content="Everything Brain on BNB offers in one place: free pool measurement and an agent marketplace in the browser, ${N_DELIVERIES} things you can hire us to deliver on-chain for 0.10 $U, and the tools your own agent can call.">
<link rel="canonical" href="https://brainonbnb.com/services">
<link rel="icon" type="image/png" href="/favicon.png?v=4">
<meta property="og:title" content="What we can do for you — Brain on BNB">
<meta property="og:description" content="Free in the browser, hireable on-chain, callable by your agent. The whole offer on one page.">
<meta property="og:image" content="https://brainonbnb.com/og-banner.png">
<meta property="og:url" content="https://brainonbnb.com/services">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/styles.css?v=37">
<style>
  .sv{max-width:1000px;margin:0 auto;padding:0 20px 60px}
  .sv-hero{padding:106px 0 8px}
  .sv-hero h1{font-family:'Space Grotesk',system-ui,sans-serif;font-size:clamp(28px,5vw,44px);line-height:1.08;margin:0 0 14px}
  .sv-hero h1 em{color:var(--gold);font-style:normal}
  .sv-lead{color:var(--muted);font-size:17px;line-height:1.6;max-width:68ch}
  .sv-lead b{color:var(--text);font-weight:600}
  .sv-sec{margin-top:44px}
  .sv-sec > h2{font-family:'Space Grotesk',system-ui,sans-serif;font-size:1.35rem;margin:0 0 6px}
  .sv-sec > p.sv-sub{color:var(--muted);font-size:.86rem;line-height:1.6;max-width:70ch;margin:0 0 18px}
  /* auto-fit rather than a fixed count: the same rule has to hold a five-card
     row on a laptop and one column on a phone without a second breakpoint. */
  .sv-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  .sv-card,.sv-buy{border:1px solid var(--border);border-radius:var(--radius);background:var(--card);padding:16px 18px;min-width:0}
  .sv-card h3,.sv-buy h3{font-size:.95rem;margin:0 0 6px;font-weight:600}
  .sv-card h3 a{color:var(--text);text-decoration:none}
  .sv-card h3 a:hover{color:var(--gold)}
  .sv-ask{color:var(--gold);font-size:.84rem;line-height:1.5;margin:0 0 8px}
  .sv-what{color:var(--muted);font-size:.8rem;line-height:1.6;margin:0}
  .sv-cost{color:var(--muted);font-size:.75rem;line-height:1.5;margin:10px 0 0;opacity:.85}
  .sv-buy-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .sv-price{color:var(--gold);font-weight:600;font-size:.82rem;white-space:nowrap;font-variant-numeric:tabular-nums}
  /* A price is one short figure and stays on one line. The x402 line carries a
     sentence ("0.10 USD1 per answer, or the same in $BOBAI…") and at 390px that
     sentence, kept on one line, pushed the whole page 37px wider than the phone
     (2026-09-03). Long ones wrap; the number is still the first thing read. */
  .sv-price-s{font-size:.72rem;white-space:normal;overflow-wrap:anywhere}
  .sv-needs-h{color:var(--text);font-size:.74rem;margin:12px 0 4px;font-weight:600;letter-spacing:.2px}
  .sv-needs{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:.74rem;color:var(--muted);margin:0}
  .sv-needs dt{color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-width:0;overflow-wrap:anywhere}
  .sv-needs dd{margin:0;min-width:0;overflow-wrap:anywhere}
  .sv-how{border:1px solid var(--border);border-radius:var(--radius);background:rgba(240,185,11,.05);padding:14px 18px;margin-top:14px;
    color:var(--muted);font-size:.8rem;line-height:1.6}
  .sv-how b{color:var(--text)}
  .sv-caps{list-style:none;display:grid;gap:12px;margin:0;padding:0}
  .sv-caps li{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:12px 14px;min-width:0}
  .sv-caps b{font-size:.85rem;display:inline}
  .sv-caps b a{color:var(--text);text-decoration:none;border-bottom:1px solid rgba(240,185,11,.35)}
  .sv-caps b a:hover{color:var(--gold)}
  .sv-caps span{display:block;color:var(--muted);font-size:.78rem;line-height:1.6;margin-top:4px}
  .sv-caps code{display:block;margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(0,0,0,.35);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--text);overflow-wrap:anywhere}
  .sv-limit{font-style:italic;opacity:.85}
  .sv-limit a{overflow-wrap:anywhere;word-break:break-all}
  .sv-nums{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:18px 0 0}
  .sv-num{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:13px 15px;min-width:0}
  .sv-num b{display:block;font-family:'Space Grotesk',system-ui,sans-serif;font-size:1.5rem;color:var(--gold);
    font-variant-numeric:tabular-nums;line-height:1.1}
  .sv-num span{display:block;color:var(--muted);font-size:.74rem;line-height:1.45;margin-top:3px}
  /* A count that stands still needs its date next to it, or a reader cannot
     tell a quiet chain from a stale file. */
  .sv-num i{display:block;font-style:normal;opacity:.7;font-size:.68rem;margin-top:2px}
  .sv-not li{color:var(--muted);font-size:.84rem;line-height:1.65;margin-bottom:8px}
  .sv-not b{color:var(--text)}
</style>
</head>
<body>
<!-- Same shell as every other page on this site: aurora, a way back, a footer.
     A page that answers "what do you offer" is the wrong place to look like it
     was bolted on afterwards. -->
<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>
<div class="page">
  <nav><div class="nav">
    <a class="back-btn" href="/" title="Back to Dashboard"><span>&larr;</span> Dashboard</a>
    <a class="brand-link" href="/services">Services</a>
    <a class="nb" href="/registry">Brain Plaza</a>
  </div></nav>

<main class="sv">
  <header class="sv-hero">
    <h1>What we can do <em>for you</em></h1>
    <p class="sv-lead">We measure things on BNB Chain and tell you what we found. <b>Nothing here signs anything, and nothing needs your wallet</b> until you decide to buy something.</p>
    <section class="primer" style="margin-top:20px">
      <p class="primer-what"><b>Three ways to get the same work.</b> Pick whichever suits you &mdash; they run the same code underneath.</p>
      <ul class="primer-do">
        <li><b>Open a page and look</b>Free, no account. Paste a token address, or browse the agent marketplace. This is where most people start.</li>
        <li><b>Pay ten cents for an answer</b>${N_DELIVERIES_CAP} specific questions we answer on request, delivered on-chain. You need a wallet and about $0.10 for this one.</li>
        <li><b>Let your own AI call us</b>If you use an AI assistant that can call tools, it can use ours directly. One command to install.</li>
      </ul>
      <p class="primer-how"><b>Not sure where to start?</b> Open <a href="/scanner">the Pool Scanner</a> and paste any BNB Chain token address. It shows you what a trade would really cost &mdash; the shortest way to see what kind of answers this whole site produces.</p>
    </section>
    <div class="sv-nums">
      <div class="sv-num"><b id="sv-agents">&ndash;</b><span>agent ids read on-chain</span></div>
      <div class="sv-num"><b id="sv-reach">&ndash;</b><span>of them answer when contacted <i id="sv-when"></i></span></div>
      <div class="sv-num"><b id="sv-asked">${ASKED_FLOOR ? ASKED_FLOOR.toLocaleString('en-US') : '&ndash;'}</b><span>requests answered for other agents</span></div>
      <div class="sv-num"><b>${DELIVERIES.length}</b><span>things you can hire us to deliver</span></div>
    </div>
  </header>

  <section class="sv-sec">
    <h2>Open a page</h2>
    <p class="sv-sub">Nothing to install, nothing to connect. Each of these answers one question and shows its working.</p>
    <div class="sv-grid">
${PAGES.map(card).join('\n')}
    </div>
  </section>

  <section class="sv-sec">
    <h2>Hire us to deliver it</h2>
    <p class="sv-sub">${N_DELIVERIES_CAP} answers we produce on request, each priced the same and each one a measurement rather than an opinion. They exist because a page you have to read is not the same as an answer delivered to your agent while you are asleep.</p>
    <div class="sv-grid">
${DELIVERIES.map(delivery).join('\n')}
    </div>
    <p class="sv-how"><b>How paying works, and what protects you.</b> ${esc(DELIVERIES[0].how)} We never hold your key: the hire panel hands you unsigned calls and you send them from your own wallet. The price above is what the agent quotes when asked — if it ever quotes something else, the quote wins and the page is wrong.</p>
  </section>

  <section class="sv-sec">
    <h2>Point your own agent at us</h2>
    <p class="sv-sub">The same measurements, callable. This is the machine-readable half of the site, and it is the half that has earned money from strangers.</p>
${GROUPS.filter(([k]) => (CAPABILITIES[k] || []).length).map(([k, title, sub]) => `    <h3 class="sv-needs-h" style="margin:18px 0 4px;font-size:.85rem">${esc(title)}</h3>
    <p class="sv-sub" style="margin-bottom:10px">${esc(sub)}</p>
    <ul class="sv-caps">
${CAPABILITIES[k].map(capRow).join('\n')}
    </ul>`).join('\n')}
  </section>

  <section class="sv-sec">
    <h2>What we will not do</h2>
    <p class="sv-sub">Worth as much as the list above, and shorter.</p>
    <ul class="sv-not">
      <li><b>We do not sign anything for you.</b> Every path that moves money hands you unsigned calls. This service holds no key of yours and could not spend your funds if it wanted to.</li>
      <li><b>We do not tell you what to buy.</b> Every service here returns a measurement and its window. What a correction is worth, or whether a position is a good idea, is a judgement about risk and not a quantity in a pool.</li>
      <li><b>We do not invoke anything that writes.</b> The dispatcher calls read-only tools. Anything that signs, sends, swaps or orders is listed for you to call yourself.</li>
      <li><b>We do not fill in a number we could not read.</b> A figure that could not be measured renders as a dash, never as a zero — on this page too.</li>
    </ul>
  </section>

</main>

<footer><div class="fi2">
  <div class="fb"><img src="/logo-sm.webp" width="96" height="96" alt=""><span>BOBAI</span></div>
  <div class="fm">
    <p>Everything here is generated from <code>worker-agent/catalog.js</code> &middot; the same offer a machine reads at <a href="https://agent.brainonbnb.com/stats" rel="noopener">/stats</a> &middot; the code is published at <a href="/source">/source</a></p>
    <p style="margin-top:6px;opacity:.75">Made by <a href="/">Brain On BNB AI</a> &middot; <a href="/registry">Brain Plaza</a> &middot; <a href="/scanner">Pool Scanner</a> &middot; <a href="/whitepaper">Whitepaper</a></p>
  </div>
</div></footer>
</div>
<script>
// Live counts only, from the same endpoints anybody else can call. A count
// baked into this file at build time would start drifting the moment it was
// written; a dash says "we could not read this just now", which is true, and a
// zero would say something that is not.
(function(){
  var el = function(id){ return document.getElementById(id); };
  var nf = function(n){ return Number(n).toLocaleString('en-US'); };
  // Same two steps the home page takes, deliberately: the file /registry is
  // built from, then the census worker's live high-water mark, which may only
  // RAISE the figure. Taking the worker unconditionally once made the home page
  // show three thousand fewer agents than the marketplace it linked to.
  fetch('/api-registry.json', {cache:'no-store'}).then(function(r){ return r.ok ? r.json() : Promise.reject(0); })
    .then(function(d){
      var floor = Number(d.registered_ids) || 0;
      if (floor) el('sv-agents').textContent = nf(floor);
      if (d.reachability && d.reachability.reachable != null) el('sv-reach').textContent = nf(d.reachability.reachable);
      if (d.measured_at) el('sv-when').textContent = 'census of ' + String(d.measured_at).slice(0, 10);
      return fetch('https://agent.brainonbnb.com/census', {cache:'no-store'})
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(cs){
          var live = cs && cs.highest_id ? Number(cs.highest_id) : 0;
          if (live > floor) el('sv-agents').textContent = nf(live);
        });
    }).catch(function(){});
  fetch('https://agent.brainonbnb.com/stats', {cache:'no-store'}).then(function(r){ return r.ok ? r.json() : Promise.reject(0); })
    .then(function(d){
      var n = d.asked && d.asked.total;
      if (n != null) el('sv-asked').textContent = nf(n);
    }).catch(function(){});
})();
</script>
</body>
</html>
`;
}

// ── self-test ────────────────────────────────────────────────────────────
if (SELFTEST) {
  const problems = [];
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
  for (const p of checkAgentIds(own)) problems.push(p);

  // The drift check has to fail when there is drift, or it is decoration.
  const broken = JSON.parse(JSON.stringify(own));
  broken.agents['health-factor'].id = 999999;
  if (!checkAgentIds(broken).length) problems.push('the agent-id check passed a receipt that disagrees with the catalog');

  const html = page();
  for (const d of DELIVERIES) {
    if (d.agent && !html.includes(String(d.agent))) problems.push(`agent ${d.agent} is missing from the page`);
    if (!d.agent && !html.includes(esc(d.x402))) problems.push(`${d.id} has no escrow agent and the page does not show its x402 door`);
    if (html.includes('#null')) problems.push('a delivery is credited to agent #null');
    // The service description must be the catalog's, not a retyped one.
    if (!html.includes(esc(d.what).slice(0, 60))) problems.push(`${d.id} does not carry the catalog's own description`);
  }
  for (const group of Object.keys(CAPABILITIES)) {
    for (const c of CAPABILITIES[group]) {
      if (!html.includes(esc(c.name))) problems.push(`capability "${c.name}" (${group}) is not rendered`);
    }
  }
  if (/>\s*0\s*</.test(html.replace(/[\s\S]*?<main/, '').replace(/<script[\s\S]*/, ''))) {
    problems.push('a bare zero was rendered where a dash belongs');
  }

  console.log('\nServices page self-test');
  if (problems.length) { for (const p of problems) console.log('  x ' + p); process.exit(1); }
  console.log(`  ${DELIVERIES.length} deliveries and every capability group render`);
  console.log('  every description comes from the catalog, not from this file');
  console.log('  the agent ids agree with the registration receipts');
  console.log('  a receipt that disagrees is caught');
  console.log('\nno problems.');
  process.exit(0);
}

const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
const problems = checkAgentIds(own);
if (problems.length) {
  console.error('refusing to build — the catalog and the registration receipts disagree:');
  for (const p of problems) console.error('  x ' + p);
  process.exit(1);
}

// The requests tile used to open with a dash and stay that way for as long as
// /stats took to answer — up to eight seconds on a cold worker, read as a
// stranger. The count at build time is baked in as a floor, the same way the
// census floor works: the live figure replaces it when it arrives and can only
// be larger, since the counter never goes down.
const ASKED_FLOOR = await fetch('https://agent.brainonbnb.com/stats', { signal: AbortSignal.timeout(20000) })
  .then((r) => (r.ok ? r.json() : null)).then((d) => Number(d?.asked?.total) || 0).catch(() => 0);
if (!ASKED_FLOOR) console.warn('  /stats did not answer at build time — the requests tile opens with a dash until the live figure arrives');
const html = page();
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
console.log(`  ${PAGES.length} pages · ${DELIVERIES.length} deliveries · ${Object.values(CAPABILITIES).flat().length} agent capabilities`);
