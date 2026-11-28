// agent-id-projects-regressions.mjs (2026-11-28): pins for worker-agent/agent-id-projects.js, the live count of Agent ID
// senders per contract listed in the Agent ID Book. Runs against a fake chain; no network. node scripts/agent-id-projects-regressions.mjs
import { contractsInNote, nameInNote, listingsOf, projectsTick, handleProjects, OWN } from '../worker-agent/agent-id-projects.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };

const C1 = '0x' + '11'.repeat(20), C2 = '0x' + '22'.repeat(20), EOA = '0x' + '33'.repeat(20);
const H1 = '0x' + 'a1'.repeat(20), H2 = '0x' + 'a2'.repeat(20), NOID = '0x' + 'b0'.repeat(20);

// notes
ok('note: one contract', contractsInNote(`My Project ${C1}`).join() === C1);
ok('note: mixed case, repeats once, at most 3', contractsInNote(`${C1.toUpperCase().replace('0X', '0x')} ${C1} ${C2} ${EOA} 0x${'44'.repeat(20)}`).length === 3);
ok('note: the Agent ID contract is not a project', contractsInNote('x 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F').length === 0);
ok('note: 41 hex is not an address', contractsInNote('0x' + '1'.repeat(41)).length === 0);
ok('name: addresses taken out', nameInNote(`My Project · ${C1}`) === 'My Project');
ok('name: only an address -> null', nameInNote(C1) === null);

// listings: own always, first signer keeps a contract
const signers = { [H2]: { place: 2, note: `Copycat ${C1}`, updated_block: 20 }, [H1]: { place: 1, note: `Alpha ${C1} ${EOA}`, updated_block: 10 } };
const L = listingsOf(signers);
ok('listings: own contracts present', OWN.every((o) => L[o.contract]?.own));
ok('listings: first place keeps the contract', L[C1].by === H1 && L[C1].name === 'Alpha');
ok('listings: EOA listed (checked later)', Boolean(L[EOA]));

// fake chain
function chain({ head = 1000000, failLogsAt = null, failTx = false, logs = {} } = {}) {
  const calls = { n: 0 };
  const txFrom = { t1: H1, t2: NOID, t3: H1, t4: H2 };
  const rpc = async (body) => {
    calls.n++;
    if (Array.isArray(body)) {
      if (body[0].method === 'eth_getTransactionByHash') { if (failTx) return null; return body.map((b) => ({ id: b.id, result: { from: txFrom[b.params[0]] } })); }
      if (body[0].method === 'eth_call') return body.map((b) => { const a = '0x' + b.params[0].data.slice(-40); return { id: b.id, result: a === H1 || a === H2 ? '0x' + '0'.repeat(63) + '1' : '0x' + '0'.repeat(64) }; });
    }
    if (body.method === 'eth_blockNumber') return { result: '0x' + head.toString(16) };
    if (body.method === 'eth_getCode') return { result: body.params[0] === EOA ? '0x' : '0x6080' };
    if (body.method === 'eth_getLogs') {
      const f = body.params[0], a = parseInt(f.fromBlock, 16), b = parseInt(f.toBlock, 16);
      if (failLogsAt != null && a <= failLogsAt && failLogsAt <= b) return null;
      return { result: (logs[f.address] || []).filter((l) => l.block >= a && l.block <= b).map((l) => ({ transactionHash: l.tx, blockNumber: '0x' + l.block.toString(16) })) };
    }
    return null;
  };
  return { rpc, calls };
}
const kv = () => { const m = new Map(); return { AGENT: { get: async (k) => m.get(k) ?? null, put: async (k, v) => m.set(k, v) } }; };
const head = 1000000, HEAD_READ = head - 3;
const logs = { [C1]: [{ block: HEAD_READ - 100, tx: 't1' }, { block: HEAD_READ - 90, tx: 't2' }, { block: HEAD_READ - 80, tx: 't3' }, { block: HEAD_READ - 70, tx: 't1' }] };

{
  const env = kv(), { rpc } = chain({ head, logs });
  const r = await projectsTick(env, signers, { rpc });
  const all = await handleProjects(env, '/agent-id/projects');
  const p = all.projects.find((x) => x.contract === C1);
  ok('tick: read to head', r.ok && p.read_to_block === HEAD_READ);
  ok('tick: sender counted once (t1 twice, t3 same sender)', p.agent_id_addresses === 1 && p.senders === 2 && p.transactions === 3);
  ok('tick: EOA marked not a contract', all.projects.find((x) => x.contract === EOA)?.not_a_contract === true);
  ok('tick: starts 40,000 blocks back', p.counting_since_block === HEAD_READ - 40000 + 1);
  ok('one: holders listed', (await handleProjects(env, `/agent-id/projects/${C1}`)).agent_id_holders.join() === H1);
  ok('one: unlisted 404', (await handleProjects(env, `/agent-id/projects/${C2}`)).status === 404);
  // a second tick with a new sender holding an Agent ID
  logs[C1].push({ block: HEAD_READ + 5, tx: 't4' });
  await projectsTick(env, signers, { rpc: chain({ head: head + 10, logs }).rpc });
  const p2 = (await handleProjects(env, `/agent-id/projects/${C1}`));
  ok('tick 2: forward only, new holder added', p2.agent_id_addresses === 2 && p2.read_to_block === HEAD_READ + 10);
  // a known sender coming back in a later tick is not counted again
  logs[C1].push({ block: HEAD_READ + 15, tx: 't3' });
  await projectsTick(env, signers, { rpc: chain({ head: head + 20, logs }).rpc });
  const p3 = (await handleProjects(env, `/agent-id/projects/${C1}`));
  ok('tick 3: returning sender counted once', p3.agent_id_addresses === 2 && p3.senders === 3 && p3.transactions === 5);
}
{
  // an unread range is never applied as empty: the block stays before it
  const env = kv(), { rpc } = chain({ head, logs, failLogsAt: HEAD_READ - 100 });
  await projectsTick(env, signers, { rpc });
  const p = await handleProjects(env, `/agent-id/projects/${C1}`);
  ok('unread logs: block stops before the failed range', p.read_to_block < HEAD_READ - 100 && p.agent_id_addresses === 0);
  const st = JSON.parse(await env.AGENT.get('aid:proj'));
  ok('unread logs: span halves', st.contracts[C1].span === 2500);
}
{
  const env = kv(), { rpc } = chain({ head, logs, failTx: true });
  await projectsTick(env, signers, { rpc });
  const p = await handleProjects(env, `/agent-id/projects/${C1}`);
  ok('unread senders: chunk not applied', p.read_to_block < HEAD_READ - 100 && p.transactions === 0);
}
{
  // budget: one tick never asks the chain more than 120 times
  const env = kv(), c = chain({ head, logs });
  await projectsTick(env, signers, { rpc: c.rpc });
  ok('budget: at most 120 requests', c.calls.n <= 120);
}

console.log(`agent-id-projects-regressions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
