#!/usr/bin/env node
// The operator's key for the Xmas workshop (approve / block), made once (2026-11-17): a random secret goes to the
// bobai-xmas worker (wrangler secret put XMAS_ADMIN) and into .env, where scripts/xmas-admin.mjs reads it.
// Run by the operator:  node scripts/xmas-admin-secret.mjs        (--force makes a new one)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..'), ENV = path.join(ROOT, '.env');
const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
if (/^XMAS_ADMIN=\S+/m.test(env) && !process.argv.includes('--force')) { console.log('XMAS_ADMIN is in .env already (--force makes a new one).'); process.exit(0); }
const secret = crypto.randomBytes(32).toString('base64url');
const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'XMAS_ADMIN', '--config', 'worker-xmas/wrangler.toml'], { cwd: ROOT, input: secret, encoding: 'utf8', shell: process.platform === 'win32' });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
if (r.status !== 0) { console.error('\nwrangler did not take it — nothing written to .env'); process.exit(1); }
const next = /^XMAS_ADMIN=.*$/m.test(env) ? env.replace(/^XMAS_ADMIN=.*$/m, 'XMAS_ADMIN=' + secret) : env.replace(/\s*$/, '') + '\n# bobai-xmas worker: the operator\'s approve / block (2026-11-17)\nXMAS_ADMIN=' + secret + '\n';
fs.writeFileSync(ENV, next);
console.log('\nXMAS_ADMIN set on the bobai-xmas worker and written to .env.');
