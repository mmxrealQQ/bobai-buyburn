// WINLINKS (2026-10-24, operator: "die Links im Brain Plaza the job board und the Brain Board gehen immer noch nicht —
// man sollte ja dann ins Popup"): on the front page, Brain Plaza opened in its window; a click on each of its links to
// another page of the site must show that page in the same window (not close it, not leave the page).
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9590 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-wl-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const frameState = `(()=>{const w=document.getElementById('wpage');const f=w&&w.querySelector('iframe');let p=null,t=null,look=null;try{p=f.contentWindow.location.pathname+f.contentWindow.location.search+f.contentWindow.location.hash;t=f.contentDocument.title;look=!!f.contentDocument.querySelector('script[src*="embed.js"]')}catch(e){}return {open:!!w&&w.classList.contains('on')||!!(w&&getComputedStyle(w).display!=='none'&&w.offsetHeight>0),title:w&&w.querySelector('.pg-t')&&w.querySelector('.pg-t').textContent,path:p,doc:t,look}})()`;
const TARGETS = [['/board', 'the Brain Board'], ['/jobs', 'the job board'], ['/board#t', 'a thread'], ['/settle', 'Every settle']];
for (const [href, label] of TARGETS) {
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(9000);
  await ev(`(()=>{const c=document.querySelector('[data-open="page:/registry"]');if(c)c.click()})()`);
  await sleep(9000);
  const before = await ev(frameState);
  const clicked = await ev(`(()=>{const f=document.querySelector('#wpage iframe');const d=f.contentDocument;const a=[...d.querySelectorAll('a[href]')].find(x=>${href === '/board#t' ? "/^\\/board#t\\d+$/.test(x.getAttribute('href'))" : `x.getAttribute('href')===${JSON.stringify(href)}`});if(!a)return null;a.scrollIntoView();a.click();return a.getAttribute('href')})()`);
  await sleep(8000);
  const after = await ev(frameState);
  const want = clicked ? clicked.split('#')[0] : href;
  say(!!before.path && before.path.startsWith('/registry') && !!clicked && after.open && after.path && after.path.startsWith(want) && after.look === true && after.path.includes('embed=1'), `Brain Plaza window -> ${label} (${clicked}): the window shows ${after.path} titled "${after.title}"${after.look ? ' in the window look' : ''}`);
}
// inside the Brain Board's window, the link to brainonbnb.com/join opens its own tab and the window stays
{
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(9000);
  await ev("(()=>{const c=document.querySelector('[data-open=\"page:/board\"]');if(c)c.click()})()"); await sleep(9000);
  const r = await ev("(()=>{const f=document.querySelector('#wpage iframe');const a=[...f.contentDocument.querySelectorAll('a[href]')].find(x=>(x.getAttribute('href')||'').endsWith('/join'));if(!a)return null;a.addEventListener('click',e=>{window.__jt=a.target;e.preventDefault()});a.click();return [a.target,f.contentWindow.location.pathname]})()");
  await sleep(1500);
  const st = await ev(frameState);
  say(!!r && r[0] === '_blank' && st.path && st.path.startsWith('/board'), 'Brain Board window -> brainonbnb.com/join: its own tab, the window stays on ' + (st.path || '?'));
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(500);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
