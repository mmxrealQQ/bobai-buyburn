// What the DeFi agent tells its operator AT ONCE, and what it keeps for the
// daily card. Pure: a tick's entry in, the messages out.
//
// Until 2026-09-18 the operator heard about the agent twice a day — the public
// card at 05:00 UTC and the health message at 09:10 — and both arrive while an
// agent stands still (09-16/17: a day, politely refusing every step with
// ok:true). What cannot wait for the morning:
//   - a step that failed (the money may be half way: unwound, not minted),
//   - a step that waits for a person ("which one to re-set is a decision for a
//     person") — the agent does nothing until somebody looks,
//   - the ladder record healed, a KV write that failed after a transaction,
//   - the money moving in a way it rarely does: a re-set of the main range
//     (with its direction, a merge, a resume from the wallet, the share's
//     sale), and every act of the ladder. Several of these had never run with
//     money when this was written, and the first time each one does is the
//     time to look at the chain.
// Routine is NOT told: a look that found nothing to do, a collect, a top-up.
//
// Each message carries a `key`. The worker remembers a key for `quietHours`
// and says nothing again while it does — a refusal repeats every ten minutes,
// and a message every ten minutes is a message nobody reads. Money events
// carry the ids they made, so they are said once by construction.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const PERSON = /decision (for )?a person|a person should make/i;
export const RECORD_URL = 'https://agent.brainonbnb.com/lp/agent';

export function alertsOf(entry) {
  if (!entry || entry.dry) return [];
  const out = [];
  const steps = Object.entries(entry.steps || {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x || {}]));
  const when = String(entry.at || '').slice(11, 16);
  const tx = (x) => (Array.isArray(x.txs) && x.txs.length ? ` · ${x.txs.length} tx, last <a href="https://bscscan.com/tx/${esc(x.txs[x.txs.length - 1].hash)}">${esc(String(x.txs[x.txs.length - 1].hash).slice(0, 10))}…</a>` : '');

  const waits = [];
  for (const [k, x] of steps) {
    if (x.error) {
      const sent = Array.isArray(x.txs) && x.txs.length;
      out.push({ key: `err:${k}:${hash(x.error)}`, quietHours: 6, text: `🚨 <b>DeFi agent · ${esc(k)} FAILED</b> (${when} UTC)\n${esc(String(x.error).slice(0, 240))}\n${sent ? `<b>${x.txs.length} transaction(s) had already gone through</b> — the money may be half way (unwound, not minted). The next hourly check tries to finish it; look at the wallet.${tx(x)}` : 'Nothing was sent.'}` });
    } else if (PERSON.test(String(x.why || ''))) {
      waits.push([k, x.why]);
    }
    if (x.kv_error) out.push({ key: `kv:${k}:${hash(x.kv_error)}`, quietHours: 6, text: `⚠️ <b>DeFi agent · ${esc(k)}</b>: the transaction went through, the record write did not (${esc(String(x.kv_error).slice(0, 160))}). The ladder record heals itself on the next tick — check that it did.` });
  }
  if (waits.length) out.push({ key: `person:${waits.map(([k]) => k).join('+')}`, quietHours: 12, text: `✋ <b>DeFi agent · ${esc(waits.map(([k]) => k).join(', '))} wait${waits.length === 1 ? 's' : ''} for a person</b> (${when} UTC)\n${esc(String(waits[0][1]).slice(0, 240))}\nThe agent does nothing there until somebody looks — this is how it stood still for a day on 2026-09-16.` });
  if (entry.error) out.push({ key: `err:tick:${hash(entry.error)}`, quietHours: 6, text: `🚨 <b>DeFi agent · the tick itself failed</b> (${when} UTC)\n${esc(String(entry.error).slice(0, 240))}` });

  const h = entry.ladder_healed;
  if (h) out.push({ key: `heal:${h.from}:${h.to}:${h.reserve_adopted || h.reserve_closed || ''}`, quietHours: 24, text: `🩹 <b>DeFi agent · ladder record healed</b> (${when} UTC)\n${esc(String(h.why || '').slice(0, 300))}` });

  const rb = (entry.steps || {}).rebalance;
  if (rb && rb.acted && !rb.error && rb.new_position) {
    const dir = rb.one_sided === 'below_price' ? 'UPWARD — the price left above the range; the new range is below the price, all BNB' : rb.one_sided === 'above_price' ? 'downward — the price left below the range; the new range is above the price, all ' + esc(rb.other_token || 'CAKE') : 'centred';
    const notes = [
      rb.resumed_from_wallet ? 'FINISHED FROM THE WALLET (an earlier re-set had stopped before its mint)' : null,
      rb.main_missing ? `the main range #${esc(rb.main_missing)} was gone, the reserve stood` : null,
      rb.merged_reserve ? `merged the reserve #${esc(rb.merged_reserve)} first` : null,
      rb.share_swap ? "sold the profit share's part of the CAKE fees" : null,
      rb.swap ? `a trade of ${esc(rb.swap.notional_bnb)} BNB (${esc(rb.swap.side)})` : 'no trade',
      rb.bobai_bnb > 0 ? `${esc(rb.bobai_bnb)} BNB into $BOBAI` : (rb.fees_forward_why ? esc(rb.fees_forward_why) : null),
    ].filter(Boolean);
    out.push({ key: `reset:${rb.new_position}`, quietHours: 720, text: `🔁 <b>DeFi agent · re-set ${dir}</b> (${when} UTC)\n#${esc(rb.position)} → #${esc(rb.new_position)}${Array.isArray(rb.new_ticks) ? `, ticks ${rb.new_ticks.join(' … ')}` : ''}${rb.width_pct != null ? `, ±${esc(rb.width_pct)}%` : ''} · ${notes.join(' · ')}${rb.gas_bnb != null ? ` · gas ${esc(rb.gas_bnb)} BNB` : ''}${tx(rb)}` });
  }
  const ld = (entry.steps || {}).ladder;
  if (ld && ld.acted && !ld.error) {
    const what = ld.merged_reserve ? `merged the reserve #${esc(ld.merged_reserve)} into the main range`
      : ld.old_reserve ? `re-set the reserve #${esc(ld.old_reserve)} → #${esc(ld.new_reserve)} beside the price`
      : ld.new_reserve ? `opened a reserve range #${esc(ld.new_reserve)} below the price with ${esc(ld.bnb_spent)} BNB`
      : `grew the reserve #${esc(ld.reserve)} by ${esc(ld.bnb_spent)} BNB (${esc(ld.reserve_side || '?')}${ld.swap ? ', bought the missing side first' : ', no trade'})`;
    out.push({ key: `ladder:${ld.new_reserve || ld.merged_reserve || ld.reserve}:${entry.at}`, quietHours: 720, text: `🪜 <b>DeFi agent · ladder</b> (${when} UTC)\n${what}${ld.new_reserve === null ? ' — THE NEW ID COULD NOT BE READ; the record heals on the next tick, check it' : ''}${tx(ld)}` });
  }
  return out.map((m) => ({ ...m, text: `${m.text}\n<a href="${RECORD_URL}">record</a>` }));
}
