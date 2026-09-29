/*
 * Exams (admin): create an intermediate test, write/import its questions, assign it to students of the
 * registry, schedule it (date + time), follow it live and export the results.
 * The test score NEVER goes into the gradebook: the final course grade is entered only by the teacher.
 */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const EC = window.ExamCore;
  const { esc, icon, fmtDate, plural, options, toast, openModal, confirmDialog, emptyState } = App.ui;
  const Remote = window.Remote;
  const S = () => App.S;

  const X = { view: 'list', filter: 'all', list: null, error: '', draft: null, dirty: false, res: null, resTimer: null, busy: false };
  const pad = (n) => String(n).padStart(2, '0');
  const newQid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function toLocalParts(t) {
    const d = new Date(t);
    return { date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  }
  function fromLocalParts(date, time) {
    if (!date || !time) return NaN;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  }
  function when(t) {
    return fmtDate(t, true);
  }

  function examState(e, now) {
    if (e.status !== 'published') return { key: 'draft', label: 'Πρόχειρο', cls: '' };
    const ph = EC.examPhase(e, now);
    if (ph.phase === 'upcoming') return { key: 'upcoming', label: 'Προγραμματισμένη', cls: 'live' };
    if (now <= ph.ends) return { key: 'running', label: 'Σε εξέλιξη', cls: 'warn' };
    return { key: 'done', label: 'Ολοκληρώθηκε', cls: 'ok' };
  }

  async function loadList() {
    try {
      X.list = await Remote.exams();
      X.error = '';
    } catch (e) {
      X.error = e.message;
      X.list = X.list || [];
    }
  }
  const rerender = () => S().page === 'exams' && App.render();

  // ================================================================== list
  function listHtml() {
    const now = Remote.now();
    let list = (X.list || []).map((e) => Object.assign({}, e, { st: examState(e, now) }));
    const counts = { all: list.length, upcoming: 0, running: 0, done: 0, draft: 0 };
    list.forEach((e) => counts[e.st.key]++);
    if (X.filter !== 'all') list = list.filter((e) => e.st.key === X.filter || (X.filter === 'upcoming' && e.st.key === 'running'));
    let h = '<div class="row" style="margin-bottom:14px"><div class="chips">' +
      [['all', 'Όλες', counts.all], ['upcoming', 'Προσεχείς / σε εξέλιξη', counts.upcoming + counts.running], ['done', 'Ολοκληρωμένες', counts.done], ['draft', 'Πρόχειρα', counts.draft]]
        .map((c) => '<button class="chip' + (X.filter === c[0] ? ' on' : '') + '" data-action="exFilter" data-v="' + c[0] + '">' + esc(c[1]) + ' <b>' + c[2] + '</b></button>').join('') +
      '</div><div class="spacer"></div><button class="btn btn-sm btn-ghost" data-action="exReload">' + icon('refresh') + 'Ανανέωση</button><button class="btn btn-primary" data-action="exNew" id="ex-new">' + icon('plus') + 'Νέα εξέταση</button></div>';
    if (X.error) h += '<div class="callout warn">' + icon('alert') + '<p>' + esc(X.error) + '</p></div>';
    if (!X.list) return h + '<div class="card card-pad muted">Φόρτωση…</div>';
    if (!list.length)
      return h + '<div class="card">' + emptyState('clipboard', X.list.length ? 'Καμία εξέταση σε αυτή την κατηγορία' : 'Δεν υπάρχουν εξετάσεις', 'Δημιουργήστε ένα ενδιάμεσο τεστ (π.χ. πρόοδο), αναθέστε το σε σπουδαστές και ορίστε ημερομηνία και ώρα. Οι σπουδαστές το γράφουν στο πρόγραμμα με τον λογαριασμό τους και βαθμολογείται αυτόματα.', '<button class="btn btn-primary" data-action="exNew">' + icon('plus') + 'Νέα εξέταση</button>') + '</div>';
    h += '<div class="card"><table class="table"><thead><tr><th>Ημερομηνία & ώρα</th><th>Εξέταση</th><th class="num">Διάρκεια</th><th class="num">Ερωτήσεις</th><th class="num">Σπουδαστές</th><th class="num">Υποβλήθηκαν</th><th>Κατάσταση</th><th></th></tr></thead><tbody>';
    list.forEach((e) => {
      h += '<tr class="clickable" data-action="exOpen" data-id="' + e.id + '"><td class="nowrap strong">' + esc(when(e.startsAt)) + '</td><td><div class="strong">' + esc(e.title) + '</div><div class="small muted">' + esc(e.subjectName || '') + (e.countsFinal ? ' <span class="badge badge-info">μετράει στην τελική</span>' : '') + '</div></td>' +
        '<td class="num">' + e.durationMinutes + '′</td><td class="num">' + e.questionCount + '</td><td class="num">' + e.assigned + '</td><td class="num">' + (e.status === 'published' ? e.submitted + (e.started > e.submitted ? ' <span class="small warning-text">(+' + (e.started - e.submitted) + ' σε εξέλιξη)</span>' : '') : '—') + '</td>' +
        '<td><span class="pill-state ' + e.st.cls + '">' + esc(e.st.label) + '</span></td><td class="right nowrap">' +
        (e.status === 'published' ? '<button class="btn btn-sm" data-action="exResults" data-id="' + e.id + '">' + icon('list') + 'Αποτελέσματα</button>' : '') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  // ================================================================== editor
  function blankDraft() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(10, 0, 0, 0);
    const p = toLocalParts(t.getTime());
    return { id: null, title: '', description: '', subjectId: null, subjectName: '', levelId: null, yearId: S().yearId, date: p.date, time: p.time, durationMinutes: 45, entryMinutes: 15, countsFinal: false, shuffleQuestions: true, shuffleOptions: true, questions: [], assignments: [], status: 'draft', attempts: 0, assignDirty: false };
  }

  function draftFromServer(e) {
    const p = toLocalParts(e.startsAt);
    return Object.assign({}, e, { date: p.date, time: p.time, questions: e.questions || [], assignments: e.assignments || [], assignDirty: false });
  }

  function subjectOptions(sel) {
    const { db } = S();
    let h = '<option value="">— Χωρίς μάθημα —</option>';
    C.LEVELS.forEach((l) => {
      const list = db.subjects.filter((s) => s.levelId === l.id);
      if (!list.length) return;
      h += '<optgroup label="' + esc(C.levelName(db, l.id)) + '">' + list.map((s) => '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc((s.code ? s.code + ' — ' : '') + s.name + (s.specialty !== 'COMMON' && !C.isUnifiedLevel(l.id) ? ' (' + C.specialtyName(s.specialty) + ')' : '')) + '</option>').join('') + '</optgroup>';
    });
    return h;
  }

  function locked() {
    return X.draft && X.draft.attempts > 0;
  }

  function questionCard(q, i) {
    const lk = locked();
    let h = '<div class="q-card" data-qi="' + i + '"><div class="q-head"><span class="q-n">' + (i + 1) + '.</span>' +
      '<select class="select" style="width:auto" data-on-change="exQType" data-qi="' + i + '"' + (lk ? ' disabled' : '') + '>' + Object.keys(EC.TYPES).map((k) => '<option value="' + k + '"' + (q.type === k ? ' selected' : '') + '>' + esc(EC.TYPES[k]) + '</option>').join('') + '</select>' +
      '<label class="small muted row" style="gap:6px">Μονάδες <input class="input" style="width:70px" type="number" min="0.5" step="0.5" value="' + esc(q.points) + '" data-on-input="exQPoints" data-qi="' + i + '" /></label>' +
      '<div class="spacer"></div>' +
      (lk ? '' : '<button class="btn btn-sm btn-ghost btn-icon" title="Πάνω" data-action="exQMove" data-qi="' + i + '" data-d="-1"' + (i ? '' : ' disabled') + '>' + icon('up') + '</button><button class="btn btn-sm btn-ghost btn-icon" title="Κάτω" data-action="exQMove" data-qi="' + i + '" data-d="1"' + (i < X.draft.questions.length - 1 ? '' : ' disabled') + '>' + icon('down') + '</button><button class="btn btn-sm btn-ghost btn-icon" title="Διαγραφή ερώτησης" data-action="exQDel" data-qi="' + i + '">' + icon('trash') + '</button>') +
      '</div><textarea class="textarea" rows="2" placeholder="Κείμενο της ερώτησης…" data-on-input="exQText" data-qi="' + i + '">' + esc(q.text) + '</textarea>';
    if (q.type === 'single' || q.type === 'multi') {
      const multi = q.type === 'multi';
      h += '<div class="small muted" style="margin-top:8px">' + (multi ? 'Σημειώστε όλες τις σωστές επιλογές:' : 'Σημειώστε τη σωστή επιλογή:') + '</div>';
      (q.options || []).forEach((o, j) => {
        h += '<div class="q-opt"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="qc-' + i + '" title="Σωστή" data-on-change="exQCorrect" data-qi="' + i + '" data-o="' + esc(o.id) + '"' + ((q.correct || []).includes(o.id) ? ' checked' : '') + ' />' +
          '<span class="q-l">' + (EC.LETTERS[j] || j + 1) + '</span><input type="text" class="input" value="' + esc(o.text) + '" placeholder="Επιλογή ' + (EC.LETTERS[j] || j + 1) + '" data-on-input="exQOpt" data-qi="' + i + '" data-o="' + esc(o.id) + '" />' +
          (lk ? '' : '<button class="btn btn-sm btn-ghost btn-icon" title="Αφαίρεση επιλογής" data-action="exQOptDel" data-qi="' + i + '" data-o="' + esc(o.id) + '">' + icon('x') + '</button>') + '</div>';
      });
      if (!lk && (q.options || []).length < EC.MAX_OPTIONS) h += '<button class="btn btn-sm btn-ghost" style="margin-top:6px" data-action="exQOptAdd" data-qi="' + i + '">' + icon('plus') + 'Επιλογή</button>';
    } else if (q.type === 'tf') {
      h += '<div class="row" style="margin-top:10px;gap:18px"><span class="small muted">Η πρόταση είναι:</span>' +
        '<label class="checkbox"><input type="radio" name="qtf-' + i + '" data-on-change="exQTf" data-qi="' + i + '" data-v="true"' + (q.answer === true ? ' checked' : '') + ' /> Σωστή</label>' +
        '<label class="checkbox"><input type="radio" name="qtf-' + i + '" data-on-change="exQTf" data-qi="' + i + '" data-v="false"' + (q.answer === false ? ' checked' : '') + ' /> Λάθος</label></div>';
    } else {
      h += '<div class="field" style="margin-top:10px"><label>Αποδεκτές απαντήσεις</label><input class="input" value="' + esc((q.accept || []).join(' | ')) + '" placeholder="π.χ. Αγγλικά | English" data-on-input="exQAccept" data-qi="' + i + '" /><div class="hint">Χωρίστε εναλλακτικές απαντήσεις με | — δεν μετράνε κεφαλαία, τόνοι και κενά. Οι αριθμοί συγκρίνονται ως αριθμοί (3,5 = 3.5).</div></div>';
    }
    return h + '</div>';
  }

  /**
   * Absences of the draft's students in its subject (computed here from the registry; the server decides the same way)
   * → amKey → {student, status} — empty when the exam has no subject.
   */
  function draftAbsences() {
    const { db } = S();
    const d = X.draft;
    const out = new Map();
    const sj = d && d.subjectId ? db.subjects.find((s) => s.id === d.subjectId) : null;
    if (!sj) return out;
    const yearId = d.yearId && db.years.some((y) => y.id === d.yearId) ? d.yearId : S().yearId;
    const att = C.attendance(db, yearId);
    const byAm = new Map(db.students.map((s) => [App.accounts.amKey(s.am), s]));
    d.assignments.forEach((a) => {
      const k = App.accounts.amKey(a.am);
      const st = byAm.get(k) || (a.studentId && db.students.find((s) => s.id === a.studentId));
      if (st) out.set(k, { student: st, status: C.absenceStatus(db, st, sj.id, yearId, att) });
    });
    return out;
  }

  /** «Να γράψει» / «Ανάκληση» button of a student over the absence limit (the permission is per exam, on the server). */
  function allowButton(am, name, n, limit, allowed) {
    const data = ' data-action="exAllow" data-am="' + esc(am) + '" data-name="' + esc(name || am) + '" data-n="' + n + '" data-limit="' + (limit === null || limit === undefined ? '' : limit) + '"';
    return allowed
      ? '<button class="btn btn-sm btn-ghost ex-allow" title="Να μην μπορεί να γράψει λόγω απουσιών"' + data + ' data-v="0">' + icon('undo') + 'Ανάκληση άδειας</button>'
      : '<button class="btn btn-sm btn-soft ex-allow" title="Άδεια συμμετοχής σε αυτή την εξέταση παρά τις απουσίες"' + data + ' data-v="1">' + icon('check') + 'Να γράψει</button>';
  }

  function assignmentsHtml(acc) {
    const d = X.draft;
    const noAcc = d.assignments.filter((a) => !acc.has(App.accounts.amKey(a.am)));
    const abs = draftAbsences();
    const allowed = d.absenceAllowed || {};
    const over = d.assignments.filter((a) => {
      const x = abs.get(App.accounts.amKey(a.am));
      return x && x.status.over && !allowed[App.accounts.amKey(a.am)];
    });
    let h = '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Ανάθεση σε σπουδαστές (' + d.assignments.length + ')</h3><div class="sub">Μόνο αυτοί οι σπουδαστές βλέπουν την εξέταση στον λογαριασμό τους</div></div>' +
      '<div class="row">' + (d.assignments.length ? '<button class="btn btn-sm btn-ghost" data-action="exAssignClear">Καθαρισμός</button>' : '') + '<button class="btn btn-primary btn-sm" data-action="exAssign" id="ex-assign">' + icon('users') + 'Επιλογή σπουδαστών…</button></div></div>';
    if (noAcc.length) {
      h += '<div class="card-body" style="border-bottom:1px solid var(--border)"><div class="callout warn" style="align-items:center">' + icon('key') + '<p style="flex:1">' + plural(noAcc.length, 'σπουδαστής δεν έχει', 'σπουδαστές δεν έχουν') + ' λογαριασμό σύνδεσης και δεν θα μπορεί' + (noAcc.length === 1 ? '' : 'ούν') + ' να γράψ' + (noAcc.length === 1 ? 'ει' : 'ουν') + ' την εξέταση.</p><button class="btn btn-sm" data-action="exMakeAccounts">' + icon('key') + 'Δημιουργία λογαριασμών</button></div></div>';
    }
    if (over.length)
      h += '<div class="card-body" style="border-bottom:1px solid var(--border)"><div class="callout warn" id="ex-over-note">' + icon('alert') + '<p>' + plural(over.length, 'σπουδαστής έχει', 'σπουδαστές έχουν') + ' περισσότερες ώρες απουσίας από το όριο στο μάθημα και <b>δεν θα μπορ' + (over.length === 1 ? 'εί' : 'ούν') + ' να ξεκινήσ' + (over.length === 1 ? 'ει' : 'ουν') + '</b> την εξέταση — θα δ' + (over.length === 1 ? 'ει' : 'ουν') + ' μήνυμα στην οθόνη τ' + (over.length === 1 ? 'ου' : 'ους') + '. Με «Να γράψει» δίνετε άδεια' + (d.id ? '' : ' (μετά την αποθήκευση της εξέτασης)') + '.</p></div></div>';
    if (!d.assignments.length) return h + '<div class="card-body muted small">Δεν έχουν επιλεγεί σπουδαστές.</div></div>';
    const withAbs = !!(d.subjectId && S().db.subjects.some((s) => s.id === d.subjectId));
    h += '<div class="table-wrap" style="max-height:340px"><table class="table table-compact"><thead><tr><th>Α.Μ.</th><th>Ονοματεπώνυμο</th><th>Τμήμα</th><th>Λογαριασμός</th>' + (withAbs ? '<th title="Ώρες απουσίας στο μάθημα / όριο">Απουσίες (ώρες)</th>' : '') + '<th></th></tr></thead><tbody>';
    d.assignments.forEach((a, i) => {
      const k = App.accounts.amKey(a.am);
      const u = acc.get(k);
      let absCell = '';
      if (withAbs) {
        const x = abs.get(k);
        const s = x && x.status;
        const ok = !!allowed[k];
        absCell = '<td class="ex-abs' + (s && s.over ? ' over' : '') + '">' + (!s ? '<span class="faint">—</span>' : s.count + (s.limit !== null ? ' / ' + s.limit : '')) +
          (s && s.over ? (ok ? ' <span class="badge badge-success" title="Έχει άδεια για αυτή την εξέταση">άδεια</span>' : ' <span class="badge badge-danger">εκτός ορίου</span>') : '') +
          (d.id && s && (s.over || ok) ? allowButton(a.am, a.name, s.count, s.limit, ok) : '') + '</td>';
      }
      h += '<tr><td class="am">' + esc(a.am) + '</td><td class="strong">' + esc(a.name) + '</td><td class="small">' + esc(a.className || '') + '</td><td>' + (u ? (u.active ? '<span class="pill-state ok">ενεργός</span>' : '<span class="pill-state bad">ανενεργός</span>') : '<span class="pill-state warn">χωρίς λογαριασμό</span>') + '</td>' + absCell +
        '<td class="right"><button class="btn btn-sm btn-ghost btn-icon" title="Αφαίρεση" data-action="exUnassign" data-i="' + i + '">' + icon('x') + '</button></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function editorHtml(acc) {
    const d = X.draft;
    const st = d.id ? examState({ status: d.status, startsAt: fromLocalParts(d.date, d.time), entryMinutes: Number(d.entryMinutes) || 0, durationMinutes: Number(d.durationMinutes) || 0 }, Remote.now()) : { label: 'Νέα', cls: '' };
    const errs = EC.validateQuestions(d.questions.map((q, i) => EC.normalizeQuestion(q, i)));
    const total = d.questions.reduce((a, q) => a + (Number(q.points) > 0 ? Number(q.points) : 1), 0);
    let h = '<div class="row" style="margin-bottom:14px"><button class="btn btn-ghost" data-action="exBack">' + icon('left') + 'Εξετάσεις</button><span class="pill-state ' + st.cls + '">' + esc(st.label) + '</span>' +
      (X.dirty ? '<span class="small warning-text">● Μη αποθηκευμένες αλλαγές</span>' : '') + '<div class="spacer"></div>' +
      (d.id ? '<button class="btn btn-sm btn-ghost" data-action="exDup">' + icon('copy') + 'Αντίγραφο</button><button class="btn btn-sm btn-ghost" data-action="exDel">' + icon('trash') + 'Διαγραφή</button>' : '') +
      (d.id && d.status === 'published' ? '<button class="btn" data-action="exResults" data-id="' + d.id + '">' + icon('list') + 'Αποτελέσματα</button>' : '') +
      '<button class="btn" data-action="exSave" id="ex-save">' + icon('save') + 'Αποθήκευση</button>' +
      (d.status === 'published' ? (d.attempts ? '' : '<button class="btn" data-action="exPublish" data-v="0">Απόσυρση</button>') : '<button class="btn btn-primary" data-action="exPublish" data-v="1" id="ex-publish">' + icon('send') + 'Δημοσίευση</button>') + '</div>';
    if (locked()) h += '<div class="callout warn" style="margin-bottom:14px">' + icon('lock') + '<p>Η εξέταση έχει ήδη απαντήσεις σπουδαστών. Επιτρέπονται μόνο διορθώσεις (κείμενο, σωστή απάντηση, μονάδες, ώρα) — οι απαντήσεις βαθμολογούνται ξανά αυτόματα.</p></div>';
    // details
    h += '<div class="card"><div class="card-head"><div><h3>Στοιχεία εξέτασης</h3><div class="sub">Ενδιάμεσο τεστ — βαθμολογείται αυτόματα από το σύστημα</div></div></div><div class="card-body form-grid">' +
      '<div class="field span-2"><label>Τίτλος *</label><input class="input" id="ex-title" value="' + esc(d.title) + '" placeholder="π.χ. 1η Πρόοδος Ναυσιπλοΐας" data-on-input="exF" data-k="title" /></div>' +
      '<div class="field span-2"><label>Μάθημα</label><select class="select" data-on-change="exSubject">' + subjectOptions(d.subjectId) + '</select><div class="hint">Με μάθημα γίνεται και ο έλεγχος απουσιών: όσοι έχουν περισσότερες ώρες απουσίας από το όριο του μαθήματος δεν μπορούν να ξεκινήσουν την εξέταση.</div></div>' +
      '<div class="field"><label>Ημερομηνία *</label><input class="input" type="date" id="ex-date" value="' + esc(d.date) + '" data-on-change="exF" data-k="date" /></div>' +
      '<div class="field"><label>Ώρα έναρξης *</label><input class="input" type="time" id="ex-time" value="' + esc(d.time) + '" data-on-change="exF" data-k="time" /></div>' +
      '<div class="field"><label>Διάρκεια (λεπτά) *</label><input class="input" type="number" min="1" max="600" id="ex-dur" value="' + esc(d.durationMinutes) + '" data-on-input="exF" data-k="durationMinutes" /></div>' +
      '<div class="field"><label>Περιθώριο εισόδου (λεπτά)</label><input class="input" type="number" min="1" max="600" id="ex-entry" value="' + esc(d.entryMinutes) + '" data-on-input="exF" data-k="entryMinutes" /><div class="hint">Μέχρι πότε μπορεί να μπει ένας σπουδαστής μετά την ώρα έναρξης.</div></div>' +
      '<div class="field span-2"><label>Οδηγίες προς τους σπουδαστές</label><textarea class="textarea" rows="2" data-on-input="exF" data-k="description" placeholder="Προαιρετικό">' + esc(d.description) + '</textarea></div>' +
      '<div class="field span-2 stack" style="gap:8px">' +
      '<label class="checkbox"><input type="checkbox" id="ex-counts" data-on-change="exFChk" data-k="countsFinal"' + (d.countsFinal ? ' checked' : '') + ' /> <b>Μετράει στην τελική βαθμολογία</b> (απόφαση του καθηγητή)</label>' +
      '<div class="hint" style="margin:-4px 0 4px 24px">Ενημερωτικό: ο βαθμός του τεστ δεν περνά ποτέ αυτόματα στο βαθμολόγιο — ο τελικός βαθμός του μαθήματος εισάγεται μόνο από τον καθηγητή.</div>' +
      '<label class="checkbox"><input type="checkbox" data-on-change="exFChk" data-k="shuffleQuestions"' + (d.shuffleQuestions ? ' checked' : '') + ' /> Διαφορετική σειρά ερωτήσεων για κάθε σπουδαστή</label>' +
      '<label class="checkbox"><input type="checkbox" data-on-change="exFChk" data-k="shuffleOptions"' + (d.shuffleOptions ? ' checked' : '') + ' /> Ανακάτεμα των επιλογών πολλαπλής επιλογής</label></div>' +
      '</div></div>';
    // questions
    h += '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Ερωτήσεις (' + d.questions.length + ') · ' + total + ' μονάδες</h3><div class="sub">Βαθμός τεστ στην κλίμακα 0–5: 50% = 1, 60% = 2 … 90% = 5</div></div>' +
      '<div class="row">' + (locked() ? '' : '<button class="btn btn-sm btn-ghost" data-action="exQTemplate">' + icon('sheet') + 'Πρότυπο Excel</button><button class="btn btn-sm" data-action="exQImport">' + icon('upload') + 'Εισαγωγή από Excel</button><button class="btn btn-sm btn-primary" data-action="exQAdd" id="ex-qadd">' + icon('plus') + 'Ερώτηση</button>') + '</div></div><div class="card-body">';
    if (errs.length && d.questions.length) h += '<div class="callout warn" style="margin-bottom:12px">' + icon('alert') + '<p>' + errs.slice(0, 6).map(esc).join('<br>') + (errs.length > 6 ? '<br>…' : '') + '</p></div>';
    if (!d.questions.length) h += '<div class="muted small">Προσθέστε ερωτήσεις μία-μία ή εισάγετε τις από Excel (Ερώτηση · Τύπος · Α · Β · Γ · Δ · Σωστή · Μονάδες).</div>';
    h += '<div id="ex-questions">' + d.questions.map(questionCard).join('') + '</div>';
    if (d.questions.length && !locked()) h += '<button class="btn btn-sm btn-ghost" style="margin-top:10px" data-action="exQAdd">' + icon('plus') + 'Ερώτηση</button>';
    h += '</div></div>';
    h += assignmentsHtml(acc);
    return h;
  }

  function markDirty(repaint) {
    const was = X.dirty;
    X.dirty = true;
    if (repaint || !was) rerenderKeepScroll();
  }
  function rerenderKeepScroll() {
    const c = document.getElementById('content');
    const top = c ? c.scrollTop : 0;
    const ae = document.activeElement;
    const key = ae && ae.dataset ? { a: ae.dataset.onInput || ae.dataset.onChange, qi: ae.dataset.qi, o: ae.dataset.o, k: ae.dataset.k, pos: ae.selectionStart } : null;
    App.render();
    if (c) c.scrollTop = top;
    if (key && key.a) {
      let sel = '[data-on-input="' + key.a + '"],[data-on-change="' + key.a + '"]';
      const cands = Array.from(document.querySelectorAll(sel)).filter((x) => x.dataset.qi === key.qi && x.dataset.o === key.o && x.dataset.k === key.k);
      if (cands[0]) {
        cands[0].focus();
        try {
          if (key.pos != null) cands[0].setSelectionRange(key.pos, key.pos);
        } catch (e) {
          /* not a text field */
        }
      }
    }
  }

  // ================================================================== results
  const STATE = { submitted: ['Υποβλήθηκε', 'ok'], in_progress: ['Σε εξέλιξη', 'live'], not_started: ['Δεν ξεκίνησε', ''], missed: ['Δεν συμμετείχε', 'bad'] };
  /** Not started and over the absence limit of the subject without the admin's permission: the student cannot start. */
  const barredRow = (x) => !!x.overLimit && !x.absenceAllowed && x.status !== 'submitted' && x.status !== 'in_progress';
  function resultsHtml() {
    const r = X.res;
    if (!r) return '<div class="card card-pad muted">Φόρτωση αποτελεσμάτων…</div>';
    const e = r.exam;
    const rows = r.rows.slice().sort((a, b) => String(a.className || '').localeCompare(String(b.className || ''), 'el') || String(a.name || '').localeCompare(String(b.name || ''), 'el'));
    const chk = !!e.absenceCheck;
    const barred = rows.filter(barredRow);
    const sub = rows.filter((x) => x.status === 'submitted');
    const running = rows.filter((x) => x.status === 'in_progress').length;
    const avgP = sub.length ? sub.reduce((a, x) => a + x.percent, 0) / sub.length : null;
    const avgG = sub.length ? sub.reduce((a, x) => a + x.grade, 0) / sub.length : null;
    const st = examState(e, Remote.now());
    let h = '<div class="row" style="margin-bottom:14px"><button class="btn btn-ghost" data-action="exBack">' + icon('left') + 'Εξετάσεις</button><span class="pill-state ' + st.cls + '">' + esc(st.label) + '</span><div class="spacer"></div>' +
      '<button class="btn btn-sm btn-ghost" data-action="exResRefresh">' + icon('refresh') + 'Ανανέωση</button><button class="btn" data-action="exOpen" data-id="' + e.id + '">' + icon('edit') + 'Επεξεργασία</button><button class="btn btn-primary" data-action="exResExcel" id="ex-res-excel">' + icon('download') + 'Εξαγωγή σε Excel</button></div>';
    h += '<div class="card"><div class="card-head"><div><h2>' + esc(e.title) + '</h2><div class="sub">' + esc(e.subjectName || '') + (e.subjectName ? ' · ' : '') + esc(when(e.startsAt)) + ' · ' + e.durationMinutes + ' λεπτά · ' + plural(e.questionCount, 'ερώτηση', 'ερωτήσεις') + '</div></div>' +
      '<div class="row" style="gap:26px">' + stat(rows.length, 'ανατέθηκε') + stat(sub.length, 'υποβλήθηκαν') + (running ? stat(running, 'σε εξέλιξη') : '') + (barred.length ? stat(barred.length, 'χωρίς δικαίωμα') : '') + stat(avgP === null ? '—' : Math.round(avgP) + '%', 'μ.ο. ποσοστού') + stat(avgG === null ? '—' : avgG.toFixed(2), 'μ.ο. βαθμού 0–5') + '</div></div>';
    h += '<div class="card-body" style="border-bottom:1px solid var(--border)"><div class="callout" style="margin:0">' + icon('info') + '<p>Μετράει στην τελική βαθμολογία: <b>' + (e.countsFinal ? 'ΝΑΙ' : 'ΟΧΙ') + '</b> (απόφαση καθηγητή). Ο βαθμός του τεστ <b>δεν</b> περνά αυτόματα στο βαθμολόγιο — ο τελικός βαθμός του μαθήματος εισάγεται μόνο από τον καθηγητή.</p></div></div>';
    if (barred.length)
      h += '<div class="card-body" style="border-bottom:1px solid var(--border)"><div class="callout warn" style="margin:0" id="ex-res-barred">' + icon('alert') + '<p>' + plural(barred.length, 'σπουδαστής έχει', 'σπουδαστές έχουν') + ' περισσότερες ώρες απουσίας από το όριο στο μάθημα και <b>δεν μπορ' + (barred.length === 1 ? 'εί' : 'ούν') + ' να ξεκινήσ' + (barred.length === 1 ? 'ει' : 'ουν') + '</b> την εξέταση (βλέπ' + (barred.length === 1 ? 'ει' : 'ουν') + ' σχετικό μήνυμα). Με «Να γράψει» δίνετε άδεια μόνο για αυτή την εξέταση.</p></div></div>';
    h += '<div class="table-wrap" style="max-height:calc(100vh - 360px)"><table class="table"><thead><tr><th>Α.Μ.</th><th>Ονοματεπώνυμο</th><th>Τμήμα</th><th>Κατάσταση</th>' + (chk ? '<th title="Ώρες απουσίας στο μάθημα / όριο">Απουσίες (ώρες)</th>' : '') + '<th>Έναρξη</th><th>Υποβολή</th><th class="num">Μονάδες</th><th class="num">%</th><th class="num">Βαθμός 0–5</th><th></th></tr></thead><tbody>';
    rows.forEach((x) => {
      const no = barredRow(x);
      const s = no ? ['Χωρίς δικαίωμα (απουσίες)', 'bad'] : STATE[x.status] || [x.status, ''];
      const has = x.status === 'submitted' || x.status === 'in_progress';
      const absCell = !chk
        ? ''
        : '<td class="ex-abs' + (x.overLimit ? ' over' : '') + '">' + (x.absences === undefined ? '<span class="faint">—</span>' : x.absences + (x.absenceLimit !== null && x.absenceLimit !== undefined ? ' / ' + x.absenceLimit : '')) +
          (x.absenceAllowed ? ' <span class="badge badge-success" title="Έχει άδεια για αυτή την εξέταση">άδεια</span>' : '') +
          (!has && (x.absenceAllowed || x.overLimit) ? allowButton(x.am, x.name, x.absences, x.absenceLimit, !!x.absenceAllowed) : '') + '</td>';
      h += '<tr' + (no ? ' class="ex-barred-row"' : '') + ' data-am="' + esc(x.am) + '"><td class="am">' + esc(x.am) + '</td><td class="strong">' + esc(x.name || '') + (x.account === 'none' ? ' <span class="badge badge-warning" title="Χωρίς λογαριασμό σύνδεσης">χωρίς λογαριασμό</span>' : '') + '</td><td class="small">' + esc(x.className || '') + '</td>' +
        '<td><span class="pill-state ' + s[1] + '">' + esc(s[0]) + '</span>' + (x.autoSubmitted ? ' <span class="small muted" title="Υποβλήθηκε αυτόματα στη λήξη του χρόνου">αυτόματα</span>' : '') + '</td>' + absCell +
        '<td class="small nowrap">' + (x.startedAt ? esc(fmtDate(x.startedAt, true).slice(11)) : '—') + '</td><td class="small nowrap">' + (x.submittedAt ? esc(fmtDate(x.submittedAt, true).slice(11)) : '—') + '</td>' +
        '<td class="num">' + (has ? x.score + ' / ' + x.max : '') + '</td><td class="num">' + (has ? Math.round(x.percent) + '%' : '') + '</td><td class="num strong' + (has && x.grade < 1 ? ' danger-text' : '') + '">' + (has ? x.grade : '') + '</td>' +
        '<td class="right nowrap">' + (has ? '<button class="btn btn-sm btn-ghost" data-action="exResDetail" data-am="' + esc(x.am) + '">' + icon('eye') + 'Απαντήσεις</button><button class="btn btn-sm btn-ghost" title="Να ξαναγράψει την εξέταση" data-action="exResReset" data-am="' + esc(x.am) + '">' + icon('undo') + '</button>' : '') + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }
  function stat(v, label) {
    return '<div style="text-align:center"><div style="font-size:20px;font-weight:750">' + esc(v) + '</div><div class="small muted">' + esc(label) + '</div></div>';
  }
  async function loadResults() {
    try {
      X.res = await Remote.examResults(X.resId);
    } catch (e) {
      toast(esc(e.message), 'error');
    }
  }
  function startResTimer() {
    clearInterval(X.resTimer);
    X.resTimer = setInterval(async () => {
      if (S().page !== 'exams' || X.view !== 'results') return clearInterval(X.resTimer);
      if (document.querySelector('.modal-backdrop')) return;
      await loadResults();
      if (S().page === 'exams' && X.view === 'results') rerenderKeepScroll();
    }, 15000);
  }

  // ================================================================== page
  App.pages.exams = {
    subtitle: () => 'Ενδιάμεσα τεστ με αυτόματη βαθμολόγηση — οι σπουδαστές βλέπουν μόνο τις εξετάσεις τους, όχι βαθμούς',
    render() {
      let h = '<div class="page">';
      if (X.view === 'edit' && X.draft) h += editorHtml(X.acc || new Map());
      else if (X.view === 'results') h += resultsHtml();
      else h += listHtml();
      return h + '</div>';
    },
    async mount() {
      if (X.view === 'list' && !X.list && !X.loadingList) {
        X.loadingList = true;
        await loadList();
        X.loadingList = false;
        rerender();
      }
      if (X.view === 'edit' && !X.acc) {
        X.acc = await App.accounts.map();
        rerenderKeepScroll();
      }
    },
    async confirmLeave() {
      if (X.view !== 'edit' || !X.dirty) return true;
      const ok = await confirmDialog('Μη αποθηκευμένες αλλαγές', 'Η εξέταση έχει αλλαγές που δεν αποθηκεύτηκαν. Να χαθούν;', { okText: 'Έξοδος χωρίς αποθήκευση', danger: true });
      if (ok) X.dirty = false;
      return ok;
    },
  };

  App.actions.exFilter = (el) => {
    X.filter = el.dataset.v;
    App.render();
  };
  App.actions.exReload = async () => {
    await loadList();
    App.render();
  };
  App.actions.exNew = async () => {
    X.draft = blankDraft();
    X.view = 'edit';
    X.dirty = false;
    X.acc = await App.accounts.map();
    App.render();
    const t = document.getElementById('ex-title');
    if (t) t.focus();
  };
  App.actions.exOpen = async (el) => {
    if (X.view === 'edit' && !(await App.pages.exams.confirmLeave())) return;
    const e = await Remote.exam(el.dataset.id);
    X.draft = draftFromServer(e);
    X.view = 'edit';
    X.dirty = false;
    X.acc = await App.accounts.map();
    App.render();
    document.getElementById('content').scrollTop = 0;
  };
  App.actions.exBack = async () => {
    if (!(await App.pages.exams.confirmLeave())) return;
    clearInterval(X.resTimer);
    X.view = 'list';
    X.draft = null;
    await loadList();
    App.render();
  };

  // ---- fields
  App.inputs.exF = (el) => {
    X.draft[el.dataset.k] = el.value;
    markDirty(false);
  };
  App.changes.exF = (el) => {
    X.draft[el.dataset.k] = el.value;
    markDirty(true);
  };
  App.changes.exFChk = (el) => {
    X.draft[el.dataset.k] = el.checked;
    markDirty(true);
  };
  App.changes.exSubject = (el) => {
    const sj = S().db.subjects.find((s) => s.id === el.value);
    X.draft.subjectId = sj ? sj.id : null;
    X.draft.subjectName = sj ? (sj.code ? sj.code + ' ' : '') + sj.name : '';
    X.draft.levelId = sj ? sj.levelId : null;
    if (sj && !X.draft.title.trim()) X.draft.title = 'Πρόοδος — ' + sj.name;
    markDirty(true);
  };

  // ---- questions
  const Q = (el) => X.draft.questions[Number(el.dataset.qi)];
  App.actions.exQAdd = () => {
    const last = X.draft.questions[X.draft.questions.length - 1];
    const type = last ? last.type : 'single';
    X.draft.questions.push(freshQuestion(type));
    markDirty(true);
    setTimeout(() => {
      const all = document.querySelectorAll('#ex-questions textarea');
      if (all.length) {
        all[all.length - 1].focus();
        all[all.length - 1].scrollIntoView({ block: 'center' });
      }
    }, 30);
  };
  function freshQuestion(type) {
    const q = { id: newQid(), type, text: '', points: 1 };
    if (type === 'single' || type === 'multi') {
      q.options = EC.OPT_IDS.slice(0, 4).map((id) => ({ id, text: '' }));
      q.correct = [];
    } else if (type === 'tf') q.answer = null;
    else q.accept = [];
    return q;
  }
  App.actions.exQDel = async (el) => {
    const q = Q(el);
    if (q.text && !(await confirmDialog('Διαγραφή ερώτησης', 'Να διαγραφεί η ερώτηση ' + (Number(el.dataset.qi) + 1) + ';', { okText: 'Διαγραφή', danger: true }))) return;
    X.draft.questions.splice(Number(el.dataset.qi), 1);
    markDirty(true);
  };
  App.actions.exQMove = (el) => {
    const i = Number(el.dataset.qi);
    const j = i + Number(el.dataset.d);
    const qs = X.draft.questions;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    markDirty(true);
  };
  App.changes.exQType = (el) => {
    const q = Q(el);
    const t = el.value;
    if (q.type === t) return;
    const keep = { id: q.id, text: q.text, points: q.points };
    const nq = Object.assign(freshQuestion(t), keep);
    if ((t === 'single' || t === 'multi') && q.options) {
      nq.options = q.options;
      nq.correct = t === 'single' ? (q.correct || []).slice(0, 1) : q.correct || [];
    }
    X.draft.questions[Number(el.dataset.qi)] = nq;
    markDirty(true);
  };
  App.inputs.exQText = (el) => {
    Q(el).text = el.value;
    markDirty(false);
  };
  App.inputs.exQPoints = (el) => {
    Q(el).points = Number(String(el.value).replace(',', '.')) || 1;
    markDirty(false);
  };
  App.inputs.exQOpt = (el) => {
    const o = (Q(el).options || []).find((x) => x.id === el.dataset.o);
    if (o) o.text = el.value;
    markDirty(false);
  };
  App.changes.exQCorrect = (el) => {
    const q = Q(el);
    if (q.type === 'single') q.correct = [el.dataset.o];
    else {
      const set = new Set(q.correct || []);
      if (el.checked) set.add(el.dataset.o);
      else set.delete(el.dataset.o);
      q.correct = q.options.map((o) => o.id).filter((id) => set.has(id));
    }
    markDirty(true);
  };
  App.actions.exQOptAdd = (el) => {
    const q = Q(el);
    const used = new Set(q.options.map((o) => o.id));
    const id = EC.OPT_IDS.find((x) => !used.has(x));
    if (!id) return;
    q.options.push({ id, text: '' });
    markDirty(true);
  };
  App.actions.exQOptDel = (el) => {
    const q = Q(el);
    q.options = q.options.filter((o) => o.id !== el.dataset.o);
    q.correct = (q.correct || []).filter((id) => id !== el.dataset.o);
    markDirty(true);
  };
  App.changes.exQTf = (el) => {
    Q(el).answer = el.dataset.v === 'true';
    markDirty(true);
  };
  App.inputs.exQAccept = (el) => {
    Q(el).accept = el.value.split('|').map((x) => x.trim()).filter(Boolean);
    markDirty(false);
  };
  App.actions.exQTemplate = async () => {
    const r = window.XL.buildQuestionTemplate();
    await App.saveWorkbook(r.wb, 'Πρότυπο_ερωτήσεων.xlsx');
  };
  App.actions.exQImport = async () => {
    const f = await App.pickExcel();
    if (!f) return;
    const wb = window.XL.readWorkbook(f.data, f.name);
    const sheet = wb.sheets.find((s) => s.grid.length) || wb.sheets[0];
    const r = EC.parseQuestionTable(sheet ? sheet.grid : []);
    if (!r.questions.length) throw new Error(r.problems.length ? r.problems[0].message : 'Δεν βρέθηκαν ερωτήσεις.');
    const has = X.draft.questions.length;
    const byType = {};
    r.questions.forEach((q) => (byType[q.type] = (byType[q.type] || 0) + 1));
    openModal({
      title: 'Εισαγωγή ερωτήσεων',
      sub: esc(f.name),
      size: 'md',
      body: '<p>Βρέθηκαν <b>' + r.questions.length + '</b> ερωτήσεις: ' + Object.keys(byType).map((k) => byType[k] + ' × ' + esc(EC.TYPES[k])).join(', ') + '.</p>' +
        (r.problems.length ? '<div class="callout warn">' + icon('alert') + '<p>Χρειάζονται διόρθωση (θα εισαχθούν και μπορείτε να τις συμπληρώσετε):<br>' + r.problems.slice(0, 8).map((p) => 'Γραμμή ' + p.row + ': ' + esc(p.message)).join('<br>') + (r.problems.length > 8 ? '<br>…' : '') + '</p></div>' : '') +
        (has ? '<label class="checkbox" style="margin-top:12px"><input type="checkbox" id="qi-replace" /> Αντικατάσταση των ' + has + ' υπαρχουσών ερωτήσεων (αλλιώς προστίθενται στο τέλος)</label>' : ''),
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εισαγωγή',
          cls: 'btn-primary',
          id: 'qi-go',
          onClick: (ctx) => {
            const rep = ctx.q('#qi-replace') && ctx.q('#qi-replace').checked;
            const qs = r.questions.map((q) => Object.assign({}, q, { id: newQid() }));
            X.draft.questions = rep ? qs : X.draft.questions.concat(qs);
            markDirty(true);
            toast('Προστέθηκαν ' + qs.length + ' ερωτήσεις');
          },
        },
      ],
    });
  };

  // ---- assignment
  App.actions.exAssign = () => {
    const { db } = S();
    const d = X.draft;
    const yearId = d.yearId && db.years.some((y) => y.id === d.yearId) ? d.yearId : S().yearId;
    const keepYear = S().yearId;
    S().yearId = yearId;
    const classes = App.yearClasses();
    S().yearId = keepYear;
    const cn = new Map();
    classes.forEach((c) => c.students.forEach((s) => cn.set(s.id, c.name)));
    const chosen = new Set(d.assignments.map((a) => App.accounts.amKey(a.am)));
    const sj = d.subjectId ? db.subjects.find((s) => s.id === d.subjectId) : null;
    const roster = sj ? C.subjectRoster(db, sj, yearId).map((x) => x.student) : [];
    let filter = '';
    function body() {
      const f = C.normText(filter);
      let h = '';
      classes.forEach((c, ci) => {
        const list = f ? c.students.filter((s) => C.normText(s.am + ' ' + C.studentName(s)).includes(f)) : c.students;
        if (!list.length) return;
        const all = c.students.every((s) => chosen.has(App.accounts.amKey(s.am)));
        const some = c.students.some((s) => chosen.has(App.accounts.amKey(s.am)));
        h += '<tr class="group-row"><td><input type="checkbox" data-cls="' + ci + '"' + (all ? ' checked' : '') + (some && !all ? ' data-partial="1"' : '') + ' /></td><td colspan="2" class="strong">' + esc(c.name) + ' <span class="muted small">(' + c.students.length + ')</span></td></tr>';
        list.forEach((s) => {
          h += '<tr><td><input type="checkbox" data-st="' + s.id + '"' + (chosen.has(App.accounts.amKey(s.am)) ? ' checked' : '') + ' /></td><td class="am">' + esc(s.am) + '</td><td>' + esc(C.studentName(s)) + '</td></tr>';
        });
      });
      return h || '<tr><td colspan="3" class="muted">Δεν υπάρχουν εγγεγραμμένοι σπουδαστές στο ' + esc(C.yearLabel(db, yearId)) + '.</td></tr>';
    }
    openModal({
      title: 'Ανάθεση σε σπουδαστές',
      sub: 'Εγγεγραμμένοι του ' + esc(C.yearLabel(db, yearId)) + ' — επιλέξτε ολόκληρο τμήμα ή συγκεκριμένους σπουδαστές',
      size: 'lg',
      body: '<div class="row" style="margin-bottom:10px;gap:10px"><input class="input" id="as-q" placeholder="Αναζήτηση Α.Μ. ή ονόματος…" style="max-width:280px" />' +
        (sj ? '<button class="btn btn-sm" id="as-roster">' + icon('book') + 'Όσοι έχουν το μάθημα (' + roster.length + ')</button>' : '') +
        '<button class="btn btn-sm btn-ghost" id="as-none">Καμία επιλογή</button><div class="spacer"></div><span class="small strong" id="as-count"></span></div>' +
        '<div class="table-wrap" style="max-height:55vh"><table class="table table-compact"><thead><tr><th style="width:34px"></th><th style="width:110px">Α.Μ.</th><th>Ονοματεπώνυμο</th></tr></thead><tbody id="as-body"></tbody></table></div>',
      onMount(ctx) {
        const paint = () => {
          ctx.q('#as-body').innerHTML = body();
          ctx.qa('[data-partial]').forEach((x) => (x.indeterminate = true));
          ctx.q('#as-count').textContent = chosen.size + ' επιλεγμένοι';
        };
        paint();
        ctx.q('#as-q').addEventListener('input', (e) => {
          filter = e.target.value;
          paint();
        });
        ctx.q('#as-none').addEventListener('click', () => {
          chosen.clear();
          paint();
        });
        const rb = ctx.q('#as-roster');
        if (rb)
          rb.addEventListener('click', () => {
            roster.forEach((s) => chosen.add(App.accounts.amKey(s.am)));
            paint();
          });
        ctx.el.addEventListener('change', (e) => {
          const t = e.target;
          if (t.dataset.cls !== undefined) {
            classes[Number(t.dataset.cls)].students.forEach((s) => (t.checked ? chosen.add(App.accounts.amKey(s.am)) : chosen.delete(App.accounts.amKey(s.am))));
            paint();
          } else if (t.dataset.st) {
            const s = db.students.find((x) => x.id === t.dataset.st);
            if (t.checked) chosen.add(App.accounts.amKey(s.am));
            else chosen.delete(App.accounts.amKey(s.am));
            paint();
          }
        });
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εφαρμογή',
          cls: 'btn-primary',
          id: 'as-ok',
          onClick: () => {
            const prev = new Map(d.assignments.map((a) => [App.accounts.amKey(a.am), a]));
            const out = [];
            const seen = new Set();
            classes.forEach((c) =>
              c.students.forEach((s) => {
                const k = App.accounts.amKey(s.am);
                if (!chosen.has(k) || seen.has(k)) return;
                seen.add(k);
                out.push({ am: s.am, studentId: s.id, name: C.studentName(s), className: cn.get(s.id) || '' });
              })
            );
            // keep earlier assignments of students not listed this year (e.g. other year)
            prev.forEach((a, k) => {
              if (chosen.has(k) && !seen.has(k)) out.push(a);
            });
            d.assignments = out;
            d.assignDirty = true;
            markDirty(true);
          },
        },
      ],
    });
  };
  App.actions.exUnassign = (el) => {
    X.draft.assignments.splice(Number(el.dataset.i), 1);
    X.draft.assignDirty = true;
    markDirty(true);
  };
  App.actions.exAssignClear = async () => {
    if (!(await confirmDialog('Καθαρισμός', 'Να αφαιρεθούν όλοι οι σπουδαστές από την εξέταση;', { okText: 'Αφαίρεση', danger: true }))) return;
    X.draft.assignments = [];
    X.draft.assignDirty = true;
    markDirty(true);
  };
  App.actions.exMakeAccounts = async () => {
    const acc = await App.accounts.map();
    const { db } = S();
    const missing = X.draft.assignments.filter((a) => !acc.has(App.accounts.amKey(a.am)));
    const students = missing.map((a) => db.students.find((s) => App.accounts.amKey(s.am) === App.accounts.amKey(a.am))).filter(Boolean);
    if (!students.length) return;
    await App.createAccounts(students, false);
    X.acc = await App.accounts.map();
    rerenderKeepScroll();
  };

  // ---- save / publish / delete
  function payload() {
    const d = X.draft;
    return {
      title: d.title,
      description: d.description,
      subjectId: d.subjectId,
      subjectName: d.subjectName,
      levelId: d.levelId,
      yearId: d.yearId || S().yearId,
      startsAt: fromLocalParts(d.date, d.time),
      durationMinutes: Number(d.durationMinutes),
      entryMinutes: Number(d.entryMinutes),
      countsFinal: !!d.countsFinal,
      shuffleQuestions: !!d.shuffleQuestions,
      shuffleOptions: !!d.shuffleOptions,
      questions: d.questions.map((q, i) => EC.normalizeQuestion(q, i)),
    };
  }
  async function save(quiet) {
    const d = X.draft;
    const p = payload();
    EC.normalizeExamMeta(p); // throws a readable message
    let id = d.id;
    if (!id) {
      id = (await Remote.createExam(p)).id;
      d.id = id; // a retry after a network error must not create the exam twice
      d.assignDirty = true;
    } else await Remote.updateExam(id, p);
    if (d.assignDirty) {
      await Remote.assignExam(id, d.assignments);
      d.assignDirty = false;
    }
    X.draft = draftFromServer(await Remote.exam(id));
    X.dirty = false;
    X.list = null;
    if (!quiet) toast('Η εξέταση αποθηκεύτηκε', 'success');
    rerenderKeepScroll();
    return id;
  }
  App.actions.exSave = async () => {
    if (X.busy) return;
    X.busy = true;
    try {
      await save(false);
    } finally {
      X.busy = false;
    }
  };
  App.actions.exPublish = async (el) => {
    const on = el.dataset.v === '1';
    if (on) {
      const p = payload();
      const errs = EC.validateQuestions(p.questions);
      if (errs.length) throw new Error(errs[0]);
      if (!X.draft.assignments.length) throw new Error('Αναθέστε πρώτα την εξέταση σε σπουδαστές.');
      if (p.startsAt + (p.entryMinutes + p.durationMinutes) * 60000 < Remote.now()) throw new Error('Η ημερομηνία/ώρα της εξέτασης έχει ήδη περάσει.');
      const acc = await App.accounts.map();
      const noAcc = X.draft.assignments.filter((a) => !acc.has(App.accounts.amKey(a.am))).length;
      const allowed = X.draft.absenceAllowed || {};
      let over = 0;
      draftAbsences().forEach((x, k) => x.status.over && !allowed[k] && over++);
      const msg = '<b>' + esc(X.draft.title) + '</b><br>' + esc(when(p.startsAt)) + ' · ' + p.durationMinutes + ' λεπτά · ' + plural(p.questions.length, 'ερώτηση', 'ερωτήσεις') + '<br><br>Η εξέταση θα εμφανιστεί στους <b>' + X.draft.assignments.length + '</b> σπουδαστές που της έχουν ανατεθεί και θα ανοίξει αυτόματα την ώρα έναρξης.' +
        (noAcc ? '<br><br><span class="warning-text">' + plural(noAcc, 'σπουδαστής δεν έχει', 'σπουδαστές δεν έχουν') + ' λογαριασμό σύνδεσης.</span>' : '') +
        (over ? '<br><br><span class="danger-text">' + plural(over, 'σπουδαστής είναι', 'σπουδαστές είναι') + ' εκτός ορίου απουσιών στο μάθημα και δεν θα μπορ' + (over === 1 ? 'εί' : 'ούν') + ' να την ξεκινήσ' + (over === 1 ? 'ει' : 'ουν') + ' (εκτός αν δώσετε άδεια).</span>' : '');
      if (!(await confirmDialog('Δημοσίευση εξέτασης', msg, { okText: 'Δημοσίευση' }))) return;
    }
    const id = X.dirty || !X.draft.id ? await save(true) : X.draft.id;
    await Remote.publishExam(id, on);
    X.draft = draftFromServer(await Remote.exam(id));
    X.list = null;
    toast(on ? 'Η εξέταση δημοσιεύτηκε' : 'Η εξέταση αποσύρθηκε (πρόχειρο)', 'success');
    rerenderKeepScroll();
  };
  App.actions.exDel = async () => {
    const d = X.draft;
    const n = d.attempts || 0;
    if (!(await confirmDialog('Διαγραφή εξέτασης', 'Να διαγραφεί η εξέταση <b>' + esc(d.title) + '</b>;' + (n ? '<br><br><span class="danger-text">Θα διαγραφούν και οι απαντήσεις ' + plural(n, 'σπουδαστή', 'σπουδαστών') + '.</span>' : ''), { okText: 'Διαγραφή', danger: true }))) return;
    await Remote.deleteExam(d.id, n > 0);
    X.dirty = false;
    X.view = 'list';
    X.draft = null;
    await loadList();
    App.render();
    toast('Η εξέταση διαγράφηκε');
  };
  App.actions.exDup = async () => {
    if (!(await App.pages.exams.confirmLeave())) return;
    const r = await Remote.duplicateExam(X.draft.id);
    X.draft = draftFromServer(await Remote.exam(r.id));
    X.dirty = false;
    X.list = null;
    App.render();
    toast('Δημιουργήθηκε αντίγραφο (πρόχειρο) — ορίστε νέα ημερομηνία');
  };

  // ---- results
  App.actions.exResults = async (el) => {
    if (X.view === 'edit' && !(await App.pages.exams.confirmLeave())) return;
    X.view = 'results';
    X.resId = el.dataset.id;
    X.res = null;
    App.render();
    await loadResults();
    rerender();
    startResTimer();
  };
  App.actions.exResRefresh = async () => {
    await loadResults();
    rerenderKeepScroll();
  };
  App.actions.exResExcel = async () => {
    await loadResults();
    const r = window.XL.buildExamResults(X.res);
    await App.saveWorkbook(r.wb, window.XL.fileSafe('Αποτελέσματα_' + X.res.exam.title + '_' + fmtDate(X.res.exam.startsAt).replace(/\//g, '-')) + '.xlsx');
  };
  App.actions.exResDetail = async (el) => {
    const r = await Remote.examResult(X.resId, el.dataset.am);
    const row = X.res.rows.find((x) => x.am === el.dataset.am) || {};
    openModal({
      title: 'Απαντήσεις: ' + (row.name || r.am),
      sub: 'Α.Μ. ' + esc(r.am) + ' · ' + r.score + ' / ' + r.max + ' μονάδες · ' + Math.round(r.percent) + '% · βαθμός ' + r.grade,
      size: 'lg',
      body: '<div class="table-wrap" style="max-height:60vh"><table class="table table-compact"><thead><tr><th class="num">#</th><th>Ερώτηση</th><th>Απάντηση</th><th>Σωστή</th><th class="num">Μονάδες</th></tr></thead><tbody>' +
        r.items.map((it) => '<tr><td class="num">' + it.n + '</td><td>' + esc(it.text) + '</td><td class="' + (it.correct ? 'success-text' : 'danger-text') + ' strong">' + (it.answer ? esc(it.answer) : '<span class="faint">—</span>') + ' ' + (it.correct ? '✓' : '✗') + '</td><td class="small">' + esc(it.correctAnswer) + '</td><td class="num">' + it.points + ' / ' + it.max + '</td></tr>').join('') +
        '</tbody></table></div>',
      buttons: [{ label: 'Κλείσιμο' }],
    });
  };
  App.actions.exAllow = async (el) => {
    const on = el.dataset.v === '1';
    const id = X.view === 'results' ? X.resId : X.draft && X.draft.id;
    if (!id) throw new Error('Αποθηκεύστε πρώτα την εξέταση.');
    const lim = el.dataset.limit;
    if (
      on &&
      !(await confirmDialog(
        'Άδεια συμμετοχής',
        '<b>' + esc(el.dataset.name) + '</b> έχει <b>' + esc(el.dataset.n) + '</b> ώρες απουσίας στο μάθημα' + (lim !== '' ? ' (όριο ' + esc(lim) + ' ώρες)' : '') + ' και κανονικά δεν έχει δικαίωμα συμμετοχής.<br><br>Να μπορεί να γράψει <b>αυτή</b> την εξέταση; (Οι άλλες εξετάσεις του μαθήματος δεν αλλάζουν.)',
        { okText: 'Να γράψει' }
      ))
    )
      return;
    const r = await Remote.allowAbsence(id, el.dataset.am, on);
    if (X.view === 'results') await loadResults();
    else if (X.draft && X.draft.id === id) X.draft.absenceAllowed = r.absenceAllowed || {};
    toast(on ? '<b>' + esc(el.dataset.name) + '</b> μπορεί να γράψει την εξέταση παρά τις απουσίες' : 'Η άδεια του/της <b>' + esc(el.dataset.name) + '</b> ανακλήθηκε', on ? 'success' : 'info');
    rerenderKeepScroll();
  };
  App.actions.exResReset = async (el) => {
    const row = X.res.rows.find((x) => x.am === el.dataset.am) || {};
    if (!(await confirmDialog('Επανάληψη εξέτασης', 'Να διαγραφούν οι απαντήσεις του/της <b>' + esc(row.name || el.dataset.am) + '</b> ώστε να ξαναγράψει την εξέταση; (Θα μπορεί να ξεκινήσει μόνο όσο είναι ανοιχτή η είσοδος — αλλάξτε την ώρα αν χρειάζεται.)', { okText: 'Διαγραφή απαντήσεων', danger: true }))) return;
    const r = await Remote.resetAttempt(X.resId, el.dataset.am);
    if (!r || !r.ok) throw new Error('Δεν βρέθηκαν απαντήσεις για διαγραφή.');
    await loadResults();
    rerenderKeepScroll();
  };

  App.exams = {
    state: X,
    /** On logout: stop timers and forget everything of the admin session (drafts hold correct answers). */
    reset() {
      clearInterval(X.resTimer);
      Object.assign(X, { view: 'list', filter: 'all', list: null, error: '', draft: null, dirty: false, res: null, resId: null, resTimer: null, busy: false, acc: null });
    },
  };
})();
