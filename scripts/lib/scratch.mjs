// A temp folder that does not outlive the run that made it.
//
// Why this exists: on 2026-09-20 the system temp folder held 54 GB in 3,040
// entries, nearly all of it headless-Chrome profiles the checks in this folder
// had made with mkdtempSync and left behind — a profile is tens of megabytes,
// a full check run makes a dozen, and nothing ever removed them.
//
//   const profile = scratchDir('cdp-');   // instead of mkdtempSync(join(tmpdir(), 'cdp-'))
//
// Two nets, because the first one has a hole:
//   1. on exit the folder is removed (sync, with retries — on Windows Chrome
//      lets go of its profile a moment after it is killed);
//   2. a run that was killed, or whose Chrome still held the files, leaves its
//      folder after all — so every call first removes folders of the SAME
//      prefix that are older than STALE_MS. Only folders this helper's callers
//      name; never anything else in the temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STALE_MS = 6 * 60 * 60 * 1000; // longer than any check runs
const SWEEP_BUDGET_MS = 3000;
const mine = new Set();
let hooked = false;

const remove = (dir) => {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* still held: the next run's sweep takes it */ }
};

export function sweepStale(prefix, root = os.tmpdir(), now = Date.now()) {
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(root); } catch { return 0; }
  // A check must not wait on housekeeping: the first run after this helper
  // arrived found 408 old profiles and spent twenty minutes on them before it
  // opened a page. A few seconds a call; the rest goes on the next calls.
  const until = Date.now() + SWEEP_BUDGET_MS;
  for (const name of names) {
    if (Date.now() > until) break;
    if (!name.startsWith(prefix)) continue;
    const full = path.join(root, name);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory() || now - st.mtimeMs < STALE_MS) continue;
      remove(full);
      if (!fs.existsSync(full)) removed++;
    } catch { /* gone meanwhile */ }
  }
  return removed;
}

export function scratchDir(prefix, root = os.tmpdir()) {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) throw new Error(`scratchDir: prefix must look like "name-", got "${prefix}"`);
  sweepStale(prefix, root);
  const dir = fs.mkdtempSync(path.join(root, prefix));
  mine.add(dir);
  if (!hooked) {
    hooked = true;
    process.on('exit', () => { for (const d of mine) remove(d); });
    // An interrupted run exits through the handler above instead of dying with its folder.
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
  }
  return dir;
}

// node scripts/lib/scratch.mjs --self-test
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename && process.argv.includes('--self-test')) {
  const { spawnSync } = await import('node:child_process');
  let fails = 0;
  const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) fails++; };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-selftest-'));
  try {
    // a child makes a folder, writes into it, and exits — the folder must be gone
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { scratchDir } = await import(${JSON.stringify('file:///' + import.meta.filename.replace(/\\/g, '/'))});
      const d = scratchDir('kid-', ${JSON.stringify(root)});
      (await import('node:fs')).writeFileSync(d + '/x.txt', 'x');
      console.log(d);
      process.exit(3);
    `], { encoding: 'utf8', input: '' , env: process.env });
    const made = child.stdout.trim();
    ok('the child made a folder under the root', made.startsWith(root) && child.status === 3);
    ok('and it is gone after the child exited, exit code and all', made && !fs.existsSync(made));

    // stale sweep: old folder of the prefix goes, a young one stays, another prefix stays, a file stays
    const old = path.join(root, 'cdp-old'), young = path.join(root, 'cdp-young'), other = path.join(root, 'keep-old'), file = path.join(root, 'cdp-file');
    for (const d of [old, young, other]) fs.mkdirSync(d);
    fs.writeFileSync(file, 'x');
    const past = new Date(Date.now() - STALE_MS - 60000);
    for (const p of [old, other, file]) fs.utimesSync(p, past, past);
    const n = sweepStale('cdp-', root);
    ok('an old folder of the prefix is removed', n === 1 && !fs.existsSync(old));
    ok('a young one of the same prefix stays (a check may be running)', fs.existsSync(young));
    ok('an old folder of another prefix is not ours to touch', fs.existsSync(other));
    ok('a file is not touched, only folders', fs.existsSync(file));
    let threw = false; try { scratchDir('', root); } catch { threw = true; }
    ok('an empty prefix is refused — it would match the whole temp folder', threw);
  } finally { remove(root); }
  console.log(fails ? `${fails} FAILED` : 'self-test passed: a folder dies with its run, stale ones of the same prefix are swept, nothing else is touched');
  process.exit(fails ? 1 : 0);
}
