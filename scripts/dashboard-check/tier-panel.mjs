// The fee-tier card on /scanner, driven the way a visitor drives it.
//
// The page audit next door scans a result and never presses anything, so a card
// that only appears behind a button is invisible to it. This one clicks, waits
// for the measurement, and then asks the three questions that matter:
//
//   does it render at all, with a figure per readable tier
//   does it say which tier holds the capital and which one pays
//   does it fit — at 390px, where four columns have to become two
//
// It also checks the thing this card exists to avoid: a run where the log
// endpoint refused every range must NOT read as "nothing traded". Those are
// different sentences and the card is required to use the right one.
//
// Usage:
//   node scripts/dashboard-check/tier-panel.mjs             desktop, fee tiers
//   W=390 node scripts/dashboard-check/tier-panel.mjs       phone
//   PANEL=range node scripts/dashboard-check/tier-panel.mjs the range replay
//   PANEL=route node scripts/dashboard-check/tier-panel.mjs the route card (for trading)
//
// Two cards, one checker. They are built from the same markup — the same rows,
// the same phone labels, the same answer block above the table — so checking
// them with two near-identical files would mean fixing every assertion twice
// and forgetting once. PANEL picks which button gets pressed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9341);
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 900);
// CAKE: four of its five tiers normally see flow and the fifth holds money and
// sees none, which exercises both the ranking and the idle-capital line.
const TOKEN = process.env.TOKEN || '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
// Which of the two cards on the page. They share every class, so the choice is
// made by NAME (data-card), not by position: on 2026-09-18 the route card was
// put in front of the other two, and this checker — counting buttons — pressed
// the route card for 'tiers' and the tier card for 'range' until 2026-09-19.
const PANEL = (process.env.PANEL || 'tiers').toLowerCase();
const CARD = ['tiers', 'range', 'route'].includes(PANEL) ? PANEL : 'tiers';
const BTN = `[data-card="${CARD}"] .sc-tierbtn`, OUT = `[data-card="${CARD}"] .tier-out`;
// A fresh query key every run. Cloudflare caches per key, and a stale
// scanner.js is exactly how a fixed page kept reporting the old bug.
const URL = `https://brainonbnb.com/scanner?token=${TOKEN}&probe=${Math.floor(Math.random() * 1e9)}`;

const profile = mkdtempSync(join(tmpdir(), 'tierpanel-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await wait(300);
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || 'eval failed' };
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL });

const problems = [];
const note = [];

// The modal is markup in the document, not drawn by the script, so it is there
// before anything loads and it swallows the click if it is not dismissed.
for (let i = 0; i < 40; i++) {
  await wait(500);
  if (await ev(`!!document.getElementById('wip-ok')`)) break;
}
await ev(`(document.getElementById('wip-ok')||{click(){}}).click()`);

// The scan from ?token= runs on its own. Wait for the card, not for a timer:
// "waited five seconds" is not the same as "the thing arrived", and the
// difference is a check that passes on a slow day and fails on a fast one.
let appeared = false;
for (let i = 0; i < 60; i++) {
  await wait(500);
  if (await ev(`!!document.querySelector('${BTN}')`)) { appeared = true; break; }
}
if (!appeared) problems.push(`the ${PANEL} card never appeared after a scan`);

if (appeared) {
  await ev(`document.querySelector('${BTN}').scrollIntoView({block:'center'})`);
  await wait(300);
  await ev(`document.querySelector('${BTN}').click()`);

  let rendered = false;
  for (let i = 0; i < 90; i++) {
    await wait(500);
    if (await ev(`(() => { const o = document.querySelector('${OUT}'); return !!o && (!!o.querySelector('.tier-t') || !!o.querySelector('.cd-foot') || !!o.querySelector('.tier-ans')); })()`)) { rendered = true; break; }
  }
  if (!rendered) problems.push('the button was pressed and nothing came back within 45 seconds');
}

// SELFTEST=1 (route card): the rendered card is damaged in the browser before it
// is read — the best mark moved to another row, the slippage sentence removed,
// an impossible percentage written in — and the run passes only if every one of
// the three is reported. A checker that cannot fail proves nothing.
const SELFTEST = process.env.SELFTEST === '1' && CARD === 'route';
if (SELFTEST) {
  await ev(`(() => {
    const out = document.querySelector('${OUT}');
    const rows = [...out.querySelectorAll('.rt-r:not(.rt-hr)')];
    const best = rows.find(r => r.classList.contains('tier-best')), other = rows.find(r => !r.classList.contains('tier-best'));
    if (best && other) { best.classList.remove('tier-best'); other.classList.add('tier-best'); const c = other.querySelectorAll('.rt-num')[1]; if (c) c.textContent = '−250.00%'; }
    for (const r of out.querySelectorAll('.tier-ans .vd-r')) if (/Slippage to set/.test(r.textContent)) r.remove();
  })()`);
}

const R = await ev(`(() => {
  const out = document.querySelector('${OUT}');
  if (!out) return { missing: true };
  const rows = [...out.querySelectorAll('.tier-r:not(.tier-hr)')].map(r => ({
    tier: r.querySelector('.tier-n')?.innerText.trim(),
    cap: r.querySelector('.tier-c')?.textContent.trim(),
    work: r.querySelector('.tier-w')?.textContent.trim(),
    vol: r.querySelector('.tier-v')?.textContent.trim(),
    pays: r.querySelector('.tier-f')?.textContent.trim(),
  }));
  // Every figure the panel prints for money, parsed back out of the rendered
  // text rather than out of the JSON. What the reader sees is what is checked.
  const money = (s) => {
    if (!s) return null;
    const m = String(s).replace(/,/g, '').match(/\$\s*([0-9.]+)\s*([KMB])?/i);
    if (!m) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
    return parseFloat(m[1]) * mult;
  };
  const doc = document.documentElement;
  return {
    text: out.innerText,
    rows,
    said: out.querySelector('.tier-ans')?.innerText.trim() || null,
    // Rows where the panel claims more capital is standing at the price than
    // the pool holds in total. That is arithmetically impossible, so finding
    // one means the tick walk degraded into counting something else.
    impossible: rows.filter(r => {
      const c = money(r.cap), w = money(r.work);
      return c != null && w != null && w > c * 1.01;
    }).map(r => r.tier + ': ' + r.work + ' at the price of ' + r.cap + ' held'),
    // Below the header breakpoint every figure has to carry its own label.
    labels: [...out.querySelectorAll('.tier-r:not(.tier-hr) .tl')]
      .filter(e => getComputedStyle(e).display !== 'none').length,
    withWork: rows.filter(r => r.work && r.work !== '—').length,
    // The route card's own table: every pool asked, what arrives, how it compares.
    routes: [...out.querySelectorAll('.rt-r:not(.rt-hr)')].map(r => ({
      route: r.querySelector('.tier-n')?.innerText.trim(),
      cells: [...r.querySelectorAll('.rt-num')].map(e => e.textContent.trim()),
      best: r.classList.contains('tier-best'),
    })),
    sizeAsked: out.parentElement.querySelector('.rt-inp')?.value || null,
    widestRoute: Math.max(0, ...[...out.querySelectorAll('.rt-r')].map(e => e.getBoundingClientRect().right)) - doc.clientWidth,
    overflow: doc.scrollWidth - doc.clientWidth,
    widest: Math.max(0, ...[...out.querySelectorAll('.tier-r')].map(e => e.getBoundingClientRect().right)) - doc.clientWidth,
  };
})()`);

if (R?.__error) problems.push(`the page threw while being read: ${R.__error}`);
else if (R?.missing) problems.push('no .tier-out container on the page');
else if (CARD === 'route') {
  // The route card answers a trader, not a liquidity provider: which pool
  // returns the most at the size named, what comes back sold at once, the tax,
  // and the slippage that takes. Four sentences, then the evidence.
  const text = String(R.text || ''), said = String(R.said || '');
  note.push(`${R.routes.length} route rows; size asked $${R.sizeAsked}`);
  const refused = /Do not trade this as it stands/.test(said), none = /No route could be quoted/.test(said);
  if (!said) problems.push('the button was pressed and the card gives no answer');
  if (!none) {
    const m = said.match(/^(?:Do not trade[^\n]*\n[^\n]*\n)*(.+?) returns the most at \$([0-9,]+)\./m);
    if (!m) problems.push('the answer does not name a route and the size it was quoted at');
    else {
      if (R.sizeAsked && m[2].replace(/,/g, '') !== String(Math.round(Number(R.sizeAsked)))) problems.push(`the answer is for $${m[2]}, the field asks for $${R.sizeAsked}`);
      if (R.routes.length && !R.routes.some((r) => r.route === m[1].trim())) problems.push(`the answer names "${m[1].trim()}", which is not a row of the table`);
      const best = R.routes.filter((r) => r.best);
      if (R.routes.length && (best.length !== 1 || best[0].route !== m[1].trim() || best[0].cells[1] !== 'best')) problems.push('the table does not mark exactly the route the answer names as best');
    }
    if (!/Sold straight back, [0-9.]+% of your /.test(said)) problems.push('the round trip is missing: what comes back if it is sold at once');
    if (!/Transfer tax measured: |The transfer tax could not be measured/.test(said)) problems.push('the card says nothing about the transfer tax — measured or unknown, never silent');
    if (!/Slippage to set: about [0-9.]+%/.test(said) && !refused) problems.push('the slippage to set is missing');
  }
  // "Worse than the best" is how much LESS arrives: never more than all of it.
  for (const r of R.routes) {
    const p = (r.cells[1] || '').match(/^−([0-9.,]+)%$/);
    if (p && Number(p[1].replace(/,/g, '')) > 100) problems.push(`"${r.route}" reads ${r.cells[1]} against the best — more than everything cannot be lost`);
  }
  if (/\bAPR\b|\bAPY\b|per year|annualis/i.test(text)) problems.push('a trading card speaks of a yearly rate');
  for (const w of ['NaN', 'undefined', 'Infinity', '[object']) if (text.includes(w)) problems.push(`"${w}" rendered to the reader`);
  if (R.overflow > 1) problems.push(`the page scrolls sideways by ${R.overflow}px at ${W}px wide`);
  if (R.widestRoute > 1) problems.push(`a route row runs ${Math.round(R.widestRoute)}px past the viewport at ${W}px`);
  if (said) note.push(`says: ${said.split('\n').slice(0, 2).join(' ')}`);
}
else {
  const priced = (R.rows || []).filter((r) => r.pays && r.pays !== '—');
  note.push(`${R.rows.length} tier rows, ${priced.length} carrying a figure`);

  // A card that renders an empty table is worse than one that says why.
  if (!R.rows.length && !/refused|could not be read/i.test(R.text)) {
    problems.push('no tier rows and no explanation of why');
  }
  // The distinction the whole card turns on.
  if (/nothing traded|none traded/i.test(R.text) && /refused/i.test(R.text)) {
    problems.push('the text claims both that nothing traded and that the range was refused — those are different facts');
  }
  if (priced.length >= 2 && !R.said) {
    problems.push('two or more tiers are priced but the card gives no answer above the table');
  }
  // The answer has to name a tier that is actually in the table. A sentence
  // that names nothing reads like an answer and is not one, and a sentence
  // naming a tier the table does not show is worse than either.
  if (R.said && R.rows.length && !R.rows.some((r) => r.tier && R.said.includes(r.tier.split(String.fromCharCode(10))[0]))) {
    problems.push('the answer above the table names no tier from the table');
  }
  // Working capital: present, and never larger than the pool it is part of.
  if (R.rows.length >= 2 && R.withWork < 2) {
    problems.push("the 'at the price' figure is missing from the table — that column is the whole point of the panel");
  }
  for (const bad of R.impossible || []) {
    problems.push('more capital at the price than the pool holds — ' + bad);
  }
  // Below 560px the header row is hidden by design, so each figure must carry
  // its own label. Unlabelled numbers stacked on a phone is how a panel with
  // more information ends up saying less.
  if (W <= 560 && R.rows.length && !R.labels) {
    problems.push('at ' + W + 'px the header is hidden and no figure carries its own label');
  }
  if (W > 560 && R.labels) {
    problems.push('the phone-only labels are showing at ' + W + 'px, where the header already names the columns');
  }
  // Never annualised, and the window always travels with the figures.
  if (R.rows.length && !/minutes of chain/i.test(R.text)) {
    problems.push('the measured window is not stated under the figures');
  }
  // A yearly framing on an hour's sample is the failure. Saying that it is
  // NOT annualised is the fix — and the first version of this check flagged the
  // fix, because it matched the word and not the claim. The disclaimer is
  // removed before the text is tested.
  const claiming = String(R.text).replace(/\b(not|never|nor)\s+annualis|\bnot\s+a\s+rate\b/gi, '');
  if (/\bAPR\b|\bAPY\b|per year|per annum|annualis(ed|e)\b|yearly/i.test(claiming)) {
    problems.push('the card uses a yearly framing for an hour of sample');
  }
  // And the disclaimer has to actually be there.
  if (R.rows.length && !/not annualis/i.test(R.text)) {
    problems.push('the figures are shown without saying they are not annualised');
  }
  for (const w of ['NaN', 'undefined', 'Infinity', '[object']) {
    if (String(R.text).includes(w)) problems.push(`"${w}" rendered to the reader`);
  }
  if (R.overflow > 1) problems.push(`the page scrolls sideways by ${R.overflow}px at ${W}px wide`);
  if (R.widest > 1) problems.push(`a tier row runs ${Math.round(R.widest)}px past the viewport at ${W}px`);
  if (R.said) note.push(`says: ${R.said.trim()}`);
}

console.log(`\n${CARD === 'route' ? 'Route card' : CARD === 'range' ? 'Range replay' : 'Fee-tier panel'} — ${W}x${H}`);
for (const n of note) console.log(`  ${n}`);
if (SELFTEST) {
  const want = [/does not mark exactly the route/, /slippage to set is missing/, /more than everything cannot be lost/];
  const missed = want.filter((re) => !problems.some((p) => re.test(p)));
  for (const p of problems) console.log(`  (damaged on purpose) x ${p}`);
  console.log(missed.length ? `\nSELF-TEST FAILED: ${missed.length} of 3 planted faults went unreported.` : '\nself-test passed: all 3 planted faults were reported.');
  process.exitCode = missed.length ? 1 : 0;
} else if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  x ${p}`);
  console.log(`\n${problems.length} problem(s).`);
  process.exitCode = 1;
} else {
  console.log('\nno problems.');
}

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds the profile briefly */ }
