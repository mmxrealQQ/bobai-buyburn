// Brain Board, recheck on the page (2026-10-26, operator: "weiter am board ... damit alles 100% funktioniert", after the X post
// "the Brain Board is now an AI agent of its own")
import { spawn } from 'node:child_process';
const page = process.argv[2] || 'https://brainonbnb.com/board';
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9550 + Math.floor(Math.random() * 40), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = []; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 140)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
// the board is an agent (#391841) and says so under the hero; a told agent's checkup offers Recheck, which answers in place
for (const [name, W, H, mob] of [['iPhone', 390, 844, 1], ['Fold', 344, 882, 1], ['Desktop', 1440, 900, 0]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mob });
  await send('Page.navigate', { url: page + '?agent=265375&r=' + Date.now() + '#take' }); await sleep(5000);
  say(await ev(`[...document.querySelectorAll('.bb-agentline')].some(p=>/AI agent too/.test(p.textContent)&&p.querySelector('a[href*="391841"]'))`), `${name} ${W}: under the hero, the board is an agent (#391841) with its checkup linked`);
  let b = null; for (let k = 0; k < 40 && !b; k++) { await sleep(1000); b = await ev(`document.getElementById('bb-recheck')?1:null`); }
  say(!!b && /#56/.test(await ev(`document.getElementById('bb-recheck').parentElement.textContent`)), `${name} ${W}: a told agent (#265375) offers Recheck, naming its thread #56`);
  if (b) { await ev(`document.getElementById('bb-recheck').click()`); let o = ''; for (let k = 0; k < 40 && !/read now|looked at/.test(o); k++) { await sleep(1000); o = await ev(`document.getElementById('bb-recheck-out').textContent`); }
    say(/BNB LP Range Rebalancer \(#265375\)|looked at \d+ s ago/.test(o), `${name} ${W}: Recheck answers in place: "${o.split('\n')[0].slice(0, 70)}"`); }
  say(await ev(`document.documentElement.scrollWidth<=innerWidth+1`), `${name} ${W}: nothing runs sideways`);
}
await send('Page.navigate', { url: page + '?agent=391841&r=' + Date.now() + '#take' }); await sleep(4000);
let t = null; for (let k = 0; k < 40 && !t; k++) { await sleep(1000); t = await ev(`/checkup/.test(document.getElementById('pb-agent-out').innerText)?1:null`); }
say(t && !(await ev(`!!document.getElementById('bb-recheck')`)) && /9\/9/.test(await ev(`document.getElementById('pb-agent-out').innerText`)), 'the board\'s own checkup reads 9/9, no Recheck (it was told nothing)');
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(fails ? `FAIL  ${fails}` : 'PASS  board: the board as an agent, Recheck for a told agent');
ws.close(); ch.kill(); await sleep(800); try { (await import('node:fs')).rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fails ? 1 : 0);
