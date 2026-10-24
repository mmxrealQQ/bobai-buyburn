// (holdercard1024, 2026-10-24, operator chose variant A: the holder pass was used 0 times while 65 wallets held the
// line — it lived on /pass alone) every hire card on /services carries "Holder? Free with your wallet"; empty, it says
// what is needed; filled, it connects a wallet, has it sign the pass message and calls the agent with the pass. A
// throwaway wallet (no $BOBAI) signs here: the agent must find the proof well-formed and the signature its own, and
// refuse ONLY for the balance (code below_line) — a wrong message or header would read bad_proof / bad_signature /
// wrong_signer. Nothing is spent. 390 px.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-hc-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const acct = privateKeyToAccount(generatePrivateKey());
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [], net = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = async (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text);
  // the page's wallet asks Node to sign: the hex message comes in, the signature goes back
  if (d.method === 'Runtime.bindingCalled' && d.params.name === 'nodeSign') {
    const { n, hex } = JSON.parse(d.params.payload);
    const sig = await acct.signMessage({ message: { raw: hex } });
    send('Runtime.evaluate', { expression: `window.__signed(${n}, ${JSON.stringify(sig)})` });
  }
  if (d.method === 'Network.requestWillBeSent' && /\/answer\?service=/.test(d.params.request.url)) net.push(d.params.request);
};
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Runtime.addBinding', { name: 'nodeSign' });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let n = 0; const wait = {}; window.__signed = (k, s) => { wait[k](s); delete wait[k]; };
  window.ethereum = { request: async ({ method, params }) => { if (method === 'eth_requestAccounts') return [${JSON.stringify(acct.address)}];
    if (method === 'personal_sign') return new Promise((res) => { const k = ++n; wait[k] = res; nodeSign(JSON.stringify({ n: k, hex: params[0] })); });
    throw new Error('not here: ' + method); } }; })();` });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: base + '/services?r=' + Date.now() }); await sleep(7000);
const r = await ev(`(() => { const cards = [...document.querySelectorAll('.sv-buy')]; return { n: cards.length, btns: cards.filter((c) => /Holder\\? Free with your wallet/.test(c.querySelector('.sv-holder')?.textContent || '')).length }; })()`);
say(r.n === 6 && r.btns === 6, `every hire card carries "Holder? Free with your wallet" (${r.btns} of ${r.n})`);
const empty = await ev(`(async () => { const c = document.querySelector('.sv-buy'); c.querySelector('.sv-open>summary').click(); await new Promise((r) => setTimeout(r, 200)); c.querySelector('.sv-holder').click(); await new Promise((r) => setTimeout(r, 300)); return c.querySelector('.sv-form-msg').textContent; })()`);
say(/is needed/.test(empty) && net.length === 0, `empty, it says "${empty}" and calls nobody`);
await ev(`(() => { const c = document.querySelector('.sv-buy'); c.querySelector('input').value = '0xd319e1F8e987cf78333cEA853F455366640929cF'; c.querySelector('.sv-holder').click(); })()`);
let out = ''; for (let i = 0; i < 30; i++) { await sleep(1000); out = await ev(`document.querySelector('.sv-buy .sv-holder-out').textContent`); if (/Not answered|free with your holder pass|Not sent/.test(out)) break; }
const req = net[0], hdr = req && (req.headers['PAYMENT-SIGNATURE'] || req.headers['payment-signature']);
say(!!req && /^bobai-holder 0x[0-9a-f]{40} \S+ 0x[0-9a-f]{130}$/.test(hdr || '') && hdr.includes(acct.address.toLowerCase()), `filled, it signs and calls ${req ? new URL(req.url).pathname + new URL(req.url).search : 'nothing'} with the pass`);
const res = await fetch(req.url, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': hdr }, body: req.postData }).then((x) => x.json()).catch(() => ({}));
const code = res.code || res.holder_pass?.code || (JSON.stringify(res).match(/"code":"([a-z_]+)"/) || [])[1];
say(code === 'below_line', `the agent finds the proof sound and refuses only for the balance (code ${code})`);
say(/Not answered/.test(out) && /1,000,000 \$BOBAI/.test(out), `the card says why and what the line is ("${out.slice(0, 110)}…")`);
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
