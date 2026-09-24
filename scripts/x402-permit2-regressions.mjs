// The reading of a standard x402 Permit2 payment (shared/x402-permit2.js),
// both ways, offline. It decides whether an answer goes out before the money
// has moved, so every field that could send the money elsewhere, make it
// smaller or let it expire before worker-lp settles it is pinned here.
//   node scripts/x402-permit2-regressions.mjs      (self-tests.mjs runs it)
import { permit2Mismatch, settleCalldata, permit2Id, transferredIn, PERMIT2_PROXY } from '../shared/x402-permit2.js';
import { decodeFunctionData } from 'viem';
import { SETTLE_ABI } from '../shared/x402-permit2.js';

let fails = 0, n = 0;
const ok = (name, cond) => { n++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}`); };

const NOW = 1790240000;
const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const PAYTO = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';
const BUYER = '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963';
const req = { asset: USDC, amount: '100000000000000000', payTo: PAYTO };
const good = () => ({
  signature: '0x' + 'ab'.repeat(65),
  permit2Authorization: {
    from: BUYER, spender: '0x402085c248EeA27D92E8b30b2C58ed07f9E20001',
    permitted: { token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', amount: '100000000000000000' },
    nonce: '123', deadline: String(NOW + 3600), witness: { to: PAYTO, validAfter: '0' },
  },
});
const with_ = (f) => { const p = good(); f(p.permit2Authorization, p); return p; };
const at = { nowSec: NOW };

ok('a payment of the price, to us, through the proxy, an hour to run: accepted', permit2Mismatch(good(), req, at) === null);
ok('… addresses in any case are the same addresses', permit2Mismatch(with_((a) => { a.from = a.from.toLowerCase(); a.witness.to = a.witness.to.toUpperCase().replace('0X', '0x'); }), req, at) === null);
ok('more than the price is accepted', permit2Mismatch(with_((a) => { a.permitted.amount = '200000000000000000'; }), req, at) === null);
ok('less than the price is refused', /smaller/.test(permit2Mismatch(with_((a) => { a.permitted.amount = '99999999999999999'; }), req, at)));
ok('another token is refused', /another token/.test(permit2Mismatch(with_((a) => { a.permitted.token = '0x55d398326f99059ff775485246999027b3197955'; }), req, at)));
ok('money to another address is refused', /another address/.test(permit2Mismatch(with_((a) => { a.witness.to = BUYER; }), req, at)));
ok('another spender than the proxy is refused', /another spender/.test(permit2Mismatch(with_((a) => { a.spender = BUYER; }), req, at)));
ok('an authorization that runs out before two cron runs is refused at the door', /expires within 20 minutes/.test(permit2Mismatch(with_((a) => { a.deadline = String(NOW + 600); }), req, at)));
ok('… the queue itself only asks that it has not expired', permit2Mismatch(with_((a) => { a.deadline = String(NOW + 600); }), req, { nowSec: NOW, minLifeSec: 0 }) === null);
ok('… and an expired one is refused there too', /expires/.test(permit2Mismatch(with_((a) => { a.deadline = String(NOW - 1); }), req, { nowSec: NOW, minLifeSec: 0 })));
ok('not valid yet is refused', /not valid yet/.test(permit2Mismatch(with_((a) => { a.witness.validAfter = String(NOW + 60); }), req, at)));
ok('no signature is refused', /signature/.test(permit2Mismatch(with_((_a, p) => { p.signature = ''; }), req, at)));
ok('an EIP-3009 payment is not read as Permit2', permit2Mismatch({ signature: '0x1', authorization: {} }, req, at) === 'not a Permit2 payment');
ok('a number that is not a number is refused, not thrown', /not a number/.test(permit2Mismatch(with_((a) => { a.nonce = 'x'; }), req, at)));

// The calldata is the proxy's settle with exactly the signed fields.
const d = decodeFunctionData({ abi: SETTLE_ABI, data: settleCalldata(good()) });
ok('the calldata is settle(), with the signed amount, owner and recipient', d.functionName === 'settle' && d.args[0].permitted.amount === 100000000000000000n && d.args[1].toLowerCase() === BUYER.toLowerCase() && d.args[2].to.toLowerCase() === PAYTO.toLowerCase() && d.args[3] === good().signature);
ok('the id is payer and nonce, which the chain settles once', permit2Id(good()) === `permit2:${BUYER.toLowerCase()}:123` && PERMIT2_PROXY === '0x402085c248eea27d92e8b30b2c58ed07f9e20001');

// A receipt counts only the transfer from the payer to us in the token asked.
const pad = (x) => '0x' + x.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const log = (token, from, to, v) => ({ address: token, topics: [T, pad(from), pad(to)], data: '0x' + BigInt(v).toString(16) });
ok('a transfer from the payer to us is counted', transferredIn([log(USDC, BUYER, PAYTO, 10n ** 17n)], USDC, BUYER, PAYTO) === 10n ** 17n);
ok('a transfer to anybody else, from anybody else or in another token is not', transferredIn([log(USDC, BUYER, BUYER, 10n ** 17n), log(USDC, PAYTO, PAYTO, 5n), log('0x55d398326f99059ff775485246999027b3197955', BUYER, PAYTO, 7n)], USDC, BUYER, PAYTO) === 0n);

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nx402 Permit2: ${n} pins hold both ways`);
process.exit(fails ? 1 : 0);
