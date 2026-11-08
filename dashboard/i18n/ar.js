// ARABIC A-Z (2026-11-08), the browser side: on a /ar/ page every text the page shows or writes later — the cards'
// figures, the windows, the game, a title, a placeholder — is put through the one dictionary (core.js, the same the
// site worker uses for the HTML). The layout is not touched: no mirroring, no new boxes; only words change. Links to
// this site's pages stay inside /ar/. A text with no entry stays English and lands in window.__arMiss for the checker.
import { translate, toAr, ltr, NOAR } from '/i18n/core.js?v=10';

const SKIP = NOAR;
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const done = new WeakMap(); // text node -> the Arabic we wrote (so our own write is not translated again)
const miss = (window.__arMiss = window.__arMiss || new Set());
let dict = null;

function textNode(n) {
  if (!dict || done.get(n) === n.nodeValue) return;
  const p = n.parentElement; if (!p || p.closest(SKIP)) return;
  const ar = translate(dict, n.nodeValue);
  if (ar === undefined) { miss.add(n.nodeValue.replace(/\s+/g, ' ').trim()); return; }
  if (ar === null) {
    if (/[؀-ۿ]/.test(n.nodeValue)) para(p); // already Arabic (the worker's HTML)
    // a figure standing alone ("0.8%", "$BOBAI", "$3.17") inside an Arabic line keeps its own order
    else if (/[$%≈+\-−]/.test(n.nodeValue) && !/⁦/.test(n.nodeValue)) { const v = n.nodeValue.replace(/^(\s*)(.*?)(\s*)$/s, (m, a, b, c) => a + ltr(b) + c); n.nodeValue = v; done.set(n, v); }
    return;
  }
  n.nodeValue = ar; done.set(n, ar); para(p);
}
// the block that holds this text reads in the direction of its own first letter (ar.css .ar-p)
const marked = new WeakSet();
function para(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (marked.has(e)) return;
    if (getComputedStyle(e).display !== 'inline') { e.classList.add('ar-p'); marked.add(e); return; }
  }
}
function attrs(el) {
  if (!dict || el.closest(SKIP)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a); if (!v || el.getAttribute('data-ar-' + a) === v) continue;
    const ar = translate(dict, v);
    if (ar === undefined) { miss.add(v.trim()); continue; }
    if (ar === null) continue;
    el.setAttribute(a, ar); el.setAttribute('data-ar-' + a, ar);
  }
  if (el.tagName === 'A') { const h = el.getAttribute('href'); if (h && h.startsWith('/') && !h.startsWith('/ar/')) { const t = toAr(h); if (t !== h) el.setAttribute('href', t); } }
  if (el.tagName === 'IFRAME') { const s = el.getAttribute('src'); if (s && s.startsWith('/') && !s.startsWith('/ar/')) { const t = toAr(s); if (t !== s) el.setAttribute('src', t); } }
}
function walk(root) {
  if (root.nodeType === 3) return textNode(root);
  if (root.nodeType !== 1) return;
  attrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n; (n = w.nextNode());) n.nodeType === 3 ? textNode(n) : attrs(n);
}

// the document's title too
function title() { if (!dict) return; const ar = translate(dict, document.title); if (ar) document.title = ar; else if (ar === undefined) miss.add(document.title); }

fetch('/i18n/ar.json?v=' + (document.documentElement.getAttribute('data-arv') || '1')).then((r) => r.json()).then((j) => {
  dict = j.t || {};
  walk(document.body); title();
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'href', 'src'] });
  new MutationObserver(title).observe(document.querySelector('title') || document.head, { childList: true, characterData: true, subtree: true });
  window.__arReady = true; window.dispatchEvent(new Event('ar-ready')); // the terminal re-types a line it began in English before this
}).catch(() => { window.__arReady = 'failed'; });

// for the checker: does the dictionary know this text (also when its Arabic is the English itself, a name)?
window.__arHas = (s) => !!dict && translate(dict, s) !== undefined;
// for the terminal and the game: the Arabic of one whole line before it is typed (English when there is no entry)
window.__arT = (s) => { if (!dict) return s; const ar = translate(dict, s); if (ar === undefined) { miss.add(String(s).trim()); return s; } return ar ?? s; };
