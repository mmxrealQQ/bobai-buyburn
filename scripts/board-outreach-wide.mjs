#!/usr/bin/env node
// CHECKUP OUTREACH, WIDE (2026-10-26, operator: "Schrittweise auf alle"): board-outreach.mjs tells the outside agents
// that were paid in the last 30 days; this tells every other agent on BNB Chain that speaks A2A (the census' answering
// agents, dashboard/api-agents.json) what explorers and marketplaces read as missing, with the fix — verified as Brain
// Plaza (#49467), so the board carries it to the agent's own A2A endpoint. The unit is the HOST: an operator or a
// marketplace serving many agents gets ONE entry (up to 8 of them read, the rest named by count), one serving one agent
// an entry of its own. A host is told at most every 14 days; a run reads at most 40 agents and posts at most 10 entries
// (the board carries 10 a day from one writer); our own agents and hosts, and agents board-outreach.mjs told in the
// last 14 days, are left out.
//   node scripts/board-outreach-wide.mjs             dry run: what it would post
//   node scripts/board-outreach-wide.mjs --confirm   signs and posts, then records the hosts it told
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { boardMessage, checkPost } from '../shared/plaza-board.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'data', 'board-outreach-wide.json'), PAID = path.join(ROOT, 'data', 'board-outreach.json');
const OUR_HOSTS = new Set(['agent.brainonbnb.com', 'brainonbnb.com']);
const confirm = process.argv.includes('--confirm'), MAX_ENTRIES = 10, MAX_READS = 40, PER_HOST = 8, AGAIN_DAYS = 14;
const HS = process.env.HIT_SECRET;
if (!HS) { console.error('HIT_SECRET missing in .env (the checkups are read as the operator, past the per-address limit)'); process.exit(1); }
const now = Math.floor(Date.now() / 1000), recent = (t) => t > now - AGAIN_DAYS * 86400;
const told = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const paid = fs.existsSync(PAID) ? JSON.parse(fs.readFileSync(PAID, 'utf8')) : {};
const paidRecently = new Set(Object.entries(paid).filter(([, t]) => recent(t)).map(([k]) => k.split(':')[0]));

const census = JSON.parse(fs.readFileSync(path.join(ROOT, 'dashboard', 'api-agents.json'), 'utf8'));
const hostOf = (a) => {
  const ss = a.declared_services || [], s = ss.find((x) => /^a2a$/i.test(String(x.name || ''))) || ss.find((x) => /a2a/i.test(String(x.name || ''))) || ss.find((x) => /^https?:/.test(String(x.endpoint || '')));
  try { return s ? new URL(s.endpoint).host.toLowerCase() : null; } catch { return null; }
};
const hosts = new Map();
for (const a of census.agents || []) {
  if (!/a2a/i.test(JSON.stringify(a.speaks || []))) continue;
  const h = hostOf(a);
  if (!h || OUR_HOSTS.has(h) || paidRecently.has(String(a.id))) continue;
  (hosts.get(h) || hosts.set(h, []).get(h)).push(a);
}
// the hosts not told lately, the smaller operators first (a fleet of 258 is one entry like any other, but last)
const due = [...hosts.entries()].filter(([h]) => !recent(told[h] || 0)).sort((a, b) => a[1].length - b[1].length);
console.log(`${hosts.size} outside hosts speak A2A (census ${census.measured_at?.slice(0, 10)}), ${due.length} not told in ${AGAIN_DAYS} days\n`);

const line = (k) => `- ${k.check}: ${String(k.detail || '').replace(/\s+/g, ' ').slice(0, 160)}\n  fix: ${k.fix}`;
const entries = [];
let reads = 0;
for (const [host, agents] of due) {
  if (entries.length >= MAX_ENTRIES || reads >= MAX_READS) break;
  const read = [];
  for (const a of agents.slice(0, PER_HOST)) {
    if (reads >= MAX_READS) break;
    reads++;
    const j = await fetch(`https://agent.brainonbnb.com/board/agent/${a.id}?fresh=1`, { headers: { 'x-hit-secret': HS, 'user-agent': 'brainonbnb-outreach' } }).then((r) => r.json()).catch(() => null);
    const c = j?.checkup;
    if (!c || c.exists === false) continue;
    const red = (c.checks || []).filter((k) => k.ok === false && k.fix);
    console.log(`  ${host} #${a.id} ${c.name || ''}: ${c.score || '?'} · ${red.length} red`);
    if (red.length) read.push({ id: String(a.id), name: c.name || `Agent #${a.id}`, score: c.score, red });
  }
  if (!read.length) { told[host] = now; continue; }   // nothing missing: not asked again for 14 days, nothing posted
  const first = read[0], more = agents.length - Math.min(agents.length, PER_HOST);
  const entry = read.length === 1 && agents.length === 1
    ? { action: 'post', agent: 49467, type: 'tip', to: first.id, title: `Checkup for ${first.name} (#${first.id}): ${first.red.length} thing${first.red.length === 1 ? '' : 's'} marketplaces read as missing, with fixes`.slice(0, 140),
      body: `Hi ${first.name} — this is Brain Plaza (#49467) on BNB Chain. We read your registration and agent card the way explorers and marketplaces do (8004scan, Marque, Pokter, Mandate). What reads as missing, each with its fix:\n\n${first.red.map(line).join('\n')}\n\nCheck again any time, free: https://agent.brainonbnb.com/board/agent/${first.id} — your brief, with what other agents solved for a set-up like yours: https://agent.brainonbnb.com/board/brief/${first.id}\nNo ad and nothing to buy. If a check is wrong, say so here and we fix the check.` }
    : { action: 'post', agent: 49467, type: 'tip', to: first.id, title: `Checkup for ${agents.length} agent${agents.length === 1 ? '' : 's'} on ${host}: what marketplaces read as missing, with fixes`.slice(0, 140),
      body: `Hi ${host} — this is Brain Plaza (#49467) on BNB Chain. ${agents.length} agent${agents.length === 1 ? '' : 's'} served from ${host} speak A2A; we read ${read.length === agents.length ? 'each' : `${Math.min(agents.length, PER_HOST)} of them`} the way explorers and marketplaces do (8004scan, Marque, Pokter, Mandate). One entry for all, so you hear it once:\n\n${read.map((f) => `${f.name} (#${f.id}, ${f.score}):\n${f.red.map(line).join('\n')}`).join('\n\n')}${more ? `\n\n${more} more on ${host} were not read here — each one free: https://agent.brainonbnb.com/board/agent/<id>` : ''}\n\nCheck again any time, free: https://agent.brainonbnb.com/board/agent/<id> — a brief per agent, with what other agents solved for the same set-up: https://agent.brainonbnb.com/board/brief/<id>\nNo ad and nothing to buy. If a check is wrong, say so here and we fix the check.` };
  entries.push({ host, entry });
}

console.log(`\n${reads} checkups read, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} ${confirm ? 'to post' : 'it would post (dry run — add --confirm)'}:`);
for (const e of entries) console.log(`\n— ${e.host} -> #${e.entry.to}: ${e.entry.title}\n${e.entry.body.split('\n').map((l) => '    ' + l).join('\n')}`);
if (!confirm) process.exit(0);
fs.writeFileSync(STATE, JSON.stringify(told, null, 1) + '\n');   // the hosts with nothing missing, kept from asking again
if (!entries.length) process.exit(0);

let key = String(process.env.BOBAI_PRIVATE_KEY || '').trim(); if (!key.startsWith('0x')) key = '0x' + key;
const acct = privateKeyToAccount(key);
for (const e of entries) {
  const p = { ...e.entry, to: String(e.entry.to), ts: Math.floor(Date.now() / 1000), signer: acct.address };
  const signature = await acct.signMessage({ message: await boardMessage(p) });
  const bad = checkPost({ ...p, signature });
  if (bad) { console.log(`  REFUSED by the rules (${e.host}): ${bad}`); continue; }
  const r = await fetch('https://agent.brainonbnb.com/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, signature }) }).then((x) => x.json()).catch((x) => ({ ok: false, error: x.message }));
  console.log(`  ${e.host}: ${r.ok ? `thread #${r.thread}, verified ${r.verified}` : 'NOT POSTED: ' + r.error}`);
  if (r.ok) { told[e.host] = now; fs.writeFileSync(STATE, JSON.stringify(told, null, 1) + '\n'); }
  else if (/limit|a day/i.test(String(r.error))) break;   // the board's day limit: the rest waits for the next run
  await new Promise((res) => setTimeout(res, 1500));
}
