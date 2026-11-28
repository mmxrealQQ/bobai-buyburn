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

// THE DAYS SINCE THE START (2026-11-28): with an archive node the days before the live count are read by a second cursor
{
  const { HACKATHON_START_BLOCK: S } = await import('../worker-agent/agent-id-projects.js');
  const HD = S + 100000, LIVE_FROM = HD - 3 - 40000 + 1;
  const C3 = '0x' + '55'.repeat(20);
  const sig3 = { [H1]: { place: 1, note: `Gamma ${C3}`, updated_block: HD - 10 } };
  // old senders: t5 (H2, an Agent ID) on day one, t6 (NOID) a little later; the live range has t1 (H1)
  const oldLogs = { [C3]: [{ block: S + 10, tx: 't5' }, { block: S + 30000, tx: 't6' }, { block: HD - 200, tx: 't1' }] };
  const archiveChain = ({ maxSpan = 50000, fail = false, txFrom = { t5: H2, t6: NOID, t1: H1 } } = {}) => {
    const calls = { n: 0, spans: [] };
    const archive = async (body) => {
      calls.n++;
      if (fail) return null;
      if (Array.isArray(body) && body[0].method === 'eth_getTransactionByHash') return body.map((b) => ({ id: b.id, result: { from: txFrom[b.params[0]] || NOID } }));
      if (body.method === 'eth_getLogs') {
        const f = body.params[0], a = parseInt(f.fromBlock, 16), b = parseInt(f.toBlock, 16);
        calls.spans.push(b - a + 1);
        if (b - a + 1 > maxSpan) return { error: { message: `exceed maximum block range ${maxSpan}` } };
        return { result: (oldLogs[f.address] || []).filter((l) => l.block >= a && l.block <= b).map((l) => ({ transactionHash: l.tx })) };
      }
      return null;
    };
    return { archive, calls };
  };
  const live = () => chain({ head: HD, logs: oldLogs }).rpc;
  {
    const env = kv(), A = archiveChain();
    for (let i = 0; i < 4; i++) await projectsTick(env, sig3, { rpc: live(), archive: A.archive });
    const p = await handleProjects(env, `/agent-id/projects/${C3}`);
    ok('archive: counted from the start block once the backfill is done', p.counting_since_block === S && p.since_hackathon_start === true && !p.backfill);
    ok('archive: an Agent ID sender from day one is counted (H2), with the live one (H1)', p.agent_id_addresses === 2 && p.agent_id_holders.includes(H2) && p.agent_id_holders.includes(H1));
    ok('archive: every sender once (H1, H2, NOID), every transaction once', p.senders === 3 && p.transactions === 3);
    ok('archive: the live count stays at the head', p.behind_blocks === 0 && p.read_to_block === HD - 3);
    ok('archive: no range wider than 50,000 asked', A.calls.spans.every((s) => s <= 50000));
  }
  {
    // the worker's key was seen at 300 blocks a call: the span halves to 300 and the backfill still goes on
    const env = kv(), A = archiveChain({ maxSpan: 300 });
    // the three contracts are read one after the other: after 2 ticks C3 has not started, and says so
    for (let i = 0; i < 2; i++) await projectsTick(env, sig3, { rpc: live(), archive: A.archive });
    const mid = await handleProjects(env, `/agent-id/projects/${C3}`);
    ok('archive at 300 blocks: while it runs, the backfill is shown and not claimed as done', mid.backfill?.from_block === S && mid.since_hackathon_start === false);
    const all = JSON.parse(await env.AGENT.get('aid:proj'));
    ok('archive at 300 blocks: the node limit is kept (300) and no 600 is asked after it', all.archive_span === 300 && A.calls.spans.slice(A.calls.spans.indexOf(300)).every((s) => s <= 300));
    for (let i = 0; i < 8; i++) await projectsTick(env, sig3, { rpc: live(), archive: A.archive });
    const st = JSON.parse(await env.AGENT.get('aid:proj')).contracts[C3];
    ok('archive at 300 blocks: done in the end, the day-one sender found', st.back.done === true && st.agent_ids.includes(H2) && st.since_block === S);
  }
  {
    // an archive that never answers: nothing applied, the live count unchanged
    const env = kv(), A = archiveChain({ fail: true });
    for (let i = 0; i < 2; i++) await projectsTick(env, sig3, { rpc: live(), archive: A.archive });
    const p = await handleProjects(env, `/agent-id/projects/${C3}`);
    ok('archive away: the backfill stays at its start, nothing counted from it', p.backfill?.read_to_block === S - 1 && p.agent_id_addresses === 1 && p.counting_since_block === LIVE_FROM);
  }
  {
    // without an archive: as before, the live count only
    const env = kv();
    await projectsTick(env, sig3, { rpc: live(), archive: null });
    const p = await handleProjects(env, `/agent-id/projects/${C3}`);
    ok('no archive: as before (from 40,000 blocks back, no backfill)', p.counting_since_block === LIVE_FROM && !p.backfill && p.since_hackathon_start === false);
  }
  {
    // a busy contract: the backfill stops after 20,000 transactions and says where
    const busy = []; for (let i = 0; i < 21000; i++) busy.push({ block: S + 1 + Math.floor(i / 50), tx: 'b' + i });
    oldLogs[C3] = busy;
    const env = kv(), A = archiveChain();
    for (let i = 0; i < 12; i++) await projectsTick(env, sig3, { rpc: chain({ head: HD, logs: {} }).rpc, archive: A.archive });
    const p = await handleProjects(env, `/agent-id/projects/${C3}`);
    ok('busy contract: backfill stopped with a stated reason', /transactions/.test(p.backfill?.stopped || '') && p.counting_since_block === LIVE_FROM);
    ok('busy contract: the budget of 120 a tick still holds', A.calls.n <= 12 * 120);
  }
}

// A LOOK BEFORE SIGNING (2026-11-28): previewCount reads a contract since the start without listing it
{
  const { previewCount, HACKATHON_START_BLOCK: S } = await import('../worker-agent/agent-id-projects.js');
  const HD = S + 100000, C4 = '0x' + '66'.repeat(20);
  const pl = { [C4]: [{ block: S + 5, tx: 't5' }, { block: S + 70000, tx: 't6' }, { block: HD - 50, tx: 't1' }, { block: HD - 40, tx: 't1' }] };
  const txFrom = { t5: H2, t6: NOID, t1: H1 };
  const arch = ({ fail = false, maxSpan = 50000, logs = pl } = {}) => async (body) => {
    if (fail) return null;
    if (Array.isArray(body)) return body.map((b) => ({ id: b.id, result: { from: txFrom[b.params[0]] || NOID } }));
    const f = body.params[0], a = parseInt(f.fromBlock, 16), b = parseInt(f.toBlock, 16);
    if (b - a + 1 > maxSpan) return { error: { message: 'exceed maximum block range' } };
    return { result: (logs[f.address] || []).filter((l) => l.block >= a && l.block <= b).map((l) => ({ transactionHash: l.tx })) };
  };
  const rpc = chain({ head: HD, logs: {} }).rpc;
  const r = await previewCount({}, C4.toUpperCase().replace('0X', '0x'), { rpc, archive: arch(), head: HD });
  ok('preview: counted since the start, before any listing', r.status === 200 && r.body.agent_id_addresses === 2 && r.body.senders === 3 && r.body.transactions === 3 && r.body.from_block === S && r.body.complete === true);
  ok('preview: names the holders and how to list it', r.body.agent_id_holders.includes(H2) && /Agent ID Book/.test(r.body.list_it));
  const r300 = await previewCount({}, C4, { rpc, archive: arch({ maxSpan: 300 }), head: HD });
  ok('preview: a node too narrow to read it in one look says so (503), never a short count', r300.status === 503 && /did not answer in full/.test(r300.body.error) && r300.body.agent_id_addresses === undefined);
  const away = await previewCount({}, C4, { rpc, archive: arch({ fail: true }), head: HD });
  ok('preview: archive away is a 503, never a 0', away.status === 503 && away.body.agent_id_addresses === undefined);
  ok('preview: a wallet is no contract (422)', (await previewCount({}, EOA, { rpc, archive: arch(), head: HD })).status === 422);
  ok('preview: the Agent ID contract itself is refused', (await previewCount({}, '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F', { rpc, archive: arch(), head: HD })).status === 400);
  ok('preview: a bad address is refused', (await previewCount({}, '0x123', { rpc, archive: arch(), head: HD })).status === 400);
  ok('preview: no archive on the worker is a 503', (await previewCount({}, C4, { rpc, archive: null, head: HD })).status === 503);
  const many = { [C4]: Array.from({ length: 2500 }, (_, i) => ({ block: S + 1 + i * 30, tx: 'm' + i })) };
  const big = await previewCount({}, C4, { rpc, archive: arch({ logs: many }), head: HD });
  ok('preview: a busy contract is counted up to 2,000 transactions and said as partial', big.status === 200 && big.body.complete === false && big.body.transactions === 2000 && /more than 2,000/.test(big.body.partial));
}

// the health rule for the count (scripts/lib/health-checks.mjs)
{
  const { projectsCountVerdict: v } = await import('./lib/health-checks.mjs');
  const now = Date.parse('2026-11-28T05:00:00Z'), own = (b = 0) => [{ own: true, behind_blocks: b, contract: C1 }, { own: true, behind_blocks: 0, contract: C2 }];
  ok('health: fresh read green', v({ read_at: '2026-11-28T04:50:00Z', projects: own() }, now).good === true);
  ok('health: read 2 h ago red', v({ read_at: '2026-11-28T03:00:00Z', projects: own() }, now).good === false);
  ok('health: an own contract missing red', v({ read_at: '2026-11-28T04:50:00Z', projects: own().slice(0, 1) }, now).good === false);
  ok('health: a contract 30,000 blocks behind red', v({ read_at: '2026-11-28T04:50:00Z', projects: own(30000) }, now).good === false);
  ok('health: no answer red', v(null, now).good === false);
}

console.log(`agent-id-projects-regressions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
