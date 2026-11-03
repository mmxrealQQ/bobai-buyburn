// Scanner (2026-10-12): no wall on a first visit (a line above the field instead, with its link to the note); a scan
// 2026-11-03: the line moved from .sc-wip above the box into the shared start line (.hx-trust) under it.
// ends with "Share this check" whose link is brainonbnb.com/scanner?token=<the token>, and its button copies.
import { spawn } from 'node:child_process';
const page = process.argv[2] || 'https://brainonbnb.com/scanner';
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9550 + Math.floor(Math.random() * 40), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = []; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 140)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [W, H, mob] of [[1440, 900, 0], [390, 844, 1]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mob });
  await send('Page.navigate', { url: page + '?r=' + Date.now() }); await sleep(5000);
  const a = JSON.parse(await ev(`JSON.stringify({modal:!!document.querySelector('#wip-modal:not([hidden])'),line:document.querySelector('.hx-trust>span:nth-child(2)')?.textContent||'',href:document.querySelector('.hx-trust>span:nth-child(2) a')?.getAttribute('href'),target:!!document.getElementById('sc-note')})`));
  say(!a.modal && /Still being built/.test(a.line) && a.href === '#sc-note' && a.target, `${W}: first visit — no wall; the line: "${a.line.slice(0, 70)}…" -> ${a.href}`);
  await ev(`(()=>{const i=document.getElementById('sc-in');i.value='${CAKE}';i.dispatchEvent(new Event('input'));document.getElementById('sc-go').click();return 1})()`);
  let s = null; for (let k = 0; k < 60 && !s; k++) { await sleep(1000); s = await ev(`document.querySelector('#sc-out .sc-share code')?.textContent||null`); }
  say(s === 'brainonbnb.com/scanner?token=' + CAKE, `${W}: after a CAKE scan the share bar reads "${s}"`);
  if (s) { const pt = JSON.parse(await ev(`(()=>{const b=document.querySelector('.sc-share button');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2])})()`)); await sleep(300);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: pt[0], y: pt[1], button: 'left', clickCount: 1 }); await sleep(400);
    const t = await ev(`document.querySelector('.sc-share button').textContent`); say(t === 'Copied ✓', `${W}: Copy link says "${t}"`);
    const fit = await ev(`document.documentElement.scrollWidth<=innerWidth+1`); say(fit, `${W}: nothing runs sideways`); }
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(fails ? `FAIL  ${fails}` : 'PASS  scanner: a line not a wall, and a scan to share');
ws.close(); ch.kill(); await sleep(800); try { (await import('node:fs')).rmSync(prof, { recursive: true, force: true }); } catch {}
