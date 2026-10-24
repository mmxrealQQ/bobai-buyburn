// /services, the developer tools in one line each (2026-10-24, operator: "Seiten einfach, das Wichtigste"): every tool
// card shows its name and one sentence, its whole description and the call are in a closed fold that opens on a click;
// the page stays short (it was 7 974 px desktop / 14 341 px phone); no sentence cut on a colon. 1440 and 390 px.
// usage: node svc1024.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9940 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-svc24-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/services?r=' + Date.now() }); await sleep(5000);
  const tag = `/services ${W}px`;
  const s = await ev(`(()=>{const li=[...document.querySelectorAll('.sv-caps li')];const d=[...document.querySelectorAll('.sv-caps .sv-capd')];return {n:li.length,folds:d.length,closed:d.filter(x=>!x.open).length,shorts:[...document.querySelectorAll('.sv-short')].map(x=>x.textContent)}})()`);
  say(s.n >= 15 && s.folds >= 15 && s.closed === s.folds, `${tag}: ${s.n} tools, ${s.folds} folds, all closed`);
  say(s.shorts.every((t) => !/[:;]$/.test(t.trim())), `${tag}: no one-line summary ends on a colon or semicolon`);
  await ev(`document.querySelector('.sv-caps .sv-capd summary').click()`);
  say(await ev(`(()=>{const d=document.querySelector('.sv-caps .sv-capd');return d.open && d.querySelector('code,.sv-limit') && d.querySelector('code,.sv-limit').offsetHeight>0})()`), `${tag}: a click opens a tool's description and its call`);
  await send('Page.navigate', { url: base + '/services?r=' + Date.now() }); await sleep(5000);
  const hgt = await ev('document.documentElement.scrollHeight'), cap = W < 500 ? 13000 : 7000;
  say(hgt <= cap, `${tag}: the page is ${hgt} px (at most ${cap}; was ${W < 500 ? '14 341' : '7 974'})`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${tag}: nothing wider than the screen`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(600);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
