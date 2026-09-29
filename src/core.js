/*
 * GMC Maritime Academy Student Registry — core data logic.
 * Pure functions (no DOM, no Electron) so they can be unit-tested in Node
 * and loaded in the renderer as window.Core.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  const LEVELS = [
    // Support: every subject is common and Deck/Engine students are handled together.
    { id: 'SUP', name: 'Support Level', short: 'Support', unified: true },
    { id: 'OLA', name: 'Operational Level A', short: 'Operational A' },
    { id: 'OLB', name: 'Operational Level B', short: 'Operational B' },
    // Management levels are separate for Deck and Engine: the student's specialty completes the name
    // (e.g. "Management Deck Function 1" / "Management Engine Function 1").
    { id: 'MF1', name: 'Management Function 1', short: 'Management F1', split: true, n: 1 },
    { id: 'MF2', name: 'Management Function 2', short: 'Management F2', split: true, n: 2 },
    { id: 'MF3', name: 'Management Function 3', short: 'Management F3', split: true, n: 3 },
  ];
  const LEVEL_IDS = LEVELS.map((l) => l.id);

  /**
   * Classes (τμήματα) per level. Support: Morning 1 / Morning 2 / Afternoon (Deck & Engine together).
   * Operational A/B: Morning / Afternoon for each of Deck and Engine.
   * Management: each class runs either in the morning or in the afternoon — one choice per year
   * for the whole class (stored on the year), not per student.
   */
  const SECTIONS = {
    SUP: [
      { id: 'M1', name: 'Morning 1' },
      { id: 'M2', name: 'Morning 2' },
      { id: 'AF', name: 'Afternoon' },
    ],
    OL: [
      { id: 'MO', name: 'Morning' },
      { id: 'AF', name: 'Afternoon' },
    ],
  };
  // The classes in use (editable in Ρυθμίσεις → Τμήματα). "OL" also serves the Management shifts.
  let SECTION_CFG = cloneSections(SECTIONS);

  function cloneSections(cfg) {
    return { SUP: (cfg.SUP || []).map((x) => ({ id: x.id, name: x.name })), OL: (cfg.OL || []).map((x) => ({ id: x.id, name: x.name })) };
  }

  function validSectionList(list) {
    return Array.isArray(list) && list.every((x) => x && typeof x.id === 'string' && typeof x.name === 'string');
  }

  /** Activate a database's class configuration. */
  function useSections(cfg) {
    SECTION_CFG = cloneSections({
      SUP: cfg && validSectionList(cfg.SUP) ? cfg.SUP : SECTIONS.SUP,
      OL: cfg && validSectionList(cfg.OL) ? cfg.OL : SECTIONS.OL,
    });
  }

  // ------------------------------------------------------------ periods (intakes)
  /**
   * Intakes inside each academic year, stored on the enrollment (enrollment.period = id | null).
   * Support: October and January · Operational A: October · Operational B: January or May ·
   * Management: none. Both lists are editable in Ρυθμίσεις (settings.periods / settings.levelPeriods).
   */
  const DEFAULT_PERIODS = [
    { id: 'OCT', name: 'Οκτώβριος', short: 'Οκτ' },
    { id: 'JAN', name: 'Ιανουάριος', short: 'Ιαν' },
    { id: 'MAY', name: 'Μάιος', short: 'Μάι' },
  ];
  const DEFAULT_LEVEL_PERIODS = { SUP: ['OCT', 'JAN'], OLA: ['OCT'], OLB: ['JAN', 'MAY'] };

  // Month names and abbreviations on normalised text (lowercase, no accents, ς → σ):
  // Greek (nominative, genitive, colloquial) and English.
  const MONTH_RES = [
    /^(ιαν|ιανουαρ[α-ω]*|jan|january)$/,
    /^(φεβ|φεβρ|φεβρουαρ[α-ω]*|feb|february)$/,
    /^(μαρ|μαρτ[α-ω]*|mar|march)$/,
    /^(απρ|απριλ[α-ω]*|apr|april)$/,
    /^(μαι|μαιοσ|μαιου|μαη|may)$/,
    /^(ιουν[α-ω]*|jun|june)$/,
    /^(ιουλ[α-ω]*|jul|july)$/,
    /^(αυγ|αυγουστ[α-ω]*|aug|august)$/,
    /^(σεπ|σεπτ|σεπτεμβρ[α-ω]*|sep|sept|september)$/,
    /^(οκτ|οκτωβρ[α-ω]*|oct|october)$/,
    /^(νοε|νοεμ|νοεμβρ[α-ω]*|nov|november)$/,
    /^(δεκ|δεκεμβρ[α-ω]*|dec|december)$/,
  ];
  const MONTH_IDS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function textTokens(text) {
    return normText(text).split(/[^a-z0-9α-ω]+/).filter(Boolean);
  }

  function monthOfToken(t) {
    for (let i = 0; i < 12; i++) if (MONTH_RES[i].test(t)) return i + 1;
    return null;
  }

  /** First month name found in a text (1–12) or null. */
  function monthOfText(text) {
    for (const t of textTokens(text)) {
      const m = monthOfToken(t);
      if (m) return m;
    }
    return null;
  }

  function validPeriodList(list) {
    if (!Array.isArray(list)) return false;
    const seen = new Set();
    return list.every((p) => {
      if (!p || typeof p.id !== 'string' || !p.id.trim() || typeof p.name !== 'string' || !p.name.trim() || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  function clonePeriods(list) {
    return list.map((p) => ({ id: p.id, name: p.name, short: typeof p.short === 'string' && p.short.trim() ? p.short : p.name.trim().slice(0, 3) }));
  }

  /** levelPeriods with only known levels and known period ids (defaults when not an object). */
  function cleanLevelPeriods(lp, periods) {
    const known = new Set(periods.map((p) => p.id));
    const src = lp && typeof lp === 'object' && !Array.isArray(lp) ? lp : DEFAULT_LEVEL_PERIODS;
    const out = {};
    Object.keys(src).forEach((lv) => {
      if (!LEVEL_IDS.includes(lv) || !Array.isArray(src[lv])) return;
      const ids = [];
      src[lv].forEach((id) => {
        if (typeof id === 'string' && known.has(id) && !ids.includes(id)) ids.push(id);
      });
      out[lv] = ids;
    });
    return out;
  }

  // The periods in use (like SECTION_CFG): list, lookup, month of each period, periods per level.
  let PERIOD_CFG = [];
  let PERIOD_BY_ID = new Map();
  let PERIOD_MONTH = new Map();
  let LEVEL_PERIOD_CFG = {};

  /** Activate a database's period configuration (settings.periods / settings.levelPeriods). */
  function usePeriods(settings) {
    const list = settings && validPeriodList(settings.periods) ? settings.periods : DEFAULT_PERIODS;
    PERIOD_CFG = clonePeriods(list);
    PERIOD_BY_ID = new Map(PERIOD_CFG.map((p) => [p.id, p]));
    PERIOD_MONTH = new Map(PERIOD_CFG.map((p) => [p.id, monthOfText(p.id) || monthOfText(p.name) || monthOfText(p.short)]));
    LEVEL_PERIOD_CFG = cleanLevelPeriods(settings && settings.levelPeriods, PERIOD_CFG);
  }
  usePeriods(null);

  /** Every period in use, in settings order (copies). */
  function periodList() {
    return PERIOD_CFG.map((p) => ({ id: p.id, name: p.name, short: p.short }));
  }

  /** The periods of a level (period objects, in settings order); [] when the level has none. */
  function levelPeriods(db, levelId) {
    const s = db && db.settings;
    const list = s && validPeriodList(s.periods) ? s.periods : PERIOD_CFG;
    const lp = s && s.levelPeriods && typeof s.levelPeriods === 'object' ? s.levelPeriods : LEVEL_PERIOD_CFG;
    const ids = lp[levelId];
    if (!Array.isArray(ids) || !ids.length) return [];
    return list.filter((p) => ids.includes(p.id));
  }

  function levelHasPeriods(db, levelId) {
    return levelPeriods(db, levelId).length > 0;
  }

  /** The only period of a level (e.g. Operational A → OCT), else null. */
  function singlePeriod(db, levelId) {
    const l = levelPeriods(db, levelId);
    return l.length === 1 ? l[0].id : null;
  }

  function validPeriodFor(db, levelId, id) {
    return !!id && levelPeriods(db, levelId).some((p) => p.id === id);
  }

  function periodName(id) {
    if (!id) return '';
    const p = PERIOD_BY_ID.get(id);
    return p ? p.name : String(id);
  }

  function periodShort(id) {
    if (!id) return '';
    const p = PERIOD_BY_ID.get(id);
    return p ? p.short : String(id);
  }

  /** Sort position of a period (settings order; no period last). */
  function periodIndex(id) {
    if (!id) return 999;
    const i = PERIOD_CFG.findIndex((p) => p.id === id);
    return i < 0 ? 998 : i;
  }

  /**
   * The period that tells classes apart: null when the level has a single period and this is it
   * (every Operational A class is an October class, so the name does not need it).
   */
  function classPeriod(db, levelId, period) {
    if (!period) return null;
    const l = levelPeriods(db, levelId);
    return l.length === 1 && l[0].id === period ? null : period;
  }

  function periodForMonth(m) {
    if (!m) return null;
    for (const p of PERIOD_CFG) if (PERIOD_MONTH.get(p.id) === m) return p.id;
    return null;
  }

  /** Month of a date, rounded to the nearest midnight (Excel dates may come a few hours off). */
  function dateMonth(d) {
    const t = d.getTime();
    if (!isFinite(t)) return null;
    return new Date(t + 12 * 3600 * 1000).getMonth() + 1;
  }

  /**
   * Read a period from a cell/text: id ("OCT"), name or short ("Οκτώβριος", "Οκτ"), a month in Greek
   * (with or without accents, also genitive: "Οκτωβρίου", "Μαΐου") or English ("oct", "October"),
   * a month number (10, "01", 5), a date (JS Date, "01/10/2026", "2026-10-01", Excel serial) → the
   * period of that month. Returns a period id of the active list, or null.
   */
  function parsePeriod(value) {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      value = value.v instanceof Date || typeof value.v === 'number' ? value.v : value.w != null && value.w !== '' ? value.w : value.v;
    }
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return periodForMonth(dateMonth(value));
    if (typeof value === 'number') {
      if (!isFinite(value)) return null;
      if (Number.isInteger(value) && value >= 1 && value <= 12) return periodForMonth(value);
      if (value > 20000 && value < 80000) return periodForMonth(new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).getUTCMonth() + 1);
      return null;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const c = compact(raw);
    for (const p of PERIOD_CFG) if (compact(p.id) === c || compact(p.name) === c || compact(p.short) === c) return p.id;
    let mm;
    let m = null;
    if ((mm = /^(\d{1,2})$/.exec(raw))) m = +mm[1];
    else if ((mm = /^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})\b/.exec(raw))) m = +mm[2]; // dd/mm/yyyy
    else if ((mm = /^(\d{4})\s*[\/.\-]\s*(\d{1,2})\b/.exec(raw))) m = +mm[2]; // yyyy-mm(-dd)
    else if ((mm = /^(\d{1,2})\s*[\/.\-]\s*(\d{4})$/.exec(raw))) m = +mm[1]; // mm/yyyy
    if (m !== null) return m >= 1 && m <= 12 ? periodForMonth(m) : null;
    const tk = textTokens(raw);
    for (const t of tk) {
      for (const p of PERIOD_CFG) {
        if (compact(p.id) === t || (compact(p.short).length >= 2 && compact(p.short) === t) || compact(p.name) === t) return p.id;
      }
    }
    for (const t of tk) {
      const id = periodForMonth(monthOfToken(t));
      if (id) return id;
    }
    return null;
  }

  function periodSettings(db) {
    db.settings = db.settings || {};
    if (!validPeriodList(db.settings.periods)) db.settings.periods = clonePeriods(DEFAULT_PERIODS);
    if (!db.settings.levelPeriods || typeof db.settings.levelPeriods !== 'object') db.settings.levelPeriods = cleanLevelPeriods(null, db.settings.periods);
    return db.settings;
  }

  /** Every enrollment has a period field; a level with a single period gets it automatically. */
  function fillSinglePeriods(db) {
    const single = {};
    LEVEL_IDS.forEach((lv) => (single[lv] = singlePeriod(db, lv)));
    db.enrollments.forEach((e) => {
      if (e.period === undefined) e.period = null;
      if (!e.period && single[e.levelId]) e.period = single[e.levelId];
    });
  }

  /** How many enrollments use a period. */
  function periodUsage(db, id) {
    let n = 0;
    db.enrollments.forEach((e) => e.period === id && n++);
    return n;
  }

  function periodIdFor(list, name, short) {
    const used = new Set(list.map((p) => p.id));
    const m = monthOfText(name) || monthOfText(short);
    if (m && !used.has(MONTH_IDS[m - 1])) return MONTH_IDS[m - 1];
    const latin = stripAccents(String(short || name)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const base = latin.length >= 2 ? latin : 'P';
    let id = base;
    let n = 2;
    while (used.has(id) || id === 'ALL' || id === 'NONE') id = base + n++;
    return id;
  }

  function addPeriod(db, name, short) {
    const nm = String(name || '').trim();
    if (!nm) throw new Error('Γράψτε το όνομα της περιόδου.');
    const sh = String(short || '').trim() || nm.slice(0, 3);
    const list = periodSettings(db).periods;
    if (list.some((p) => compact(p.name) === compact(nm))) throw new Error('Η περίοδος «' + nm + '» υπάρχει ήδη.');
    if (list.some((p) => compact(p.short || '') === compact(sh))) throw new Error('Η συντομογραφία «' + sh + '» χρησιμοποιείται ήδη σε άλλη περίοδο.');
    const p = { id: periodIdFor(list, nm, sh), name: nm, short: sh };
    list.push(p);
    usePeriods(db.settings);
    return p;
  }

  /** Rename a period (short: undefined = keep the current one, '' = from the name). */
  function renamePeriod(db, id, name, short) {
    const list = periodSettings(db).periods;
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error('Η περίοδος δεν βρέθηκε.');
    const nm = String(name || '').trim();
    if (!nm) throw new Error('Γράψτε το όνομα της περιόδου.');
    const sh = short === undefined ? p.short || nm.slice(0, 3) : String(short || '').trim() || nm.slice(0, 3);
    if (list.some((x) => x.id !== id && compact(x.name) === compact(nm))) throw new Error('Η περίοδος «' + nm + '» υπάρχει ήδη.');
    if (list.some((x) => x.id !== id && compact(x.short || '') === compact(sh))) throw new Error('Η συντομογραφία «' + sh + '» χρησιμοποιείται ήδη σε άλλη περίοδο.');
    p.name = nm;
    p.short = sh;
    usePeriods(db.settings);
    return p;
  }

  /** Delete an unused period (it is also taken off every level). */
  function removePeriod(db, id) {
    const n = periodUsage(db, id);
    if (n) throw new Error('Η περίοδος χρησιμοποιείται από ' + n + (n === 1 ? ' εγγραφή' : ' εγγραφές') + ' και δεν μπορεί να διαγραφεί.');
    const st = periodSettings(db);
    st.periods = st.periods.filter((p) => p.id !== id);
    Object.keys(st.levelPeriods).forEach((lv) => {
      if (Array.isArray(st.levelPeriods[lv])) st.levelPeriods[lv] = st.levelPeriods[lv].filter((x) => x !== id);
    });
    usePeriods(st);
    fillSinglePeriods(db);
  }

  /** Set the periods of a level (ids of the list; [] = no periods). Returns the stored ids. */
  function setLevelPeriods(db, levelId, ids) {
    if (!LEVEL_IDS.includes(levelId)) throw new Error('Μη έγκυρο επίπεδο.');
    const st = periodSettings(db);
    const want = new Set(ids || []);
    const list = st.periods.filter((p) => want.has(p.id)).map((p) => p.id);
    if (list.length) st.levelPeriods[levelId] = list;
    else delete st.levelPeriods[levelId];
    usePeriods(st);
    fillSinglePeriods(db);
    return list;
  }

  const SPECIALTIES = [
    { id: 'DECK', name: 'Deck' },
    { id: 'ENGINE', name: 'Engine' },
  ];
  const SUBJECT_SPECIALTIES = [
    { id: 'COMMON', name: 'Κοινό (Deck & Engine)' },
    { id: 'DECK', name: 'Μόνο Deck' },
    { id: 'ENGINE', name: 'Μόνο Engine' },
  ];

  const MAX_GRADE = 5;
  const PASS_GRADE = 1;

  // ---------------------------------------------------------------- utils
  let uidCounter = 0;
  function uid(prefix) {
    uidCounter = (uidCounter + 1) % 1679616;
    return (
      (prefix || 'id') + '_' + Date.now().toString(36) + uidCounter.toString(36).padStart(4, '0') +
      Math.random().toString(36).slice(2, 6)
    );
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function stripAccents(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Lowercase, accent-free, trimmed, single-spaced text (Greek-aware). */
  function normText(s) {
    if (s === null || s === undefined) return '';
    return stripAccents(String(s)).toLowerCase().replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
  }

  function compact(s) {
    return normText(s).replace(/[\s._\-\/\\()\[\]:#№]+/g, '');
  }

  const collator = typeof Intl !== 'undefined' ? new Intl.Collator('el', { sensitivity: 'base', numeric: true }) : null;
  function compareText(a, b) {
    a = a == null ? '' : String(a);
    b = b == null ? '' : String(b);
    return collator ? collator.compare(a, b) : a.localeCompare(b);
  }

  function round(n, d) {
    const f = Math.pow(10, d || 0);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  function formatGrade(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return Number.isInteger(n) ? String(n) : String(round(n, 2)).replace('.', ',');
  }

  // ------------------------------------------------------- academic years
  /** Academic year label for a date, e.g. Sept 2026 -> "2026-2027". */
  function academicYearLabelFor(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    return d.getMonth() >= 8 ? y + '-' + (y + 1) : y - 1 + '-' + y;
  }

  function parseYearLabel(label) {
    const m = /^\s*(\d{4})\s*[-–\/]\s*(\d{2,4})\s*$/.exec(String(label || ''));
    if (!m) return null;
    const a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    if (m[2].length === 2) b = Math.floor(a / 100) * 100 + b;
    if (b !== a + 1) return null;
    return { start: a, end: b, label: a + '-' + b };
  }

  function nextYearLabel(label) {
    const p = parseYearLabel(label);
    if (!p) return academicYearLabelFor(new Date());
    return p.end + '-' + (p.end + 1);
  }

  function sortYears(years) {
    return years.slice().sort((a, b) => compareText(b.label, a.label));
  }

  // ------------------------------------------------------------ database
  function createEmptyDb(date) {
    useSections(SECTIONS);
    const label = academicYearLabelFor(date || new Date());
    const year = { id: uid('yr'), label: label, createdAt: nowIso(), mgmtShift: {} };
    const periods = clonePeriods(DEFAULT_PERIODS);
    const settings = {
      currentYearId: year.id,
      levelNames: {},
      lastSubjectId: null,
      sections: cloneSections(SECTIONS),
      periods: periods,
      levelPeriods: cleanLevelPeriods(DEFAULT_LEVEL_PERIODS, periods),
    };
    usePeriods(settings);
    return {
      schema: SCHEMA_VERSION,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      settings: settings,
      years: [year],
      students: [],
      enrollments: [],
      subjects: [],
      grades: [],
      imports: [],
      calendar: [],
      absences: [],
    };
  }

  /** Make sure an object loaded from disk has every collection/field. */
  function normalizeDb(db) {
    if (!db || typeof db !== 'object') return createEmptyDb();
    const out = db;
    out.schema = out.schema || SCHEMA_VERSION;
    out.settings = Object.assign({ currentYearId: null, levelNames: {}, lastSubjectId: null }, out.settings || {});
    const sc = out.settings.sections;
    out.settings.sections = cloneSections({
      SUP: sc && validSectionList(sc.SUP) && sc.SUP.length ? sc.SUP : SECTIONS.SUP,
      OL: sc && validSectionList(sc.OL) && sc.OL.length ? sc.OL : SECTIONS.OL,
    });
    useSections(out.settings.sections);
    out.settings.periods = clonePeriods(validPeriodList(out.settings.periods) ? out.settings.periods : DEFAULT_PERIODS);
    out.settings.levelPeriods = cleanLevelPeriods(out.settings.levelPeriods, out.settings.periods);
    usePeriods(out.settings);
    ['years', 'students', 'enrollments', 'subjects', 'grades', 'imports', 'calendar', 'absences'].forEach((k) => {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    // an absence recorded for a whole day (before absences were kept per hour) = every hour of that day
    if (out.absences.some((a) => a && a.hour === undefined)) {
      const hpd = hoursPerDay(out);
      const list = [];
      out.absences.forEach((a) => {
        if (!a || a.hour !== undefined) return void list.push(a);
        for (let h = 1; h <= hpd; h++) list.push(Object.assign({}, a, { hour: h }));
      });
      out.absences = list;
    }
    fillSinglePeriods(out);
    if (!out.years.length) {
      out.years.push({ id: uid('yr'), label: academicYearLabelFor(new Date()), createdAt: nowIso() });
    }
    out.years.forEach((y) => {
      if (!y.mgmtShift || typeof y.mgmtShift !== 'object') y.mgmtShift = {};
    });
    out.enrollments.forEach((e) => {
      if (e.section === undefined) e.section = null;
    });
    if (!out.years.some((y) => y.id === out.settings.currentYearId)) {
      out.settings.currentYearId = sortYears(out.years)[0].id;
    }
    out.subjects.forEach((s, i) => {
      if (s.order === undefined) s.order = i;
      if (s.weight === undefined || !(Number(s.weight) > 0)) s.weight = 1;
      if (s.active === undefined) s.active = true;
      if (!s.specialty || isUnifiedLevel(s.levelId)) s.specialty = 'COMMON';
    });
    return out;
  }

  /** Quick structural check used before restoring a backup. */
  function validateDbShape(obj) {
    if (!obj || typeof obj !== 'object') return 'Το αρχείο δεν περιέχει δεδομένα μητρώου.';
    const need = ['years', 'students', 'subjects', 'grades'];
    for (const k of need) if (!Array.isArray(obj[k])) return 'Λείπει η ενότητα «' + k + '» — δεν είναι αρχείο αντιγράφου του μητρώου.';
    return null;
  }

  function sectionGroup(levelId) {
    return levelId === 'SUP' ? 'SUP' : LEVEL_IDS.includes(levelId) ? 'OL' : null;
  }

  function levelSections(levelId) {
    const g = sectionGroup(levelId);
    return g ? SECTION_CFG[g] : [];
  }

  /** How many enrollments (and Management shifts) use a class. */
  function sectionUsage(db, group, sectionId) {
    let n = db.enrollments.filter((e) => e.section === sectionId && sectionGroup(e.levelId) === group).length;
    if (group === 'OL') db.years.forEach((y) => Object.values(y.mgmtShift || {}).forEach((v) => v === sectionId && n++));
    return n;
  }

  function addSection(db, group, name) {
    const nm = String(name || '').trim();
    if (!nm) throw new Error('Γράψτε το όνομα του τμήματος.');
    const list = db.settings.sections[group];
    if (list.some((x) => compact(x.name) === compact(nm))) throw new Error('Το τμήμα «' + nm + '» υπάρχει ήδη.');
    const sec = { id: 'S' + Date.now().toString(36).slice(-5).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), name: nm };
    list.push(sec);
    useSections(db.settings.sections);
    return sec;
  }

  function renameSection(db, group, sectionId, name) {
    const nm = String(name || '').trim();
    if (!nm) throw new Error('Γράψτε το όνομα του τμήματος.');
    const list = db.settings.sections[group];
    if (list.some((x) => x.id !== sectionId && compact(x.name) === compact(nm))) throw new Error('Το τμήμα «' + nm + '» υπάρχει ήδη.');
    const sec = list.find((x) => x.id === sectionId);
    if (!sec) throw new Error('Το τμήμα δεν βρέθηκε.');
    sec.name = nm;
    useSections(db.settings.sections);
  }

  function removeSection(db, group, sectionId) {
    const n = sectionUsage(db, group, sectionId);
    if (n) throw new Error('Το τμήμα χρησιμοποιείται από ' + n + (n === 1 ? ' εγγραφή' : ' εγγραφές') + ' και δεν μπορεί να διαγραφεί.');
    db.settings.sections[group] = db.settings.sections[group].filter((x) => x.id !== sectionId);
    useSections(db.settings.sections);
  }

  function sectionName(levelId, sectionId) {
    const s = levelSections(levelId).find((x) => x.id === sectionId);
    return s ? s.name : '';
  }

  function sectionIndex(levelId, sectionId) {
    const i = levelSections(levelId).findIndex((x) => x.id === sectionId);
    return i < 0 ? 99 : i;
  }

  /** Management classes: one shift per year for the whole class (e.g. MF1 Deck = Afternoon). */
  function isShiftLevel(levelId) {
    return isSplitLevel(levelId);
  }

  function getMgmtShift(db, yearId, levelId, spec) {
    const y = db.years.find((x) => x.id === yearId);
    return (y && y.mgmtShift && y.mgmtShift[levelId + ':' + spec]) || null;
  }

  function setMgmtShift(db, yearId, levelId, spec, sectionId) {
    const y = db.years.find((x) => x.id === yearId);
    if (!y) throw new Error('Το έτος δεν βρέθηκε.');
    y.mgmtShift = y.mgmtShift || {};
    if (sectionId) y.mgmtShift[levelId + ':' + spec] = sectionId;
    else delete y.mgmtShift[levelId + ':' + spec];
  }

  /** The class section of a student in a year (null when not set / not enrolled). */
  function studentSection(db, student, yearId, enrollment) {
    const en = enrollment === undefined ? getEnrollment(db, student.id, yearId) : enrollment;
    if (!en) return null;
    if (isShiftLevel(en.levelId)) return hasSpec(student.specialty) ? getMgmtShift(db, yearId, en.levelId, student.specialty) : null;
    return en.section || null;
  }

  /**
   * Full class name, e.g. "Support Morning 1", "Operational Level A Deck Morning", "Management Engine Function 2 Afternoon";
   * with a period: "Support Morning 1 – Οκτώβριος".
   */
  function classFullName(db, levelId, spec, sectionId, period) {
    const sec = sectionName(levelId, sectionId);
    let base;
    if (isUnifiedLevel(levelId)) base = levelShort(levelId);
    else if (isSplitLevel(levelId)) base = levelName(db, levelId, spec);
    else base = levelName(db, levelId) + (hasSpec(spec) ? ' ' + specialtyName(spec) : '');
    const name = sec ? base + ' ' + sec : base;
    return period ? name + ' – ' + periodName(period) : name;
  }

  /** Short class name (≤ 31 chars, for Excel sheet names), e.g. "Support Morning 1 Οκτ". */
  function classShortName(levelId, spec, sectionId, period) {
    const sec = sectionName(levelId, sectionId);
    let base;
    if (isUnifiedLevel(levelId)) base = levelShort(levelId);
    else if (isSplitLevel(levelId)) base = 'Mgmt ' + (hasSpec(spec) ? specialtyName(spec) + ' ' : '') + 'F' + levelId.slice(2);
    else base = 'OL ' + levelId.slice(2) + (hasSpec(spec) ? ' ' + specialtyName(spec) : '');
    const name = sec ? base + ' ' + sec : base;
    return period ? name + ' ' + periodShort(period) : name;
  }

  /**
   * The class of a student in a year → {levelId, spec, section, period, key, name} or null when not enrolled.
   * period = the enrollment's period; key/name use classPeriod() (no period for a single-period level).
   */
  function studentClass(db, student, yearId, enrollment) {
    const en = enrollment === undefined ? getEnrollment(db, student.id, yearId) : enrollment;
    if (!en) return null;
    const spec = isUnifiedLevel(en.levelId) ? null : hasSpec(student.specialty) ? student.specialty : null;
    const section = studentSection(db, student, yearId, en);
    const period = en.period || null;
    const shown = classPeriod(db, en.levelId, period);
    return {
      levelId: en.levelId,
      spec,
      section,
      period,
      key: transcriptClassKey(en.levelId, spec, isShiftLevel(en.levelId) ? null : section, shown),
      name: classFullName(db, en.levelId, spec, section, shown),
    };
  }

  function isUnifiedLevel(levelId) {
    const l = LEVELS.find((x) => x.id === levelId);
    return !!(l && l.unified);
  }

  function isSplitLevel(levelId) {
    const l = LEVELS.find((x) => x.id === levelId);
    return !!(l && l.split);
  }

  function hasSpec(spec) {
    return spec === 'DECK' || spec === 'ENGINE';
  }

  /** Default (built-in) name of a level, completed with Deck/Engine for the Management levels. */
  function defaultLevelName(levelId, spec) {
    const l = LEVELS.find((x) => x.id === levelId);
    if (!l) return levelId || '';
    if (l.split && hasSpec(spec)) return 'Management ' + (spec === 'DECK' ? 'Deck' : 'Engine') + ' Function ' + l.n;
    return l.name;
  }

  /** Key used for custom names in settings: "SUP", "OLA", "OLB", "MF1:DECK", "MF1:ENGINE", … */
  function levelNameKey(levelId, spec) {
    return isSplitLevel(levelId) && hasSpec(spec) ? levelId + ':' + spec : levelId;
  }

  /** All nameable level variants, in display order. */
  function levelVariants() {
    const out = [];
    LEVELS.filter((l) => !l.split).forEach((l) => out.push({ levelId: l.id, spec: null }));
    ['DECK', 'ENGINE'].forEach((sp) => LEVELS.filter((l) => l.split).forEach((l) => out.push({ levelId: l.id, spec: sp })));
    return out;
  }

  function levelName(db, levelId, spec) {
    const names = db && db.settings && db.settings.levelNames;
    const custom = names && names[levelNameKey(levelId, spec)];
    if (custom) return custom;
    return defaultLevelName(levelId, spec);
  }

  function levelShort(levelId, spec) {
    const l = LEVELS.find((x) => x.id === levelId);
    if (!l) return levelId || '';
    if (l.split && hasSpec(spec)) return 'Management ' + (spec === 'DECK' ? 'Deck' : 'Engine') + ' F' + l.n;
    return l.short;
  }

  function specialtyName(id) {
    const s = SPECIALTIES.find((x) => x.id === id);
    return s ? s.name : '';
  }

  function yearLabel(db, yearId) {
    const y = db.years.find((x) => x.id === yearId);
    return y ? y.label : '';
  }

  // ----------------------------------------------------------- students
  /** Normalised registry number used for matching. */
  function normAm(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      v = Number.isInteger(v) ? String(v) : String(v);
    }
    return stripAccents(String(v)).toUpperCase().replace(/\s+/g, '');
  }

  /** Looser key: also ignores leading zeros (Excel often drops them). */
  function looseAm(v) {
    const n = normAm(v);
    const s = n.replace(/^0+(?=.)/, '');
    return s;
  }

  function studentName(s) {
    if (!s) return '';
    return [s.lastName, s.firstName].filter(Boolean).join(' ');
  }

  function sortStudents(list) {
    return list.slice().sort(
      (a, b) =>
        compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName) || compareText(a.am, b.am)
    );
  }

  function buildAmIndex(db) {
    const exact = new Map();
    const loose = new Map();
    db.students.forEach((s) => {
      const k = normAm(s.am);
      if (k) exact.set(k, s);
      const l = looseAm(s.am);
      if (l) {
        if (loose.has(l) && loose.get(l) !== s) loose.set(l, null); // ambiguous
        else loose.set(l, s);
      }
    });
    return {
      find(am) {
        const k = normAm(am);
        if (!k) return null;
        if (exact.has(k)) return exact.get(k);
        const l = looseAm(am);
        const hit = loose.get(l);
        return hit || null;
      },
    };
  }

  function findStudentByAm(db, am) {
    return buildAmIndex(db).find(am);
  }

  /** Returns an error message, or null when the AM is acceptable. */
  function validateAm(db, am, excludeStudentId) {
    const k = normAm(am);
    if (!k) return 'Ο αριθμός μητρώου είναι υποχρεωτικός.';
    const clash = db.students.find((s) => s.id !== excludeStudentId && normAm(s.am) === k);
    if (clash) return 'Ο Α.Μ. ' + am + ' ανήκει ήδη στον/στην ' + studentName(clash) + '.';
    const l = looseAm(am);
    const near = db.students.find((s) => s.id !== excludeStudentId && looseAm(s.am) === l);
    if (near)
      return 'Ο Α.Μ. ' + am + ' συμπίπτει με τον Α.Μ. ' + near.am + ' (' + studentName(near) + ') — διαφέρουν μόνο στα αρχικά μηδενικά, κάτι που προκαλεί λάθη στην αντιστοίχιση από Excel.';
    return null;
  }

  /** Suggest the next free numeric AM (keeps zero padding / prefix). */
  function suggestNextAm(db) {
    let best = null;
    db.students.forEach((s) => {
      const m = /^(.*?)(\d+)$/.exec(String(s.am || '').trim());
      if (!m) return;
      const num = parseInt(m[2], 10);
      if (!best || num > best.num) best = { prefix: m[1], num: num, width: m[2].length };
    });
    if (!best) return '';
    let cand;
    let n = best.num + 1;
    do {
      cand = best.prefix + String(n).padStart(best.width, '0');
      n++;
    } while (validateAm(db, cand));
    return cand;
  }

  function createStudent(db, data) {
    const err = validateAm(db, data.am);
    if (err) throw new Error(err);
    const s = {
      id: uid('st'),
      am: String(data.am).trim(),
      lastName: (data.lastName || '').trim(),
      firstName: (data.firstName || '').trim(),
      fatherName: (data.fatherName || '').trim(),
      specialty: data.specialty === 'ENGINE' ? 'ENGINE' : data.specialty === 'DECK' ? 'DECK' : '',
      email: (data.email || '').trim(),
      phone: (data.phone || '').trim(),
      notes: (data.notes || '').trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.students.push(s);
    return s;
  }

  function updateStudent(db, id, data) {
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new Error('Ο σπουδαστής δεν βρέθηκε.');
    if (data.am !== undefined) {
      const err = validateAm(db, data.am, id);
      if (err) throw new Error(err);
      s.am = String(data.am).trim();
    }
    ['lastName', 'firstName', 'fatherName', 'email', 'phone', 'notes'].forEach((k) => {
      if (data[k] !== undefined) s[k] = String(data[k] || '').trim();
    });
    if (data.specialty !== undefined) s.specialty = data.specialty;
    s.updatedAt = nowIso();
    return s;
  }

  function deleteStudent(db, id) {
    db.students = db.students.filter((s) => s.id !== id);
    db.enrollments = db.enrollments.filter((e) => e.studentId !== id);
    db.grades = db.grades.filter((g) => g.studentId !== id);
    db.absences = (db.absences || []).filter((a) => a && a.studentId !== id);
  }

  // --------------------------------------------------------- enrollments
  function getEnrollment(db, studentId, yearId) {
    return db.enrollments.find((e) => e.studentId === studentId && e.yearId === yearId) || null;
  }

  /**
   * The period an enrollment gets. requested: a period id, null (none) or undefined (keep `current`
   * when it is still valid for the level). A level with a single period always gets it.
   */
  function resolvePeriod(db, levelId, requested, current) {
    if (requested === undefined && current && validPeriodFor(db, levelId, current)) return current;
    if (requested && validPeriodFor(db, levelId, requested)) return requested;
    return singlePeriod(db, levelId);
  }

  /**
   * Enroll a student in a level for a year. section: a section id, null to clear,
   * or undefined to keep the current one when it is still valid for the level.
   * period: a period id, null to clear, or undefined to keep the current one when the level is unchanged
   * and it is still valid (a level with a single period gets it; a period not valid for the level → null).
   */
  function setEnrollment(db, studentId, yearId, levelId, section, period) {
    let e = getEnrollment(db, studentId, yearId);
    const valid = (sid) => !!sid && !isShiftLevel(levelId) && levelSections(levelId).some((x) => x.id === sid);
    if (e) {
      const keep = section === undefined ? e.section : section;
      const per = resolvePeriod(db, levelId, period, e.levelId === levelId ? e.period : null);
      e.levelId = levelId;
      e.section = valid(keep) ? keep : null;
      e.period = per;
      e.updatedAt = nowIso();
    } else {
      e = {
        id: uid('en'),
        studentId,
        yearId,
        levelId,
        section: valid(section) ? section : null,
        period: resolvePeriod(db, levelId, period, null),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.enrollments.push(e);
    }
    return e;
  }

  /** studentId → enrollment of one year. */
  function yearEnrollments(db, yearId) {
    const m = new Map();
    db.enrollments.forEach((e) => {
      if (e.yearId === yearId) m.set(e.studentId, e);
    });
    return m;
  }

  /** filter value: undefined / '' / 'ALL' = any, 'NONE' = without, else equal. */
  function matchFilter(filter, value) {
    if (filter === undefined || filter === null || filter === '' || filter === 'ALL') return true;
    return filter === 'NONE' ? !value : value === filter;
  }

  /** Mark that a student stopped attending during a year (grades stay and carry over if they come back). */
  function setWithdrawn(db, studentId, yearId, on) {
    const e = getEnrollment(db, studentId, yearId);
    if (!e) throw new Error('Ο σπουδαστής δεν είναι εγγεγραμμένος σε αυτό το έτος.');
    e.withdrawn = !!on;
    e.updatedAt = nowIso();
    return e;
  }

  function removeEnrollment(db, studentId, yearId) {
    db.enrollments = db.enrollments.filter((e) => !(e.studentId === studentId && e.yearId === yearId));
  }

  /**
   * section: undefined/'ALL' = any, 'NONE' = without a class, or a section id.
   * period: undefined/'ALL' = any, 'NONE' = without a period, or a period id.
   */
  function enrolledStudents(db, yearId, levelId, specialty, section, period) {
    const ens = new Map();
    db.enrollments.forEach((e) => {
      if (e.yearId === yearId && (!levelId || e.levelId === levelId)) ens.set(e.studentId, e);
    });
    return sortStudents(
      db.students.filter((s) => {
        const en = ens.get(s.id);
        if (!en) return false;
        if (specialty && specialty !== 'ALL' && (specialty === 'NONE' ? !!s.specialty : s.specialty !== specialty)) return false;
        if (!matchFilter(period, en.period || null)) return false;
        if (section && section !== 'ALL') {
          const sec = studentSection(db, s, yearId, en);
          if (section === 'NONE' ? !!sec : sec !== section) return false;
        }
        return true;
      })
    );
  }

  function nextLevel(levelId) {
    const i = LEVEL_IDS.indexOf(levelId);
    return i >= 0 && i < LEVEL_IDS.length - 1 ? LEVEL_IDS[i + 1] : null;
  }

  // ------------------------------------------------------------ subjects
  function subjectsOfLevel(db, levelId) {
    return db.subjects
      .filter((s) => s.levelId === levelId)
      .sort((a, b) => a.order - b.order || compareText(a.name, b.name));
  }

  function subjectApplies(subject, specialty) {
    if (isUnifiedLevel(subject.levelId)) return true;
    if (!specialty || specialty === 'ALL' || specialty === 'NONE') return true;
    return subject.specialty === 'COMMON' || subject.specialty === specialty;
  }

  let gradedCache = { ref: null, len: -1, yearId: null, set: null };
  /** Subjects holding grades in a year (cached while the grade list is unchanged). */
  function subjectsWithGrades(db, yearId) {
    if (gradedCache.ref === db.grades && gradedCache.len === db.grades.length && gradedCache.yearId === yearId) return gradedCache.set;
    const set = new Set();
    db.grades.forEach((g) => g.yearId === yearId && set.add(g.subjectId));
    gradedCache = { ref: db.grades, len: db.grades.length, yearId, set };
    return set;
  }

  /** Subjects shown in a gradebook: active ones, plus inactive ones that already hold grades that year. */
  function gradebookSubjects(db, yearId, levelId, specialty) {
    const withGrades = subjectsWithGrades(db, yearId);
    return subjectsOfLevel(db, levelId).filter(
      (s) => (s.active !== false || withGrades.has(s.id)) && subjectApplies(s, specialty)
    );
  }

  function createSubject(db, data) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Το όνομα του μαθήματος είναι υποχρεωτικό.');
    if (!LEVEL_IDS.includes(data.levelId)) throw new Error('Μη έγκυρο επίπεδο.');
    const code = String(data.code || '').trim();
    if (code) {
      const clash = db.subjects.find((s) => s.levelId === data.levelId && normText(s.code) === normText(code));
      if (clash) throw new Error('Ο κωδικός «' + code + '» χρησιμοποιείται ήδη στο μάθημα «' + clash.name + '».');
    }
    const siblings = subjectsOfLevel(db, data.levelId);
    const s = {
      id: uid('sb'),
      levelId: data.levelId,
      code: code,
      name: name,
      specialty: !isUnifiedLevel(data.levelId) && ['COMMON', 'DECK', 'ENGINE'].includes(data.specialty) ? data.specialty : 'COMMON',
      weight: Number(data.weight) > 0 ? Number(data.weight) : 1,
      active: data.active !== false,
      order: siblings.length ? Math.max.apply(null, siblings.map((x) => x.order)) + 1 : 0,
      createdAt: nowIso(),
    };
    const lim = parseAbsenceLimit(data.absenceLimit);
    if (lim !== null) s.absenceLimit = lim;
    db.subjects.push(s);
    return s;
  }

  function updateSubject(db, id, data) {
    const s = db.subjects.find((x) => x.id === id);
    if (!s) throw new Error('Το μάθημα δεν βρέθηκε.');
    if (data.name !== undefined) {
      if (!String(data.name).trim()) throw new Error('Το όνομα του μαθήματος είναι υποχρεωτικό.');
      s.name = String(data.name).trim();
    }
    if (data.code !== undefined) {
      const code = String(data.code || '').trim();
      if (code) {
        const clash = db.subjects.find((x) => x.id !== id && x.levelId === s.levelId && normText(x.code) === normText(code));
        if (clash) throw new Error('Ο κωδικός «' + code + '» χρησιμοποιείται ήδη στο μάθημα «' + clash.name + '».');
      }
      s.code = code;
    }
    if (data.specialty !== undefined) s.specialty = data.specialty;
    if (isUnifiedLevel(s.levelId)) s.specialty = 'COMMON';
    if (data.weight !== undefined) s.weight = Number(data.weight) > 0 ? Number(data.weight) : 1;
    if (data.active !== undefined) s.active = !!data.active;
    if (data.absenceLimit !== undefined) {
      const lim = parseAbsenceLimit(data.absenceLimit);
      if (lim === null) delete s.absenceLimit;
      else s.absenceLimit = lim;
    }
    return s;
  }

  function moveSubject(db, id, dir) {
    const s = db.subjects.find((x) => x.id === id);
    if (!s) return;
    const list = subjectsOfLevel(db, s.levelId);
    list.forEach((x, i) => (x.order = i));
    const i = list.indexOf(s);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const t = list[j].order;
    list[j].order = s.order;
    s.order = t;
  }

  function subjectLabel(s) {
    if (!s) return '';
    return s.code ? s.code + ' – ' + s.name : s.name;
  }

  // -------------------------------------------------------------- grades
  function gradeKey(studentId, subjectId, yearId) {
    return studentId + '|' + subjectId + '|' + yearId;
  }

  function buildGradeIndex(db, yearId) {
    const m = new Map();
    db.grades.forEach((g) => {
      if (!yearId || g.yearId === yearId) m.set(gradeKey(g.studentId, g.subjectId, g.yearId), g);
    });
    return m;
  }
  // ------------------------------------------------ carry-over (students who come back)
  /** Sortable start year of an academic year (2026 for "2026-2027"). */
  function yearStart(db, yearId) {
    const y = db.years.find((x) => x.id === yearId);
    const p = y ? parseYearLabel(y.label) : null;
    return p ? p.start : 0;
  }

  let carryCache = { ref: null, len: -1, years: -1, map: null };
  /** student|subject → grades of every year, newest first (cached while the grade list is unchanged). */
  function carryIndex(db) {
    if (carryCache.ref === db.grades && carryCache.len === db.grades.length && carryCache.years === db.years.length) return carryCache.map;
    const map = new Map();
    db.grades.forEach((g) => {
      const k = g.studentId + '|' + g.subjectId;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(g);
    });
    map.forEach((list) => list.sort((a, b) => yearStart(db, b.yearId) - yearStart(db, a.yearId)));
    carryCache = { ref: db.grades, len: db.grades.length, years: db.years.length, map };
    return map;
  }

  /** The original grade fails (ΑΠ, 0, 0Δ, 0Α) → the student sits the re-exam. */
  function needsReexam(g) {
    return !!g && (!!g.absent || !(Number(g.value) >= PASS_GRADE));
  }

  /**
   * The grade that counts: the re-exam grade when there is one (a new object that also carries
   * isRe: true and first: the original), else the grade itself.
   */
  function finalGrade(g) {
    if (!g || !g.re) return g;
    const re = g.re;
    return Object.assign({}, g, { value: re.value, absent: !!re.absent, att: re.att, isRe: true, first: g });
  }

  /** Passing = the final grade (re-exam when present) is ≥ 1. */
  function isPassing(g) {
    const f = finalGrade(g);
    return !!f && !f.absent && Number(f.value) >= PASS_GRADE;
  }

  /**
   * A passing grade (final grade, i.e. re-exam included) of the same subject from an EARLIER academic
   * year (the latest one), or null — the stored grade object is returned.
   * When a student leaves and later re-enrols in the same level, subjects already passed are not lost.
   */
  function carriedGrade(db, studentId, subjectId, yearId) {
    const list = carryIndex(db).get(studentId + '|' + subjectId);
    if (!list) return null;
    const ys = yearStart(db, yearId);
    for (const g of list) if (yearStart(db, g.yearId) < ys && isPassing(g)) return g;
    return null;
  }

  /** Latest earlier attempt of a subject (passing or not), for the transcript history. */
  function lastEarlierGrade(db, studentId, subjectId, yearId) {
    const list = carryIndex(db).get(studentId + '|' + subjectId);
    if (!list) return null;
    const ys = yearStart(db, yearId);
    return list.find((g) => yearStart(db, g.yearId) < ys) || null;
  }

  /** The grade that counts in a year: that year's own grade, else a carried passing grade. */
  function effectiveGrade(db, studentId, subjectId, yearId, idx) {
    const own = idx ? idx.get(gradeKey(studentId, subjectId, yearId)) : getGrade(db, studentId, subjectId, yearId);
    if (own) return own;
    return carriedGrade(db, studentId, subjectId, yearId);
  }


  function getGrade(db, studentId, subjectId, yearId) {
    return db.grades.find((g) => g.studentId === studentId && g.subjectId === subjectId && g.yearId === yearId) || null;
  }

  function percentToGrade(p) {
    p = Math.round(Number(p) * 1e6) / 1e6; // avoid 49.9999999 → fail
    if (!(p >= 50)) return 0;
    return Math.min(MAX_GRADE, Math.floor((p - 50) / 10) + 1);
  }

  /** Nominal percentage for a 0-5 grade (1 = 50%, 2 = 60% …). */
  function gradeToPercent(g) {
    if (g === null || g === undefined) return null;
    if (g < PASS_GRADE) return null;
    return 40 + g * 10;
  }

  function gradeBand(g) {
    if (g === null || g === undefined || g === '') return '';
    const n = Number(g);
    if (n < PASS_GRADE) return 'κάτω από 50%';
    if (Number.isInteger(n)) return n >= MAX_GRADE ? '90–100%' : 40 + n * 10 + '–' + (49 + n * 10) + '%';
    return '≈' + formatGrade(40 + n * 10) + '%';
  }

  const ABSENT_RE = /^(απ|απων|απουσ[α-ω]*|abs|absent|a\/b|ab)\.?$/;
  const EMPTY_RE = /^(-+|–|—|\/|x|n\/?a|-\s*-)$/;

  // 0 due to absences: J = justified (0Δ), U = unjustified (0Α)
  const ATT_TEXT = { J: '0Δ', U: '0Α' };
  const ATT_LABEL = { J: '0 – δικαιολογημένες απουσίες', U: '0 – αδικαιολόγητες απουσίες' };
  const LATIN_TO_GREEK = { a: 'α', b: 'β', e: 'ε', h: 'η', i: 'ι', k: 'κ', m: 'μ', n: 'ν', o: 'ο', p: 'ρ', t: 'τ', x: 'χ', y: 'υ', z: 'ζ' };
  const ATT_J_RE = /^(δ|δικ[α-ω]*|d|dik[a-z]*|j|just[a-z]*)$/;
  const ATT_U_RE = /^(α|αδ[α-ω]*|a|ad|adik[a-z]*|u|unj[a-z]*)$/;

  /**
   * "0Δ", "0Δικ", "0 δικαιολογημένες (απουσίες)", "0D", "0J", "0 justified" → 'J';
   * "0Α", "0Αδ", "0Αδικ", "0 αδικαιολόγητες (απουσίες)", "0A", "0U", "0 unjustified" → 'U'; else null.
   * Case, accents, spaces, dots and dashes are ignored; Greek or Latin letters.
   */
  function parseAttCode(text) {
    const k = normText(text).replace(/[\s.\-–—_()\[\]\/\\,;:'"«»]+/g, '');
    if (k.length < 2 || k[0] !== '0') return null;
    let s = k.slice(1);
    if (/[α-ω]/.test(s)) s = s.replace(/[a-z]/g, (ch) => LATIN_TO_GREEK[ch] || ch);
    if (ATT_J_RE.test(s)) return 'J';
    if (ATT_U_RE.test(s)) return 'U';
    return null;
  }

  /**
   * Parse one cell of a teacher's sheet.
   * cell: {v, w} (raw value and formatted text) or a primitive.
   * Only whole numbers 0–5, ΑΠ (absent), 0Δ / 0Α (0 due to justified / unjustified absences) are
   * accepted — decimals and percentages are rejected. → {kind:'grade', value, percent, att?} | {kind:'absent'} |
   * {kind:'empty'} | {kind:'invalid', raw, reason}. (mode is kept for backwards compatibility and ignored.)
   */
  const GRADE_RULE = 'Δεκτές τιμές: ακέραιοι 0–5, ΑΠ, 0Δ ή 0Α';
  function parseGradeCell(cell, mode) { // eslint-disable-line no-unused-vars
    let v = cell && typeof cell === 'object' && !(cell instanceof Date) ? cell.v : cell;
    const w = cell && typeof cell === 'object' && !(cell instanceof Date) ? cell.w : null;
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { kind: 'empty' };
    const raw = String(w != null && w !== '' ? w : v).trim();
    let num = null;
    if (typeof v === 'number' && w && /^\s*-?\d+,\d+\s*%?\s*$/.test(String(w))) {
      v = String(w); // "4,5" read as 45 by a thousands-separator parser
    }
    if (typeof v === 'number') {
      if (w && /%\s*$/.test(String(w))) return { kind: 'invalid', raw, reason: 'Ποσοστό — ' + GRADE_RULE };
      num = v;
    } else if (typeof v === 'boolean' || v instanceof Date) {
      return { kind: 'invalid', raw: String(w || v), reason: GRADE_RULE };
    } else {
      const t = normText(v);
      if (EMPTY_RE.test(t)) return { kind: 'empty' };
      const ta = t.replace(/[\s.]+/g, '').replace(/a/g, 'α').replace(/n/g, 'ν');
      if (ABSENT_RE.test(t.replace(/\s+/g, '')) || /^(απ|απων|απουσ[α-ω]*)$/.test(ta)) return { kind: 'absent' };
      const att = parseAttCode(t);
      if (att) return { kind: 'grade', value: 0, percent: null, att };
      let s = String(v).trim().replace(/\s+/g, '');
      if (/%$/.test(s)) return { kind: 'invalid', raw, reason: 'Ποσοστό — ' + GRADE_RULE };
      s = s.replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'invalid', raw: String(v), reason: GRADE_RULE };
      num = parseFloat(s);
    }
    if (!isFinite(num) || num < 0) return { kind: 'invalid', raw, reason: GRADE_RULE };
    if (Math.abs(num - Math.round(num)) > 1e-9) return { kind: 'invalid', raw, reason: 'Δεκαδικός βαθμός — ' + GRADE_RULE };
    num = Math.round(num);
    if (num > MAX_GRADE) return { kind: 'invalid', raw, reason: 'Εκτός κλίμακας — ' + GRADE_RULE };
    return { kind: 'grade', value: num, percent: null };
  }

  /** Grades are always on the 0–5 scale (kept for backwards compatibility). */
  function detectValueMode() {
    return 'scale';
  }

  /** Parse a grade typed by hand in the gradebook. Returns {value, absent, att?} | {clear:true} | {error}. */
  function parseManualGrade(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { clear: true };
    const p = parseGradeCell(t, 'scale');
    if (p.kind === 'absent') return { absent: true, value: null };
    if (p.kind === 'grade') return p.att ? { value: 0, absent: false, att: p.att } : { value: p.value, absent: false };
    return {
      error:
        'Μη έγκυρος βαθμός «' + t + '». Δεκτές τιμές: ακέραιοι 0, 1, 2, 3, 4, 5, ΑΠ (απών), 0Δ (0 λόγω δικαιολογημένων απουσιών) ή 0Α (0 λόγω αδικαιολόγητων απουσιών) — όχι δεκαδικοί.',
    };
  }

  /** 'J' | 'U' when valid for this grade (value 0, not absent), else null. */
  function cleanAtt(att, value, absent) {
    return (att === 'J' || att === 'U') && !absent && value !== null && value !== undefined && value !== '' && Number(value) === 0 ? att : null;
  }

  /** A re-exam record {value, absent, att?, at, by} (copied). */
  function cleanRe(re) {
    const absent = !!re.absent;
    const value = absent ? null : re.value;
    const out = { value, absent };
    const att = cleanAtt(re.att, value, absent);
    if (att) out.att = att;
    out.at = re.at || nowIso();
    out.by = re.by || '';
    return out;
  }

  /**
   * Store a grade. data: {value, absent, att?, percent?, source?, importId?, re?}.
   * att ('J' 0Δ / 'U' 0Α) is kept only with value 0 and not absent. An existing re-exam (g.re) stays
   * untouched, unless data.re is given (object = set, null = remove) or the new original grade passes.
   */
  function setGrade(db, studentId, subjectId, yearId, data) {
    let g = getGrade(db, studentId, subjectId, yearId);
    if (!g) {
      g = { id: uid('gr'), studentId, subjectId, yearId, createdAt: nowIso() };
      db.grades.push(g);
    }
    g.value = data.absent ? null : data.value;
    g.absent = !!data.absent;
    const att = cleanAtt(data.att, g.value, g.absent);
    if (att) g.att = att;
    else delete g.att;
    g.percent = data.percent === undefined ? null : data.percent;
    g.source = data.source || 'manual';
    g.importId = data.importId || null;
    g.updatedAt = nowIso();
    if (data.re !== undefined) {
      if (data.re) g.re = cleanRe(data.re);
      else delete g.re;
    }
    if (g.re && !needsReexam(g)) delete g.re; // the original passes → no re-exam
    return g;
  }

  function clearGrade(db, studentId, subjectId, yearId) {
    db.grades = db.grades.filter((g) => !(g.studentId === studentId && g.subjectId === subjectId && g.yearId === yearId));
  }

  /** State of a grade kept in import records (att always, re only when present). */
  function gradeSnapshot(g) {
    if (!g) return null;
    const s = {
      value: g.value,
      absent: !!g.absent,
      att: cleanAtt(g.att, g.value, g.absent),
      percent: g.percent == null ? null : g.percent,
      source: g.source,
      importId: g.importId || null,
      updatedAt: g.updatedAt,
    };
    if (g.re) s.re = cleanRe(g.re);
    return s;
  }

  /** Same original grade (value, ΑΠ, 0Δ/0Α)? */
  function sameGrade(a, b) {
    if (!a || !b) return false;
    if (!!a.absent !== !!b.absent) return false;
    if (a.absent) return true;
    return Number(a.value) === Number(b.value) && (cleanAtt(a.att, a.value, false) || '') === (cleanAtt(b.att, b.value, false) || '');
  }

  /** Text of a grade as stored (the original): "3", "ΑΠ", "0", "0Δ", "0Α". Also works on g.re. */
  function gradeText(g) {
    if (!g) return '';
    if (g.absent) return 'ΑΠ';
    const att = cleanAtt(g.att, g.value, false);
    if (att) return ATT_TEXT[att];
    return formatGrade(g.value);
  }

  /** Text of the grade that counts (the re-exam grade when there is one). */
  function finalText(g) {
    return gradeText(finalGrade(g));
  }

  /** Text of the re-exam grade, or ''. */
  function reText(g) {
    return g && g.re ? gradeText(g.re) : '';
  }

  /** Why an ORIGINAL grade fails: 'Απών' | 'Γραπτό 0' | '0 – δικαιολογημένες απουσίες' | '0 – αδικαιολόγητες απουσίες'; '' when it passes. */
  function gradeReason(g) {
    if (!needsReexam(g)) return '';
    if (g.absent) return 'Απών';
    const att = cleanAtt(g.att, g.value, false);
    return att ? ATT_LABEL[att] : 'Γραπτό 0';
  }

  /**
   * Enter (or clear) the re-exam grade of a failed subject (admin only).
   * data: {value, absent, att?} (as returned by parseManualGrade) or {clear:true}. Returns the grade.
   */
  function setReexam(db, studentId, subjectId, yearId, data, by) {
    const g = getGrade(db, studentId, subjectId, yearId);
    const d = data || {};
    if (d.clear) {
      if (g) delete g.re;
      return g;
    }
    if (!g) throw new Error('Δεν υπάρχει αρχικός βαθμός — η επαναληπτική εξέταση καταχωρίζεται μόνο σε μάθημα που δεν πέρασε ο σπουδαστής.');
    if (!needsReexam(g)) throw new Error('Ο σπουδαστής έχει περάσει το μάθημα (βαθμός ' + gradeText(g) + ') — δεν χρειάζεται επαναληπτική εξέταση.');
    const absent = !!d.absent;
    let value = absent ? null : d.value;
    if (!absent) {
      const n = Number(value);
      if (value === null || value === undefined || value === '' || !Number.isInteger(n) || n < 0 || n > MAX_GRADE)
        throw new Error('Μη έγκυρος βαθμός επαναληπτικής. ' + GRADE_RULE + '.');
      value = n;
    }
    g.re = cleanRe({ value, absent, att: d.att, at: nowIso(), by: by || '' });
    return g;
  }

  // -------------------------------------------------------------- results
  /**
   * Result of one student for one level in one year.
   * status: 'pass' | 'fail' | 'incomplete' | 'none'
   */
  function computeResult(subjects, gradeFor) {
    let wsum = 0;
    let w = 0;
    let graded = 0;
    let failed = 0;
    let missing = 0;
    let total = 0;
    subjects.forEach((s) => {
      const stored = gradeFor(s);
      if (!stored && s.active === false) return; // retired subject: only counts where a grade exists
      total++;
      if (!stored) {
        missing++;
        return;
      }
      const g = finalGrade(stored); // the re-exam grade counts when there is one
      if (g.absent) {
        failed++;
        return;
      }
      graded++;
      const weight = Number(s.weight) > 0 ? Number(s.weight) : 1;
      wsum += Number(g.value) * weight;
      w += weight;
      if (Number(g.value) < PASS_GRADE) failed++;
    });
    const avg = w ? round(wsum / w, 2) : null;
    let status = 'none';
    if (total) {
      if (failed) status = 'fail';
      else if (missing) status = 'incomplete';
      else status = 'pass';
    }
    return { avg, graded, failed, missing, total, status };
  }

  function studentResult(db, student, yearId, levelId, gradeIndex) {
    const subjects = gradebookSubjects(db, yearId, levelId, student.specialty || 'ALL');
    const idx = gradeIndex || buildGradeIndex(db, yearId);
    return computeResult(subjects, (s) => effectiveGrade(db, student.id, s.id, yearId, idx));
  }

  function resultLabel(r) {
    if (!r) return '';
    switch (r.status) {
      case 'pass':
        return 'Επιτυχία';
      case 'fail':
        return 'Υπολείπεται σε ' + r.failed + (r.failed === 1 ? ' μάθημα' : ' μαθήματα');
      case 'incomplete':
        return 'Εκκρεμούν ' + r.missing + (r.missing === 1 ? ' βαθμός' : ' βαθμοί');
      default:
        return 'Χωρίς μαθήματα';
    }
  }

  // --------------------------------------------------------- teachers: grading locks and class choices
  function gradeLockKey(yearId, subjectId) {
    return yearId + '|' + subjectId;
  }
  /** Locked = the teacher can no longer change this subject's grades for that year (the admin still can). */
  function gradeLock(db, yearId, subjectId) {
    const l = db.settings && db.settings.gradeLocks;
    return (l && l[gradeLockKey(yearId, subjectId)]) || null;
  }
  function setGradeLock(db, yearId, subjectId, on, by) {
    db.settings.gradeLocks = db.settings.gradeLocks || {};
    if (on) db.settings.gradeLocks[gradeLockKey(yearId, subjectId)] = { at: Date.now(), by: by || '' };
    else delete db.settings.gradeLocks[gradeLockKey(yearId, subjectId)];
  }

  /**
   * The classes a subject can be taught to → [{spec, section, label}] (value = spec|section).
   * Mirrors the server's class rule (server/teacher.go members()).
   */
  function teachingClassOptions(db, subject) {
    const L = subject.levelId;
    const out = [];
    if (isUnifiedLevel(L)) {
      out.push({ spec: '', section: '', label: levelShort(L) + ' — όλα τα τμήματα' });
      levelSections(L).forEach((sec) => out.push({ spec: '', section: sec.id, label: classFullName(db, L, null, sec.id) }));
      return out;
    }
    const specs = subject.specialty === 'COMMON' ? ['DECK', 'ENGINE'] : [subject.specialty];
    if (isShiftLevel(L)) {
      specs.forEach((sp) => out.push({ spec: sp, section: '', label: levelName(db, L, sp) }));
      return out;
    }
    if (specs.length > 1) {
      out.push({ spec: '', section: '', label: levelName(db, L) + ' — Deck & Engine, όλα τα τμήματα' });
      levelSections(L).forEach((sec) => out.push({ spec: '', section: sec.id, label: levelName(db, L) + ' ' + sec.name + ' (Deck & Engine)' }));
    }
    specs.forEach((sp) => {
      out.push({ spec: sp, section: '', label: levelName(db, L) + ' ' + specialtyName(sp) + ' — όλα τα τμήματα' });
      levelSections(L).forEach((sec) => out.push({ spec: sp, section: sec.id, label: classFullName(db, L, sp, sec.id) }));
    });
    return out;
  }

  /**
   * The periods a subject can be taught to (teacher assignment "period"):
   * [] when the level has no periods, else [{period:'', label:'Όλες οι περίοδοι'}, {period:id, label:name}…].
   */
  function teachingPeriodOptions(db, subject) {
    const list = subject ? levelPeriods(db, subject.levelId) : [];
    if (!list.length) return [];
    return [{ period: '', label: 'Όλες οι περίοδοι' }].concat(list.map((p) => ({ period: p.id, label: p.name })));
  }

  /** Students of a teaching assignment {yearId, subjectId, spec, section, period} (same rule as the server). */
  function assignmentStudents(db, a) {
    const subject = db.subjects.find((x) => x.id === a.subjectId);
    if (!subject) return [];
    const unified = isUnifiedLevel(subject.levelId);
    return enrolledStudents(db, a.yearId, subject.levelId, 'ALL', a.section || 'ALL', a.period || 'ALL').filter(
      (st) => subjectApplies(subject, st.specialty || 'ALL') && (!a.spec || unified || st.specialty === a.spec)
    );
  }

  /** Label of a teaching assignment: the class option label + " – <period>" (falls back to a.label). */
  function assignmentLabel(db, a) {
    const sj = db.subjects.find((x) => x.id === a.subjectId);
    const o = sj ? teachingClassOptions(db, sj).find((x) => x.spec === (a.spec || '') && x.section === (a.section || '')) : null;
    if (!o) return a.label || '';
    return o.label + (a.period ? ' – ' + periodName(a.period) : '');
  }

  // --------------------------------------------------------- calendar & absences
  /*
   * Teaching calendar per class (τμήμα), one subject per day:
   *   db.calendar = [{yearId, cls, date, subjectId}]      cls = calendarKey(…), date = "YYYY-MM-DD"
   * Absences per HOUR of a day (settings.hoursPerDay, default 4), for the subject his class has that day:
   *   db.absences = [{studentId, yearId, date, hour: 1…, subjectId, by, at, src: 'admin' | 'teacher'}]
   * Limit of a subject = subject.absenceLimit (hours, set by the admin; none = no limit). Every hour counts.
   * More hours of absence than the limit → the student may not start the exams of that subject, unless
   * the admin allowed it for that exam.
   * server/attendance.go mirrors calendarKey / absence counting / absenceStatus (test/attendance-fixtures.json).
   */
  const DEFAULT_HOURS_PER_DAY = 4;
  const MAX_HOURS_PER_DAY = 12;
  const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const pad2 = (n) => String(n).padStart(2, '0');

  /** A real calendar date written "YYYY-MM-DD". */
  function validIsoDate(s) {
    const m = ISO_DATE_RE.exec(typeof s === 'string' ? s : '');
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  /** A local date (default: today) → "YYYY-MM-DD". */
  function isoDate(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }

  function isoUtc(s) {
    const m = ISO_DATE_RE.exec(s);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  /** "YYYY-MM-DD" moved by n days. */
  function addDays(s, n) {
    const d = new Date(isoUtc(s) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Day of the week of "YYYY-MM-DD": 0 = Sunday … 6 = Saturday. */
  function isoWeekday(s) {
    return new Date(isoUtc(s)).getUTCDay();
  }

  /** "2026-11-12" → "12/11/2026" */
  function dateText(s) {
    const m = ISO_DATE_RE.exec(s || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(s || '');
  }

  /** First and last day of an academic year ("2026-2027" → 2026-09-01 … 2027-08-31); null when the label is not a year. */
  function yearDateRange(db, yearId) {
    const y = db.years.find((x) => x.id === yearId);
    const p = y ? parseYearLabel(y.label) : null;
    return p ? { from: p.start + '-09-01', to: p.end + '-08-31' } : null;
  }

  function checkYearDate(db, yearId, date) {
    if (!validIsoDate(date)) throw new Error('Μη έγκυρη ημερομηνία «' + date + '».');
    const r = yearDateRange(db, yearId);
    if (r && (date < r.from || date > r.to))
      throw new Error('Η ημερομηνία ' + dateText(date) + ' δεν ανήκει στο ακαδημαϊκό έτος ' + yearLabel(db, yearId) + ' (' + dateText(r.from) + ' – ' + dateText(r.to) + ').');
  }

  /** Teaching hours of a day (settings.hoursPerDay: an integer 1–12, default 4) — one absence toggle per hour. */
  function hoursPerDay(db) {
    const v = db && db.settings ? db.settings.hoursPerDay : undefined;
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_HOURS_PER_DAY ? v : DEFAULT_HOURS_PER_DAY;
  }

  function setHoursPerDay(db, value) {
    const t = String(value === undefined || value === null ? '' : value).trim();
    const n = Number(t);
    if (!t || !Number.isInteger(n) || n < 1 || n > MAX_HOURS_PER_DAY) throw new Error('Οι ώρες ανά ημέρα είναι ακέραιος από 1 έως ' + MAX_HOURS_PER_DAY + '.');
    db.settings.hoursPerDay = n;
    return n;
  }

  /** A subject's absence limit in hours (subject.absenceLimit: an integer ≥ 0), or null = no limit. */
  function subjectAbsenceLimit(subject) {
    const v = subject ? subject.absenceLimit : undefined;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
  }

  /** Form value of a limit → integer ≥ 0, or null when empty (throws on anything else). */
  function parseAbsenceLimit(value) {
    const t = String(value === undefined || value === null ? '' : value).trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error('Το όριο απουσιών είναι αριθμός ωρών (ακέραιος 0 ή μεγαλύτερος) — ή κενό για «χωρίς όριο».');
    return n;
  }

  function validHour(h) {
    return typeof h === 'number' && Number.isInteger(h) && h >= 1;
  }

  /**
   * Key of a class in the calendar: "levelId|spec|section|period" ('' = none). Support: no specialty
   * (Deck & Engine together) · Management: no section (the whole class has the year's shift).
   */
  function calendarKey(levelId, spec, section, period) {
    const sp = isUnifiedLevel(levelId) || !hasSpec(spec) ? '' : spec;
    const sec = isShiftLevel(levelId) ? '' : section || '';
    return [levelId || '', sp, sec, period || ''].join('|');
  }

  function parseCalendarKey(key) {
    const p = String(key || '').split('|');
    return { levelId: p[0] || '', spec: p[1] || null, section: p[2] || null, period: p[3] || null };
  }

  /** The calendar key of a student's class in a year (null when he is not enrolled). */
  function studentCalendarKey(db, student, yearId, enrollment) {
    const en = enrollment === undefined ? getEnrollment(db, student.id, yearId) : enrollment;
    return en ? calendarKey(en.levelId, student.specialty, en.section, en.period) : null;
  }

  /** "Support Morning 1 – Οκτώβριος", "Management Deck Function 1 Afternoon" … */
  function calendarClassName(db, yearId, key) {
    const k = parseCalendarKey(key);
    const shift = isShiftLevel(k.levelId);
    const sec = shift ? (k.spec ? getMgmtShift(db, yearId, k.levelId, k.spec) : null) : k.section;
    return classFullName(db, k.levelId, k.spec, sec, classPeriod(db, k.levelId, k.period)) + (!shift && !k.section ? ' (χωρίς τμήμα)' : '');
  }

  /**
   * The classes of a year for the calendar: every class with enrolled students plus classes that only
   * have calendar days → [{key, levelId, spec, section, period, name, students:[student]}] in class order.
   */
  function calendarClasses(db, yearId) {
    const byId = new Map(db.students.map((s) => [s.id, s]));
    const map = new Map();
    const add = (key) => {
      if (!map.has(key)) {
        const k = parseCalendarKey(key);
        map.set(key, { key, levelId: k.levelId, spec: k.spec, section: k.section, period: k.period, name: calendarClassName(db, yearId, key), students: [] });
      }
      return map.get(key);
    };
    const seen = new Set();
    db.enrollments.forEach((en) => {
      const st = byId.get(en.studentId);
      if (en.yearId !== yearId || !st || seen.has(st.id)) return;
      seen.add(st.id);
      add(studentCalendarKey(db, st, yearId, en)).students.push(st);
    });
    (db.calendar || []).forEach((d) => d && d.yearId === yearId && typeof d.cls === 'string' && add(d.cls));
    const specRank = (s) => (s === 'DECK' ? 0 : s === 'ENGINE' ? 1 : 2);
    const out = Array.from(map.values()).filter((c) => LEVEL_IDS.includes(c.levelId));
    out.forEach((c) => (c.students = sortStudents(c.students)));
    return out.sort(
      (a, b) =>
        LEVEL_IDS.indexOf(a.levelId) - LEVEL_IDS.indexOf(b.levelId) ||
        specRank(a.spec) - specRank(b.spec) ||
        periodIndex(a.period) - periodIndex(b.period) ||
        sectionIndex(a.levelId, a.section) - sectionIndex(b.levelId, b.section)
    );
  }

  /** The students of a calendar class (sorted by name). */
  function classStudents(db, yearId, key) {
    const byId = new Map(db.students.map((s) => [s.id, s]));
    const out = [];
    const seen = new Set();
    db.enrollments.forEach((en) => {
      const st = byId.get(en.studentId);
      if (en.yearId !== yearId || !st || seen.has(st.id)) return;
      seen.add(st.id);
      if (studentCalendarKey(db, st, yearId, en) === key) out.push(st);
    });
    return sortStudents(out);
  }

  /** Subjects a class can have in its calendar: its level's subjects for its specialty (active, plus inactive ones already in it). */
  function calendarSubjects(db, yearId, key) {
    const k = parseCalendarKey(key);
    const used = new Set((db.calendar || []).filter((d) => d && d.yearId === yearId && d.cls === key).map((d) => d.subjectId));
    return subjectsOfLevel(db, k.levelId).filter((s) => subjectApplies(s, k.spec || 'ALL') && (s.active !== false || used.has(s.id)));
  }

  /**
   * The calendar and the absences of a year as lookups (the first record of a day counts):
   * cal.day "cls|date" → subjectId · cal.days "cls|subjectId" → days ·
   * abs.byDay "studentId|date" → sorted hours absent · abs.bySubject "studentId|subjectId" → [{date, hour}] sorted
   * (the first record of a student's hour counts; a record without a valid hour is ignored).
   */
  function attendance(db, yearId) {
    const day = new Map();
    const days = new Map();
    (db.calendar || []).forEach((d) => {
      if (!d || d.yearId !== yearId || !d.subjectId) return;
      const k = d.cls + '|' + d.date;
      if (day.has(k)) return;
      day.set(k, d.subjectId);
      const n = d.cls + '|' + d.subjectId;
      days.set(n, (days.get(n) || 0) + 1);
    });
    const seen = new Set();
    const byDay = new Map();
    const bySubject = new Map();
    (db.absences || []).forEach((a) => {
      if (!a || a.yearId !== yearId || !validHour(a.hour)) return;
      const h = a.studentId + '|' + a.date + '|' + a.hour;
      if (seen.has(h)) return;
      seen.add(h);
      const k = a.studentId + '|' + a.date;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(a.hour);
      if (!a.subjectId) return;
      const s = a.studentId + '|' + a.subjectId;
      if (!bySubject.has(s)) bySubject.set(s, []);
      bySubject.get(s).push({ date: a.date, hour: a.hour });
    });
    byDay.forEach((l) => l.sort((x, y) => x - y));
    bySubject.forEach((l) => l.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.hour - y.hour)));
    return { yearId, hpd: hoursPerDay(db), cal: { day, days }, abs: { byDay, bySubject } };
  }

  /** The calendar record of a class on a day, or null. */
  function calendarDay(db, yearId, key, date) {
    return (db.calendar || []).find((d) => d && d.yearId === yearId && d.cls === key && d.date === date && d.subjectId) || null;
  }

  /** Days of a subject in a class calendar. */
  function subjectDays(db, yearId, key, subjectId) {
    return attendance(db, yearId).cal.days.get(key + '|' + subjectId) || 0;
  }

  /**
   * Set (subjectId) or clear (null) one day of a class calendar. The absences of the class's students
   * on that day follow: they move to the new subject, or are deleted when the day is cleared.
   * → {changed, moved, removed}
   */
  function setCalendarDay(db, yearId, key, date, subjectId) {
    checkYearDate(db, yearId, date);
    const sid = subjectId || null;
    if (sid && !db.subjects.some((s) => s.id === sid)) throw new Error('Το μάθημα δεν βρέθηκε.');
    db.calendar = db.calendar || [];
    const same = (d) => d && d.yearId === yearId && d.cls === key && d.date === date;
    const cur = db.calendar.find(same) || null;
    if ((cur ? cur.subjectId || null : null) === sid) return { changed: false, moved: 0, removed: 0 };
    db.calendar = db.calendar.filter((d) => !same(d));
    if (sid) db.calendar.push({ yearId, cls: key, date, subjectId: sid });
    const ids = new Set(classStudents(db, yearId, key).map((s) => s.id));
    let moved = 0;
    let removed = 0;
    db.absences = (db.absences || []).filter((a) => {
      if (!a || a.yearId !== yearId || a.date !== date || !ids.has(a.studentId)) return true;
      if (!sid) {
        removed++;
        return false;
      }
      if (a.subjectId !== sid) {
        a.subjectId = sid;
        moved++;
      }
      return true;
    });
    return { changed: true, moved, removed };
  }

  /** Days of a range that fillCalendar would change: {dates, change, keep} (weekdays: 0 = Sunday … 6). */
  function planFill(db, yearId, key, opts) {
    const o = opts || {};
    if (!validIsoDate(o.from) || !validIsoDate(o.to)) throw new Error('Ορίστε έγκυρες ημερομηνίες «Από» και «Έως».');
    if (o.to < o.from) throw new Error('Η ημερομηνία «Έως» είναι πριν από την «Από».');
    checkYearDate(db, yearId, o.from);
    checkYearDate(db, yearId, o.to);
    const wd = new Set(Array.isArray(o.weekdays) ? o.weekdays : [1, 2, 3, 4, 5]);
    const sid = o.subjectId || null;
    if (sid && !calendarSubjects(db, yearId, key).some((s) => s.id === sid)) throw new Error('Το μάθημα δεν ανήκει σε αυτό το τμήμα.');
    const A = attendance(db, yearId);
    const out = { dates: [], change: 0, keep: 0 };
    for (let d = o.from; d <= o.to; d = addDays(d, 1)) {
      if (!wd.has(isoWeekday(d))) continue;
      const cur = A.cal.day.get(key + '|' + d) || null;
      if (cur === sid) continue;
      if (sid && cur && !o.overwrite) {
        out.keep++;
        continue;
      }
      out.dates.push(d);
      out.change++;
    }
    return out;
  }

  /**
   * Put one subject on a range of days of a class calendar (or clear them: subjectId null).
   * opts: {from, to, weekdays, overwrite} — days that already have another subject are kept unless overwrite.
   * → {set, kept, moved, removed}
   */
  function fillCalendar(db, yearId, key, opts) {
    const plan = planFill(db, yearId, key, opts);
    const r = { set: 0, kept: plan.keep, moved: 0, removed: 0 };
    plan.dates.forEach((d) => {
      const x = setCalendarDay(db, yearId, key, d, opts.subjectId || null);
      if (x.changed) r.set++;
      r.moved += x.moved;
      r.removed += x.removed;
    });
    return r;
  }

  /** Copy the days of another class calendar of the same year (subjects the class does not have are skipped). */
  function copyCalendar(db, yearId, fromKey, toKey, overwrite) {
    if (fromKey === toKey) throw new Error('Επιλέξτε άλλο τμήμα.');
    const ok = new Set(calendarSubjects(db, yearId, toKey).map((s) => s.id));
    const A = attendance(db, yearId);
    const r = { set: 0, kept: 0, skipped: 0, moved: 0, removed: 0 };
    const src = [];
    A.cal.day.forEach((sid, k) => {
      if (k.slice(0, -11) === fromKey) src.push({ date: k.slice(-10), sid });
    });
    src.sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(({ date, sid }) => {
      if (!ok.has(sid)) return void r.skipped++;
      const cur = A.cal.day.get(toKey + '|' + date);
      if (cur === sid) return;
      if (cur && !overwrite) return void r.kept++;
      const x = setCalendarDay(db, yearId, toKey, date, sid);
      if (x.changed) r.set++;
      r.moved += x.moved;
      r.removed += x.removed;
    });
    return r;
  }

  /** The hours a student was absent on a day (sorted), [] when none. */
  function absenceHours(db, studentId, yearId, date) {
    const out = [];
    (db.absences || []).forEach((a) => {
      if (a && a.studentId === studentId && a.yearId === yearId && a.date === date && validHour(a.hour) && !out.includes(a.hour)) out.push(a.hour);
    });
    return out.sort((x, y) => x - y);
  }

  function getAbsence(db, studentId, yearId, date, hour) {
    return (db.absences || []).find((a) => a && a.studentId === studentId && a.yearId === yearId && a.date === date && a.hour === hour) || null;
  }

  /** The subject of a student's class on a day (throws when not enrolled / no subject that day). */
  function daySubjectOf(db, studentId, yearId, date) {
    const st = db.students.find((s) => s.id === studentId);
    if (!st) throw new Error('Ο σπουδαστής δεν βρέθηκε.');
    const key = studentCalendarKey(db, st, yearId);
    if (!key) throw new Error('Ο/Η ' + studentName(st) + ' δεν είναι εγγεγραμμένος/η στο ' + yearLabel(db, yearId) + '.');
    const day = calendarDay(db, yearId, key, date);
    if (!day) throw new Error('Το τμήμα του/της ' + studentName(st) + ' δεν έχει μάθημα στις ' + dateText(date) + ' στο ημερολόγιο.');
    return day.subjectId;
  }

  /**
   * Record (on = true) or remove the absence of a student in one hour of a day. It gets the subject his class
   * has that day in the calendar (no subject that day → error). meta: {by, src}. → the absence | null.
   */
  function setAbsence(db, studentId, yearId, date, hour, on, meta) {
    db.absences = db.absences || [];
    const same = (a) => a && a.studentId === studentId && a.yearId === yearId && a.date === date && a.hour === hour;
    if (!on) {
      db.absences = db.absences.filter((a) => !same(a));
      return null;
    }
    const hpd = hoursPerDay(db);
    if (!validHour(hour) || hour > hpd) throw new Error('Μη έγκυρη ώρα «' + hour + '» (1–' + hpd + ').');
    const sid = daySubjectOf(db, studentId, yearId, date);
    const m = meta || {};
    const cur = db.absences.find(same);
    if (cur) {
      if (cur.subjectId !== sid) {
        cur.subjectId = sid;
        cur.at = nowIso();
      }
      return cur;
    }
    const a = { studentId, yearId, date, hour, subjectId: sid, by: m.by || '', at: nowIso(), src: m.src || 'admin' };
    db.absences.push(a);
    return a;
  }

  /** Set exactly which hours of a day a student was absent (hours: [1…]; [] = present all day). → changes made */
  function setDayAbsences(db, studentId, yearId, date, hours, meta) {
    const want = new Set(hours || []);
    const have = absenceHours(db, studentId, yearId, date);
    let n = 0;
    have.forEach((h) => {
      if (!want.has(h)) {
        setAbsence(db, studentId, yearId, date, h, false);
        n++;
      }
    });
    Array.from(want)
      .sort((x, y) => x - y)
      .forEach((h) => {
        if (!have.includes(h)) {
          setAbsence(db, studentId, yearId, date, h, true, meta);
          n++;
        }
      });
    return n;
  }

  /**
   * A student's hours of absence in a subject (year) against the subject's limit →
   * {count, limit, over, left, days, hours, entries:[{date, hour}], dates} — limit null (never over) when
   * the subject has no limit; days / hours = the subject's days in his class calendar and their hours.
   * att: attendance(db, yearId), to reuse for many students.
   */
  function absenceStatus(db, student, subjectId, yearId, att) {
    const A = att && att.yearId === yearId ? att : attendance(db, yearId);
    const key = studentCalendarKey(db, student, yearId);
    const days = key ? A.cal.days.get(key + '|' + subjectId) || 0 : 0;
    const limit = subjectAbsenceLimit(db.subjects.find((s) => s.id === subjectId));
    const entries = (A.abs.bySubject.get(student.id + '|' + subjectId) || []).slice();
    const dates = [];
    entries.forEach((e) => dates[dates.length - 1] !== e.date && dates.push(e.date));
    const count = entries.length;
    return { count, limit, over: limit !== null && count > limit, left: limit === null ? null : limit - count, days, hours: days * A.hpd, entries, dates };
  }

  /** "12/11/2026 (1η, 3η ώρα)" lines of absence entries, grouped by day. */
  function absenceEntriesText(entries) {
    const byDate = new Map();
    (entries || []).forEach((e) => {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e.hour);
    });
    return Array.from(byDate.entries()).map(([d, hs]) => dateText(d) + ' (' + hs.map((h) => h + 'η').join(', ') + ' ώρα)');
  }

  /**
   * Hours of absence of a class per subject → {hpd, subjects:[{subject, days, limit}], rows:[{student, withdrawn, cells:[{count, over, entries}], total, over}]}.
   * subjects: those with days in the class calendar (subject order), plus any other subject its students have absences in.
   */
  function absenceSummary(db, yearId, key) {
    const A = attendance(db, yearId);
    const students = classStudents(db, yearId, key);
    const ids = new Set();
    A.cal.days.forEach((n, k) => {
      if (k.startsWith(key + '|') && k.split('|').length === 5) ids.add(k.slice(key.length + 1));
    });
    students.forEach((st) => A.abs.bySubject.forEach((l, k) => k.startsWith(st.id + '|') && ids.add(k.slice(st.id.length + 1))));
    const order = new Map(db.subjects.map((s) => [s.id, s]));
    const subjects = Array.from(ids)
      .map((id) => order.get(id))
      .filter(Boolean)
      .sort((a, b) => LEVEL_IDS.indexOf(a.levelId) - LEVEL_IDS.indexOf(b.levelId) || a.order - b.order || compareText(a.name, b.name))
      .map((s) => ({ subject: s, days: A.cal.days.get(key + '|' + s.id) || 0, limit: subjectAbsenceLimit(s) }));
    const enOf = yearEnrollments(db, yearId);
    const rows = students.map((st) => {
      const cells = subjects.map((x) => {
        const entries = A.abs.bySubject.get(st.id + '|' + x.subject.id) || [];
        return { count: entries.length, over: x.limit !== null && entries.length > x.limit, entries };
      });
      const en = enOf.get(st.id);
      return { student: st, withdrawn: !!(en && en.withdrawn), cells, total: cells.reduce((n, c) => n + c.count, 0), over: cells.some((c) => c.over) };
    });
    return { hpd: A.hpd, subjects, rows };
  }

  /**
   * The days of a subject for a group of students (e.g. a teacher's class), from their class calendars
   * → [{date, students:[student]}] in date order.
   */
  function subjectDates(db, yearId, subjectId, students) {
    const byKey = new Map();
    students.forEach((st) => {
      const k = studentCalendarKey(db, st, yearId);
      if (!k) return;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(st);
    });
    const byDate = new Map();
    attendance(db, yearId).cal.day.forEach((sid, k) => {
      if (sid !== subjectId) return;
      const list = byKey.get(k.slice(0, -11));
      if (!list) return;
      const date = k.slice(-10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(...list);
    });
    return Array.from(byDate.keys())
      .sort()
      .map((date) => ({ date, students: sortStudents(byDate.get(date)) }));
  }

  /** Calendar days and absences that name a subject (they go when the subject is deleted). */
  function subjectAttendanceUsage(db, subjectId) {
    return {
      days: (db.calendar || []).filter((d) => d && d.subjectId === subjectId).length,
      absences: (db.absences || []).filter((a) => a && a.subjectId === subjectId).length,
    };
  }

  // --------------------------------------------------------- transcripts (per student, per level)
  /**
   * Class key used by the transcript picker. Management classes are one per level+specialty (shift varies per year).
   * period (optional, use classPeriod()): classes of different periods are different classes → "…|OCT";
   * without a period the key is the same as before periods existed.
   */
  function transcriptClassKey(levelId, spec, section, period) {
    const p = period ? '|' + period : '';
    if (isShiftLevel(levelId)) return levelId + '|' + (hasSpec(spec) ? spec : '') + '|' + p;
    return levelId + '|' + (isUnifiedLevel(levelId) || !hasSpec(spec) ? '' : spec) + '|' + (section || '') + p;
  }

  /**
   * Every class that has ever had students (all academic years), with the students who attended it
   * and the years they were there. → [{key, levelId, spec, section, period, name, students:[{student, years:[yearId]}]}]
   * (period = classPeriod(): null for a level with a single period.)
   */
  function transcriptClasses(db) {
    const byKey = new Map();
    const stById = new Map(db.students.map((st) => [st.id, st]));
    const yearIds = new Set(db.years.map((y) => y.id));
    db.enrollments.forEach((en) => {
      const st = stById.get(en.studentId);
      if (!st || !yearIds.has(en.yearId)) return;
      const spec = isUnifiedLevel(en.levelId) ? null : hasSpec(st.specialty) ? st.specialty : null;
      const section = isShiftLevel(en.levelId) ? null : en.section || null;
      const period = classPeriod(db, en.levelId, en.period);
      const key = transcriptClassKey(en.levelId, spec, section, period);
      if (!byKey.has(key)) {
        let name;
        if (isShiftLevel(en.levelId)) name = levelName(db, en.levelId, spec) + (period ? ' – ' + periodName(period) : '');
        else name = classFullName(db, en.levelId, spec, section, period) + (section ? '' : ' (χωρίς τμήμα)');
        byKey.set(key, { key, levelId: en.levelId, spec, section, period, name, map: new Map() });
      }
      const c = byKey.get(key);
      if (!c.map.has(st.id)) c.map.set(st.id, { student: st, years: [] });
      c.map.get(st.id).years.push(en.yearId);
    });
    const out = Array.from(byKey.values()).map((c) => {
      const students = Array.from(c.map.values());
      students.forEach((x) => x.years.sort((a, b) => yearStart(db, a) - yearStart(db, b)));
      students.sort((a, b) => compareText(a.student.lastName, b.student.lastName) || compareText(a.student.firstName, b.student.firstName) || compareText(a.student.am, b.student.am));
      return { key: c.key, levelId: c.levelId, spec: c.spec, section: c.section, period: c.period, name: c.name, students };
    });
    const specOrder = (sp) => (sp === 'DECK' ? 0 : sp === 'ENGINE' ? 1 : 2);
    out.sort(
      (a, b) =>
        LEVEL_IDS.indexOf(a.levelId) - LEVEL_IDS.indexOf(b.levelId) ||
        specOrder(a.spec) - specOrder(b.spec) ||
        periodIndex(a.period) - periodIndex(b.period) ||
        (a.section ? sectionIndex(a.levelId, a.section) : 999) - (b.section ? sectionIndex(b.levelId, b.section) : 999)
    );
    return out;
  }

  /** Levels a student has attended (enrolled, or holds grades in), in chronological order. */
  function studentLevels(db, student) {
    const first = new Map();
    const note = (levelId, yearId) => {
      if (!levelId) return;
      const ys = yearStart(db, yearId);
      if (!first.has(levelId) || ys < first.get(levelId)) first.set(levelId, ys);
    };
    db.enrollments.forEach((e) => e.studentId === student.id && db.years.some((y) => y.id === e.yearId) && note(e.levelId, e.yearId));
    const sjLevel = new Map(db.subjects.map((x) => [x.id, x.levelId]));
    db.grades.forEach((g) => g.studentId === student.id && note(sjLevel.get(g.subjectId), g.yearId));
    return Array.from(first.entries()).sort((a, b) => a[1] - b[1] || LEVEL_IDS.indexOf(a[0]) - LEVEL_IDS.indexOf(b[0])).map((x) => x[0]);
  }

  /**
   * One student's record for one level across ALL academic years he attended it:
   * years (chronological), per-year class, every subject with the grade that counts
   * (own grade of the last year, or a passing grade carried from an earlier year) and the result.
   */
  function studentLevelRecord(db, student, levelId) {
    const years = new Set();
    db.enrollments.forEach((e) => e.studentId === student.id && e.levelId === levelId && db.years.some((y) => y.id === e.yearId) && years.add(e.yearId));
    const sjById = new Map(db.subjects.map((x) => [x.id, x]));
    db.grades.forEach((g) => {
      if (g.studentId !== student.id) return;
      const sj = sjById.get(g.subjectId);
      if (sj && sj.levelId === levelId && db.years.some((y) => y.id === g.yearId)) years.add(g.yearId);
    });
    const list = Array.from(years).sort((a, b) => yearStart(db, a) - yearStart(db, b));
    const spec = isUnifiedLevel(levelId) ? null : hasSpec(student.specialty) ? student.specialty : null;
    if (!list.length) return { levelId, spec, years: [], perYear: [], subjects: [], result: null, withdrawn: false, period: null, className: levelName(db, levelId, spec) };
    const last = list[list.length - 1];
    const enLast = getEnrollment(db, student.id, last);
    const enrolledHere = !!(enLast && enLast.levelId === levelId);
    const perYear = list.map((yearId) => {
      const en = getEnrollment(db, student.id, yearId);
      const here = !!(en && en.levelId === levelId);
      const section = here ? studentSection(db, student, yearId, en) : null;
      const period = here ? en.period || null : null;
      return {
        yearId,
        enrolled: here,
        section,
        period,
        className: here ? classFullName(db, levelId, spec, section, classPeriod(db, levelId, period)) : levelName(db, levelId, spec),
        withdrawn: !!(here && en.withdrawn),
      };
    });
    const subjects = enrolledHere ? gradebookSubjects(db, last, levelId, student.specialty || 'ALL').slice() : [];
    const inYears = new Set(list);
    db.grades.forEach((g) => {
      if (g.studentId !== student.id || !inYears.has(g.yearId)) return;
      const sj = sjById.get(g.subjectId);
      if (sj && sj.levelId === levelId && !subjects.includes(sj)) subjects.push(sj);
    });
    const rows = subjects.map((sj) => {
      const own = getGrade(db, student.id, sj.id, last);
      const grade = own || carriedGrade(db, student.id, sj.id, last);
      const earlier = grade ? null : lastEarlierGrade(db, student.id, sj.id, last);
      return { subject: sj, grade, final: finalGrade(grade), carried: !!(grade && grade.yearId !== last), earlier };
    });
    const result = enrolledHere ? studentResult(db, student, last, levelId) : null;
    const lastInfo = perYear[perYear.length - 1];
    return {
      levelId,
      spec,
      years: list,
      lastYearId: last,
      perYear,
      subjects: rows,
      result,
      withdrawn: !!(enrolledHere && enLast.withdrawn),
      period: lastInfo.period,
      className: lastInfo.className,
    };
  }

  /**
   * Full data for a gradebook/export: students × subjects.
   * period: undefined/'ALL' = every period, 'NONE' = without a period, or a period id.
   * rows: {student, cells:[{subject, applies, grade, carried, final}], result, section, period, withdrawn};
   * results, averages and stats use the final grade (re-exam when present).
   */
  function buildGradeSheet(db, yearId, levelId, specialty, section, period) {
    if (isUnifiedLevel(levelId)) specialty = 'ALL'; // Support: everyone together
    const subjects = gradebookSubjects(db, yearId, levelId, specialty);
    const students = enrolledStudents(db, yearId, levelId, specialty, section, period);
    const idx = buildGradeIndex(db, yearId);
    const enOf = yearEnrollments(db, yearId);
    const secOf = new Map(students.map((st) => [st.id, studentSection(db, st, yearId, enOf.get(st.id) || null)]));
    const perOf = new Map(students.map((st) => [st.id, (enOf.get(st.id) || {}).period || null]));
    // order: period (October, January…), class (Morning 1, Morning 2, Afternoon…), then specialty, then name
    students.sort(
      (a, b) =>
        periodIndex(perOf.get(a.id)) - periodIndex(perOf.get(b.id)) ||
        sectionIndex(levelId, secOf.get(a.id)) - sectionIndex(levelId, secOf.get(b.id)) ||
        compareText(a.specialty || 'Z', b.specialty || 'Z') ||
        compareText(a.lastName, b.lastName) ||
        compareText(a.firstName, b.firstName)
    );
    const rows = students.map((st) => {
      const applicable = subjects.filter((s) => subjectApplies(s, st.specialty || 'ALL'));
      const applies = new Set(applicable);
      const cells = subjects.map((s) => {
        const grade = idx.get(gradeKey(st.id, s.id, yearId)) || null;
        const carried = grade ? null : carriedGrade(db, st.id, s.id, yearId);
        return { subject: s, applies: applies.has(s) && (s.active !== false || !!grade || !!carried), grade, carried, final: finalGrade(grade || carried) };
      });
      const result = computeResult(applicable, (s) => effectiveGrade(db, st.id, s.id, yearId, idx));
      const en = enOf.get(st.id);
      return { student: st, cells, result, section: secOf.get(st.id), period: perOf.get(st.id), withdrawn: !!(en && en.withdrawn) };
    });
    const stats = subjects.map((s, i) => {
      const vals = [];
      let expected = 0;
      let entered = 0;
      rows.forEach((r) => {
        const c = r.cells[i];
        if (!c.applies) return;
        expected++;
        if (!c.final) return;
        entered++;
        if (!c.final.absent) vals.push(Number(c.final.value));
      });
      return {
        subject: s,
        avg: vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null,
        passed: vals.filter((v) => v >= PASS_GRADE).length,
        entered,
        expected,
      };
    });
    return { subjects, rows, stats };
  }

  /** Normalised class filter: a period id string, or {period, section, spec} ('' / 'ALL' = any, 'NONE' = without). */
  function classFilter(filter) {
    if (filter === undefined || filter === null) return {};
    if (typeof filter === 'string') return { period: filter };
    return filter;
  }

  /**
   * Students of one subject in one year (for the per-subject grade export):
   * everyone enrolled in the subject's level whose specialty takes the subject,
   * plus anyone else who already holds a grade in it. Sorted by registry number.
   * filter (optional): a period id, or {period, section, spec} — only students of that class
   * (by their enrollment that year). Rows: {student, grade (own or carried), carried, final, period, section}.
   */
  function subjectRoster(db, subject, yearId, filter) {
    const f = classFilter(filter);
    const unified = isUnifiedLevel(subject.levelId);
    const enOf = yearEnrollments(db, yearId);
    const byId = new Map(db.students.map((st) => [st.id, st]));
    const own = new Map();
    db.grades.forEach((g) => {
      if (g.yearId === yearId && g.subjectId === subject.id) own.set(g.studentId, g);
    });
    const secOf = new Map();
    const inClass = (st, en) => {
      const sec = en ? studentSection(db, st, yearId, en) : null;
      secOf.set(st.id, sec);
      if (!matchFilter(f.period, en ? en.period || null : null)) return false;
      if (!matchFilter(f.section, sec)) return false;
      if (!unified && !matchFilter(f.spec, st.specialty || null)) return false;
      return true;
    };
    const ids = new Set();
    enOf.forEach((en, sid) => {
      if (en.levelId !== subject.levelId) return;
      const st = byId.get(sid);
      if (st && subjectApplies(subject, st.specialty || 'ALL') && inClass(st, en)) ids.add(sid);
    });
    own.forEach((g, sid) => {
      const st = byId.get(sid);
      if (st && !ids.has(sid) && inClass(st, enOf.get(sid) || null)) ids.add(sid);
    });
    return db.students
      .filter((st) => ids.has(st.id))
      .sort((a, b) => compareText(normAm(a.am), normAm(b.am)))
      .map((st) => {
        const g = own.get(st.id) || null;
        const carried = g ? null : carriedGrade(db, st.id, subject.id, yearId);
        const en = enOf.get(st.id);
        return { student: st, grade: g || carried, carried: !!carried, final: finalGrade(g || carried), period: en ? en.period || null : null, section: secOf.get(st.id) || null };
      });
  }

  /**
   * The per-subject roster split by class (τμήμα + period), in class order.
   * → [{key, levelId, spec, section, period, complete, name, short, rows}] (period = classPeriod()).
   */
  function subjectRosterByClass(db, subject, yearId, filter) {
    const groups = new Map();
    const enOf = yearEnrollments(db, yearId);
    subjectRoster(db, subject, yearId, filter).forEach((x) => {
      const en = enOf.get(x.student.id) || null;
      const levelId = en ? en.levelId : subject.levelId;
      const spec = isUnifiedLevel(levelId) ? null : hasSpec(x.student.specialty) ? x.student.specialty : null;
      const sec = en ? x.section : null;
      const per = en ? classPeriod(db, levelId, en.period) : null;
      const key = [levelId, spec || '', sec || ''].join('|') + (per ? '|' + per : '');
      if (!groups.has(key)) {
        const complete = !!sec && (isUnifiedLevel(levelId) || !!spec);
        groups.set(key, {
          key,
          levelId,
          spec,
          section: sec,
          period: per,
          complete,
          name: complete ? classFullName(db, levelId, spec, sec, per) : classFullName(db, levelId, spec, null, per) + ' — χωρίς τμήμα',
          short: complete ? classShortName(levelId, spec, sec, per) : classShortName(levelId, spec, null, per) + ' - χωρίς τμήμα',
          rows: [],
        });
      }
      groups.get(key).rows.push(x);
    });
    const specRank = (s) => (s === 'DECK' ? 0 : s === 'ENGINE' ? 1 : 2);
    return Array.from(groups.values()).sort(
      (a, b) =>
        LEVEL_IDS.indexOf(a.levelId) - LEVEL_IDS.indexOf(b.levelId) ||
        specRank(a.spec) - specRank(b.spec) ||
        periodIndex(a.period) - periodIndex(b.period) ||
        sectionIndex(a.levelId, a.section) - sectionIndex(b.levelId, b.section)
    );
  }

  /**
   * Students who sit the re-exam of a subject: enrolled in its level that year (filter optional:
   * {period, section, spec}, '' / 'ALL' = any) whose ORIGINAL grade fails (ΑΠ, 0, 0Δ, 0Α).
   * → [{student, grade, reason, final, period, section}] sorted by registry number (like subjectRoster).
   */
  function reexamCandidates(db, subject, yearId, filter) {
    const f = classFilter(filter);
    const unified = isUnifiedLevel(subject.levelId);
    const own = new Map();
    db.grades.forEach((g) => {
      if (g.yearId === yearId && g.subjectId === subject.id) own.set(g.studentId, g);
    });
    const enOf = yearEnrollments(db, yearId);
    const out = [];
    enrolledStudents(db, yearId, subject.levelId, 'ALL', f.section || 'ALL', f.period || 'ALL').forEach((st) => {
      if (!subjectApplies(subject, st.specialty || 'ALL')) return;
      if (!unified && !matchFilter(f.spec, st.specialty || null)) return;
      const g = own.get(st.id);
      if (!g || !needsReexam(g)) return;
      const en = enOf.get(st.id);
      out.push({ student: st, grade: g, reason: gradeReason(g), final: finalGrade(g), period: (en && en.period) || null, section: studentSection(db, st, yearId, en || null) });
    });
    return out.sort((a, b) => compareText(normAm(a.student.am), normAm(b.student.am)));
  }

  /** Completion numbers for dashboard cards (period: optional filter, as in buildGradeSheet). */
  function levelSummary(db, yearId, levelId, spec, period) {
    const sheet = buildGradeSheet(db, yearId, levelId, spec || 'ALL', undefined, period);
    let expected = 0;
    let entered = 0;
    const counts = { pass: 0, fail: 0, incomplete: 0, none: 0 };
    sheet.rows.forEach((r) => {
      counts[r.result.status]++;
      expected += r.result.total;
      entered += r.result.total - r.result.missing;
    });
    return {
      students: sheet.rows.length,
      deck: sheet.rows.filter((r) => r.student.specialty === 'DECK').length,
      engine: sheet.rows.filter((r) => r.student.specialty === 'ENGINE').length,
      subjects: sheet.subjects.length,
      expected,
      entered,
      completion: expected ? entered / expected : 0,
      counts,
    };
  }

  // ------------------------------------------------ spreadsheet heuristics
  function guessColumnRole(header) {
    const k = compact(header);
    if (!k) return null;
    if (k === 'αα' || k === 'aa' || k === 'no' || k === 'νο' || k === 'αυξων' || k === 'αυξωναριθμοσ' || k === 'σn') return 'index';
    if (
      !/βαθμ|grade|score|mark/.test(k) &&
      (k.includes('περιοδ') || k.includes('period') || k.includes('intake') || k.includes('κυκλοσ') || k.includes('εναρξ') || k === 'startdate' || k === 'startmonth' || k === 'start')
    )
      return 'period';
    if (k === 'αμ' || k === 'am' || k.includes('μητρω') || k.includes('mitro') || k.includes('idnumber') || k.includes('studentid') || k === 'id' || k.includes('regno') || k.includes('registrationn') || k === 'κωδικοσσπουδαστη' || k === 'αρμ') return 'am';
    if (k.includes('ονοματεπωνυμ') || k.includes('fullname') || k === 'name' || k === 'studentname' || k === 'σπουδαστησ' || k === 'ονομασπουδαστη') return 'fullName';
    if (k.includes('πατρων') || k.includes('father') || k.includes('ονομαπατρ')) return 'fatherName';
    if (k.includes('επωνυμ') || k.includes('lastname') || k.includes('surname') || k.includes('familyname')) return 'lastName';
    if (k === 'ονομα' || k.includes('firstname') || k.includes('givenname') || k === 'μικρο') return 'firstName';
    if (k.includes('email') || k.includes('mail')) return 'email';
    if (k.includes('τηλ') || k.includes('phone') || k.includes('κινητ') || k.includes('mobile')) return 'phone';
    if (k.includes('τμημα') || k === 'class' || k.includes('section') || k.includes('shift') || k.includes('βαρδια') || k.includes('ωραριο') || k === 'τμ') return 'section';
    if (k.includes('ειδικοτ') || k.includes('specialt') || k.includes('speciality') || k.includes('department') || k.includes('κατευθυνσ') || k === 'deckengine') return 'specialty';
    if (k.includes('επιπεδ') || k === 'level' || k.includes('level') || k.includes('ταξη')) return 'level';
    if (k.includes('βαθμ') || k.includes('grade') || k.includes('score') || k.includes('total') || k.includes('συνολ') || k.includes('mark') || k.includes('points') || k.includes('real') || k.includes('αποτελεσμ') || k.includes('result')) return 'grade';
    return null;
  }

  function parseSpecialty(text) {
    const t = normText(text);
    if (!t) return null;
    if (/deck|γεφυρ|πλοιαρχ|navig|nautic|καταστρωμ/.test(t) || t === 'π' || t === 'πλ' || t === 'd') return 'DECK';
    if (/eng|μηχαν|mechan|μηχ/.test(t) || t === 'μ' || t === 'e') return 'ENGINE';
    return null;
  }

  /** Lowercase tokens; letters and digits are split ("morning1" → morning, 1; "F2" → f, 2). */
  function classTokens(text) {
    return normText(text)
      .replace(/([a-zα-ω])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zα-ω])/g, '$1 $2')
      .split(/[^a-z0-9α-ω]+/)
      .filter(Boolean);
  }

  /** A period named by one of a class text's tokens ("oct", "Ιαν", "Μάι", "January"…), or null. */
  function periodFromTokens(tk) {
    for (const t of tk) {
      for (const p of PERIOD_CFG) {
        if (compact(p.id) === t || (compact(p.short).length >= 2 && compact(p.short) === t) || compact(p.name) === t) return p.id;
      }
      const id = periodForMonth(monthOfToken(t));
      if (id) return id;
    }
    return null;
  }

  /**
   * Read a class/level description such as "OPERATIONAL LEVEL A DECK MORNING", "Support Morning 2",
   * "Management Engn Fun 1", "OL B ENGN AFTERNOON" or "Support Morning 1 Oct" (typos tolerated).
   * Returns { levelId, spec, section, period } — any part may be null.
   */
  function parseClassText(text, db) {
    const out = { levelId: null, spec: null, section: null, period: null };
    const t = normText(text);
    if (!t) return out;
    out.period = periodFromTokens(textTokens(text));
    const c = t.replace(/[^a-z0-9α-ω]+/g, '');
    // exact names first (built-in, short and custom names)
    if (LEVEL_IDS.includes(c.toUpperCase())) out.levelId = c.toUpperCase();
    for (const l of LEVELS) {
      if (out.levelId) break;
      for (const sp of [null, 'DECK', 'ENGINE']) {
        const hit = compact(defaultLevelName(l.id, sp)) === c || compact(levelShort(l.id, sp)) === c || (db && compact(levelName(db, l.id, sp)) === c);
        if (hit) {
          out.levelId = l.id;
          if (sp && l.split) out.spec = sp;
          break;
        }
      }
    }
    const tk = classTokens(text);
    const has = (re) => tk.some((x) => re.test(x));
    // specialty
    const d = has(/^(deck|πλοιαρχ|γεφυρ|καταστρωμ)/);
    const e = has(/^(eng|engn|engine|μηχαν|μηχ)/);
    if (!out.spec && d !== e) out.spec = d ? 'DECK' : 'ENGINE';
    // section
    const mi = tk.findIndex((x) => /^(morn|morg|πρωι)/.test(x));
    if (mi >= 0) {
      const n = tk[mi + 1];
      out.section = n === '1' ? 'M1' : n === '2' ? 'M2' : 'MO';
    } else if (has(/^(after|απογευμ|απογ)/)) out.section = 'AF';
    if (out.levelId) return out;
    // level
    if (has(/^(sup|υποστηρ|rating)/)) out.levelId = 'SUP';
    else if (has(/^(manag|mgmt|mgt|διοικ|διαχειρ)/) || tk[0] === 'mf') {
      const pick = (x) => (x === '1' || x === 'i' ? 1 : x === '2' || x === 'ii' ? 2 : x === '3' || x === 'iii' ? 3 : null);
      const fi = tk.findIndex((x) => /^(function|fun|func|fn|f|mf)$/.test(x));
      let n = fi >= 0 ? pick(tk[fi + 1]) : null;
      if (!n) {
        const dig = tk.find((x) => /^[123]$/.test(x));
        n = dig ? Number(dig) : pick(tk[tk.length - 1]);
      }
      out.levelId = n ? 'MF' + n : null;
    } else if (has(/^(oper|opert|λειτουργ|επιχειρ)/) || tk[0] === 'ol' || tk.includes('ola') || tk.includes('olb')) {
      if (tk.includes('ola')) out.levelId = 'OLA';
      else if (tk.includes('olb')) out.levelId = 'OLB';
      else {
        const letter = (x) => (x === 'a' || x === 'α' || x === '1' || x === 'i' ? 'OLA' : x === 'b' || x === 'β' || x === '2' || x === 'ii' ? 'OLB' : null);
        const li = tk.findIndex((x) => /^(level|lvl|lev|επιπεδο|ol|operational|oper)$/.test(x));
        let lv = li >= 0 ? letter(tk[li + 1]) : null;
        if (!lv) {
          const single = tk.find((x) => /^(a|b|α|β)$/.test(x));
          lv = single ? letter(single) : null;
        }
        out.levelId = lv;
      }
    }
    return out;
  }

  function parseLevel(text, db) {
    return parseClassText(text, db).levelId;
  }

  /** Deck/Engine implied by a level text such as "Management Engine Function 1" (null if none or both). */
  function specFromLevelText(text) {
    return parseClassText(text).spec;
  }

  /** Section from a text ("Morning 1", "Πρωινό", "Afternoon", …) for the given level. */
  function parseSection(text, levelId) {
    const list = levelId ? levelSections(levelId) : [];
    // 1) a configured class name inside the text (longest name first: "Morning 1" before "Morning")
    const c = compact(text);
    const byName = list
      .filter((x) => compact(x.name).length >= 2 && c.includes(compact(x.name)))
      .sort((a, b) => compact(b.name).length - compact(a.name).length)[0];
    if (byName) return byName.id;
    // 2) morning / afternoon heuristics (typos tolerated)
    let sec = parseClassText(text).section;
    if (!sec || !levelId) return sec;
    if (levelId === 'SUP') sec = sec === 'MO' ? null : sec; // Support needs Morning 1 / Morning 2
    else sec = sec === 'M1' || sec === 'M2' ? 'MO' : sec;
    return sec && list.some((x) => x.id === sec) ? sec : null;
  }

  /** Carry a class over to another level: same id, same name, or Morning N → Morning. */
  function mapSection(fromLevelId, sectionId, toLevelId) {
    if (!sectionId) return null;
    const target = levelSections(toLevelId);
    if (target.some((x) => x.id === sectionId)) return sectionId;
    const name = sectionName(fromLevelId, sectionId);
    if (!name) return null;
    const byName = target.find((x) => compact(x.name) === compact(name));
    if (byName) return byName.id;
    return parseSection(name, toLevelId);
  }

  /** Split "ΕΠΩΝΥΜΟ ΟΝΟΜΑ" (order 'LF') or "ΟΝΟΜΑ ΕΠΩΝΥΜΟ" (order 'FL'). */
  function splitFullName(full, order) {
    const parts = String(full || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return { lastName: '', firstName: '' };
    if (parts.length === 1) return { lastName: parts[0], firstName: '' };
    if (order === 'FL') return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
    return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
  }

  function cellText(cell) {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'object' && !(cell instanceof Date)) {
      if (cell.v === null || cell.v === undefined) return '';
      if (typeof cell.v === 'number') {
        if (cell.w && /%\s*$/.test(String(cell.w))) return String(cell.w).trim();
        if (cell.w && /^0\d+$/.test(String(cell.w).trim())) return String(cell.w).trim(); // zero-padded AM
        return String(cell.v); // raw number (avoid "1,234" formatting on AMs)
      }
      return String(cell.w != null ? cell.w : cell.v).trim();
    }
    return String(cell).trim();
  }

  /** Find the most likely header row within the first rows of a grid. */
  function detectHeaderRow(grid) {
    const limit = Math.min(grid.length, 25);
    let best = { row: 0, score: -1 };
    for (let r = 0; r < limit; r++) {
      const row = grid[r] || [];
      let score = 0;
      let texts = 0;
      row.forEach((cell) => {
        const t = cellText(cell);
        if (!t) return;
        if (isNaN(Number(t.replace(',', '.')))) texts++;
        const role = guessColumnRole(t);
        if (role === 'am') score += 5;
        else if (role) score += 2;
      });
      score += Math.min(texts, 3) * 0.1;
      if (score > best.score + 0.001 && (score >= 2 || best.score < 0)) best = { row: r, score };
    }
    return best.score >= 2 ? best.row : 0;
  }

  function columnLetter(i) {
    let s = '';
    i = i + 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  /** Turn a raw grid into {headers, rows, headerRow} with rows as arrays of cells. */
  function tableFromGrid(grid, headerRow) {
    const width = grid.reduce((m, r) => Math.max(m, (r || []).length), 0);
    const hdr = grid[headerRow] || [];
    const headers = [];
    for (let c = 0; c < width; c++) {
      const t = cellText(hdr[c]);
      headers.push({ index: c, letter: columnLetter(c), title: t || 'Στήλη ' + columnLetter(c) });
    }
    const rows = [];
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!row.some((c) => cellText(c) !== '')) continue;
      rows.push({ rowNum: r + 1, cells: headers.map((h) => (row[h.index] === undefined ? null : row[h.index])) });
    }
    return { headers, rows, headerRow };
  }

  /** Is a column mostly numbers / grade-like? */
  function columnLooksNumeric(table, colIndex) {
    let n = 0;
    let ok = 0;
    table.rows.forEach((r) => {
      const c = r.cells[colIndex];
      const t = cellText(c);
      if (!t) return;
      n++;
      const p = parseGradeCell(c, 'auto');
      if (p.kind === 'grade' || p.kind === 'absent') ok++;
    });
    return n > 0 && ok / n >= 0.6;
  }

  // ------------------------------------------------------- grade import
  /**
   * opts: { table, amCol, columns: [{col, subjectId}], mode: 'auto'|'scale'|'percent', yearId }
   */
  function planGradeImport(db, opts) {
    const amIndex = buildAmIndex(db);
    const gidx = buildGradeIndex(db, opts.yearId);
    const items = [];
    const modes = {};
    opts.columns.forEach((c) => {
      modes[c.col] = opts.mode === 'auto' ? detectValueMode(opts.table.rows.map((r) => r.cells[c.col])) : opts.mode;
    });
    const subjById = new Map(db.subjects.map((s) => [s.id, s]));
    const groups = new Map(); // student|subject → valid items
    opts.table.rows.forEach((row) => {
      const amCell = row.cells[opts.amCol];
      const amRaw = cellText(amCell);
      const student = amRaw ? amIndex.find(amRaw) : null;
      opts.columns.forEach((c) => {
        const subject = subjById.get(c.subjectId);
        if (!subject) return;
        const cell = row.cells[c.col];
        const parsed = parseGradeCell(cell, modes[c.col]);
        const item = { rowNum: row.rowNum, amRaw, student, subject, col: c.col, raw: cellText(cell), parsed, prev: null, status: 'new', warnings: [] };
        if (!amRaw) {
          if (parsed.kind === 'empty') return; // fully blank line for this column
          item.status = 'no_am';
        } else if (!student) {
          item.status = parsed.kind === 'empty' ? 'empty' : 'unknown_am';
        } else if (parsed.kind === 'empty') {
          item.status = 'empty';
        } else if (parsed.kind === 'invalid') {
          item.status = 'invalid';
        } else {
          item.status = 'valid';
          const key = student.id + '|' + subject.id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        items.push(item);
      });
    });

    const valueKey = (p) => (p.kind === 'absent' ? 'ΑΠ' : String(p.value) + (p.att || ''));
    groups.forEach((list) => {
      let keep = list[0];
      if (list.length > 1) {
        const rows = list.map((i) => i.rowNum);
        const distinct = new Set(list.map((i) => valueKey(i.parsed)));
        if (distinct.size > 1) {
          // same student, different grades in the same file → nothing is imported for this pair
          list.forEach((i) => {
            i.status = 'duplicate';
            i.dupConflict = true;
            i.dupRows = rows.filter((r) => r !== i.rowNum);
          });
          return;
        }
        list.slice(1).forEach((i) => {
          i.status = 'duplicate';
          i.dupRows = [keep.rowNum];
        });
      }
      const i = keep;
      const prev = gidx.get(gradeKey(i.student.id, i.subject.id, opts.yearId)) || null;
      i.prev = prev;
      i.reexam = !!(prev && prev.re); // the grade already has a re-exam grade (kept unless the new grade passes)
      const next = { value: i.parsed.kind === 'absent' ? null : i.parsed.value, absent: i.parsed.kind === 'absent', att: i.parsed.att };
      if (!prev) i.status = 'new';
      else if (sameGrade(prev, next)) i.status = 'same';
      else i.status = 'update';
      const en = getEnrollment(db, i.student.id, opts.yearId);
      if (!en) i.warnings.push('not_enrolled');
      else if (en.levelId !== i.subject.levelId) i.warnings.push('other_level');
      if (i.subject.specialty !== 'COMMON' && i.student.specialty && i.student.specialty !== i.subject.specialty) i.warnings.push('specialty');
    });

    // who is enrolled for the subject but absent from the file
    const missing = [];
    opts.columns.forEach((c) => {
      const subject = subjById.get(c.subjectId);
      if (!subject) return;
      const present = new Set(items.filter((i) => i.subject === subject && i.student && i.status !== 'empty').map((i) => i.student.id));
      enrolledStudents(db, opts.yearId, subject.levelId, 'ALL')
        .filter((st) => subjectApplies(subject, st.specialty || 'ALL') && !present.has(st.id))
        .forEach((st) => missing.push({ student: st, subject }));
    });

    const summary = { new: 0, update: 0, same: 0, unknown_am: 0, invalid: 0, duplicate: 0, empty: 0, no_am: 0, warnings: 0 };
    items.forEach((i) => {
      summary[i.status] = (summary[i.status] || 0) + 1;
      if (i.warnings.length && ['new', 'update', 'same'].includes(i.status)) summary.warnings++;
    });
    return { items, missing, summary, modes, yearId: opts.yearId };
  }

  /**
   * Apply a plan. options: { replaceExisting=true, includeWarnings=true, fileName }
   * Returns the import record (also stored in db.imports).
   */
  function commitGradeImport(db, plan, options) {
    const o = Object.assign({ replaceExisting: true, includeWarnings: true, fileName: '' }, options || {});
    const rec = {
      id: uid('im'),
      type: 'grades',
      date: nowIso(),
      fileName: o.fileName || '',
      yearId: plan.yearId,
      subjectIds: Array.from(new Set(plan.items.map((i) => i.subject.id))),
      changes: [],
      stats: { added: 0, updated: 0, same: 0, skipped: 0 },
      undone: false,
    };
    plan.items.forEach((i) => {
      if (i.status !== 'new' && i.status !== 'update' && i.status !== 'same') {
        if (i.status !== 'empty') rec.stats.skipped++;
        return;
      }
      if (i.status === 'update' && !o.replaceExisting) {
        rec.stats.skipped++;
        return;
      }
      if (i.warnings.length && !o.includeWarnings) {
        rec.stats.skipped++;
        return;
      }
      const before = gradeSnapshot(getGrade(db, i.student.id, i.subject.id, plan.yearId));
      // "same" rows keep their value but now belong to this import, so undoing an older
      // import can never remove a grade that this (newer) file also contains.
      const g = setGrade(db, i.student.id, i.subject.id, plan.yearId, {
        value: i.parsed.kind === 'absent' ? null : i.parsed.value,
        absent: i.parsed.kind === 'absent',
        att: i.parsed.att,
        percent: i.parsed.percent === undefined ? null : i.parsed.percent,
        source: 'import',
        importId: rec.id,
      });
      rec.changes.push({ studentId: i.student.id, subjectId: i.subject.id, yearId: plan.yearId, before, after: gradeSnapshot(g) });
      if (i.status === 'same') rec.stats.same++;
      else if (before) rec.stats.updated++;
      else rec.stats.added++;
    });
    db.imports.unshift(rec);
    return rec;
  }

  /** The state to restore for a grade, skipping over imports that were themselves undone. */
  function resolveBefore(db, before, ch) {
    let b = before;
    let guard = 0;
    while (b && b.importId && guard++ < 100) {
      const r = db.imports.find((x) => x.id === b.importId);
      if (!r || !r.undone || r.type !== 'grades') break;
      const c = r.changes.find((x) => x.studentId === ch.studentId && x.subjectId === ch.subjectId && x.yearId === ch.yearId);
      b = c ? c.before : null;
    }
    return b;
  }

  /** Revert an import. Returns {reverted, conflicts}. Data edited after the import is left alone. */
  function undoImport(db, importId) {
    const rec = db.imports.find((r) => r.id === importId);
    if (!rec) throw new Error('Η εισαγωγή δεν βρέθηκε.');
    if (rec.undone) throw new Error('Η εισαγωγή έχει ήδη αναιρεθεί.');
    let reverted = 0;
    let conflicts = 0;
    if (rec.type === 'grades') {
      rec.changes.forEach((ch) => {
        const cur = getGrade(db, ch.studentId, ch.subjectId, ch.yearId);
        if (!cur || cur.importId !== rec.id) {
          conflicts++; // changed again later (by hand or by a newer import)
          return;
        }
        const b = resolveBefore(db, ch.before, ch);
        if (b) {
          setGrade(db, ch.studentId, ch.subjectId, ch.yearId, b);
          const g = getGrade(db, ch.studentId, ch.subjectId, ch.yearId);
          g.updatedAt = b.updatedAt || g.updatedAt;
        } else clearGrade(db, ch.studentId, ch.subjectId, ch.yearId);
        reverted++;
      });
    } else if (rec.type === 'students' || rec.type === 'transfer') {
      const u = rec.undo || {};
      const created = u.created || [];
      const kept = new Set(created.filter((id) => db.grades.some((g) => g.studentId === id)));
      (u.enrollments || [])
        .slice()
        .reverse()
        .forEach((e) => {
          if (kept.has(e.studentId)) return; // student stays → keep the enrollment too
          const cur = getEnrollment(db, e.studentId, e.yearId);
          if (e.after !== undefined && (!cur || cur.levelId !== e.after)) {
            conflicts++;
            return;
          }
          if (e.before) setEnrollment(db, e.studentId, e.yearId, e.before.levelId, e.before.section === undefined ? undefined : e.before.section, e.before.period === undefined ? undefined : e.before.period);
          else removeEnrollment(db, e.studentId, e.yearId);
          reverted++;
        });
      (u.shifts || []).forEach((x) => setMgmtShift(db, x.yearId, x.levelId, x.spec, null));
      (u.updated || [])
        .slice()
        .reverse()
        .forEach((x) => {
          const s = db.students.find((st) => st.id === x.id);
          if (!s) return;
          Object.keys(x.before).forEach((f) => {
            if (x.after && normText(s[f] || '') !== normText(x.after[f] || '')) {
              conflicts++;
              return;
            }
            s[f] = x.before[f];
          });
          s.updatedAt = nowIso();
          reverted++;
        });
      created.forEach((id) => {
        if (kept.has(id)) {
          conflicts++;
          return;
        }
        deleteStudent(db, id);
        reverted++;
      });
    }
    rec.undone = true;
    rec.undoneAt = nowIso();
    return { reverted, conflicts };
  }

  // ----------------------------------------------------- student import
  /** Same person? 'exact' (surname + name equal), 'partial' (one of the two equal), or null. */
  function nameMatch(a, b) {
    const ln = normText(a.lastName || '') === normText(b.lastName || '');
    const fn = normText(a.firstName || '') === normText(b.firstName || '');
    if (ln && fn) return 'exact';
    if (ln || fn) return 'partial';
    return null;
  }

  /** Class name for messages: Management classes are named by level (+ period), others by classFullName. */
  function classTitle(db, levelId, spec, section, period) {
    if (isShiftLevel(levelId)) return levelName(db, levelId, spec) + (period ? ' – ' + periodName(period) : '');
    return classFullName(db, levelId, spec, section, period);
  }

  /**
   * An existing student (same Α.Μ.) is about to enter a class/level different from the one he had
   * (e.g. did Support in 2023-2024, now goes to Operational Level A). Returns what changes, so that
   * the user can confirm it is the same person — or null when nothing needs confirming.
   * period (optional): the new period; it counts only when both the old and the new period are known.
   */
  function identityCheck(db, student, yearId, levelId, section, period) {
    if (!student || !levelId) return null;
    const spec = isUnifiedLevel(levelId) ? null : hasSpec(student.specialty) ? student.specialty : null;
    let prev = getEnrollment(db, student.id, yearId);
    if (!prev) {
      const list = db.enrollments.filter((e) => e.studentId === student.id && db.years.some((y) => y.id === e.yearId));
      list.sort((a, b) => yearStart(db, b.yearId) - yearStart(db, a.yearId));
      prev = list[0] || null;
    }
    if (!prev) return null;
    const pSpec = isUnifiedLevel(prev.levelId) ? null : hasSpec(student.specialty) ? student.specialty : null;
    const pSec = isShiftLevel(prev.levelId) ? null : prev.section || null;
    const nSec = isShiftLevel(levelId) ? null : section || null;
    const pPer = classPeriod(db, prev.levelId, prev.period);
    const nPer = period ? classPeriod(db, levelId, period) : null;
    const both = !!(pPer && nPer);
    if (transcriptClassKey(prev.levelId, pSpec, pSec, both ? pPer : null) === transcriptClassKey(levelId, spec, nSec, both ? nPer : null)) return null;
    // same level, the new list simply has no class → not a real change
    if (prev.levelId === levelId && !nSec && (!both || pPer === nPer)) return null;
    return {
      prev: { yearId: prev.yearId, levelId: prev.levelId, section: pSec, period: prev.period || null, className: classTitle(db, prev.levelId, pSpec, pSec, pPer) },
      next: { yearId, levelId, section: nSec, period: period || null, className: classTitle(db, levelId, spec, nSec, nPer) },
      levelChange: prev.levelId !== levelId,
    };
  }

  /**
   * opts: {
   *   table,
   *   map: { am, lastName, firstName, fullName, fatherName, specialty, level, section, period, email, phone } (column indexes or -1),
   *   nameOrder: 'LF' | 'FL',
   *   defaults: { yearId, levelId ('' = none), specialty ('' = none), section?, period? },
   *   defaultPeriod: period id used when there is no period column / the cell is empty (also defaults.period),
   *   updateExisting: bool
   * }
   * Items expose `period` (id or null): the column (or a period in the class text), else the default;
   * a level with a single period gets it; a period not valid for the row's level → a warning in `issues`.
   */
  function planStudentImport(db, opts) {
    const m = opts.map;
    const defaults = opts.defaults || {};
    const amIndex = buildAmIndex(db);
    const get = (row, key) => (m[key] !== undefined && m[key] !== null && m[key] >= 0 ? cellText(row.cells[m[key]]) : '');
    const seen = new Map();
    const defRaw = opts.defaultPeriod !== undefined && opts.defaultPeriod !== null && opts.defaultPeriod !== '' ? opts.defaultPeriod : defaults.period;
    const defPeriod = defRaw ? (PERIOD_BY_ID.has(defRaw) ? defRaw : parsePeriod(defRaw)) : null;
    const yearEns = defaults.yearId ? yearEnrollments(db, defaults.yearId) : new Map();
    const items = opts.table.rows.map((row) => {
      const am = get(row, 'am');
      let lastName = get(row, 'lastName');
      let firstName = get(row, 'firstName');
      if (m.fullName >= 0 && m.fullName !== undefined) {
        const sp = splitFullName(get(row, 'fullName'), opts.nameOrder);
        if (!lastName) lastName = sp.lastName;
        if (!firstName) firstName = sp.firstName;
      }
      const specText = get(row, 'specialty');
      const lvlText = get(row, 'level');
      const secText = get(row, 'section');
      // the level column may hold the whole class name, e.g. "OPERATIONAL LEVEL A DECK MORNING"
      const pc = lvlText ? parseClassText(lvlText, db) : { levelId: null, spec: null, section: null, period: null };
      // …or the "Τμήμα" column may: "SUPPORT MORNING 1", "OPERATIONAL LEVEL B ENGN AFTERNOON"
      const ps = secText ? parseClassText(secText, db) : { levelId: null, spec: null, section: null, period: null };
      const levelSpec = pc.spec || ps.spec;
      const specialty = (specText && parseSpecialty(specText)) || levelSpec || defaults.specialty || '';
      const levelId = pc.levelId || ps.levelId || defaults.levelId || '';
      let section = null;
      let secIssue = null;
      if (levelId) {
        const fromCol = secText ? parseSection(secText, levelId) : null;
        const fromLvl = lvlText ? parseSection(lvlText, levelId) : null;
        section = fromCol || fromLvl || (defaults.section && levelSections(levelId).some((x) => x.id === defaults.section) ? defaults.section : null);
        if (secText && !fromCol) secIssue = 'Άγνωστο τμήμα «' + secText + '»' + (levelId === 'SUP' ? ' (στο Support: Morning 1, Morning 2 ή Afternoon)' : '');
      }
      // period (intake): the «Περίοδος» column, else a period named in the class text, else the default
      const perText = get(row, 'period');
      const perIssues = [];
      let period = null;
      if (perText) {
        const cell = row.cells[m.period];
        const raw = cell && typeof cell === 'object' && !(cell instanceof Date) ? cell.v : cell;
        period = parsePeriod(raw instanceof Date || typeof raw === 'number' ? raw : perText);
        if (!period) perIssues.push('Άγνωστη περίοδος «' + perText + '»' + (PERIOD_CFG.length ? ' (περίοδοι: ' + PERIOD_CFG.map((p) => p.name).join(', ') + ')' : ''));
      } else period = pc.period || ps.period || defPeriod || null;
      if (levelId) {
        const lp = levelPeriods(db, levelId);
        if (!lp.length) period = null; // e.g. Management: no periods
        else if (period && !lp.some((p) => p.id === period)) {
          perIssues.push(
            'Η περίοδος «' + periodName(period) + '» δεν ισχύει για το ' + levelName(db, levelId, isSplitLevel(levelId) ? specialty : null) +
              ' (περίοδοι: ' + lp.map((p) => p.name).join(', ') + ')'
          );
          period = lp.length === 1 ? lp[0].id : null;
        } else if (!period && lp.length === 1) period = lp[0].id;
      }
      const item = {
        rowNum: row.rowNum,
        data: { am, lastName, firstName, fatherName: get(row, 'fatherName'), email: get(row, 'email'), phone: get(row, 'phone'), specialty },
        levelId,
        section,
        period,
        issues: [],
        existing: null,
        status: 'new',
        changes: [],
        enroll: 'none',
      };
      if (secIssue) item.issues.push(secIssue);
      perIssues.forEach((x) => item.issues.push(x));
      if (specText && !parseSpecialty(specText)) item.issues.push('Άγνωστη ειδικότητα «' + specText + '»');
      if (lvlText && !pc.levelId) item.issues.push('Άγνωστο επίπεδο «' + lvlText + '»');
      if (levelSpec && specText && parseSpecialty(specText) && parseSpecialty(specText) !== levelSpec)
        item.issues.push('Η ειδικότητα «' + specText + '» διαφέρει από το επίπεδο «' + lvlText + '»');
      if (!am) {
        item.status = 'invalid';
        item.issues.unshift('Λείπει ο Α.Μ.');
        return item;
      }
      if (!lastName && !firstName) {
        item.status = 'invalid';
        item.issues.unshift('Λείπει το ονοματεπώνυμο');
        return item;
      }
      const k = looseAm(am); // "0123" and "123" are the same registry number
      if (seen.has(k)) {
        item.status = 'duplicate';
        item.issues.unshift('Ο Α.Μ. υπάρχει ξανά στη γραμμή ' + seen.get(k));
        return item;
      }
      seen.set(k, row.rowNum);
      const ex = amIndex.find(am);
      if (ex) {
        item.existing = ex;
        const lnDiff = lastName && normText(lastName) !== normText(ex.lastName || '');
        const fnDiff = firstName && normText(firstName) !== normText(ex.firstName || '');
        if (lnDiff && fnDiff) {
          item.status = 'conflict';
          item.issues.unshift('Ο Α.Μ. ανήκει ήδη στον/στην ' + studentName(ex) + ' — εντελώς διαφορετικό όνομα, ελέγξτε τον Α.Μ.');
          return item;
        }
        const fields = ['lastName', 'firstName', 'fatherName', 'email', 'phone', 'specialty'];
        fields.forEach((f) => {
          const nv = item.data[f];
          if (nv && normText(nv) !== normText(ex[f] || '')) item.changes.push(f);
        });
        item.status = item.changes.length ? 'update' : 'existing';
      } else {
        const err = validateAm(db, am);
        if (err) {
          item.status = 'invalid';
          item.issues.unshift(err);
          return item;
        }
      }
      if (defaults.yearId && item.levelId) {
        const en = ex ? yearEns.get(ex.id) || null : null;
        const secChange = item.section && !isShiftLevel(item.levelId) && en && en.section !== item.section;
        const perChange = item.period && en && en.levelId === item.levelId && (en.period || null) !== item.period;
        if (!en) item.enroll = 'new';
        else if (en.levelId !== item.levelId || secChange || perChange) item.enroll = 'change';
        else item.enroll = 'same';
        if (ex && item.enroll !== 'same') {
          const idc = identityCheck(db, ex, defaults.yearId, item.levelId, item.section, item.period);
          if (idc) item.identity = Object.assign(idc, { match: nameMatch(item.data, ex) || 'partial' });
        }
        if (isShiftLevel(item.levelId) && item.section && hasSpec(specialty)) {
          const cur = getMgmtShift(db, defaults.yearId, item.levelId, specialty);
          if (cur && cur !== item.section)
            item.issues.push('Το ' + levelName(db, item.levelId, specialty) + ' είναι ήδη ' + sectionName(item.levelId, cur) + ' — αλλάζει από το βαθμολόγιο');
          else item.shift = item.section;
        }
      }
      return item;
    });
    const summary = { new: 0, update: 0, existing: 0, invalid: 0, duplicate: 0, conflict: 0, enrollNew: 0, enrollChange: 0, identity: 0 };
    items.forEach((i) => {
      summary[i.status]++;
      if (i.identity && (i.status === 'update' || i.status === 'existing')) summary.identity++;
      if (i.status === 'new' || i.status === 'update' || i.status === 'existing') {
        if (i.enroll === 'new') summary.enrollNew++;
        if (i.enroll === 'change') summary.enrollChange++;
      }
    });
    return { items, summary, yearId: defaults.yearId, updateExisting: !!opts.updateExisting };
  }

  function commitStudentImport(db, plan, options) {
    const o = Object.assign({ fileName: '', updateExisting: plan.updateExisting }, options || {});
    // validate everything first so that a failure cannot leave a half-applied import
    const test = { students: db.students.slice() };
    plan.items.forEach((i) => {
      if (i.status !== 'new') return;
      const err = validateAm(test, i.data.am);
      if (err) throw new Error('Γραμμή ' + i.rowNum + ': ' + err);
      test.students.push({ id: '_t' + i.rowNum, am: i.data.am });
    });
    const rec = {
      id: uid('im'),
      type: 'students',
      date: nowIso(),
      fileName: o.fileName,
      yearId: plan.yearId,
      stats: { created: 0, updated: 0, enrolled: 0, skipped: 0 },
      undo: { created: [], updated: [], enrollments: [] },
      undone: false,
    };
    const rejected = new Set(o.notSameRows || []); // «not the same student» answers → row skipped
    plan.items.forEach((i) => {
      if (i.status === 'invalid' || i.status === 'duplicate' || i.status === 'conflict' || (i.identity && rejected.has(i.rowNum))) {
        rec.stats.skipped++;
        return;
      }
      let st;
      if (i.status === 'new') {
        st = createStudent(db, i.data);
        rec.undo.created.push(st.id);
        rec.stats.created++;
      } else {
        st = i.existing;
        if (i.status === 'update' && o.updateExisting) {
          const before = {};
          const after = {};
          i.changes.forEach((f) => {
            before[f] = st[f];
            st[f] = i.data[f];
            after[f] = i.data[f];
          });
          st.updatedAt = nowIso();
          rec.undo.updated.push({ id: st.id, before, after });
          rec.stats.updated++;
        }
      }
      if (plan.yearId && i.levelId && i.enroll !== 'same') {
        const prev = getEnrollment(db, st.id, plan.yearId);
        rec.undo.enrollments.push({
          studentId: st.id,
          yearId: plan.yearId,
          before: prev ? { levelId: prev.levelId, section: prev.section || null, period: prev.period || null } : null,
          after: i.levelId,
        });
        // no period in the file → keep the current one (same level) or the level's single period
        setEnrollment(db, st.id, plan.yearId, i.levelId, i.section || undefined, i.period || undefined);
        rec.stats.enrolled++;
      }
      // Management: the class shift (Morning / Afternoon) belongs to the whole class
      if (plan.yearId && i.shift && hasSpec(st.specialty) && !getMgmtShift(db, plan.yearId, i.levelId, st.specialty)) {
        setMgmtShift(db, plan.yearId, i.levelId, st.specialty, i.shift);
        rec.undo.shifts = rec.undo.shifts || [];
        rec.undo.shifts.push({ yearId: plan.yearId, levelId: i.levelId, spec: st.specialty });
      }
    });
    db.imports.unshift(rec);
    return rec;
  }

  // ------------------------------------------------------------ transfer (promotion / moving classes)
  /**
   * Plan moving students from one year/class to another year/class (any direction).
   * opts: { fromYearId, levelId: 'ALL'|id, spec: 'ALL'|'DECK'|'ENGINE'|'NONE', section: 'ALL'|id|'NONE',
   *         period: 'ALL'|id|'NONE', studentIds?: [..], toYearId, mode: 'auto'|'fixed', toLevelId?,
   *         toSection: 'same'|''|id, toPeriod: 'same'|''|id, overwrite }
   * auto: passed everything → next level, everyone else → same level (repeat).
   * toPeriod: an id valid for the target level; '' = none; 'same'/undefined (default) = the student's current
   * period when valid for the target level — otherwise the target level's single period, else none.
   * Item status: 'new' | 'change' | 'same' | 'exists' (already enrolled there; kept) | 'final' (passed the last level)
   */
  function planTransfer(db, opts) {
    const o = Object.assign({ levelId: 'ALL', spec: 'ALL', section: 'ALL', period: 'ALL', mode: 'auto', toSection: 'same', toPeriod: 'same', overwrite: false }, opts);
    const sameYear = o.fromYearId === o.toYearId;
    const overwrite = o.overwrite || sameYear;
    const only = o.studentIds ? new Set(o.studentIds) : null;
    const gidx = buildGradeIndex(db, o.fromYearId);
    const byId = new Map(db.students.map((s) => [s.id, s]));
    const toEns = yearEnrollments(db, o.toYearId);
    const items = [];
    db.enrollments
      .filter((e) => e.yearId === o.fromYearId && (o.levelId === 'ALL' || e.levelId === o.levelId))
      .forEach((e) => {
        const st = byId.get(e.studentId);
        if (!st || (only && !only.has(st.id))) return;
        if (o.spec !== 'ALL' && !isUnifiedLevel(e.levelId) && (o.spec === 'NONE' ? !!st.specialty : st.specialty !== o.spec)) return;
        const fromSection = studentSection(db, st, o.fromYearId, e);
        if (o.section !== 'ALL' && (o.section === 'NONE' ? !!fromSection : fromSection !== o.section)) return;
        const fromPeriod = e.period || null;
        if (!matchFilter(o.period, fromPeriod)) return;
        const result = studentResult(db, st, o.fromYearId, e.levelId, gidx);
        const passed = result.status === 'pass' && !e.withdrawn;
        let toLevelId = null;
        let status = null;
        if (o.mode === 'fixed') toLevelId = o.toLevelId;
        else if (passed) {
          toLevelId = nextLevel(e.levelId);
          if (!toLevelId) status = 'final';
        } else toLevelId = e.levelId;
        let toSection = null;
        if (toLevelId) {
          if (o.toSection === 'same') toSection = mapSection(e.levelId, fromSection, toLevelId);
          else if (o.toSection) toSection = levelSections(toLevelId).some((x) => x.id === o.toSection) ? o.toSection : null;
        }
        let toPeriod = null;
        if (toLevelId) {
          const req = o.toPeriod;
          if (req && req !== 'same' && req !== 'NONE' && validPeriodFor(db, toLevelId, req)) toPeriod = req;
          else if (req === '' || req === 'NONE') toPeriod = singlePeriod(db, toLevelId);
          else toPeriod = resolvePeriod(db, toLevelId, undefined, fromPeriod);
        }
        const existing = toEns.get(st.id) || null;
        const exSection = existing ? studentSection(db, st, o.toYearId, existing) : null;
        const exPeriod = existing ? existing.period || null : null;
        if (!status) {
          if (!existing) status = 'new';
          else if (existing.levelId === toLevelId && (isShiftLevel(toLevelId) || !toSection || exSection === toSection) && (!toPeriod || exPeriod === toPeriod)) status = 'same';
          else status = overwrite ? 'change' : 'exists';
        }
        items.push({
          student: st,
          withdrawn: !!e.withdrawn,
          fromLevelId: e.levelId,
          fromSection,
          fromPeriod,
          result,
          passed,
          toLevelId,
          toSection,
          toPeriod,
          existing: existing ? { levelId: existing.levelId, section: exSection, period: exPeriod } : null,
          status,
        });
      });
    items.sort(
      (a, b) =>
        LEVEL_IDS.indexOf(a.fromLevelId) - LEVEL_IDS.indexOf(b.fromLevelId) ||
        periodIndex(a.fromPeriod) - periodIndex(b.fromPeriod) ||
        sectionIndex(a.fromLevelId, a.fromSection) - sectionIndex(b.fromLevelId, b.fromSection) ||
        compareText(a.student.lastName, b.student.lastName) ||
        compareText(a.student.firstName, b.student.firstName)
    );
    const summary = { new: 0, change: 0, same: 0, exists: 0, final: 0, passed: 0, total: items.length };
    items.forEach((i) => {
      summary[i.status]++;
      if (i.passed) summary.passed++;
    });
    return { items, summary, fromYearId: o.fromYearId, toYearId: o.toYearId };
  }

  /** Apply a transfer plan for the chosen students (default: every 'new'/'change' item). Undoable. */
  function commitTransfer(db, plan, chosenIds) {
    const pick = chosenIds ? new Set(chosenIds) : null;
    const rec = {
      id: uid('im'),
      type: 'transfer',
      date: nowIso(),
      fileName: '',
      yearId: plan.toYearId,
      fromYearId: plan.fromYearId,
      stats: { moved: 0, created: 0, updated: 0, enrolled: 0, skipped: 0 },
      undo: { created: [], updated: [], enrollments: [], shifts: [] },
      undone: false,
    };
    plan.items.forEach((i) => {
      if (i.status !== 'new' && i.status !== 'change') return;
      if (pick && !pick.has(i.student.id)) {
        rec.stats.skipped++;
        return;
      }
      const prev = getEnrollment(db, i.student.id, plan.toYearId);
      rec.undo.enrollments.push({
        studentId: i.student.id,
        yearId: plan.toYearId,
        before: prev ? { levelId: prev.levelId, section: prev.section || null, period: prev.period || null } : null,
        after: i.toLevelId,
      });
      // no target period → keep the current one there (same level) or the level's single period
      setEnrollment(db, i.student.id, plan.toYearId, i.toLevelId, isShiftLevel(i.toLevelId) ? null : i.toSection, i.toPeriod || undefined);
      if (isShiftLevel(i.toLevelId) && i.toSection && hasSpec(i.student.specialty) && !getMgmtShift(db, plan.toYearId, i.toLevelId, i.student.specialty)) {
        setMgmtShift(db, plan.toYearId, i.toLevelId, i.student.specialty, i.toSection);
        rec.undo.shifts.push({ yearId: plan.toYearId, levelId: i.toLevelId, spec: i.student.specialty });
      }
      rec.stats.moved++;
      rec.stats.enrolled++;
    });
    db.imports.unshift(rec);
    return rec;
  }

  // ------------------------------------------------------------ years ops
  function addYear(db, label) {
    const p = parseYearLabel(label);
    if (!p) throw new Error('Μη έγκυρο ακαδημαϊκό έτος. Χρησιμοποιήστε μορφή 2026-2027.');
    if (db.years.some((y) => y.label === p.label)) throw new Error('Το έτος ' + p.label + ' υπάρχει ήδη.');
    const y = { id: uid('yr'), label: p.label, createdAt: nowIso(), mgmtShift: {} };
    db.years.push(y);
    return y;
  }

  function yearUsage(db, yearId) {
    return {
      enrollments: db.enrollments.filter((e) => e.yearId === yearId).length,
      grades: db.grades.filter((g) => g.yearId === yearId).length,
    };
  }

  function deleteYear(db, yearId) {
    if (db.years.length <= 1) throw new Error('Πρέπει να υπάρχει τουλάχιστον ένα ακαδημαϊκό έτος.');
    const u = yearUsage(db, yearId);
    if (u.enrollments || u.grades)
      throw new Error('Το έτος έχει ' + u.enrollments + ' εγγραφές και ' + u.grades + ' βαθμούς και δεν μπορεί να διαγραφεί.');
    db.years = db.years.filter((y) => y.id !== yearId);
    // the year's calendar and absences go with it
    db.calendar = (db.calendar || []).filter((d) => d && d.yearId !== yearId);
    db.absences = (db.absences || []).filter((a) => a && a.yearId !== yearId);
    if (db.settings.currentYearId === yearId) db.settings.currentYearId = sortYears(db.years)[0].id;
  }

  function subjectUsage(db, subjectId) {
    return db.grades.filter((g) => g.subjectId === subjectId).length;
  }

  /** Delete a subject without grades; its calendar days and absences go with it. */
  function deleteSubject(db, subjectId) {
    const n = subjectUsage(db, subjectId);
    if (n) throw new Error('Το μάθημα έχει ' + n + ' βαθμούς. Απενεργοποιήστε το αντί να το διαγράψετε.');
    db.subjects = db.subjects.filter((s) => s.id !== subjectId);
    db.calendar = (db.calendar || []).filter((d) => d && d.subjectId !== subjectId);
    db.absences = (db.absences || []).filter((a) => a && a.subjectId !== subjectId);
  }

  /** Parse bulk subject lines: "CODE; Name; D|E|C; weight" or just "Name". */
  function parseSubjectLines(text) {
    const out = [];
    String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split(/\t|;|\|/).map((p) => p.trim());
        let code = '';
        let name = '';
        let specialty = '';
        let weight = 1;
        if (parts.length === 1) name = parts[0];
        else {
          code = parts[0];
          name = parts[1];
          if (parts[2]) specialty = parseSpecialty(parts[2]) || (/κοιν|common|all|ολ/i.test(stripAccents(parts[2])) ? 'COMMON' : '');
          if (parts[3] && Number(parts[3].replace(',', '.')) > 0) weight = Number(parts[3].replace(',', '.'));
        }
        if (!name && code) {
          name = code;
          code = '';
        }
        out.push({ code, name, specialty: specialty || '', weight });
      });
    return out;
  }

  // ------------------------------------------------------------ 3-way merge (admin save after a 409)
  const hasOwn = Object.prototype.hasOwnProperty;

  /** Deep equality of JSON-like values; object key order and undefined-valued keys are ignored. */
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a !== a && b !== b; // NaN
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    const aa = Array.isArray(a);
    if (aa !== Array.isArray(b)) return false;
    if (aa) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    let na = 0;
    for (const k in a) {
      if (!hasOwn.call(a, k) || a[k] === undefined) continue;
      na++;
      if (!hasOwn.call(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    let nb = 0;
    for (const k in b) if (hasOwn.call(b, k) && b[k] !== undefined) nb++;
    return na === nb;
  }

  /** Deep copy of a JSON-like value (undefined-valued keys dropped). */
  function cloneJson(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : cloneJson(x)));
    const o = {};
    for (const k in v) if (hasOwn.call(v, k) && v[k] !== undefined) o[k] = cloneJson(v[k]);
    return o;
  }

  /** 3-way pick: {value, conflict}. Missing = undefined (a deletion is a change). */
  function pick3(b, m, t) {
    if (deepEqual(m, b)) return { value: t, conflict: false };
    if (deepEqual(t, b)) return { value: m, conflict: false };
    if (deepEqual(m, t)) return { value: m, conflict: false };
    return { value: m, conflict: true };
  }

  // Record keys of the merged collections (fields joined by "|").
  const MERGE_KEYS = {
    years: ['id'],
    students: ['id'],
    subjects: ['id'],
    imports: ['id'],
    grades: ['studentId', 'subjectId', 'yearId'],
    enrollments: ['studentId', 'yearId'],
    calendar: ['yearId', 'cls', 'date'],
    absences: ['studentId', 'yearId', 'date', 'hour'],
  };
  const MERGE_SETTING_MAPS = { gradeLocks: true, levelNames: true, levelPeriods: true };

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  // Numeric hash of a record key (no string building: 100 000 grades are indexed in a few ms).
  function keyHash(x, fields) {
    let h = 7;
    for (let f = 0; f < fields.length; f++) {
      const s = String(x[fields[f]]);
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
      h = (Math.imul(h, 31) + 124) | 0;
    }
    return h;
  }

  function sameKey(x, y, fields) {
    for (let f = 0; f < fields.length; f++) if (String(x[fields[f]]) !== String(y[fields[f]])) return false;
    return true;
  }

  function keyText(x, fields) {
    return fields.map((f) => String(x[f])).join('|');
  }

  /** hash → index | [indexes] of a list's records; `used` marks records already paired. */
  function buildKeyIndex(list, fields) {
    const map = new Map();
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (!x || typeof x !== 'object') continue;
      const h = keyHash(x, fields);
      const e = map.get(h);
      if (e === undefined) map.set(h, i);
      else if (typeof e === 'number') map.set(h, [e, i]);
      else e.push(i);
    }
    return { list, map, used: new Uint8Array(list.length), fields };
  }

  /** The first not yet paired record with the same key as x (then marked as paired), or undefined. */
  function takeSameKey(ix, x, h) {
    const e = ix.map.get(h);
    if (e === undefined) return undefined;
    const list = typeof e === 'number' ? [e] : e;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      if (!ix.used[i] && sameKey(ix.list[i], x, ix.fields)) {
        ix.used[i] = 1;
        return ix.list[i];
      }
    }
    return undefined;
  }

  /** Merge one collection by record key (a repeated key pairs its occurrences in order). */
  function mergeList(name, b, m, t, conflicts) {
    const fields = MERGE_KEYS[name];
    b = Array.isArray(b) ? b : [];
    m = Array.isArray(m) ? m : [];
    t = Array.isArray(t) ? t : [];
    const bi = buildKeyIndex(b, fields);
    const mi = buildKeyIndex(m, fields);
    const out = [];
    const resolve = (bv, mv, tv, x) => {
      let v;
      if (deepEqual(mv, bv)) v = tv;
      else if (deepEqual(tv, bv) || deepEqual(mv, tv)) v = mv;
      else if (name === 'absences' && mv && tv && mv.subjectId === tv.subjectId) v = mv; // the same absence recorded on both sides (secretariat and teacher)
      else {
        v = mv;
        conflicts.push({ collection: name, key: keyText(x, fields) });
      }
      if (v !== undefined) out.push(cloneJson(v));
    };
    for (let i = 0; i < t.length; i++) {
      const tv = t[i];
      if (!tv || typeof tv !== 'object') continue;
      const h = keyHash(tv, fields);
      resolve(takeSameKey(bi, tv, h), takeSameKey(mi, tv, h), tv, tv);
    }
    for (let j = 0; j < m.length; j++) {
      const mv = m[j];
      if (mi.used[j] || !mv || typeof mv !== 'object') continue;
      mi.used[j] = 1;
      resolve(takeSameKey(bi, mv, keyHash(mv, fields)), mv, undefined, mv);
    }
    // the import history is shown newest first
    if (name === 'imports') {
      out.forEach((x, i) => (x.__i = i));
      out.sort((x, y) => (String(x.date || '') < String(y.date || '') ? 1 : String(x.date || '') > String(y.date || '') ? -1 : x.__i - y.__i));
      out.forEach((x) => delete x.__i);
    }
    return out;
  }

  function mergeObject(collection, b, m, t, conflicts, sub) {
    b = isPlainObject(b) ? b : {};
    m = isPlainObject(m) ? m : {};
    t = isPlainObject(t) ? t : {};
    const keys = [];
    const seen = new Set();
    [t, m, b].forEach((o) => Object.keys(o).forEach((k) => !seen.has(k) && (seen.add(k), keys.push(k))));
    const out = {};
    keys.forEach((k) => {
      if (sub && sub[k] && (b[k] === undefined || isPlainObject(b[k])) && (m[k] === undefined || isPlainObject(m[k])) && (t[k] === undefined || isPlainObject(t[k]))) {
        if (m[k] === undefined && t[k] === undefined) return;
        out[k] = mergeObject(collection + '.' + k, b[k], m[k], t[k], conflicts, null);
        return;
      }
      const r = pick3(b[k], m[k], t[k]);
      if (r.conflict) conflicts.push({ collection, key: k });
      if (r.value !== undefined) out[k] = cloneJson(r.value);
    });
    return out;
  }

  /**
   * 3-way merge of registry objects (plain, already parsed): base = the version both sides started from,
   * mine = the admin's version, theirs = the server's current version. Inputs are not changed.
   * Records are merged by key (years/students/subjects/imports: id, grades: studentId|subjectId|yearId,
   * enrollments: studentId|yearId, calendar: yearId|cls|date, absences: studentId|yearId|date|hour),
   * settings per key (gradeLocks / levelNames / levelPeriods per sub-key),
   * any other top-level field as a whole; updatedAt = the later one. Per record: changed on one side →
   * that side; changed identically → it; changed differently on both → conflict (merged keeps mine).
   * Order: theirs' order, then records only in mine (imports: newest first).
   * → {merged, conflicts:[{collection, key}]} — collection is a collection name, 'settings',
   * 'settings.gradeLocks' / 'settings.levelNames' / 'settings.levelPeriods', or 'registry' (key = field).
   */
  function mergeRegistry(base, mine, theirs) {
    const b = isPlainObject(base) ? base : {};
    const m = isPlainObject(mine) ? mine : {};
    const t = isPlainObject(theirs) ? theirs : {};
    const conflicts = [];
    const merged = {};
    const keys = [];
    const seen = new Set();
    [t, m, b].forEach((o) => Object.keys(o).forEach((k) => !seen.has(k) && (seen.add(k), keys.push(k))));
    keys.forEach((k) => {
      if (MERGE_KEYS[k]) {
        if (m[k] === undefined && t[k] === undefined) return;
        merged[k] = mergeList(k, b[k], m[k], t[k], conflicts);
      } else if (k === 'settings' && (b[k] === undefined || isPlainObject(b[k])) && (m[k] === undefined || isPlainObject(m[k])) && (t[k] === undefined || isPlainObject(t[k]))) {
        if (m[k] === undefined && t[k] === undefined) return;
        merged[k] = mergeObject('settings', b[k], m[k], t[k], conflicts, MERGE_SETTING_MAPS);
      } else if (k === 'updatedAt') {
        const a = m.updatedAt;
        const c = t.updatedAt;
        const v = a === undefined ? c : c === undefined ? a : String(a) >= String(c) ? a : c;
        if (v !== undefined) merged[k] = v;
      } else {
        const r = pick3(b[k], m[k], t[k]);
        if (r.conflict) conflicts.push({ collection: 'registry', key: k });
        if (r.value !== undefined) merged[k] = cloneJson(r.value);
      }
    });
    return { merged, conflicts };
  }

  return {
    SCHEMA_VERSION,
    LEVELS,
    LEVEL_IDS,
    SPECIALTIES,
    SUBJECT_SPECIALTIES,
    MAX_GRADE,
    PASS_GRADE,
    uid,
    nowIso,
    normText,
    compact,
    compareText,
    round,
    formatGrade,
    academicYearLabelFor,
    parseYearLabel,
    nextYearLabel,
    sortYears,
    createEmptyDb,
    normalizeDb,
    validateDbShape,
    levelName,
    levelShort,
    isSplitLevel,
    isUnifiedLevel,
    subjectRoster,
    defaultLevelName,
    levelNameKey,
    levelVariants,
    specFromLevelText,
    parseClassText,
    parseSection,
    SECTIONS,
    levelSections,
    sectionName,
    sectionIndex,
    isShiftLevel,
    hasSpec,
    getMgmtShift,
    setMgmtShift,
    studentSection,
    classFullName,
    classShortName,
    subjectRosterByClass,
    yearStart,
    carriedGrade,
    lastEarlierGrade,
    effectiveGrade,
    setWithdrawn,
    useSections,
    sectionGroup,
    sectionUsage,
    addSection,
    renameSection,
    removeSection,
    mapSection,
    planTransfer,
    commitTransfer,
    specialtyName,
    yearLabel,
    normAm,
    looseAm,
    studentName,
    sortStudents,
    buildAmIndex,
    findStudentByAm,
    validateAm,
    suggestNextAm,
    createStudent,
    updateStudent,
    deleteStudent,
    getEnrollment,
    setEnrollment,
    removeEnrollment,
    enrolledStudents,
    nextLevel,
    subjectsOfLevel,
    subjectApplies,
    gradebookSubjects,
    createSubject,
    updateSubject,
    moveSubject,
    subjectLabel,
    deleteSubject,
    subjectUsage,
    parseSubjectLines,
    gradeKey,
    buildGradeIndex,
    getGrade,
    percentToGrade,
    gradeToPercent,
    gradeBand,
    parseGradeCell,
    detectValueMode,
    parseManualGrade,
    transcriptClassKey,
    gradeLockKey,
    gradeLock,
    setGradeLock,
    teachingClassOptions,
    assignmentStudents,
    nameMatch,
    identityCheck,
    transcriptClasses,
    studentLevels,
    studentLevelRecord,
    setGrade,
    clearGrade,
    gradeText,
    computeResult,
    studentResult,
    resultLabel,
    buildGradeSheet,
    levelSummary,
    guessColumnRole,
    parseSpecialty,
    parseLevel,
    splitFullName,
    cellText,
    detectHeaderRow,
    columnLetter,
    tableFromGrid,
    columnLooksNumeric,
    planGradeImport,
    commitGradeImport,
    undoImport,
    planStudentImport,
    commitStudentImport,
    addYear,
    yearUsage,
    deleteYear,
    // v2.2 — periods
    DEFAULT_PERIODS,
    DEFAULT_LEVEL_PERIODS,
    usePeriods,
    periodList,
    levelPeriods,
    levelHasPeriods,
    singlePeriod,
    validPeriodFor,
    periodName,
    periodShort,
    periodIndex,
    classPeriod,
    parsePeriod,
    addPeriod,
    renamePeriod,
    removePeriod,
    periodUsage,
    setLevelPeriods,
    studentClass,
    teachingPeriodOptions,
    assignmentLabel,
    // v2.2 — 0Δ / 0Α and re-exam
    ATT_TEXT,
    ATT_LABEL,
    GRADE_RULE,
    parseAttCode,
    gradeSnapshot,
    sameGrade,
    gradeReason,
    needsReexam,
    finalGrade,
    finalText,
    reText,
    isPassing,
    setReexam,
    reexamCandidates,
    // v2.2 — admin save merge
    deepEqual,
    mergeRegistry,
    // v2.3 — calendar & absences
    DEFAULT_HOURS_PER_DAY,
    validIsoDate,
    isoDate,
    addDays,
    isoWeekday,
    dateText,
    yearDateRange,
    hoursPerDay,
    setHoursPerDay,
    subjectAbsenceLimit,
    parseAbsenceLimit,
    calendarKey,
    parseCalendarKey,
    studentCalendarKey,
    calendarClassName,
    calendarClasses,
    classStudents,
    calendarSubjects,
    attendance,
    calendarDay,
    subjectDays,
    setCalendarDay,
    planFill,
    fillCalendar,
    copyCalendar,
    getAbsence,
    absenceHours,
    setAbsence,
    setDayAbsences,
    absenceStatus,
    absenceEntriesText,
    absenceSummary,
    subjectDates,
    subjectAttendanceUsage,
  };
});
