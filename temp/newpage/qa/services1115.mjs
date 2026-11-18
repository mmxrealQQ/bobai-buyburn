// /services, 2026-11-15: the token box opens the scanner on the address, a page card opens its page while "What it
// shows" still only unfolds, the three connect lines copy, and nothing is wider than the phone (344/390/430/1280).
// usage: node services1115.mjs [base]   (default the live site)
import { spawn } from 'node:child_process';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 300), prof = (process.env.TEMP || process.env.TMPDIR || '/tmp') + '/bobai-prof-' + port;
{ const fs = process.getBuiltinModule('node:fs'), d = process.env.TEMP || process.env.TMPDIR || '/tmp'; try { for (const n of fs.readdirSync(d)) if (n.startsWith('bobai-prof-') && Date.now() - fs.statSync(d + '/' + n).mtimeMs > 36e5) fs.rmSync(d + '/' + n, { recursive: true, force: true }); } catch {} } process.on('exit', () => { try { process.getBuiltinModule('node:fs').rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch {} }); // 2026-11-18: the profile goes with the script (16 GB of them had piled up in qa/)
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
let fails = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? ' — ' + x : '')); if (!c) fails++; };
await send('Page.enable'); await send('Runtime.enable');
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 brainonbnb-qa' });
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(base).origin }).catch(() => {});
const open = async (w, h, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await send('Page.navigate', { url: base + '/services?r=' + Date.now() }); await sleep(4500); };

for (const [w, h, m] of [[344, 882, true], [390, 844, true], [430, 932, true], [1280, 900, false]]) {
  await open(w, h, m);
  const over = await ev('document.documentElement.scrollWidth - innerWidth');
  ok(`${w}px: nothing wider than the screen`, over <= 0, `${over}px over`);
  const r = await ev(`JSON.stringify((()=>{const f=document.querySelector('.sv-check'),i=f&&f.querySelector('input'),b=f&&f.querySelector('button');if(!f)return null;const a=i.getBoundingClientRect(),c=b.getBoundingClientRect();return {iw:Math.round(a.width),bw:Math.round(c.width),top:Math.round(a.top)}})())`);
  const g = JSON.parse(r || 'null');
  ok(`${w}px: the token box is on the first screen and usable`, g && g.top < h * 0.6 && g.iw >= 200 && g.bw >= 90, r);
}

// the box opens the scanner on the address
await open(1280, 900, false);
await ev(`(()=>{const f=document.querySelector('.sv-check');f.querySelector('input').value='0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';f.requestSubmit();return 1})()`);
await sleep(3500);
const href = await ev('location.pathname + location.search');
ok('the box opens /scanner?token=<address>', /^\/scanner\?token=0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82/.test(href), href);

// an empty box does not leave the page
await open(1280, 900, false);
await ev(`(()=>{document.querySelector('.sv-check').requestSubmit();return 1})()`);
await sleep(1200);
ok('an empty box stays on the page', (await ev('location.pathname')) === '/services');

// a page card: a click in its body opens the page; "What it shows" only unfolds
await ev(`(()=>{document.querySelector('#sv-pages .sv-card').scrollIntoView({block:'center'});return 1})()`); await sleep(500);
const cardTarget = await ev(`JSON.stringify((()=>{const c=document.querySelector('#sv-pages .sv-card'),r=c.getBoundingClientRect();return {x:r.left+r.width-14,y:r.top+r.height-8,href:c.querySelector('h3 a').getAttribute('href'),sum:(()=>{const s=c.querySelector('.sv-more summary').getBoundingClientRect();return {x:s.left+8,y:s.top+s.height/2}})()}})())`);
const ct = JSON.parse(cardTarget);
const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
await click(ct.sum.x, ct.sum.y); await sleep(600);
ok('"What it shows" unfolds and stays on the page', (await ev(`document.querySelector('#sv-pages .sv-card .sv-more').open`)) === true && (await ev('location.pathname')) === '/services');
await click(ct.x, ct.y); await sleep(3500);
ok('a click anywhere on a page card opens that page', (await ev('location.pathname')).replace(/\/$/, '') === ct.href.replace(/\/$/, ''), `${await ev('location.pathname')} vs ${ct.href}`);

// the connect lines
await open(1280, 900, false);
const lines = await ev(`JSON.stringify([...document.querySelectorAll('.sv-conn li')].map(l=>[l.querySelector('code').textContent,l.querySelector('.sv-copy').dataset.copy]))`);
const L = JSON.parse(lines || '[]');
ok('three connect lines, each copying what it shows', L.length === 3 && L.every(([a, b]) => a === b), lines);
ok('… the MCP URL, the skill command and the A2A endpoint', L[0]?.[0] === 'https://brainonbnb.com/mcp' && /npx skills add https:\/\/brainonbnb\.com/.test(L[1]?.[0]) && L[2]?.[0] === 'https://agent.brainonbnb.com/a2a');
// headless Chrome refuses the real clipboard: what the button hands to writeText is what counts
const copied = await ev(`(async()=>{let t='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(x)=>{t=x;return Promise.resolve()}}});const b=document.querySelector('.sv-copy');b.click();await new Promise(r=>setTimeout(r,300));return b.textContent+'|'+t})()`);
ok('Copy puts the line on the clipboard and says so', /^Copied\|https:\/\/brainonbnb\.com\/mcp$/.test(copied), copied);
const live = await Promise.all(['https://brainonbnb.com/mcp', 'https://agent.brainonbnb.com/a2a'].map((u) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'brainonbnb-qa' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: u.endsWith('mcp') ? 'tools/list' : 'message/send', params: u.endsWith('mcp') ? {} : { message: { role: 'user', messageId: 'q', parts: [{ kind: 'text', text: 'price of $BOBAI' }] } } }) }).then((r) => r.json()).catch(() => null)));
ok('both addresses answer what the line promises (tools/list; a plain-word price)', (live[0]?.result?.tools?.length || 0) > 10 && /price_usd/.test(JSON.stringify(live[1] || {})));

ch.kill();
console.log(`\nservices1115: ${fails ? fails + ' FAIL' : 'all PASS'}`);
process.exit(fails ? 1 : 0);
