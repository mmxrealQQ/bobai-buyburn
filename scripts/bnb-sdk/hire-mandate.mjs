// Hire one of Mandate's escrow agents from our provider wallet 0x7380, the way
// mandatemarkets.com's own Hire button does it, then register the job with
// Mandate so its quest counts it (Set and Earn: at most two hires count on
// Mandate, at least one more has to be on another marketplace).
//
// Read out of the live site 2026-10-04 (bundle + API): the agent page carries
// escrow { provider, budget }; the UI calls the standard ERC-8183 kernel —
// createJob(provider, evaluator=router, expiredAt, description, hook=router),
// router.registerJob(jobId, policy), setBudget, approve exact, fund — with
// the description "via mandatemarkets.com: <name> (ERC-8004 #<id>) for
// <subject>", then POST /api/escrow/jobs { jobId, tx, subject }.
// One deliberate difference: the expiry. Mandate's UI uses 30 minutes and
// its earlier jobs 6 days, both inside the kernel's 7-day dispute window, so
// no seller could ever submit. Ours is 9 days, so the seller can deliver.
//
// The kernel calls are the official SDK's (@bnbagent/sdk ERC8183Client).
// A bare run spends nothing. Usage (repo root):
//   node scripts/bnb-sdk/hire-mandate.mjs <tokenId> <subject 0x…> [--from defi] [--rpc URL] [--confirm]
import path from 'node:path';
import dotenv from 'dotenv';
import { getAddress, formatUnits } from 'viem';
import { ERC8183Client } from '@bnbagent/sdk/erc8183';
import { EVMWalletProvider } from '@bnbagent/sdk/wallets';
import { resolveNetwork } from '@bnbagent/sdk';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const SITE = 'https://www.mandatemarkets.com';
const MAX_PRICE = 50000000000000000n; // 0.05 $U
// --from defi: the DeFi wallet 0xbFAA (campaign wallet, owns #363709); --rpc URL: another node.
// Paymaster off: a sponsored hire does not count as paid by our own wallet.
const raw = process.argv.slice(2);
const opt = (n) => { const i = raw.indexOf(n); return i >= 0 ? raw[i + 1] : null; };
const RPC = opt('--rpc') || 'https://bsc-dataseed1.defibit.io';
const NETWORK = { ...resolveNetwork('bsc-mainnet'), rpcUrl: RPC, usePaymaster: false };
const confirm = raw.includes('--confirm');
const [tokenId, subject] = raw.filter((a, i) => a !== '--confirm' && !['--from', '--rpc'].includes(a) && !['--from', '--rpc'].includes(raw[i - 1]));
if (!/^\d+$/.test(tokenId || '') || !/^0x[0-9a-fA-F]{40}$/.test(subject || '')) {
  console.log('usage: node scripts/bnb-sdk/hire-mandate.mjs <tokenId> <subject 0x…> [--confirm]');
  process.exit(1);
}
// Never race worker-lp for 0xbFAA's nonce: it may send at xx:09-xx:12 of each
// ten minutes, xx:49-xx:52 and 04:20-04:30 UTC.
if (confirm && opt('--from') === 'defi' && !RPC.includes('127.0.0.1')) {
  const n = new Date(), mm = n.getUTCMinutes(), hh = n.getUTCHours();
  if ([9, 0, 1, 2].includes(mm % 10) || (mm >= 49 && mm <= 52) || (hh === 4 && mm >= 20 && mm <= 30)) {
    console.log(`REFUSED: UTC ${hh}:${String(mm).padStart(2, '0')} is a minute the DeFi agent may send from 0xbFAA — run again in a few minutes`);
    process.exit(1);
  }
}
const pk = process.env[opt('--from') === 'defi' ? 'LP_PRIVATE_KEY' : 'AGENT_PROVIDER_PRIVATE_KEY'];
const wallet = new EVMWalletProvider({ password: 'bobai-hire', privateKey: pk.startsWith('0x') ? pk : `0x${pk}` });

const page = await (await fetch(`${SITE}/agents/${tokenId}`)).text();
const m = page.match(/\\"escrow\\":\{\\"provider\\":\\"(0x[0-9a-fA-F]{40})\\",\\"budget\\":\\"(\d+)\\",\\"tokenId\\":\\"(\d+)\\",\\"name\\":\\"([^\\]+)\\",\\"outside\\":null/);
if (!m) { console.log('REFUSED: no house escrow offer on the agent page (outside sellers need /api/escrow/quote)'); process.exit(1); }
const [, provider, budgetRaw, , name] = m;
const budget = BigInt(budgetRaw);
const description = `via mandatemarkets.com: ${name} (ERC-8004 #${tokenId}) for ${getAddress(subject)}`;
console.log(`Mandate #${tokenId}  ${name}`);
console.log(`  provider     ${provider}`);
console.log(`  price        ${formatUnits(budget, 18)} $U`);
console.log(`  description  ${description}`);
if (budget > MAX_PRICE) { console.log('  REFUSED: above the cap'); process.exit(1); }
if (!confirm) { console.log('  -> nothing sent (no --confirm)'); process.exit(0); }

const client = await ERC8183Client.create({ walletProvider: wallet, network: NETWORK });
const created = await client.createJob({ provider: getAddress(provider), expiredAt: BigInt(Math.floor(Date.now() / 1000) + 9 * 24 * 3600), description });
const jobId = created.jobId;
console.log(`  createJob    job ${jobId}  https://bscscan.com/tx/${created.transactionHash}`);
await client.registerJob(jobId);
await client.setBudget(jobId, budget);
const funded = await client.fund(jobId, budget);
console.log(`  fund         https://bscscan.com/tx/${funded.transactionHash}`);
const reg = RPC.includes('127.0.0.1') ? { skipped: 'local fork — not registered with Mandate' } : await fetch(`${SITE}/api/escrow/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: String(jobId), tx: funded.transactionHash, subject: getAddress(subject) }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
console.log(`  mandate      ${JSON.stringify(reg).slice(0, 240)}`);
console.log(`  follow       ${SITE}/api/v1/wallets/${wallet.address}/hires`);
