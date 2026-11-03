// /token, THE LAST SPLIT (2026-11-03): the start shows the last run of the buyback bot slice by slice. FAIL when: the
// board is missing or empty, a slice has no BscScan transaction, the shares do not add up to 3.0%, the header does not
// say when the split ran and that the slices add up exactly, or the page is wider than the screen at 344 to 1440 px.
// usage: node tkproof.mjs [page]   (default https://brainonbnb.com/token)   exit 1 on any FAIL
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const page = process.argv[2] || 'https://brainonbnb.com/token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 400), prof = 'D:/ai/fourmeme/temp/newpage/qa/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.slice(0, 120) || 'error'); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [W, H, mob] of [[344, 882, 1], [390, 844, 1], [768, 1024, 1], [1440, 900, 0]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mob });
  await send('Page.navigate', { url: page + '?r=' + Date.now() }); await sleep(7000);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>{const b=document.getElementById('tk-proof');if(!b)return{missing:1};
    const rows=[...b.querySelectorAll('.hx-row')].map(r=>({k:r.querySelector('.k')?.textContent||'',tx:[...r.querySelectorAll('a.tx')].filter(a=>/^https:\\/\\/bscscan\\.com\\/tx\\/0x[0-9a-f]{64}$/i.test(a.href)).length,share:parseFloat((r.querySelector('.k i')?.textContent||'0'))}));
    return {rows,head:document.getElementById('tk-proof-when').textContent,wide:document.documentElement.scrollWidth>innerWidth+1}})())` });
  const o = JSON.parse(r.result?.result?.value || '{}');
  if (o.missing) { say(false, `${W}px: no last-split board`); continue; }
  say(o.rows.length === 6 && o.rows.every((x) => x.tx >= 1), `${W}px: six slices, each with its BscScan transaction (${o.rows.map((x) => x.tx).join(',')})`);
  const sum = o.rows.reduce((a, x) => a + x.share, 0);
  say(Math.abs(sum - 3) < 0.05, `${W}px: the shares add up to 3% (${sum.toFixed(2)}%)`);
  say(/^Last split \d+ \w{3} \d\d:\d\d UTC · .+ ago · [\d.]+ BNB/.test(o.head) && /add up to it exactly/.test(o.head), `${W}px: header "${o.head.slice(0, 90)}"`);
  say(!o.wide, `${W}px: nothing wider than the screen`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
console.log(fails ? `FAIL  ${fails}` : 'PASS  token: the last split, slice by slice, every slice on chain');
process.exit(fails ? 1 : 0);
