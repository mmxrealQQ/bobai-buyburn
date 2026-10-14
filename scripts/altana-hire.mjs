// AN AGENT THAT HIRES AN AGENT (2026-10-14, operator's choice: "es muss revolutionaer sein"). The DeFi agent asks an
// outside agent for a second opinion on its position before it moves money, and pays for it itself — from its Altana
// wallet, through the session key whose leash anyone can read on the KeyStore (four calls, 1 $U a day, an expiry,
// revocable on /session). The seller is Mandate's Range-1 (ERC-8004 #344119, rebalancing, 0.01 $U on the ERC-8183
// kernel): it reads the wallet's PancakeSwap V3 positions from the chain and says whether each is in range and what it
// would do. Its answer buys no authority: "Nothing was executed for this payment" (its own words).
//
// One atomic batch through the session (Altana SDK hireErc8183Agent: createJob, registerJob, setBudget, approve, fund),
// then the job is registered with Mandate the way its own Hire button does it (POST /api/escrow/jobs), then the answer
// is fetched from Mandate's deliverable URL.
// Usage:  node scripts/altana-hire.mjs                 the plan, nothing sent
//         node scripts/altana-hire.mjs --confirm       hire it (a person runs it with `!` until the worker does it)
import 'dotenv/config';
import fs from 'node:fs'; import path from 'node:path';
import { createPublicClient, http, formatUnits, getAddress } from 'viem';
import { BNB, signerFromPrivateKey, hireErc8183Agent } from '@altananetwork/sdk';

const ROOT = path.resolve(import.meta.dirname, '..');
const NET = BNB, CONFIRM = process.argv.includes('--confirm');
const SESSION_FILE = path.join(ROOT, 'temp', 'altana', `session-${NET.chainId}.json`);
const SITE = 'https://www.mandatemarkets.com';
const SELLER = 344119, SUBJECT = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A'; // Range-1, the DeFi agent's wallet
const MAX_PRICE = 50000000000000000n; // 0.05 $U — a second opinion is worth cents, never more
const U = '0xcE24439F2D9C6a2289F741120FE202248B666666';

const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const session = { ...raw, signer: signerFromPrivateKey(raw.signerPrivateKey), expiry: Number(raw.expiry),
  permissions: { ...raw.permissions, spend: (raw.permissions?.spend || []).map((s) => ({ ...s, limit: BigInt(s.limit) })) } };
const allow = (raw.permissions?.calls || []).map((c) => `${c.to.toLowerCase()}${c.signature ? '::' + c.signature : ''}`);
const pub = createPublicClient({ chain: NET.chain, transport: http(NET.publicRpcUrl) });

const page = await (await fetch(`${SITE}/agents/${SELLER}`)).text();
const m = page.match(/\\"escrow\\":\{\\"provider\\":\\"(0x[0-9a-fA-F]{40})\\",\\"budget\\":\\"(\d+)\\",\\"tokenId\\":\\"(\d+)\\",\\"name\\":\\"([^\\]+)\\"/);
if (!m) { console.log('REFUSED: Mandate shows no escrow offer for #' + SELLER); process.exit(1); }
const [, provider, budgetRaw, , name] = m, budget = BigInt(budgetRaw);
const task = `via mandatemarkets.com: ${name} (ERC-8004 #${SELLER}) for ${getAddress(SUBJECT)}`;
const balU = await pub.readContract({ address: U, abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [session.walletAddress] });

console.log(`Second opinion — ${name} (#${SELLER}) on ${SUBJECT}`);
console.log(`  paid by     the Altana wallet ${session.walletAddress}, through the session key (expires ${new Date(session.expiry * 1000).toISOString().slice(0, 10)})`);
console.log(`  seller      ${provider}`);
console.log(`  price       ${formatUnits(budget, 18)} $U   (wallet holds ${formatUnits(balU, 18)} $U)`);
console.log(`  task        ${task}`);
const why = [
  budget > MAX_PRICE && `the price is above the ${formatUnits(MAX_PRICE, 18)} $U cap`,
  balU < budget && 'the Altana wallet holds less $U than the price',
  !allow.some((a) => a.endsWith('::registerjob(uint256,address)') || a.includes('::registerJob(uint256,address)')) && 'the session cannot call router.registerJob — grant the four-entry leash first (altana-session.mjs --grant)',
  session.expiry * 1000 < Date.now() && 'the session has expired',
].filter(Boolean);
if (why.length) { console.log(`  REFUSED: ${why.join('; ')}`); process.exit(1); }
if (!CONFIRM) { console.log('  -> nothing sent (no --confirm)'); process.exit(0); }

const r = await hireErc8183Agent(session, { provider: getAddress(provider), task, budget }, { network: NET });
const tx = r.transactionHash || r.txHash || null;
console.log(`  hired       job ${r.jobId}  status ${r.status}${tx ? `  ${NET.explorer}/tx/${tx}` : ''}`);
const reg = await fetch(`${SITE}/api/escrow/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: String(r.jobId), tx, subject: getAddress(SUBJECT) }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
console.log(`  mandate     ${JSON.stringify(reg).slice(0, 200)}`);
for (let i = 0; i < 20; i++) {
  await new Promise((s) => setTimeout(s, 3000));
  const d = await fetch(`${SITE}/api/escrow/jobs/${r.jobId}/deliverable`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (d && d.answer) {
    const a = d.answer;
    console.log(`  answer      ${a.found} position(s), ${a.outOfRange} out of range — ${(a.positions || []).map((p) => `#${p.position} ${p.pair} ${p.inRange ? 'in range' : `OUT by ${p.ticksOut} ticks`}${p.plan ? ` · plan: ${JSON.stringify(p.plan).slice(0, 120)}` : ''}`).join('; ')}`);
    console.log(`  delivered   ${d.deliveredAt} · ${SITE}/api/escrow/jobs/${r.jobId}/deliverable`);
    process.exit(0);
  }
}
console.log('  no answer within a minute — the job is funded and stays in escrow until it is delivered or expires (then claimRefund)');
