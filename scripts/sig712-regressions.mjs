// sig712 (Brainbook + Agent Wall, EIP-712 for the Binance Agentic Wallet). Pinned on a REAL signature: on 2026-11-23
// the operator's Binance Agentic Wallet "brainonbnb.ai" (0xcCCf2F2198e229027f6F61379a36E82D8F45958c) signed this exact
// Brainbook test message with `baw sign-message` (EIP712); nothing was posted. baw answers r||s without 0x plus
// signatureRecovery "00" — normSig must turn that into the 65-byte form and the signer must come back.
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { typedFor, typedJson, normSig, verifySigned, normSigType } from '../worker-agent/sig712.js';
import { guestbookMessage } from '../worker-agent/guestbook.js';

let pass = 0, fail = 0;
const say = (ok, t) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const WALLET = '0xcCCf2F2198e229027f6F61379a36E82D8F45958c';
const RAW = 'b317c1edde3ab1c144deb7bf837925f532f89f3c9f9cbda7b9d8d6b6f0dc20bf2b7bc032ce99449d8e684754241faec4af6a96462e8d233772c05101b833810f';
const msg = guestbookMessage({ agent: '49467', words: 'baw test, never posted', date: '2026-11-23' });

const sig = normSig(RAW, '00');
say(sig === '0x' + RAW + '1b', 'Binance raw (128 hex, no 0x) + signatureRecovery "00" -> 0x…1b');
say((await recoverTypedDataAddress({ ...typedFor('brainbook', msg), signature: sig })).toLowerCase() === WALLET.toLowerCase(), 'the real Binance Agentic Wallet signature recovers brainonbnb.ai (0xcCCf…958c)');
say(await verifySigned({ kind: 'brainbook', signer: WALLET, message: msg, signature: sig, sigType: 'eip712' }), 'verifySigned accepts it as eip712');
say(!(await verifySigned({ kind: 'wall', signer: WALLET, message: msg, signature: sig, sigType: 'eip712' })), 'the same signature does not pass for the Wall\'s domain');
say(!(await verifySigned({ kind: 'brainbook', signer: WALLET, message: msg, signature: sig, sigType: 'eip191' })), 'nor as personal_sign');
say(normSig('0x' + RAW + '00') === '0x' + RAW + '1b' && normSig(RAW + '01') === '0x' + RAW + '1c', 'v as 00/01 at the end becomes 1b/1c');
say(normSig('0x' + RAW + '1b') === '0x' + RAW + '1b', 'a usual 65-byte signature stays as it is');
say(normSig('nonsense', '00') === 'nonsense', 'anything else is left for the format check to refuse');
say(normSigType('EIP-712') === 'eip712' && normSigType(undefined) === 'eip191', 'sig_type spelled freely');
const tj = typedJson('wall', 'x');
say(tj.types.EIP712Domain.length === 3 && tj.domain.name === 'BOBAI Agent Wall' && tj.domain.chainId === 56, 'the typed data a wallet gets spells out EIP712Domain');
// a viem signer in the Binance shape round-trips too
const acc = privateKeyToAccount(generatePrivateKey()), t = await acc.signTypedData(typedFor('wall', msg));
const yp = parseInt(t.slice(-2), 16) - 27;
say(await verifySigned({ kind: 'wall', signer: acc.address, message: msg, signature: normSig(t.slice(2, 130), '0' + yp), sigType: 'eip712' }), 'any signer in the Binance shape (r||s + recovery) verifies');
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
