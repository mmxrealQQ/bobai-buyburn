// brainScreener: Regressionstests zur Scoring-Durchsicht vom 20.09.2026 (uebernommen aus adhsiq). Aufruf: node scripts/brainscreener-regressions.cjs
//  1) EAT-26: E25 "reichhaltige Speisen" zaehlt zu Diaet, E26 "Drang zu erbrechen" zu Bulimie (Garner 1982).
//  2) PHQ-9: Item 9 zaehlt im DSM-Algorithmus bereits ab Wert 1 (PHQ-Manual).
//  3) PHQ-9: bejahtes Item 9 bei tiefem Total heisst nie "unauffaellig"; Krisenbox zuerst, Tacho nicht gruen.
//  4) IQ: Perzentil bleibt in 1..99.  5) IQ: keine feste Antwortposition verraet die Loesung.
//  6) WHODAS: "Keine" bei Arbeit ist nicht "trifft nicht zu" (Nenner 144 vs. 128).
//  7) ADHS-Kindheits-Skala (in Anlehnung an WURS-K): Schwelle 36/100 statt 30.
//  8) Seiten, Ergebnistext und llms.txt nennen die WURS-K nur als Vorlage ("based on"), nie als eingesetztes Instrument.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "dashboard", "brainscreener", "assets", "js", "i18n", "en");
const dirs = { en: root };

let ok = true;
const check = (name, cond, info = "") => { if (!cond) ok = false; console.log((cond ? "PASS " : "FAIL ") + name + (info ? "  " + info : "")); };
function load(file, key = "TEST_DATA") { global.window = {}; eval(fs.readFileSync(file, "utf8")); return global.window[key]; }

for (const [lang, dir] of Object.entries(dirs)) {
  // ---- 1) EAT-26: alles "Nie" (0) ausser E3 "Oft" (3) ----
  const eat = load(path.join(dir, "eat26-data.js"));
  const a = {}; for (const it of eat.sections[0].items) a[it.id] = 0; a.E3 = 3;
  const r = eat.evaluate(a);
  const subMax = {}; for (const it of eat.sections[0].items) subMax[it.sub] = (subMax[it.sub] || 0) + 3;
  check(`${lang} EAT-26 Subskalen`, r.subs.bulimia === 1 && r.subs.diet === 3 && r.subs.oral === 0 && r.total === 4 && r.flag === "low" && !Object.values(r.subFlags).some(Boolean), JSON.stringify(r.subs));
  check(`${lang} EAT-26 Maxima 39/18/21`, subMax.diet === 39 && subMax.bulimia === 18 && subMax.oral === 21);

  // ---- 1b) EAT-26 Einstufung: keine erfundenen Subskalen-Cutoffs als "high"; Erbrechen nie "unauffaellig" ----
  const eatRun = (over) => { const o = {}; for (const it of eat.sections[0].items) o[it.id] = it.reverse ? 5 : 0; Object.assign(o, over); const e = eat.evaluate(o); return { e, r: eat.renderResult(e) }; };
  const preocc = eatRun({ E3: 5, E18: 3 });          // Bulimie-Subskala 4 nur aus Essens-Gedanken
  const vomit = eatRun({ E9: 5 });                   // erbricht "immer", Total 3
  const vomitPlus = eatRun({ E9: 5, E3: 3 });        // Erbrechen + Bulimie-Subskala 4
  const cut20 = eatRun({ E1: 5, E6: 5, E7: 5, E10: 5, E11: 5, E12: 5, E14: 4 }); // Total 20
  check(`${lang} EAT-26: Bulimie-Subskala allein ist nicht mehr "high"`, preocc.e.subs.bulimia === 4 && preocc.e.total === 4 && preocc.e.flag === "moderate" && !preocc.e.purging);
  check(`${lang} EAT-26: Erbrechen ist nie "unauffaellig"`, vomit.e.total === 3 && vomit.e.purging === true && vomit.e.flag === "moderate" && vomit.r.flag === "moderate" && vomit.r.nextSteps.length === preocc.r.nextSteps.length + 1 && vomit.r.interpretationHTML.length > eat.renderResult(Object.assign({}, vomit.e, { purging: false })).interpretationHTML.length);
  check(`${lang} EAT-26: Erbrechen + Bulimie-Subskala -> "high"`, vomitPlus.e.flag === "high");
  check(`${lang} EAT-26: Gesamt-Cutoff 20 -> "moderate", ohne Erbrechen-Hinweis`, cut20.e.total === 20 && cut20.e.cutoffReached && cut20.e.flag === "moderate" && !cut20.e.purging && cut20.r.interpretationHTML === eat.renderResult(Object.assign({}, cut20.e, { purging: false })).interpretationHTML);

  // ---- 2) PHQ-9 Algorithmus ----
  const phq = load(path.join(dir, "phq9-data.js"));
  const run = (ans) => { const e = phq.evaluate(ans); return { e, r: phq.renderResult(e) }; };
  const p1 = phq.evaluate({ P1: 2, P2: 2, P3: 2, P4: 2, P9: 1 });
  const p2 = phq.evaluate({ P1: 2, P2: 2, P3: 2, P4: 2, P5: 1 });
  const p3 = phq.evaluate({ P1: 2, P2: 2, P3: 2, P4: 2 });
  check(`${lang} PHQ-9 Item 9 zaehlt ab 1`, p1.mddAlgorithm === true && p1.itemsAtLeast2 === 5);
  check(`${lang} PHQ-9 andere Items erst ab 2`, !p2.mddAlgorithm && p2.itemsAtLeast2 === 4 && !p3.mddAlgorithm && p3.itemsAtLeast2 === 4);

  // ---- 3) PHQ-9 Darstellung bei bejahtem Item 9 ----
  const clean = run({});
  const low = run({ P9: 3 });
  const mild = run({ P1: 1, P2: 1, P3: 1, P4: 1, P5: 1, P9: 1 });
  const mod = run({ P1: 2, P2: 2, P3: 2, P4: 2, P5: 2, P9: 1 });
  const high = run({ P1: 3, P2: 3, P3: 3, P4: 3, P5: 3, P6: 3, P9: 2 });
  check(`${lang} PHQ-9 ohne Item 9 unveraendert`, clean.r.flag === "low" && !clean.r.crisisFirst);
  check(`${lang} PHQ-9 Item 9 + tiefes Total`, low.e.total === 3 && low.e.flag === "low" && low.r.flag === "moderate" && low.r.crisisFirst === true && low.r.title !== clean.r.title);
  check(`${lang} PHQ-9 Item 9 + leichtes Total`, mild.e.flag === "low" && mild.r.flag === "moderate" && mild.r.crisisFirst && mild.r.title === low.r.title);
  check(`${lang} PHQ-9 Item 9 + mittel/hoch: Krisenbox zuerst`, mod.r.flag === "moderate" && mod.r.crisisFirst && mod.r.title !== low.r.title && high.r.flag === "high" && high.r.crisisFirst);
  check(`${lang} PHQ-9 Score unangetastet`, low.r.value === 3 && low.e.severity === clean.e.severity);

  // ---- 4) IQ-Perzentil 1..99 ----
  const iq = load(path.join(dir, "iq-data.js"), "IQ_DATA");
  const none = iq.evaluate({});
  const all = {}; for (const it of iq.ITEMS) all[it.id] = it.correct != null ? it.correct : it.answer;
  const best = iq.evaluate(all);
  check(`${lang} IQ-Perzentil in 1..99`, none.percentile >= 1 && best.percentile <= 99, `min=${none.percentile} max=${best.percentile} (Rohwert ${best.correct}/${best.total})`);

  // ---- 5) IQ: keine Antwortposition darf die Loesung verraten ----
  // (bis 20.09.2026 standen 22 von 40 Loesungen an 3. Stelle -> "immer Option 3" ergab IQ 100)
  let worst = 0;
  for (let pos = 0; pos < 6; pos++) {
    const always = {}; for (const it of iq.ITEMS) always[it.id] = pos;
    worst = Math.max(worst, iq.evaluate(always).correct);
  }
  check(`${lang} IQ: konstante Antwortposition bleibt deutlich unter dem Mittel (22)`, worst <= 14, `max. Treffer mit fester Position: ${worst}/40`);
  check(`${lang} IQ: Loesungen liegen in den Optionen`, iq.ITEMS.every((it) => it.answer >= 0 && it.answer < it.options.length));

  // ---- 6) WHODAS: "Keine" bei der Arbeit ist NICHT "trifft nicht zu" ----
  const who = load(path.join(dir, "whodas36-data.js"));
  const base = {}; let budget = 32;
  for (const sec of who.sections) for (const it of sec.items) {
    if (sec.id === "work") { base[it.id] = 0; continue; }
    const v = budget >= 2 ? 2 : 0; base[it.id] = v; budget -= v;
  }
  const worker = who.evaluate(base);                                  // arbeitet, dort keine Probleme
  const na = Object.assign({}, base); for (const it of who.sections.find((s) => s.id === "work").items) na[it.id] = -1;
  const notWorking = who.evaluate(na);                                // nicht erwerbstaetig
  check(`${lang} WHODAS: Erwerbstaetige ohne Arbeitsprobleme behalten 36 Items`, worker.max === 144 && worker.total === 32 && worker.pct === 22 && worker.flag === "low" && worker.workNotApplicable === false, `${worker.total}/${worker.max} = ${worker.pct} %`);
  check(`${lang} WHODAS: "Trifft nicht zu" -> 32-Item-Auswertung`, notWorking.max === 128 && notWorking.total === 32 && notWorking.pct === 25 && notWorking.workNotApplicable === true && notWorking.domains.work.skipped === true, `${notWorking.total}/${notWorking.max} = ${notWorking.pct} %`);
  check(`${lang} WHODAS: Arbeits-Skala hat die Zusatzoption, die anderen nicht`, who.sections.every((s) => s.scale.options.some((o) => o.v === -1) === (s.id === "work")));
  who.renderResult(worker); who.renderResult(notWorking);             // darf nicht werfen

  // ---- 7) ADHS-Kindheits-Skala: Schwelle 36/100 (= WURS-K-Cutoff 30/84, proportional) ----
  const adhs = load(path.join(dir, "adhs-data.js"), "ADHS_DATA");
  const childhood = (sum) => { const o = {}; let rest = sum; for (const it of adhs.WURSK) { const v = Math.min(4, rest); o[it.id] = v; rest -= v; } return adhs.evaluate(o); };
  const c35 = childhood(35), c36 = childhood(36);
  check(`${lang} ADHS-Kindheits-Skala: 35 unauffaellig, 36 erhoeht`, c35.wursk.sum === 35 && !c35.wursk.elevated && c35.overall.flag === "low" && c36.wursk.sum === 36 && c36.wursk.elevated && c36.overall.flag === "moderate" && c36.wursk.cutoff === 36 && c36.wursk.max === 100);
}

// ---- 8) The childhood scale is BASED ON the WURS-K and is named so wherever a visitor or a crawler reads it ----
// (until 20.09.2026 titles, descriptions, JSON-LD, llms.txt and the result text still listed "ASRS v1.1 + WURS-K" as the instruments used)
{
  const bs = path.join(__dirname, "..", "dashboard", "brainscreener");
  const read = [
    ...fs.readdirSync(bs).filter((f) => f.endsWith(".html")).map((f) => path.join(bs, f)),
    path.join(root, "adhs-result.js"),
    path.join(__dirname, "..", "dashboard", "llms.txt"),
  ];
  const named = (text) => {
    const bad = [];
    const flat = text.replace(/\s+/g, " ");
    for (let i = flat.indexOf("WURS-K"); i !== -1; i = flat.indexOf("WURS-K", i + 1)) {
      const before = flat.slice(Math.max(0, i - 90), i).replace(/<[^>]+>/g, " "), after = flat.slice(i + 6, i + 20);
      if (!/based on/i.test(before) && !/^ cutoff/.test(after)) bad.push(flat.slice(Math.max(0, i - 40), i + 6));
    }
    return bad;
  };
  const bad = read.flatMap((f) => named(fs.readFileSync(f, "utf8")).map((s) => path.basename(f) + ": …" + s));
  check("WURS-K steht nirgends als eingesetztes Instrument", bad.length === 0, bad.slice(0, 4).join(" | "));
  check("… und der Pruefer faengt die alte Schreibweise", named("ADHD test for adults — ASRS v1.1 + WURS-K").length === 1 && named("a childhood scale based on the WURS-K").length === 0);
  const label = load(path.join(root, "adhs-data.js"), "ADHS_DATA").ui.sectionLabels.W;
  check("ADHS Abschnitt 3 heisst nicht WURS-K", !/WURS/.test(label), label);
}

console.log(ok ? "\nAlles sauber." : "\nFEHLER");
if (!ok) process.exitCode = 1;
