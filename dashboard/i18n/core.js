// ARABIC A-Z (operator, 2026-11-08: "the whole page, A to Z, Classic too, in Arabic; the layout stays exactly as it is").
// The one translator both sides use: the site worker for the HTML it sends (so search engines and readers without
// JavaScript get Arabic too) and the browser for every text the page writes itself (cards, figures, windows, the game).
// A text is looked up by its KEY: the English with every figure, amount, address, ticker and link replaced by {0},
// {1}, ... in order, so "rebuilt 12 h ago" and "rebuilt 3 min ago" share one entry. The Arabic may put the {n} in any
// order; each is filled with the original token, untouched (numbers, $BOBAI, addresses stay Latin, as the glossary says).
// A text with no entry stays English and is reported as a miss — never guessed.

// tokens, longest first: links, addresses (whole and shortened), tickers, then figures with their unit or currency
const TOKEN = new RegExp([
  'https?:\\/\\/[^\\s<>"]+',
  '0x[0-9a-fA-F]{4,}(?:…|\\.\\.\\.)[0-9a-fA-F]{2,}',
  '0x[0-9a-fA-F]{6,}',
  '\\$[A-Z][A-Z0-9]{1,9}\\b',
  '\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?', // a date (with its time) is one token
  '\\d{1,2}:\\d{2}(?::\\d{2})?', // a time is one token: "10:41" never turns into "41:10"
  '[+\\-−]?[$≈~]?\\d[\\d,]*(?:\\.\\d+)?(?:[KMB](?![A-Za-z])|%|x(?![A-Za-z]))?',
].join('|'), 'g');

// the key of a text and the tokens it carries; null when there is nothing to translate (no two Latin letters in a row)
export function keyOf(text) {
  const s = String(text).replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim(); // our own isolates are not part of the text
  if (!/[A-Za-z]{2}/.test(s) || /[؀-ۿ]/.test(s)) return null; // already Arabic: nothing to do
  const toks = [];
  const key = s.replace(TOKEN, (m) => { toks.push(m); return '{' + (toks.length - 1) + '}'; });
  if (!/[A-Za-z]{2}/.test(key.replace(/\{\d+\}/g, ''))) return null; // only tokens (an address, "$BOBAI", "12%")
  return { key, toks };
}

// the Arabic for a text, its own leading/trailing space kept; undefined = no entry (a miss), null = nothing to translate
export function translate(dict, text) {
  const k = keyOf(text);
  if (!k) return null;
  const ar = dict[k.key];
  if (ar == null) return undefined;
  const lead = /^\s/.test(text) ? ' ' : '', trail = /\s$/.test(text) ? ' ' : '';
  return lead + ar.replace(/\{(\d+)\}/g, (m, i) => (k.toks[i] != null ? ltr(k.toks[i]) : m)) + trail;
}
// a figure, ticker or address inside Arabic keeps its own order ("$BOBAI", "0.8%", "$3.17", not "BOBAI$", "%0.8"):
// wrapped in an invisible left-to-right isolate (U+2066 ... U+2069)
export const ltr = (s) => '⁦' + s + '⁩';

// HTML source text as the worker sees it (entities not decoded) and back
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', uarr: '↑', darr: '↓', middot: '·', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', copy: '©', bull: '•', deg: '°', asymp: '≈', ne: '≠', le: '≤', ge: '≥' };
export function decodeHtml(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
}
export function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// this site's own pages, which have an Arabic twin under /ar/ (assets, APIs and the apps keep their one address)
export const AR_PAGES = /^\/(?:$|classic$|token|faq|pop|scanner|registry|list|services|defi|library|whitepaper|advantage|session|source|roadmap|archive|screener|board|connect|jobs|pass|pancakeswap|venus|settle|set-and-earn|agent|nft|buy)(?:\.html)?(?:[/?#]|$)/;
export const toAr = (href) => (AR_PAGES.test(href) ? '/ar' + (href === '/' ? '/' : href) : href);
