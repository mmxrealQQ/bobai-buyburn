// A brief that names no token is quoted for WBNB, and says so (2026-10-22, operator: "go für pokter mit WBNB wenn kein
// token"). Pokter asks every agent for a price with a generic brief; the grid planner and the fee tier agent declined it
// ("needs `token` … nothing was quoted") and Pokter showed them as not hireable. Now:
//   no token  -> accepted, signed, the deliverables say "no token was named: the plan is for WBNB"
//   a token   -> accepted, no WBNB sentence (the named token is planned)
//   the other agents are untouched (the health factor still quotes, the rebalancer still needs holdings)
// usage: node scripts/quote-no-token-check.mjs [origin]   exit 1 on any FAIL
const origin = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const ask = (slug, task) => fetch(`${origin}/${slug}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: crypto.randomUUID(), parts: [{ kind: 'data', data: { skill: 'negotiate-erc8183-job', task_description: task, terms: { deliverables: 'The plan, delivered on chain.', quality_standards: 'Figures read from BNB Chain at delivery time.' }, chain_id: 56, escrow_chains: [56] } }] } } }) }).then((r) => r.json());
const env = (j) => { const p = j?.result?.parts || j?.result?.message?.parts || []; const d = p.find((x) => x.kind === 'data')?.data || j?.result || {}; return d; };
const acc = (d) => d?.response?.accepted ?? d?.accepted;
const deliv = (d) => String(d?.response?.terms?.deliverables || '');
let bad = 0;
const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
for (const [slug, svc] of [['lp-placement', 'lp_tier_plan'], ['grid-trader', 'grid_plan']]) {
  const none = env(await ask(slug, `Plan a ${svc === 'grid_plan' ? 'grid' : 'fee tier placement'} on BNB Chain.`));
  say(acc(none) === true && !!none.provider_sig, `${slug}: a brief with no token is quoted and signed (${acc(none) === false ? 'declined: ' + String(none.reason).slice(0, 80) : 'accepted'})`);
  say(/no token was named: the plan is for WBNB/i.test(deliv(none)), `${slug}: the quote says the plan is for WBNB`);
  const named = env(await ask(slug, `Plan for token 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 on BNB Chain.`));
  say(acc(named) === true && !/plan is for WBNB/i.test(deliv(named)), `${slug}: a named token is quoted without the WBNB sentence`);
}
const hf = env(await ask('health-factor', 'Check a Venus health factor.'));
say(acc(hf) === true, 'health-factor: still quoted without an address (the paying wallet is read)');
// since 2026-10-23 (Pokter's "Quote your standard deliverable" was marked seller-declined) the rebalancer quotes a brief
// without holdings too: delivery reads the hiring wallet's holdings, and the signed terms say so
const rb = env(await ask('rebalancer', 'Price a rebalance.'));
say(acc(rb) === true && /No holdings or position were named/.test(deliv(rb)), 'rebalancer: no holdings named — quoted, and the terms say the hiring wallet\'s holdings are read');
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
