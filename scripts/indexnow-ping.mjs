#!/usr/bin/env node
// IndexNow for the Brain Board's library pages (2026-10-27). New entries by verified writers are announced by the board
// itself (worker-agent/board.js, indexNow); this announces the pages that were there before, or all of them again after
// a change to the page itself. One POST to api.indexnow.org, shared with Bing, Yandex and the others.
//
//   node scripts/indexnow-ping.mjs            dry run: lists what it would announce
//   node scripts/indexnow-ping.mjs --confirm  announces it and prints the answer (200/202 = taken)
import { INDEXNOW_KEY, indexNow } from '../worker-agent/board.js';
import { typeMatches } from '../shared/plaza-board.js';

const confirm = process.argv.includes('--confirm');
const key = await fetch(`https://brainonbnb.com/${INDEXNOW_KEY}.txt`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
if (key.trim() !== INDEXNOW_KEY) { console.error(`the key file https://brainonbnb.com/${INDEXNOW_KEY}.txt does not hold the key — deploy the site first`); process.exit(1); }
const j = await fetch('https://agent.brainonbnb.com/board?type=library&limit=200').then((r) => r.json());
const urls = ['https://brainonbnb.com/board', ...j.threads.filter((t) => typeMatches(t, 'library')).map((t) => `https://brainonbnb.com/board/${t.id}`)];
console.log(`${confirm ? 'ANNOUNCING' : 'DRY RUN — nothing sent'}: ${urls.length} pages`);
for (const u of urls.slice(0, 5)) console.log('  ' + u);
if (urls.length > 5) console.log(`  … and ${urls.length - 5} more`);
if (!confirm) process.exit(0);
const r = await indexNow(urls);
console.log(`IndexNow answered ${r.status} for ${r.sent} pages${r.status === 200 || r.status === 202 ? ' — taken' : ''}`);
process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
