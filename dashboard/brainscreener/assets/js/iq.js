// IQ-Test - Controller (Item-Navigation, Timer, Persistenz)
(function () {
  // The storage that cannot throw (print-fallback.js, BS_STORE): with site data
  // blocked, reading window.sessionStorage throws, and this file read it at top
  // level — the script died before "Start test" had its handler (2026-09-20).
  // The name is shadowed on purpose, so every call below is the safe one.
  const sessionStorage = window.BS_STORE || (function () {
    let real = null;
    try { real = window.sessionStorage; real.getItem("brainscreener.probe"); } catch { real = null; }
    const mem = {};
    return {
      getItem(k) { try { if (real) return real.getItem(k); } catch {} return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem(k, v) { try { if (real) { real.setItem(k, String(v)); return true; } } catch {} mem[k] = String(v); return false; },
      removeItem(k) { try { if (real) real.removeItem(k); } catch {} delete mem[k]; },
    };
  })();
  // Where the result page is, and how the answers reach it when they could not
  // be stored: through the URL fragment the print fallback already reads (only
  // `answers` are taken from it, the page evaluates them itself).
  const toResult = (path, payload, stored) => {
    let target = path;
    if (!stored && window.BS_PRINT && BS_PRINT.encode) {
      const enc = BS_PRINT.encode({ answers: payload.answers, probandCode: payload.probandCode, ts: payload.ts });
      if (enc) target += "#r=" + enc;
    }
    location.href = target;
  };
  const D = window.IQ_DATA;
  // UI-Strings: deutsche Defaults, übersetzte Datendateien liefern D.ui mit.
  const UI = Object.assign({
    itemOf: (i, n) => `Aufgabe ${i} von ${n}`,
    answeredOf: (a, n) => `${a} / ${n} beantwortet`,
    qMatrix: "Welche Figur vervollständigt das Muster?",
    qNumeric: "Welche Zahl setzt die Reihe logisch fort?",
    qVerbal: "Welche Ergänzung passt am besten?",
    optionLabel: (letter) => `Option ${letter}`,
    finishConfirm: (a, n) => `Sie haben ${a} von ${n} Aufgaben beantwortet. Test trotzdem auswerten?`,
    resetConfirm: "Wirklich alle bisherigen Antworten löschen und neu starten?",
    confirmFinishOk: "Trotzdem auswerten",
    confirmResetOk: "Antworten löschen",
    confirmCancel: "Abbrechen",
    domainLabel: {
      Gf: "Matrix Reasoning · Fluide Intelligenz",
      Gq: "Zahlenreihe · Quantitatives Denken",
      Gc: "Verbale Analogie · Kristalline Intelligenz",
      Gv: "Visuell-räumlich · Mustererkennung",
    },
  }, (D && D.ui) || {});
  // JS scrolling overrides the CSS reduced-motion rule, so it asks for itself.
  const SCROLL = (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth";
  const STORAGE_KEY = "brainscreener.iq.answers.v1";
  const TIME_KEY = "brainscreener.iq.startTs.v1";
  const CODE_KEY = "brainscreener.iq.code.v1";
  const RESULT_KEY = "brainscreener.iq.result.v1";

  const intro = document.getElementById("intro");
  const testArea = document.getElementById("testArea");
  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const timeDisplay = document.getElementById("timeDisplay");

  const itemNum = document.getElementById("itemNum");
  const itemQuestion = document.getElementById("itemQuestion");
  const itemStimulus = document.getElementById("itemStimulus");
  const itemOptions = document.getElementById("itemOptions");

  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnSkip = document.getElementById("btnSkip");
  const btnFinish = document.getElementById("btnFinish");
  const finishHint = document.getElementById("finishHint");

  let answers = loadAnswers();
  let idx = 0;
  let startTs = parseInt(sessionStorage.getItem(TIME_KEY) || "0", 10);
  let tickerId = null;

  function loadAnswers() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
  }
  function saveAnswers() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers)); } catch {}
  }

  // Item types map to their stimulus rendering
  function renderItem(i) {
    const it = D.ITEMS[i];
    itemNum.textContent = `${UI.itemOf(i + 1, D.TOTAL)}  ·  ${UI.domainLabel[it.domain] || it.domain}`;
    itemStimulus.innerHTML = "";
    itemOptions.innerHTML = "";

    if (it.type === "matrix") {
      itemQuestion.textContent = UI.qMatrix;
      itemStimulus.innerHTML = `<div class="matrix-stim">${D.gridSVG(it.cells)}</div>`;
      // 6 SVG options
      const optsHTML = it.options.map((opt, oi) => `
        <label data-i="${oi}" aria-label="${UI.optionLabel(String.fromCharCode(65 + oi))}">
          <input type="radio" name="opt" value="${oi}" ${answers[it.id] === oi ? "checked" : ""}>
          ${D.optionSVG(opt)}
        </label>`).join("");
      itemOptions.innerHTML = `<div class="iq-options-svg">${optsHTML}</div>`;
    }
    else if (it.type === "numeric") {
      itemQuestion.textContent = UI.qNumeric;
      itemStimulus.innerHTML = `
        <div style="text-align:center; font-family:var(--serif); font-size:1.85rem; letter-spacing:0.06em; padding:30px 12px; background:var(--bg-alt); border-radius:10px; color:var(--ink);">
          ${it.question}
        </div>`;
      itemOptions.innerHTML = mcqHTML(it);
    }
    else if (it.type === "verbal") {
      itemQuestion.textContent = UI.qVerbal;
      itemStimulus.innerHTML = `
        <div style="text-align:center; font-family:var(--serif); font-size:1.5rem; padding:30px 16px; background:var(--bg-alt); border-radius:10px; color:var(--ink); line-height:1.4;">
          ${it.question}
        </div>`;
      itemOptions.innerHTML = mcqHTML(it);
    }
    else if (it.type === "logical") {
      itemQuestion.textContent = it.question;
      itemStimulus.innerHTML = "";
      itemOptions.innerHTML = mcqHTML(it);
    }

    // Restore selection visual
    const radios = itemOptions.querySelectorAll('input[type="radio"]');
    radios.forEach((r) => {
      r.addEventListener("change", () => {
        answers[it.id] = parseInt(r.value, 10);
        saveAnswers();
        updateProgress();
      });
    });

    btnPrev.disabled = (i === 0);
    if (i === D.TOTAL - 1) {
      btnNext.hidden = true;
      btnFinish.hidden = false;
      finishHint.hidden = false;
    } else {
      btnNext.hidden = false;
      btnFinish.hidden = false;
      finishHint.hidden = false;
    }

    progressText.textContent = UI.itemOf(i + 1, D.TOTAL);
    updateProgress();
    window.scrollTo({ top: 0, behavior: SCROLL });
  }

  function mcqHTML(it) {
    return `<div class="mcq">${it.options.map((opt, oi) => `
      <label data-i="${oi}">
        <input type="radio" name="opt" value="${oi}" ${answers[it.id] === oi ? "checked" : ""}>
        <span class="opt-letter">${String.fromCharCode(65 + oi)}</span>
        <span>${opt}</span>
      </label>`).join("")}</div>`;
  }

  function updateProgress() {
    const answered = Object.keys(answers).length;
    const pct = Math.round(((idx + 1) / D.TOTAL) * 100);
    progressFill.style.width = pct + "%";
  }

  function tick() {
    if (!startTs) return;
    const sec = Math.floor((Date.now() - startTs) / 1000);
    const m = Math.floor(sec / 60), s = sec % 60;
    timeDisplay.textContent = `${m}:${String(s).padStart(2, "0")}  ·  ${UI.answeredOf(Object.keys(answers).length, D.TOTAL)}`;
  }

  // ---------- In-Page-Bestätigungsdialog ----------
  // Ersetzt window.confirm(): native Dialoge werden in manchen In-App-Browsern
  // (Telegram/X) oder nach "Dialoge unterdrücken" stillschweigend geblockt.
  function ensureModal() {
    let m = document.getElementById("iqConfirmModal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "iqConfirmModal";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.style.cssText = "position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,0.45);";
    m.innerHTML = `
      <div style="background:var(--bg,#fff);color:var(--ink,#1a1a1a);max-width:440px;width:100%;border-radius:12px;padding:26px 24px;box-shadow:0 12px 40px rgba(0,0,0,0.3);">
        <p id="iqConfirmMsg" style="margin:0 0 22px;line-height:1.55;"></p>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost" id="iqConfirmCancel"></button>
          <button type="button" class="btn btn-primary" id="iqConfirmOk"></button>
        </div>
      </div>`;
    document.body.appendChild(m);
    return m;
  }
  function showConfirm(message, okLabel, onOk) {
    const m = ensureModal();
    m.querySelector("#iqConfirmMsg").textContent = message;
    const ok = m.querySelector("#iqConfirmOk");
    const cancel = m.querySelector("#iqConfirmCancel");
    ok.textContent = okLabel;
    cancel.textContent = UI.confirmCancel;
    m.style.display = "flex";
    const close = () => { m.style.display = "none"; ok.onclick = cancel.onclick = m.onclick = null; };
    cancel.onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    ok.onclick = () => { close(); onOk(); };
    ok.focus();
  }

  // ---------- Navigation ----------
  btnNext.addEventListener("click", () => {
    if (idx < D.TOTAL - 1) { idx++; renderItem(idx); }
  });
  btnPrev.addEventListener("click", () => {
    if (idx > 0) { idx--; renderItem(idx); }
  });
  btnSkip.addEventListener("click", () => {
    // explicit skip: ensure no answer for this item
    const it = D.ITEMS[idx];
    delete answers[it.id]; saveAnswers();
    if (idx < D.TOTAL - 1) { idx++; renderItem(idx); }
  });
  btnFinish.addEventListener("click", () => {
    const answered = Object.keys(answers).length;
    if (answered < D.TOTAL) {
      showConfirm(UI.finishConfirm(answered, D.TOTAL), UI.confirmFinishOk, finishTest);
      return;
    }
    finishTest();
  });
  function finishTest() {
    const result = D.evaluate(answers);
    const probandCode = (sessionStorage.getItem(CODE_KEY) || "").trim();
    const payload = {
      result, answers, probandCode,
      ts: new Date().toISOString(),
      durationSec: startTs ? Math.floor((Date.now() - startTs) / 1000) : null,
    };
    const stored = sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload));
    testInProgress = false;
    // Sprachversion beibehalten: /brainscreener/iq -> /brainscreener/iq-result (extensionless: the .html form answers 308).
    toResult(location.pathname.replace(/[^/]*$/, "") + "iq-result", payload, stored);
  }

  // ---------- leaving and coming back ----------
  // No "Leave site?" prompt (removed 2026-09-20): it was the one native dialog
  // left on these pages — in-app browsers block those silently — and it
  // protected nothing: every answer is saved as it is given and the test
  // resumes where it stopped. An active beforeunload listener also kept the
  // page out of the back/forward cache.
  let testInProgress = false;
  // A page restored from that cache is the DOM as it was left. If the stored
  // answers have changed since ("Repeat test", "start over"), it would show old
  // ticks over an empty store — then it is loaded afresh.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch {}
    if (Object.keys(stored).length !== Object.keys(answers).length) location.reload();
  });

  // ---------- Reset ----------
  const btnResetEl = document.getElementById("btnReset");
  if (Object.keys(answers).length > 0) {
    btnResetEl.hidden = false;
    btnResetEl.addEventListener("click", () => {
      showConfirm(UI.resetConfirm, UI.confirmResetOk, () => {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(TIME_KEY);
        sessionStorage.removeItem(CODE_KEY);
        sessionStorage.removeItem(RESULT_KEY);
        answers = {};
        startTs = 0;
        testInProgress = false;
        location.reload();
      });
    });
  }

  // ---------- Start ----------
  const probandInput = document.getElementById("probandCode");
  const savedCode = sessionStorage.getItem(CODE_KEY) || "";
  if (probandInput && savedCode) probandInput.value = savedCode;
  if (probandInput) {
    probandInput.addEventListener("input", () => {
      try { sessionStorage.setItem(CODE_KEY, probandInput.value); } catch {}
    });
  }

  document.getElementById("btnStart").addEventListener("click", () => {
    if (probandInput) {
      try { sessionStorage.setItem(CODE_KEY, probandInput.value || ""); } catch {}
    }
    intro.hidden = true;
    testArea.hidden = false;
    progressWrap.hidden = false;
    testInProgress = true;
    // Testmodus: kompaktes Layout, damit eine Aufgabe ohne Scrollen auf den Schirm passt
    document.documentElement.classList.add("iq-testing");
    if (!startTs) { startTs = Date.now(); sessionStorage.setItem(TIME_KEY, String(startTs)); }
    idx = 0;
    renderItem(idx);
    tickerId = setInterval(tick, 1000);
    tick();
  });

  // Resume if state exists
  if (Object.keys(answers).length > 0 && startTs) {
    intro.hidden = true;
    testArea.hidden = false;
    progressWrap.hidden = false;
    testInProgress = true;
    // Testmodus: kompaktes Layout, damit eine Aufgabe ohne Scrollen auf den Schirm passt
    document.documentElement.classList.add("iq-testing");
    // find first unanswered, else last
    idx = 0;
    for (let i = 0; i < D.TOTAL; i++) {
      if (answers[D.ITEMS[i].id] === undefined) { idx = i; break; }
      if (i === D.TOTAL - 1) idx = i;
    }
    renderItem(idx);
    tickerId = setInterval(tick, 1000);
    tick();
  }
})();
