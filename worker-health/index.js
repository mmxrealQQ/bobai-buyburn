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
// One check needs two looks ten minutes apart — the buyback wallet holding tax
// through a run of its bot. The morning message goes out FIRST, as always; the
// second look comes after it, and only a red one is told, in a message of its
// own. The daily message never waits on anything.
//
//   POST /run            (X-Broadcast-Secret)  run now, answer as JSON
//   POST /run?notify=1   (X-Broadcast-Secret)  … and send the Telegram message
import { runHealth, runLight, readBuybackLook, buybackWalletVerdict, msToSecondLook } from '../scripts/lib/health-checks.mjs';

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

async function morningRun(env, { notify, pauseMs = 60000, secondLook = false }) {
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
  const waiting = results.find((r) => r.recheck && r.look);
  if (secondLook && waiting) await buybackSecondLook(env, waiting.look, { notify });
  return { checks: results.length, failing, sent, text, second_look: !!waiting };
}

// Pure: the second look's message, or '' when there is nothing to tell.
export function secondLookMessage(verdict) {
  return verdict && verdict.good === false ? `🚨 <b>Buyback bot</b> · the tax is not being split\n     <i>${esc(verdict.detail)}</i>\n\nworker <code>bobai-cron-trigger</code> — logs.brainonbnb.com` : '';
}
async function buybackSecondLook(env, prior, { notify }) {
  await new Promise((r) => setTimeout(r, msToSecondLook()));
  const verdict = buybackWalletVerdict(await readBuybackLook(env.BSC_RPC_URL || undefined), prior);
  // A wallet that could not be read is not a bot that stands still.
  const text = /could not be read/.test(verdict.detail) ? '' : secondLookMessage(verdict);
  console.log(`[HEALTH] buyback second look: ${verdict.good ? 'ok' : 'RED'} — ${verdict.detail}`);
  if (!text || !notify) return;
  await env.TG.fetch('https://tg/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-broadcast-secret': env.BROADCAST_SECRET || '' },
    body: JSON.stringify({ target: 'operator', text }),
  }).catch((e) => console.error('[HEALTH] the second-look message did not go out:', e && e.message || e));
}

// THE HOURLY LIGHT RUN (2026-10-09). Cron LIGHT_CRON: the Telegram bot's heartbeat and whether it can post, and the
// buyback bot's heartbeat (lightVerdicts). Silent when green — the morning message is the daily proof of life; this
// one exists for the hours between. Red is asked twice, a minute apart, as in the morning. The message goes through
// the bot's /broadcast; when that fails (the bot is what broke), an e-mail through Resend is the second way, if its
// secrets are set (RESEND_API_KEY, ALERT_EMAIL_TO); without them it is logged and skipped.
export const LIGHT_CRON = '40 * * * *';
export function renderLightMessage(failing, at) {
  return [`🚨 <b>Health ${at} UTC</b> · hourly look: ${failing.length} FAILING (twice, a minute apart)`, '',
    ...failing.map((r) => `❌ <b>${esc(r.area)}</b> · ${esc(r.name)}${r.detail ? `\n     <i>${esc(String(r.detail).slice(0, 160))}</i>` : ''}`)].join('\n');
}
async function sendOperator(env, text) {
  const r = await env.TG.fetch('https://tg/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-broadcast-secret': env.BROADCAST_SECRET || '' },
    body: JSON.stringify({ target: 'operator', text }),
  }).then((x) => x.json()).catch((e) => ({ ok: false, error: e && e.message || String(e) }));
  return !!(r && r.ok === true && r.message_id != null);
}
export async function emailFallback(env, text, doFetch = fetch) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO) { console.error('[HEALTH] fallback skipped: RESEND_API_KEY / ALERT_EMAIL_TO not set'); return 'not configured'; }
  const plain = String(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const r = await doFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'BOBAI Health <health@mail.brainonbnb.ai>', to: [env.ALERT_EMAIL_TO], subject: plain.split('\n')[0].slice(0, 120), text: plain }),
  }).catch((e) => ({ ok: false, status: 0, e }));
  return r && r.ok ? 'sent' : `refused (${r && r.status})`;
}
async function lightRun(env, { notify, pauseMs = 60000 }) {
  const once = async () => { try { return await runLight({ tgFetch: (url, init) => env.TG.fetch(url, init) }); } catch (e) { return [{ area: 'Health', name: 'the hourly look itself completed', good: false, detail: e && e.message || String(e) }]; } };
  const first = await once();
  let failing = first.filter((r) => !r.good);
  if (failing.length) { await new Promise((r) => setTimeout(r, pauseMs)); failing = failedTwice(first, await once()); }
  if (!failing.length) { console.log('[HEALTH] hourly look: all green'); return { checks: first.length, failing: [], sent: null }; }
  const text = renderLightMessage(failing, new Date().toISOString().slice(0, 16).replace('T', ' '));
  let sent = null, fallback = null;
  // ONCE PER PROBLEM, NOT EVERY HOUR (2026-10-09): a red that lasts was sent at every hourly look — up to 24 messages.
  // The same failing set is told again only after 6 h; a new or different red is told at once. Kept in the edge cache
  // (this worker has no KV); a cache miss in another colo can at worst repeat one message.
  const key = failing.map((r) => `${r.area}|${r.name}`).sort().join(' ; ');
  const memo = new Request('https://health.internal/light-last');
  if (notify && globalThis.caches) {
    const last = await caches.default.match(memo).then((r) => (r ? r.json() : null)).catch(() => null);
    if (last && last.key === key && Date.now() - last.at < 6 * 3600e3) { console.log('[HEALTH] hourly look: same red as told', Math.round((Date.now() - last.at) / 60e3), 'min ago — not repeated'); return { checks: first.length, failing, sent: null, repeated: false, text }; }
  }
  if (notify) {
    sent = await sendOperator(env, text);
    if (!sent) fallback = await emailFallback(env, text);
    if (sent && globalThis.caches) await caches.default.put(memo, new Response(JSON.stringify({ key, at: Date.now() }), { headers: { 'cache-control': 'max-age=86400' } })).catch(() => {});
  }
  console.log(`[HEALTH] hourly look: ${failing.length} failing, sent=${sent}, fallback=${fallback}`);
  return { checks: first.length, failing, sent, fallback, text };
}

export default {
  async scheduled(event, env, ctx) {
    if (event && event.cron === LIGHT_CRON) { ctx.waitUntil(lightRun(env, { notify: true })); return; }
    ctx.waitUntil(morningRun(env, { notify: true, secondLook: true }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/light' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) return new Response('forbidden', { status: 403 });
      const out = await lightRun(env, { notify: url.searchParams.get('notify') === '1', pauseMs: 20000 });
      return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/run' && request.method === 'POST') {
      const got = request.headers.get('x-broadcast-secret') || '';
      if (!env.BROADCAST_SECRET || got !== env.BROADCAST_SECRET) return new Response('forbidden', { status: 403 });
      const out = await morningRun(env, { notify: url.searchParams.get('notify') === '1', pauseMs: 20000 });
      return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    return new Response(JSON.stringify({ ok: true, worker: 'bobai-health', runs: 'daily 09:10 UTC, reports to the operator on Telegram; hourly at :40 a light look that speaks only on red' }), { headers: { 'content-type': 'application/json' } });
  },
};
