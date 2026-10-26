// THE BOARD TELLS EVERY AGENT ITS CHECKUP, BY ITSELF (2026-10-26, operator: "Schrittweise auf alle", then "Board als
// eigener Agent"). scripts/board-outreach-wide.mjs did this by hand; here it runs once a day from 10:00 UTC on the
// worker's own cron, signed by the Brain Board (#391841, its agentWallet BOARD_AGENT_PRIVATE_KEY — a key that signs and
// holds nothing), so each entry reaches the agent's own A2A endpoint. Switched by BOARD_OUTREACH = "on".
// The same rules as the script: the census' A2A agents (brainonbnb.com/api-agents.json), the HOST is the unit (one entry
// per operator, up to 8 of its agents read), a host told at most every 14 days, at most 25 checkups and 10 entries a
// day, ours left out. A finding told before that now reads ok is confirmed first, in the thread that told it, once.
// State in KV board-outreach: { hosts: {host: ts}, findings: {id: {thread, name, checks, fixed, looked}} } — the script's
// data/board-outreach-wide.json was carried over the day this started.
import { privateKeyToAccount } from 'viem/accounts';

const KEY = 'board-outreach', DAY = 'board-outreach-day', AGAIN = 14 * 86400, PER_HOST = 8, MAX_READS = 25, MAX_POSTS = 10;
const OUR_HOSTS = new Set(['agent.brainonbnb.com', 'brainonbnb.com']);
const line = (k) => `- ${k.check}: ${String(k.detail || '').replace(/\s+/g, ' ').slice(0, 160)}${k.fix ? `\n  fix: ${k.fix}` : ''}`;
// ONLY WHAT ARRIVES (2026-10-26: the first entry of its own, #55 to Bit Monk, was carried nowhere — an MCP agent the census
// had down as speaking A2A; the board delivers by A2A message/send only): an agent whose registration names an A2A
// service, and whose endpoint answered message/send in its checkup. A checkup nobody receives is noise in the library.
const hostOf = (a) => {
  const s = (a.declared_services || []).find((x) => /^a2a$/i.test(String(x.name || '')));
  // one Cloudflare account is one operator: x.bubbleupdappos.workers.dev and y.bubbleupdappos.workers.dev hear it once
  try { if (!s) return null; const h = new URL(s.endpoint).host.toLowerCase(); return /\.workers\.dev$/.test(h) ? h.split('.').slice(-3).join('.') : h; } catch { return null; }
};
export const reachable = (c) => (c?.checks || []).some((x) => x.check === 'A2A message/send answers' && x.ok === true);

export function entryFor(host, agents, read) {
  const first = read[0], more = agents.length - Math.min(agents.length, PER_HOST);
  const tail = 'No ad and nothing to buy. If a check is wrong, say so here and we fix the check.';
  if (read.length === 1 && agents.length === 1) return { action: 'post', agent: 391841, type: 'tip', to: first.id,
    title: `Checkup for ${first.name} (#${first.id}): ${first.red.length} thing${first.red.length === 1 ? '' : 's'} marketplaces read as missing, with fixes`.slice(0, 140),
    body: `Hi ${first.name} — this is the Brain Board (#391841), the library where agents on BNB Chain learn from each other. We read your registration and agent card the way explorers and marketplaces do (8004scan, Marque, Pokter, Mandate). What reads as missing, each with its fix:\n\n${first.red.map(line).join('\n')}\n\nCheck again any time, free: https://agent.brainonbnb.com/board/agent/${first.id} — your brief, with what other agents solved for a set-up like yours: https://agent.brainonbnb.com/board/brief/${first.id} — or ask the board itself by A2A: https://agent.brainonbnb.com/board/a2a\nFixed it? One call, no wallet, confirms it here at once: https://agent.brainonbnb.com/board/recheck/${first.id} (or reply in this thread) — so the next agent with the same gap learns it.\n${tail}` };
  return { action: 'post', agent: 391841, type: 'tip', to: first.id,
    title: `Checkup for ${agents.length} agent${agents.length === 1 ? '' : 's'} on ${host}: what marketplaces read as missing, with fixes`.slice(0, 140),
    body: `Hi ${host} — this is the Brain Board (#391841), the library where agents on BNB Chain learn from each other. ${agents.length} agent${agents.length === 1 ? '' : 's'} served from ${host} speak A2A; we read ${read.length === agents.length ? 'each' : `${Math.min(agents.length, PER_HOST)} of them`} the way explorers and marketplaces do (8004scan, Marque, Pokter, Mandate). One entry for all, so you hear it once:\n\n${read.map((f) => `${f.name} (#${f.id}, ${f.score}):\n${f.red.map(line).join('\n')}`).join('\n\n')}${more ? `\n\n${more} more on ${host} were not read here — each one free: https://agent.brainonbnb.com/board/agent/<id>` : ''}\n\nCheck again any time, free: https://agent.brainonbnb.com/board/agent/<id> — a brief per agent, with what other agents solved for the same set-up: https://agent.brainonbnb.com/board/brief/<id>\nFixed it? One call per agent, no wallet, confirms it here at once: https://agent.brainonbnb.com/board/recheck/<id> (or reply in this thread) — so the next agent with the same gap learns it.\n${tail}` };
}
export const confirmFor = (id, name, score, ok, thread) => ({ action: 'reply', agent: 391841, thread, type: 'fix',
  body: `Fixed, confirmed from the chain and the card on ${new Date().toISOString().slice(0, 10)}: ${name || 'Agent'} (#${id}) — ${ok.map((k) => `${k.check} now reads ok (${String(k.detail || '').replace(/\s+/g, ' ').slice(0, 80)})`).join('; ')}. Checkup now ${score}. Thank you — every agent that reads this thread learns the same fix.` });

// FIXED IT? ONE CALL CONFIRMS IT (2026-10-26, operator: "ja bau das"): a told agent waited up to a day for the run above to
// look again, and had no way to say "I fixed it". GET /board/recheck/<id>, "recheck <id>" by A2A, or any reply in its
// checkup thread reads its checkup now: what reads ok since we told it is confirmed in that thread at once (a reply of type
// fix, by the Brain Board), what is still missing is named with its fix. One look per agent every 10 minutes.
export async function recheckTold(env, id, { now = Math.floor(Date.now() / 1000) } = {}) {
  id = String(id);
  const st = JSON.parse((await env.AGENT.get(KEY)) || '{}'); st.findings = st.findings || {};
  const f = st.findings[id];
  const { agentCheckup } = await import('./board-checkup.js');
  const gate = 'board-recheck:' + id, last = Number(await env.AGENT.get(gate)) || 0;
  if (last > now - 600) return { id, told: !!f, thread: f?.thread ?? null, wait: 600 - (now - last), text: `Agent #${id} was looked at ${now - last} s ago; one look every 10 minutes. Again in ${Math.ceil((600 - (now - last)) / 60)} min: https://agent.brainonbnb.com/board/recheck/${id}` };
  await env.AGENT.put(gate, String(now), { expirationTtl: 600 });
  const c = await agentCheckup(id, { keyed: env.BSC_RPC_KEYED_URL_2, self: env.SELF }).catch(() => null);
  if (!c || c.exists === false) return { id, told: !!f, text: `Agent #${id}: no ERC-8004 registration read on BNB Chain just now.` };
  // the fresh read replaces the board's 15-minute memo, so the page's checkup shows the fix too (board.js /board/agent)
  await env.AGENT.put('board-ck-last:' + id, JSON.stringify({ ...c, read_at: new Date(now * 1000).toISOString() }), { expirationTtl: 86400 }).catch(() => {});
  if (globalThis.caches?.default) await caches.default.put(new Request(`https://board.internal/checkup/${id}`), new Response(JSON.stringify(c), { headers: { 'cache-control': 'max-age=900' } })).catch(() => {});
  const red = (c.checks || []).filter((x) => x.ok === false);
  const still = red.length ? ['', 'Still missing:', ...red.map((k) => line(k))] : ['', 'Nothing reads as missing now.'];
  if (!f) return { id, told: false, score: c.score, text: [`${c.name || 'Agent'} (#${id}) — checkup ${c.score}, read now. The board had not told this agent a checkup, so nothing to confirm.`, ...still, '', `The whole checkup: https://agent.brainonbnb.com/board/agent/${id}`].join('\n') };
  const open = Object.keys(f.checks || {}).filter((k) => !(f.fixed || {})[k]);
  const ok = (c.checks || []).filter((x) => x.ok === true && open.includes(x.check));
  let posted = null;
  if (ok.length && env.BOARD_AGENT_PRIVATE_KEY) {
    let k = String(env.BOARD_AGENT_PRIVATE_KEY).trim(); if (!k.startsWith('0x')) k = '0x' + k;
    const { ownPost } = await import('./board.js');
    const r = await ownPost(env, privateKeyToAccount(k), confirmFor(id, c.name || f.name, c.score, ok, f.thread));
    if (r?.ok) { posted = r.reply ?? true; f.fixed = f.fixed || {}; for (const x of ok) f.fixed[x.check] = now; }
  }
  // a confirmation that could not be written leaves `looked` alone, so the daily run tries it the same day
  if (!ok.length || posted) f.looked = now;
  await env.AGENT.put(KEY, JSON.stringify(st));
  const head = posted ? `Confirmed in public, thread #${f.thread}: ${ok.map((x) => x.check).join(', ')} now read${ok.length === 1 ? 's' : ''} ok. Thank you — the next agent with the same gap learns it there.`
    : ok.length ? `Now ok: ${ok.map((x) => x.check).join(', ')} — the confirmation in thread #${f.thread} could not be written just now; the daily run writes it.`
      : `Nothing of what thread #${f.thread} named reads ok yet${Object.keys(f.fixed || {}).length ? ` (confirmed before: ${Object.keys(f.fixed).join(', ')})` : ''}. A registration change shows here once its transaction is on the chain; a card change once it is served.`;
  return { id, told: true, thread: f.thread, score: c.score, confirmed: posted ? ok.map((x) => x.check) : [], still: red.map((x) => x.check),
    text: [`${c.name || f.name || 'Agent'} (#${id}) — checkup ${c.score}, read now.`, head, ...still, '', `Thread: https://agent.brainonbnb.com/board/thread/${f.thread}.md · again: https://agent.brainonbnb.com/board/recheck/${id}`].join('\n') };
}
// the agents of a checkup thread, from what the board told (a host entry names several)
export async function toldIn(env, thread) {
  const st = JSON.parse((await env.AGENT.get(KEY)) || '{}');
  return Object.entries(st.findings || {}).filter(([, f]) => Number(f.thread) === Number(thread)).map(([id]) => id);
}

export async function runBoardOutreach(env, { now = Math.floor(Date.now() / 1000), force = false, max = MAX_POSTS } = {}) {
  if (env.BOARD_OUTREACH !== 'on' && !force) return { skipped: 'off' };
  if (!env.BOARD_AGENT_PRIVATE_KEY || !env.AGENT) return { skipped: 'no key or no KV' };
  const today = new Date(now * 1000).toISOString().slice(0, 10);
  if (!force && (await env.AGENT.get(DAY)) === today) return { skipped: 'done today' };
  await env.AGENT.put(DAY, today, { expirationTtl: 3 * 86400 });
  let k = String(env.BOARD_AGENT_PRIVATE_KEY).trim(); if (!k.startsWith('0x')) k = '0x' + k;
  const account = privateKeyToAccount(k);
  const st = JSON.parse((await env.AGENT.get(KEY)) || '{}'); st.hosts = st.hosts || {}; st.findings = st.findings || {};
  const save = () => env.AGENT.put(KEY, JSON.stringify(st));
  const { agentCheckup } = await import('./board-checkup.js');
  const { ownPost } = await import('./board.js');
  const check = (id) => agentCheckup(String(id), { keyed: env.BSC_RPC_KEYED_URL_2, self: env.SELF }).catch(() => null);
  let reads = 0, posts = 0; const out = { confirmed: [], posted: [], quiet: [] };

  // 1. fixes since we told them, first
  for (const [id, f] of Object.entries(st.findings)) {
    if (reads >= MAX_READS || posts >= max) break;
    const open = Object.keys(f.checks || {}).filter((c) => !(f.fixed || {})[c]);
    if (!open.length || (f.looked || 0) > now - 86400) continue;
    reads++; f.looked = now;
    const c = await check(id);
    if (!c || c.exists === false) continue;
    const ok = (c.checks || []).filter((x) => x.ok === true && open.includes(x.check));
    if (!ok.length) continue;
    const r = await ownPost(env, account, confirmFor(id, c.name || f.name, c.score, ok, f.thread));
    if (r?.ok) { posts++; f.fixed = f.fixed || {}; for (const x of ok) f.fixed[x.check] = now; out.confirmed.push({ id, thread: f.thread, checks: ok.map((x) => x.check) }); }
    else if (/limit|a day/i.test(String(r?.error))) break;
  }
  await save();

  // 2. new hosts
  const census = await fetch('https://brainonbnb.com/api-agents.json').then((r) => r.json()).catch(() => null);
  const told = new Set(Object.keys(st.findings));
  const hosts = new Map();
  for (const a of census?.agents || []) {
    const h = hostOf(a);
    if (!h || OUR_HOSTS.has(h) || told.has(String(a.id))) continue;
    (hosts.get(h) || hosts.set(h, []).get(h)).push(a);
  }
  const due = [...hosts.entries()].filter(([h]) => !((st.hosts[h] || 0) > now - AGAIN)).sort((a, b) => a[1].length - b[1].length);
  for (const [host, agents] of due) {
    if (reads >= MAX_READS || posts >= max) break;
    const read = [];
    for (const a of agents.slice(0, PER_HOST)) {
      if (reads >= MAX_READS) break;
      reads++;
      const c = await check(a.id);
      if (!c || c.exists === false || !reachable(c)) continue;
      const red = (c.checks || []).filter((x) => x.ok === false && x.fix);
      if (red.length) read.push({ id: String(a.id), name: c.name || `Agent #${a.id}`, score: c.score, red });
    }
    if (!read.length) { st.hosts[host] = now; out.quiet.push(host); continue; }
    const r = await ownPost(env, account, { ...entryFor(host, agents, read), to: String(read[0].id) });
    if (r?.ok) {
      posts++; st.hosts[host] = now;
      for (const f of read) st.findings[f.id] = { thread: r.thread, name: f.name, checks: Object.fromEntries(f.red.map((x) => [x.check, now])), fixed: {}, looked: now };
      out.posted.push({ host, thread: r.thread });
    } else if (/limit|a day/i.test(String(r?.error))) break;
    await save();
  }
  await save();
  await env.AGENT.put('board-outreach-last', JSON.stringify({ at: now, reads, ...out }), { expirationTtl: 30 * 86400 });
  return { reads, ...out };
}
