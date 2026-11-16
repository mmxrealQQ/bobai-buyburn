// Pins what we SAY about the Rug Watch to what it does (2026-11-16, Liste A "Texte"): since 5.11. a watch runs without
// a callback too (poll mode: the alerts wait at GET /rug-watch/<id>?since=…), so no public text may call it "webhook
// only"; and a holder wallet gets up to 25 watches, never "unlimited". The Agent Watch is webhook only for real.
//   node scripts/rug-watch-texts-regressions.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const w = read('dashboard/_worker.js'), cat = read('worker-agent/x402-catalog.js'), rw = read('worker-agent/rug-watch.js');

// the code really has the poll mode the texts now describe
ok('rug-watch.js: a watch without a callback is delivery "poll"', /delivery: callback \? 'webhook' : 'poll'/.test(rw));
// public descriptions: the A2A card's rug_watch skill, the MCP tool, the x402 catalog row
const skill = (w.match(/\{ id: 'rug_watch',[\s\S]*?tags:/) || [''])[0];
ok('A2A card rug_watch: not "Webhook only", names the way without a callback', skill && !/webhook only/i.test(skill) && /without one/.test(skill), skill.slice(0, 120));
const row = (cat.match(/\| \\`POST https:\/\/agent\.brainonbnb\.com\/rug-watch\\` \|[^\n]*/) || [''])[0];
ok('x402 catalog row: not "Webhook only", says where the alerts wait', row && !/webhook only/i.test(row) && /\?since=/.test(row), row.slice(0, 120));
const tool = (w.match(/\{ name: 'bsc_rug_watch',[^\n]*/) || [''])[0];
ok('MCP bsc_rug_watch: "up to 25", never "unlimited"', tool && !/unlimited/i.test(tool) && /up to 25 active watches/.test(tool));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
