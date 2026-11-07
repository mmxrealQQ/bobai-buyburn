// THE HOLDER BADGE (7.11.): the link check, both ways. A real signature of the player's own message links; a signature by
// another wallet, of another player id, an old one or a broken one does not. Offline: a throwaway key, no chain.
//   node worker-pop/test4.mjs
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { checkLink, linkMessage, tierOf, normSig } from './wallet.js';
let pass = 0, fail = 0; const t = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey());
const pid = 'f00d0123456789ab', now = Date.now(), issued = new Date(now).toISOString(), W = a.address.toLowerCase();
const sign = (acc, p = pid, w = W, i = issued) => acc.signMessage({ message: linkMessage(p, w, i) });
const sig = await sign(a);
const ok = await checkLink({ pid, wallet: W, issued, signature: sig }, now);
t(ok.ok && ok.wallet === W, 'the wallet’s own signature links it', JSON.stringify(ok));
t((await checkLink({ pid, wallet: a.address, issued, signature: sig }, now)).ok, 'a checksummed address links too');
t((await checkLink({ pid, wallet: W, issued, signature: await sign(b) }, now)).status === 403, 'another wallet’s signature does not link it');
t((await checkLink({ pid: 'f00d9999999999ab', wallet: W, issued, signature: sig }, now)).status === 403, 'a signature for another player id does not link');
const old = new Date(now - 11 * 60e3).toISOString();
t((await checkLink({ pid, wallet: W, issued: old, signature: await sign(a, pid, W, old) }, now)).status === 400, 'a signature older than 10 minutes does not link');
const fut = new Date(now + 5 * 60e3).toISOString();
t((await checkLink({ pid, wallet: W, issued: fut, signature: await sign(a, pid, W, fut) }, now)).status === 400, 'a time in the future does not link');
t((await checkLink({ pid, wallet: W, issued, signature: '0x1234' }, now)).status === 400, 'a broken signature is refused');
t((await checkLink({ pid: 'xyz', wallet: W, issued, signature: sig }, now)).status === 400 && (await checkLink({ pid, wallet: '0x12', issued, signature: sig }, now)).status === 400, 'a bad pid or wallet is refused');
// v written as 0/1 or the EIP-155 way (147/148) still recovers the same wallet
const v = parseInt(sig.slice(-2), 16), p = v - 27, v01 = sig.slice(0, -2) + p.toString(16).padStart(2, '0'), v155 = sig.slice(0, -2) + (147 + p).toString(16);
t((await checkLink({ pid, wallet: W, issued, signature: v01 }, now)).ok && (await checkLink({ pid, wallet: W, issued, signature: v155 }, now)).ok, 'v as 0/1 and as 147/148 links', [normSig(v01).slice(-2), normSig(v155).slice(-2)].join(','));
t(tierOf(0) === null && tierOf(99_999.9) === null && tierOf(100_000) === 'holder' && tierOf(999_999) === 'holder' && tierOf(1_000_000) === 'pass', 'badges: none below 100k, holder from 100k, pass from 1M');
console.log(`holder badge test: ${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
