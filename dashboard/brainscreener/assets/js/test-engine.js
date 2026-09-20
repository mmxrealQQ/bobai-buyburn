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
    // A stored "null" or an array is not a set of answers.
    try { const a = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); return a && typeof a === "object" && !Array.isArray(a) ? a : {}; }
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
    // A screen reader used to say "Not at all, radio button, 1 of 4" without the question.
    return `<div class="likert cols-${cols}" role="radiogroup" aria-labelledby="q-${itemId}">${opts}</div>`;
  }

  function itemHTML(item, idx, defaultScale) {
    const scale = item.scale || defaultScale;
    return `
      <div class="item ${answers[item.id] !== undefined ? 'is-answered' : ''}" data-id="${item.id}">
        <div class="item-num">${UI.question} ${idx}</div>
        <div class="item-q" id="q-${item.id}">${item.text}</div>
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
      banner.innerHTML = `<h2 tabindex="-1">${sec.title}</h2>${sec.intro ? `<p>${sec.intro}</p>` : ""}`;
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
      if (itemEl) { itemEl.classList.add("is-answered"); itemEl.classList.remove("is-missing"); }
      updateProgress();
      if (missingNote) missingNote.hidden = true;
    }
  }

  function updateProgress() {
    const answered = Object.keys(answers).length;
    const pct = Math.round((answered / TOTAL_ITEMS) * 100);
    if (progressFill) progressFill.style.width = pct + "%";
    const bar = progressFill && progressFill.parentElement;
    if (bar) { bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(TOTAL_ITEMS)); bar.setAttribute("aria-valuenow", String(answered)); bar.setAttribute("aria-label", "Questions answered"); }
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
  // JS scrolling overrides the CSS reduced-motion rule, so it asks for itself.
  const SCROLL = (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth";
  let sectionShownOnce = false;
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
    window.scrollTo({ top: 0, behavior: SCROLL });
    // Focus used to stay on "Next" at the bottom while the page scrolled to the top.
    if (sectionShownOnce) { const h = form.querySelector(`.section-banner[data-section="${D.sections[idx].id}"] h2`); if (h) h.focus({ preventScroll: true }); }
    sectionShownOnce = true;
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
          // The mark stays until the question is answered (it used to vanish after
          // 1.4 s), and the first option takes the focus so a keyboard or screen
          // reader lands on the open question instead of staying on the button.
          el.classList.add("is-missing");
          el.scrollIntoView({ behavior: SCROLL, block: "center" });
          const first = el.querySelector("input");
          if (first) first.focus({ preventScroll: true });
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
    const stored = sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload));
    testInProgress = false;
    toResult(D.meta.resultPath, payload, stored);
  });

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

  if (btnReset) {
    if (Object.keys(answers).length > 0) {
      btnReset.hidden = false;
    }
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
    showRestart();
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
    showRestart();
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
