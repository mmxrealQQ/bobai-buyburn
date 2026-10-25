// BRAINONBNB.COM/JOIN FOR PEOPLE, 25.10. (31 opens on 24.10., nearly all phones from the X post, no entry): a person in a
// browser gets two buttons on top — copy the one line for their agent, or write on the board themselves — and the same
// text below; an agent, curl and the link-card crawlers get what they got before. 390 and 1440 px, nothing wider than
// the screen, both buttons visible, the copy button answers, no script error.
// usage: node join1025.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9910 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-join25-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const get = (h) => fetch(base + '/join?r=' + Date.now(), { headers: h }).then(async (r) => [r.headers.get('content-type') || '', await r.text()]).catch(() => ['', '']);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone';
const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const ph = await get({ 'user-agent': IPHONE, accept: HTML });
say(/text\/html/.test(ph[0]) && /id="j-copy"/.test(ph[1]) && /href="\/board#take"/.test(ph[1]), `a phone from X gets a page with the copy button and "write it yourself" (${ph[0]})`);
say(/BRAIN BOARD on brainonbnb\.com — join/.test(ph[1]) && /board\/brief\/&lt;id or name&gt;/.test(ph[1]), 'the page still carries the whole text for an agent that opens it like a browser');
const wv = await get({ 'user-agent': 'Mozilla/5.0 (Linux; Android 17; motorola edge 60 fusion; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36', accept: '*/*' });
say(/text\/html/.test(wv[0]) && /id="j-copy"/.test(wv[1]), `an in-app webview that sends Accept */* gets the page too (${wv[0]})`);
const cu = await get({ 'user-agent': 'curl/8.9.1', accept: '*/*' });
say(/text\/plain/.test(cu[0]) && /^BRAIN BOARD on brainonbnb\.com — join/.test(cu[1]), 'curl gets the plain text, as before');
const cl = await get({ 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)', accept: HTML });
const gp = await get({ 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', accept: HTML });
say(/text\/plain/.test(cl[0]) && /text\/plain/.test(gp[0]), `an agent's own fetcher (Claude-User, ChatGPT-User) gets the plain text (${cl[0]} · ${gp[0]})`);
const tw = await get({ 'user-agent': 'Twitterbot/1.0' });
say(/text\/html/.test(tw[0]) && /og\/board\.png/.test(tw[1]) && !/id="j-copy"/.test(tw[1]), 'Twitterbot still gets the link card page');

const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setUserAgentOverride', { userAgent: IPHONE });
for (const [W, H] of [[390, 844], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/join?r=' + Date.now() }); await sleep(2500);
  const tag = W + 'px';
  const r = await ev(`(() => { const c = document.getElementById('j-copy'), w = document.querySelector('a[href="/board#take"]'), l = document.getElementById('j-line');
    const top = (e) => e ? e.getBoundingClientRect().bottom : 1e9;
    return { wide: document.documentElement.scrollWidth, copy: c ? c.offsetHeight : 0, write: w ? w.offsetHeight : 0, fold: Math.max(top(c), top(w)), line: l ? l.textContent : '' }; })()`);
  say(r && r.wide <= W, `${tag}: nothing wider than the screen (${r?.wide})`);
  say(r && r.copy > 30 && r.write > 30 && r.fold < H, `${tag}: both buttons visible without scrolling (bottom ${Math.round(r?.fold)} of ${H})`);
  say(/brainonbnb\.com\/join/.test(r?.line || ''), `${tag}: the line to give the agent names brainonbnb.com/join ("${r?.line}")`);
  await ev(`document.getElementById('j-copy').click()`); await sleep(400);
  const said = await ev(`document.getElementById('j-say').textContent`);
  say(/Copied|select/i.test(said || ''), `${tag}: the copy button answers ("${said}")`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill();
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exit(bad ? 1 : 0);
