// WHAT A SHARE IS STILL OWED (2026-11-24, Liste B point 1, operator's go). The buyback bot (worker/index.js and the
// local fallback buyback-bot.js) pays the creator first, then buys, burns and adds liquidity. When a later leg failed,
// its BNB stayed on the wallet and the next run split it over all the shares again — the creator was paid a third of
// it a second time. Now a leg whose BNB demonstrably stayed (the wallet's balance did not drop by it) is written down
// as OWED to that leg; the next run pays what is owed first, to the same leg, and splits only the rest. A leg that may
// have spent its BNB (a swap that went through, a burn that did not) is never written down: in doubt the bot does what
// it did before, so nothing is ever paid twice.
//
// Shares that ended (BOB burn and BOB liquidity on Dec 1, the Giggle pot, the World Cup pool, the LP agent's tenth):
// what is still owed to them goes to BOBAI liquidity, the share that took the BOB burn's place (operator, 24.11.:
// "in die BOBAI-Liquiditaet"), or to the BOBAI burn while there is no BOBAI liquidity share.
//
// Pure: amounts are BigInt wei, nothing is read or sent here.

export const LEGS = ['creator', 'bobBurn', 'bobaiBurn', 'bobLiq', 'bobaiLiq', 'wc26', 'lpAgent', 'giggle'];
export const OWED_KEY = 'buyback-owed';   // the worker's KV key (LOGS); the local fallback keeps buyback-owed.json

// owed as kept: { leg: "wei as a string" } — anything else is read as nothing owed
export function readOwed(v) {
  const o = {};
  if (!v || typeof v !== 'object') return o;
  for (const [k, x] of Object.entries(v)) if (LEGS.includes(k) && k !== 'creator' && /^\d+$/.test(String(x)) && BigInt(x) > 0n) o[k] = BigInt(x);
  return o;
}
export function writeOwed(o) {
  const w = {};
  for (const [k, x] of Object.entries(o)) if (x > 0n) w[k] = String(x);
  return w;
}

// the run's plan: what is owed comes first (moved off an ended share), the rest is split by bps (BOBAI burn takes the
// rounding dust, as before). wait: what is owed is not covered by what is available — pay nothing, as the dev bot does.
export function planSplit(available, bps, owedIn, taxBps = 300) {
  const owed = {};
  const heir = (bps.bobaiLiq || 0) > 0 ? 'bobaiLiq' : 'bobaiBurn';
  for (const [leg, x] of Object.entries(readOwedBig(owedIn))) {
    const to = (bps[leg] || 0) > 0 || leg === 'bobaiBurn' ? leg : heir;
    owed[to] = (owed[to] || 0n) + x;
  }
  const owedTotal = Object.values(owed).reduce((a, x) => a + x, 0n);
  if (owedTotal >= available) return { wait: true, owed, owedTotal, base: 0n, amount: null };
  const base = available - owedTotal, amount = {};
  let rest = base;
  for (const leg of LEGS) {
    if (leg === 'bobaiBurn') continue;
    const x = (base * BigInt(bps[leg] || 0)) / BigInt(taxBps);
    amount[leg] = x; rest -= x;
  }
  amount.bobaiBurn = rest;
  for (const [leg, x] of Object.entries(owed)) amount[leg] = (amount[leg] || 0n) + x;
  return { wait: false, owed, owedTotal, base, amount };
}
// owed given either as kept strings or as BigInt
function readOwedBig(v) {
  if (!v || typeof v !== 'object') return {};
  const o = {};
  for (const [k, x] of Object.entries(v)) { const b = typeof x === 'bigint' ? x : /^\d+$/.test(String(x)) ? BigInt(x) : 0n; if (LEGS.includes(k) && k !== 'creator' && b > 0n) o[k] = b; }
  return o;
}

// after one leg: owed again only when it did not do its work AND its BNB is still on the wallet — the balance fell by
// less than a tenth of the leg (gas is far below that; a swap that went through took the whole amount)
export function stillOwed(amount, done, balBefore, balAfter) {
  if (done || amount <= 0n) return 0n;
  const fell = balBefore > balAfter ? balBefore - balAfter : 0n;
  return fell * 10n < amount ? amount : 0n;
}
