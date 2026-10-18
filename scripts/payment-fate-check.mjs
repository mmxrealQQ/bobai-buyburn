#!/usr/bin/env node
// scripts/payment-fate-check.mjs — every payment says where its money goes, and /buys shows it (2026-10-18)
//
// Operator, 18.10.: every payment buys $BOBAI, visibly — bundled in the daily sweep, not one by one (three transactions
// of gas would take about half of a 0.05 buy). The sweep itself (shared/lp-agent.js executeSweep) is not touched.
// Source: the three paid replies (answer, scan day pass, pool watch) carry paymentFate — what half buys, when, where to
// follow it. Live: GET /buys lists every payment with its $BOBAI status, the sweeps that bought, what waits under the gas
// floor and why, the income wallet's $BOBAI read from the chain — and agrees with /stats on the payments and on how
// many came from strangers. Nothing is paid here.
//
//   node scripts/payment-fate-check.mjs        exit 1 on any FAIL
import fs from 'node:fs';
import path from 'node:path';
const AGENT = 'https://agent.brainonbnb.com';
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + String(detail).slice(0, 150) : ''}`); };

{
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../worker-agent/index.js'), 'utf8');
  const n = (src.match(/\.\.\.paymentFate\(pay\)/g) || []).length;
  check(n === 3, 'the answer, the scan day pass and the pool watch replies say where the payment goes', `${n} of 3`);
  check(/buys \$BOBAI at the next sweep/.test(src) && /operator's revenue/.test(src), 'the sentence names the $BOBAI half and the operator half');
  const lp = fs.readFileSync(path.resolve(import.meta.dirname, '../shared/lp-agent.js'), 'utf8');
  check(/export const OPERATOR_SHARE_BPS = 5000n;/.test(lp), 'the sweep still splits 50/50 (what the sentence says)');
}
{
  const b = await (await fetch(`${AGENT}/buys?r=${Date.now()}`)).json().catch(() => null);
  const st = await (await fetch(`${AGENT}/stats`)).json().catch(() => ({}));
  check(!!b && b.rule?.to_bobai === '50%' && b.rule?.gas_floor_bnb === 0.004 && /0x[0-9a-fA-F]{40}/.test(b.income_wallet || ''), '/buys states the rule, the gas floor and the income wallet', b ? JSON.stringify(b.rule) : 'no answer');
  check(!!b && b.payments?.length === st.earned?.count, '/buys lists every payment /stats counts', `${b?.payments?.length} vs ${st.earned?.count}`);
  check(!!b && b.from_strangers === st.earned?.from_strangers?.count, 'and the same number from strangers', `${b?.from_strangers} vs ${st.earned?.from_strangers?.count}`);
  check(!!b?.payments && b.payments.every((p) => typeof p.bobai === 'string' && p.bobai.length > 10), 'every payment says what became of its $BOBAI half');
  check(!!b && Array.isArray(b.waiting) && b.waiting.every((w) => /floor|nothing/.test(w.why || '')), 'what waits is listed with the reason it waits', (b?.waiting || []).map((w) => `${w.balance} ${w.token}`).join(', '));
  check(!!b && typeof b.bobai_held_by_income_wallet === 'number', 'the income wallet\'s $BOBAI is read from the chain', b?.bobai_held_by_income_wallet);
  const one = b?.payments?.[0];
  if (one) {
    const t = await (await fetch(`${AGENT}/buys?tx=${encodeURIComponent(one.tx)}`)).json().catch(() => null);
    check(t?.payments?.length === 1 && t.payments[0].tx === one.tx, '/buys?tx= follows one payment', one.tx.slice(0, 20));
  }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
