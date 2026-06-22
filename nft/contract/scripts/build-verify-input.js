// Build a Standard-JSON-Input file for BscScan contract verification.
// Output: nft/contract/build/verify-input.json
// Workflow: paste/upload into bscscan.com/verifyContract — "Solidity (Standard-Json-Input)" mode.
//
// Keys in `sources` MUST match the import paths solc sees, NOT the disk paths.
// E.g. "@openzeppelin/contracts/utils/Context.sol" — not "node_modules/...".
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_FILE = path.join(ROOT, 'src', 'BobaiBuyDrops.sol');
const OUT_FILE = path.join(ROOT, 'build', 'verify-input.json');

const sources = {};

// virtualPath = the key as solc/BscScan see it
// absPath    = disk location to read from
function readSource(virtualPath, absPath) {
  if (sources[virtualPath]) return;
  const content = fs.readFileSync(absPath, 'utf8');
  sources[virtualPath] = { content };
  const importRegex = /^\s*import\s+(?:[^"']*from\s+)?["']([^"']+)["']/gm;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    const importPath = m[1];
    let nextVirtual, nextAbs;
    if (importPath.startsWith('@openzeppelin/')) {
      nextVirtual = importPath;
      nextAbs = path.join(ROOT, 'node_modules', importPath);
    } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Relative import — resolve against the CURRENT file's virtual path
      const dirVirtual = path.posix.dirname(virtualPath);
      nextVirtual = path.posix.normalize(path.posix.join(dirVirtual, importPath));
      nextAbs = path.resolve(path.dirname(absPath), importPath);
    } else {
      continue;
    }
    if (!fs.existsSync(nextAbs)) {
      console.warn(`!  Missing import: ${importPath} (from ${virtualPath}) -> ${nextAbs}`);
      continue;
    }
    readSource(nextVirtual, nextAbs);
  }
}

readSource('BobaiBuyDrops.sol', SRC_FILE);

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers', 'metadata'] },
    },
  },
};

fs.writeFileSync(OUT_FILE, JSON.stringify(input, null, 2));
console.log(`OK -> ${OUT_FILE}`);
console.log(`Sources (${Object.keys(sources).length} files):`);
Object.keys(sources).sort().forEach(k => console.log('  - ' + k));
console.log(`Total size: ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
