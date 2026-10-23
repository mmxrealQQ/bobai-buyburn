// NOT DELIVERED, SAID AND REFUNDED (2026-10-23). Sluicegate accepted our funded jobs 57047 and 57055 and submitted
// neither; nothing ever asked for the budgets back. worker-agent/agent-hires.js now publishes such a job as "accepted,
// not delivered" a day after funding and, once the kernel's expiry has passed, calls claimRefund from the hiring
// agent's own wallet. Held against:
//   offline  undeliveredStep: each state -> the right step (and none for a delivered, refunded or fresh job)
//   offline  the paused hire is skipped and pays nothing
//   fork     the real kernel at today's block: claimRefund on 57047 before its expiry reverts; after it (time moved
//            past expired_at) the client's own call succeeds, the job reads EXPIRED and the client holds 0.10 $U more;
//            a second claim reverts (no double refund)
// Needs anvil (~/.foundry/bin) and BSC_RPC_KEYED_URL_2 in .env.   node scripts/hire-refund-fork-test.mjs [--offline]
import 'dotenv/config';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createTestClient, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';

const offline = process.argv.includes('--offline');
const PORT = 8553, LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.BSC_RPC_KEYED_URL_2 || process.env.BSC_RPC_KEYED_URL_1;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = await import('../worker-agent/agent-hires.js');
const { ERC8183, decodeJob } = await import('../worker-agent/hire.js');

console.log('the rule (offline)');
{
  const step = H.undeliveredStep || (() => 'missing');
  const now = Date.parse('2026-10-24T06:00:00Z');
  const row = (o) => ({ job: '57047', at: '2026-10-22T09:05:28Z', status: 'funded, delivering', ...o });
  const job = (o) => ({ status: 'FUNDED', expired_at: Date.parse('2026-10-30T09:05:28Z') / 1000, ...o });
  ok('funded, a day and more after funding: published as not delivered', step(row(), job(), now) === 'mark-undelivered', step(row(), job(), now));
  ok('funded, under a day: nothing yet', step(row({ at: '2026-10-24T01:00:00Z' }), job(), now) === null);
  ok('already said, before expiry: nothing more', step(row({ status: H.NOT_DELIVERED }), job(), now) === null);
  ok('funded past expiry: refund', step(row({ status: H.NOT_DELIVERED }), job(), Date.parse('2026-10-30T10:00:00Z')) === 'refund');
  ok('expired on the kernel (refunded elsewhere): marked refunded', step(row({ status: H.NOT_DELIVERED }), job({ status: 'EXPIRED' }), now) === 'mark-refunded');
  ok('delivered (SUBMITTED) or already refunded: nothing', step(row(), job({ status: 'SUBMITTED' }), now) === null && step(row({ status: H.REFUNDED }), job({ status: 'EXPIRED' }), now) === null);
  const slu = (H.HIRES || []).find((h) => h.seller === 341555);
  ok('Sluicegate is paused, with the reason', !!slu?.paused && /57047/.test(slu.paused), slu?.paused);
  const out = await H.runAgentHires({ AGENT_HIRES: 'on', AGENT: { get: async () => null, put: async () => {} } }, { dry: true }).catch((e) => [{ error: e.message }]);
  const s = out.find((x) => x.seller === 341555);
  ok('the day\'s run skips the paused hire and pays nothing', s?.status === 'paused', JSON.stringify(s || {}).slice(0, 120));
}

if (!offline) {
  console.log('\nthe kernel (fork)');
  const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent'], { stdio: 'ignore' });
  try {
    const pub = createPublicClient({ chain: bsc, transport: http(LOCAL) });
    for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(1000); } }
    const test = createTestClient({ chain: bsc, mode: 'anvil', transport: http(LOCAL) });
    const JOB = '57047';
    const read = async () => decodeJob((await pub.call({ to: ERC8183.commerce, data: '0xbf22c457' + BigInt(JOB).toString(16).padStart(64, '0') })).data);
    const before = await read();
    const client = before.client;
    const uBal = async () => (await pub.readContract({ address: ERC8183.paymentToken, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [client] }));
    const data = '0x5b7baf64' + BigInt(JOB).toString(16).padStart(64, '0');
    ok(`job ${JOB} is FUNDED today, client ${client.slice(0, 10)}…`, before.status === 'FUNDED', before.status);
    let early = 'no revert'; try { await pub.call({ account: client, to: ERC8183.commerce, data }); } catch (e) { early = 'reverts'; }
    ok('claimRefund before the expiry reverts', early === 'reverts', early);
    await test.setNextBlockTimestamp({ timestamp: BigInt(before.expired_at + 120) }); await test.mine({ blocks: 1 });
    await test.impersonateAccount({ address: client }); await test.setBalance({ address: client, value: 10n ** 17n });
    const u0 = await uBal();
    const hash = await test.request({ method: 'eth_sendTransaction', params: [{ from: client, to: ERC8183.commerce, data, gas: '0x493e0' }] });
    const rc = await pub.waitForTransactionReceipt({ hash });
    const after = await read(), u1 = await uBal();
    ok('after the expiry the client\'s claimRefund succeeds', rc.status === 'success', rc.status);
    ok('the job reads EXPIRED (what refundUndelivered checks)', after.status === 'EXPIRED', after.status);
    ok('the client holds the budget again (+0.10 $U)', u1 - u0 === BigInt(before.budget), `${Number(u1 - u0) / 1e18} $U`);
    let twice = 'no revert'; try { await pub.call({ account: client, to: ERC8183.commerce, data }); } catch { twice = 'reverts'; }
    ok('a second claim reverts (no double refund)', twice === 'reverts', twice);
  } finally { anvil.kill(); }
}
console.log(`\n${n - failed}/${n} ${failed ? 'FAILED' : 'pass'}`);
process.exit(failed ? 1 : 0);
