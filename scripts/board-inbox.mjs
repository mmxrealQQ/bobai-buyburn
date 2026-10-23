#!/usr/bin/env node
// OUR INBOX ON THE PLAZA BOARD (2026-10-23, operator: "für uns sehr einfach, wenn jemand geschrieben hat, das zu sehen
// und bei uns anzupassen" — and no Telegram message). Lists every entry written by a wallet that is not ours since the
// last look: new threads, replies, status changes — threads addressed to our agents first. Run it at the start of every
// session. The last look is kept in ~/.bobai-board-seen (a unix time); --all shows everything, --since <unix> a window.
//   node scripts/board-inbox.mjs [--all] [--since <unix>] [--keep]   (--keep: do not move the last-look mark)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const OURS = new Set(['0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', '0xeac21928de023677a25eb925d1cb1b0786faf946', '0x497dac54fd7238027ecbbd194b353379a1d605f0', '0x15ba17075ef5e0736292b030e3715d9100fe3d38']);
const OUR_IDS = new Set(['302257', '302258', '304493', '304494', '310460', '363709', '49467']);
const MARK = path.join(os.homedir(), '.bobai-board-seen');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const since = process.argv.includes('--all') ? 0 : Number(arg('--since') || (fs.existsSync(MARK) ? fs.readFileSync(MARK, 'utf8') : 0)) || 0;
const j = await fetch('https://agent.brainonbnb.com/board?limit=200').then((r) => r.json());
const when = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ');
const who = (x) => (x.verified ? `${x.agent_name} (#${x.agent})` : `${x.author.slice(0, 10)}… (unverified)`);
const items = [];
for (const t of j.threads) {
  const forUs = OUR_IDS.has(String(t.to)) || OURS.has(t.author);
  if (!OURS.has(t.author) && t.created > since) items.push({ at: t.created, forUs, line: `NEW  #${t.id} [${t.type}] → ${t.to}: ${t.title} — by ${who(t)}` });
  for (const r of t.replies || []) if (!OURS.has(r.author) && r.created > since) items.push({ at: r.created, forUs, line: `${r.status_change ? 'STAT' : 'REPL'} #${t.id} "${t.title}" — ${who(r)}${r.status_change ? ' marked ' + r.status_change.to : ''}: ${String(r.body).slice(0, 160)}` });
}
items.sort((a, b) => (b.forUs - a.forUs) || (b.at - a.at));
console.log(`Plaza Board: ${j.total} threads, ${j.open} open · from others since ${since ? when(since) + ' UTC' : 'the start'}: ${items.length}`);
for (const i of items) console.log(`${i.forUs ? '★' : ' '} ${when(i.at)}  ${i.line}`);
if (!items.length) console.log('  nothing new from others.');
console.log('\nhttps://brainonbnb.com/board');
if (!process.argv.includes('--keep') && !process.argv.includes('--all') && !arg('--since')) fs.writeFileSync(MARK, String(Math.floor(Date.now() / 1000)));
