// Hire an agent the way the BNB Agent SDK marketplaces do, from our provider
// wallet 0x7380 (the Set and Earn campaign wallet).
//
// Every step is the official SDK's (@bnbagent/sdk 0.6.0), in the order of its
// reference buyer (examples/a2a-agent/scripts/buyer.ts): ERC-8004 discovery
// of the seller's A2A endpoint and its agentWallet, the card under that
// endpoint, negotiate-erc8183-job, verifyQuoteSignature against the
// agentWallet, then createJob with the SDK-built description, registerJob,
// setBudget and fund (fund approves exactly the price). After funding it
// also sends notify_funded, because studio-style sellers deliver on that
// push and SDK sellers ignore it.
//
// SAFETY — a bare run spends nothing: it discovers, negotiates, verifies and
// prints the price. --confirm sends. A quote above MAX_PRICE ($U) is refused.
//
// Usage (from the repo root):
//   node scripts/bnb-sdk/hire.mjs <agentId> "<task>" ["<deliverables>"] [--confirm]
import path from 'node:path';
import dotenv from 'dotenv';
import { getAddress, formatUnits } from 'viem';
import { ERC8004Agent, AgentURIGenerator } from '@bnbagent/sdk/erc8004';
import { ERC8183Client, buildJobDescription, verifyQuoteSignature } from '@bnbagent/sdk/erc8183';
import { EVMWalletProvider } from '@bnbagent/sdk/wallets';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const NETWORK = 'bsc-mainnet';
const MAX_PRICE = 500000000000000000n; // 0.5 $U

const args = process.argv.slice(2).filter((a) => a !== '--confirm');
const confirm = process.argv.includes('--confirm');
const [agentId, task, deliverables] = args;
if (!/^\d+$/.test(agentId || '') || !task) {
  console.log('usage: node scripts/bnb-sdk/hire.mjs <agentId> "<task>" ["<deliverables>"] [--confirm]');
  process.exit(1);
}
const pk = process.env.AGENT_PROVIDER_PRIVATE_KEY;
if (!pk) throw new Error('no AGENT_PROVIDER_PRIVATE_KEY in .env');
const wallet = new EVMWalletProvider({ password: 'bobai-hire', privateKey: pk.startsWith('0x') ? pk : `0x${pk}` });

const sendSkill = async (url, data) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'message/send', params: { message: { role: 'user', messageId: crypto.randomUUID(), parts: [{ kind: 'data', data }] } } }) });
  return r.json();
};

async function olderDialect() {
  const { createWalletClient, createPublicClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { bsc } = await import('viem/chains');
  const AGENT = 'https://agent.brainonbnb.com';
  console.log('  dialect      "negotiate" (older), through https://agent.brainonbnb.com/hire');
  const hire = await fetch(`${AGENT}/hire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, agent: messageUrl }), signal: AbortSignal.timeout(90000) }).then((r) => r.json());
  if (!hire.hireable) { console.log(`  REFUSED: ${hire.error || 'not hireable'}`); process.exit(1); }
  const budget = BigInt(hire.quote.price_atomic);
  if (getAddress(hire.provider) !== getAddress(info.agentWallet)) console.log(`  note: quote provider ${hire.provider} differs from agentWallet ${info.agentWallet}`);
  console.log(`  quote        ${hire.quote.price} from ${hire.provider}`);
  for (const c of hire.calls) console.log(`     ${c.step}. ${c.what}`);
  if (budget > MAX_PRICE) { console.log(`  REFUSED: above the ${formatUnits(MAX_PRICE, 18)} $U cap`); process.exit(1); }
  if (!confirm) { console.log('  -> nothing sent (no --confirm)'); return; }
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const pub = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed1.defibit.io') });
  const wc = createWalletClient({ account, chain: bsc, transport: http('https://bsc-dataseed1.defibit.io') });
  const send = async (label, tx) => {
    const hash = await wc.sendTransaction(tx);
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error(`${label} reverted — https://bscscan.com/tx/${hash}`);
    console.log(`  ${label.padEnd(12)} https://bscscan.com/tx/${hash}`);
  };
  const KERNEL = '0xEa4DAa3100A767e86FDed867729ae7446476EBA6';
  const counter = () => pub.readContract({ address: KERNEL, abi: [{ name: 'jobCounter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }], functionName: 'jobCounter' });
  const before = await counter();
  const s1 = hire.calls.find((c) => c.step === 1);
  await send('createJob', { to: s1.to, data: s1.data, value: 0n });
  const after = await counter();
  let jobId = null;
  for (let id = after; id > before; id--) {
    const j = await fetch(`${AGENT}/job?id=${id}`).then((r) => r.json()).catch(() => null);
    if (j && String(j.client).toLowerCase() === account.address.toLowerCase()) { jobId = String(id); break; }
  }
  if (!jobId) throw new Error(`job created but not found between ${before} and ${after}`);
  console.log(`  job          ${jobId}`);
  for (const c of hire.calls.filter((x) => x.step > 1)) {
    const data = c.ready ? c.data : c.data_template.replace('<JOBID>', BigInt(jobId).toString(16).padStart(64, '0'));
    await send(c.what.split(' ')[0].replace(/[^\w]/g, '') || `step ${c.step}`, { to: c.to, data, value: 0n });
  }
  const pushed = await sendSkill(messageUrl, { skill: 'notify_funded', job_id: jobId }).catch((e) => ({ error: { message: String(e) } }));
  console.log(`  notify       ${pushed.error ? 'seller: ' + pushed.error.message.slice(0, 160) : 'sent'}`);
}

// 1. discovery, as the SDK buyer does it
const reg8004 = await ERC8004Agent.create({ walletProvider: wallet, network: NETWORK });
const info = await reg8004.getAgentInfo(Number(agentId));
const doc = AgentURIGenerator.decodeRegistrationFileFromBase64(info.agentURI);
const a2a = (doc.services || []).find((s) => s.name === 'A2A' && s.endpoint)
  || (doc.services || []).find((s) => /a2a/i.test(String(s.name)) && s.endpoint);
console.log(`agent #${agentId}  ${doc.name}`);
console.log(`  agentWallet  ${info.agentWallet}`);
if (!a2a) { console.log('  REFUSED: no A2A endpoint in its registration'); process.exit(1); }
if (a2a.name !== 'A2A') console.log(`  note: service named "${a2a.name}" — the SDK buyer only matches "A2A"`);
const base = a2a.endpoint.replace(/\/+$/, '');
let messageUrl = base;
try {
  const cardUrl = base.endsWith('/.well-known/agent-card.json') ? base : `${base}/.well-known/agent-card.json`;
  const card = await (await fetch(cardUrl, { signal: AbortSignal.timeout(15000) })).json();
  if (card?.url) messageUrl = card.url;
  console.log(`  card         ${cardUrl} -> ${messageUrl}`);
} catch { console.log(`  card         none under the endpoint; posting to ${base}`); }

// 2. negotiate
const reply = await sendSkill(messageUrl, { skill: 'negotiate-erc8183-job', task_description: task, terms: { deliverables: deliverables || task, quality_standards: 'current on-chain data, stated as of a timestamp' } });
// THE OLDER DIALECT. BNB's own reference sellers (#266933, #265876) answer
// only skill "negotiate" with an unsigned quote and deliver on notify_funded.
// Our marketplace's /hire speaks it (it ran job 56657); its unsigned escrow
// calls are signed here by the same wallet.
if (reply.error && /unknown skill|no skill/i.test(reply.error.message)) { await olderDialect(); process.exit(0); }
if (reply.error) { console.log(`  REFUSED: seller error ${reply.error.message}`); process.exit(1); }
const quote = reply.result?.parts?.[0]?.data || reply.result;
if (!quote?.response?.accepted) { console.log(`  REFUSED: not accepted — ${quote?.response?.reason || quote?.reason || JSON.stringify(quote).slice(0, 200)}`); process.exit(1); }

// 3. verify, against the agentWallet discovery gave us — never the quote's own claim
const client = await ERC8183Client.create({ walletProvider: wallet, network: NETWORK });
const provider = getAddress(quote.provider_address || '0x0000000000000000000000000000000000000000');
if (provider !== getAddress(info.agentWallet)) { console.log(`  REFUSED: quote provider ${provider} is not the agentWallet ${info.agentWallet}`); process.exit(1); }
const price = BigInt(quote.response.terms.price);
const token = await client.paymentToken();
if (getAddress(quote.response.terms.currency) !== getAddress(token)) { console.log(`  REFUSED: quote currency ${quote.response.terms.currency} is not the kernel token ${token}`); process.exit(1); }
const verdict = await verifyQuoteSignature({ envelope: quote, provider, publicClient: client.publicClient, expectedVerifyingContract: client.commerce.address });
if (!verdict.valid) { console.log(`  REFUSED: quote signature — ${verdict.reason}`); process.exit(1); }
console.log(`  quote        ${formatUnits(price, 18)} $U, signed (${verdict.method}), expires ${new Date(quote.response.quote_expires_at * 1000).toISOString()}`);
if (price > MAX_PRICE) { console.log(`  REFUSED: above the ${formatUnits(MAX_PRICE, 18)} $U cap`); process.exit(1); }
if (!confirm) { console.log('  -> nothing sent (no --confirm)'); process.exit(0); }

// 4. the four calls of the reference buyer
const description = buildJobDescription(quote);
const created = await client.createJob({ provider, expiredAt: BigInt(Math.floor(Date.now() / 1000) + 9 * 24 * 3600), description });
const jobId = created.jobId;
console.log(`  createJob    job ${jobId}  https://bscscan.com/tx/${created.transactionHash}`);
await client.registerJob(jobId);
await client.setBudget(jobId, price);
const funded = await client.fund(jobId, price);
console.log(`  fund         ${formatUnits(price, 18)} $U  https://bscscan.com/tx/${funded.transactionHash}`);
// 5. the push some sellers wait for
const pushed = await sendSkill(messageUrl, { skill: 'notify_funded', job_id: Number(jobId) }).catch((e) => ({ error: { message: String(e) } }));
console.log(`  notify       ${pushed.error ? 'seller: ' + pushed.error.message.slice(0, 120) : 'sent'}`);
console.log(`  follow       https://marque.trade/api/v1/phase2/wallet/${wallet.address}`);
