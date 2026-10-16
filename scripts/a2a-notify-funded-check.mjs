// Every card of ours that takes an ERC-8183 job declares notify_funded
// (2026-10-16). Pokter hired the DeFi Agent (#363709, job 57001): the hub card
// at /a2a named notify_funded, the agent's own card did not, so the
// marketplace could not tell the agent the job was funded and it was found by
// the job watch 14 minutes later. A marketplace reads the card of the agent it
// lists, not our hub, so the skill has to be on each agent's card.
//
// Also checks that each endpoint takes the skill: a notify_funded without a
// job_id must come back as "needs job_id" (the skill is routed), never as
// "unknown skill". No job id is sent, so nothing is delivered.
//
//   node scripts/a2a-notify-funded-check.mjs [origin]

const ORIGIN = process.argv[2] || 'https://agent.brainonbnb.com';
const AGENTS = ['defi-agent', 'health-factor', 'grid-trader', 'yield-optimizer', 'rebalancer', 'lp-placement'];

let pass = 0, fail = 0;
const ok = (cond, what) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`); };

async function card(path) {
  const r = await fetch(`${ORIGIN}${path}`, { headers: { accept: 'application/json' } });
  return r.ok ? r.json() : null;
}

async function send(path, data) {
  const r = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { kind: 'message', role: 'user', messageId: 'notify-funded-check', parts: [{ kind: 'data', data }] } } }),
  });
  return r.json().catch(() => null);
}

for (const slug of [...AGENTS, null]) {
  const base = slug ? `/${slug}/a2a` : '/a2a';
  for (const p of [`${base}/.well-known/agent-card.json`, ...(slug ? [base] : [])]) {
    const j = await card(p);
    const skill = j && Array.isArray(j.skills) && j.skills.find((s) => s && s.id === 'notify_funded');
    ok(!!skill, `${p} declares notify_funded`);
    if (skill) ok(/job_id/.test(skill.description || '') && skill.examples?.length > 0, `${p} notify_funded says how (job_id, example)`);
    // The step after funding, where the buyer reads it: the quote skill.
    const neg = j && Array.isArray(j.skills) && j.skills.find((s) => s && s.id === 'negotiate-erc8183-job');
    ok(neg && /notify_funded with the job_id/.test(neg.description || '') && !/without notify_funded\.|no further message/.test(neg.description || ''), `${p} negotiate-erc8183-job names notify_funded as the step after funding`);
  }
  const r = await send(base, { skill: 'notify_funded' });
  ok(r && r.error && /needs job_id/.test(r.error.message || ''), `POST ${base} routes notify_funded (${r?.error?.message || JSON.stringify(r).slice(0, 80)})`);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
