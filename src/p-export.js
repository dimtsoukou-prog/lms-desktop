/* Εξαγωγή: overall grades (Α.Μ. + ονοματεπώνυμο), per-subject grades (Α.Μ. only), registry, templates. */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, plural, options, toast, openModal } = App.ui;
  const S = () => App.S;

  const E = {
    yearId: null,
    level: 'ALL',
    spec: 'SPLIT',
    section: 'ALL',
    period: 'ALL',
    splitSections: false,
    includePercent: true,
    includeStats: true,
    includeFather: false,
    regScope: 'year',
    sLevel: 'SUP',
    sSubject: '',
    sSection: 'ALL',
  };

  function specsFor(v) {
    if (v === 'SPLIT') return ['DECK', 'ENGINE', 'NONE'];
    return [v];
  }

  /** Section filter is offered only for one level that has per-student classes. */
  function sectionFilterOn() {
    return E.level !== 'ALL' && !C.isShiftLevel(E.level);
  }

  /** Period filter choices for one level with ≥ 2 periods (else null); «Χωρίς περίοδο» only when such students exist. */
  function periodChoices() {
    const { db } = S();
    if (E.level === 'ALL') return null;
    const list = C.levelPeriods(db, E.level);
    if (list.length < 2) return null;
    const opts = [{ value: 'ALL', label: 'Όλες οι περίοδοι' }].concat(list.map((p) => ({ value: p.id, label: p.name })));
    if (db.enrollments.some((e) => e.yearId === E.yearId && e.levelId === E.level && !e.period)) opts.push({ value: 'NONE', label: 'Χωρίς περίοδο' });
    return opts;
  }

  function curPeriod() {
    const opts = periodChoices();
    if (!opts) return 'ALL';
    if (!opts.some((o) => o.value === E.period)) E.period = 'ALL';
    return E.period;
  }

  function exportOpts() {
    return {
      yearId: E.yearId,
      levelIds: E.level === 'ALL' ? C.LEVEL_IDS : [E.level],
      specialties: specsFor(E.level !== 'ALL' && C.isUnifiedLevel(E.level) ? 'SPLIT' : E.spec),
      section: sectionFilterOn() ? E.section : 'ALL',
      period: curPeriod(),
      splitSections: E.splitSections && !(sectionFilterOn() && E.section !== 'ALL'),
      includePercent: E.includePercent,
      includeStats: E.includeStats,
      includeFather: E.includeFather,
    };
  }

  /** Same grouping as XL.buildGradeExport, counted without building the workbook. */
  function previewCounts() {
    const { db } = S();
    const o = exportOpts();
    let sheets = 0;
    let students = 0;
    const seen = new Set();
    window.XL.gradeExportGroups(db, o).forEach((g) => {
      const list = C.enrolledStudents(db, o.yearId, g.levelId, C.isUnifiedLevel(g.levelId) ? 'ALL' : g.spec, g.section, g.period);
      if (!list.length) return;
      sheets++;
      students += list.length;
      list.forEach((s) => seen.add(s.id));
    });
    const grades = db.grades.filter((g) => g.yearId === o.yearId && seen.has(g.studentId)).length;
    return { sheets, students, grades };
  }

  function subjectChoices(levelId) {
    return C.subjectsOfLevel(S().db, levelId).map((s) => ({
      value: s.id,
      label: C.subjectLabel(s) + (s.specialty !== 'COMMON' ? ' · ' + C.specialtyName(s.specialty) : '') + (s.active === false ? ' (ανενεργό)' : ''),
    }));
  }

  App.pages.export = {
    subtitle: () => 'Δημιουργία αρχείων Excel — συνολική βαθμολογία, βαθμολογία ανά μάθημα, μητρώο',
    render() {
      const { db } = S();
      if (!E.yearId || !db.years.some((y) => y.id === E.yearId)) E.yearId = S().yearId;
      const pc = previewCounts();
      const unifiedSel = E.level !== 'ALL' && C.isUnifiedLevel(E.level);
      const perOpts = periodChoices();
      let h = '<div class="page">';

      // ---------------- overall
      h += '<div class="card" style="border-color:var(--primary-line)"><div class="card-head" style="background:linear-gradient(90deg,var(--primary-soft),#fff)"><div class="row"><div class="list-icon">' + icon('sheet') + '</div><div><h2>Συνολική βαθμολογία</h2><div class="sub">Α.Μ., ονοματεπώνυμο, βαθμός σε κάθε μάθημα (ο βαθμός re-exam όπου υπάρχει), μέσος όρος και αποτέλεσμα</div></div></div></div>';
      h += '<div class="card-body"><div class="grid grid-4' + (perOpts ? ' ex-grid-5' : '') + '">' +
        '<div class="field"><label>Ακαδημαϊκό έτος</label><select class="select" data-on-change="exSet" data-k="yearId">' + options(C.sortYears(db.years).map((y) => ({ value: y.id, label: y.label })), E.yearId) + '</select></div>' +
        '<div class="field"><label>Επίπεδο</label><select class="select" data-on-change="exSet" data-k="level">' + options([{ value: 'ALL', label: 'Όλα τα επίπεδα' }].concat(C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(db, l.id) }))), E.level) + '</select></div>' +
        (unifiedSel
          ? '<div class="field"><label>Ειδικότητα</label><input class="input" value="Deck & Engine μαζί" disabled /></div>'
          : '<div class="field"><label>Ειδικότητα</label><select class="select" data-on-change="exSet" data-k="spec">' + options([{ value: 'SPLIT', label: 'Deck & Engine (χωριστά φύλλα)' }, { value: 'DECK', label: 'Μόνο Deck' }, { value: 'ENGINE', label: 'Μόνο Engine' }], E.spec) + '</select></div>') +
        (sectionFilterOn()
          ? '<div class="field"><label>Τμήμα</label><select class="select" data-on-change="exSet" data-k="section">' + options([{ value: 'ALL', label: 'Όλα τα τμήματα' }].concat(C.levelSections(E.level).map((s) => ({ value: s.id, label: s.name }))).concat([{ value: 'NONE', label: 'Χωρίς τμήμα' }]), E.section) + '</select></div>'
          : '<div class="field"><label>Τμήμα</label><input class="input" value="Όλα τα τμήματα" disabled /></div>') +
        (perOpts ? '<div class="field"><label>Περίοδος</label><select class="select" id="ex-period" data-on-change="exSet" data-k="period">' + options(perOpts, curPeriod()) + '</select></div>' : '') +
        '</div><div class="row row-wrap" style="gap:20px;margin-top:16px">' +
        (sectionFilterOn() && E.section !== 'ALL' ? '' : chk('splitSections', splitLabel(perOpts), true)) +
        chk('includePercent', 'Στήλη ποσοστού (Μ.Ο. σε %)') + chk('includeStats', 'Στατιστικά ανά μάθημα') + chk('includeFather', 'Πατρώνυμο') +
        '</div></div>';
      h += '<div class="card-body" style="border-top:1px solid var(--border)"><div class="row"><span class="muted">' +
        (pc.students ? 'Θα δημιουργηθούν <b>' + plural(pc.sheets, 'φύλλο', 'φύλλα') + '</b> με <b>' + plural(pc.students, 'σπουδαστή', 'σπουδαστές') + '</b> και ' + plural(pc.grades, 'βαθμό', 'βαθμούς') + ' (+ φύλλο σύνοψης).' : '<span class="warning-text">Δεν υπάρχουν εγγεγραμμένοι σπουδαστές για αυτή την επιλογή.</span>') +
        '</span><div class="spacer"></div><button class="btn btn-primary btn-lg" data-action="exGrades"' + (pc.students ? '' : ' disabled') + '>' + icon('download') + 'Εξαγωγή σε Excel</button></div></div></div>';

      // ---------------- per subject
      const subjOpts = subjectChoices(E.sLevel);
      if (!subjOpts.some((o) => o.value === E.sSubject)) E.sSubject = subjOpts.length ? subjOpts[0].value : '';
      const subj = db.subjects.find((s) => s.id === E.sSubject);
      const groups = subj ? C.subjectRosterByClass(db, subj, E.yearId) : [];
      // a class = τμήμα + period, so the choice is the class key (a section id alone would mix periods)
      if (E.sSection !== 'ALL' && !groups.some((g) => g.key === E.sSection)) E.sSection = 'ALL';
      const chosen = E.sSection === 'ALL' ? groups : groups.filter((g) => g.key === E.sSection);
      const nStudents = chosen.reduce((a, g) => a + g.rows.length, 0);
      const nGraded = chosen.reduce((a, g) => a + g.rows.filter((x) => x.grade).length, 0);
      const inChosen = new Set();
      chosen.forEach((g) => g.rows.forEach((x) => inChosen.add(x.student.id)));
      const reList = subj ? C.reexamCandidates(db, subj, E.yearId).filter((x) => inChosen.has(x.student.id)) : [];
      h += '<div class="card" style="margin-top:16px"><div class="card-head"><div class="row"><div class="list-icon green">' + icon('download') + '</div><div><h2>Βαθμολογία μαθήματος</h2><div class="sub">Μόνο <b>Α.Μ.</b> και <b>βαθμός</b> (χωρίς ονόματα) — ένα φύλλο για κάθε τμήμα και ένα φύλλο «Re-exam» με όσους δεν πέρασαν</div></div></div></div>';
      h += '<div class="card-body"><div class="grid grid-3">' +
        '<div class="field"><label>Επίπεδο</label><select class="select" data-on-change="exSet" data-k="sLevel">' + options(C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(db, l.id) })), E.sLevel) + '</select></div>' +
        '<div class="field"><label>Μάθημα</label><select class="select" data-on-change="exSet" data-k="sSubject">' + (subjOpts.length ? options(subjOpts, E.sSubject) : '<option value="">— Δεν υπάρχουν μαθήματα —</option>') + '</select></div>' +
        '<div class="field"><label>Τμήμα</label><select class="select" id="ex-sclass" data-on-change="exSet" data-k="sSection">' + options([{ value: 'ALL', label: 'Όλα τα τμήματα (ένα φύλλο το καθένα)' }].concat(groups.map((g) => ({ value: g.key, label: g.name }))), E.sSection) + '</select></div>' +
        '</div>';
      if (subj && groups.length) {
        h += '<div class="chips" style="margin-top:14px">' + chosen.map((g) => {
          const n = g.rows.filter((x) => x.grade).length;
          return '<span class="chip" style="cursor:default"><span class="dot" style="background:' + (g.complete ? 'var(--primary)' : 'var(--warning)') + '"></span>' + esc(g.name) + ' <b>' + n + '/' + g.rows.length + '</b></span>';
        }).join('') +
          '<span class="chip ex-re-chip" style="cursor:default" title="Φύλλο «Re-exam»: ΑΠ, 0, 0Δ, 0Α"><span class="dot" style="background:var(--danger)"></span>Re-exam <b>' + reList.length + '</b></span></div>';
      }
      h += '</div><div class="card-body" style="border-top:1px solid var(--border)"><div class="row"><span class="muted">' +
        (!subj ? 'Επιλέξτε μάθημα.' : nStudents ? plural(chosen.length, 'φύλλο', 'φύλλα') + ' + «Re-exam» · ' + plural(nGraded, 'βαθμός', 'βαθμοί') + ' σε ' + plural(nStudents, 'σπουδαστή', 'σπουδαστές') : '<span class="warning-text">Δεν υπάρχουν σπουδαστές για το μάθημα στο ' + esc(C.yearLabel(db, E.yearId)) + '.</span>') +
        '</span><div class="spacer"></div><button class="btn btn-primary btn-lg" data-action="exSubject"' + (subj && nGraded ? '' : ' disabled') + '>' + icon('download') + 'Εξαγωγή βαθμολογίας μαθήματος</button></div></div></div>';

      // ---------------- transcripts
      h += '<div class="card" style="margin-top:16px"><div class="card-head"><div class="row"><div class="list-icon">' + icon('idcard') + '</div><div><h2>Αναλυτική βαθμολογία σπουδαστή</h2><div class="sub">Επιλέξτε τμήμα και μαθητή — τα μαθήματα σε στήλες, με το ακαδημαϊκό έτος που τα παρακολούθησε</div></div></div>' +
        '<button class="btn btn-primary" data-action="transcriptsModal">' + icon('download') + 'Αναλυτική σε Excel</button></div></div>';

      // ---------------- other
      h += '<div class="grid grid-3" style="margin-top:16px">';
      h += '<div class="card"><div class="card-head"><div><h3>Μητρώο σπουδαστών</h3><div class="sub">Α.Μ., στοιχεία, τμήμα ανά έτος</div></div></div><div class="card-body stack">' +
        '<div class="seg"><button class="' + (E.regScope === 'year' ? 'on' : '') + '" data-action="exReg" data-v="year">Εγγεγραμμένοι ' + esc(C.yearLabel(db, E.yearId)) + '</button><button class="' + (E.regScope === 'all' ? 'on' : '') + '" data-action="exReg" data-v="all">Όλο το μητρώο</button></div>' +
        '<div><button class="btn" data-action="exRegistry">' + icon('download') + 'Εξαγωγή μητρώου</button></div></div></div>';
      h += '<div class="card"><div class="card-head"><div><h3>Πρότυπο για καθηγητή</h3><div class="sub">Λίστα Α.Μ. ανά μάθημα και τμήμα</div></div></div><div class="card-body stack"><p class="small muted" style="margin:0">Ο καθηγητής συμπληρώνει μόνο τη στήλη «Βαθμός» και το αρχείο εισάγεται ξανά χωρίς καμία αλλαγή.</p><div><button class="btn" data-action="gbTemplates">' + icon('sheet') + 'Δημιουργία προτύπου</button></div></div></div>';
      h += '<div class="card"><div class="card-head"><div><h3>Πρότυπο σπουδαστών</h3><div class="sub">Κενό Excel για εισαγωγή νέων σπουδαστών</div></div></div><div class="card-body stack"><p class="small muted" style="margin:0">Στήλες: Α.Μ., Επώνυμο, Όνομα, Πατρώνυμο, Ειδικότητα, Επίπεδο, Τμήμα, Περίοδος, Email, Τηλέφωνο.</p><div><button class="btn" data-action="dlStudentTemplate">' + icon('download') + 'Κατέβασμα προτύπου</button></div></div></div>';
      h += '</div>';
      h += '</div>';
      return h;
    },
  };

  /** «Ένα φύλλο για κάθε τμήμα» — «… και περίοδο» when levels with periods are split by period too. */
  function splitLabel(perOpts) {
    const { db } = S();
    const byPeriod = E.level === 'ALL' ? C.LEVEL_IDS.some((l) => C.levelPeriods(db, l).length >= 2) : !!perOpts && curPeriod() === 'ALL';
    return byPeriod ? 'Ένα φύλλο για κάθε τμήμα και περίοδο' : 'Ένα φύλλο για κάθε τμήμα';
  }

  function chk(k, label, rerender) {
    return '<label class="checkbox"><input type="checkbox" data-on-change="' + (rerender ? 'exChkR' : 'exChk') + '" data-k="' + k + '"' + (E[k] ? ' checked' : '') + ' /> ' + esc(label) + '</label>';
  }

  App.changes.exSet = (el) => {
    const k = el.dataset.k;
    E[k] = el.value;
    if (k === 'level') {
      E.section = 'ALL';
      E.period = 'ALL';
    }
    if (k === 'sLevel') {
      E.sSubject = '';
      E.sSection = 'ALL';
    }
    if (k === 'sSubject') E.sSection = 'ALL';
    App.render();
  };
  App.changes.exChk = (el) => {
    E[el.dataset.k] = el.checked;
  };
  App.changes.exChkR = (el) => {
    E[el.dataset.k] = el.checked;
    App.render();
  };
  App.actions.exReg = (el) => {
    E.regScope = el.dataset.v;
    App.render();
  };

  App.actions.exGrades = async () => {
    const { db } = S();
    const o = exportOpts();
    const r = window.XL.buildGradeExport(db, o);
    if (!r.studentsWritten) return toast('Δεν υπάρχουν σπουδαστές για εξαγωγή.', 'warn');
    let name = 'Συνολική_Βαθμολογία_' + C.yearLabel(db, E.yearId);
    if (E.level !== 'ALL') {
      const specOn = (E.spec === 'DECK' || E.spec === 'ENGINE') && !C.isUnifiedLevel(E.level);
      const per = o.period !== 'ALL' && o.period !== 'NONE' ? C.classPeriod(db, E.level, o.period) : null;
      if (o.section !== 'ALL' && o.section !== 'NONE') name += '_' + C.classShortName(E.level, specOn ? E.spec : null, o.section, per);
      else name += '_' + C.levelShort(E.level, specOn ? E.spec : null) + (specOn && !C.isSplitLevel(E.level) ? '_' + C.specialtyName(E.spec) : '') + (per ? '_' + C.periodShort(per) : '');
      if (o.period === 'NONE') name += '_χωρίς_περίοδο';
    } else if (E.spec === 'DECK' || E.spec === 'ENGINE') name += '_' + C.specialtyName(E.spec);
    await App.saveWorkbook(r.wb, window.XL.fileSafe(name) + '.xlsx');
  };

  App.actions.exSubject = async () => {
    if (!E.sSubject) return;
    await App.exportSubject(E.sSubject, E.yearId, E.sSection);
  };

  // ---------------- detailed transcript of ONE student: fields «Τμήμα» + «Μαθητής»
  App.transcriptsModal = function (preset) {
    const p = preset || {};
    const { db, yearId } = S();
    const classes = C.transcriptClasses(db);
    const byKey = new Map(classes.map((c) => [c.key, c]));
    const ids = (p.studentIds || []).filter((id) => db.students.some((s) => s.id === id));
    const selected = ids.length > 1 ? C.sortStudents(db.students.filter((s) => ids.includes(s.id))) : null;
    const T = { cls: '', student: '', filter: '', others: false };

    function classOfStudent(st) {
      // prefer the class of the open year, else his latest enrollment
      let en = C.getEnrollment(db, st.id, yearId);
      if (!en) {
        const list = db.enrollments.filter((e) => e.studentId === st.id).sort((a, b) => C.yearStart(db, b.yearId) - C.yearStart(db, a.yearId));
        en = list[0] || null;
      }
      if (!en) return '__all';
      // the class incl. its period (e.g. "SUP||M1|JAN") — same key as C.transcriptClasses
      const cls = C.studentClass(db, st, en.yearId, en);
      return cls && byKey.has(cls.key) ? cls.key : '__all';
    }
    if (ids.length === 1) {
      const st = db.students.find((s) => s.id === ids[0]);
      T.cls = classOfStudent(st);
      T.student = st.id;
    } else if (selected) T.cls = '__sel';

    function studentsOfClass() {
      if (T.cls === '__all') return C.sortStudents(db.students.slice()).map((st) => ({ student: st, years: null }));
      if (T.cls === '__sel') return selected.map((st) => ({ student: st, years: null }));
      const c = byKey.get(T.cls);
      return c ? c.students : [];
    }

    function levelIdsFor() {
      const c = byKey.get(T.cls);
      if (!c || T.others) return null; // every level he attended
      return [c.levelId];
    }

    function classSelect() {
      let h = '<select class="select" data-tt="cls" id="tt-cls"><option value="">— Επιλέξτε τμήμα —</option>';
      if (selected) h += '<option value="__sel"' + (T.cls === '__sel' ? ' selected' : '') + '>Επιλεγμένοι από το Μητρώο (' + selected.length + ')</option>';
      let group = null;
      classes.forEach((c) => {
        const gl = C.isShiftLevel(c.levelId) ? 'Management' : C.isUnifiedLevel(c.levelId) ? 'Support' : C.levelName(db, c.levelId);
        if (gl !== group) {
          if (group !== null) h += '</optgroup>';
          h += '<optgroup label="' + esc(gl) + '">';
          group = gl;
        }
        h += '<option value="' + esc(c.key) + '"' + (T.cls === c.key ? ' selected' : '') + '>' + esc(c.name) + ' (' + c.students.length + ')</option>';
      });
      if (group !== null) h += '</optgroup>';
      h += '<option value="__all"' + (T.cls === '__all' ? ' selected' : '') + '>Όλοι οι σπουδαστές του μητρώου</option>';
      return h + '</select>';
    }

    function studentSelect() {
      const list = studentsOfClass();
      const f = C.normText(T.filter);
      const shown = f ? list.filter((x) => C.normText(x.student.am + ' ' + C.studentName(x.student)).includes(f) || x.student.id === T.student) : list;
      let h = '<select class="select" data-tt="student" id="tt-student"' + (T.cls ? '' : ' disabled') + '><option value="">' + (T.cls ? '— Επιλέξτε σπουδαστή (' + shown.length + ') —' : '— Επιλέξτε πρώτα τμήμα —') + '</option>';
      shown.forEach((x) => {
        const yl = x.years ? '   ·   ' + x.years.map((id) => C.yearLabel(db, id)).join(', ') : '';
        h += '<option value="' + esc(x.student.id) + '"' + (T.student === x.student.id ? ' selected' : '') + '>' + esc(x.student.am + ' — ' + C.studentName(x.student) + yl) + '</option>';
      });
      if (T.cls && T.cls !== '__all' && list.length > 1) h += '<option value="__each"' + (T.student === '__each' ? ' selected' : '') + '>Όλοι οι σπουδαστές του τμήματος (' + list.length + ') — ξεχωριστό αρχείο για τον καθένα</option>';
      return h + '</select>';
    }

    function preview() {
      if (!T.cls) return '<div class="small muted">Επιλέξτε τμήμα και σπουδαστή. Το Excel θα περιέχει μόνο την αναλυτική του σπουδαστή (Α.Μ. και ονοματεπώνυμο), με τα μαθήματα σε στήλες.</div>';
      if (!T.student) return '<div class="small muted">Επιλέξτε σπουδαστή από τη λίστα.</div>';
      if (T.student === '__each') {
        const n = studentsOfClass().length;
        return '<div class="callout">' + icon('folder') + '<p>Θα δημιουργηθούν <b>' + n + '</b> ξεχωριστά αρχεία Excel (ένα για κάθε σπουδαστή) — θα ζητηθεί ο φάκελος αποθήκευσης.</p></div>';
      }
      const st = db.students.find((s) => s.id === T.student);
      if (!st) return '';
      const lv = levelIdsFor() || C.studentLevels(db, st);
      const recs = lv.map((l) => C.studentLevelRecord(db, st, l)).filter((r) => r.years.length);
      if (!recs.length) return '<div class="callout warn">' + icon('alert') + '<p>Δεν υπάρχουν εγγραφές ή βαθμοί για τον σπουδαστή.</p></div>';
      let h = '<div class="small muted" style="margin-bottom:6px">Περιεχόμενο αρχείου για <b>' + esc(st.am) + ' — ' + esc(C.studentName(st)) + '</b>:</div><table class="table"><thead><tr><th>Τμήμα / επίπεδο</th><th>Ακαδημαϊκό έτος</th><th class="num">Μαθήματα</th><th class="num">Βαθμοί</th><th>Αποτέλεσμα</th></tr></thead><tbody>';
      recs.forEach((r) => {
        const graded = r.subjects.filter((x) => x.grade).length;
        const name = r.years.length > 1 || C.isShiftLevel(r.levelId) ? C.levelName(db, r.levelId, r.spec) : r.className;
        h += '<tr><td class="strong">' + esc(name) + '</td><td>' + esc(r.years.map((id) => C.yearLabel(db, id)).join(', ')) + (r.years.length > 1 ? ' <span class="badge badge-info">επανεγγραφή</span>' : '') + '</td><td class="num">' + r.subjects.length + '</td><td class="num">' + graded + '</td><td>' + (r.withdrawn ? '<span class="badge badge-warning">Διέκοψε</span>' : r.result ? esc(C.resultLabel(r.result)) : '—') + '</td></tr>';
      });
      return h + '</tbody></table>';
    }

    function body() {
      const c = byKey.get(T.cls);
      return '<div class="grid grid-2">' +
        '<div class="field"><label>Τμήμα</label>' + classSelect() + '</div>' +
        '<div class="field"><label>Μαθητής</label>' + studentSelect() + '</div>' +
        '</div>' +
        '<div class="row" style="margin-top:10px;gap:14px">' +
        '<input class="input" id="tt-filter" placeholder="Αναζήτηση σπουδαστή (Α.Μ. ή όνομα)…" value="' + esc(T.filter) + '" style="max-width:320px"' + (T.cls ? '' : ' disabled') + ' />' +
        (c ? '<label class="checkbox"><input type="checkbox" data-tt="others"' + (T.others ? ' checked' : '') + ' /> Να περιληφθούν και τα άλλα επίπεδα του σπουδαστή</label>' : '') +
        '</div>' +
        '<div id="tt-preview" style="margin-top:16px">' + preview() + '</div>';
    }

    let ctxRef = null;
    const redraw = (focusFilter) => {
      ctxRef.q('#tt-body').innerHTML = body();
      if (focusFilter) {
        const f = ctxRef.q('#tt-filter');
        f.focus();
        f.setSelectionRange(f.value.length, f.value.length);
      }
    };
    openModal({
      title: 'Αναλυτική βαθμολογία σπουδαστή',
      sub: 'Excel με τα μαθήματα σε στήλες — τα ακαδημαϊκά έτη προκύπτουν αυτόματα από το ιστορικό του σπουδαστή',
      size: 'lg',
      body: '<div id="tt-body"></div>',
      onMount(ctx) {
        ctxRef = ctx;
        redraw();
        ctx.el.addEventListener('change', (e) => {
          const k = e.target.dataset.tt;
          if (!k) return;
          if (k === 'others') T.others = e.target.checked;
          else T[k] = e.target.value;
          if (k === 'cls') {
            T.filter = '';
            const list = studentsOfClass();
            if (!list.some((x) => x.student.id === T.student)) T.student = list.length === 1 ? list[0].student.id : '';
          }
          redraw();
        });
        ctx.el.addEventListener('input', (e) => {
          if (e.target.id !== 'tt-filter') return;
          T.filter = e.target.value;
          const list = studentsOfClass();
          const f = C.normText(T.filter);
          const hits = f ? list.filter((x) => C.normText(x.student.am + ' ' + C.studentName(x.student)).includes(f)) : [];
          if (hits.length === 1) T.student = hits[0].student.id;
          redraw(true);
        });
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εξαγωγή σε Excel',
          cls: 'btn-primary',
          icon: 'download',
          id: 'tt-go',
          onClick: async () => {
            if (!T.cls) throw new Error('Επιλέξτε τμήμα.');
            if (!T.student) throw new Error('Επιλέξτε σπουδαστή.');
            const levelIds = levelIdsFor();
            if (T.student === '__each') {
              const c = byKey.get(T.cls);
              const files = [];
              for (const x of studentsOfClass()) {
                const r = window.XL.buildTranscript(db, x.student, { levelIds });
                files.push({ name: window.XL.transcriptFileName(db, x.student, levelIds), data: await window.XL.toBytes(r.wb) });
              }
              const res = await window.api.saveFilesToFolder({ title: 'Φάκελος για τις αναλυτικές', subfolder: window.XL.fileSafe('Αναλυτικές_' + (c ? c.name : 'σπουδαστές')), files });
              if (!res) return false;
              toast('Αποθηκεύτηκαν <b>' + res.count + '</b> αρχεία στον φάκελο <b>' + esc(res.path) + '</b>', 'success', { action: { label: 'Άνοιγμα', onClick: () => window.api.openPath(res.path) }, duration: 9000 });
              return;
            }
            const st = db.students.find((s) => s.id === T.student);
            if (!st) throw new Error('Ο σπουδαστής δεν βρέθηκε.');
            const r = window.XL.buildTranscript(db, st, { levelIds });
            const saved = await App.saveWorkbook(r.wb, window.XL.transcriptFileName(db, st, levelIds));
            if (!saved) return false;
          },
        },
      ],
    });
  };
  App.actions.transcriptsModal = () => App.transcriptsModal({});

  App.actions.exRegistry = async () => {
    const { db } = S();
    const r = window.XL.buildRegistryExport(db, { yearId: E.regScope === 'year' ? E.yearId : null });
    await App.saveWorkbook(r.wb, E.regScope === 'year' ? 'Μητρώο_' + C.yearLabel(db, E.yearId) + '.xlsx' : 'Μητρώο_πλήρες.xlsx');
  };
})();
