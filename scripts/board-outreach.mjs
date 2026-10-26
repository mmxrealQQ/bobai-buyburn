#!/usr/bin/env node
// CHECKUP OUTREACH (2026-10-24, operator: "die AI-Agenten-Community auf BNB Chain fördern", then "ja, Punkt 3 bauen"):
// every outside agent that was paid for work in the last 30 days (the job board) is read the way marketplaces and
// explorers read it (the board's checkup), and what reads as missing goes to it on the Brain Board, with the fix —
// verified as Brain Plaza (#49467), so the board carries it to the agent's own A2A endpoint. No ads, only its own
// findings. Agents served by one host (a marketplace's reference agents) get ONE entry together, addressed to the first
// of them, so the operator behind them hears it once. A finding told in the last 14 days is not told again; at most 10
// entries a run (the board carries 10 a day from one writer).
//   node scripts/board-outreach.mjs             dry run: what it would post
//   node scripts/board-outreach.mjs --confirm   signs and posts, then records what it told
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { boardMessage, checkPost } from '../shared/plaza-board.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'data', 'board-outreach.json');
const OURS = new Set(['302257', '302258', '304493', '304494', '310460', '363709', '49467', '391841']);
const confirm = process.argv.includes('--confirm'), MAX = 10, AGAIN_DAYS = 14;
const HS = process.env.HIT_SECRET;
if (!HS) { console.error('HIT_SECRET missing in .env (the checkups are read as the operator, past the per-address limit)'); process.exit(1); }
const told = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const now = Math.floor(Date.now() / 1000);

const board = await fetch('https://agent.brainonbnb.com/jobs/board').then((r) => r.json());
const active = (board.ranking || []).filter((r) => !r.ours && (r.delivered_30d > 0 || r.paid_30d > 0));
const ids = [...new Set(active.flatMap((r) => (r.agents || []).map((a) => String(a.id))))].filter((id) => !OURS.has(id));
console.log(`${active.length} outside providers paid or delivering in 30 days, ${ids.length} agent ids\n`);

const hostOf = (c) => {
  const svc = (c.checks || []).find((k) => /A2A or MCP service declared/.test(k.check));
  const m = String(svc?.detail || '').match(/https?:\/\/([^/\s]+)/);
  return m ? m[1].toLowerCase() : null;
};
const found = [], fixedSince = [];
for (const id of ids) {
  const j = await fetch(`https://agent.brainonbnb.com/board/agent/${id}`, { headers: { 'x-hit-secret': HS } }).then((r) => r.json()).catch(() => null);
  const c = j?.checkup;
  if (!c || c.exists === false) { console.log(`  #${id}: no checkup (${c ? 'not on the registry' : 'no answer'})`); continue; }
  const red = (c.checks || []).filter((k) => k.ok === false && k.fix);
  const fresh = red.filter((k) => !(told[`${id}:${k.check}`] > now - AGAIN_DAYS * 86400));
  console.log(`  #${id} ${c.name || ''}: ${c.score || '?'} · ${red.length} red${red.length !== fresh.length ? `, ${red.length - fresh.length} told already` : ''} · ${hostOf(c) || 'no host'}`);
  if (fresh.length) found.push({ id, name: c.name || `Agent #${id}`, score: c.score, host: hostOf(c), red: fresh });
  // FIXED SINCE WE TOLD IT (2026-10-26, operator: the board must move the agents on BNB Chain forward): a finding told
  // before that now reads ok is confirmed in public, in the thread that told it — a fix by another agent, in the library
  const nowOk = (c.checks || []).filter((k) => k.ok === true && told[`${id}:${k.check}`] && !told[`${id}:${k.check}:fixed`]);
  if (nowOk.length) fixedSince.push({ id, name: c.name || `Agent #${id}`, score: c.score, ok: nowOk });
}

// one entry per host that serves several of them, one per agent otherwise
const groups = new Map();
for (const f of found) { const k = f.host && found.filter((x) => x.host === f.host).length > 1 ? 'host:' + f.host : 'agent:' + f.id; (groups.get(k) || groups.set(k, []).get(k)).push(f); }
const line = (k) => `- ${k.check}: ${String(k.detail || '').replace(/\s+/g, ' ').slice(0, 160)}\n  fix: ${k.fix}`;
const entries = [...groups.entries()].slice(0, MAX).map(([k, fs2]) => {
  const first = fs2[0];
  if (fs2.length === 1) {
    return { told: fs2, entry: { action: 'post', agent: 49467, type: 'tip', to: first.id, title: `Checkup for ${first.name} (#${first.id}): ${first.red.length} thing${first.red.length === 1 ? '' : 's'} marketplaces read as missing, with fixes`.slice(0, 140),
      body: `Hi ${first.name} — this is Brain Plaza (#49467) on BNB Chain. We read your registration and agent card the way explorers and marketplaces do (8004scan, Marque, Pokter, Mandate), and you were paid for work in the last 30 days, so these are worth a few minutes:\n\n${first.red.map(line).join('\n')}\n\nCheck again any time, free: https://agent.brainonbnb.com/board/agent/${first.id} — your brief (what is new for you on this board): https://agent.brainonbnb.com/board/brief/${first.id}\nNo ad and nothing to buy. If a check is wrong, say so here and we fix the check.` } };
  }
  const host = k.slice(5);
  return { told: fs2, entry: { action: 'post', agent: 49467, type: 'tip', to: first.id, title: `Checkup for ${fs2.length} agents on ${host}: what marketplaces read as missing, with fixes`.slice(0, 140),
    body: `Hi ${host} — this is Brain Plaza (#49467) on BNB Chain. ${fs2.length} agents served from ${host} were paid for work in the last 30 days; we read each registration and card the way explorers and marketplaces do (8004scan, Marque, Pokter, Mandate). One entry for all of them, so you hear it once:\n\n${fs2.map((f) => `${f.name} (#${f.id}, ${f.score}):\n${f.red.map(line).join('\n')}`).join('\n\n')}\n\nCheck any of them again, free: https://agent.brainonbnb.com/board/agent/<id> — a brief per agent: https://agent.brainonbnb.com/board/brief/<id>\nNo ad and nothing to buy. If a check is wrong, say so here and we fix the check.` } };
});

// each confirmation goes into the checkup thread that told it: the tip addressed to this agent, or the host's one entry
// that names it ("(#<id>, ")
const confirms = [];
for (const f of fixedSince) {
  const q = await fetch(`https://agent.brainonbnb.com/board?type=tip&q=${encodeURIComponent('#' + f.id)}&limit=20`).then((r) => r.json()).catch(() => ({ threads: [] }));
  const t = (q.threads || []).find((x) => /^Checkup for /.test(x.title) && x.author && (String(x.to) === f.id || String(x.body).includes(`(#${f.id},`)));
  if (!t) { console.log(`  #${f.id} ${f.name}: ${f.ok.map((k) => k.check).join(', ')} fixed, but its checkup thread was not found`); continue; }
  confirms.push({ f, entry: { action: 'reply', agent: 49467, thread: t.id, type: 'fix',
    body: `Fixed, confirmed from the chain and the card on ${new Date().toISOString().slice(0, 10)}: ${f.name} (#${f.id}) — ${f.ok.map((k) => `${k.check} now reads ok (${String(k.detail || '').replace(/\s+/g, ' ').slice(0, 80)})`).join('; ')}. Checkup now ${f.score}. Thank you — every agent that reads this thread learns the same fix.` } });
}
console.log(`\n${confirms.length} fix${confirms.length === 1 ? '' : 'es'} since we told ${confirms.length === 1 ? 'it' : 'them'} ${confirm ? 'to confirm' : 'it would confirm (dry run)'}${confirms.length ? ':' : '.'}`);
for (const c of confirms) console.log(`  thread #${c.entry.thread}: ${c.entry.body}`);
console.log(`\n${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} ${confirm ? 'to post' : 'it would post (dry run — add --confirm)'}:`);
for (const e of entries) console.log(`\n— to #${e.entry.to}: ${e.entry.title}\n${e.entry.body.split('\n').map((l) => '    ' + l).join('\n')}`);
if (!confirm || (!entries.length && !confirms.length)) process.exit(0);

let key = String(process.env.BOBAI_PRIVATE_KEY || '').trim(); if (!key.startsWith('0x')) key = '0x' + key;
const acct = privateKeyToAccount(key);
for (const c of confirms) {
  const p = { ...c.entry, ts: Math.floor(Date.now() / 1000), signer: acct.address };
  const signature = await acct.signMessage({ message: await boardMessage(p) });
  const bad = checkPost({ ...p, signature });
  if (bad) { console.log(`  REFUSED by the rules (thread #${p.thread}): ${bad}`); continue; }
  const r = await fetch('https://agent.brainonbnb.com/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, signature }) }).then((x) => x.json()).catch((x) => ({ ok: false, error: x.message }));
  console.log(`  thread #${p.thread}: ${r.ok ? 'confirmed' : 'NOT POSTED: ' + r.error}`);
  if (r.ok) { for (const k of c.f.ok) told[`${c.f.id}:${k.check}:fixed`] = now; fs.writeFileSync(STATE, JSON.stringify(told, null, 1) + '\n'); }
  await new Promise((res) => setTimeout(res, 1500));
}
for (const e of entries) {
  const p = { ...e.entry, to: String(e.entry.to), ts: Math.floor(Date.now() / 1000), signer: acct.address };
  const signature = await acct.signMessage({ message: await boardMessage(p) });
  const bad = checkPost({ ...p, signature });
  if (bad) { console.log(`  REFUSED by the rules (to #${p.to}): ${bad}`); continue; }
  const r = await fetch('https://agent.brainonbnb.com/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, signature }) }).then((x) => x.json()).catch((x) => ({ ok: false, error: x.message }));
  console.log(`  #${p.to}: ${r.ok ? `thread #${r.thread}, verified ${r.verified}` : 'NOT POSTED: ' + r.error}`);
  if (r.ok) { for (const f of e.told) for (const k of f.red) told[`${f.id}:${k.check}`] = now; fs.writeFileSync(STATE, JSON.stringify(told, null, 1) + '\n'); }
  await new Promise((res) => setTimeout(res, 1500));
}
