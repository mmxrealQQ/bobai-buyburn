// Print-Fallback fuer In-App-Browser (X/Telegram/Instagram/FB …).
// window.print() ist in diesen WebViews ein stiller No-Op — gleiche Kategorie wie
// die geblockten nativen confirm()-Dialoge (siehe iq.js In-Page-Modal).
// Strategie:
//  - loadPayload(key): sessionStorage zuerst, dann URL-Hash-Fallback (#r=…), damit
//    das Resultat den Sprung in einen echten Browser ueberlebt. Der Hash wird nie
//    an den Server gesendet (URL-Fragment) — alles bleibt clientseitig.
//  - attachPrint(btn, key): normale Browser behalten window.print(); erkannte
//    In-App-Browser bekommen ein In-Page-Modal mit kopierbarem Link.
// Aus dem Hash werden nur die rohen answers uebernommen (result wird verworfen und
// von der Seite via evaluate() neu berechnet) — kein HTML aus der URL im DOM.
(function () {
  // Telegrams In-App-Browser tarnt sich als normales Chrome (kein "Telegram",
  // kein "; wv)" im UA — via debug-ua.html verifiziert 15.7.). Er injiziert aber
  // ein Proxy-Objekt — das ist der zuverlässige Marker.
  function isTelegram() {
    return typeof window.TelegramWebviewProxy !== "undefined" ||
           typeof window.TelegramWebviewProxyProto !== "undefined" ||
           typeof window.TelegramWebview !== "undefined" ||
           /Telegram/i.test(navigator.userAgent || "");
  }

  function isInApp() {
    if (isTelegram()) return true;
    var ua = navigator.userAgent || "";
    if (/TwitterAndroid|Twitter for iPhone|FBAN|FBAV|Instagram|Line\//i.test(ua)) return true;
    if (/Android/.test(ua) && /; wv\)/.test(ua)) return true;              // Android WebView
    if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//i.test(ua)) return true; // iOS In-App-WebView
    try { // Chromium UA-Client-Hints: WebView nennt sich in der Brands-Liste
      var brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
      for (var i = 0; i < brands.length; i++) if (/WebView/i.test(brands[i].brand)) return true;
    } catch {}
    return false;
  }

  // position:sticky ist in Telegrams WebView kaputt, position:fixed funktioniert
  // (debug-ua.html: 🟩 klebt nicht, 🟦 klebt). Emulation nur fuer Telegram —
  // X/Safari/Chrome behalten ihr funktionierendes sticky.
  function fixSticky() {
    var header = document.querySelector(".site-header");
    if (header) {
      var padBody = function () { document.body.style.paddingTop = header.offsetHeight + "px"; };
      header.style.position = "fixed";
      header.style.top = "0"; header.style.left = "0"; header.style.right = "0";
      // TG-WebView kann kein backdrop-filter: der 88%-transparente Glas-Header
      // laesst dort scharfen Text durchscheinen → opak machen (nur hier).
      try {
        if (!(window.CSS && CSS.supports && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)")))) {
          header.style.background = "rgb(5, 5, 16)";
        }
      } catch { header.style.background = "rgb(5, 5, 16)"; }
      padBody();
      window.addEventListener("resize", padBody);
    }
    // .test-progress klebt normal via sticky unter dem Header — emulieren mit
    // Scroll-Toggle + Spacer (verhindert Layout-Sprung beim Umschalten).
    var prog = document.querySelector(".test-progress");
    if (prog) {
      var spacer = document.createElement("div");
      spacer.style.display = "none";
      prog.parentNode.insertBefore(spacer, prog);
      var headerH = function () { return header ? header.offsetHeight : 0; };
      var onScroll = function () {
        var anchor = spacer.style.display === "none" ? prog : spacer;
        var natTop = anchor.getBoundingClientRect().top + window.scrollY;
        if (window.scrollY + headerH() >= natTop) {
          if (prog.style.position !== "fixed") {
            spacer.style.height = prog.offsetHeight + "px";
            spacer.style.display = "block";
            prog.style.position = "fixed";
            prog.style.top = headerH() + "px";
            prog.style.left = "0"; prog.style.right = "0";
          }
        } else if (prog.style.position === "fixed") {
          prog.style.position = ""; prog.style.top = ""; prog.style.left = ""; prog.style.right = "";
          spacer.style.display = "none";
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  if (isTelegram()) ready(fixSticky);

  function encodePayload(payload) {
    try {
      var json = JSON.stringify(payload);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch { return null; }
  }

  function decodeHash() {
    var m = (location.hash || "").match(/[#&]r=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      var b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var p = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!p || typeof p !== "object" || !p.answers || typeof p.answers !== "object") return null;
      delete p.result; // nie vorgerechnete Ergebnisse aus der URL uebernehmen
      return p;
    } catch { return null; }
  }

  function loadPayload(key) {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
    if (p) return p;
    p = decodeHash();
    if (p) { try { sessionStorage.setItem(key, JSON.stringify(p)); } catch {} }
    return p;
  }

  function shareURL(key) {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
    var enc = p ? encodePayload(p) : null;
    return enc ? location.origin + location.pathname + "#r=" + enc : location.href;
  }

  function attachPrint(btn, key) {
    if (!btn) return;
    if (!isInApp()) {
      btn.addEventListener("click", function () { window.print(); });
      return;
    }
    // Hash sofort setzen: das native "Open in browser"-Menue von X/TG uebergibt
    // die AKTUELLE URL — nur mit gesetztem Hash kommt das Resultat mit.
    var url = shareURL(key);
    try { history.replaceState(null, "", url); } catch {}
    btn.addEventListener("click", function () { showModal(url); });
  }

  function ensureModal() {
    var m = document.getElementById("bsPrintModal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "bsPrintModal";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.style.cssText = "position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,0.45);";
    m.innerHTML = '' +
      '<div style="background:var(--bg,#fff);color:var(--ink,#1a1a1a);max-width:460px;width:100%;border-radius:12px;padding:26px 24px;box-shadow:0 12px 40px rgba(0,0,0,0.3);">' +
        '<p style="margin:0 0 12px;line-height:1.55;"><strong>PDF printing is not available in this in-app browser.</strong></p>' +
        '<p style="margin:0 0 16px;line-height:1.55;">Open this page in your regular browser (Safari or Chrome) — your result travels along in the link automatically. Use the <strong>&#8942; / share menu &rarr; &ldquo;Open in browser&rdquo;</strong>, or copy the link below.</p>' +
        '<div style="display:flex;gap:8px;margin:0 0 18px;">' +
          '<input id="bsPrintUrl" type="text" readonly style="flex:1;min-width:0;padding:9px 10px;border:1px solid var(--line,#ddd);border-radius:8px;font-size:12px;background:var(--bg-soft,#f7f7f5);color:inherit;" />' +
          '<button type="button" class="btn btn-primary" id="bsPrintCopy">Copy link</button>' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-ghost" id="bsPrintTry">Try printing anyway</button>' +
          '<button type="button" class="btn btn-ghost" id="bsPrintClose">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    return m;
  }

  function showModal(url) {
    var m = ensureModal();
    var input = m.querySelector("#bsPrintUrl");
    var copy = m.querySelector("#bsPrintCopy");
    var tryBtn = m.querySelector("#bsPrintTry");
    var closeBtn = m.querySelector("#bsPrintClose");
    input.value = url;
    m.style.display = "flex";
    var close = function () { m.style.display = "none"; };
    closeBtn.onclick = close;
    m.onclick = function (e) { if (e.target === m) close(); };
    tryBtn.onclick = function () { close(); window.print(); };
    copy.onclick = function () {
      var done = function () {
        copy.textContent = "Copied!";
        setTimeout(function () { copy.textContent = "Copy link"; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(); done(); });
      } else { fallbackCopy(); done(); }
      function fallbackCopy() {
        input.focus(); input.select(); input.setSelectionRange(0, url.length);
        try { document.execCommand("copy"); } catch {}
      }
    };
  }

  window.BS_PRINT = { loadPayload: loadPayload, attachPrint: attachPrint };
})();
