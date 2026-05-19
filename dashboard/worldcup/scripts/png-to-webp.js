// Convert decorative illustrations PNG → WebP for ~10× smaller filesize.
// Operates on dashboard/worldcup/app/illus/*.png (NOT avatars/ subfolder).
//
// Heroes are resized to max 1500px wide (preserving aspect + transparency).
// Coins and pool-trophy stay square, resized to 512×512.
//
// Keeps the source PNG by default (so the fallback chain still works if a
// browser somehow rejects WebP). Pass --delete-png to remove originals.
//
// Usage:
//   node dashboard/worldcup/scripts/png-to-webp.js
//   node dashboard/worldcup/scripts/png-to-webp.js --delete-png

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ILLUS_DIR = path.resolve(__dirname, '..', 'app', 'illus');

// Per-slot output sizing. Anything not listed gets the default (max-w 1500).
const SIZING = {
  'pool-trophy':       { w: 512,  h: 512  },
  'coin-btc':          { w: 512,  h: 512  },
  'coin-bnb':          { w: 512,  h: 512  },
  'coin-bobai':        { w: 512,  h: 512  },
  // heroes: 1500×1000 landscape (already resized at gen time, just transcode)
};

async function convert(pngPath, deletePng) {
  const name = path.basename(pngPath, '.png');
  const webpPath = path.join(path.dirname(pngPath), name + '.webp');
  const size = SIZING[name] || null;
  const beforeKb = fs.statSync(pngPath).size / 1024;

  let pipeline = sharp(pngPath);
  if (size) {
    pipeline = pipeline.resize(size.w, size.h, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  await pipeline.webp({ quality: 82, effort: 5 }).toFile(webpPath);

  const afterKb = fs.statSync(webpPath).size / 1024;
  const savings = ((1 - afterKb / beforeKb) * 100).toFixed(0);
  console.log(`  ${name.padEnd(22)} ${beforeKb.toFixed(0).padStart(5)} KB → ${afterKb.toFixed(0).padStart(4)} KB  (${savings}% smaller)`);

  if (deletePng) fs.unlinkSync(pngPath);
}

async function main() {
  const deletePng = process.argv.includes('--delete-png');
  const pngs = fs.readdirSync(ILLUS_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => path.join(ILLUS_DIR, f));

  if (!pngs.length) {
    console.log('No PNG files found in', ILLUS_DIR);
    return;
  }

  console.log(`Converting ${pngs.length} PNG → WebP${deletePng ? ' (deleting source PNGs)' : ''}\n`);
  for (const p of pngs) {
    try { await convert(p, deletePng); }
    catch (e) { console.error(`  ${path.basename(p)} FAILED:`, e.message); }
  }
  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
