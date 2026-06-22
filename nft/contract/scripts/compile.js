// Compile BobaiBuyDrops.sol via solc-js with @openzeppelin import resolution.
// Output: build/BobaiBuyDrops.json (abi + bytecode).
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'src', 'BobaiBuyDrops.sol');
const OUT  = path.join(ROOT, 'build');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const source = fs.readFileSync(SRC, 'utf8');

function findImports(importPath) {
  // Resolve @openzeppelin/* via node_modules.
  if (importPath.startsWith('@openzeppelin/')) {
    const p = path.join(ROOT, 'node_modules', importPath);
    if (fs.existsSync(p)) return { contents: fs.readFileSync(p, 'utf8') };
  }
  return { error: 'File not found: ' + importPath };
}

const input = {
  language: 'Solidity',
  sources: { 'BobaiBuyDrops.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};

console.log(`Compiling ${path.relative(process.cwd(), SRC)} ...`);
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (out.errors) {
  const fatal = out.errors.filter(e => e.severity === 'error');
  out.errors.forEach(e => console.log(e.formattedMessage || e.message));
  if (fatal.length) { console.error(`\n${fatal.length} error(s) — aborting.`); process.exit(1); }
}

const contract = out.contracts['BobaiBuyDrops.sol']['BobaiBuyDrops'];
const artifact = {
  abi: contract.abi,
  bytecode: '0x' + contract.evm.bytecode.object,
  deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
  compiler: { version: solc.version() },
};

const outFile = path.join(OUT, 'BobaiBuyDrops.json');
fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
const sizeKB = (artifact.bytecode.length / 2 / 1024).toFixed(1);
console.log(`OK -> ${path.relative(process.cwd(), outFile)}`);
console.log(`     bytecode size: ${sizeKB} KB (limit 24 KB for L1; BSC accepts)`);
console.log(`     abi entries:   ${artifact.abi.length}`);
