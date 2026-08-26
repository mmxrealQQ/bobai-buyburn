// Checks the promises the site makes about itself and about the outside world.
//
// The other five audits each look inward. health.mjs asks whether our services
// answer, smoke asks whether the agent surface is honest, site-audit reads the
// files, asset-audit loads what a page references, layout-audit measures what a
// browser renders. None of them ever follows a link that leaves the page, and
// none of them reads sitemap.xml or llms.txt at all — which is how /nft/ came
// to be live, titled, linked from the homepage AND the whitepaper, and listed
// in neither. It sat like that for weeks with every check green.
//
// Four questions, in the order a stranger meets them:
//
//   1. Every link we set ourselves resolves. Rows about foreign agents in the
//      census carry rel="nofollow" and are excluded on purpose — a dead
//      endpoint there is the finding we published, not a defect of ours.
//   2. Every page we advertise from a front door is in sitemap.xml, and every
//      entry in sitemap.xml is really there.
//   3. Every URL llms.txt hands an agent answers, and answers in the format it
//      implies. An endpoint that returns HTML where JSON was promised is the
//      failure mode this domain is built to hide (see below).
//   4. The agent card and the x402 catalogue are fetched live and their links
//      followed, because those are read by machines that will not forgive a
//      404 the way a person clicking around would.
//
// Two traps this file exists to not fall into:
//
//   The site answers ANY unrouted path with 200 and the dashboard HTML. A
//   status code therefore proves nothing, and every check here reads the body.
//
//   BscScan, DexScreener and Birdeye answer scripts with 403 no matter what.
//   Reporting those as dead links buries the one real finding under thirty
//   false ones. They are reported separately, as unverifiable — and a 404 from
//   them is still a failure, because forgiving a whole host would hide a link
//   that really is dead.
//
// Usage:
//   node scripts/link-audit.mjs
//   node scripts/link-audit.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DASH = path.join(ROOT, 'dashboard');
const SITE = 'https://brainonbnb.com';
const args = process.argv.slice(2);

// Hosts that refuse automated requests as a matter of policy. Only 403 and 429
// are forgiven — the statuses that mean "we can see you are a script". A 404
// from these is a real dead link and is reported as one.
const BOT_WALLED = new Set([
  'bscscan.com', 'www.bscscan.com', 'dexscreener.com', 'www.dexscreener.com',
  'birdeye.so', 'www.dextools.io', 'dextools.io', 'gmgn.ai',
  'blockspot.io', 'www.coingecko.com',
]);
const FORGIVEN = new Set([403, 429]);

// A link that is dead on purpose, and said to be dead on the page carrying it.
// The exemption is conditional: the audit re-reads the page and only stays
// quiet while the disclosure is still there. Delete the sentence and this
// becomes a finding again, which is the point — the link is only acceptable
// because the reader is warned, so the warning is the thing worth guarding.
const KNOWN_DEAD = {
  'https://github.com/mmxrealQQ/bobai-buyburn': {
    page: 'index.html',
    mustSay: 'Returns <b>404</b> right now',
    why: 'GitHub account flagged 2026-07-24, appeal open; nothing was deleted',
  },
};

// Pages that are deliberately outside the sitemap. Each needs a reason, so
// that adding one is a decision rather than a way to silence the check.
const NOT_IN_SITEMAP = {
  'worldcup/index.html': 'archived event, frozen — kept reachable, not promoted',
};

const stripScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'code' && e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
};

// ---------------------------------------------------------------------------
// SELF-TEST
//
// Every one of these is a way this specific script could report green while
// being blind, which is worse than not having it.
//
// Run: node scripts/link-audit.mjs --self-test
if (args.includes('--self-test')) {
  const fails = [];

  // 1. The nofollow discriminator is the whole basis for telling our claims
  //    apart from census data. If it inverts or stops matching, this audit
  //    either reports hundreds of foreign endpoints as our dead links, or
  //    silently stops checking anything at all.
  const sample = '<a href="https://ours.example" rel="noopener">a</a>'
    + '<a href="https://theirs.example" target="_blank" rel="noopener nofollow">b</a>';
  const picked = [...stripScripts(sample).matchAll(/<a\b([^>]*)>/g)]
    .filter((m) => !/nofollow/.test(m[1]))
    .map((m) => (m[1].match(/href\s*=\s*"([^"]+)"/) || [])[1]);
  if (!picked.includes('https://ours.example')) fails.push('our own links are no longer being collected');
  if (picked.includes('https://theirs.example')) fails.push('census rows marked nofollow are leaking in — findings about others would be reported as our defects');

  // 2. Hrefs a script builds at runtime are not markup. site-audit shipped
  //    exactly this bug once and reported a working link as dead.
  const withScript = stripScripts('<a href="/real" rel="noopener">r</a><script>var u = "<a href=\'/invented\'>";</script>');
  if (withScript.includes('/invented')) fails.push('script bodies are not stripped — hrefs built in JS will be read as markup');
  if (!withScript.includes('/real')) fails.push('stripping removed real markup as well as the script');

  // 3. The 200+HTML trap. If looksHtml stops recognising a document, every
  //    JSON endpoint on the site passes forever, including the ones that have
  //    quietly stopped being routed.
  if (!looksHtml('<!doctype html><html><body>hi</body></html>')) fails.push('an HTML document is no longer recognised — the 200+HTML trap would go undetected');
  if (!looksHtml('\n  <html lang="en">')) fails.push('HTML with leading whitespace is not recognised');
  if (looksHtml('{"ok":true}')) fails.push('JSON is being misread as HTML — real endpoints would be reported dead');

  // 4. The bot-protection allowance must forgive exactly 403/429 and nothing
  //    else. Forgiving a whole host would hide a link that is genuinely gone.
  if (!forgiven('bscscan.com', 403)) fails.push('403 from a bot-walled host is not being forgiven — real findings would be buried');
  if (forgiven('bscscan.com', 404)) fails.push('a 404 from a bot-walled host is being forgiven — a genuinely dead link would be invisible');
  if (forgiven('brainonbnb.com', 403)) fails.push('our own host is being treated as bot-walled');

  // 5. The sitemap comparison must actually see a missing page. This is the
  //    /nft/ failure, planted.
  const missing = sitemapGaps(['/', '/registry'], ['https://brainonbnb.com/']);
  if (!missing.includes('/registry')) fails.push('a page absent from the sitemap is not detected — this is the exact bug the script was written for');

  // 6. The known-dead exemption is conditional on the page still explaining
  //    itself. If it ever becomes unconditional it is just a way to silence a
  //    broken link permanently, which is the opposite of what it is for.
  for (const [u, k] of Object.entries(KNOWN_DEAD)) {
    const carrier = fs.readFileSync(path.join(DASH, k.page), 'utf8');
    if (!carrier.includes(k.mustSay)) fails.push(`${k.page} no longer contains the disclosure for ${u} — either the page changed or the expected wording is stale`);
    if (carrier.includes(k.mustSay + ' ZZ')) fails.push('the disclosure check is not comparing text at all');
  }

  // 7. No control characters in this file. Writing it produced a literal NUL
  //    byte where a space was meant, inside a string comparison — grep called
  //    the file binary and no editor showed anything wrong. site-audit carries
  //    the same guard for the same reason.
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const ctrl = [...src].filter((c) => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32));
  if (ctrl.length) fails.push(`this file contains ${ctrl.length} control character(s) — a comparison here is probably not what it looks like`);

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error(`  x ${f}`);
    process.exit(1);
  }
  console.log('self-test passed: nofollow separates ours from theirs, scripts are stripped, HTML-where-JSON is caught, 403 is forgiven but 404 is not, a missing sitemap entry is seen');
  process.exit(0);
}

function looksHtml(body) { return /^\s*(<!doctype\s+html|<html)/i.test(body); }
function forgiven(host, status) { return BOT_WALLED.has(host) && FORGIVEN.has(status); }
function sitemapGaps(advertised, sitemapUrls) {
  const have = new Set(sitemapUrls.map((u) => u.replace(SITE, '') || '/'));
  return advertised.filter((p) => !have.has(p));
}

// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const probe = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const body = (await r.text()).slice(0, 600);
    return { status: r.status, ct: (r.headers.get('content-type') || '').split(';')[0], html: looksHtml(body), body };
  } catch (e) {
    return { status: 0, err: String(e.message || e).slice(0, 70) };
  }
};

// One request at a time per host. A host given twelve simultaneous requests
// answers like a host under attack, and this project has already published one
// finding that was really its own rate limit.
const probeAll = async (urls) => {
  const byHost = new Map();
  for (const u of urls) {
    let h; try { h = new URL(u).host; } catch { continue; }
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(u);
  }
  const out = new Map();
  await Promise.all([...byHost.values()].map(async (list) => {
    for (const u of list) out.set(u, await probe(u));
  }));
  return out;
};

const findings = [];
const notes = [];
const fail = (what, detail) => findings.push({ what, detail });

// --- 1. every link we set ourselves -----------------------------------------

const pages = walk(DASH);
const ours = new Map();
for (const f of pages) {
  const rel = path.relative(DASH, f).split(path.sep).join('/');
  const h = stripScripts(fs.readFileSync(f, 'utf8'));
  for (const m of h.matchAll(/<a\b([^>]*)>/g)) {
    if (/nofollow/.test(m[1])) continue;
    const href = (m[1].match(/href\s*=\s*"([^"]+)"/) || [])[1];
    if (!href || !/^https?:\/\//.test(href)) continue;
    if (/brainonbnb\.(com|ai)/.test(href)) continue;
    if (!ours.has(href)) ours.set(href, new Set());
    ours.get(href).add(rel);
  }
}

const extResults = await probeAll([...ours.keys()]);
let walled = 0;
for (const [u, r] of extResults) {
  const host = new URL(u).host;
  if (r.status >= 200 && r.status < 400) continue;
  if (forgiven(host, r.status)) { walled++; continue; }
  const known = KNOWN_DEAD[u];
  if (known) {
    const carrier = fs.readFileSync(path.join(DASH, known.page), 'utf8');
    if (carrier.includes(known.mustSay)) { notes.push(`1 link dead on purpose and labelled as such on ${known.page} (${known.why})`); continue; }
    fail('a link known to be dead is no longer labelled', `${u}\n      ${known.page} no longer says "${known.mustSay}" — the link now reads as broken rather than explained`);
    continue;
  }
  fail(`outbound link ${r.status || 'unreachable'}`, `${u}\n      on: ${[...ours.get(u)].join(', ')}${r.err ? '\n      ' + r.err : ''}`);
}
notes.push(`${ours.size} links we set ourselves · ${walled} on hosts that refuse scripts (403, not checkable)`);

// --- 2. sitemap -------------------------------------------------------------

const sitemapUrls = [...fs.readFileSync(path.join(DASH, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

// What the front doors advertise. A page reachable from the homepage or the
// whitepaper is a page we are asking people to visit.
const advertised = new Set();
for (const door of ['index.html', 'whitepaper.html']) {
  const h = stripScripts(fs.readFileSync(path.join(DASH, door), 'utf8'));
  for (const m of h.matchAll(/href="([^"]+)"/g)) {
    let u = m[1].replace(/^https:\/\/brainonbnb\.com/, '').split('#')[0].split('?')[0];
    if (!u || /^(https?:|mailto:)/.test(u)) continue;
    const clean = u.replace(/^\//, '');
    // Only pages. Assets, bundles and worker routes are not sitemap material,
    // and the test for "is it a page" is whether an HTML file is really there.
    const candidates = [clean, clean + 'index.html', clean + '.html', clean.replace(/\/$/, '') + '/index.html'];
    const hit = candidates.find((c) => c.endsWith('.html') && fs.existsSync(path.join(DASH, c)));
    if (hit) advertised.add(hit);
  }
}

const sitemapPaths = new Set(sitemapUrls.map((u) => u.replace(SITE, '') || '/'));
for (const page of advertised) {
  if (NOT_IN_SITEMAP[page]) continue;
  const asPath = '/' + page.replace(/index\.html$/, '').replace(/\.html$/, '');
  if (!sitemapPaths.has(asPath) && !sitemapPaths.has(asPath + '/')) {
    fail('advertised page missing from sitemap.xml', `${page} is linked from a front door and is not listed — search engines and agents will not find it`);
  }
}

const smResults = await probeAll(sitemapUrls);
for (const [u, r] of smResults) {
  if (r.status !== 200) fail(`sitemap entry ${r.status || 'unreachable'}`, u);
}
notes.push(`${sitemapUrls.length} sitemap entries · ${advertised.size} pages advertised from a front door`);

// --- 3 + 4. what we hand to agents ------------------------------------------

const declared = new Map(); // url -> where it was declared

const addDeclared = (u, src) => {
  u = u.replace(/[.,;:`)\]]+$/, '');
  if (!/^https?:\/\//.test(u)) return;
  if (!/brainonbnb\.(com|ai)/.test(u)) return;
  if (u.includes('0x...') || u.includes('<') || u.includes('…')) return; // placeholders, not addresses
  if (!declared.has(u)) declared.set(u, new Set());
  declared.get(u).add(src);
};

for (const m of fs.readFileSync(path.join(DASH, 'llms.txt'), 'utf8').matchAll(/https?:\/\/[^\s)>,"'`]+/g)) addDeclared(m[0], 'llms.txt');

for (const [label, url] of [['agent card', `${SITE}/.well-known/agent-card.json`], ['x402 catalogue', `${SITE}/.well-known/x402`]]) {
  const r = await probe(url);
  if (r.status !== 200 || r.html) { fail(`${label} does not serve JSON`, `${url} — status ${r.status}${r.html ? ', answered with HTML' : ''}`); continue; }
  for (const m of r.body.matchAll(/https?:\/\/[^\s"']+/g)) addDeclared(m[0], label);
}

// A POST-only endpoint is not broken for answering GET differently; what it
// must not do is claim not to exist. That is the /watch failure, generalised.
const decResults = await probeAll([...declared.keys()]);
for (const [u, r] of decResults) {
  const where = [...declared.get(u)].join(', ');
  if (r.status === 0) { fail('declared endpoint unreachable', `${u}\n      declared in: ${where}\n      ${r.err}`); continue; }
  if (r.status === 404) { fail('declared endpoint answers 404', `${u}\n      declared in: ${where} — an agent following this concludes the service does not exist`); continue; }
  if (r.status >= 500) { fail(`declared endpoint ${r.status}`, `${u}\n      declared in: ${where}`); continue; }
  // Anything under /api, /.well-known or ending .json promised JSON.
  const promisedJson = /\.json$|\/\.well-known\/|\/api[-/]|\/mcp$/.test(u);
  if (promisedJson && r.html) fail('HTML where JSON was promised', `${u}\n      declared in: ${where} — the domain answers unrouted paths with the dashboard page, so this endpoint is probably not routed`);
}
notes.push(`${declared.size} endpoints declared to agents in llms.txt, the agent card and the x402 catalogue`);

// --- report -----------------------------------------------------------------

console.log('\nLink audit\n');
for (const n of notes) console.log('  ' + n);
console.log('');

if (!findings.length) {
  console.log('every promise the site makes resolves.');
} else {
  console.log(`${findings.length} problem${findings.length === 1 ? '' : 's'}\n`);
  for (const f of findings) console.log(`  XX ${f.what}\n      ${f.detail}\n`);
  process.exitCode = 1;
}
