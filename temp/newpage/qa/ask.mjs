// HE UNDERSTANDS WHAT PEOPLE TYPE (2026-10-09): types real questions into the terminal's prompt and reads his answer.
// FAILs when a question gets the "not sure what you mean" fallback, when an answer says NaN/undefined/null, when a
// $BOBAI amount stands without its dollars, or when the page throws. Also fires each new answer twice: a second ask
// must not repeat the first one word for word (five variants each).
// usage: node ask.mjs [url]   exit code 1 on any FAIL
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const base = process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 400), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
  if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').split('\n')[0]);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '?r=' + Date.now() });
// ready = the prompt exists and the burn log has been read (answers wait for it)
let ready = false;
for (let i = 0; i < 90 && !ready; i++) { await sleep(1000); ready = await ev(`!!document.getElementById('bt-cmdIn') && typeof window.__btAsk === 'function' && /BOBAI/.test(document.getElementById('bt-log')?.innerText || '')`); }
await sleep(8000);
const ask = async (q) => {
  const n0 = await ev(`document.getElementById('bt-log').children.length`);
  await ev(`(() => { const i = document.getElementById('bt-cmdIn'); i.value = ${JSON.stringify(q)}; document.getElementById('bt-cmd').requestSubmit(); })()`);
  await sleep(q.match(/safe|rug|whale|holder|agents|flip/) ? 9000 : 1500);
  return ev(`[...document.getElementById('bt-log').children].slice(${n0}).map(l => l.innerText.replace(/\\s+/g, ' ').trim()).filter(t => !/^YOU/.test(t)).join(' | ')`);
};
// 2026-10-10: the small talk people really type (each fell to the fallback or the wrong answer before)
const QS = ['holder pass', 'why hold bobai', 'how do i buy', 'what is bobai', 'what’s this', 'are you an ai', 'airdrop?', 'should i sell', 'gn', 'i love you', 'bad bot', 'lfg', 'cmc listing', 'how much is 1 bobai', 'who made you', 'how are you today', 'dance', 'price?','is it safe?', 'what did I miss', 'why down', 'whales', 'wen moon', 'who are you', 'gm', 'tax', 'ca', 'how to buy', 'nft', 'team', 'prise', 'liqudity', 'when is the next burn', 'how are you', 'thanks', 'burns', 'defi', 'dexscreener shows a different 24h', 'agents', 'the flip', 'how many holders'];
// the sites' 24h question (2026-10-09) must get the USD and the against-BNB figure, not the day's summary
const MUST = { 'how many holders': /In all, \d[\d,]* wallets hold \$BOBAI and \d+ of them 1M\+, counted from the chain/, /* 2026-10-22: the count from /holders */ 'dexscreener shows a different 24h': /in USD.*Against BNB I am [+-]\d+\.\d%.*BNB went [+-]\d+\.\d%/,
  'who made you': /dev|builder/i, 'are you an ai': /chatbot|language model|ChatGPT|never made up/i, 'airdrop?': /no BOBAI airdrop/i, 'should i sell': /What I can show/,
  'what is bobai': /I am BOBAI|BOBAI\. A brain|The name is BOBAI|token, awake/,
  // 2026-10-14: the agents we run and the second opinion ours bought; The Flip from our own pool
  'agents': /(employ six|Six AI agents|six AI agents|run six agents|I have six).*(hired another AI|second opinion).*1,000,000 \$BOBAI \(≈\$\d.*20 a day.*holder pass ↗/,
  // 2026-10-16: the $BOBAI holder pass, asked directly and said after the buy answer
  'holder pass': /1,000,000 \$BOBAI \(≈\$\d.*20 a day.*holder pass ↗/, 'why hold bobai': /1,000,000 \$BOBAI.*holder pass ↗/, 'how do i buy': /PancakeSwap, BOBAI\/WBNB.*1,000,000 \$BOBAI.*holder pass ↗/, 'the flip': /66%.*88%.*A third more/,
  'dance': /Watch this|Coming right up|For you|You asked|Here goes|Busy with|One move at|Finishing this|Hands full|has the stage/ };
let fails = 0;
const fail = (q, why, a) => { fails++; console.log(`FAIL  ${q.padEnd(20)} ${why}\n      ${String(a).slice(0, 400)}`); };
if (!ready) fail('(page)', 'the prompt never got ready', '');
else for (const q of QS) {
  const a = await ask(q);
  if (!a) { fail(q, 'no answer', a); continue; }
  if (/not sure what you mean|do not know yet|only speak BOBAI|No idea, honestly|Lost me there/.test(a)) { fail(q, 'fell to the fallback', a); continue; }
  if (/NaN|undefined|\bnull\b|\[object/.test(a)) { fail(q, 'broken value', a); continue; }
  // the offending phrase itself (2026-10-15: the 400 characters shown stopped before it, so it could not be found)
  // a log line's time before its BOBAI tag ('08:30:37 BOBAI BOBAI's buyback bot ...') is no amount — it read as '37 BOBAI'
  { const m = a.replace(/ BOBAI\/WBNB/g, '').replace(/\b\d\d:\d\d:\d\d BOBAI\b/g, '00:00:00 TAG').match(/[^|]{0,160}\d[\d.,]*[KMB]? BOBAI(?! \(≈\$)[^|]{0,40}/); if (m) { fail(q, '$BOBAI amount without USD', '…' + m[0].slice(-110)); continue; } }
  if (MUST[q] && !MUST[q].test(a)) { fail(q, 'answer misses its figures', a); continue; }
  console.log(`PASS  ${q.padEnd(20)} ${a.slice(0, 160)}`);
}
// where a question goes, read from the page's own matcher (2026-10-10): the mood answer has too many wordings to match
for (const [q, want] of [['how are you today', 'mood'], ['who made you', 'team'], ['same here', null], ['hell yeah', null], ['what’s bobai', 'who']]) {
  const got = ready ? await ev(`window.__btAsk(${JSON.stringify(q)})`) : 'x';
  (got ?? null) === want ? console.log(`PASS  ${q.padEnd(20)} -> ${want}`) : fail(q, `goes to ${got}, not ${want}`, '');
}
// the fallback itself still answers, with a live fact
const m = ready ? await ask('qwertz blub') : '';
if (ready) /charged|still reading/.test(m) ? console.log(`PASS  ${'(nonsense)'.padEnd(20)} ${m.slice(0, 160)}`) : fail('(nonsense)', 'fallback without a live fact', m);
// he answers with his body when nothing else runs: at least one typed answer must have been spoken with its move
const spoke = ready ? await ev(`(window.__btAskSpoke || []).filter(x => x[1]).map(x => x[0]).join(',')`) : '';
if (ready) spoke ? console.log(`PASS  ${'(spoken)'.padEnd(20)} said with a move: ${spoke}`) : fail('(spoken)', 'no typed answer was ever said in the bubble', JSON.stringify(await ev('window.__btAskSpoke')));
if (errs.length) { fails++; console.log('FAIL  page errors: ' + [...new Set(errs)].join(' / ')); }
console.log(`${fails ? 'FAIL' : 'PASS'}  ${QS.length + 1} questions, ${fails} failed`);
ws.close(); ch.kill(); await sleep(800); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fails ? 1 : 0);
