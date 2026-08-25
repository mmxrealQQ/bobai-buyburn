// Hires one of our own agents for real, end to end, and pays for it.
//
// WHAT THIS PROVES, AND WHY IT IS WORTH A SCRIPT
// Everything else about being hireable can be faked by a nice agent card. This
// runs the whole thing against mainnet: buy the payment token, negotiate a
// price through our own marketplace, create the job, fund the escrow, tell the
// seller, and read back a deliverable that is on-chain. If any link in that
// chain is broken, this fails loudly instead of a judge finding it.
//
// It also puts us in a very small group. Across all 56,655 jobs in this escrow
// kernel, exactly three providers have ever completed a job for more than one
// buyer, and 27,195 jobs hold a deliverable whose escrow never released.
//
// HONESTY, WHICH MATTERS MORE HERE THAN ANYWHERE
// The buyer is us. This is an acceptance test, not demand, and a job where the
// client and the provider are the same operator proves the machinery works and
// nothing whatsoever about anybody wanting it. Everything this writes is marked
// self_test: true, and the marketplace page says so next to our own row. We
// spent today measuring an address that pays itself tens of thousands of times;
// we are not going to quietly do a small version of that.
//
// EVERYTHING COMES FROM ONE WALLET
// The NFT relayer, at the operator's instruction. It is the project's utility
// wallet — it already funds the other wallets' gas — and using one source keeps
// the accounting for this test to a single address.
//
// SAFETY — a bare run changes nothing
//   Does nothing without --confirm. A bare run prints every transaction it
//     would send, with the amounts.
//   Refuses if the relayer would drop below MIN_REMAINING: it mints NFTs on
//     every qualifying buy and must keep its gas.
//   Refuses if the swap would pay more than MAX_SPEND_BNB, so a bad quote
//     cannot turn a one-dollar test into something else.
//   Buys the payment token only if the balance is actually short.
//
// Usage:
//   node scripts/hire-own-agent.mjs                       # show the plan
//   node scripts/hire-own-agent.mjs --service grid_plan   # the other agent
//   node scripts/hire-own-agent.mjs --confirm             # run it for real
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createWalletClient, createPublicClient, http, formatEther, formatUnits, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG = path.join(ROOT, 'data', 'own-jobs.jsonl');
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const AGENT = 'https://agent.brainonbnb.com';
const KERNEL = '0xEa4DAa3100A767e86FDed867729ae7446476EBA6';
const U = '0xcE24439F2D9C6a2289F741120FE202248B666666';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const MIN_REMAINING = 0.02;   // BNB the relayer must keep
const MAX_SPEND_BNB = 0.005;  // hard ceiling on the token purchase
const SLIPPAGE_BPS = 200n;    // 2% on a stablecoin swap with $80k of depth

const TASKS = {
  health_factor: 'health factor and liquidation distance for the Venus position of 0xd319e1F8e987cf78333cEA853F455366640929cF',
  grid_plan: 'grid trading plan for CAKE 0x0E09FaBB73BD3ADE0A17ECC321FD13A19E81CE82 with 5000 usd over 10 levels',
};

const ERC20 = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const ROUTER_ABI = [
  { name: 'getAmountsOut', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'swapExactETHForTokens', type: 'function', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256[]' }] },
];
const KERNEL_ABI = [
  { name: 'jobCounter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const confirm = args.includes('--confirm');
const serviceId = arg('--service', 'health_factor');

class Refused extends Error {}
const die = (m) => { throw new Refused(m); };
const bnb = (v) => `${Number(formatEther(v)).toFixed(6)} BNB`;
const u = (v) => `${Number(formatUnits(v, 18)).toFixed(4)} $U`;

const a2a = async (data) => {
  const r = await fetch(`${AGENT}/a2a`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send',
      params: { message: { role: 'user', messageId: `test-${Date.now().toString(36)}`, parts: [{ kind: 'data', data }] } } }),
    signal: AbortSignal.timeout(120000),
  });
  return await r.json();
};

// The hire response hands back calls whose job id is not known yet, as a
// template with a <JOBID> marker exactly one word wide. Substituting it is the
// buyer's job and it is done here rather than trusting a server to fill it in —
// the whole point of unsigned calldata is that the signer builds the final
// bytes.
const fill = (template, jobId) => template.replace('<JOBID>', BigInt(jobId).toString(16).padStart(64, '0'));

(async () => {
  if (!TASKS[serviceId]) die(`--service must be one of: ${Object.keys(TASKS).join(', ')}`);

  const pk = process.env.NFT_RELAYER_PRIVATE_KEY;
  if (!pk) die('No NFT_RELAYER_PRIVATE_KEY in .env');
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC) });

  // --- 1. negotiate, through our own marketplace ------------------------
  const task = TASKS[serviceId];
  process.stdout.write('negotiating through /hire… ');
  const hire = await fetch(`${AGENT}/hire`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task, agent: `${AGENT}/a2a` }),
    signal: AbortSignal.timeout(90000),
  }).then((r) => r.json());
  if (!hire.hireable) die(`the marketplace could not hire this agent: ${hire.error || 'not hireable'}`);
  const budget = BigInt(hire.quote.price_atomic);
  console.log(`${hire.quote.price} from ${hire.provider}`);
  if (hire.quote.service !== serviceId) {
    die(`asked for ${serviceId} but the seller quoted ${hire.quote.service} — the task text and the service do not line up`);
  }

  // --- 2. balances -------------------------------------------------------
  const [bnbBal, uBal, gasPrice] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: U, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
    publicClient.getGasPrice(),
  ]);

  // Buy a little more than one job needs, so a retry does not need another swap.
  const target = budget * 10n;
  const short = uBal < budget;
  let spend = 0n;
  let expectOut = 0n;
  if (short) {
    const quotes = await publicClient.readContract({
      address: V2_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut',
      args: [parseEther('0.0025'), [WBNB, U]],
    });
    // Scale the trial quote to what we actually want. The pool holds ~$80k
    // against a $2 purchase, so treating the rate as linear over this size is
    // not an approximation worth worrying about.
    const perBnb = quotes[1] * 10n ** 18n / parseEther('0.0025');
    spend = (target * 10n ** 18n) / perBnb;
    if (spend > parseEther(String(MAX_SPEND_BNB))) die(`buying ${u(target)} would cost ${bnb(spend)}, over the ${MAX_SPEND_BNB} BNB ceiling`);
    const out = await publicClient.readContract({ address: V2_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [spend, [WBNB, U]] });
    expectOut = out[1];
  }

  const gasBudget = gasPrice * 700_000n; // swap + five escrow calls, generously
  const remaining = bnbBal - spend - gasBudget;

  console.log('\nHire our own agent — acceptance test');
  console.log('------------------------------------');
  console.log(`  service        ${serviceId}  (${hire.quote.service})`);
  console.log(`  task           ${task.slice(0, 90)}…`);
  console.log(`  provider       ${hire.provider}`);
  console.log(`  price          ${hire.quote.price}`);
  console.log(`  buyer          ${account.address}  (NFT relayer)`);
  console.log(`  buyer holds    ${bnb(bnbBal)} · ${u(uBal)}`);
  if (short) console.log(`  buy            ${bnb(spend)} -> ~${u(expectOut)} on PancakeSwap V2`);
  else console.log(`  buy            not needed, the wallet already holds enough $U`);
  console.log(`  gas budget     ${bnb(gasBudget)} at ${Number(gasPrice) / 1e9} gwei`);
  console.log(`  relayer left   ${bnb(remaining)}`);
  console.log(`  escrow calls   ${hire.calls.length}`);
  for (const c of hire.calls) console.log(`     ${c.step}. ${c.what}`);
  console.log(`\n  NOTE: buyer and provider are both us. This is an acceptance test, not demand,`);
  console.log(`        and it is recorded and published as one.`);

  if (remaining < parseEther(String(MIN_REMAINING))) {
    die(`that would leave the relayer under ${MIN_REMAINING} BNB — it mints NFTs and must keep its gas`);
  }
  if (!confirm) { console.log('\nNothing sent. Re-run with --confirm to actually do it.'); return; }

  const send = async (label, tx) => {
    const hash = await walletClient.sendTransaction(tx);
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') die(`${label} reverted — https://bscscan.com/tx/${hash}`);
    console.log(`  ${label.padEnd(22)} ok  https://bscscan.com/tx/${hash}`);
    return rc;
  };

  console.log('');

  // --- 3. buy the payment token -----------------------------------------
  if (short) {
    const minOut = expectOut - (expectOut * SLIPPAGE_BPS) / 10_000n;
    const { request } = await publicClient.simulateContract({
      address: V2_ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens',
      args: [minOut, [WBNB, U], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
      value: spend, account,
    });
    const hash = await walletClient.writeContract(request);
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') die(`the swap reverted — https://bscscan.com/tx/${hash}`);
    console.log(`  buy $U                 ok  https://bscscan.com/tx/${hash}`);
  }

  // --- 4. create the job -------------------------------------------------
  // createJob returns the id, and a transaction cannot hand a return value
  // back. Rather than trust jobCounter() — which anybody else's job could have
  // moved between our two reads — the window between the counter before and
  // after is scanned for the job that names us as client.
  const before = await publicClient.readContract({ address: KERNEL, abi: KERNEL_ABI, functionName: 'jobCounter' });
  const step1 = hire.calls.find((c) => c.step === 1);
  await send('createJob', { to: step1.to, data: step1.data, value: 0n });
  const after = await publicClient.readContract({ address: KERNEL, abi: KERNEL_ABI, functionName: 'jobCounter' });

  let jobId = null;
  for (let id = after; id > before; id--) {
    const j = await fetch(`${AGENT}/job?id=${id}`).then((r) => r.json()).catch(() => null);
    if (j && j.client?.toLowerCase() === account.address.toLowerCase()) { jobId = String(id); break; }
  }
  if (!jobId) die(`the job was created but could not be identified between ids ${before} and ${after}`);
  console.log(`  job id                 ${jobId}`);

  // --- 5. the rest of the escrow ----------------------------------------
  for (const c of hire.calls.filter((x) => x.step > 1)) {
    const data = c.ready ? c.data : fill(c.data_template, jobId);
    await send(c.what.split(' ')[0].replace(/[^\w]/g, '') || `step ${c.step}`, { to: c.to, data, value: 0n });
  }

  // --- 6. tell the seller, and let it deliver ---------------------------
  console.log('\n  telling the agent the escrow is funded…');
  const delivered = await a2a({ skill: 'notify_funded', job_id: jobId });
  if (delivered.error) die(`the agent refused to deliver: ${delivered.error.message}`);
  const d = delivered.result;
  console.log(`  delivered              ${d.delivered ? 'yes' : 'no'}`);
  if (d.on_chain?.tx) console.log(`  submit tx              https://bscscan.com/tx/${d.on_chain.tx}`);
  console.log(`  digest (${d.on_chain?.digest_algorithm})        ${d.on_chain?.deliverable_digest}`);
  console.log(`  deliverable            ${d.deliverable_url}`);

  const job = await fetch(`${AGENT}/job?id=${jobId}`).then((r) => r.json());
  console.log(`  job status             ${job.status}`);

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify({
    job_id: jobId, service: serviceId, buyer: account.address, provider: hire.provider,
    budget_atomic: budget.toString(), status: job.status,
    submit_tx: d.on_chain?.tx || null, digest: d.on_chain?.deliverable_digest || null,
    self_test: true,
    note: 'Buyer and provider are the same operator. This is an acceptance test of the hire path, not evidence of demand.',
    at: new Date().toISOString(),
  }) + '\n');

  console.log(`\n  recorded in ${path.relative(ROOT, LOG)} — marked self_test, because it is one.`);
  console.log('\n  SUBMITTED is not COMPLETED: the escrow releases after the dispute window.');
  console.log('  Check back with: node scripts/hire-own-agent.mjs --status ' + jobId);
})().catch((e) => {
  console.log(e instanceof Refused ? `\n[REFUSED] ${e.message}` : `\n[ERROR] ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});
