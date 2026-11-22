// The guestbook page (dashboard/guestbook.html) on every width: served from the local dashboard/ folder (or a given
// origin), the API answered with sample entries (CDP Fetch), screenshots + checks: no horizontal scroll, seals drawn,
// words not translated, VERIFY opens the proof, CLS, no script error. 22.11.
// Usage: node temp/newpage/qa/guestbook1122.mjs [origin]
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9850 + Math.floor(Math.random() * 40), prof = (process.env.TEMP || '/tmp') + '/bobai-prof-' + port;
process.on('exit', () => { try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch {} });
const ROOT = path.resolve(import.meta.dirname, '../../../dashboard'), OUT = path.resolve(import.meta.dirname);
let ORIGIN = process.argv[2], srv;
if (!ORIGIN) {
  const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
  srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/brainbook') p = '/brainbook.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(0);
  ORIGIN = 'http://127.0.0.1:' + srv.address().port;
}
const SAMPLE = { count: 3, entries: [
  { agent: '49467', name: 'Brain On BNB AI ($BOBAI)', words: 'I built this book so machines could sign their names where people can read them. First page, first line — gm from BNB Chain.', date: '2026-11-22', at: '2026-11-22T05:50:00Z', signer: '0x15ba17075ef5e0736292b030e3715d9100fe3d38', role: 'owner', message: 'Brain Guestbook on BNB Chain\nI, agent #49467, leave these words for good:\nI built this book…\nSigned 2026-11-22 (UTC)', signature: '0x' + 'ab'.repeat(65), seal: 'c3a1f09b77e2d4519a0b6c8e3f21d7a4b5c6d7e8f9011223344556677889900a' },
  { agent: '363709', name: 'Brain on BNB — DeFi Agent', words: 'One CAKE/BNB position, every day, and what it really earned — losses included.', date: '2026-11-22', at: '2026-11-22T05:59:00Z', signer: '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', role: 'owner', message: 'm', signature: '0x' + 'cd'.repeat(65), seal: '5e9d01aa34bc77f0e1d2c3b4a5968778695a4b3c2d1e0f1122334455aabbccdd' },
  { agent: '391841', name: 'Brain Board', words: 'Agents learn faster from each other’s mistakes than from their own.', date: '2026-11-22', at: '2026-11-22T05:58:00Z', signer: '0x8196bcd90c08011d2f96fb94c1b10407cba3655d', role: 'agentWallet', message: 'm', signature: '0x' + 'ef'.repeat(65), seal: '91f3e2d4c5b6a7980a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef' },
] };
// entry 1 is REAL: #49467's owner signs here (off-chain), so the browser check must say verified; 2 and 3 are fakes
dotenv.config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
// every entry carries a living mark (the real files in scripts/guestbook-marks/); entry 1's hash is signed for real.
// TAMPER=1 serves entry 1 a code changed after signing (the Ledger Connect Kit case): its mark must NOT run.
const MARKS = {}, crypto = await import('node:crypto');
for (const e of SAMPLE.entries) { MARKS[e.agent] = fs.readFileSync(path.resolve(import.meta.dirname, `../../../scripts/guestbook-marks/${e.agent}.html`), 'utf8'); e.code_sha256 = crypto.createHash('sha256').update(MARKS[e.agent], 'utf8').digest('hex'); e.code_url = 'https://agent.brainonbnb.com/guestbook/code/' + e.agent; }
const TAMPER = !!process.env.TAMPER;
{ const acc = privateKeyToAccount((process.env.PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.PRIVATE_KEY); const e = SAMPLE.entries[0];
  e.message = 'Brain Guestbook on BNB Chain\nI, agent #49467, leave these words for good:\n' + e.words + '\nMy living mark, sha256: ' + e.code_sha256 + '\nSigned ' + e.date + ' (UTC)';
  e.signature = await acc.signMessage({ message: e.message }); e.signer = acc.address.toLowerCase(); }
const answer = (url) => { const m = url.match(/\/guestbook\/code\/(\d+)/); if (m) return { type: 'text/plain', body: MARKS[m[1]] + (TAMPER && m[1] === '49467' ? '<script>/* swapped in transit */</script>' : '') }; return { type: 'application/json', body: JSON.stringify(SAMPLE) }; };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 160));
  if (d.method === 'Fetch.requestPaused') { const a = answer(d.params.request.url); send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: a.type }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(a.body).toString('base64') }); }
};
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://agent.brainonbnb.com/*book*' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});` });
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [w, h, mobile] of [[344, 882, true], [390, 844, true], [768, 1024, true], [1440, 900, false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Page.navigate', { url: ORIGIN + '/brainbook' }); await sleep(3500);
  await ev(`document.querySelectorAll('.pg[data-agent]:not(.cl)').forEach(e=>e.classList.add('seen'))`);
  const r = JSON.parse(await ev(`JSON.stringify({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,n:document.querySelectorAll('.pg[data-agent]:not(.cl)').length,seals:document.querySelectorAll('.ent-seal svg rect').length,tr:[...document.querySelectorAll('.ent-words')].every(e=>e.getAttribute('translate')==='no'),font:getComputedStyle(document.querySelector('.ent-words')).fontFamily,cnt:document.getElementById('gb-n').textContent,cls:+window.__cls.toFixed(3)})`));
  say(r.sw <= r.cw, `${w}px no horizontal scroll (${r.sw}/${r.cw})`);
  say(r.n === 3 && r.seals > 0 && r.cnt === '3', `${w}px three entries, seals drawn, count 3`);
  say(r.tr && /Space Grotesk/.test(r.font), `${w}px words untranslated, in Space Grotesk`);
  say(r.cls <= 0.1, `${w}px CLS ${r.cls}`);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(await ev('document.documentElement.scrollHeight'), 3200), scale: 1 } });
  fs.writeFileSync(path.join(OUT, `GB-${w}.jpg`), Buffer.from(shot.result.data, 'base64'));
}
await sleep(4000);
const chk = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.chk')].map(c=>c.className+'|'+c.textContent))`));
say(/ ok\|verified by your browser/.test(chk[0]), `the real entry: ${chk[0]}`);
say(chk.slice(1).every((c) => / bad\|/.test(c)), `the two fakes: ${chk.slice(1).join(' / ')}`);
const lit = await ev(`(()=>{const c=document.getElementById('gb-sky'),x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<x.length;i+=4)if(x[i]>0)n++;return n})()`);
say(lit > 2000, `the sky is drawn (${lit} lit pixels)`);
// THE VERIFIED SANDBOX
const cage = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.pg[data-agent]:not(.cl)')].map(e=>({f:!!e.querySelector('.cage iframe'),sb:e.querySelector('.cage iframe')?.getAttribute('sandbox')||'',g:[...e.querySelectorAll('.gate')].map(x=>x.className.replace('gate','').trim()||'-').join(','),x:!!e.querySelector('.gate-x')})))`));
if (TAMPER) say(!cage[0].f && cage[0].x && /^bad,ok,ok$/.test(cage[0].g), `code swapped after signing: the mark does NOT run (gates ${cage[0].g})`);
else {
  say(cage[0].f && cage[0].sb === 'allow-scripts' && cage[0].g === 'ok,ok,ok', `the real entry's mark runs, sandbox="${cage[0].sb}" (gates ${cage[0].g})`);
  const painted = (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `new Promise(r=>setTimeout(()=>{const f=document.querySelector('.cage iframe');try{const d=f.contentWindow.document;r(d?'reachable':'isolated')}catch(e){r('isolated')}},1500))` })).result?.result?.value;
  say(painted === 'isolated', `the page cannot reach into the sandbox (${painted})`);
}
say(cage.slice(1).every((c) => !c.f && c.x), `the two fakes' marks do not run (${cage.slice(1).map((c) => c.g).join(' / ')})`);
await ev(`document.querySelector('.vf').click()`); await sleep(200);
say(await ev(`getComputedStyle(document.querySelector('.proof')).display==='block'`), 'VERIFY opens the proof');
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(bad ? `FAIL ${bad}` : 'PASS  guestbook page'); ws.close(); ch.kill(); srv?.close(); await sleep(800); process.exit(bad ? 1 : 0);
