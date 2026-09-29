/*
 * Exams: question model, validation, automatic grading, schedule windows, Excel question import.
 * Shared by the desktop app (window.ExamCore) and the central server (require).
 * Exam scores are an intermediate test only — they are NEVER written into the final course grades.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExamCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = {
    single: 'Πολλαπλής επιλογής — μία σωστή',
    multi: 'Πολλαπλής επιλογής — πολλές σωστές',
    tf: 'Σωστό / Λάθος',
    short: 'Σύντομη απάντηση',
  };
  const LETTERS = ['Α', 'Β', 'Γ', 'Δ', 'Ε', 'ΣΤ', 'Ζ', 'Η'];
  const OPT_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const MAX_OPTIONS = OPT_IDS.length;

  function stripAccents(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  /** Answer comparison: case, accents, final sigma, extra spaces, trailing dot ignored. */
  function normAnswer(s) {
    if (s === null || s === undefined) return '';
    return stripAccents(String(s)).toLowerCase().replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim().replace(/[.。!]+$/, '').trim();
  }
  function asNumber(s) {
    const t = String(s).trim().replace(/\s+/g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  }

  /** 0–5 scale: 1 = 50%, 2 = 60% … 5 = 90%+. */
  function percentToGrade(p) {
    p = Math.round(Number(p) * 1e6) / 1e6;
    if (!(p >= 50)) return 0;
    return Math.min(5, Math.floor((p - 50) / 10) + 1);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Clean one question coming from the editor / Excel / network. */
  function normalizeQuestion(q, index) {
    const type = TYPES[q && q.type] ? q.type : 'single';
    const out = {
      id: String((q && q.id) || 'q' + (index + 1)).slice(0, 40),
      type,
      text: String((q && q.text) || '').trim(),
      points: Number(q && q.points) > 0 ? Math.min(100, round2(Number(q.points))) : 1,
    };
    if (type === 'single' || type === 'multi') {
      const opts = Array.isArray(q.options) ? q.options : [];
      out.options = opts
        .map((o, i) => ({ id: String((o && o.id) || OPT_IDS[i] || 'o' + i).slice(0, 12), text: String((o && o.text) != null ? o.text : o || '').trim() }))
        .filter((o) => o.text !== '')
        .slice(0, MAX_OPTIONS);
      const ids = new Set(out.options.map((o) => o.id));
      out.correct = (Array.isArray(q.correct) ? q.correct : q.correct != null ? [q.correct] : []).map(String).filter((id) => ids.has(id));
      if (type === 'single') out.correct = out.correct.slice(0, 1);
    } else if (type === 'tf') {
      out.answer = q.answer === true || q.answer === 'true' ? true : q.answer === false || q.answer === 'false' ? false : null;
    } else {
      const acc = Array.isArray(q.accept) ? q.accept : String(q.accept || '').split(/[|\n;]/);
      out.accept = acc.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
    }
    return out;
  }

  /** Problems that stop an exam from being published. */
  function validateQuestions(questions) {
    const errors = [];
    if (!questions.length) errors.push('Η εξέταση δεν έχει ερωτήσεις.');
    const seen = new Set();
    questions.forEach((q, i) => {
      const n = 'Ερώτηση ' + (i + 1) + ': ';
      if (seen.has(q.id)) errors.push(n + 'διπλό αναγνωριστικό.');
      seen.add(q.id);
      if (!q.text) errors.push(n + 'λείπει το κείμενο.');
      if (q.type === 'single' || q.type === 'multi') {
        if (q.options.length < 2) errors.push(n + 'χρειάζονται τουλάχιστον 2 επιλογές.');
        if (!q.correct.length) errors.push(n + 'δεν έχει οριστεί η σωστή απάντηση.');
      } else if (q.type === 'tf') {
        if (q.answer === null) errors.push(n + 'ορίστε αν η πρόταση είναι Σωστή ή Λάθος.');
      } else if (!q.accept.length) errors.push(n + 'γράψτε τουλάχιστον μία αποδεκτή απάντηση.');
    });
    return errors;
  }

  /** Exam fields (without questions) → clean object; throws on invalid values. */
  function normalizeExamMeta(e) {
    const title = String((e && e.title) || '').trim();
    if (!title) throw new Error('Ο τίτλος της εξέτασης είναι υποχρεωτικός.');
    const startsAt = Number(e.startsAt);
    if (!Number.isFinite(startsAt) || startsAt <= 0) throw new Error('Ορίστε ημερομηνία και ώρα έναρξης.');
    const duration = Math.round(Number(e.durationMinutes));
    if (!(duration >= 1 && duration <= 600)) throw new Error('Η διάρκεια πρέπει να είναι από 1 έως 600 λεπτά.');
    const entry = Math.round(Number(e.entryMinutes == null ? 15 : e.entryMinutes));
    if (!(entry >= 1 && entry <= 600)) throw new Error('Το περιθώριο εισόδου πρέπει να είναι από 1 έως 600 λεπτά.');
    return {
      title: title.slice(0, 200),
      description: String(e.description || '').slice(0, 4000),
      subjectId: e.subjectId ? String(e.subjectId) : null,
      subjectName: e.subjectName ? String(e.subjectName).slice(0, 200) : null,
      levelId: e.levelId ? String(e.levelId) : null,
      yearId: e.yearId ? String(e.yearId) : null,
      startsAt,
      durationMinutes: duration,
      entryMinutes: entry,
      countsFinal: !!e.countsFinal,
      shuffleQuestions: e.shuffleQuestions !== false,
      shuffleOptions: e.shuffleOptions !== false,
    };
  }

  /**
   * Where an exam stands in time.
   *  upcoming → before startsAt; open → students may start (until startsAt + entryMinutes);
   *  closed → no new starts (attempts already running continue until their own deadline).
   */
  function examPhase(exam, now) {
    const opens = exam.startsAt;
    const entryCloses = exam.startsAt + Math.max(1, Number(exam.entryMinutes) || 0) * 60000; // at least 1 minute to get in
    const ends = entryCloses + exam.durationMinutes * 60000;
    let phase = 'upcoming';
    if (now >= opens && now <= entryCloses) phase = 'open';
    else if (now > entryCloses) phase = 'closed';
    return { phase, opens, entryCloses, ends };
  }

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rnd || Math.random)() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** Per-attempt order of questions and options. */
  function makeOrder(questions, shuffleQuestions, shuffleOptions, rnd) {
    const q = questions.map((x) => x.id);
    const o = {};
    questions.forEach((x) => {
      if (x.options) o[x.id] = shuffleOptions ? shuffle(x.options.map((y) => y.id), rnd) : x.options.map((y) => y.id);
    });
    return { q: shuffleQuestions ? shuffle(q, rnd) : q, o };
  }

  /** What a student receives: no correct answers, in his own order. */
  function questionsForStudent(questions, order) {
    const byId = new Map(questions.map((q) => [q.id, q]));
    const ids = order && order.q ? order.q.filter((id) => byId.has(id)) : questions.map((q) => q.id);
    questions.forEach((q) => ids.includes(q.id) || ids.push(q.id));
    return ids.map((id) => {
      const q = byId.get(id);
      const out = { id: q.id, type: q.type, text: q.text, points: q.points };
      if (q.options) {
        const oid = order && order.o && order.o[q.id] ? order.o[q.id] : q.options.map((x) => x.id);
        const om = new Map(q.options.map((x) => [x.id, x]));
        out.options = oid.filter((x) => om.has(x)).map((x) => ({ id: x, text: om.get(x).text }));
        q.options.forEach((x) => out.options.some((y) => y.id === x.id) || out.options.push({ id: x.id, text: x.text }));
      }
      return out;
    });
  }

  /** Keep only well-formed answers for known questions. */
  function cleanAnswers(questions, answers) {
    const out = {};
    const a = answers && typeof answers === 'object' ? answers : {};
    questions.forEach((q) => {
      if (!(q.id in a)) return;
      const v = a[q.id];
      if (v === null || v === undefined || v === '') return;
      if (q.type === 'single') {
        if (q.options.some((o) => o.id === String(v))) out[q.id] = String(v);
      } else if (q.type === 'multi') {
        const list = (Array.isArray(v) ? v : [v]).map(String).filter((id) => q.options.some((o) => o.id === id));
        if (list.length) out[q.id] = Array.from(new Set(list));
      } else if (q.type === 'tf') {
        if (v === true || v === false) out[q.id] = v;
      } else {
        const s = String(v).slice(0, 500);
        if (s.trim()) out[q.id] = s;
      }
    });
    return out;
  }

  function isAnswered(q, v) {
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }

  /** Automatic grading. multi = all-or-nothing (exactly the correct set). */
  function gradeAnswers(questions, answers) {
    const a = cleanAnswers(questions, answers);
    let score = 0;
    let max = 0;
    const perQuestion = questions.map((q) => {
      max += q.points;
      const v = a[q.id];
      let ok = false;
      if (v !== undefined) {
        if (q.type === 'single') ok = q.correct.length === 1 && v === q.correct[0];
        else if (q.type === 'multi') ok = v.length === q.correct.length && v.every((x) => q.correct.includes(x));
        else if (q.type === 'tf') ok = v === q.answer;
        else {
          const n = normAnswer(v);
          const num = asNumber(v);
          ok = q.accept.some((acc) => normAnswer(acc) === n || (num !== null && asNumber(acc) !== null && Math.abs(asNumber(acc) - num) < 1e-9));
        }
      }
      if (ok) score += q.points;
      return { id: q.id, answered: v !== undefined, correct: ok, points: ok ? q.points : 0, max: q.points };
    });
    const percent = max ? round2((score / max) * 100) : 0;
    return { score: round2(score), max: round2(max), percent, grade: percentToGrade(percent), perQuestion, answered: perQuestion.filter((x) => x.answered).length };
  }

  // ------------------------------------------------------------ Excel import of questions
  function cellStr(c) {
    if (c === null || c === undefined) return '';
    if (typeof c === 'object' && !(c instanceof Date)) return c.w != null && c.w !== '' ? String(c.w).trim() : c.v == null ? '' : String(c.v).trim();
    return String(c).trim();
  }
  const HEAD = {
    text: /^(ερωτηση|ερωτησεισ|question|κειμενο)/,
    type: /^(τυποσ|type|ειδοσ)/,
    correct: /^(σωστη|σωστεσ|σωστο|απαντηση|correct|answer|λυση)/,
    points: /^(μοναδεσ|μοναδα|βαθμοι|points|μονάδες)/,
  };
  function letterIndex(t) {
    const s = normAnswer(t).replace(/[)\].:]+$/, '').toUpperCase();
    const gr = ['Α', 'Β', 'Γ', 'Δ', 'Ε', 'ΣΤ', 'Ζ', 'Η'];
    const lat = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    let i = gr.indexOf(s);
    if (i < 0) i = lat.indexOf(s);
    if (i < 0 && /^[1-8]$/.test(s)) i = Number(s) - 1;
    return i;
  }
  function parseTf(t) {
    const s = normAnswer(t);
    if (/^(σ|σωστο|σωστη|ναι|true|t|αληθεσ|αληθησ|1)$/.test(s)) return true;
    if (/^(λ|λαθοσ|λαθοσ|οχι|false|f|ψευδεσ|0)$/.test(s)) return false;
    return null;
  }
  function parseType(t) {
    const s = normAnswer(t);
    if (!s) return null;
    if (/(πολλεσ|multi|πολλαπλεσ σωστεσ|περισσοτερεσ)/.test(s)) return 'multi';
    if (/(σωστο.?λαθοσ|σ\/λ|σ-λ|σλ|true|tf)/.test(s)) return 'tf';
    if (/(συντομ|short|κειμενο|αριθμ|ελευθερ)/.test(s)) return 'short';
    if (/(μια|μία|single|πολλαπλησ|πε|επιλογ)/.test(s)) return 'single';
    return null;
  }

  /**
   * rows: array of arrays of cells (first non-empty row = headers).
   * Columns: Ερώτηση | Τύπος | Α | Β | Γ | Δ … | Σωστή | Μονάδες
   * Returns { questions, problems:[{row, message}] }.
   */
  function parseQuestionTable(rows) {
    const problems = [];
    let h = rows.findIndex((r) => r && r.some((c) => cellStr(c) !== ''));
    if (h < 0) return { questions: [], problems: [{ row: 0, message: 'Το φύλλο είναι κενό.' }] };
    const heads = rows[h].map((c) => normAnswer(cellStr(c)));
    const col = { text: -1, type: -1, correct: -1, points: -1, options: [] };
    heads.forEach((t, i) => {
      if (!t) return;
      if (col.text < 0 && HEAD.text.test(t)) col.text = i;
      else if (col.type < 0 && HEAD.type.test(t)) col.type = i;
      else if (col.correct < 0 && HEAD.correct.test(t)) col.correct = i;
      else if (col.points < 0 && HEAD.points.test(t)) col.points = i;
      else if (letterIndex(t) >= 0 || /^(επιλογη|option)\s*\S+$/.test(t)) col.options.push(i);
    });
    if (col.text < 0) return { questions: [], problems: [{ row: h + 1, message: 'Δεν βρέθηκε στήλη «Ερώτηση».' }] };
    const questions = [];
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const text = cellStr(row[col.text]);
      const opts = col.options.map((i) => cellStr(row[i]));
      const corr = col.correct >= 0 ? cellStr(row[col.correct]) : '';
      if (!text && !opts.some(Boolean) && !corr) continue;
      const rowNum = r + 1;
      let type = col.type >= 0 ? parseType(cellStr(row[col.type])) : null;
      const filled = [];
      opts.forEach((t, i) => t && filled.push({ id: OPT_IDS[i], text: t, index: i }));
      const parts = corr.split(/[,;/+&\s]+|\s+και\s+/).map((x) => x.trim()).filter(Boolean);
      const letters = parts.map(letterIndex);
      if (!type) {
        if (filled.length >= 2) type = parts.length > 1 && letters.every((x) => x >= 0) ? 'multi' : 'single';
        else if (parseTf(corr) !== null) type = 'tf';
        else type = 'short';
      }
      const q = { id: 'q' + (questions.length + 1), type, text, points: col.points >= 0 && Number(String(cellStr(row[col.points])).replace(',', '.')) > 0 ? Number(String(cellStr(row[col.points])).replace(',', '.')) : 1 };
      if (type === 'single' || type === 'multi') {
        q.options = filled.map((f) => ({ id: f.id, text: f.text }));
        q.correct = [];
        letters.forEach((li, k) => {
          if (li >= 0 && opts[li]) q.correct.push(OPT_IDS[li]);
          else if (parts[k]) {
            // correct answer written as the option text
            const m = filled.find((f) => normAnswer(f.text) === normAnswer(parts[k]));
            if (m) q.correct.push(m.id);
          }
        });
        if (!q.correct.length && corr) {
          const m = filled.find((f) => normAnswer(f.text) === normAnswer(corr));
          if (m) q.correct.push(m.id);
        }
      } else if (type === 'tf') q.answer = parseTf(corr);
      else q.accept = corr.split(/[|\n;]/).map((x) => x.trim()).filter(Boolean);
      const nq = normalizeQuestion(q, questions.length);
      const errs = validateQuestions([nq]).map((m) => m.replace(/^Ερώτηση 1: /, ''));
      if (errs.length) problems.push({ row: rowNum, message: errs.join(' ') });
      questions.push(nq);
    }
    if (!questions.length) problems.push({ row: h + 1, message: 'Δεν βρέθηκαν ερωτήσεις κάτω από τη γραμμή τίτλων.' });
    return { questions, problems };
  }

  function optionLetter(q, id) {
    const i = q.options ? q.options.findIndex((o) => o.id === id) : -1;
    return i >= 0 ? LETTERS[i] || String(i + 1) : '';
  }

  /** Human-readable answer (for result exports). */
  function answerText(q, v) {
    if (v === undefined || v === null || v === '') return '';
    if (q.type === 'single') return optionLetter(q, v);
    if (q.type === 'multi') return (Array.isArray(v) ? v : [v]).map((x) => optionLetter(q, x)).join(', ');
    if (q.type === 'tf') return v === true ? 'Σωστό' : v === false ? 'Λάθος' : '';
    return String(v);
  }

  function correctText(q) {
    if (q.type === 'single' || q.type === 'multi') return q.correct.map((x) => optionLetter(q, x)).join(', ');
    if (q.type === 'tf') return q.answer === true ? 'Σωστό' : q.answer === false ? 'Λάθος' : '';
    return q.accept.join(' | ');
  }

  return {
    TYPES,
    LETTERS,
    OPT_IDS,
    MAX_OPTIONS,
    normAnswer,
    percentToGrade,
    normalizeQuestion,
    validateQuestions,
    normalizeExamMeta,
    examPhase,
    makeOrder,
    questionsForStudent,
    cleanAnswers,
    isAnswered,
    gradeAnswers,
    parseQuestionTable,
    answerText,
    correctText,
    optionLetter,
  };
});
