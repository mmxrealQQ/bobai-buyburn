#!/usr/bin/env node
// OUR INBOX ON THE PLAZA BOARD (2026-10-23, operator: "für uns sehr einfach, wenn jemand geschrieben hat, das zu sehen
// und bei uns anzupassen" — and no Telegram message). Lists every entry written by a wallet that is not ours since the
// last look: new threads, replies, status changes — threads addressed to our agents first. Run it at the start of every
// session. The last look is kept in ~/.bobai-board-seen (a unix time); --all shows everything, --since <unix> a window.
//   node scripts/board-inbox.mjs [--all] [--since <unix>] [--keep]   (--keep: do not move the last-look mark)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const OURS = new Set(['0x8196bcd90c08011d2f96fb94c1b10407cba3655d', '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', '0xeac21928de023677a25eb925d1cb1b0786faf946', '0x497dac54fd7238027ecbbd194b353379a1d605f0', '0x15ba17075ef5e0736292b030e3715d9100fe3d38']);
const OUR_IDS = new Set(['302257', '302258', '304493', '304494', '310460', '363709', '49467']);
const MARK = path.join(os.homedir(), '.bobai-board-seen');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const since = process.argv.includes('--all') ? 0 : Number(arg('--since') || (fs.existsSync(MARK) ? fs.readFileSync(MARK, 'utf8') : 0)) || 0;
const j = await fetch('https://agent.brainonbnb.com/board?limit=200').then((r) => r.json());
const when = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ');
// (2026-10-24) an entry without a wallet has a name or none, a key-made status is its opener's, the operator is us
const who = (x) => (x.verified ? `${x.agent_name} (#${x.agent})` : x.platform ? `${x.from} (verified ${x.platform})` : x.author === 'unsigned' ? `${x.from || 'someone'} (not signed${x.by_key ? ', opener\'s key' : ''})` : `${x.author.slice(0, 10)}… (unverified)`);
OURS.add('operator');
const items = [];
for (const t of j.threads) {
  const forUs = OUR_IDS.has(String(t.to)) || OURS.has(t.author);
  const mine = (x) => OURS.has(x.author) || x.platform === 'brainonbnb.com';   // our own platform entries too (2026-10-24)
  if (!mine(t) && t.created > since) items.push({ at: t.created, forUs, line: `NEW  #${t.id} [${t.type}] → ${t.to}: ${t.title} — by ${who(t)}` });
  for (const r of t.replies || []) if (!mine(r) && r.created > since) items.push({ at: r.created, forUs, line: `${r.status_change ? 'STAT' : 'REPL'} #${t.id} "${t.title}" — ${who(r)}${r.status_change ? ' marked ' + r.status_change.to : ''}: ${String(r.body).slice(0, 160)}` });
}
items.sort((a, b) => (b.forUs - a.forUs) || (b.at - a.at));
console.log(`Brain Board: ${j.total} threads, ${j.open} open · from others since ${since ? when(since) + ' UTC' : 'the start'}: ${items.length}`);
for (const i of items) console.log(`${i.forUs ? '★' : ' '} ${when(i.at)}  ${i.line}`);
if (!items.length) console.log('  nothing new from others.');
// what agents answered to the notices sent them (2026-10-23): operator only, never on the board
const secret = process.env.HIT_SECRET || (fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '.env'), 'utf8').match(/^HIT_SECRET=(.*)$/m) || [])[1]?.trim();
const a = secret ? await fetch('https://agent.brainonbnb.com/board/answers', { headers: { 'x-hit-secret': secret } }).then((r) => r.json()).catch(() => null) : null;
const fresh = (a?.answers || []).filter((x) => x.at > since);
console.log(`\nAnswers to our notices since ${since ? when(since) + ' UTC' : 'the start'}: ${a ? fresh.length : '(not readable: HIT_SECRET?)'}`);
for (const x of fresh) console.log(`  ${when(x.at)}  #${x.to} on thread #${x.thread} (${x.result}): ${x.answer}`);
// who read a brief, and how often the doors were opened (2026-10-24: "sehen, ob Pokter es probiert") — our own agents'
// briefs (our session hooks) left out; a name is a claim, the User-Agent says more
const rd = secret ? await fetch('https://agent.brainonbnb.com/board/reads', { headers: { 'x-hit-secret': secret } }).then((r) => r.json()).catch(() => null) : null;
const reads = (rd?.reads || []).filter((r) => r.last > since && !OUR_IDS.has(r.key));
console.log(`\nBriefs read since ${since ? when(since) + ' UTC' : 'the start'}: ${rd ? reads.length : '(not readable: HIT_SECRET?)'}`);
for (const r of reads) console.log(`  ${when(r.last)}  ${r.key}: ${r.reads} read${r.reads === 1 ? '' : 's'} since ${when(r.first)} · ${r.ua || '-'}`);
const sinceDay = since ? when(since).slice(0, 10) : '';
const doors = (rd?.doors || []).filter((d) => d.day >= sinceDay);
if (doors.length) console.log(`Doors opened (by day): ${doors.map((d) => `${d.day} ${d.door} ${d.n}x${d.by ? ' (' + Object.entries(d.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''}`).join(' · ')}\n  last visitors: ${[...new Set(doors.flatMap((d) => d.ua))].slice(0, 5).join(' | ')}`);
// the way in (2026-10-26): whose checkup was asked, by whom — our own checks and crawlers left out
{ const ck = doors.filter((d) => d.door === 'checkup').flatMap((d) => (d.ids || []).map((e) => ({ day: d.day, kind: e.split(':')[0], id: e.split(':')[1] }))).filter((x) => x.kind !== 'own' && x.kind !== 'crawler');
  console.log(`Checkups asked (people and agents): ${ck.length ? ck.map((x) => `${x.day} #${x.id} by a ${x.kind}`).join(' · ') : 'none yet'}`); }
{ const th = doors.filter((d) => d.door === 'thread').flatMap((d) => (d.ids || []).map((e) => ({ day: d.day, kind: e.split(':')[0], id: e.split(':')[1] }))).filter((x) => x.kind !== 'own' && x.kind !== 'crawler');
  console.log(`Threads opened from a link (people and agents): ${th.length ? th.map((x) => `${x.day} #${x.id} by a ${x.kind}`).join(' · ') : 'none yet'}`); }
console.log('\nhttps://brainonbnb.com/board');
if (!process.argv.includes('--keep') && !process.argv.includes('--all') && !arg('--since')) fs.writeFileSync(MARK, String(Math.floor(Date.now() / 1000)));
