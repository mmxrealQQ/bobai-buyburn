// Generische Test-Engine fuer brainscreener.
// Erwartet window.TEST_DATA mit Struktur:
// {
//   id: "phq9",
//   meta: { title, eyebrow, intro, durationText, itemsText, sources, resultPath },
//   sections: [ { id, title, intro?, items:[{id,text,scale?,reverse?}], scale: defaultScale } ],
//   evaluate(answers) -> Result-Objekt
// }
// Pflicht-DOM-Elemente (siehe template test.html):
//  #intro, #adhsForm (form), #progressWrap, #progressFill, #progressText, #progressCount,
//  #actionsRow, #btnNext, #btnBack, #btnSubmit, #missingNote, #btnStart, #btnReset, #probandCode

(function () {
  const D = window.TEST_DATA;
  if (!D) {
    console.error("[test-engine] window.TEST_DATA fehlt");
    return;
  }

  // UI-Strings: deutsche Defaults, übersetzte Datendateien liefern D.ui mit.
  const UI = Object.assign({
    question: "Frage",
    answersCount: "{answered} / {total} Antworten",
    sectionLabel: "Abschnitt {i} von {n} · {title}",
    resetConfirm: "Wirklich alle bisherigen Antworten löschen und neu starten?",
  }, D.ui || {});
  const fmt = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));

  const STORAGE_KEY = `brainscreener.${D.id}.answers.v1`;
  const CODE_KEY    = `brainscreener.${D.id}.code.v1`;
  const RESULT_KEY  = `brainscreener.${D.id}.result.v1`;

  // Fuer Result-Engine merken, welche Test-ID das aktuelle Result hat.
  // (result-engine liest dann sessionStorage[`brainscreener.<id>.result.v1`].)
  try { sessionStorage.setItem("brainscreener.lastTest", D.id); } catch {}

  const $ = (id) => document.getElementById(id);

  const intro        = $("intro");
  const form         = $("adhsForm");
  const progressWrap = $("progressWrap");
  const progressFill = $("progressFill");
  const progressText = $("progressText");
  const progressCount= $("progressCount");
  const actionsRow   = $("actionsRow");
  const btnNext      = $("btnNext");
  const btnBack      = $("btnBack");
  const btnSubmit    = $("btnSubmit");
  const missingNote  = $("missingNote");
  const btnStart     = $("btnStart");
  const btnReset     = $("btnReset");
  const probandInput = $("probandCode");

  // Meta in das Intro injizieren
  const elTitle    = $("testTitle");
  const elEyebrow  = $("testEyebrow");
  const elIntro    = $("testIntro");
  const elDuration = $("metaDuration");
  const elItems    = $("metaItems");
  const elSources  = $("metaSources");

  if (elTitle)    elTitle.textContent = D.meta.title;
  if (elEyebrow)  elEyebrow.textContent = D.meta.eyebrow;
  if (elIntro)    elIntro.innerHTML = D.meta.intro;
  if (elDuration) elDuration.textContent = D.meta.durationText;
  if (elItems)    elItems.textContent = D.meta.itemsText;
  if (elSources)  elSources.textContent = D.meta.sources;

  // Page-Title im Browser-Tab
  if (D.meta.pageTitle) document.title = D.meta.pageTitle;

  // Gesamt-Itemzahl
  const TOTAL_ITEMS = D.sections.reduce((s, sec) => s + sec.items.length, 0);

  // ---------- Storage ----------
  let answers = loadAnswers();
  function loadAnswers() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveAnswers() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers)); } catch {}
  }

  // ---------- Rendering ----------
  let currentIdx = 0; // aktiver Section-Index

  function buildLikert(itemId, scale) {
    const cols = scale.cols || scale.options.length;
    const opts = scale.options.map((opt) => `
      <label data-val="${opt.v}">
        <input type="radio" name="${itemId}" value="${opt.v}" ${answers[itemId] === opt.v ? "checked" : ""}>
        <span>${opt.label}</span>
      </label>
    `).join("");
    return `<div class="likert cols-${cols}">${opts}</div>`;
  }

  function itemHTML(item, idx, defaultScale) {
    const scale = item.scale || defaultScale;
    return `
      <div class="item ${answers[item.id] !== undefined ? 'is-answered' : ''}" data-id="${item.id}">
        <div class="item-num">${UI.question} ${idx}</div>
        <div class="item-q">${item.text}</div>
        ${buildLikert(item.id, scale)}
      </div>
    `;
  }

  function ensureSectionContainers() {
    // Wir bauen pro Section <div class="section-banner"><h2>..</h2><p>..</p></div><div class="section-items"></div>
    form.innerHTML = "";
    D.sections.forEach((sec, i) => {
      const banner = document.createElement("div");
      banner.className = "section-banner";
      banner.dataset.section = sec.id;
      banner.innerHTML = `<h2>${sec.title}</h2>${sec.intro ? `<p>${sec.intro}</p>` : ""}`;
      banner.hidden = (i !== 0);
      const items = document.createElement("div");
      items.dataset.itemsFor = sec.id;
      items.hidden = (i !== 0);
      form.appendChild(banner);
      form.appendChild(items);
    });

    // Action-Bar wieder anhaengen (war vor renderAll() im Markup im form, wird durch innerHTML entfernt)
    if (actionsRow && actionsRow.parentElement !== form) {
      form.appendChild(actionsRow);
    }
    if (missingNote && missingNote.parentElement !== form) {
      form.appendChild(missingNote);
    }
  }

  function renderAllItems() {
    D.sections.forEach((sec) => {
      const container = form.querySelector(`[data-items-for="${sec.id}"]`);
      container.innerHTML = sec.items.map((it, i) => itemHTML(it, i + 1, sec.scale)).join("");
    });
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
      if (missingNote) missingNote.hidden = true;
    }
  }

  function updateProgress() {
    const answered = Object.keys(answers).length;
    const pct = Math.round((answered / TOTAL_ITEMS) * 100);
    if (progressFill) progressFill.style.width = pct + "%";
    if (progressCount) progressCount.textContent = fmt(UI.answersCount, { answered, total: TOTAL_ITEMS });
    if (progressText) {
      const sec = D.sections[currentIdx];
      const label = D.sections.length > 1
        ? fmt(UI.sectionLabel, { i: currentIdx + 1, n: D.sections.length, title: sec.title })
        : sec.title;
      progressText.textContent = label;
    }
  }

  // ---------- Navigation ----------
  function showSection(idx) {
    currentIdx = idx;
    D.sections.forEach((sec, i) => {
      const banner = form.querySelector(`.section-banner[data-section="${sec.id}"]`);
      const items  = form.querySelector(`[data-items-for="${sec.id}"]`);
      if (banner) banner.hidden = (i !== idx);
      if (items)  items.hidden  = (i !== idx);
    });
    if (btnBack)   btnBack.hidden   = (idx === 0);
    if (btnNext)   btnNext.hidden   = (idx === D.sections.length - 1);
    if (btnSubmit) btnSubmit.hidden = (idx !== D.sections.length - 1);
    updateProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function sectionItemIds(idx) {
    return D.sections[idx].items.map((i) => i.id);
  }

  function isSectionComplete(idx) {
    return sectionItemIds(idx).every((id) => typeof answers[id] === "number");
  }

  function focusFirstUnanswered(idx) {
    const ids = sectionItemIds(idx);
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

  if (btnNext) btnNext.addEventListener("click", () => {
    if (!isSectionComplete(currentIdx)) {
      if (missingNote) missingNote.hidden = false;
      focusFirstUnanswered(currentIdx);
      return;
    }
    if (currentIdx < D.sections.length - 1) showSection(currentIdx + 1);
  });
  if (btnBack) btnBack.addEventListener("click", () => {
    if (currentIdx > 0) showSection(currentIdx - 1);
  });
  if (btnSubmit) btnSubmit.addEventListener("click", () => {
    if (!isSectionComplete(currentIdx)) {
      if (missingNote) missingNote.hidden = false;
      focusFirstUnanswered(currentIdx);
      return;
    }
    const result = D.evaluate(answers);
    const probandCode = (sessionStorage.getItem(CODE_KEY) || "").trim();
    const payload = { result, answers, probandCode, ts: new Date().toISOString(), testId: D.id };
    try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload)); } catch {}
    testInProgress = false;
    location.href = D.meta.resultPath;
  });

  // ---------- beforeunload ----------
  let testInProgress = false;
  window.addEventListener("beforeunload", (e) => {
    if (testInProgress && Object.keys(answers).length > 0 && Object.keys(answers).length < TOTAL_ITEMS) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  });

  // ---------- Reset ----------
  if (btnReset) {
    if (Object.keys(answers).length > 0) {
      btnReset.hidden = false;
    }
    btnReset.addEventListener("click", () => {
      if (!confirm(UI.resetConfirm)) return;
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(CODE_KEY);
      sessionStorage.removeItem(RESULT_KEY);
      answers = {};
      location.reload();
    });
  }

  // ---------- Code-Feld ----------
  if (probandInput) {
    const saved = sessionStorage.getItem(CODE_KEY) || "";
    if (saved) probandInput.value = saved;
    probandInput.addEventListener("input", () => {
      try { sessionStorage.setItem(CODE_KEY, probandInput.value); } catch {}
    });
  }

  // ---------- Start ----------
  function startTest() {
    if (probandInput) {
      try { sessionStorage.setItem(CODE_KEY, probandInput.value || ""); } catch {}
    }
    if (intro) intro.hidden = true;
    form.hidden = false;
    if (actionsRow) actionsRow.hidden = false;
    if (progressWrap) progressWrap.hidden = false;
    testInProgress = true;
    ensureSectionContainers();
    renderAllItems();
    showSection(0);
  }

  if (btnStart) btnStart.addEventListener("click", startTest);

  // Falls bereits Antworten vorhanden -> direkt fortsetzen
  if (Object.keys(answers).length > 0) {
    if (intro) intro.hidden = true;
    form.hidden = false;
    if (actionsRow) actionsRow.hidden = false;
    if (progressWrap) progressWrap.hidden = false;
    testInProgress = true;
    ensureSectionContainers();
    renderAllItems();
    let resumeIdx = 0;
    for (let i = 0; i < D.sections.length; i++) {
      if (!isSectionComplete(i)) { resumeIdx = i; break; }
      resumeIdx = i;
    }
    showSection(resumeIdx);
  }
})();
