// THE BRAIN PLAZA'S FOUR CATEGORIES AS TABS (2026-10-24, operator: "Seiten einfach, das Wichtigste"): four tabs, exactly
// one category open, a click switches, a #cat-<id> link opens its tab, the two evidence folds start closed, the page
// stays short (it was 11 474 px desktop / 24 855 px phone). 1440 and 390 px, no script error, nothing wider than the screen.
// usage: node reg1024.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9910 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-reg24-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const state = () => ev(`(()=>{const t=[...document.querySelectorAll('[data-cat-tab]')];return {tabs:t.map(x=>x.getAttribute('data-cat-tab')),sel:t.filter(x=>x.getAttribute('aria-selected')==='true').map(x=>x.getAttribute('data-cat-tab')),open:t.map(x=>document.getElementById('cat-'+x.getAttribute('data-cat-tab'))).filter(b=>b&&!b.hidden).map(b=>b.id)}})()`);
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/registry?r=' + Date.now() }); await sleep(6000);
  const tag = `/registry ${W}px`;
  const s = await state();
  say(s.tabs.length === 4 && s.sel.length === 1 && s.open.length === 1 && s.open[0] === 'cat-' + s.sel[0] && s.sel[0] === s.tabs[0], `${tag}: four tabs, the first selected, exactly its category open (${s.tabs.join(', ')})`);
  const second = s.tabs[1];
  await ev(`document.querySelector('[data-cat-tab="${second}"]').click()`);
  const s2 = await state();
  say(s2.sel[0] === second && s2.open.length === 1 && s2.open[0] === 'cat-' + second, `${tag}: a click on "${second}" opens it alone`);
  const last = s.tabs[3];
  await ev(`location.hash = '#cat-${last}'`); await sleep(600);
  const s3 = await state();
  say(s3.sel[0] === last && s3.open[0] === 'cat-' + last, `${tag}: a #cat-${last} link opens its tab`);
  say(await ev(`(()=>{const a=document.getElementById('rg-log'),b=document.getElementById('rg-move');return (!a||!a.open)&&(!b||!b.open)})()`), `${tag}: the two evidence folds start closed`);
  await ev(`location.hash=''`); await send('Page.navigate', { url: base + '/registry?r=' + Date.now() }); await sleep(6000);
  const hgt = await ev('document.documentElement.scrollHeight'), cap = W < 500 ? 15000 : 7500;
  say(hgt <= cap, `${tag}: the page is ${hgt} px (at most ${cap}; was ${W < 500 ? '24 855' : '11 474'})`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${tag}: nothing wider than the screen`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(600);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
