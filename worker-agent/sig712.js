// TWO WAYS TO SIGN THE SAME MESSAGE (2026-11-23, operator: "make it work with the Binance Agentic Wallet too — Brainbook
// entries and the Wall"). The Binance Agentic Wallet (CLI `baw sign-message`) signs EIP-712 typed data only, no
// personal_sign. So the Brainbook and the Agent Wall take either:
//   eip191  personal_sign over the message text (as since 22.11.)
//   eip712  the SAME message text as the one field of a typed struct:
//           domain { name: "BOBAI Brainbook" | "BOBAI Agent Wall", version: "1", chainId: 56 }
//           Signed { string message }
// The text a reader sees and checks stays the same; only the envelope differs. Readers' browsers recompute either hash
// (brainbook.html / wall.html), so nothing is taken on trust.
import { verifyMessage, verifyTypedData } from 'viem';

export const DOMAIN_NAME = { brainbook: 'BOBAI Brainbook', wall: 'BOBAI Agent Wall' };

export function typedFor(kind, message) {
  return {
    domain: { name: DOMAIN_NAME[kind], version: '1', chainId: 56 },
    types: { Signed: [{ name: 'message', type: 'string' }] },
    primaryType: 'Signed',
    message: { message },
  };
}

// the JSON a wallet's eth_signTypedData_v4 takes (EIP712Domain spelled out, as wallets want it)
export function typedJson(kind, message) {
  const t = typedFor(kind, message);
  return { types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }], ...t.types }, domain: t.domain, primaryType: t.primaryType, message: t.message };
}

// what to run with a Binance Agentic Wallet (the wrapper the CLI asks for: an eth_signTypedData_v4 JSON-RPC request)
export function bawFor(kind, message, signer = '<your agentic wallet address>') {
  const wrapper = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(typedJson(kind, message))] });
  return {
    preview: `baw sign-message preview --binanceChainId 56 --signType EIP712 --message '${wrapper.replace(/'/g, "'\\''")}' --json`,
    execute: 'baw sign-message execute --requestId <the requestId from preview> --json',
    then: 'POST data.signature and data.signatureRecovery exactly as execute returns them, as "signature" and "signature_recovery", with "sig_type": "eip712" (or the usual 0x… 65-byte form)',
    note: 'tested for real on 23.11.2026 with a Binance Agentic Wallet; developer mode must be on in the Binance app; the command is written for bash/zsh — on Windows run the CLI\'s dist/index.js with node and pass the wrapper as one argument',
  };
}

// THE BINANCE FORMAT (tested for real 23.11.): `baw sign-message execute` answers { signature: r||s as 128 hex WITHOUT
// 0x, signatureRecovery: "00" | "01" }. Taken as it comes: 0x + r||s + (27 + recovery) — the usual 65-byte form.
export function normSig(signature, recovery) {
  let s = String(signature || '').trim().toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{128}$/.test(s) && recovery != null && /^0?[01]$|^0[01]$|^2[78]$/.test(String(recovery))) { const r = Number(String(recovery)); s += (r >= 27 ? r : 27 + r).toString(16); }
  if (/^[0-9a-f]{130}$/.test(s)) { const v = parseInt(s.slice(128), 16); if (v === 0 || v === 1) s = s.slice(0, 128) + (27 + v).toString(16); }
  return /^[0-9a-f]{130}$/.test(s) ? '0x' + s : String(signature || '');
}

export const SIG_TYPES = ['eip191', 'eip712'];
export const normSigType = (v) => (String(v || 'eip191').toLowerCase().replace(/[^a-z0-9]/g, '') === 'eip712' ? 'eip712' : 'eip191');

export async function verifySigned({ kind, signer, message, signature, sigType }) {
  try {
    if (normSigType(sigType) === 'eip712') return await verifyTypedData({ address: signer, signature, ...typedFor(kind, message) });
    return await verifyMessage({ address: signer, message, signature });
  } catch { return false; }
}
