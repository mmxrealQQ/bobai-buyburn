// Arabic A-Z: what the terminal ACTUALLY says on /ar/ that has no entry yet (lines put together at run time: plural
// endings, contexts in front of a line, figures that are words). Opens /ar/, lets him talk, plays the 24 h replay,
// types the usual commands into his prompt, and collects window.__arMiss. Writes temp/i18n/term-miss.json.
// Usage: node term-run.mjs [origin] [minutes]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const base = (process.argv[2] || 'https://arabic.bobai-dashboard.pages.dev').replace(/\/$/, ''), mins = Number(process.argv[3] || 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9910 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-trun-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '/ar/?r=' + Date.now() }); await sleep(15000);
// the brainrot notice: keep the look (its buttons are the first two in the notice)
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /brainrot|البرينروت|ابقَ|Stay/i.test(x.textContent)); if (b) b.click(); return !!b; })()`);
const CMDS = ['help', 'burns', 'next', 'ca', 'nft', 'joke', 'defi', 'tax', 'liq', 'price', 'buy', 'who are you?', 'is it safe?', 'what did I miss?', 'why down?', 'pop', 'board', 'agents', 'giggle', 'roadmap', 'holders', 'whale', 'chart', 'hello', 'gm', 'thanks'];
const typeCmd = (c) => ev(`(() => { const i = document.querySelector('#bt input, #bt textarea'); if (!i) return false; i.focus(); i.value = ${JSON.stringify(c)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); const f = i.closest('form'); if (f) f.requestSubmit ? f.requestSubmit() : f.submit(); return true; })()`);
const end = Date.now() + mins * 60e3; let k = 0, replayed = false;
while (Date.now() < end) {
  if (!replayed && Date.now() > end - mins * 60e3 * 0.75) { replayed = await ev(`(() => { const b = [...document.querySelectorAll('#bt button, #bt [role=button], #bt .rp, #bt span')].find((x) => /REPLAY|إعادة/.test(x.textContent) && x.offsetParent); if (b) b.click(); return !!b; })()`); }
  await typeCmd(CMDS[k++ % CMDS.length]); await sleep(9000);
}
const miss = (await ev('[...(window.__arMiss || [])]')) || [];
fs.writeFileSync('D:/ai/fourmeme/temp/i18n/term-miss.json', JSON.stringify(miss, null, 1));
console.log(`${miss.length} lines without Arabic (replay ${replayed ? 'played' : 'not found'}, ${k} commands typed)`);
ws.close(); ch.kill(); process.exit(0);
