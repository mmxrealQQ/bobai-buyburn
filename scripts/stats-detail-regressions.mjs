#!/usr/bin/env node
// Pins the "what was asked for" counters behind agent.brainonbnb.com/stats/detail.
//
// Two halves, both offline, both run against the real worker code:
//   1. worker-agent: /hit takes a detail, one KV key per isolate and day, the
//      names are capped and cleaned, the smoke test is left out — and NOTHING
//      of it reaches count:*, the public totals of /stats.
//   2. dashboard/_worker.js: what it posts to /hit for an MCP request, for a
//      page of ours calling /api/, for a caller from outside, for a crawler
//      inventing routes and tool names.
//
//   node scripts/stats-detail-regressions.mjs      (self-tests.mjs runs it as it is)
//
// No network: every fetch to /hit is captured, anything else is refused.
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// dashboard/ and shared/ are ES modules served to Cloudflare, under a root
// package.json that does not say so; tell Node for this process only.
registerHooks({
  load(url, context, nextLoad) {
    return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? nextLoad(url, { ...context, format: 'module' }) : nextLoad(url, context);
  },
});

const ROOT = path.resolve(import.meta.dirname, '..');
const load = async (rel) => (await import(pathToFileURL(path.join(ROOT, rel)).href)).default;

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

const posted = [];
globalThis.fetch = async (u, init) => {
  if (String(u).startsWith('https://agent.brainonbnb.com/hit')) { posted.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
  throw new Error('offline test: no network (' + String(u).slice(0, 60) + ')');
};

// ---------------------------------------------------------------- worker-agent
console.log('worker-agent: /hit, the isolate key, /stats/detail');
{
  const worker = await load('worker-agent/index.js');
  const store = new Map();
  const env = {
    HIT_SECRET: 's3cret', X402_WALLET: '0x690E950214980BC329823A2DB2fD90C06Bd54dE4',
    AGENT: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
      list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    },
  };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(Promise.resolve(p).catch(() => {})) };
  const call = (p, init = {}) => worker.fetch(new Request('https://agent.brainonbnb.com' + p, init), env, ctx);
  const hit = (body, secret = 's3cret') => call('/hit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': secret }, body: JSON.stringify(body) });
  // The counters write every five minutes; the test moves the clock instead.
  const flush = async () => {
    const real = Date.now, at = real() + 6 * 60 * 1000;
    Date.now = () => at;
    try { await hit({ detail: 'mcp:ping' }); await Promise.all(waits); } finally { Date.now = real; }
  };

  ok('a hit without the secret is refused', (await hit({ kind: 'rest' }, 'nope')).status === 403);
  ok('a hit that names nothing is 400', (await hit({})).status === 400);
  ok('a kind alone still counts, as before', (await hit({ kind: 'rest' })).status === 200);
  ok('a detail alone is taken', (await hit({ detail: 'mcp:call:bsc_pool_scan' })).status === 200);
  await hit({ kind: 'rest', detail: ['rest:ext:pool-scan', 'ua:python'] });
  await hit({ kind: 'rest', detail: ['rest:ext:pool-scan', 'ua:node'] });
  await hit({ detail: 'MCP:Client:Claude AI <script>' });
  await call('/answer');
  await call('/answer', { headers: { 'user-agent': 'bobai-smoke-test' } });
  for (let i = 0; i < 400; i++) await hit({ detail: `junk:${i}` });
  await flush();

  const keys = [...store.keys()];
  const detailKeys = keys.filter((k) => k.startsWith('detail:'));
  ok('one detail key for this isolate and day', detailKeys.length === 1 && /^detail:\d{4}-\d\d-\d\d:[a-z0-9]+$/.test(detailKeys[0]), detailKeys.join());
  const r = await (await call('/stats/detail')).json();
  ok('a route asked twice reads 2', r.names['rest:ext:pool-scan'] === 2, String(r.names['rest:ext:pool-scan']));
  ok('the tool call is there', r.names['mcp:call:bsc_pool_scan'] === 1);
  ok('a name is cleaned, not trusted', r.names['mcp:client:claudeaiscript'] === 1, Object.keys(r.names).filter((n) => n.startsWith('mcp:client')).join());
  ok('the paid path names its step once; the smoke test is left out', r.names['sell:answer:index'] === 1, String(r.names['sell:answer:index']));
  ok('invented names are capped and fall to "other"', Object.keys(r.names).length <= 301 && r.names.other > 0, `${Object.keys(r.names).length} names`);
  const countKeys = keys.filter((k) => k.startsWith('count:'));
  ok('count:* holds the kinds only — no detail name reaches the public totals', countKeys.length === 1 && /^count:rest:/.test(countKeys[0]), countKeys.join());
  ok('and the public rest count is the 3 that were sent', Number(store.get(countKeys[0])) === 3, String(store.get(countKeys[0])));
  ok('a day that is no date is 400', (await call('/stats/detail?day=x')).status === 400);
  const empty = await (await call('/stats/detail?day=2020-01-01')).json();
  ok('a day without counts is empty, not an error', empty.isolates === 0 && Object.keys(empty.names).length === 0);
}

// ---------------------------------------------------------------- dashboard
console.log('\ndashboard/_worker.js: what is posted to /hit');
{
  const worker = await load('dashboard/_worker.js');
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(Promise.resolve(p).catch(() => {})) };
  const env = { HIT_SECRET: 'x', ASSETS: { fetch: async () => new Response('asset') } };
  const quiet = console.log; // the worker logs each MCP call
  const call = async (p, init = {}) => {
    posted.length = 0; console.log = () => {};
    try { await worker.fetch(new Request('https://brainonbnb.com' + p, init), env, ctx); await Promise.all(waits); } finally { console.log = quiet; }
  };
  const rpc = (method, params, headers = {}) => call('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const kinds = () => posted.filter((p) => p.kind).map((p) => p.kind).join();
  const details = () => posted.flatMap((p) => [].concat(p.detail || []));

  await rpc('initialize', { clientInfo: { name: 'Claude-AI 1.0' } }, { 'user-agent': 'python-httpx/0.27' });
  ok('initialize: the request is counted once as mcp', kinds() === 'mcp', kinds());
  ok('initialize: method, client software and caller family are named', ['mcp:initialize', 'mcp:client:claude-ai1.0', 'mcpua:python'].every((d) => details().includes(d)), details().join());
  await rpc('tools/list');
  ok('tools/list is named', details().includes('mcp:tools_list') && kinds() === 'mcp', details().join());
  await rpc('tools/call', { name: 'bobai_links' });
  ok('a tool of ours is named', details().includes('mcp:call:bobai_links'), details().join());
  await rpc('tools/call', { name: 'evil:<x>' });
  ok('a tool a caller made up is "unknown"', details().includes('mcp:call:unknown') && !details().some((d) => d.includes('evil')), details().join());
  await call('/api/links', { headers: { 'sec-fetch-site': 'same-origin', 'user-agent': 'Mozilla/5.0 Chrome' } });
  ok('a page of ours: rest:site, and no caller family', details().join() === 'rest:site:links' && kinds() === 'rest', details().join());
  await call('/api/links', { headers: { referer: 'https://brainonbnb.com/token', 'user-agent': 'Mozilla/5.0 Safari' } });
  ok('the referer alone says so too', details().join() === 'rest:site:links', details().join());
  await call('/api/links', { headers: { 'user-agent': 'node' } });
  ok('a caller from outside: rest:ext and its family', details().join() === 'rest:ext:links,ua:node', details().join());
  await call('/api/made-up-by-a-crawler', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SomeBot/1.0)' } });
  ok('a route we do not serve is "unknown"; a crawler is no browser', details().join() === 'rest:unknown,uaunknown:crawler' && kinds() === 'rest', details().join());
  await call('/api/.env', { headers: { 'sec-fetch-site': 'same-origin', referer: 'https://brainonbnb.com/', 'user-agent': 'Mozilla/5.0 Chrome' } });
  ok('and it stays "unknown" when it claims to come from our own page', details().join() === 'rest:unknown,uaunknown:browser', details().join());
  await rpc('tools/list', undefined, { 'user-agent': 'bobai-smoke-test' });
  ok('our smoke test posts nothing', posted.length === 0, JSON.stringify(posted));
}

console.log(fails ? `\n${fails} FAILED` : '\nstats-detail: all pins hold');
process.exit(fails ? 1 : 0);
