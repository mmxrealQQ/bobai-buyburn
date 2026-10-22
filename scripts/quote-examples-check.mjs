#!/usr/bin/env node
// Every card's example brief is quoted and signed by its own agent (2026-10-22). Pokter asks each agent for a price
// from its card's examples and treats a skill called "Negotiate an ERC-8183 job" as plumbing; with no examples the
// rebalancer (#304494) and the fee tier agent (#310460) were sent briefs they could not quote and Pokter marked them
// seller-declined. Held against, for each of the six cards: the priced skill is named for the work, it carries an
// example, and that example sent as the brief comes back as a quote signed by the agentWallet the registry names.
// usage: node scripts/quote-examples-check.mjs [origin]
const origin = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const AGENTS = { 'health-factor': 302257, 'grid-trader': 302258, 'yield-optimizer': 304493, rebalancer: 304494, 'lp-placement': 310460, 'defi-agent': 363709 };
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const walletOf = async (id) => { const r = await fetch('https://bsc-dataseed1.defibit.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: '0x00339509' + BigInt(id).toString(16).padStart(64, '0') }, 'latest'] }) }).then((x) => x.json()).catch(() => ({})); return r.result ? '0x' + r.result.slice(26, 66) : null; };
for (const [slug, id] of Object.entries(AGENTS)) {
  const card = await fetch(`${origin}/${slug}/.well-known/agent-card.json?r=${Date.now()}`).then((r) => r.json()).catch(() => null);
  const sk = (card?.skills || []).find((k) => k.id === 'negotiate-erc8183-job');
  const ex = sk?.examples?.[0];
  say(!!sk && !/^negotiate an erc-8183 job$/i.test(sk.name || '') && !!ex, `#${id} ${slug}: priced skill "${sk?.name}" with an example${ex ? ': "' + String(ex).slice(0, 70) + '…"' : ''}`);
  if (!ex) continue;
  const [r, wallet] = await Promise.all([fetch(`${origin}/${slug}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: 'ex-' + Date.now(), parts: [{ kind: 'data', data: { skill: 'negotiate-erc8183-job', task_description: ex, terms: { deliverables: 'A JSON plan', quality_standards: 'Read-only analysis only.' }, chain_id: 56 } }] } } }) }).then((x) => x.json()).catch(() => null), walletOf(id)]);
  const d = r?.result?.parts?.[0]?.data || {};
  say(/^0x[0-9a-f]{130}$/i.test(d.provider_sig || '') && String(d.provider_address || '').toLowerCase() === String(wallet).toLowerCase(), `#${id} ${slug}: its example is quoted, signed by ${d.provider_address || '—'} (agentWallet ${wallet})${d.reason ? ' · ' + d.reason : ''}`);
}
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
