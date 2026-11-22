// The Agent Wall's layout with sample agents (CDP Fetch stands in for the API): tiles sized by holdings, the floor
// keeps a small holder visible, the free places as a tile, nothing wider than the screen; screenshots. 22.11.
import { spawn } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9600 + Math.floor(Math.random() * 40), prof = process.env.TEMP + '/bobai-prof-' + port;
const ROOT = path.resolve(import.meta.dirname, '../../../dashboard'), OUT = import.meta.dirname;
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/wall') p = '/wall.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(0);
const logo = fs.readFileSync(path.join(ROOT, 'logo-200x200.png'));
const holds = [1200000, 640000, 410000, 250000, 180000, 90000, 52000, 30000, 12000, 8000, 3000, 900, 120, 15];
const wall = holds.map((b, i) => ({ agent: String(1000 + i), name: ['Brain On BNB AI ($BOBAI)', 'Sigma Yield', 'Rebalance Pro', 'Grid Monk', 'Venus Watch', 'Alpha Scout', 'LP Sensei', 'Chain Oracle', 'Fee Hunter', 'Mint Bot', 'Gas Saver', 'Tiny Agent', 'Micro', 'Dust'][i], link: 'https://brainonbnb.com', logo_sha256: 'x', logo_type: 'image/png', logo_url: 'https://agent.brainonbnb.com/wall/logo/' + (1000 + i), signer: '0x' + '1'.repeat(40), role: 'owner', message: 'm', signature: '0x' + 'ab'.repeat(65), owner: '0x' + '1'.repeat(40), wallet: null, bobai: b, valid: true }));
const DATA = JSON.stringify({ at: new Date().toISOString(), block: 135000000, wall, waiting: [], max: 808 });
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = []; const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 160));
  if (d.method === 'Fetch.requestPaused') { const isLogo = /\/wall\/logo\//.test(d.params.request.url); send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: isLogo ? 'image/png' : 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: (isLogo ? logo : Buffer.from(DATA)).toString('base64') }); } };
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: 'https://agent.brainonbnb.com/wall*' }] });
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [w, h, mob] of [[1440, 1000, false], [390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + srv.address().port + '/wall' }); await sleep(4000);
  const r = JSON.parse(await ev(`JSON.stringify({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,tiles:document.querySelectorAll('.tile:not(.free)').length,free:!!document.querySelector('.tile.free'),areas:[...document.querySelectorAll('.tile:not(.free)')].map(t=>Math.round(t.offsetWidth*t.offsetHeight))})`));
  say(r.sw <= r.cw, `${w}px no horizontal scroll`); say(r.tiles === 14 && r.free, `${w}px 14 tiles and the free places`);
  say(r.areas[0] > r.areas[1] && r.areas[1] > r.areas[3] && r.areas.at(-1) > 0, `${w}px the biggest holder has the biggest tile, the smallest is still seen (${r.areas[0]} > ${r.areas[1]} … ${r.areas.at(-1)} px²)`);
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(await ev('document.documentElement.scrollHeight'), 2200), scale: 1 } });
  fs.writeFileSync(path.join(OUT, `WALL-${w}.jpg`), Buffer.from(s.result.data, 'base64'));
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(bad ? `FAIL ${bad}` : 'PASS  the wall lays out'); ws.close(); ch.kill(); srv.close(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
