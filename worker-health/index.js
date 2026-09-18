// The morning health run.
//
// scripts/health.mjs answers "is everything actually running" — when somebody
// runs it. From 2026-09-12 to 09-17 nobody did, and the whale recap was silent
// for six days behind a green heartbeat. This worker runs the same checks (the
// same file, scripts/lib/health-checks.mjs, not a copy) every day at 09:10 UTC
// and tells the operator on Telegram, in private.
//
// It writes every day, not only on red: one line when all is well, the failing
// checks by name when not. A watcher that speaks only on failure cannot be told
// apart from a watcher that has died, and the day without a message is the
// alarm for this worker itself.
//
// A false alarm is worse than no check, so red is asked twice: a check has to
// fail two runs, a minute apart, to be reported. Throttled endpoints and a slow
// RPC node recover within that; a stopped bot does not.
//
//   POST /run            (X-Broadcast-Secret)  run now, answer as JSON
//   POST /run?notify=1   (X-Broadcast-Secret)  … and send the Telegram message
import { runHealth } from '../scripts/lib/health-checks.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Pure: results in, message out. Exported for scripts/smoke-health-worker.mjs.
// THE DeFi AGENT HAS A LINE OF ITS OWN, EVERY DAY (2026-09-18). A green check is
// not named in this message, so the seven that watch the agent were invisible
// on the morning they were added — and the operator looked for them. The
// public card in the channel is the agent's own report and arrives even while
// it stands still (2026-09-17); this line is somebody else looking at it.
// No DeFi results (an older run, a fixture): no line.
export function defiLine(results) {
  const d = (results || []).filter((r) => r.area === 'DeFi');
  if (!d.length) return '';
  const bad = d.filter((r) => !r.good);
  const look = d.find((r) => /looked at its position/.test(r.name));
  const held = d.find((r) => /holds the ranges/.test(r.name));
  if (bad.length) return `🤖 <b>DeFi agent</b> · ${bad.length} of ${d.length} checks FAILING — ${esc(bad[0].name)}`;
  return `🤖 <b>DeFi agent</b> · ${d.length}/${d.length} ok${look && look.detail ? ` · ${esc(look.detail)}` : ''}${held && held.detail ? ` · ${esc(held.detail)}` : ''}`;
}
export function renderHealthMessage(results, failing, day) {
  const defi = defiLine(results);
  if (!failing.length) return `✅ <b>Health ${day}</b> · ${results.length}/${results.length} checks, everything running${defi ? '\n' + defi : ''}`;
  const lines = failing.slice(0, 12).map((r) => `❌ <b>${esc(r.area)}</b> · ${esc(r.name)}${r.detail ? `\n     <i>${esc(String(r.detail).slice(0, 160))}</i>` : ''}`);
  if (failing.length > 12) lines.push(`… and ${failing.length - 12} more`);
  return [`🚨 <b>Health ${day}</b> · ${failing.length} of ${results.length} checks FAILING (twice, a minute apart)`, '', ...lines, ...(defi ? ['', defi] : []), '', '<code>node scripts/health.mjs</code> for the full list'].join('\n');
}

// Pure: a check is failing only if it failed in both runs. A check that is
// missing from the second run (the run itself broke) stays failing.
export function failedTwice(first, second) {
  const key = (r) => r.area + '|' + r.name;
  const again = new Map(second.map((r) => [key(r), r]));
  return first.filter((r) => !r.good).map((r) => again.get(key(r)) || r).filter((r) => !r.good);
}

async function runOnce(env) {
  try {
    return await runHealth({
      rpc: env.BSC_RPC_URL || undefined,
      tgFetch: (url, init) => env.TG.fetch(url, init),
    });
  } catch (e) {
    return [{ area: 'Health', name: 'the health run itself completed', good: false, detail: e && e.message || String(e) }];
  }
}

async function morningRun(env, { notify, pauseMs = 60000 }) {
  const first = await runOnce(env);
  let results = first, failing = first.filter((r) => !r.good);
  if (failing.length) {
    await new Promise((r) => setTimeout(r, pauseMs));
    results = await runOnce(env);
    failing = failedTwice(first, results);
  }
  const text = renderHealthMessage(results, failing, new Date().toISOString().slice(0, 10));
  let sent = null;
  if (notify) {
    const r = await env.TG.fetch('https://tg/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-broadcast-secret': env.BROADCAST_SECRET || '' },
      body: JSON.stringify({ target: 'operator', text }),
    }).then((x) => x.json()).catch((e) => ({ ok: false, error: e && e.message || String(e) }));
    sent = r && r.ok === true && r.message_id != null;
    if (!sent) console.error('[HEALTH] the message did not go out:', JSON.stringify(r));
  }
  console.log(`[HEALTH] ${results.length} checks, ${failing.length} failing, sent=${sent}`);
  return { checks: results.length, failing, sent, text };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(morningRun(env, { notify: true }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) return new Response('forbidden', { status: 403 });
      const out = await morningRun(env, { notify: url.searchParams.get('notify') === '1', pauseMs: 20000 });
      return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    return new Response(JSON.stringify({ ok: true, worker: 'bobai-health', runs: 'daily 09:10 UTC, reports to the operator on Telegram' }), { headers: { 'content-type': 'application/json' } });
  },
};
