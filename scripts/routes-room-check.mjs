#!/usr/bin/env node
// _routes.json has room (2026-11-13). Cloudflare Pages takes at most 100 include+exclude rules; on 12.11. it stood at
// 99, so the next new worker path would have failed the deploy. Held against:
//   room      at most 85 rules, so 15 new paths fit before anyone has to think about it again
//   coverage  every path the 99-rule list sent to the worker still goes to the worker (wildcards as Cloudflare reads
//             them: * matches anything, slashes included)
//   no grab   no file in dashboard/ that was served straight from the asset store now runs through the worker
// usage: node scripts/routes-room-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DASH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
const rules = JSON.parse(fs.readFileSync(path.join(DASH, '_routes.json'), 'utf8'));
const inc = rules.include || [], exc = rules.exclude || [];
const re = (r) => new RegExp('^' + r.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const matches = (list, p) => list.some((r) => re(r).test(p));
const routed = (p) => matches(inc, p) && !matches(exc, p);

// the 99 rules of 12.11. (commit f0e4609), the paths they named
const OLD = ['/api/*', '/openapi.json', '/mcp', '/mcp/*', '/join', '/join/', '/join.txt', '/ask/', '/fix/', '/fix', '/ask', '/learn/*', '/learn', '/board-hook', '/logs/*', '/.well-known/agent-card.json', '/.well-known/agent.json', '/.well-known/agent-registration.json', '/skill.md', '/sitemap.xml', '/.well-known/skills/index.json', '/.well-known/agent-skills/index.json', '/.well-known/x402', '/source.git', '/source.git/*', '/m/*', '/buy', '/', '/index.html', '/classic', '/classic/', '/brain', '/brain/', '/brain/index.html', '/scanner', '/scanner.html', '/registry', '/registry.html', '/list', '/list.html', '/services', '/services.html', '/defi', '/defi/', '/defi/.well-known/agent-card.json', '/defi.html', '/nft', '/nft/', '/library', '/library.html', '/whitepaper', '/whitepaper.html', '/advantage', '/advantage.html', '/session', '/session.html', '/source', '/source.html', '/token', '/token.html', '/faq', '/faq.html', '/roadmap', '/roadmap.html', '/archive', '/archive.html', '/screener', '/screener.html', '/agent', '/agent/*', '/agent.html', '/brainscreener', '/brainscreener/*', '/game', '/game/*', '/worldcup', '/worldcup/*', '/builder', '/builder/*', '/og/*', '/board', '/board.html', '/board/*', '/board.md', '/board.atom', '/jobs', '/jobs.html', '/settle', '/settle.html', '/venus', '/venus.html', '/pancakeswap', '/pancakeswap.html', '/pass', '/pass.html', '/set-and-earn', '/set-and-earn.html', '/ar', '/ar/*'];

let fails = 0;
const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };

const n = inc.length + exc.length;
say(n <= 85, `room: ${n} of 100 rules (at most 85, so 15 new paths fit)`);

const sample = (r) => r.replace(/\*/g, 'x/y');   // a wildcard rule stands for a path below it
const lost = OLD.filter((r) => !routed(sample(r)));
say(lost.length === 0, `coverage: every path of the old list still reaches the worker${lost.length ? ' — lost: ' + lost.join(' ') : ''}`);

const files = [];
(function walk(dir, rel) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.')) continue;
    const r = rel + '/' + f.name;
    if (f.isDirectory()) walk(path.join(dir, f.name), r); else files.push(r);
  }
})(DASH, '');
const oldRouted = (p) => matches(OLD, p);
const grabbed = files.filter((p) => routed(p) && !oldRouted(p));
say(grabbed.length === 0, `no grab: no static file newly runs through the worker${grabbed.length ? ' — ' + grabbed.slice(0, 10).join(' ') : ''}`);

console.log(fails ? `\n${fails} FAILING` : '\nall pass');
process.exit(fails ? 1 : 0);
