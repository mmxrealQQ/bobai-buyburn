#!/usr/bin/env node
// The operator's hand on the Xmas workshop (2026-11-17). Reads XMAS_ADMIN from .env.
//   node scripts/xmas-admin.mjs list
//   node scripts/xmas-admin.mjs order <slug> <n>           its place on the switch (smaller first; everyone uploaded is on it)
//   node scripts/xmas-admin.mjs block <slug>               gone at once: files, list, uploads
//   node scripts/xmas-admin.mjs unblock <slug>
import 'dotenv/config';
const API = process.env.BOBAI_XMAS_API || 'https://bobai-xmas.bobbuildonbnb.workers.dev';
const [action = 'list', slug, order] = process.argv.slice(2);
if (!process.env.XMAS_ADMIN) { console.error('No XMAS_ADMIN in .env — run: node scripts/xmas-admin-secret.mjs'); process.exit(1); }
const r = await fetch(API + '/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-xmas-admin': process.env.XMAS_ADMIN },
  body: JSON.stringify({ action, slug, ...(order != null ? { order: Number(order) } : {}) }) });
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error(j.error || r.status); process.exit(1); }
if (action === 'list') for (const t of j.themes) console.log(`${t.blocked ? 'BLOCKED ' : t.ver ? 'IN      ' : 'empty   '} ${t.slug.padEnd(24)} v${t.ver}  ${String(t.files).padStart(3)} files ${(t.bytes / 1024).toFixed(0).padStart(6)} KB  "${t.title}" by ${t.builder}  ${t.preview}`);
else console.log(JSON.stringify(j.theme, null, 2));
