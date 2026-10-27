// The paid answer's 402, as a stock x402 client reads it (2026-10-27, operator's go after a stranger reviewed it: "the
// $BOBAI entry is encoded wrong for a standard client, nothing says what happens if delivery fails"). Live:
//   XO1 a direct transfer (USD1 or $BOBAI, paid by sending and handing the hash) is not under scheme "exact"; every
//       "exact" entry is a signature a stock client can make (eip3009 / permit2)
//   XO2 the $BOBAI entry's amount is what to send (the whole quote, in tokens), and min_arrival is the least accepted
//   XO3 the answer to "what if it fails" and the Permit2 approval step are in the 402 body
//   XO4 the header keeps $U named at the top (Marque reads it there, 2026-10-22) and accepts[0] stays USD1
//   node scripts/x402-offer-check.mjs
const UA = { 'user-agent': 'brainonbnb-test', 'content-type': 'application/json' };
let pass = 0, fail = 0;
const is = (name, ok, why = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !why ? '' : ' — ' + why}`); };
const r = await fetch('https://agent.brainonbnb.com/answer?service=health_factor', { method: 'POST', headers: UA, body: JSON.stringify({ task: 'health factor of 0x0000000000000000000000000000000000000001' }) });
const body = await r.json().catch(() => ({}));
const hdr = JSON.parse(Buffer.from(r.headers.get('payment-required') || '', 'base64').toString('utf8') || '{}');
const acc = hdr.accepts || [];
const direct = acc.filter((a) => a.extra?.assetTransferMethod === 'direct-transfer');
is('XO0 POST /answer without payment answers 402 with a PAYMENT-REQUIRED header', r.status === 402 && acc.length > 0, String(r.status));
is('XO1 no direct transfer under "exact"; every "exact" entry is eip3009 or permit2', direct.length >= 2 && direct.every((a) => a.scheme !== 'exact') && acc.filter((a) => a.scheme === 'exact').every((a) => ['eip3009', 'permit2'].includes(a.extra?.assetTransferMethod)), JSON.stringify(acc.map((a) => [a.scheme, a.extra?.assetTransferMethod, a.extra?.symbol || a.extra?.name])));
const bob = acc.find((a) => String(a.asset).toLowerCase() === '0x245c386dcfed896f5c346107596141e5edcbffff');
const tokens = body.in_bobai?.tokens;
is('XO2 the $BOBAI amount is the whole quote to send, min_arrival the least accepted', !!bob && tokens > 0 && BigInt(bob.amount) === BigInt(Math.ceil(tokens)) * 10n ** 18n && BigInt(bob.min_arrival || 0) > 0n && BigInt(bob.min_arrival) < BigInt(bob.amount), JSON.stringify({ amount: bob?.amount, min: bob?.min_arrival, tokens }));
is('XO3 the 402 says what happens if the answer fails, and the Permit2 approval', /credit/.test(body.if_the_answer_fails || '') && /not charged again/.test(body.if_the_answer_fails || '') && /0x000000000022D473030F116dDEE9F6B43aC78BA3/.test(body.usdc_via_permit2 || ''));
is('XO4 $U stays named at the top of the header (Marque), accepts[0] stays USD1', String(hdr.asset).toLowerCase() === '0xce24439f2d9c6a2289f741120fe202248b666666' && hdr.symbol === 'U' && String(acc[0]?.asset).toLowerCase() === '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', JSON.stringify({ asset: hdr.asset, symbol: hdr.symbol, first: acc[0]?.asset }));
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
