// The cold start: a judge lands on /registry knowing nothing and has to get
// from "what is this" to a real price, in EVERY one of the four categories.
//
// This is the criterion the main track is scored on, in its own words: "land,
// find an agent by category, understand what it does, activate it, with
// minimal friction. Someone with zero Agent Studio knowledge should be able to
// get through it without hitting a dead end." Plus: "All four categories
// surfaced with equal depth. A submission that treats one category as the main
// event and the rest as an afterthought won't score well here."
//
// So this check does not ask whether the page renders. It asks the three
// questions a judge asks, and it asks them per category rather than once:
//
//   can I get to this category from the landing state
//   is there anything here, described well enough to choose between
//   does the first thing I click actually give me a price — and if it cannot,
//   does it tell me why, or does it just sit there
//
// The last one is the whole point. A hire button that fails silently is a dead
// end; a hire button that fails and names the endpoint it tried is a finding
// about somebody else's agent. Those look identical in the HTML.
//
// It stops before spending money. Negotiating a quote costs nobody anything.
//
// Usage:
//   node scripts/dashboard-check/registry-coldstart.mjs
//   node scripts/dashboard-check/registry-coldstart.mjs --self-test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9700) + (process.pid % 90);
const SELFTEST = process.argv.includes('--self-test');
const BASE = process.env.BASE || 'https://brainonbnb.com';
const URL = `${BASE}/registry?probe=${Math.floor(Math.random() * 1e9)}`;

// The four the track names, in the order the track names them. Anything the
// page calls them is its own business; these ids are the contract.
const CATS = [
  { id: 'cat-rebalancing', label: 'Rebalancing' },
  { id: 'cat-grid-trading', label: 'Grid Trading' },
  { id: 'cat-yield-optimization', label: 'Yield Optimisation' },
  { id: 'cat-health-factor', label: 'Health Factor Monitoring' },
];

const profile = mkdtempSync(join(tmpdir(), `coldstart-${process.pid}-`));
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
  throw new Error('chrome did not come up');
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
const until = async (expr, tries = 60) => {
  for (let i = 0; i < tries; i++) { await wait(500); if (await ev(expr) === true) return true; }
  return false;
};
const size = (w, h) => send('Emulation.setDeviceMetricsOverride',
  { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });

const problems = [];
const notes = [];

await send('Page.enable'); await send('Runtime.enable');
await size(1280, 1000);
await send('Page.navigate', { url: URL });
const landed = await until(`document.readyState==='complete' && !!document.querySelector('.rg-chip')`, 60);
if (!landed) { console.log('\n/registry never finished loading — nothing can be judged.'); process.exit(1); }
await wait(1500);

// ── 1. The landing state ───────────────────────────────────────────────────
// Before any of the four exist as sections, they have to exist as a way in.
const chips = await ev(`(()=>[...document.querySelectorAll('.rg-chip')].map(c=>({
  href: c.getAttribute('href'),
  label: (c.querySelector('span')||{}).textContent || '',
  sub: (c.querySelector('em')||{}).textContent || '',
  top: c.getBoundingClientRect().top,
})))()`);

if (chips?.__error) problems.push(`the page threw while its chips were read: ${chips.__error}`);
else {
  notes.push(`landing: ${chips.length} category chips`);
  for (const c of CATS) {
    const chip = (chips || []).find((x) => x.href === '#' + c.id);
    if (!chip) { problems.push(`no way in to ${c.label} from the landing state — no chip points at #${c.id}`); continue; }
    // A chip that says only its name makes a visitor click to find out whether
    // the category is empty. The count is the thing that saves the click.
    if (!/\d/.test(chip.sub)) problems.push(`the ${c.label} chip carries no count, so its depth is invisible until you click`);
  }
}

// ── 2. Depth, per category ────────────────────────────────────────────────
const depth = [];
for (const c of CATS) {
  await ev(`(document.querySelector('a[href="#${c.id}"]')||{click(){}}).click()`);
  await wait(700);
  const d = await ev(`(()=>{
    const box = document.getElementById(${JSON.stringify(c.id)});
    if(!box) return { missing: true };
    const rows = [...box.querySelectorAll('tbody tr')];
    const btns = [...box.querySelectorAll('.rg-hirebtn')];
    return {
      reached: Math.round(box.getBoundingClientRect().top),
      heading: (box.querySelector('h2')||{}).textContent || null,
      explains: !!box.querySelector('.rg-sub'),
      rows: rows.length,
      described: rows.filter(r=>{
        const t=(r.querySelector('.rg-what')||r.querySelector('.rg-caps')||{}).textContent||'';
        return t.trim().length>25;
      }).length,
      hireable: btns.length,
      quoting: box.querySelectorAll('.rg-quotes').length,
      warned: box.querySelectorAll('.rg-weak').length,
      firstBtn: btns.length ? {
        name: btns[0].getAttribute('data-name'),
        cat: btns[0].getAttribute('data-cat'),
        ours: !!btns[0].closest('tr.rg-ours'),
      } : null,
    };
  })()`);
  if (d?.__error) { problems.push(`${c.label}: the page threw while it was read — ${d.__error}`); continue; }
  if (d?.missing) { problems.push(`${c.label}: no section with id ${c.id} — the chip leads nowhere`); continue; }
  depth.push({ ...d, ...c });

  // Clicking the chip has to actually move the reader to the section. An
  // anchor that resolves in the URL but leaves the viewport where it was is a
  // dead end that looks like a working link.
  if (d.reached > 400 || d.reached < -200) {
    problems.push(`${c.label}: clicking its chip left the section ${d.reached}px from the top of the viewport — the jump did not land`);
  }
  if (!d.explains) problems.push(`${c.label}: the section never says what the category is`);
  if (!d.rows) problems.push(`${c.label}: no agents at all — the category is an empty promise`);
  if (!d.hireable) problems.push(`${c.label}: nothing in this category can be hired from the page`);
  if (d.rows && d.described < d.rows) {
    problems.push(`${c.label}: ${d.rows - d.described} of ${d.rows} rows say nothing about what the agent does — you cannot choose between them`);
  }
  // The judged sentence is "activate it". A category where nothing answers is
  // a category a judge cannot complete the journey in.
  if (!d.quoting) problems.push(`${c.label}: not one agent here has ever quoted — the journey cannot be completed in this category`);
}

// Equal depth is a comparison, so it is measured across the four rather than
// inside one. The ratio, not the count, is the thing the track cares about.
if (depth.length === CATS.length) {
  const hire = depth.map((d) => d.hireable);
  const quote = depth.map((d) => d.quoting);
  notes.push('depth per category:');
  for (const d of depth) {
    notes.push(`  ${d.label.padEnd(26)} ${String(d.rows).padStart(2)} rows · ${d.hireable} hire buttons · ${d.quoting} quote · ${d.warned} flagged as silent`);
  }
  const maxH = Math.max(...hire), minH = Math.min(...hire);
  const maxQ = Math.max(...quote), minQ = Math.min(...quote);
  if (minH === 0) problems.push('a category has no hire button at all while another has ' + maxH);
  else if (maxH >= minH * 3) {
    problems.push(`the deepest category offers ${maxH} hire buttons and the thinnest ${minH} — "all four, equally deep" is the stated bar`);
  }
  if (minQ && maxQ >= minQ * 3) {
    problems.push(`quoting agents run from ${minQ} to ${maxQ} across the four categories — the thin ones read as an afterthought`);
  }
  const ours = depth.filter((d) => d.firstBtn?.ours).length;
  if (ours) notes.push(`${ours} of 4 categories lead with our own agent — read that as self-preference before a judge does`);
}

// ── 3. The journey: first click in each category ──────────────────────────
// What a cold visitor does is press the first button they see. Whatever that
// is, it has to end in a price or in a sentence explaining why not.
for (const c of CATS) {
  const d = depth.find((x) => x.id === c.id);
  if (!d?.firstBtn) continue;
  await ev(`(()=>{const b=document.querySelector('#${c.id} .rg-hirebtn'); if(b) b.click();})()`);
  await wait(600);

  const open = await ev(`(()=>{
    const dlg = document.getElementById('rg-hire');
    const t = document.getElementById('rg-hire-task');
    return { open: !!dlg && dlg.open, task: t ? t.value : null, sub: (document.getElementById('rg-hire-sub')||{}).textContent||'' };
  })()`);
  if (!open?.open) { problems.push(`${c.label}: the hire dialog did not open on the first button`); continue; }
  // A seeded task is a promise that the sentence works as written. A seed with
  // a placeholder in it funds a job the seller then declines, and the buyer
  // finds out after paying.
  if (!open.task || open.task.trim().length < 12) {
    problems.push(`${c.label}: the hire dialog opens with an empty task box — a cold visitor has to invent the wording`);
  } else if (/<[A-Z_]+>|0x…|0x\.\.\.|YOUR_|\bTODO\b/.test(open.task)) {
    problems.push(`${c.label}: the suggested task still contains a placeholder (${open.task.match(/<[A-Z_]+>|0x…|0x\.\.\.|YOUR_|TODO/)[0]}) — taken as written it funds a job the seller will decline`);
  }

  await ev(`(document.getElementById('rg-hire-quote')||{click(){}}).click()`);
  const settled = await until(`(()=>{
    const b=document.getElementById('rg-hire-quote');
    const m=document.getElementById('rg-hire-msg');
    const s=document.getElementById('rg-hire-steps');
    return !b.disabled && ((s&&s.children.length>0) || (m&&/rg-err/.test(m.className)));
  })()`, 130);

  const res = await ev(`(()=>{
    const m=document.getElementById('rg-hire-msg'), s=document.getElementById('rg-hire-steps'), r=document.getElementById('rg-hire-raw');
    return {
      msg: (m.textContent||'').trim(),
      err: /rg-err/.test(m.className),
      steps: s.children.length,
      price: (s.querySelector('b')||{}).textContent || null,
      raw: r.hidden ? '' : (r.textContent||'').slice(0, 400),
      spinning: document.getElementById('rg-hire-quote').disabled,
    };
  })()`);

  if (!settled || res?.spinning) {
    problems.push(`${c.label}: "${d.firstBtn.name}" never came back — 65 seconds after pressing Get a quote the button is still spinning. That is the dead end the track names.`);
  } else if (res.steps > 0 && res.price) {
    notes.push(`${c.label}: first click → ${d.firstBtn.name} quoted ${res.price}`);
  } else if (res.err) {
    // Not quoting is allowed — it is a fact about somebody else's agent. Doing
    // it without saying which endpoint was tried is not: it leaves a verdict
    // about a stranger with nothing to check it against.
    const named = /tried:\s*\S+/.test(res.raw) || /https?:\/\/|127\.0\.0\.1/.test(res.msg + res.raw);
    notes.push(`${c.label}: first click → ${d.firstBtn.name} did not quote${named ? ', endpoint named' : ''}`);
    if (!named) problems.push(`${c.label}: "${d.firstBtn.name}" refused without naming the endpoint the broker tried — an unverifiable verdict about somebody else's agent`);
    if (res.msg.length < 25) problems.push(`${c.label}: the refusal says only "${res.msg}" — not enough for a visitor to know what to do next`);
  } else {
    problems.push(`${c.label}: pressing Get a quote produced neither a price nor an error — a silent dead end`);
  }

  await ev(`(document.getElementById('rg-hire-x')||{click(){}}).click()`);
  await wait(300);
}

// ── 4. Friction on a phone ────────────────────────────────────────────────
await size(390, 800);
await wait(700);
await ev(`(document.querySelector('.rg-chip')||{click(){}}).click()`);
await wait(400);
await ev(`(()=>{const b=document.querySelector('#cat-rebalancing .rg-hirebtn'); if(b) b.click();})()`);
await wait(600);
const phone = await ev(`(()=>{
  const doc=document.documentElement, dlg=document.getElementById('rg-hire');
  const r = dlg && dlg.open ? dlg.getBoundingClientRect() : null;
  return {
    overflow: doc.scrollWidth-doc.clientWidth,
    dialogOpen: !!(dlg&&dlg.open),
    dialogFits: !!r && r.left>=-1 && r.right<=doc.clientWidth+1,
    quoteReachable: !!document.getElementById('rg-hire-quote') &&
      document.getElementById('rg-hire-quote').getBoundingClientRect().width>0,
  };
})()`);
if (phone?.__error) problems.push(`the page threw at 390px: ${phone.__error}`);
else {
  if (phone.overflow > 1) problems.push(`/registry scrolls sideways by ${phone.overflow}px at 390px`);
  if (!phone.dialogOpen) problems.push('the hire dialog does not open at 390px');
  else {
    if (!phone.dialogFits) problems.push('the hire dialog runs off the screen at 390px');
    if (!phone.quoteReachable) problems.push('the Get a quote button is not visible at 390px');
  }
  notes.push(`390px: dialog ${phone.dialogOpen ? 'opens' : 'does NOT open'}${phone.dialogOpen && phone.dialogFits ? ' and fits' : ''}`);
}
await ev(`(document.getElementById('rg-hire-x')||{click(){}}).click()`);

// ── Self-test ─────────────────────────────────────────────────────────────
// Each rule pinned both ways: silent on a healthy page, loud on the sabotage.
// A rule that only ever answers "true" proves nothing. Runs last, because the
// setups wreck the page on purpose.
if (SELFTEST) {
  await size(1280, 1000);
  const cases = [
    ['a category whose chip leads nowhere',
      `(()=>{const b=document.getElementById('cat-grid-trading');if(b)b.id='cat-grid-trading';return 1})()`,
      `(()=>{const b=document.getElementById('cat-grid-trading');if(b)b.id='cat-grid-trading-BROKEN';return 1})()`,
      `!document.getElementById('cat-grid-trading')`],
    ['a category with no hire button left in it',
      `(()=>{const b=document.getElementById('cat-yield-optimization');
         [...b.querySelectorAll('.rg-hirebtn-HIDDEN')].forEach(x=>x.className='rg-hirebtn');return 1})()`,
      `(()=>{const b=document.getElementById('cat-yield-optimization');
         [...b.querySelectorAll('.rg-hirebtn')].forEach(x=>x.className='rg-hirebtn-HIDDEN');return 1})()`,
      `document.querySelectorAll('#cat-yield-optimization .rg-hirebtn').length===0`],
    // Both classes, because the rule reads either one: hiding only .rg-what
    // left .rg-caps behind and the sabotage silently did nothing — which is
    // precisely the failure a one-directional self-test never notices.
    ['a row that never says what the agent does',
      `(()=>{const r=document.querySelector('#cat-health-factor tbody tr');
         [...r.querySelectorAll('.rg-what-HIDDEN')].forEach(x=>x.className='rg-what');
         [...r.querySelectorAll('.rg-caps-HIDDEN')].forEach(x=>x.className='rg-caps');return 1})()`,
      `(()=>{const r=document.querySelector('#cat-health-factor tbody tr');
         [...r.querySelectorAll('.rg-what')].forEach(x=>x.className='rg-what-HIDDEN');
         [...r.querySelectorAll('.rg-caps')].forEach(x=>x.className='rg-caps-HIDDEN');return 1})()`,
      `(()=>{const rows=[...document.querySelectorAll('#cat-health-factor tbody tr')];
         return rows.some(r=>{const t=(r.querySelector('.rg-what')||r.querySelector('.rg-caps')||{}).textContent||'';
         return t.trim().length<=25;})})()`],
    ['a task box that opens with a placeholder in it',
      `(()=>{const t=document.getElementById('rg-hire-task');t.value='rebalance holdings for 0x2450';return 1})()`,
      `(()=>{const t=document.getElementById('rg-hire-task');t.value='rebalance holdings for 0x…';return 1})()`,
      `/<[A-Z_]+>|0x…|0x\\.\\.\\.|YOUR_|\\bTODO\\b/.test(document.getElementById('rg-hire-task').value)`],
  ];
  let pinned = 0;
  for (const [what, healthy, sabotage, detect] of cases) {
    await ev(healthy); await wait(150);
    const quiet = await ev(detect) !== true;
    await ev(sabotage); await wait(150);
    const loud = await ev(detect) === true;
    if (!quiet) problems.push(`SELF-TEST: the check reports "${what}" even on a healthy page`);
    if (!loud) problems.push(`SELF-TEST: the check cannot see ${what}`);
    if (quiet && loud) pinned++;
  }
  notes.push(`self-test: ${pinned}/${cases.length} rules pinned in both directions`);
}

console.log('\nRegistry — the cold start, all four categories');
for (const n of notes) console.log(`  ${n}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  x ${p}`);
  console.log(`\n${problems.length} problem(s).`);
  process.exitCode = 1;
} else {
  console.log('\nno problems.');
}

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds the profile briefly */ }
