// ADHS-Test - Controller (Rendering, Navigation, Persistenz, Auswertung)
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
  const D = window.ADHS_DATA;
  // UI-Strings: deutsche Defaults, übersetzte Datendateien liefern D.ui mit.
  const UI = Object.assign({
    question: "Frage",
    answersCount: (a, t) => `${a} / ${t} Antworten`,
    sectionLabels: { A: "Abschnitt 1 von 3 · ASRS Part A", B: "Abschnitt 2 von 3 · ASRS Part B", W: "Abschnitt 3 von 3 · WURS-K" },
    resetConfirm: "Wirklich alle bisherigen Antworten löschen und neu starten?",
  }, (D && D.ui) || {});
  // JS scrolling overrides the CSS reduced-motion rule, so it asks for itself.
  const SCROLL = (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth";
  const STORAGE_KEY = "brainscreener.adhs.answers.v1";
  const CODE_KEY    = "brainscreener.adhs.code.v1";
  const RESULT_KEY  = "brainscreener.adhs.result.v1";

  const intro   = document.getElementById("intro");
  const form    = document.getElementById("adhsForm");
  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const progressCount = document.getElementById("progressCount");
  const actionsRow = document.getElementById("actionsRow");
  const btnNext = document.getElementById("btnNext");
  const btnBack = document.getElementById("btnBack");
  const btnSubmit = document.getElementById("btnSubmit");
  const missingNote = document.getElementById("missingNote");

  const sectionEls = {
    A: { banner: document.querySelector('[data-section="A"]'), items: document.getElementById("sectionA") },
    B: { banner: document.querySelector('[data-section="B"]'), items: document.getElementById("sectionB") },
    W: { banner: document.querySelector('[data-section="W"]'), items: document.getElementById("sectionW") },
  };

  const TOTAL_ITEMS = D.ASRS.length + D.WURSK.length;
  let answers = loadAnswers();
  let currentSection = "A";

  document.getElementById("wurskIntro").textContent = D.WURSK_INTRO;

  // ---------- Storage ----------
  function loadAnswers() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    } catch { return {}; }
  }
  function saveAnswers() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers)); } catch {}
  }

  // ---------- Rendering ----------
  function buildLikertHTML(itemId, scale) {
    return scale.map((opt) => `
      <label data-val="${opt.v}">
        <input type="radio" name="${itemId}" value="${opt.v}" ${answers[itemId] === opt.v ? "checked" : ""}>
        <span>${opt.label}</span>
      </label>
    `).join("");
  }
  function itemHTML(item, idx, scale) {
    return `
      <div class="item ${answers[item.id] !== undefined ? 'is-answered' : ''}" data-id="${item.id}">
        <div class="item-num">${UI.question} ${idx}</div>
        <div class="item-q">${item.text}</div>
        <div class="likert">${buildLikertHTML(item.id, scale)}</div>
      </div>
    `;
  }
  function renderAll() {
    const partA = D.ASRS.filter(i => i.partA);
    const partB = D.ASRS.filter(i => !i.partA);
    sectionEls.A.items.innerHTML = partA.map((it, i) => itemHTML(it, i + 1, D.ASRS_LIKERT)).join("");
    sectionEls.B.items.innerHTML = partB.map((it, i) => itemHTML(it, i + 1, D.ASRS_LIKERT)).join("");
    sectionEls.W.items.innerHTML = D.WURSK.map((it, i) => itemHTML(it, i + 1, D.WURS_LIKERT)).join("");

    form.addEventListener("change", onAnyChange);
  }

  function onAnyChange(e) {
    const input = e.target;
    if (input && input.type === "radio") {
      const id = input.name;
      const val = parseInt(input.value, 10);
      answers[id] = val;
      saveAnswers();
      const itemEl = input.closest(".item");
      if (itemEl) { itemEl.classList.add("is-answered"); itemEl.classList.remove("is-missing"); }
      updateProgress();
      hideMissing();
    }
  }

  function hideMissing() {
    missingNote.hidden = true;
  }

  function updateProgress() {
    const answered = Object.keys(answers).length;
    const pct = Math.round((answered / TOTAL_ITEMS) * 100);
    progressFill.style.width = pct + "%";
    progressCount.textContent = UI.answersCount(answered, TOTAL_ITEMS);
    progressText.textContent = UI.sectionLabels[currentSection];
  }

  // ---------- Navigation ----------
  function showSection(sec) {
    currentSection = sec;
    for (const key of Object.keys(sectionEls)) {
      const isActive = key === sec;
      sectionEls[key].banner.hidden = !isActive;
      sectionEls[key].items.hidden = !isActive;
    }
    btnBack.hidden = (sec === "A");
    btnNext.hidden = (sec === "W");
    btnSubmit.hidden = (sec !== "W");
    updateProgress();
    window.scrollTo({ top: 0, behavior: SCROLL });
  }

  function sectionItemIds(sec) {
    if (sec === "A") return D.ASRS.filter(i => i.partA).map(i => i.id);
    if (sec === "B") return D.ASRS.filter(i => !i.partA).map(i => i.id);
    return D.WURSK.map(i => i.id);
  }

  function isSectionComplete(sec) {
    const ids = sectionItemIds(sec);
    return ids.every((id) => typeof answers[id] === "number");
  }

  function focusFirstUnanswered(sec) {
    const ids = sectionItemIds(sec);
    for (const id of ids) {
      if (typeof answers[id] !== "number") {
        const el = form.querySelector(`.item[data-id="${id}"]`);
        if (el) {
          // The mark stays until the question is answered, and its first option takes the focus.
          el.classList.add("is-missing");
          el.scrollIntoView({ behavior: SCROLL, block: "center" });
          const first = el.querySelector("input");
          if (first) first.focus({ preventScroll: true });
        }
        break;
      }
    }
  }

  btnNext.addEventListener("click", () => {
    if (!isSectionComplete(currentSection)) {
      missingNote.hidden = false;
      focusFirstUnanswered(currentSection);
      return;
    }
    if (currentSection === "A") showSection("B");
    else if (currentSection === "B") showSection("W");
  });

  btnBack.addEventListener("click", () => {
    if (currentSection === "W") showSection("B");
    else if (currentSection === "B") showSection("A");
  });

  btnSubmit.addEventListener("click", () => {
    if (!isSectionComplete("W")) {
      missingNote.hidden = false;
      focusFirstUnanswered("W");
      return;
    }
    const result = D.evaluate(answers);
    const probandCode = (sessionStorage.getItem(CODE_KEY) || "").trim();
    const payload = {
      result, answers, probandCode,
      ts: new Date().toISOString(),
    };
    const stored = sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload));
    testInProgress = false;  // unlock beforeunload
    // Sprachversion beibehalten: /brainscreener/adhd -> /brainscreener/adhd-result (extensionless: the .html form answers 308).
    toResult(location.pathname.replace(/[^/]*$/, "") + "adhd-result", payload, stored);
  });

  // ---------- beforeunload Warnung ----------
  let testInProgress = false;
  window.addEventListener("beforeunload", (e) => {
    if (testInProgress && Object.keys(answers).length > 0 && Object.keys(answers).length < TOTAL_ITEMS) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  });

  // ---------- Reset ----------
  // In-Page-Dialog statt window.confirm(): native Dialoge werden in manchen
  // In-App-Browsern (Telegram/X) stillschweigend geblockt.
  function showConfirm(message, okLabel, onOk) {
    let m = document.getElementById("bsConfirmModal");
    if (!m) {
      m = document.createElement("div");
      m.id = "bsConfirmModal";
      m.setAttribute("role", "dialog");
      m.setAttribute("aria-modal", "true");
      m.style.cssText = "position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,0.45);";
      m.innerHTML = `
        <div style="background:var(--bg,#fff);color:var(--ink,#1a1a1a);max-width:440px;width:100%;border-radius:12px;padding:26px 24px;box-shadow:0 12px 40px rgba(0,0,0,0.3);">
          <p id="bsConfirmMsg" style="margin:0 0 22px;line-height:1.55;"></p>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost" id="bsConfirmCancel"></button>
            <button type="button" class="btn btn-primary" id="bsConfirmOk"></button>
          </div>
        </div>`;
      document.body.appendChild(m);
    }
    m.querySelector("#bsConfirmMsg").textContent = message;
    const ok = m.querySelector("#bsConfirmOk");
    const cancel = m.querySelector("#bsConfirmCancel");
    ok.textContent = okLabel;
    cancel.textContent = UI.confirmCancel || "Cancel";
    m.style.display = "flex";
    const close = () => { m.style.display = "none"; ok.onclick = cancel.onclick = m.onclick = null; };
    cancel.onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    ok.onclick = () => { close(); onOk(); };
    ok.focus();
  }

  const btnReset = document.getElementById("btnReset");
  if (Object.keys(answers).length > 0) {
    btnReset.hidden = false;
    btnReset.addEventListener("click", () => {
      showConfirm(UI.resetConfirm, UI.confirmResetOk || "Delete answers", () => {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(CODE_KEY);
        sessionStorage.removeItem(RESULT_KEY);
        answers = {};
        location.reload();
      });
    });
  }


  // The reset button lives in the intro, which is hidden exactly when answers
  // exist — so a running or resumed test had no way to start again. This one
  // sits under the questions and is shown with them (2026-09-20).
  const btnRestart = document.getElementById("btnRestart");
  const showRestart = () => { const row = document.getElementById("restartRow"); if (row) row.hidden = false; };
  if (btnRestart) btnRestart.addEventListener("click", () => {
    showConfirm(UI.resetConfirm, UI.confirmResetOk || "Delete answers", () => {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(CODE_KEY);
      sessionStorage.removeItem(RESULT_KEY);
      answers = {};
      testInProgress = false; location.reload();
    });
  });

  // ---------- Start ----------
  const probandInput = document.getElementById("probandCode");
  // restore code if previously entered
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
    form.hidden = false;
    actionsRow.hidden = false;
    progressWrap.hidden = false;
    showRestart();
    testInProgress = true;
    renderAll();
    showSection("A");
  });

  // Falls man wieder zur Seite kommt und Antworten existieren -> direkt fortsetzen
  if (Object.keys(answers).length > 0) {
    intro.hidden = true;
    form.hidden = false;
    actionsRow.hidden = false;
    progressWrap.hidden = false;
    showRestart();
    testInProgress = true;
    renderAll();
    // springe zur ersten Sektion mit Luecken
    if (!isSectionComplete("A")) showSection("A");
    else if (!isSectionComplete("B")) showSection("B");
    else showSection("W");
  }
})();
