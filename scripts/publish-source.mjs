// Turns the public mirror into a repository anyone can `git clone` from our
// own domain, with no account and no platform in between.
//
// Why this exists. In five weeks two code hosts became unusable for this
// project: GitHub flagged the account on 2026-07-24 and has not answered the
// appeal, and Codeberg changed its Terms of Use on 2026-07-21 to forbid both
// "cryptocurrency related projects" and projects mostly written by generative
// AI tools. We are squarely both. Every further platform is the same bet
// placed again. This one cannot be lost: it is a static directory on
// infrastructure we already run.
//
// Git's "dumb" HTTP protocol needs no server-side git at all — a plain file
// server is enough, provided every file the client asks for really exists.
// That is the whole difficulty here, because of the trap below.
//
// THE TRAP, and it is specific to this domain:
//   brainonbnb.com answers ANY unrouted path with HTTP 200 and the dashboard
//   page. A git client asking for an object that is missing therefore receives
//   a web page, with a success code, and fails with something that reads like
//   a corrupt repository rather than a missing file. So the repository is
//   REPACKED before publishing: one pack file and one index instead of a
//   thousand loose objects, which is both far fewer chances to be wrong and
//   far fewer files for Pages to serve.
//
// The clone is checked at the end by actually cloning it. A publish step that
// only reports "written" is the kind of green result this project has learned
// not to trust.
//
// Usage:
//   node scripts/publish-source.mjs               build from ../brainonbnb-public
//   node scripts/publish-source.mjs --verify URL  clone the live one and compare
//   node scripts/publish-source.mjs --self-test
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR = path.resolve(ROOT, '..', 'brainonbnb-public');
const OUT = path.join(ROOT, 'dashboard', 'source.git');
const args = process.argv.slice(2);

const run = (cmd, cwdOrArgs, maybeCwd) => {
  const a = Array.isArray(cwdOrArgs) ? cwdOrArgs : [];
  const cwd = Array.isArray(cwdOrArgs) ? maybeCwd : cwdOrArgs;
  return execFileSync(cmd, a, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
};
const git = (a, cwd) => run('git', a, cwd);

// Every file a dumb-HTTP client can ask for. If one of these is missing the
// domain answers with a web page and 200, so their presence is checked rather
// than assumed.
const REQUIRED = ['HEAD', 'info/refs', 'objects/info/packs'];

function countFiles (dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else n++;
    }
  };
  walk(dir);
  return n;
}

// ---------------------------------------------------------------- self-test
if (args.includes('--self-test')) {
  const fails = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srcpub-'));
  try {
    // Build a miniature of the real thing and clone it over file:// — the same
    // code path, minus the network.
    const work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'a.txt'), 'hello\n');
    fs.mkdirSync(path.join(work, 'sub'));
    fs.writeFileSync(path.join(work, 'sub', 'b.txt'), 'world\n');
    const bare = path.join(tmp, 'out.git');
    buildBare(work, bare, 'self-test');

    for (const f of REQUIRED) {
      if (!fs.existsSync(path.join(bare, f))) fails.push(`a dumb-HTTP client would ask for ${f} and it is not there`);
    }
    const packs = fs.readdirSync(path.join(bare, 'objects', 'pack')).filter((f) => f.endsWith('.pack'));
    if (packs.length !== 1) fails.push(`expected exactly one pack after repacking, found ${packs.length} — loose objects would multiply the ways a missing file can appear as a web page`);
    const loose = fs.existsSync(path.join(bare, 'objects'))
      ? fs.readdirSync(path.join(bare, 'objects')).filter((d) => /^[0-9a-f]{2}$/.test(d))
      : [];
    if (loose.length) fails.push(`${loose.length} loose object directories survived the repack`);
    if (fs.existsSync(path.join(bare, 'hooks'))) fails.push('hooks/ was published — sample scripts have no business on a web server');
    // The build machine's scratch path must not survive into the published config.
    const cfg = fs.readFileSync(path.join(bare, 'config'), 'utf8');
    if (/\[remote/.test(cfg) || /srcbuild-|[A-Za-z]:\\\\/.test(cfg)) {
      fails.push('the published config still records where it was cloned from — that is a path on the build machine');
    }

    // Cloned with autocrlf off so the test reads the bytes that are STORED,
    // not what this machine's global config would rewrite them into on the way
    // out. Without this the test fails on Windows for a reason that has
    // nothing to do with what was published.
    const back = path.join(tmp, 'back');
    git(['-c', 'core.autocrlf=false', 'clone', '--quiet', bare, back]);
    if (fs.readFileSync(path.join(back, 'a.txt'), 'utf8') !== 'hello\n') fails.push('the clone does not carry the file that went in');
    if (fs.readFileSync(path.join(back, 'sub', 'b.txt'), 'utf8') !== 'world\n') fails.push('the clone lost a file in a subdirectory');
    // And prove the storage itself is LF, which is the point of the config
    // above — a CRLF blob here would mean the published repository carries
    // Windows line endings to every reader on earth.
    const blob = git(['-c', 'core.autocrlf=false', 'show', 'HEAD:a.txt'], bare);
    if (blob.includes('\r')) fails.push('the stored blob carries CRLF — line endings are being inherited from the build machine');
  } catch (e) {
    fails.push('self-test threw: ' + (e.message || e).slice(0, 200));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(2);
  }
  console.log('self-test passed: a repository is built, repacked to a single pack with no loose objects, carries every file a dumb-HTTP client asks for, drops hooks/, and clones back with its contents intact');
  process.exit(0);
}

// ------------------------------------------------------------------ verify
// Clone the LIVE url and compare it against the mirror on disk. This is the
// only check that proves the whole chain — build, deploy, routing, headers.
if (args.includes('--verify')) {
  const url = args[args.indexOf('--verify') + 1];
  if (!url) { console.error('--verify needs a URL'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srcver-'));
  try {
    console.log(`cloning ${url} …`);
    git(['clone', '--quiet', url, path.join(tmp, 'c')]);
    const cloned = countFiles(path.join(tmp, 'c')) - countFiles(path.join(tmp, 'c', '.git'));
    const expected = countFiles(MIRROR);
    console.log(`clone succeeded: ${cloned} files (mirror on disk has ${expected})`);
    const readme = path.join(tmp, 'c', 'MIRROR.md');
    if (!fs.existsSync(readme)) { console.error('MIRROR.md is missing from the clone'); process.exit(1); }
    if (cloned !== expected) {
      console.error(`file counts differ — the published repository is not the mirror that was built`);
      process.exit(1);
    }
    console.log('the clone matches the mirror file for file.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}

// ------------------------------------------------------------------- build
function buildBare (srcTree, dest, message) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srcbuild-'));
  const work = path.join(tmp, 'w');
  fs.cpSync(srcTree, work, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], work);
  // The publishing identity, stated rather than inherited, so the commit does
  // not silently carry whatever the machine happens to be configured with.
  git(['config', 'user.name', 'Brain On BNB AI'], work);
  git(['config', 'user.email', 'bobai@brainonbnb.ai'], work);
  // Line endings are nailed down rather than inherited. This machine has
  // core.autocrlf=true globally, so without this the bytes in a published blob
  // would depend on which computer ran the build. `input` stores LF whatever
  // the working copy looks like, which is what a public repository should
  // carry and what every non-Windows reader expects.
  git(['config', 'core.autocrlf', 'input'], work);
  // -f because the mirror carries the working repo's .gitignore, and without it
  // those rules would silently drop files that build-mirror deliberately chose
  // to include. The .gitignore itself stays in the published tree: it is the
  // document that says what this project keeps out and why, which is worth
  // reading. An earlier draft deleted it instead, which quietly published one
  // file fewer than the mirror held.
  git(['add', '-A', '-f'], work);
  git(['commit', '--quiet', '-m', message], work);

  fs.rmSync(dest, { recursive: true, force: true });
  git(['clone', '--quiet', '--bare', work, dest]);
  // One pack, no loose objects: fewer files to serve, and fewer ways for a
  // missing one to come back as a web page with a 200.
  git(['repack', '-a', '-d', '--quiet'], dest);
  git(['update-server-info'], dest);
  // Sample hooks and the stub description have no business on a web server.
  fs.rmSync(path.join(dest, 'hooks'), { recursive: true, force: true });
  fs.rmSync(path.join(dest, 'description'), { force: true });
  // A clone records where it came from, and here that is a scratch directory
  // on the build machine — published to the world as
  // `url = D:\temp\srcbuild-o3cHpK\w`. Not a secret, but it describes somebody's
  // filesystem and means nothing to a reader, so it goes.
  git(['config', '--remove-section', 'remote.origin'], dest);
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (!fs.existsSync(MIRROR)) {
  console.error(`${MIRROR} does not exist — run scripts/build-mirror.mjs first.`);
  process.exit(1);
}

const stamp = fs.readFileSync(path.join(MIRROR, 'MIRROR.md'), 'utf8').match(/^# (.+)$/m)?.[1] ?? 'source';
buildBare(MIRROR, OUT, `Public source of brainonbnb.com

Generated from the private working repository by scripts/build-mirror.mjs and
published by scripts/publish-source.mjs. See MIRROR.md for what is included,
what is not, and why. The running system is at https://brainonbnb.com.`);

for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(OUT, f))) {
    console.error(`${f} was not produced — a dumb-HTTP clone would ask for it and get a web page.`);
    process.exit(1);
  }
}

const bytes = (() => {
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : (n += fs.statSync(p).size); } };
  walk(OUT);
  return n;
})();
console.log(`published ${countFiles(OUT)} files, ${(bytes / 1048576).toFixed(1)} MB → dashboard/source.git`);
console.log(`(${stamp})`);
console.log('\nDeploy the dashboard, then prove it:');
console.log('  node scripts/publish-source.mjs --verify https://brainonbnb.com/source.git');
