// THE LOOP LINE TELLS THE WHOLE RESULT (2026-10-27, operator: "ist das aktuell? also alles was beim Start dort steht" —
// the line said "earned 0.113 BNB in pool fees" while the agent stood at -6.6% on its capital). Opens the terminal, reads
// the LOOP line and holds it against /lp/portfolio: the change on the capital is there with its sign, and when the price
// cost more than the fees brought, the line says so.
// usage: node loop1027.mjs [url]   exit 1 on any FAIL
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const base = process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 400), prof = 'D:/ai/fourmeme/temp/newpage/qa/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '?r=' + Date.now() });
const JS = `(async()=>{const t0=performance.now();let rows=[];while(performance.now()-t0<90000){await new Promise(r=>setTimeout(r,1000));
rows=[...document.querySelectorAll('#bt .ln')].map(l=>[l.querySelector('.t')?.textContent||'',l.querySelector('.g')?.textContent||'',l.querySelector('.m')?.textContent||'']);
if(rows.some(r=>r[1]==='AGENT')&&rows.some(r=>r[1]==='LOOP'))break;} return JSON.stringify(rows)})()`;
const r = await send('Runtime.evaluate', { expression: JS, awaitPromise: true, returnByValue: true, timeout: 120000 });
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
const rows = JSON.parse(r.result?.result?.value || '[]');
const res = [], ok = (n, p, d) => { res.push(p); console.log((p ? 'PASS ' : 'FAIL ') + n + ' — ' + d); };
const lp = rows.find((x) => x[1] === 'LOOP');
const pf = await fetch('https://agent.brainonbnb.com/lp/portfolio', { headers: { 'user-agent': 'brainonbnb-test' } }).then((x) => x.json());
const pct = Number(pf.pnl.change_pct), want = `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
if (!lp) { ok('a LOOP line at the visit', false, 'none within 90 s'); process.exit(1); }
console.log('LOOP: ' + lp[2]);
ok('the LOOP line names the change on the capital, with its sign', lp[2].includes(want + ' on its capital in all'), `want "${want} on its capital in all"`);
const priceWins = pf.pnl.from_price_bnb < 0 && -pf.pnl.from_price_bnb > pf.pnl.from_fees_bnb;
ok('it says the price cost more than the fees exactly when the portfolio says so', /price cost more than the fees brought/.test(lp[2]) === priceWins, `price ${pf.pnl.from_price_bnb} vs fees ${pf.pnl.from_fees_bnb}`);
process.exit(res.every(Boolean) ? 0 : 1);
