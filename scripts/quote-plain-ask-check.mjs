#!/usr/bin/env node
// A plain price request on the shared endpoint is quoted (2026-10-24, operator's go: "beide beheben"). #49467's card
// points at agent.brainonbnb.com/a2a, which sells five services; Pokter's "Quote your standard deliverable so a buyer can
// see the price before hiring" names none and was declined ("We do not sell that"), which Pokter marks seller-declined
// and the Brain Board checkup listed under TO FIX. Now:
//   nothing named   -> accepted, signed by the health factor agent's wallet, the terms say "No service was named" and
//                      list the others
//   a service named -> that service, without the sentence
//   a service field naming nothing we sell -> still declined (no guess over an explicit wrong name)
// usage: node scripts/quote-plain-ask-check.mjs [origin]   exit 1 on any FAIL
const origin = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const ask = (data) => fetch(`${origin}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: crypto.randomUUID(), parts: [{ kind: 'data', data: { skill: 'negotiate-erc8183-job', terms: { deliverables: 'Your standard deliverable.', quality_standards: 'As described on your card.' }, chain_id: 56, ...data } }] } } }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const env = (j) => { const p = j?.result?.parts || []; return p.find((x) => x.kind === 'data')?.data || {}; };
const acc = (d) => d?.response?.accepted ?? d?.accepted;
const deliv = (d) => String(d?.response?.terms?.deliverables || '');
const walletOf = async (id) => { const r = await fetch('https://bsc-dataseed1.defibit.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: '0x00339509' + BigInt(id).toString(16).padStart(64, '0') }, 'latest'] }) }).then((x) => x.json()).catch(() => ({})); return r.result ? '0x' + r.result.slice(26, 66) : null; };
let bad = 0;
const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const hfWallet = await walletOf(302257);
const plain = env(await ask({ task_description: 'Quote your standard deliverable so a buyer can see the price before hiring.' }));
say(acc(plain) === true && /^0x[0-9a-f]{130}$/i.test(plain.provider_sig || ''), `nothing named: quoted and signed (${acc(plain) === false ? 'declined: ' + String(plain.reason).slice(0, 70) : 'accepted'})`);
say(String(plain.provider_address || '').toLowerCase() === String(hfWallet).toLowerCase(), `nothing named: signed by the health factor agent's wallet ${hfWallet} (got ${plain.provider_address || '—'})`);
say(/No service was named/.test(deliv(plain)) && /grid_plan, yield_plan, rebalance_plan, lp_tier_plan/.test(deliv(plain)), 'nothing named: the signed terms say so and list the others');
const grid = env(await ask({ task_description: 'Plan a grid for token 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 on BNB Chain.' }));
say(acc(grid) === true && /service grid_plan/.test(deliv(grid)) && !/No service was named/.test(deliv(grid)), 'a grid brief: quoted as grid_plan, without the sentence');
const wrong = env(await ask({ task_description: 'Quote this.', service: 'tarot_reading' }));
say(acc(wrong) === false, 'a service field naming nothing we sell: still declined');
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
