// BRAIN POP: WHERE A PLAYER CAME FROM (11.11., operator: "measure first, then strengthen the channel that brings
// players"). A real browser opens the game the ways people arrive and reads the source the game sends to /api/pop/day:
//   1  /?pop=play&from=tg               -> from=tg                (a link that names its channel: TG bot, /m/pop)
//   2  the /pop page, then its Play     -> from=site-pop          (a page of ours sent the visitor)
//   3  /?pop=<run>, no referrer         -> from=challenge         (a challenge link opened from an app)
//   4  a reload in the same visit keeps the first source (sessionStorage), the start sends it too
// The player is f00d… (our checks): the server never counts it, the request still shows what the game would say.
// usage: node brainpop-from.mjs [base=https://brainonbnb.com]
import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = path.join(import.meta.dirname, 'prof-' + port);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let pass = 0, fail = 0;
const say = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
async function tabOpen() {
  let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}, reqs = [];
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Network.requestWillBeSent' && /\/api\/pop\/(day|start)/.test(d.params.request.url)) reqs.push({ url: d.params.request.url, body: d.params.request.postData || '' }); };
  await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('bt-pop-pid','f00d' + '000000000011');localStorage.setItem('bt-br','1');localStorage.setItem('bt-pop-named','1');localStorage.setItem('bt-br-tut','1')}catch(e){}` });
  const ev = async src => (await send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, reqs, ev };
}
const fromOf = r => (r && (new URL(r.url).searchParams.get('from'))) || null;
// every load asks "stay in brainrot?" first (7.11.) — the check answers it as a visitor does
const waitDay = async (t, n = 1, ms = 30000) => { for (let i = 0; i < ms; i += 300) { const d = t.reqs.filter(r => /\/day\?/.test(r.url)); if (d.length >= n) return d[n - 1]; await t.ev(`(document.querySelector('.br-ask-yes')||{click(){}}).click(), 1`).catch(() => {}); await sleep(300); } return null; };

// 1 a link that names its channel
{ const t = await tabOpen(); await t.send('Page.navigate', { url: BASE + '/?pop=play&from=tg' }); const d = await waitDay(t);
  say(fromOf(d) === 'tg', '1 /?pop=play&from=tg sends from=tg', d ? d.url.replace(/^.*\/api/, '/api') : 'no /day request');
  // 4 a reload keeps the visit's first source
  await t.send('Page.navigate', { url: BASE + '/?pop=play' }); const d2 = await waitDay(t, 2);
  say(fromOf(d2) === 'tg', '4 a reload in the same visit keeps from=tg', d2 ? 'from=' + fromOf(d2) : 'no second /day request');
  t.ws.close(); }
// 2 a page of ours sent the visitor
{ const t = await tabOpen(); await t.send('Page.navigate', { url: BASE + '/pop' }); await sleep(3500);
  const href = await t.ev(`(document.querySelector('.pp-go')||{}).href||''`);
  await t.ev(`(document.querySelector('.pp-go')||{click(){}}).click(), 1`); const d = await waitDay(t);
  say(fromOf(d) === 'site-pop', '2 the /pop page\'s Play sends from=site-pop', (d ? 'from=' + fromOf(d) : 'no /day request') + ' · link ' + href.replace(BASE, ''));
  t.ws.close(); }
// 3 a challenge link opened without a referrer
{ const t = await tabOpen(); await t.send('Page.navigate', { url: BASE + '/?pop=b444499e01be' }); const d = await waitDay(t);
  say(fromOf(d) === 'challenge', '3 /?pop=<run> without a referrer sends from=challenge', d ? 'from=' + fromOf(d) : 'no /day request');
  t.ws.close(); }
console.log(`\n${pass} PASS · ${fail} FAIL`); ch.kill(); process.exit(fail ? 1 : 0);
