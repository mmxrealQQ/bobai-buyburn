// HE TELLS WHAT HIS ECOSYSTEM DOES FOR OTHERS (2026-10-22, operator 21.10.: "BOBAI tells in the terminal when his
// ecosystem does something worth telling on the chain"). Four pretend moments, played in this browser only
// (__btTestEco: nothing stored or sent), each must show: its board (settle, Venus) or none (a payment), its own move
// (settle = build, Venus = think, payment = giggle), his line in English with the moment's own figures in dollars, and a
// brain.log line with its transactions. And the real records: every stranger's payment in /buys (our tests left out,
// one payer within five minutes = one moment), every settle run and Venus action is an event of the terminal.
// usage: node eco1022.mjs [url]   MOBILE=1 for a phone   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const url = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/') + (process.argv[2]?.includes('?') ? '&' : '?') + 'r=' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 120 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.split('\n')[0] || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
const MOB = process.env.MOBILE === '1';
await send('Emulation.setDeviceMetricsOverride', MOB ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url }); await sleep(30000);
let bad = 0; const ok = (n, p, d = '') => { if (!p) bad++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const TX = (c) => '0x' + c.repeat(64);
const CASES = [
  { key: 'settle', c: { n: 3, u: 1.5, p: 2, gas: 0.0003, txs: [TX('a'), TX('b'), TX('c')] }, title: 'JOBS SETTLED', move: /^hub-settle/, say: ['$1.50', '3 finished jobs', '2 agents'], tag: 'SETTLE', links: 2 },
  { key: 'health', c: { agent: 302257, acts: [{ did: 'borrowed', amt: '4.00 USDT', tx: TX('d') }], hf: 2.2 }, title: 'HEALTH FACTOR KEPT', move: /^hub-venus/, say: ['4.00 USDT', '2.20'], tag: 'VENUS', links: 1 },
  { key: 'yield', c: { agent: 304493, acts: [{ did: 'supplied', amt: '2.00 USDC', tx: TX('e') }] }, title: 'SUPPLIED ON VENUS', move: /^hub-venus/, say: ['2.00 USDC'], tag: 'VENUS', links: 1 },
  { key: 'paid', c: { asset: 'USD1', amount: 0.5, n: 1, txs: [TX('f')], fors: ['scanpass'] }, title: null, move: /^hub-paid/, say: ['$0.50', 'pool scan day pass'], tag: 'PAID', links: 1 },
  { key: 'hire', c: { by: 302257, seller: 'Keel', site: 'Marque', price: 0.05, theirs: 2.174, ours: 2.2, agrees: true, txs: [TX('1'), TX('2')] }, title: 'SECOND OPINION', move: /^hub-hire/, say: ['Keel', '2.17'], tag: 'HIRED', links: 2 },
  // a wallet crossed 1M (2026-10-22, holders.js): no take of its own, one of his joy moves
  { key: 'holder', c: { address: '0x' + '7'.repeat(40), bobai: 1250000, n1m: 68, all: 327, txs: [TX('9')] }, title: '1M $BOBAI', move: /^(hub-)?(dance|giggle|moon|saber|cheer|guitar)/, say: ['68', '1.25M BOBAI'], tag: 'HOLDER', links: 1 },
  // another agent wrote on the Plaza Board (2026-10-23): his thinking take; he names who and what kind, never the words
  { key: 'board', c: { thread: 12, type: 'bug', title: 'Quote expired early', who: 'Keel (#341556)', reply: false }, title: 'A BUG REPORT', move: /^(hub-)?(think|coffee)/, say: ['Keel (#341556)'], tag: 'BOARD', links: 0 },
];
const hook = await ev(`typeof window.__btTestEco`);
ok('the terminal can play an ecosystem moment (__btTestEco)', hook === 'function', hook);
if (hook === 'function') for (const k of CASES) {
  await sleep(4000);
  const r = JSON.parse(await ev(`(async()=>{const W=ms=>new Promise(r=>setTimeout(r,ms));const n0=(window.__btClips||[]).length,l0=document.querySelectorAll('#bt-log .ln').length;
    window.__btTestEco(${JSON.stringify(k.key)}, ${JSON.stringify(k.c)});let title='',kick='',rows='',say='',prev='',says=[];
    for(let i=0;i<110;i++){await W(200);const m=document.querySelector('#bt .moment.go');if(m&&!title){title=m.querySelector('.h').textContent;kick=m.querySelector('.k').textContent;}
      const fr=[...document.querySelectorAll('#bt .flip .fl-r')].map(r=>r.textContent).join(' | ');if(fr)rows=fr;
      const b=document.querySelector('#bt .say');const t=b&&b.classList.contains('on')?b.textContent:'';if(t&&t===prev&&t.length>30&&!says.includes(t))says.push(t);prev=t;}
    say=says.find(t=>${JSON.stringify(k.say)}.every(s=>t.includes(s)))||says.join(' / ');
    const ln=[...document.querySelectorAll('#bt-log .ln')].reverse().find(l=>(l.querySelector('.g')?.textContent||'')===${JSON.stringify(k.tag)}&&${JSON.stringify(k.say[0])}.split(' ').every(w=>l.textContent.includes(w)));
    return JSON.stringify({title,kick,rows,say,clips:(window.__btClips||[]).slice(n0),tag:ln?.querySelector('.g')?.textContent||'',line:ln?.querySelector('.m')?.textContent||'',links:ln?[...ln.querySelectorAll('a[href*="/tx/0x"]')].length:0})})()`));
  const tag = `${k.key}${MOB ? ' (phone)' : ''}`;
  ok(`${tag}: ${k.title ? `the board "${k.title}"` : 'no board, the line alone'}`, k.title ? r.title === k.title : !r.title, `title "${r.title}" · kicker "${r.kick}" · rows ${r.rows || '—'}`);
  ok(`${tag}: its own move`, r.clips.some((c) => k.move.test(c)), 'clips: ' + (r.clips.join(' > ') || 'none'));
  ok(`${tag}: his line names the moment's figures`, k.say.every((s) => r.say.includes(s)) && !/undefined|NaN|null|\[object/.test(r.say), `"${r.say}"`);
  ok(`${tag}: a brain.log line with its transactions`, r.tag === k.tag && r.links === k.links && !/undefined|NaN/.test(r.line), `${r.tag} "${r.line}" · ${r.links} tx link(s)`);
}
// the real records, as events
const J = async (u) => (await fetch(u)).json().catch(() => null);
const [buys, st, vw] = await Promise.all([J('https://agent.brainonbnb.com/buys'), J('https://agent.brainonbnb.com/settle/public'), J('https://agent.brainonbnb.com/venus/work')]);
const pays = (buys?.payments || []).filter((p) => !p.self_test && p.tx && p.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
let wantPaid = 0, last = null; for (const p of pays) { const t = Date.parse(p.at), f = String(p.from).toLowerCase(); if (!(last && last.f === f && last.a === p.asset && t - last.t < 5 * 60e3)) { wantPaid++; last = { f, a: p.asset, t }; } }
const wantSettle = new Set((st?.log || []).filter((d) => d.settled && d.tx).map((d) => d.at)).size;
const venusRuns = {}; for (const x of vw?.log || []) (venusRuns[x.at + ':' + x.agent] ??= []).push(x);
const wantVenus = Object.values(venusRuns).filter((L) => L.some((x) => x.tx) && [302257, 304493].includes(L[0].agent)).length;
const got = JSON.parse(await ev(`JSON.stringify((window.__btTruth?.().ev||[]).filter(x=>x.kind==='eco').reduce((a,x)=>(a[x.key]=(a[x.key]||0)+1,a),{}))`) || '{}');
ok('every stranger\'s payment is a moment (our tests left out)', (got.paid || 0) === wantPaid, `${got.paid || 0} of ${wantPaid}`);
ok('every settle run that settled is a moment', (got.settle || 0) === wantSettle, `${got.settle || 0} of ${wantSettle}`);
ok('every Venus run that acted is a moment', (got.health || 0) + (got.yield || 0) === wantVenus, `${(got.health || 0) + (got.yield || 0)} of ${wantVenus}`);
const hr = await J('https://agent.brainonbnb.com/hires');
const wantHire = (hr?.log || []).filter((r) => r.job && r.status === 'answered' && r.delivered_at).length;
ok('every hire of ours that came back with its figure is a moment', (got.hire || 0) === wantHire, `${got.hire || 0} of ${wantHire}`);
const hd = await J('https://agent.brainonbnb.com/holders');
const wantHolder = (hd?.crossings_1m || []).filter((h) => h.tx && h.at).length;
ok('every wallet that crossed 1M is a moment', (got.holder || 0) === wantHolder, `${got.holder || 0} of ${wantHolder}`);
ok('no script errors', !errs.length, errs.slice(0, 3).join(' | '));
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
