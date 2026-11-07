// THE HOLDER BADGE (2026-11-07, operator: "option 1 — Brain Pop as the way to $BOBAI"): a player may show on the boards
// that they hold $BOBAI. The badge is earned, never claimed: the player signs (personal_sign, no transaction, no gas) a
// message that names their player id and wallet, the server recovers the signer and reads the wallet's $BOBAI from the
// chain. Only the badge reaches a board, never the wallet. Gameplay and scores do not change in any way.
//   🧠 holder  100,000 $BOBAI or more      💎 pass  1,000,000 $BOBAI or more (the holder pass line of the ecosystem)
import { recoverMessageAddress } from 'viem';

export const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
export const TIERS = [['pass', 1_000_000], ['holder', 100_000]];
export const tierOf = (bobai) => { for (const [t, min] of TIERS) if (bobai >= min) return t; return null; };
export const PROOF_MS = 10 * 60e3, FUTURE_MS = 2 * 60e3, STALE_MS = 6 * 3600e3;
export const linkMessage = (pid, wallet, issued) => `BOBAI Brain Pop holder badge\nplayer: ${pid}\nwallet: ${String(wallet).toLowerCase()}\nissued: ${issued}`;

// some wallets write v as 0/1 or the EIP-155 way (147/148 on BNB Chain); only its parity matters (as worker-agent/holder-pass.js)
export function normSig(sig) {
  const s = String(sig || '').trim();
  if (!/^0x[0-9a-fA-F]{130}$/.test(s)) return s;
  const v = parseInt(s.slice(-2), 16);
  const nv = v >= 35 ? 27 + ((v - 35) % 2) : v < 27 ? 27 + (v % 2) : v;
  return s.slice(0, -2) + nv.toString(16).padStart(2, '0');
}

const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
export async function balanceOf(wallet, fetchFn = fetch) {
  const data = '0x70a08231' + wallet.slice(2).toLowerCase().padStart(64, '0');
  for (const rpc of RPCS) {
    try {
      const r = await fetchFn(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BOBAI, data }, 'latest'] }), signal: AbortSignal.timeout(6000) });
      const j = await r.json(); if (!j.result || j.result === '0x') continue;
      return Number(BigInt(j.result) / 10n ** 14n) / 1e4;
    } catch {}
  }
  return null; // the chain did not answer: the caller keeps what it had
}

// a link request → { ok, wallet } or { ok: false, status, error }
export async function checkLink(b, now = Date.now()) {
  const pid = String(b.pid || ''), wallet = String(b.wallet || '').toLowerCase(), issued = String(b.issued || '');
  if (!/^[0-9a-f]{16}$/.test(pid)) return { ok: false, status: 400, error: 'pid (16 hex) needed' };
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return { ok: false, status: 400, error: 'wallet: 0x and 40 hex characters' };
  const t = Date.parse(issued);
  if (!Number.isFinite(t) || now - t > PROOF_MS || t - now > FUTURE_MS) return { ok: false, status: 400, error: 'issued must be an ISO time within the last 10 minutes: sign again' };
  let signer = '';
  try { signer = (await recoverMessageAddress({ message: linkMessage(pid, wallet, issued), signature: normSig(b.signature) })).toLowerCase(); } catch { return { ok: false, status: 400, error: 'the signature does not read' }; }
  if (signer !== wallet) return { ok: false, status: 403, error: 'the signature is not from this wallet' };
  return { ok: true, pid, wallet };
}
