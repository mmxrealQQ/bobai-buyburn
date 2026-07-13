// ADHS-Test - Controller (Rendering, Navigation, Persistenz, Auswertung)
(function () {
  const D = window.ADHS_DATA;
  // UI-Strings: deutsche Defaults, übersetzte Datendateien liefern D.ui mit.
  const UI = Object.assign({
    question: "Frage",
    answersCount: (a, t) => `${a} / ${t} Antworten`,
    sectionLabels: { A: "Abschnitt 1 von 3 · ASRS Part A", B: "Abschnitt 2 von 3 · ASRS Part B", W: "Abschnitt 3 von 3 · WURS-K" },
    resetConfirm: "Wirklich alle bisherigen Antworten löschen und neu starten?",
  }, (D && D.ui) || {});
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
      if (itemEl) itemEl.classList.add("is-answered");
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.style.outline = "2px solid var(--gold)";
          setTimeout(() => { el.style.outline = ""; }, 1400);
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
    try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload)); } catch {}
    testInProgress = false;  // unlock beforeunload
    // Sprachversion beibehalten: /brainscreener/adhs -> /brainscreener/adhd-result.html usw.
    location.href = location.pathname.replace(/[^/]*$/, "") + "adhd-result.html";
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
  const btnReset = document.getElementById("btnReset");
  if (Object.keys(answers).length > 0) {
    btnReset.hidden = false;
    btnReset.addEventListener("click", () => {
      if (!confirm(UI.resetConfirm)) return;
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(CODE_KEY);
      sessionStorage.removeItem(RESULT_KEY);
      answers = {};
      location.reload();
    });
  }

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
    testInProgress = true;
    renderAll();
    // springe zur ersten Sektion mit Luecken
    if (!isSectionComplete("A")) showSection("A");
    else if (!isSectionComplete("B")) showSection("B");
    else showSection("W");
  }
})();
