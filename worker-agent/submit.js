// Writing a delivered job to the ERC-8183 escrow.
//
// This is the only file in this worker that signs anything, and the only one
// with a dependency. Both facts are deliberate and worth stating where somebody
// will read them.
//
// WHY THERE IS A DEPENDENCY HERE AND NOWHERE ELSE
// The rest of the worker reads the chain over plain JSON-RPC and hand-rolls its
// ABI encoding, checked byte-for-byte against viem in
// scripts/erc8183-encoding-check.mjs. That works because reading needs no
// cryptography. Signing an EVM transaction needs secp256k1, keccak-256 and RLP,
// and Web Crypto offers none of the three — it does ECDSA over the NIST curves
// and not over the curve Ethereum uses. Hand-rolling that would be writing our
// own signature code to avoid an import, which is the wrong trade in every
// direction.
//
// WHY THE WORKER SIGNS AT ALL
// Because ERC-8183 makes the provider write its own deliverable, and an agent
// that needs a human at a keyboard to finish a job is not an agent. We measured
// what happens to the ones that cannot: 27,195 jobs in this kernel hold a
// deliverable whose escrow never released, and all four of the BNB Agent Studio
// reference agents sit at zero completions. Shipping another of those would
// make our own census an indictment of us.
//
// WHAT THE KEY CAN DO, WHICH IS AS LITTLE AS POSSIBLE
// AGENT_PROVIDER_PRIVATE_KEY signs exactly one call: submit() against the
// kernel, for a job that names our own address as provider. It holds gas and no
// tokens, it is not the buyback wallet, not the treasury and not the x402
// receiving wallet, and nothing in this worker will send value from it.

import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

import { ERC8183 } from './hire.js';

// submit(uint256 jobId, bytes32 deliverable, bytes payload) — selector
// 0x9e63798d. Not taken from documentation, which does not exist for this: the
// selector was read out of a real delivery transaction on the kernel
// (job 56,655, block 117,850,120) and the signature recovered from it, then
// confirmed against the bytes32 the contract stores as that job's deliverable.
const SUBMIT_ABI = [{
  name: 'submit', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'jobId', type: 'uint256' },
    { name: 'deliverable', type: 'bytes32' },
    { name: 'payload', type: 'bytes' },
  ],
  outputs: [],
}];

const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed2.defibit.io',
];

// A misconfigured key must not take the whole endpoint down with a 1101 — which
// is exactly what it did the first time this was deployed, turning "the secret
// did not upload cleanly" into an opaque worker exception with no clue in it.
// It now degrades to "this agent cannot sign", which is a true statement a
// caller can act on, and keyShape() says why without printing the key.
export const providerAccount = (env) => {
  const key = (env?.AGENT_PROVIDER_PRIVATE_KEY || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key.startsWith('0x') ? key : `0x${key}`)) return null;
  try { return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`); }
  catch { return null; }
};

// Enough to diagnose a bad upload, not enough to be worth stealing: how long the
// stored value is and whether it is 32 bytes of hex. Never the value.
export const keyShape = (env) => {
  const raw = env?.AGENT_PROVIDER_PRIVATE_KEY;
  if (raw == null) return { present: false };
  const key = String(raw).trim();
  return {
    present: true,
    stored_length: String(raw).length,
    trimmed_length: key.length,
    hex_32_bytes: /^0x[0-9a-fA-F]{64}$/.test(key.startsWith('0x') ? key : `0x${key}`),
  };
};

// SHA-256 of the exact bytes we hand over, as the on-chain commitment.
//
// The bytes32 slot is not specified anywhere — we checked: the one delivery we
// reverse-engineered does not hold a keccak of its own payload either. So
// rather than guess at a convention that does not exist, we commit to a digest
// anybody can recompute, and the payload says in plain text which digest it is.
// A commitment nobody can verify is decoration.
export async function digestOf(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hexOf = (bytes) => '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Deliver a finished job.
 *
 * Refuses unless the chain agrees the job is ours to deliver: funded, naming
 * this wallet as provider, and not already submitted. Those checks are not
 * politeness — submit() on somebody else's job either reverts and wastes gas,
 * or worse, succeeds against a job we were never paid for.
 */
export async function submitDeliverable({ env, jobId, document, readJob }) {
  const account = providerAccount(env);
  if (!account) throw new Error('no provider key configured — this worker cannot deliver');

  const job = await readJob(jobId);
  if (!job) throw new Error(`job ${jobId} could not be read from the kernel`);
  if (job.provider.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`job ${jobId} names ${job.provider} as provider, not us`);
  }
  if (job.status === 'SUBMITTED' || job.status === 'COMPLETED') {
    return { already: true, job, note: 'This job already carries a deliverable on-chain.' };
  }
  if (job.status !== 'FUNDED') {
    throw new Error(`job ${jobId} is ${job.status} — only a FUNDED job can be delivered against`);
  }

  const bytes = new TextEncoder().encode(document);
  const deliverable = await digestOf(bytes);

  const publicClient = createPublicClient({ chain: bsc, transport: http(RPCS[0]) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPCS[0]) });

  const data = encodeFunctionData({
    abi: SUBMIT_ABI, functionName: 'submit',
    args: [BigInt(jobId), deliverable, hexOf(bytes)],
  });

  // Simulated before it is sent. A revert that costs gas and tells nobody why
  // is the normal failure mode here, and the simulation names the reason while
  // it is still free.
  await publicClient.call({ account, to: ERC8183.commerce, data });

  const hash = await walletClient.sendTransaction({ to: ERC8183.commerce, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`submit reverted in block ${receipt.blockNumber}`);

  return {
    delivered: true,
    job_id: String(jobId),
    tx: hash,
    explorer: `https://bscscan.com/tx/${hash}`,
    block: Number(receipt.blockNumber),
    deliverable_digest: deliverable,
    digest_algorithm: 'sha-256',
    bytes: bytes.length,
    provider: account.address,
  };
}
