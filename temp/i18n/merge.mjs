// Arabic A-Z: merge the translated batches (temp/i18n/ar-*.json) into the live dictionary dashboard/i18n/ar.json.
// Refuses a batch entry whose Arabic loses or invents a {n} (a figure would vanish or show as "{2}"), or that still
// reads as English (Latin words beyond the glossary). Usage: node merge.mjs
import fs from 'node:fs';
const DIR = 'D:/ai/fourmeme/temp/i18n/', OUT = 'D:/ai/fourmeme/dashboard/i18n/ar.json';
// Latin that may stay in the Arabic: names, tickers, units, brands (the glossary)
const KEEP = /\b(BOBAI|BOB|BNB|BSC|LP|NFT|NFTs|DeFi|UTC|CAKE|USDT|USD|AI|API|MCP|A2A|ERC|PancakeSwap|Pancake|Four\.Meme|Giggle|Academy|Brain|Plaza|Board|Pop|Terminal|Screener|Brainmap|Classic|Telegram|X|GitHub|Cloudflare|Workers|Liq|Liquidity|Boost|I|II|III|Build|On|Venus|Mandate|Binance|Web3|WC|tx|TX|json|burns|ROT|SUPER|MEGA|GOD|BURN|HAMMER|LIQ|DEFI|GIGGLE|CREATOR|TRADES|RUG|EN|CZ|x402|Base|ETH|OK|ID|KYC|URL|HTTP|JSON|SDK|CLI|npm|llms|txt|md|skill|Claude|Cursor|VS|Code|Glama|Smithery|Brainrot|BOBAIs?|Agent|Studio|Era|Hackathon|Set|Earn|Keel|Marque|Pokter|Mandate|Whale|Watcher|Rug|Watch|Range|v\d|Copy)\b/g;
const dict = JSON.parse(fs.readFileSync(OUT, 'utf8'));
let added = 0, bad = 0;
for (const f of fs.readdirSync(DIR).filter((x) => /^ar-.*\.json$/.test(x)).sort()) {
  const batch = JSON.parse(fs.readFileSync(DIR + f, 'utf8'));
  for (const [k, v] of Object.entries(batch)) {
    const need = (k.match(/\{\d+\}/g) || []).sort().join(), got = (v.match(/\{\d+\}/g) || []).sort().join();
    if (v !== '' && need !== got) { console.log(`REFUSED ${f}: placeholders ${need} vs ${got} — ${k.slice(0, 80)}`); bad++; continue; }
    const latin = v.replace(KEEP, '').replace(/\{\d+\}/g, '').match(/[A-Za-z]{3,}/g);
    if (latin && v !== k && !/[\u0600-\u06FF]/.test(v) === false && latin.length > 2) { console.log(`CHECK  ${f}: Latin left (${latin.slice(0, 4).join(' ')}) — ${k.slice(0, 60)}`); }
    if (dict.t[k] !== v) { dict.t[k] = v; added++; }
  }
}
fs.writeFileSync(OUT, JSON.stringify({ v: (dict.v || 0) + (added ? 1 : 0), t: dict.t }) + '\n');
console.log(`merged: ${added} new/changed, ${bad} refused, ${Object.keys(dict.t).length} entries, v${dict.v + (added ? 1 : 0)}`);
process.exit(bad ? 1 : 0);
