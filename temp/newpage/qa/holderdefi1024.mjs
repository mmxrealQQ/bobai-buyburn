// (holderdefi1024, 2026-10-24, operator chose variant A for the holder pass) /defi: the plan for a position offers
// "Hold 1,000,000 $BOBAI? Free with your wallet" beside the hire and the per-answer payment; it signs the pass message
// and asks for the plan with it. A throwaway wallet (no $BOBAI) signs here: the agent must read the proof sound and
// refuse ONLY for the balance (below_line), and the page says why with a link to /pass. Nothing is spent. 390 px.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-hd-' + port;
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
  if (d.method === 'Runtime.bindingCalled' && d.params.name === 'nodeSign') {
    const { n, hex } = JSON.parse(d.params.payload);
    const sig = await acct.signMessage({ message: { raw: hex } });
    send('Runtime.evaluate', { expression: `window.__signed(${n}, ${JSON.stringify(sig)})` });
  }
  if (d.method === 'Network.requestWillBeSent' && /\/answer\?service=lp_position_plan/.test(d.params.request.url) && /bobai-holder/.test(JSON.stringify(d.params.request.headers))) net.push(d.params.request);
};
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Runtime.addBinding', { name: 'nodeSign' });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let n = 0; const wait = {}; window.__signed = (k, s) => { wait[k](s); delete wait[k]; };
  window.ethereum = { request: async ({ method, params }) => { if (method === 'eth_requestAccounts') return [${JSON.stringify(acct.address)}];
    if (method === 'personal_sign') return new Promise((res) => { const k = ++n; wait[k] = res; nodeSign(JSON.stringify({ n: k, hex: params[0] })); });
    throw new Error('not here: ' + method); } }; })();` });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: base + '/defi?r=' + Date.now() }); await sleep(9000);
await ev(`(() => { document.getElementById('lp-yours-in').value = '7637521'; document.getElementById('lp-yours-go').click(); })()`);
let hb = false; for (let i = 0; i < 30 && !hb; i++) { await sleep(1000); hb = await ev(`!!document.getElementById('lp-yours-holder')`); }
say(hb, 'the plan for a position offers "Hold 1,000,000 $BOBAI? Free with your wallet"');
if (hb) {
  await ev(`document.getElementById('lp-yours-holder').click()`);
  let out = ''; for (let i = 0; i < 30; i++) { await sleep(1000); out = await ev(`(document.getElementById('lp-yours-holder').closest('.lp-terms').querySelector('.lp-err') || {}).textContent || ''`); if (out) break; }
  const req = net[0], hdr = req && (req.headers['PAYMENT-SIGNATURE'] || req.headers['payment-signature']);
  say(!!req && /^bobai-holder 0x[0-9a-f]{40} \S+ 0x[0-9a-f]{130}$/.test(hdr || ''), 'it signs and asks for the plan with the pass');
  const res = req ? await fetch(req.url, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': hdr }, body: req.postData }).then((x) => x.json()).catch(() => ({})) : {};
  const code = res.code || (JSON.stringify(res).match(/"code":"([a-z_]+)"/) || [])[1];
  say(code === 'below_line', `the agent reads the proof sound and refuses only for the balance (code ${code})`);
  const html = await ev(`document.getElementById('lp-yours-holder').closest('.lp-terms').innerHTML`);
  say(/1,000,000/.test(out) && /href="\/pass"/.test(html), `the page says why, with /pass ("${out.slice(0, 100)}")`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
