// /scanner in a real browser, 2026-11-15: Pocket (the first log host since 2.11.) was missing from the CSP, so every
// browser scan lost its trades and its measured tax, the four.meme feed stayed empty, and the short answer said the tax
// "could not be established" while the tax section showed 0.00%. PASS: no connection refused by the CSP; CAKE's swaps are
// counted; the tax line of the short answer is an answer; the four.meme feed lists tokens.
// usage: node scanner1115.mjs [base]
import { spawn } from 'node:child_process';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 150), prof = (process.env.TEMP || process.env.TMPDIR || '/tmp') + '/bobai-prof-' + port;
{ const fs = process.getBuiltinModule('node:fs'), d = process.env.TEMP || process.env.TMPDIR || '/tmp'; try { for (const n of fs.readdirSync(d)) if (n.startsWith('bobai-prof-') && Date.now() - fs.statSync(d + '/' + n).mtimeMs > 36e5) fs.rmSync(d + '/' + n, { recursive: true, force: true }); } catch {} } process.on('exit', () => { try { process.getBuiltinModule('node:fs').rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch {} }); // 2026-11-18: the profile goes with the script (16 GB of them had piled up in qa/)
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; const csp = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
  const txt = d.method === 'Log.entryAdded' ? d.params.entry.text : d.method === 'Runtime.consoleAPICalled' ? (d.params.args || []).map((a) => a.value).join(' ') : d.method === 'Runtime.exceptionThrown' ? d.params.exceptionDetails?.exception?.description : '';
  if (txt && /Content Security Policy|Refused to connect/i.test(txt)) csp.push(String(txt).slice(0, 160));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
let fails = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 brainonbnb-qa' });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${base}/scanner?token=${CAKE}&r=${Date.now()}` });
let out = '';
for (let i = 0; i < 120; i++) { await sleep(500); out = await ev(`(document.getElementById('sc-out')||{}).innerText||''`); if (/Swaps/.test(out) && /Can you sell it/.test(out) && i > 20) break; }
await sleep(4000); out = await ev(`(document.getElementById('sc-out')||{}).innerText||''`);
const swaps = (out.match(/([\d,]+)\s*\n\s*Swaps/) || [])[1];
ok('CAKE: the swaps of the last hour are counted', !!swaps && !/log node did not answer/.test(out), swaps ? swaps + ' swaps' : 'the log node did not answer');
const shortTax = (out.match(/^(No transfer tax[^\n]*|This token takes[^\n]*|Whether it takes a transfer tax[^\n]*)$/m) || [])[1] || '';
ok('the short answer says what the tax is', !!shortTax && !/could not be established/i.test(shortTax), shortTax.slice(0, 90));
const taxSrc = /No executed trade to read/i.test(out) ? 'simulated' : /measured|executed/i.test(out) ? 'measured' : '?';
ok('the tax comes from trades that executed (or the simulation says why not)', taxSrc !== '?', taxSrc);
// the four.meme feed
await ev(`(()=>{const b=document.getElementById('sc-feed-go');if(b)b.click();return !!b})()`);
let feed = '';
for (let i = 0; i < 40; i++) { await sleep(500); feed = await ev(`(document.getElementById('sc-feed-body')||{}).innerText||''`); if (feed.length > 120 && !/reading|loading|…$/i.test(feed.trim())) break; }
ok('the four.meme feed lists what traded on the curve (or says it was quiet)', feed.length > 60 && !/could not|failed|did not answer/i.test(feed), feed.replace(/\s+/g, ' ').slice(0, 110));
ok('no connection refused by the page\'s CSP', !csp.length, csp[0] || '');
ch.kill();
console.log(`\nscanner1115: ${fails ? fails + ' FAIL' : 'all PASS'}`);
process.exit(fails ? 1 : 0);
