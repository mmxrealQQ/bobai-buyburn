#!/usr/bin/env node
// An agent that can spend, on a leash that anyone can read.
//
// Every wallet in this project is a raw private key with unlimited authority
// over whatever it holds. That is fine for a bot we wrote and run ourselves,
// and it is the wrong shape entirely for an agent that hires other agents:
// there is no way to say "this process may spend one dollar a day, only at the
// escrow kernel, and only until Friday", and no way for anybody else to check
// what it is allowed to do.
//
// Altana sessions are that missing shape. A session is a scoped delegation from
// a wallet's admin key to a second key: an allowlist of contracts and function
// signatures, a rolling spend cap per token, and an expiry. The account
// contract enforces it — a call outside the scope reverts at validation, not in
// our code — and the session's public key is written to the on-chain Keystore,
// so the limits are a public fact rather than a claim in a README. Revocation
// is one transaction and takes effect immediately.
//
// WHAT THIS SCRIPT DOES
//   --status     (default) what exists right now, read from the chain
//   --grant      grant the session and register it in the Keystore
//   --execute    spend through the session key: a real ERC-8183 job
//   --revoke     end it early
//   --self-test  pin the permission construction, no network
//
// Nothing that writes runs without --confirm. Money-moving scripts in this
// project plan by default, and a delegation of spending authority is exactly
// the kind of thing that should have to be asked for twice.
//
// TESTNET FIRST
// Chain 97 unless --mainnet. The grant, the Keystore registration and the job
// are real transactions either way; the testnet ones just cost nothing to get
// wrong. Note that the SDK's fundNative() does NOT work on this relay: it sends
// a mint() call to the zero address, the transaction succeeds, and no balance
// arrives. Fund the address this script prints from the public faucet instead.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  createClient, BNB, BNB_TESTNET, signerFromPrivateKey, ERC8183_ADDRESSES,
} from '@altananetwork/sdk';
import { createPublicClient, http, formatEther, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAINNET = process.argv.includes('--mainnet');
const CONFIRM = process.argv.includes('--confirm');
const SELF_TEST = process.argv.includes('--self-test');
const NET = MAINNET ? BNB : BNB_TESTNET;
const KERNEL = ERC8183_ADDRESSES[NET.chainId];

// The session file holds the session key's PRIVATE key — that is what makes it
// usable by an agent process without the admin key anywhere nearby. temp/ is
// gitignored; this must never move somewhere that is not.
const SESSION_FILE = path.join(ROOT, 'temp', 'altana', `session-${NET.chainId}.json`);

// ---- the leash ------------------------------------------------------------
// Written as a function of the kernel addresses rather than a literal, so the
// testnet run and the mainnet run are provably the same policy on different
// deployments — the usual way these diverge is a hand-edited address.
//
// The allowlist is two entries and no more:
//   · the ERC-8183 commerce kernel, where jobs are created, funded and settled
//   · $U, and only its approve() — the kernel pulls the escrow itself
// Everything else on the chain is outside the scope, including any transfer of
// $U to an address of our own choosing. A session that could do that would be a
// wallet with extra steps.
export function sessionPolicy(kernel, { limit, period = 'day', days = 7 } = {}) {
  return {
    permissions: {
      calls: [
        { to: kernel.commerce },
        { to: kernel.paymentToken, signature: 'approve(address,uint256)' },
      ],
      // $U carries 18 decimals on BNB Chain. The SDK's own documentation warns
      // that the same token is 6 decimals elsewhere, and a cap written for the
      // wrong decimals is a cap that is a million times too generous.
      spend: [{ limit, period, token: kernel.paymentToken }],
    },
    expiry: Math.floor(Date.now() / 1000) + days * 86400,
  };
}

// One dollar a day. The job census measured the whole ERC-8183 kernel holding
// 591.56 $U across 56,655 jobs ever — a dollar a day is a generous ceiling for
// a market that size, and small enough that a total compromise of the session
// key is a rounding error rather than an incident.
const DAILY_CAP = 1_000000000000000000n;

// ---- self-test -------------------------------------------------------------
if (SELF_TEST) {
  const fails = [];
  const k = ERC8183_ADDRESSES[97];
  const p = sessionPolicy(k, { limit: DAILY_CAP });

  // The allowlist has to actually list something. An empty or missing `calls`
  // means every target is allowed — the SDK says so explicitly — and that is
  // the one mistake here that would look identical to a working session right
  // up until the day it mattered.
  if (!p.permissions.calls?.length) fails.push('no call allowlist — an omitted `calls` grants every target on the chain');
  const targets = p.permissions.calls.map((c) => c.to?.toLowerCase());
  if (!targets.includes(k.commerce.toLowerCase())) fails.push('the kernel is not on the allowlist, so the session could not do the one job it exists for');
  if (targets.some((t) => t === undefined)) fails.push('an allowlist entry has no `to` — a signature-only rule allows that call on every contract that has it');

  // And it has to NOT list the things that would make it a general wallet.
  const tokenRule = p.permissions.calls.find((c) => c.to?.toLowerCase() === k.paymentToken.toLowerCase());
  if (!tokenRule?.signature) fails.push('$U is allowlisted without restricting the function — that permits transfer(), which is the whole treasury');
  if (tokenRule?.signature && /transfer|transferFrom/i.test(tokenRule.signature)) fails.push('the $U rule permits a transfer, which is not a payment through escrow but a withdrawal');

  // The cap must exist, be positive, and be denominated in the token's own
  // decimals. A cap of 1 with 18-decimal $U is not one dollar, it is a wei.
  const spend = p.permissions.spend?.[0];
  if (!spend) fails.push('no spend cap');
  if (spend && spend.limit <= 0n) fails.push('the spend cap is zero or negative');
  if (spend && spend.token?.toLowerCase() !== k.paymentToken.toLowerCase()) fails.push('the cap is on the wrong token, so $U is uncapped');
  if (spend && spend.limit === 1n) fails.push('a limit of 1 unit reads as one dollar and is one wei');
  if (spend && !['minute', 'hour', 'day', 'week', 'month', 'year'].includes(spend.period)) fails.push('the cap period is not one the SDK accepts, and an unaccepted period is not a cap');

  // Expiry must be in the future and not effectively never.
  const now = Math.floor(Date.now() / 1000);
  if (p.expiry <= now) fails.push('the session expires in the past');
  if (p.expiry > now + 365 * 86400) fails.push('the session lasts over a year, which is an expiry field with an expiry-shaped hole in it');

  // Same policy on both deployments, or the testnet run proves nothing about
  // the mainnet one.
  const pm = sessionPolicy(ERC8183_ADDRESSES[56], { limit: DAILY_CAP });
  const shape = (x) => JSON.stringify(x.permissions, (key, v) => (key === 'to' || key === 'token' ? '<addr>' : typeof v === 'bigint' ? String(v) : v));
  if (shape(p) !== shape(pm)) fails.push('the testnet and mainnet policies differ in shape — the testnet run would not be evidence for the mainnet one');
  const mainTargets = pm.permissions.calls.map((c) => c.to.toLowerCase());
  if (mainTargets.includes(k.commerce.toLowerCase())) fails.push('the mainnet policy allowlists a TESTNET address — the addresses did not come from the deployment it claims');

  if (fails.length) {
    console.error('self-test FAILED');
    for (const f of fails) console.error('  ' + f);
    process.exitCode = 1;
  } else {
    console.log('self-test passed: the allowlist names the kernel and only approve() on $U, the cap is positive and in the token\'s own decimals, the expiry is finite and ahead, and both deployments carry the same policy');
  }
}

if (!SELF_TEST) {
  // ---- keys ----------------------------------------------------------------
  // The admin key is the one that can grant and revoke. It is deliberately NOT
  // any of the wallets in scripts/lib/gas-wallets.mjs: the point of the exercise
  // is that the agent's authority is separable from the treasury's.
  let adminKey = process.env.ALTANA_ADMIN_PRIVATE_KEY;
  if (!adminKey) {
    adminKey = generatePrivateKey();
    fs.appendFileSync(path.join(ROOT, '.env'), `\nALTANA_ADMIN_PRIVATE_KEY=${adminKey}\n`);
    // The key itself is never printed. The address is public by nature.
    console.log(`generated a new admin key and appended it to .env (gitignored)`);
  }
  const admin = signerFromPrivateKey(adminKey);
  const adminAddress = privateKeyToAccount(adminKey).address;

  const client = createClient({ chains: [NET] });
  const wallet = await client.createWallet({ signer: admin });
  const pub = createPublicClient({ chain: NET.chain, transport: http(NET.publicRpcUrl) });

  const loadSession = () => {
    try {
      const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      // The signer is rebuilt rather than stored as an object: the SDK's Signer
      // carries a function, and JSON.parse cannot bring one back.
      return { ...raw, signer: signerFromPrivateKey(raw.signerPrivateKey), expiry: Number(raw.expiry) };
    } catch { return null; }
  };
  const saveSession = (s) => {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
      walletAddress: s.walletAddress,
      publicKey: s.publicKey,
      permissions: JSON.parse(JSON.stringify(s.permissions, (k, v) => (typeof v === 'bigint' ? String(v) : v))),
      expiry: s.expiry,
      signerPrivateKey: s.signer._privateKey,
      grantedAt: new Date().toISOString(),
      chainId: NET.chainId,
      transactionHash: s.transactionHash || null,
    }, null, 2));
  };

  const balance = await pub.getBalance({ address: wallet.address }).catch(() => null);
  const existing = loadSession();

  console.log(`Altana session — ${NET.chain.name} (chain ${NET.chainId})`);
  console.log(`  agent wallet   ${wallet.address}`);
  console.log(`  admin signer   ${adminAddress}`);
  console.log(`  balance        ${balance === null ? 'unreadable' : formatEther(balance) + ' ' + (MAINNET ? 'BNB' : 'tBNB')}`);
  console.log(`  keystore       ${NET.keyStore}`);
  console.log(`  kernel         ${KERNEL.commerce}`);
  console.log(`  $U             ${KERNEL.paymentToken}`);

  if (existing) {
    const left = existing.expiry - Math.floor(Date.now() / 1000);
    console.log(`\n  session        ${existing.publicKey}`);
    console.log(`  granted        ${existing.grantedAt}`);
    console.log(`  expires        ${new Date(existing.expiry * 1000).toISOString()} (${left > 0 ? `${(left / 3600).toFixed(1)} h left` : 'EXPIRED'})`);
    console.log(`  may call       ${existing.permissions.calls.map((c) => `${c.to}${c.signature ? ' :: ' + c.signature : ''}`).join('\n                 ')}`);
    console.log(`  may spend      ${existing.permissions.spend.map((s) => `${Number(BigInt(s.limit)) / 1e18} $U per ${s.period}`).join(', ')}`);
  } else {
    console.log('\n  session        none granted on this chain yet');
  }

  const want = (flag) => process.argv.includes(flag);

  if (want('--grant')) {
    const policy = sessionPolicy(KERNEL, { limit: DAILY_CAP });
    console.log('\nPlan — grant a session');
    console.log(`  allowlist   ${policy.permissions.calls.map((c) => `${c.to}${c.signature ? ' :: ' + c.signature : ''}`).join('\n              ')}`);
    console.log(`  spend cap   ${Number(policy.permissions.spend[0].limit) / 1e18} $U per ${policy.permissions.spend[0].period}`);
    console.log(`  expires     ${new Date(policy.expiry * 1000).toISOString()}`);
    console.log(`  registered  yes — written to the Keystore at ${NET.keyStore}, so the limits are readable by anyone`);
    if (!CONFIRM) {
      console.log('\nNothing granted. Re-run with --confirm.');
    } else if (balance !== null && balance === 0n) {
      // The relay returns a bare "0x" revert for an unfunded account, which is
      // indistinguishable from every other failure. Catching it here means the
      // operator gets the reason instead of the symptom.
      console.error(`\nThe agent wallet holds nothing, and the relay refuses the grant with an empty revert when it does.`);
      console.error(`Fund ${wallet.address} first${MAINNET ? '.' : ' from https://testnet.bnbchain.org/faucet-smart — the SDK\'s own fundNative() does not work against this relay (it mints to the zero address and reports success).'}`);
      process.exitCode = 1;
    } else {
      const s = await client.grantSession({ wallet, signer: admin, ...policy });
      saveSession(s);
      console.log(`\ngranted — public key ${s.publicKey}`);
      if (s.transactionHash) console.log(`  ${NET.explorer}/tx/${s.transactionHash}`);
      console.log(`  saved to ${path.relative(ROOT, SESSION_FILE)} (gitignored — it holds the session key)`);
    }
  }

  if (want('--execute')) {
    if (!existing) { console.error('\nNo session on this chain. Grant one first.'); process.exitCode = 1; }
    else {
      // The spend that proves the leash holds: an approve() of exactly the job
      // price, through the session key, on a contract that is on the allowlist.
      const price = 10000000000000n; // 0.00001 $U — a real transfer, a trivial amount
      const approve = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
      console.log('\nPlan — spend through the session key');
      console.log(`  call        approve(${KERNEL.commerce}, ${Number(price) / 1e18} $U) on $U`);
      console.log(`  signed by   the session key, not the admin key`);
      if (!CONFIRM) console.log('\nNothing sent. Re-run with --confirm.');
      else {
        const { encodeFunctionData } = await import('viem');
        const r = await client.execute({
          session: existing,
          calls: [{
            to: KERNEL.paymentToken,
            data: encodeFunctionData({ abi: approve, functionName: 'approve', args: [KERNEL.commerce, price] }),
          }],
        });
        console.log(`\nsent — ${NET.explorer}/tx/${r.transactionHash || r.id || ''}`);
      }
    }
  }

  if (want('--revoke')) {
    if (!existing) { console.error('\nNo session to revoke.'); process.exitCode = 1; }
    else {
      console.log('\nPlan — revoke the session');
      console.log(`  public key  ${existing.publicKey}`);
      console.log('  effect      immediate; the account contract stops validating calls from that key');
      if (!CONFIRM) console.log('\nNothing revoked. Re-run with --confirm.');
      else {
        const r = await client.revokeSession({ wallet, signer: admin, session: existing.publicKey });
        fs.rmSync(SESSION_FILE, { force: true });
        console.log(`\nrevoked — ${NET.explorer}/tx/${r.transactionHash || ''}`);
      }
    }
  }

  if (!want('--grant') && !want('--execute') && !want('--revoke')) {
    console.log('\n  --grant / --execute / --revoke   (each needs --confirm to write)');
  }
}
