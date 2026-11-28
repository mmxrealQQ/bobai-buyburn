// task-alarm-regressions.mjs (2026-11-28): the two local Windows tasks. "BOBAI jobs refresh" stopped every day from
// 21.11. to 28.11. on the Plaza refresh's own output (advantage.html) and nobody saw it. Pins: the jobs refresh accepts
// what the Plaza refresh writes and still refuses anything else; a stopped run reads red in health (taskLogVerdict);
// the alarm goes to the operator's private chat only, escaped, and never throws. Offline.
import { OWN_OUTPUT } from './jobs-refresh.mjs';
import { taskLogVerdict } from './lib/health-checks.mjs';
import { tellOperator } from './lib/task-alarm.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };

// what the jobs refresh lets through
ok('own: advantage.html (the Plaza refresh writes it)', OWN_OUTPUT.test('dashboard/advantage.html'));
ok('own: api-*.json and registry.html', OWN_OUTPUT.test('dashboard/api-registry.json') && OWN_OUTPUT.test('dashboard/registry.html'));
ok('foreign: other pages, the worker, nested files', !OWN_OUTPUT.test('dashboard/index.html') && !OWN_OUTPUT.test('dashboard/_worker.js') && !OWN_OUTPUT.test('dashboard/brain/advantage.html'));

// the health verdict on a task log
const now = Date.parse('2026-11-28T08:00:00Z');
const done = '[2026-11-28 06:30:02] jobs refresh started\n[2026-11-28 06:30:40] ok   job scan (7 s)\n[2026-11-28 06:31:50] done · live measured_at x\n';
const stopped = done + '[2026-11-28 07:30:02] jobs refresh started\n[2026-11-28 07:30:02] stopped before "job scan": dashboard/ holds work this chain did not write (dashboard/advantage.html) — nothing deployed\n';
ok('log: last run done 1.5 h ago -> green', taskLogVerdict(done, now).good === true);
ok('log: last run stopped -> red, with the reason', taskLogVerdict(stopped, now).good === false && /did not write/.test(taskLogVerdict(stopped, now).detail));
ok('log: done 30 h ago -> red', taskLogVerdict(done, now + 28 * 3600e3).good === false);
ok('log: FAIL live -> red', taskLogVerdict('[2026-11-28 06:30:02] jobs refresh started\n[2026-11-28 06:32:00] FAIL live measured_at a ≠ local b\n', now).good === false);
ok('log: a step FAIL then stopped -> red', taskLogVerdict('[2026-11-28 06:30:02] Plaza refresh started\n[2026-11-28 06:31:00] FAIL probe (9 s)\n[2026-11-28 06:31:00] stopped at "probe" — nothing after it ran\n', now).good === false);
ok('log: running 20 min -> green, 4 h -> red', taskLogVerdict('[2026-11-28 07:40:00] Plaza refresh started\n[2026-11-28 07:41:00] ok   scan (5 s)\n', now).good === true
  && taskLogVerdict('[2026-11-28 03:40:00] Plaza refresh started\n[2026-11-28 03:41:00] ok   scan (5 s)\n', now).good === false);
ok('log: empty or missing -> red', taskLogVerdict('', now).good === false && taskLogVerdict(null, now).good === false);
ok('log: CRLF lines read', taskLogVerdict(done.replace(/\n/g, '\r\n'), now).good === true);

// the alarm
{
  process.env.BROADCAST_SECRET = 'test-secret';
  let sent = null;
  const r = await tellOperator('stopped <b>x</b> & y', { fetchImpl: async (u, init) => { sent = { u, init, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ ok: true }) }; } });
  ok('alarm: to the operator only', sent && sent.body.target === 'operator' && /\/broadcast$/.test(sent.u));
  ok('alarm: HTML escaped', sent && sent.body.text === 'stopped &lt;b&gt;x&lt;/b&gt; &amp; y');
  ok('alarm: secret in the header', sent && sent.init.headers['x-broadcast-secret'] === 'test-secret');
  ok('alarm: once per text per day', sent && /^task-alarm:stopped <b>x<\/b> & y:\d{4}-\d\d-\d\d$/.test(sent.body.once));
  ok('alarm: answered', r.ok === true);
  const t = await tellOperator('x', { fetchImpl: async () => { throw new Error('network down'); } });
  ok('alarm: a failed send never throws', t.ok === false && /network down/.test(t.error));
}

console.log(`task-alarm-regressions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
