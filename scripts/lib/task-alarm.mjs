// THE LOCAL TASKS SAY WHEN THEY STOP (2026-11-28, operator: "ja, mach 1"). The Windows task "BOBAI jobs refresh" stopped
// every day from 21.11. to 28.11. ("dashboard/ holds work this chain did not write") and nobody saw it: its log is on
// this machine, and the daily health message is written by a Cloudflare Worker that cannot read it. Now a stopped or
// failed run of the Plaza refresh or the jobs refresh sends one line to the operator's private Telegram chat (the TG
// bot's /broadcast with target operator — never the group), and scripts/health.mjs reads both logs (taskLogVerdict).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function secret() {
  if (process.env.BROADCAST_SECRET) return process.env.BROADCAST_SECRET;
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^BROADCAST_SECRET=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

// one line to the operator's private chat; never throws (a task's own result must not hang on Telegram)
export async function tellOperator(text, { fetchImpl = fetch } = {}) {
  const s = secret();
  if (!s) return { ok: false, error: 'no BROADCAST_SECRET' };
  try {
    const r = await fetchImpl('https://bobai-tg-bot.bobbuildonbnb.workers.dev/broadcast', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-broadcast-secret': s },
      body: JSON.stringify({ text: String(text).slice(0, 900).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), target: 'operator', once: 'task-alarm:' + String(text).slice(0, 100) + ':' + new Date().toISOString().slice(0, 10) }),
      signal: AbortSignal.timeout(15000),
    });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
