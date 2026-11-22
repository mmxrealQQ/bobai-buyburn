// THE START LIMIT CANNOT BE NAMED AWAY (22.11., A-Z round 2): bobai-pop believed any x-pop-ip, so a direct call to its
// workers.dev host with a new address each time started without limit. Now only the site's proxy (with HIT_SECRET) names it.
// Usage: node worker-pop/test7.mjs
import fs from 'node:fs';
import path from 'node:path';
import { callerIp } from './game.js';
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`); };
const H = (o) => (h) => o[h] ?? null;
const S = 's3cret';
say(callerIp(H({ 'x-pop-ip': '1.1.1.1', 'cf-connecting-ip': '9.9.9.9', 'x-hit-secret': S }), S) === '1.1.1.1', 'the site with the secret names the visitor');
say(callerIp(H({ 'x-pop-ip': '1.1.1.1', 'cf-connecting-ip': '9.9.9.9' }), S) === '9.9.9.9', 'a direct caller without the secret is its own address');
say(callerIp(H({ 'x-pop-ip': '1.1.1.1', 'cf-connecting-ip': '9.9.9.9', 'x-hit-secret': 'guess' }), S) === '9.9.9.9', 'a wrong secret is its own address');
say(callerIp(H({ 'x-pop-ip': '1.1.1.1', 'cf-connecting-ip': '9.9.9.9', 'x-hit-secret': '' }), S) === '9.9.9.9', 'an empty secret is its own address');
say(callerIp(H({ 'x-pop-ip': '1.1.1.1', 'cf-connecting-ip': '9.9.9.9', 'x-hit-secret': S }), S + '\n') === '1.1.1.1', 'a secret stored with a trailing newline still matches');
say(callerIp(H({ 'x-pop-ip': '1.1.1.1', 'cf-connecting-ip': '9.9.9.9' }), undefined) === '1.1.1.1', 'no secret set yet: as before');
const src = fs.readFileSync(path.join(import.meta.dirname, 'index.js'), 'utf8');
const ipLine = src.split('\n').find((l) => /const ip = /.test(l));
say(!!ipLine && ipLine.includes('callerIp(') && ipLine.includes('HIT_SECRET'), 'the server takes its address from callerIp() with HIT_SECRET');
say(!src.split('\n').some((l) => /const ip = \(req\.headers\.get\('x-pop-ip'\)/.test(l)), 'no line believes x-pop-ip unchecked');
const proxy = fs.readFileSync(path.join(import.meta.dirname, '../dashboard/_worker.js'), 'utf8').split('\n').find((l) => l.includes("'x-pop-ip'"));
say(!!proxy && proxy.includes("'x-hit-secret': env.HIT_SECRET"), 'the site proxy sends the secret beside x-pop-ip');
console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
