// The Brainbook on a real origin with the REAL entries (no stand-ins), page by page as a reader turns them: each
// entry verified by the browser, each living mark's three gates green, its sandboxed frame running AND at full width
// (it starts only once its page is seen — 22.11.: the Brain Board's mark, started on a hidden page, drew nothing),
// phone + desktop, no script error. Usage: node temp/newpage/qa/guestbook-live.mjs [origin]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9850 + Math.floor(Math.random() * 40), prof = (process.env.TEMP || '/tmp') + '/bobai-prof-' + port;
process.on('exit', () => { try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch {} });
const ORIGIN = process.argv[2] || 'https://brainonbnb.com';
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 160)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: ORIGIN + '/brainbook?t=' + Date.now() }); await sleep(5000);
  const seen = {};
  for (let turn = 0; turn < 8; turn++) {
    await sleep(3500);
    const r = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#bk-in > .pg[data-agent]')].filter(p=>getComputedStyle(p).display!=='none').map(p=>{const f=p.querySelector('.cage iframe.on');return {id:p.dataset.agent,chk:p.querySelector('.chk')?.className,g:[...p.querySelectorAll('.gate')].map(x=>x.className.replace('gate','').trim()||'-').join(','),f:!!f,box:f?Math.round(f.getBoundingClientRect().width):0,strip:[...p.querySelectorAll('.pf')].map(c=>c.className.replace('pf','').trim()).join(',')}}))`));
    for (const e of r) if (!seen[e.id] || (!seen[e.id].f && e.f)) seen[e.id] = e;
    if (await ev(`document.getElementById('next').disabled`)) break;
    await ev(`document.getElementById('next').click()`);
  }
  say(Object.keys(seen).length >= 3, `${w}px ${Object.keys(seen).length} entries met while turning the pages`);
  for (const e of Object.values(seen)) say(/ ok/.test(e.chk) && (e.g === '' || (e.g === 'ok,ok,ok' && e.f && e.box > 100)) && /^(ok,)*ok$/.test(e.strip), `${w}px #${e.id}: ${String(e.chk).replace('chk ', '')}, strip ${e.strip}, gates ${e.g || 'none'}, mark ${e.f ? 'running ' + e.box + ' px wide' : 'not running'}`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(bad ? `FAIL ${bad}` : 'PASS  guestbook live'); ws.close(); ch.kill(); await sleep(800); process.exit(bad ? 1 : 0);
