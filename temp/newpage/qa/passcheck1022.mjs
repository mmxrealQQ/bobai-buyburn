// CHECK ANY WALLET ON /pass (2026-10-22): an address field, no connect, read-only. Typed in: the top holder -> "#1 of N
// holders" and "Holder pass: yes"; a wallet under 1M -> its distance to the pass with dollars and the buy link; the pool
// -> "a contract"; a typo -> "not a wallet address". Figures equal agent.brainonbnb.com/holders. 1440 and 390 px,
// nothing wider than the screen.
// usage: node passcheck1022.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 40), prof = os.tmpdir() + '/prof-passchk-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const H = await (await fetch('https://agent.brainonbnb.com/holders')).json();
const top = H.top[0].address, small = '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', pair = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const check = async (a) => ev(`(async()=>{const i=document.getElementById('hp-chk-in');if(!i)return 'NO FIELD';i.value=${JSON.stringify(a)};document.getElementById('hp-chk').requestSubmit();
  for(let k=0;k<60;k++){await new Promise(r=>setTimeout(r,250));const t=document.getElementById('hp-chk-out').innerText;if(t&&!/Reading the chain/.test(t))return t}return 'TIMEOUT'})()`);
for (const [W, Hh] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: Hh, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/pass?r=' + Date.now() }); await sleep(6000);
  const tag = `/pass ${W}px`;
  const t1 = await check(top);
  say(t1.includes(`#1 of ${Number(H.holders).toLocaleString('en-US')} holders`) && /Holder pass: yes/.test(t1) && /\$BOBAI \(≈\$/.test(t1), `${tag}: the top holder -> #1 of ${H.holders}, pass yes, with dollars — "${t1.slice(0, 120)}"`);
  const t2 = await check(small);
  say(/short of 1,000,000/.test(t2) && /≈\$/.test(t2) && /Buy on PancakeSwap/.test(t2) && / of [\d,]+ holders/.test(t2), `${tag}: a wallet under 1M -> its distance with dollars and the buy link — "${t2.slice(0, 120)}"`);
  const t3 = await check(pair);
  say(/is a contract/.test(t3), `${tag}: the pool -> a contract — "${t3.slice(0, 80)}"`);
  const t4 = await check('0x123');
  say(/not a wallet address/.test(t4), `${tag}: a typo -> not a wallet address`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${tag}: nothing wider than the screen`);
}
say(!errs.length, 'no page errors ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
