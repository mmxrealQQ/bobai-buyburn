// EVERY TOKEN AMOUNT WITH ITS DOLLARS (2026-10-10, operator: "when he talks about $BOBAI, $BNB, $BOB, give the USD
// value — in the windows too; we had that once, now I do not see it any more"). Reads what a visitor reads: the typed
// answers in the brain.log, what each circle says, every circle's board, the bot runs played again (boards, log lines,
// lines), the brain.log as it stands, and the seven home windows. Any "<number> BOBAI / BNB / BOB" without a "$" figure
// close to it (the same line or table row, 40 characters after or 30 before) is a FAIL.
// usage: node usd.mjs [url]   (default: the golive preview) — exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const url = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/') + (process.argv[2]?.includes('?') ? '&' : '?') + 'r=' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 120000 })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 60; i++) { await sleep(1000); if (await ev(`!!(window.__btCircles && window.__btPx && __btPx()[0] > 0 && document.querySelectorAll('#bt .ln').length > 3)`)) break; }
await sleep(12000); // the bot log, the DeFi record and the chart are in by now
const texts = []; // [where, line]
// the figure under a board's day bars ("TODAY 115.2K"): it had no unit, so AMT never saw it (2026-10-11, operator) — it must carry a $
const todays = [];
// a log line starts "18:41:55 BOBAI …": the time and the tag are not an amount
const add = (where, arr) => { for (const t of arr || []) if (t && String(t).trim()) texts.push([where, String(t).replace(/\s+/g, ' ').trim().replace(/^\d\d:\d\d(:\d\d)? [A-Za-z0-9]+ /, '')]); };
// 1 the typed answers (they land in the brain.log as BRAIN lines)
const QS = ['burns', 'next', 'liq', 'defi', 'giggle', 'price', 'bots', 'tax', 'today', 'holders', 'nft', 'why', 'what did i miss'];
for (const q of QS) {
  const got = await ev(`(async()=>{const n0=document.querySelectorAll('#bt .ln').length,i=document.getElementById('bt-cmdIn');i.value=${JSON.stringify(q)};
    document.getElementById('bt-cmd').requestSubmit();await new Promise(r=>setTimeout(r,1800));
    return [...document.querySelectorAll('#bt .ln')].slice(n0).map(l=>l.innerText)})()`);
  add('ask "' + q + '"', got);
}
// 2 what each circle says
add('circle line', Object.entries(await ev(`window.__btCircles()`) || {}).map(([k, v]) => v && `[${k}] ${v}`));
// 3 every circle's board
for (const k of ['burnA', 'burnB', 'liq', 'defi', 'giggle', 'creator', 'core', 'buyback', 'dev', 'lp', 'nft']) {
  const b = await ev(`(async()=>{try{__btTestDetail.focus(${JSON.stringify(k)})}catch(e){return []}await new Promise(r=>setTimeout(r,900));const d=document.querySelector('#bt .detail');
    if(!d)return [];const rows=[...d.querySelectorAll('tr,li,.row,.r')];return (rows.length?rows.map(r=>r.innerText):[]).concat(d.innerText.split('\\n'),[...d.querySelectorAll('.db-x b')].map(e=>'@@TODAY '+e.innerText))})()`);
  for (const t of b || []) if (/^@@TODAY /.test(t)) todays.push(k + ': ' + t.slice(8));
  add('board ' + k, (b || []).filter((t) => !/^@@TODAY /.test(t)));
}
await ev(`try{__btTestDetail.focus(null)}catch(e){}`);
// 4 the bot runs played again: the moment board, the log lines and his line
for (const k of ['run', 'liq', 'devliq', 'dev', 'defi:collect', 'defi:increase', 'defi:rebalance', 'defi:sweep']) {
  const got = await ev(`(async()=>{const n0=document.querySelectorAll('#bt .ln').length;if(!window.__btTestEv(${JSON.stringify(k)}))return null;const seen=new Set();
    for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,500));for(const s of document.querySelectorAll('#bt .say.on, #bt .moment, #bt .scn, #bt .flt'))for(const l of s.innerText.split('\\n'))seen.add(l);}
    return [...seen,...[...document.querySelectorAll('#bt .ln')].slice(n0).map(l=>l.innerText)]})()`);
  if (got) add('event ' + k, got);
}
// 5 the circle labels in the scene
add('label', await ev(`[...document.querySelectorAll('#bt .lab')].map(l=>l.innerText.replace(/\\n/g,' · '))`));
// 6 the whole brain.log as it stands
add('brain.log', await ev(`[...document.querySelectorAll('#bt .ln')].map(l=>l.innerText)`));
// 7 the seven home windows (opened one by one, so their figures are filled)
for (const w of ['w01', 'w02', 'w03', 'w04', 'w06', 'w07', 'w08']) {
  const got = await ev(`(async()=>{document.querySelector('[data-open="${w}"]')?.click();await new Promise(r=>setTimeout(r,2500));const x=document.getElementById('${w}');
    const rows=[...x.querySelectorAll('tr, .cx01-r')].map(r=>r.innerText.replace(/\\t|\\n/g,' · ')); // .cx01-r (25.10.): the calculator's rows are divs, the dollars in their own column — read as one row like a tr
    // [data-nousd]: a figure whose dollars stand in the element after it (the World Cup pool and its "$… at today's price")
    const own=[...x.querySelectorAll('[data-nousd]')],ownT=new Set(own.map(e=>e.innerText.trim())),pairs=own.map(e=>e.innerText+' '+(e.nextElementSibling?.innerText||''));
    const rowT=new Set([...x.querySelectorAll('.cx01-r')].flatMap(r=>r.innerText.split('\\n').map(l=>l.trim()))); // read as rows above
    const plain=x.innerText.split('\\n').filter(l=>!ownT.has(l.trim())&&!rowT.has(l.trim()));
    document.querySelector('#${w} .bw-x')?.click();await new Promise(r=>setTimeout(r,400));return rows.concat(pairs,plain)})()`);
  add('window ' + w, got);
}
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
// a token amount: "61.3K BOBAI", "0.0123 BNB", "1,204 $BOB" — not "CAKE/BNB 0.05%", not "swaps to BNB at 400K"
const AMT = /(?<![\w.$≈])(\d[\d,]*(?:\.\d+)?\s?[KMBT]?)\s*(\$?BOBAI|BNB|\$?BOB)(?![\w])/g;
const SAMPLE = /\ba 1 BNB buy\b/; // a worked example of price impact, not an amount anyone holds
// the bubble is read while it types: a line that is only the start of another one read later is not a line of its own
const all = texts.map((x) => x[1]);
for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i][1]; if (all.some((o) => o !== t && o.startsWith(t))) texts.splice(i, 1); }
const bad = [], seen = new Set();
let amounts = 0;
for (const [where, t] of texts) {
  if (SAMPLE.test(t) && !t.replace(SAMPLE, '').match(AMT)) continue;
  for (const m of t.matchAll(AMT)) {
    // a date's year is no amount: "until Jun 4, 2026 $BOB Liq Boost" (2026-10-12)
    if (/^(19|20)\d\d$/.test(m[1].trim()) && /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(, \d\d:\d\d UTC)?,? $/.test(t.slice(Math.max(0, m.index - 24), m.index))) continue;
    amounts++;
    const near = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40);
    if (/\$\s?\d/.test(near.replace(m[0], ''))) continue;
    const k = where.replace(/ ".*/, '') + '|' + t.slice(0, 90);
    if (seen.has(k)) continue; seen.add(k);
    bad.push(`${where}: …${t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 30)}…`);
  }
}
for (const b of bad) console.log('  no $: ' + b);
const todayBad = todays.filter((t) => !/\$/.test(t));
console.log(`${todayBad.length ? 'FAIL' : 'PASS'}  every board's TODAY figure carries its $ — ${todays.length} figures${todayBad.length ? ': ' + todayBad.join(' | ') : ''}`);
console.log(`${texts.length > 50 && amounts > 20 ? '' : 'FAIL  too little read (' + texts.length + ' texts, ' + amounts + ' amounts) — the page did not load?\n'}${bad.length ? 'FAIL' : 'PASS'}  every BOBAI / BNB / BOB amount carries its $ — ${amounts} amounts in ${texts.length} texts, ${bad.length} without`);
process.exit(bad.length || todayBad.length || texts.length <= 50 || amounts <= 20 ? 1 : 0);
