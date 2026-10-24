// the front page's 04 tile and Classic's Block 04 on a given origin: six apps, the Brain Board among them with its live
// fact, the "for every agent" row three cards; no script error; nothing wider than the screen.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-t4-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
// (svccompact1024, 2026-10-24, operator chose variant A: "/services auf dem Handy" 11,945 px) compact cards: each hire
// card shows its name, one sentence, the price and one button, closed under 260 px; the button opens the form, an empty
// form says what is needed, a filled one goes to the Plaza's hire flow; "See a real answer" stays outside; the
// tools and "How paying works" open on a click; the page under 7,000 px on a phone. 1440 and 390 px.
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: base + '/services?r=' + Date.now() }); await sleep(7000);
  const r = await ev(`(() => { const cards = [...document.querySelectorAll('.sv-buy')]; return { total: document.documentElement.scrollHeight, n: cards.length,
    tall: cards.map((c) => c.offsetHeight), formHidden: cards.every((c) => !c.querySelector('form').checkVisibility()),
    btn: cards.every((c) => c.querySelector('.sv-open>summary').textContent.trim().startsWith('Hire for $0.10') && c.querySelector('.sv-ask') && c.querySelector('.sv-price').offsetHeight > 0),
    ex: cards.every((c) => c.querySelector('a.sv-example')?.offsetHeight > 0), caps: [...document.querySelectorAll('.sv-capsw')].every((d) => !d.open && d.querySelector('summary').offsetHeight > 0),
    wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  say(r.n === 6 && Math.max(...r.tall) < 260 && r.formHidden && r.btn && r.ex, `${w}px: 6 compact hire cards (${r.tall.join('/')} px), name, sentence, price, button, example link${r.formHidden && r.btn && r.ex ? '' : ' ' + JSON.stringify({ formHidden: r.formHidden, btn: r.btn, ex: r.ex })}`);
  if (w < 500) say(r.total < 7000, `${w}px: the page is ${r.total} px (was 11,945)`);
  say(r.caps && !r.wide, `${w}px: the tools fold closed, nothing wider than the screen`);
  const f = await ev(`(async () => { const c = document.querySelector('.sv-buy'); c.querySelector('.sv-open>summary').click(); await new Promise((r) => setTimeout(r, 300));
    const form = c.querySelector('form'); const vis = form.offsetHeight > 0 && form.querySelector('button[type=submit]').offsetHeight > 0;
    form.requestSubmit(); await new Promise((r) => setTimeout(r, 200)); const msg = form.querySelector('.sv-form-msg').textContent;
    return { vis, msg, svc: form.dataset.service, agent: form.dataset.agent }; })()`);
  say(f.vis && /is needed/.test(f.msg), `${w}px: the button opens the form; empty, it says "${f.msg}"`);
  await ev(`(() => { const form = document.querySelector('.sv-buy form'); form.querySelector('input').value = '0x7380a2b47bcbd0b3d8f31ad0ad8bdb0e75b5f8b5'; form.requestSubmit(); })()`); await sleep(3000);
  const url = await ev('location.href');
  say(/\/registry\?hire=302257&task=/.test(url), `${w}px: filled, it goes to the Plaza's hire flow (${url.slice(0, 90)})`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
