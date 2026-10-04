// Hire an agent THROUGH Marque (marque.trade), so Marque records it as its
// own hire ("marque": true) — a job opened elsewhere on the same kernel shows
// up there as "marque": false, and Set and Earn wants hires on at least two
// marketplaces.
//
// Read out of marque.trade's hire module 2026-10-04: POST /api/v1/hire/quote
// { agentId, task } -> POST hire/intent { wallet, quoteId } (Marque supplies
// the description and expiry) -> createJob(provider, router, expiredAt,
// description, router) -> POST hire/bind { intentId, txHash } (jobId) ->
// router.registerJob(jobId, policy) -> setBudget(jobId, price, 0x) ->
// approve(commerce, price) -> fund(jobId, price, 0x) -> POST hire/notify.
// The quote must be signed and its provider must match the registry
// (Marque's own providerMatchesRegistry) or nothing is sent.
//
// A bare run only asks for the quote. Usage (repo root):
//   node scripts/bnb-sdk/hire-marque.mjs <tokenId> "<task>" [--from defi] [--confirm]
import path from 'node:path';
import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const SITE = 'https://marque.trade/api/v1/';
const KERNEL = { commerce: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6', router: '0x51895229E12F9876011789B04f8698af06cCD6DA', policy: '0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5' };
const REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const MAX_PRICE = 100000000000000000n; // 0.1 $U
const RPC = 'https://bsc-dataseed1.defibit.io';
const raw = process.argv.slice(2);
const opt = (n) => { const i = raw.indexOf(n); return i >= 0 ? raw[i + 1] : null; };
const confirm = raw.includes('--confirm');
const [tokenId, task] = raw.filter((a, i) => a !== '--confirm' && a !== '--from' && raw[i - 1] !== '--from');
if (!/^\d+$/.test(tokenId || '') || !task) { console.log('usage: node scripts/bnb-sdk/hire-marque.mjs <tokenId> "<task>" [--from defi] [--confirm]'); process.exit(1); }
const fromDefi = opt('--from') === 'defi';
if (confirm && fromDefi) {
  const n = new Date(), mm = n.getUTCMinutes(), hh = n.getUTCHours();
  if ([9, 0, 1, 2].includes(mm % 10) || (mm >= 49 && mm <= 52) || (hh === 4 && mm >= 20 && mm <= 30)) {
    console.log(`REFUSED: UTC ${hh}:${String(mm).padStart(2, '0')} is a minute the DeFi agent may send from 0xbFAA — run again in a few minutes`);
    process.exit(1);
  }
}
const pk = process.env[fromDefi ? 'LP_PRIVATE_KEY' : 'AGENT_PROVIDER_PRIVATE_KEY'];
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const api = async (p, body) => {
  const r = await fetch(SITE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`${p}: ${j.detail || j.error || r.status}`), { status: r.status });
  return j;
};

const quote = await api('hire/quote', { agentId: `56:${REGISTRY}:${tokenId}`, task, serviceId: null });
console.log(`Marque #${tokenId}  ${quote.agentName}  (${quote.category})`);
console.log(`  provider     ${quote.provider}  matches registry: ${quote.providerMatchesRegistry}  signed: ${quote.signed}`);
console.log(`  price        ${quote.priceLabel}  · quote ${quote.quoteId} until ${new Date(quote.expiresAt * 1000).toISOString()}`);
if (quote.assumptions?.length) console.log(`  assumptions  ${quote.assumptions.join(' | ')}`);
const price = BigInt(quote.price);
if (!quote.signed || !quote.providerMatchesRegistry) { console.log('  REFUSED: the quote is unsigned or its provider is not the registry\'s'); process.exit(1); }
if (!quote.token?.isDefault) { console.log(`  REFUSED: pays in ${quote.token?.symbol}, this script handles $U only`); process.exit(1); }
if (price > MAX_PRICE) { console.log(`  REFUSED: above the ${formatUnits(MAX_PRICE, 18)} $U cap`); process.exit(1); }
if (!confirm) { console.log('  -> nothing sent (no --confirm)'); process.exit(0); }

const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const w = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const ABI = parseAbi([
  'function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)',
  'function registerJob(uint256 jobId, address policy)',
  'function setBudget(uint256 jobId, uint256 amount, bytes optParams)',
  'function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);
const send = async (label, req) => {
  const hash = await w.writeContract(req);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${label} reverted: https://bscscan.com/tx/${hash}`);
  console.log(`  ${label.padEnd(12)} https://bscscan.com/tx/${hash}`);
  return hash;
};
const intent = await api('hire/intent', { wallet: account.address, quoteId: quote.quoteId });
console.log(`  intent       ${intent.intentId}, expires ${new Date(Number(intent.expiredAt) * 1000).toISOString()}`);
const created = await send('createJob', { address: KERNEL.commerce, abi: ABI, functionName: 'createJob', args: [getAddress(quote.provider), KERNEL.router, BigInt(intent.expiredAt), intent.description, KERNEL.router] });
let bound = null;
for (let i = 0; i < 8 && !bound; i++) {
  bound = await api('hire/bind', { intentId: intent.intentId, txHash: created }).catch((e) => { if (e.status === 409) return null; throw e; });
  if (!bound) await new Promise((r) => setTimeout(r, 3000));
}
if (!bound) throw new Error('Marque did not bind the job — it is created on-chain but not funded; nothing was paid');
const jobId = BigInt(bound.jobId);
console.log(`  bound        job ${jobId}`);
await send('registerJob', { address: KERNEL.router, abi: ABI, functionName: 'registerJob', args: [jobId, KERNEL.policy] });
await send('setBudget', { address: KERNEL.commerce, abi: ABI, functionName: 'setBudget', args: [jobId, price, '0x'] });
await send('approve', { address: quote.token.address, abi: ABI, functionName: 'approve', args: [KERNEL.commerce, price] });
await send('fund', { address: KERNEL.commerce, abi: ABI, functionName: 'fund', args: [jobId, price, '0x'] });
const note = await api('hire/notify', { chainId: 56, jobId: String(jobId), params: {} }).catch((e) => ({ error: e.message }));
console.log(`  notify       ${JSON.stringify(note).slice(0, 200)}`);
console.log(`  follow       https://marque.trade/api/v1/phase2/wallet/${account.address}`);
