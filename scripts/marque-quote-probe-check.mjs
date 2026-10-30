#!/usr/bin/env node
// Marque's quote probe, answered by all six (2026-10-22). Marque asks each listed agent for its price with skill
// "negotiate", task "marque-quote-probe: price check for a <category> task. No job will be created from this quote",
// read off our own A2A log (a2a-seen:grid-trader, 06:10 UTC). It files #310460 and #363709 under "rebalancing"; both
// refused the probe as a rebalance meant for another agent, and Marque showed them not hireable. Held against:
//   each of the six, asked exactly as Marque asks with the category Marque gives it: accepted, a price, and the
//   provider the ERC-8004 registry names as its agentWallet (the address Marque matches the quote against);
//   the other way: a real rebalance task sent to the fee tier agent is still sent on to the rebalancer.
// usage: node scripts/marque-quote-probe-check.mjs [origin]   (default https://agent.brainonbnb.com)
import { recoverMessageAddress } from 'viem';
const origin = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const AGENTS = { 'health-factor': [302257, 'health_factor', 'health factor'], 'grid-trader': [302258, 'grid', 'grid trading'], 'yield-optimizer': [304493, 'yield', 'yield'],
  rebalancer: [304494, 'rebalancing', 'rebalancing'], 'lp-placement': [310460, 'rebalancing', 'rebalancing'], 'defi-agent': [363709, 'rebalancing', 'rebalancing'] };
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const send = (slug, data) => fetch(`${origin}/${slug}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'check', method: 'message/send', params: { message: { kind: 'message', role: 'user', messageId: 'check-' + Date.now(), parts: [{ kind: 'data', data }] } } }) })
  .then((r) => r.json()).then((j) => { const r = j.result || {}; return (r.parts ? r.parts.find((p) => p.kind === 'data')?.data : r) || { error: j.error?.message }; }).catch((e) => ({ error: e.message }));
const walletOf = async (id) => { const r = await fetch('https://bsc-dataseed1.defibit.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: '0x00339509' + BigInt(id).toString(16).padStart(64, '0') }, 'latest'] }) }).then((x) => x.json()).catch(() => ({})); return r.result ? '0x' + r.result.slice(26, 66) : null; };
for (const [slug, [id, cat, words]] of Object.entries(AGENTS)) {
  const [d, wallet] = await Promise.all([send(slug, { skill: 'negotiate', task_description: `marque-quote-probe: price check for a ${words} task. No job will be created from this quote.`, terms: { deliverables: 'price quote only', quality_standards: 'n/a', client_ref: 'marque.trade', category: cat } }), walletOf(id)]);
  const prov = String(d.provider || d.provider_address || '').toLowerCase();
  // Signed since 2026-10-30: Marque showed the six as identity_matched_unsigned beside eleven provider_signed agents.
  const signedBy = d.provider_sig && d.negotiation_hash ? await recoverMessageAddress({ message: d.negotiation_hash, signature: d.provider_sig }).catch(() => null) : null;
  say(!!wallet && String(signedBy).toLowerCase() === wallet.toLowerCase() && String(d.response?.terms?.price) === String(d.price), `#${id} ${slug}: the quote is signed by its agentWallet (${signedBy || 'no signature'}) at the price it names`);
  say(d.accepted === true && /^\d+$/.test(String(d.price || '')) && !!wallet && prov === wallet.toLowerCase(), `#${id} ${slug} (Marque: ${cat}): quoted ${d.price ?? '—'} by ${prov || '—'} · agentWallet ${wallet}${d.reason ? ' · ' + String(d.reason).slice(0, 90) : ''}${d.error ? ' · ' + d.error : ''}`);
}
const real = await send('lp-placement', { skill: 'negotiate', task_description: 'rebalance my holdings: 0x55d398326f99059fF775485246999027B3197955 600 USD, 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c 400 USD, to 50/50', terms: { deliverables: 'a rebalance plan' } });
say(real.accepted === false && /rebalancer/.test(String(real.reason || '')), `a real rebalance task to the fee tier agent is still sent on to the rebalancer: "${String(real.reason || JSON.stringify(real)).slice(0, 110)}"`);
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
