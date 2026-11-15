// /defi, 2026-11-15: the "Ask it" box offered 7309536 as its example, a position that no longer exists. PASS: the example
// is our live position (from the portfolio model), one tap on it shows the look of THAT position, the placeholder names
// no fixed id, and the portfolio renders. usage: node defi1115.mjs [base]
import { spawn } from 'node:child_process';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 90), prof = 'D:/ai/fourmeme/temp/newpage/qa/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; } if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 160)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
let fails = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
await send('Page.enable'); await send('Runtime.enable');
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 brainonbnb-qa' });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/defi?r=${Date.now()}` });
let pf = '';
for (let i = 0; i < 40; i++) { await sleep(500); pf = await ev(`(document.getElementById('portfolio')||{}).innerText||''`); if (/WORTH NOW/i.test(pf)) break; }
ok('the portfolio renders', /WORTH NOW/i.test(pf));
const ph = await ev(`(document.getElementById('lp-yours-in')||{}).placeholder||''`);
ok('the placeholder names no fixed position id', !/\d{5,}/.test(ph), ph);
const live = await fetch('https://agent.brainonbnb.com/lp/portfolio', { headers: { 'user-agent': 'brainonbnb-qa' } }).then((r) => r.json()).then((j) => String(j.pool.position)).catch(() => '');
const btn = JSON.parse(await ev(`JSON.stringify((()=>{const b=document.getElementById('lp-yours-ours');return b?{hidden:b.hidden,id:b.dataset.id||'',t:b.textContent}:null})())`) || 'null');
ok('"Try it on ours" shows our live position', btn && !btn.hidden && btn.id === live && live.length > 3, JSON.stringify(btn) + ' live ' + live);
await ev(`(()=>{document.getElementById('lp-yours-ours').click();return 1})()`);
let out = '';
for (let i = 0; i < 30; i++) { await sleep(500); out = await ev(`(document.getElementById('lp-yours-out')||{}).innerText||''`); if (out.length > 60 && !/reading|looking|…$/i.test(out.trim())) break; }
ok('one tap shows the look of that position, not an error', out.length > 60 && out.includes(live) && !/does not exist|could not|error/i.test(out), out.replace(/\s+/g, ' ').slice(0, 120));
ok('no script error', !errs.length, errs[0] || '');
ch.kill();
console.log(`\ndefi1115: ${fails ? fails + ' FAIL' : 'all PASS'}`);
process.exit(fails ? 1 : 0);
