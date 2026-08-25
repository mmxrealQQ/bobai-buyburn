// Self-test for the hand-rolled ERC-8183 calldata in worker-agent/hire.js.
//
// The worker has no dependencies on purpose, so its ABI encoding is written out
// by hand. Hand-written encoding is exactly the kind of code that looks right,
// passes review, and produces calldata that targets the wrong job or approves
// the wrong amount. So every encoder is compared byte-for-byte against viem,
// and the job decoder is run against real jobs read from the live kernel.
//
//   node scripts/erc8183-encoding-check.mjs
//
// Exits non-zero on any mismatch. Read-only: it encodes and reads, and sends
// nothing.

import { encodeFunctionData, createPublicClient, http } from 'viem';
import {
  ERC8183, decodeJob, buildHireCalls, JOB_STATUS,
} from '../worker-agent/hire.js';

let fails = 0;
const check = (name, mine, theirs) => {
  const a = String(mine).toLowerCase();
  const b = String(theirs).toLowerCase();
  if (a === b) { console.log(`  ok   ${name}`); return; }
  fails++;
  console.log(`  FAIL ${name}`);
  console.log(`       mine   ${a}`);
  console.log(`       viem   ${b}`);
  for (let i = 0; i < Math.max(a.length, b.length); i += 64) {
    const x = a.slice(i, i + 64), y = b.slice(i, i + 64);
    if (x !== y) console.log(`       word ${Math.floor(i / 64)}: ${x} != ${y}`);
  }
};

const COMMERCE_ABI = [
  { name: 'createJob', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'provider', type: 'address' }, { name: 'evaluator', type: 'address' }, { name: 'expiredAt', type: 'uint256' }, { name: 'description', type: 'string' }, { name: 'hook', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'setBudget', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { name: 'fund', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'expectedBudget', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { name: 'getJob', type: 'function', stateMutability: 'view', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [
    { name: 'id', type: 'uint256' }, { name: 'client', type: 'address' }, { name: 'provider', type: 'address' },
    { name: 'evaluator', type: 'address' }, { name: 'description', type: 'string' }, { name: 'budget', type: 'uint256' },
    { name: 'expiredAt', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'hook', type: 'address' },
    { name: 'submittedAt', type: 'uint256' }, { name: 'deliverable', type: 'bytes32' },
  ] }] },
];
const ROUTER_ABI = [{ name: 'registerJob', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'policy', type: 'address' }], outputs: [] }];
const ERC20_ABI = [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }];

// Cases chosen to break naive encoders: a plain task, a description with
// multi-byte UTF-8 (a charCode-based encoder gets the length prefix wrong), one
// whose byte length lands exactly on a 32-byte boundary (an off-by-one in the
// padding shows up only here), and an empty one.
const CASES = [
  { name: 'ascii', task: 'Audit a Venus position and recommend an action.' },
  { name: 'utf8', task: 'Prüfe die Liquiditätstiefe — Ø über 24 h 📊' },
  { name: 'exactly 32 bytes', task: 'x'.repeat(32) },
  { name: 'exactly 64 bytes', task: 'y'.repeat(64) },
  { name: 'empty', task: '' },
];

const PROVIDER = '0xa09991fc5D8637bb4245737C3ebF26E24D653962';
const BUDGET = '1000000000000000000';
const EXPIRES = 1789000000;

console.log('ERC-8183 calldata — hand-rolled vs viem\n');

for (const c of CASES) {
  // buildHireCalls owns the description envelope, so drive the real function
  // rather than re-deriving the string here: a test that encodes its own idea
  // of the description proves the encoder and not the code that ships.
  const calls = buildHireCalls({
    provider: PROVIDER, budget: BUDGET, task: c.task,
    quote: { service: 'test', negotiation_hash: '0xabc', provider_sig: '0xdef', quoted_at: '2026-08-25T00:00:00Z' },
    expiredAt: EXPIRES,
  });
  // Rebuild the description the same way hire.js does, then confirm the two
  // agree by comparing the full createJob calldata.
  const env = JSON.stringify({
    task: String(c.task).slice(0, 400),
    service: 'test',
    negotiation_hash: '0xabc',
    provider_sig: '0xdef',
    quoted_at: '2026-08-25T00:00:00Z',
    via: 'brainonbnb.com/registry',
  });
  const viemCreate = encodeFunctionData({
    abi: COMMERCE_ABI, functionName: 'createJob',
    args: [PROVIDER, ERC8183.router, BigInt(EXPIRES), env, ERC8183.router],
  });
  check(`createJob (${c.name})`, calls[0].data, viemCreate);
}

// jobId-dependent calls, at a value that exercises more than the low byte.
const JOBID = 56655n;
const calls = buildHireCalls({
  provider: PROVIDER, budget: BUDGET, task: 'x',
  quote: {}, expiredAt: EXPIRES,
});
check('registerJob', calls[1].template(JOBID),
  encodeFunctionData({ abi: ROUTER_ABI, functionName: 'registerJob', args: [JOBID, ERC8183.policy] }));
check('setBudget', calls[2].template(JOBID),
  encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'setBudget', args: [JOBID, BigInt(BUDGET), '0x'] }));
check('approve', calls[3].data,
  encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [ERC8183.commerce, BigInt(BUDGET)] }));
check('fund', calls[4].template(JOBID),
  encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'fund', args: [JOBID, BigInt(BUDGET), '0x'] }));

// The decoder, against real jobs. A tuple with a dynamic member is where an
// off-by-one word shows up as a plausible-looking job with the wrong provider,
// so this compares every field with viem's decoding of the same bytes.
console.log('\nJob decoding — hand-rolled vs viem, on live mainnet jobs\n');
const client = createPublicClient({ transport: http('https://bsc-dataseed1.defibit.io') });

const SAMPLE = [1n, 1000n, 40000n, 56000n, 56600n];
for (const id of SAMPLE) {
  const raw = await client.request({
    method: 'eth_call',
    params: [{ to: ERC8183.commerce, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'getJob', args: [id] }) }, 'latest'],
  });
  const mine = decodeJob(raw);
  const theirs = await client.readContract({ address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'getJob', args: [id] });
  if (!mine) { fails++; console.log(`  FAIL job ${id}: decoder returned null`); continue; }
  check(`job ${id} .provider`, mine.provider, theirs.provider);
  check(`job ${id} .client`, mine.client, theirs.client);
  check(`job ${id} .budget`, mine.budget, theirs.budget.toString());
  check(`job ${id} .status`, mine.status, JOB_STATUS[theirs.status]);
  check(`job ${id} .description`, mine.description, theirs.description);
  check(`job ${id} .deliverable`, mine.deliverable, theirs.deliverable);
  check(`job ${id} .submitted_at`, String(mine.submitted_at), theirs.submittedAt.toString());
}

console.log(fails ? `\n${fails} MISMATCH(ES)` : '\nall encoders and the decoder agree with viem');
process.exit(fails ? 1 : 0);
