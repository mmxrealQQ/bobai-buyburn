#!/usr/bin/env node
// A free tool asked at the paid door is answered free (2026-11-05).
// On 4.11. a visitor sent answer?service=bobai_price five times (tx hash, holder pass) and got "unknown service".
// Live pins: free tool name -> 200 free, with or without a proof; unknown name -> 400 charged:false; a real service -> 402.
const A = 'https://agent.brainonbnb.com/answer';
const UA = { 'user-agent': 'brainonbnb-answer-free-door-check/1' };
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const get = async (q, h = {}) => { const r = await fetch(`${A}?${q}`, { headers: { ...UA, ...h } }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };

const a = await get('service=bobai_price');
ok('GET bobai_price at the paid door answers free', a.s === 200 && a.j?.free === true && a.j?.charged === false && !!a.j?.answer, `${a.s}`);
const b = await get('service=bobai_price', { 'PAYMENT-SIGNATURE': '0x' + '1'.repeat(64) });
ok('a proof sent with a free tool is not used, the answer is free', b.s === 200 && b.j?.charged === false, `${b.s}`);
const c = await fetch(`${A}?service=bobai_price`, { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: '{}' });
ok('POST bobai_price answers free too', c.status === 200, `${c.status}`);
const d = await get('service=zz_no_such_tool');
ok('an unknown name says nothing was charged', d.s === 400 && d.j?.charged === false && /Nothing was charged/.test(d.j?.note || ''), `${d.s}`);
const real = await get('service=' + ((await get('')).j?.services?.[0]?.id || 'none'));
ok('a real paid service still answers 402 with the terms', real.s === 402, `${real.s}`);
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
