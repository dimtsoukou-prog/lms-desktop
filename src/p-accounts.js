/* Accounts: student logins created from the registry (username = Α.Μ.) and admin accounts. */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, fmtDate, plural, options, toast, openModal, confirmDialog, emptyState } = App.ui;
  const Remote = window.Remote;
  const S = () => App.S;

  // users: cached Remote.users() (shared with the Subjects page: «Καθηγητές» column and modal)
  // at: when it was loaded · tried: last attempt (no retry storm while the server is unreachable) · gen: session
  const A = { tab: 'students', cls: 'YEAR', q: '', users: null, loading: false, error: '', selected: new Set(), at: 0, tried: 0, pending: null, gen: 0 };

  /** (Re)load the accounts from the server; concurrent calls share one request. Never throws (error → A.error). */
  function loadUsers() {
    if (A.pending) return A.pending;
    const gen = A.gen;
    A.loading = true;
    A.tried = Date.now();
    A.pending = (async () => {
      try {
        const list = await Remote.users();
        if (gen !== A.gen) return; // logged out meanwhile
        A.users = list;
        A.at = Date.now();
        A.error = '';
      } catch (e) {
        if (gen === A.gen) A.error = e.message;
      } finally {
        if (gen === A.gen) {
          A.loading = false;
          A.pending = null;
        }
      }
    })();
    return A.pending;
  }

  /** Classes of the working year: [{key, levelId, spec, section, period, name, students:[student]}] — classes of different periods stay separate. */
  function yearClasses() {
    const { db, yearId } = S();
    const byId = new Map(db.students.map((s) => [s.id, s]));
    const map = new Map();
    db.enrollments.forEach((en) => {
      if (en.yearId !== yearId) return;
      const st = byId.get(en.studentId);
      if (!st) return;
      const sc = C.studentClass(db, st, yearId, en);
      if (!sc) return;
      if (!map.has(sc.key))
        map.set(sc.key, {
          key: sc.key,
          levelId: sc.levelId,
          spec: sc.spec,
          section: sc.section,
          period: C.classPeriod(db, sc.levelId, sc.period),
          name: sc.name + (sc.section || C.isShiftLevel(sc.levelId) ? '' : ' (χωρίς τμήμα)'),
          students: [],
        });
      map.get(sc.key).students.push(st);
    });
    const out = Array.from(map.values());
    out.sort(
      (a, b) =>
        C.LEVEL_IDS.indexOf(a.levelId) - C.LEVEL_IDS.indexOf(b.levelId) ||
        String(a.spec || '').localeCompare(String(b.spec || '')) ||
        C.periodIndex(a.period) - C.periodIndex(b.period) ||
        C.sectionIndex(a.levelId, a.section) - C.sectionIndex(b.levelId, b.section)
    );
    out.forEach((c) => C.sortStudents(c.students));
    return out;
  }
  App.yearClasses = yearClasses;

  function classNameOf(st) {
    const { db, yearId } = S();
    const sc = C.studentClass(db, st, yearId);
    return sc ? sc.name : '';
  }
  App.classNameOf = classNameOf;

  // ------------------------------------------------------------ teaching assignments (shared with the Subjects page)
  /**
   * Row editor pieces for {yearId, subjectId, spec, section, period} assignments — the Accounts modal
   * (rows: subject · class · period) and the Subjects page modal (rows: teacher · class · period) use the same ones.
   * A row keeps the class as "spec|section" and the period as '' (all periods) or a period id.
   */
  const TA = {
    /** Every stored assignment field in one comparable key. */
    key: (a) => [a.yearId, a.subjectId, a.spec || '', a.section || '', a.period || ''].join('|'),
    /** The first class option of a subject ("spec|section"). */
    firstCls(db, sj) {
      const o = sj ? C.teachingClassOptions(db, sj)[0] : null;
      return o ? o.spec + '|' + o.section : '';
    },
    /** Period options of a row: [] when the select is hidden (the level has ≤ 1 period). */
    periodOptions(db, sj, period) {
      const opts = sj ? C.teachingPeriodOptions(db, sj) : [];
      // a stored period the level no longer has stays visible (and selectable) so it is not dropped silently
      if (period && !opts.some((o) => o.period === period)) return (opts.length ? opts : [{ period: '', label: 'Όλες οι περίοδοι' }]).concat([{ period, label: C.periodName(period) + ' (δεν ισχύει πια)' }]);
      return opts.length > 2 ? opts : [];
    },
    /** A row → an assignment (label = C.assignmentLabel). */
    make(db, yearId, subjectId, cls, period) {
      const [spec, section] = String(cls || '|').split('|');
      const a = { yearId, subjectId, spec: spec || '', section: section || '', period: period || '' };
      a.label = C.assignmentLabel(db, a);
      return a;
    },
    /** <option>s of the classes of a subject, with the number of students (for the row's period). */
    clsOptionsHtml(db, yearId, sj, sel, period) {
      if (!sj) return '<option value="">— Τμήμα —</option>';
      return C.teachingClassOptions(db, sj)
        .map((o) => {
          const v = o.spec + '|' + o.section;
          const n = C.assignmentStudents(db, { yearId, subjectId: sj.id, spec: o.spec, section: o.section, period: period || '' }).length;
          return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(o.label) + ' (' + n + ')</option>';
        })
        .join('');
    },
    /** The period cell of a row: a select (with the number of students of the row's class) or a dash. */
    periodCellHtml(db, yearId, sj, cls, period, attrs) {
      const opts = TA.periodOptions(db, sj, period);
      if (!opts.length) return '<div class="ta-noperiod" title="Το επίπεδο δεν χωρίζεται σε περιόδους">—</div>';
      const [spec, section] = String(cls || '|').split('|');
      return '<select class="select ta-period" ' + attrs + '>' +
        opts
          .map((o) => {
            const n = C.assignmentStudents(db, { yearId, subjectId: sj.id, spec: spec || '', section: section || '', period: o.period }).length;
            return '<option value="' + esc(o.period) + '"' + (o.period === (period || '') ? ' selected' : '') + '>' + esc(o.label) + ' (' + n + ')</option>';
          })
          .join('') +
        '</select>';
    },
    /** Same set of assignments (order does not matter)? */
    sameSet(a, b) {
      const ka = Array.from(new Set(a.map(TA.key))).sort();
      const kb = Array.from(new Set(b.map(TA.key))).sort();
      return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
    },
  };
  App.teacherAssign = TA;

  function accountMap() {
    const m = new Map();
    (A.users || []).forEach((u) => u.role === 'student' && m.set(String(u.am || u.username).toUpperCase(), u));
    return m;
  }
  const amKey = (am) => String(am || '').trim().replace(/\s+/g, '').toUpperCase();

  function studentRows() {
    const { db } = S();
    let list;
    if (A.cls === 'ALL') list = C.sortStudents(db.students.slice());
    else if (A.cls === 'YEAR') {
      list = [];
      yearClasses().forEach((c) => c.students.forEach((s) => list.push(s)));
    } else {
      const c = yearClasses().find((x) => x.key === A.cls);
      list = c ? c.students.slice() : [];
    }
    const f = C.normText(A.q);
    if (f) list = list.filter((s) => C.normText(s.am + ' ' + C.studentName(s)).includes(f));
    return list;
  }

  function pill(u) {
    if (!u) return '<span class="pill-state">Χωρίς λογαριασμό</span>';
    if (!u.active) return '<span class="pill-state bad">Ανενεργός</span>';
    return '<span class="pill-state ok">' + icon('check', 'width="12" height="12"') + 'Ενεργός</span>';
  }

  function studentsHtml() {
    const { db } = S();
    const acc = accountMap();
    const rows = studentRows();
    const classes = yearClasses();
    const sel = rows.filter((s) => A.selected.has(s.id));
    const withAcc = rows.filter((s) => acc.has(amKey(s.am))).length;
    let h = '<div class="card"><div class="card-head"><div class="row row-wrap" style="gap:10px">' +
      '<select class="select" data-on-change="acClass" style="min-width:260px">' + options([{ value: 'YEAR', label: 'Εγγεγραμμένοι ' + C.yearLabel(db, S().yearId) }].concat(classes.map((c) => ({ value: c.key, label: c.name + ' (' + c.students.length + ')' }))).concat([{ value: 'ALL', label: 'Όλο το μητρώο' }]), A.cls) + '</select>' +
      '<input class="input" id="ac-q" placeholder="Αναζήτηση Α.Μ. ή ονόματος…" value="' + esc(A.q) + '" data-on-input="acSearch" style="width:240px" />' +
      '<span class="small muted">' + plural(rows.length, 'σπουδαστής', 'σπουδαστές') + ' · ' + withAcc + ' με λογαριασμό</span></div>' +
      '<div class="row"><button class="btn btn-primary" data-action="acCreate"' + (sel.length ? '' : ' disabled') + '>' + icon('key') + 'Δημιουργία λογαριασμών' + (sel.length ? ' (' + sel.length + ')' : '') + '</button>' +
      '<button class="btn" data-action="acReset"' + (sel.some((s) => acc.has(amKey(s.am))) ? '' : ' disabled') + '>' + icon('refresh') + 'Νέοι κωδικοί</button></div></div>';
    if (!rows.length) h += '<div class="card-body">' + emptyState('users', 'Δεν βρέθηκαν σπουδαστές', 'Αλλάξτε το φίλτρο ή το ακαδημαϊκό έτος.') + '</div>';
    else {
      const all = rows.every((s) => A.selected.has(s.id));
      h += '<div class="table-wrap" style="max-height:calc(100vh - 300px)"><table class="table"><thead><tr><th style="width:34px"><input type="checkbox" data-on-change="acAll"' + (all ? ' checked' : '') + ' /></th><th>Α.Μ.</th><th>Ονοματεπώνυμο</th><th>Τμήμα ' + esc(C.yearLabel(db, S().yearId)) + '</th><th>Λογαριασμός</th><th>Τελευταία σύνδεση</th><th></th></tr></thead><tbody>';
      rows.forEach((s) => {
        const u = acc.get(amKey(s.am));
        h += '<tr><td><input type="checkbox" data-on-change="acSel" data-id="' + s.id + '"' + (A.selected.has(s.id) ? ' checked' : '') + ' /></td><td class="am">' + esc(s.am) + '</td><td class="strong">' + esc(C.studentName(s)) + '</td><td class="small">' + esc(classNameOf(s)) + '</td><td>' + pill(u) + '</td>' +
          '<td class="small muted">' + (u && u.lastLogin ? fmtDate(u.lastLogin, true) : '—') + '</td><td class="right nowrap">' +
          (u ? '<button class="btn btn-sm btn-ghost" data-action="acOneReset" data-uid="' + u.id + '" title="Νέος κωδικός">' + icon('key') + '</button>' +
            '<button class="btn btn-sm btn-ghost" data-action="acToggle" data-uid="' + u.id + '" title="' + (u.active ? 'Απενεργοποίηση' : 'Ενεργοποίηση') + '">' + icon(u.active ? 'lock' : 'check') + '</button>' +
            '<button class="btn btn-sm btn-ghost btn-icon" data-action="acDelete" data-uid="' + u.id + '" title="Διαγραφή λογαριασμού">' + icon('trash') + '</button>' : '') +
          '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    // accounts whose Α.Μ. is no longer in the registry
    const known = new Set(db.students.map((s) => amKey(s.am)));
    const orphans = (A.users || []).filter((u) => u.role === 'student' && !known.has(amKey(u.am || u.username)));
    if (orphans.length)
      h += '<div class="card-body" style="border-top:1px solid var(--border)"><div class="small muted">Λογαριασμοί χωρίς σπουδαστή στο μητρώο: ' + orphans.map((u) => '<span class="chip" style="cursor:default">' + esc(u.username) + ' <button class="link" data-action="acDelete" data-uid="' + u.id + '">διαγραφή</button></span>').join(' ') + '</div></div>';
    return h + '</div>';
  }

  // ------------------------------------------------------------ teachers
  /** "NAV101 Ναυσιπλοΐα — Support Morning 1 – Οκτώβριος" */
  function assignmentLabel(a) {
    const { db } = S();
    const sj = db.subjects.find((x) => x.id === a.subjectId);
    if (!sj) return '(διαγραμμένο μάθημα)' + (a.label ? ' — ' + a.label : '');
    return C.subjectLabel(sj) + ' — ' + C.assignmentLabel(db, a);
  }

  function teachersHtml() {
    const { db, yearId } = S();
    const list = (A.users || []).filter((u) => u.role === 'teacher');
    let h = '<div class="card"><div class="card-head"><div><h3>Καθηγητές</h3><div class="sub">Κάθε καθηγητής βλέπει μόνο τα μαθήματα και τα τμήματα που του αναθέτετε, και περνά ο ίδιος τη βαθμολογία τους (Excel ή με το χέρι). Οι βαθμοί του εμφανίζονται αμέσως στο Βαθμολόγιο.</div></div>' +
      '<button class="btn btn-primary" data-action="acNewTeacher" id="ac-new-teacher">' + icon('plus') + 'Νέος καθηγητής</button></div>';
    if (!list.length) return h + '<div class="card-body">' + emptyState('book', 'Δεν υπάρχουν καθηγητές', 'Δημιουργήστε λογαριασμό καθηγητή και αναθέστε του μαθήματα και τμήματα.') + '</div></div>';
    h += '<table class="table"><thead><tr><th>Όνομα χρήστη</th><th>Ονοματεπώνυμο</th><th>Μαθήματα ' + esc(C.yearLabel(db, yearId)) + '</th><th>Κατάσταση</th><th>Τελευταία σύνδεση</th><th></th></tr></thead><tbody>';
    list.forEach((u) => {
      const mine = (u.assignments || []).filter((a) => a.yearId === yearId);
      const others = (u.assignments || []).length - mine.length;
      h += '<tr><td class="strong mono">' + esc(u.username) + '</td><td>' + esc(u.name) + '</td><td class="small">' +
        (mine.length ? mine.map((a) => '<div>' + (C.gradeLock(db, a.yearId, a.subjectId) ? icon('lock', 'width="12" height="12" style="vertical-align:-1px;color:var(--warning)"') + ' ' : '') + esc(assignmentLabel(a)) + '</div>').join('') : '<span class="faint">—</span>') +
        (others ? '<div class="faint">+ ' + others + ' σε άλλα έτη</div>' : '') + '</td><td>' + pill(u) + '</td><td class="small muted">' + (u.lastLogin ? fmtDate(u.lastLogin, true) : '—') + '</td>' +
        '<td class="right nowrap"><button class="btn btn-sm" data-action="acTeacherAssign" data-uid="' + u.id + '">' + icon('book') + 'Μαθήματα</button>' +
        '<button class="btn btn-sm btn-ghost" data-action="acOneReset" data-uid="' + u.id + '" title="Νέος κωδικός">' + icon('key') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-action="acToggle" data-uid="' + u.id + '" title="' + (u.active ? 'Απενεργοποίηση' : 'Ενεργοποίηση') + '">' + icon(u.active ? 'lock' : 'check') + '</button>' +
        '<button class="btn btn-sm btn-ghost btn-icon" data-action="acDelete" data-uid="' + u.id + '" title="Διαγραφή">' + icon('trash') + '</button></td></tr>';
    });
    return h + '</tbody></table></div><p class="small muted" style="margin-top:10px">' + icon('lock', 'width="12" height="12" style="vertical-align:-1px"') + ' Όταν ολοκληρωθεί η βαθμολογία ενός μαθήματος, κλειδώστε την από τα <b>Μαθήματα</b> — ο καθηγητής δεν θα μπορεί πια να την αλλάξει.</p>';
  }

  App.actions.acNewTeacher = () => {
    openModal({
      title: 'Νέος καθηγητής',
      size: 'sm',
      body: '<div class="stack"><div class="field"><label>Όνομα χρήστη</label><input class="input" id="nt-user" placeholder="π.χ. papadopoulos" autofocus /><div class="hint">Λατινικοί χαρακτήρες ή αριθμοί (τουλάχιστον 3).</div></div>' +
        '<div class="field"><label>Ονοματεπώνυμο</label><input class="input" id="nt-name" /></div>' +
        '<div class="field"><label>Κωδικός</label><input class="input" id="nt-pass" /><div class="hint">Τουλάχιστον 6 χαρακτήρες — δώστε τον στον καθηγητή.</div></div></div>',
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Δημιουργία',
          cls: 'btn-primary',
          id: 'nt-go',
          onClick: async (ctx) => {
            const u = await Remote.createTeacher({ username: ctx.q('#nt-user').value.trim(), name: ctx.q('#nt-name').value.trim(), password: ctx.q('#nt-pass').value });
            await loadUsers();
            rerender();
            toast('Ο καθηγητής δημιουργήθηκε — αναθέστε του μαθήματα');
            setTimeout(() => App.actions.acTeacherAssign({ dataset: { uid: String(u.id) } }), 50);
          },
        },
      ],
    });
  };

  /** Subjects + classes (+ period) of a teacher for the working year (other years are kept as they are). */
  App.actions.acTeacherAssign = (el) => {
    const { db, yearId } = S();
    const u = (A.users || []).find((x) => String(x.id) === String(el.dataset.uid));
    if (!u) return;
    const rows = (u.assignments || []).filter((a) => a.yearId === yearId).map((a) => ({ subjectId: a.subjectId, cls: (a.spec || '') + '|' + (a.section || ''), period: a.period || '', label: a.label || '' }));
    const subjectOf = (id) => db.subjects.find((x) => x.id === id) || null;
    const subjOptions = (sel) => {
      let h = '<option value="">— Μάθημα —</option>';
      C.LEVELS.forEach((l) => {
        const list = C.subjectsOfLevel(db, l.id).filter((x) => x.active !== false || x.id === sel);
        if (!list.length) return;
        h += '<optgroup label="' + esc(C.levelName(db, l.id)) + '">' + list.map((x) => '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(C.subjectLabel(x) + (x.specialty !== 'COMMON' && !C.isUnifiedLevel(l.id) ? ' (' + C.specialtyName(x.specialty) + ')' : '')) + '</option>').join('') + '</optgroup>';
      });
      // an assignment of a deleted subject stays visible so that it can be removed
      if (sel && !subjectOf(sel)) h += '<option value="' + esc(sel) + '" selected>(διαγραμμένο μάθημα)</option>';
      return h;
    };
    const body = () =>
      '<div class="small muted" style="margin-bottom:12px">Ακαδημαϊκό έτος <b>' + esc(C.yearLabel(db, yearId)) + '</b> — σε παρένθεση ο αριθμός σπουδαστών. Με περίοδο ο καθηγητής βλέπει μόνο τους σπουδαστές εκείνης της περιόδου.</div>' +
      (rows.length
        ? '<div class="ta-grid"><div class="ta-h">Μάθημα</div><div class="ta-h">Τμήμα</div><div class="ta-h">Περίοδος</div><div></div>' +
          rows
            .map((r, i) => {
              const sj = subjectOf(r.subjectId);
              return '<select class="select" data-ta="subject" data-i="' + i + '">' + subjOptions(r.subjectId) + '</select>' +
                '<select class="select" data-ta="cls" data-i="' + i + '"' + (sj ? '' : ' disabled') + '>' + TA.clsOptionsHtml(db, yearId, sj, r.cls, r.period) + '</select>' +
                TA.periodCellHtml(db, yearId, sj, r.cls, r.period, 'data-ta="period" data-i="' + i + '"') +
                '<button class="btn btn-ghost btn-icon" data-ta-del="' + i + '" title="Αφαίρεση">' + icon('x') + '</button>';
            })
            .join('') +
          '</div>'
        : '<div class="muted small" style="margin:8px 0 12px">Δεν έχουν ανατεθεί μαθήματα.</div>') +
      '<button class="btn btn-sm" id="ta-add" style="margin-top:12px">' + icon('plus') + 'Μάθημα</button>';
    openModal({
      title: 'Μαθήματα καθηγητή: ' + u.name,
      sub: 'Ο καθηγητής βλέπει μόνο αυτά τα μαθήματα και μόνο τους σπουδαστές αυτών των τμημάτων',
      size: 'xl',
      body: '<div id="ta-body"></div>',
      onMount(ctx) {
        const paint = () => (ctx.q('#ta-body').innerHTML = body());
        paint();
        ctx.el.addEventListener('change', (e) => {
          const t = e.target;
          if (!t.dataset.ta) return;
          const r = rows[Number(t.dataset.i)];
          if (t.dataset.ta === 'subject') {
            r.subjectId = t.value;
            r.cls = TA.firstCls(db, subjectOf(r.subjectId));
            r.period = '';
          } else if (t.dataset.ta === 'cls') r.cls = t.value;
          else r.period = t.value;
          paint(); // the numbers of students follow the class / period
        });
        ctx.el.addEventListener('click', (e) => {
          if (e.target.closest('#ta-add')) {
            rows.push({ subjectId: '', cls: '', period: '' });
            paint();
          }
          const d = e.target.closest('[data-ta-del]');
          if (d) {
            rows.splice(Number(d.dataset.taDel), 1);
            paint();
          }
        });
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Αποθήκευση',
          cls: 'btn-primary',
          id: 'ta-save',
          onClick: async () => {
            const list = rows.filter((r) => r.subjectId).map((r) => {
              const a = TA.make(db, yearId, r.subjectId, r.cls, r.period);
              if (!a.label && r.label) a.label = r.label; // deleted subject: keep what it was
              return a;
            });
            // the teacher's other years as they are on the server now (another PC may have changed them)
            const fresh = (await Remote.users()).find((x) => x.id === u.id);
            if (!fresh) throw new Error('Ο λογαριασμός του καθηγητή δεν υπάρχει πια.');
            const keep = (fresh.assignments || []).filter((a) => a.yearId !== yearId);
            await Remote.setTeacherAssignments(u.id, keep.concat(list));
            await loadUsers();
            App.render(); // the Accounts / Subjects page shows the new classes
            toast('Τα μαθήματα του καθηγητή αποθηκεύτηκαν');
          },
        },
      ],
    });
  };

  function adminsHtml() {
    const admins = (A.users || []).filter((u) => u.role === 'admin');
    let h = '<div class="card"><div class="card-head"><div><h3>Διαχειριστές</h3><div class="sub">Πλήρης πρόσβαση: μητρώο, βαθμολογίες, εξετάσεις, λογαριασμοί</div></div><div class="row"><button class="btn" data-action="changeMyPassword">' + icon('key') + 'Αλλαγή κωδικού μου</button><button class="btn btn-primary" data-action="acNewAdmin">' + icon('plus') + 'Νέος διαχειριστής</button></div></div>';
    h += '<table class="table"><thead><tr><th>Όνομα χρήστη</th><th>Όνομα</th><th>Κατάσταση</th><th>Τελευταία σύνδεση</th><th></th></tr></thead><tbody>';
    admins.forEach((u) => {
      const me = Remote.user && Remote.user.id === u.id;
      h += '<tr><td class="strong mono">' + esc(u.username) + (me ? ' <span class="badge badge-info">εσείς</span>' : '') + '</td><td>' + esc(u.name) + '</td><td>' + pill(u) + '</td><td class="small muted">' + (u.lastLogin ? fmtDate(u.lastLogin, true) : '—') + '</td><td class="right nowrap">' +
        (me ? '' : '<button class="btn btn-sm btn-ghost" data-action="acAdminPw" data-uid="' + u.id + '">' + icon('key') + 'Κωδικός</button><button class="btn btn-sm btn-ghost" data-action="acToggle" data-uid="' + u.id + '">' + icon(u.active ? 'lock' : 'check') + (u.active ? 'Απενεργοποίηση' : 'Ενεργοποίηση') + '</button><button class="btn btn-sm btn-ghost btn-icon" data-action="acDelete" data-uid="' + u.id + '" title="Διαγραφή">' + icon('trash') + '</button>') +
        '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  App.pages.accounts = {
    subtitle: () => 'Οι σπουδαστές συνδέονται με τον Α.Μ. τους μόνο για τις εξετάσεις — δεν βλέπουν βαθμολογίες',
    setTab(t) {
      if (['students', 'teachers', 'admins'].includes(t)) A.tab = t;
    },
    render() {
      let h = '<div class="page"><div class="row" style="margin-bottom:14px"><div class="seg"><button class="' + (A.tab === 'students' ? 'on' : '') + '" data-action="acTab" data-v="students">' + icon('users', 'width="14" height="14"') + ' Σπουδαστές</button><button class="' + (A.tab === 'teachers' ? 'on' : '') + '" data-action="acTab" data-v="teachers" id="ac-tab-teachers">' + icon('book', 'width="14" height="14"') + ' Καθηγητές</button><button class="' + (A.tab === 'admins' ? 'on' : '') + '" data-action="acTab" data-v="admins">' + icon('shield', 'width="14" height="14"') + ' Διαχειριστές</button></div><div class="spacer"></div><button class="btn btn-sm btn-ghost" data-action="acReload">' + icon('refresh') + 'Ανανέωση</button></div>';
      if (A.error) h += '<div class="callout warn">' + icon('alert') + '<p>Δεν ήταν δυνατή η φόρτωση των λογαριασμών: ' + esc(A.error) + '</p></div>';
      if (!A.users) h += A.error && !A.loading ? '' : '<div class="card card-pad muted">Φόρτωση λογαριασμών…</div>';
      else h += A.tab === 'students' ? studentsHtml() : A.tab === 'teachers' ? teachersHtml() : adminsHtml();
      return h + '</div>';
    },
    async mount() {
      // (not again and again while the server does not answer: «Ανανέωση» retries at once)
      if (!A.users && !A.loading && Date.now() - A.tried > 15000) {
        await loadUsers();
        if (S().page === 'accounts') App.render();
      }
    },
  };

  const rerender = () => S().page === 'accounts' && App.render();
  App.actions.acTab = (el) => {
    A.tab = el.dataset.v;
    App.render();
  };
  App.actions.acReload = async () => {
    await loadUsers();
    App.render();
    if (A.error) toast(esc(A.error), 'error');
  };
  App.changes.acClass = (el) => {
    A.cls = el.value;
    A.selected.clear();
    App.render();
  };
  App.inputs.acSearch = (el) => {
    A.q = el.value;
    App.render();
    const i = document.getElementById('ac-q');
    if (i) {
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }
  };
  App.changes.acSel = (el) => {
    if (el.checked) A.selected.add(el.dataset.id);
    else A.selected.delete(el.dataset.id);
    App.render();
  };
  App.changes.acAll = (el) => {
    studentRows().forEach((s) => (el.checked ? A.selected.add(s.id) : A.selected.delete(s.id)));
    App.render();
  };

  /**
   * Create (or reset) accounts for registry students and show the passwords once, with an Excel export.
   * students: registry student objects.
   */
  App.createAccounts = async function (students, reset) {
    const list = students.map((s) => ({ am: s.am, name: C.studentName(s), studentId: s.id }));
    const r = await Remote.createStudentAccounts(list, reset);
    await loadUsers();
    const byAm = new Map(students.map((s) => [amKey(s.am), s]));
    const creds = r.results.filter((x) => x.password).map((x) => Object.assign({}, x, { className: byAm.get(amKey(x.am)) ? classNameOf(byAm.get(amKey(x.am))) : '' }));
    const skipped = r.results.filter((x) => x.status === 'exists').length;
    const conflicts = r.results.filter((x) => x.status === 'conflict');
    showCredentials(creds, { skipped, conflicts, title: reset ? 'Νέοι κωδικοί' : 'Νέοι λογαριασμοί' });
    rerender();
    return r;
  };

  function showCredentials(creds, o) {
    const rows = creds
      .map((x) => '<tr><td class="am">' + esc(x.am) + '</td><td class="strong">' + esc(x.name) + '</td><td class="small">' + esc(x.className || '') + '</td><td class="mono">' + esc(x.username) + '</td><td class="pw">' + esc(x.password) + '</td></tr>')
      .join('');
    openModal({
      title: o.title,
      sub: creds.length ? 'Οι κωδικοί εμφανίζονται μόνο τώρα — αποθηκεύστε τους σε Excel για να τους δώσετε στους σπουδαστές' : '',
      size: 'lg',
      body:
        (creds.length ? '<div class="table-wrap" style="max-height:52vh"><table class="table cred-table"><thead><tr><th>Α.Μ.</th><th>Ονοματεπώνυμο</th><th>Τμήμα</th><th>Όνομα χρήστη</th><th>Κωδικός</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p>Δεν δημιουργήθηκαν νέοι κωδικοί.</p>') +
        (o.skipped ? '<p class="small muted" style="margin:10px 0 0">' + plural(o.skipped, 'σπουδαστής είχε', 'σπουδαστές είχαν') + ' ήδη λογαριασμό (δεν άλλαξε ο κωδικός — χρησιμοποιήστε «Νέοι κωδικοί» αν χρειάζεται).</p>' : '') +
        (o.conflicts && o.conflicts.length ? '<p class="small danger-text">Ο Α.Μ. ' + o.conflicts.map((x) => esc(x.am)).join(', ') + ' συμπίπτει με όνομα διαχειριστή — δεν δημιουργήθηκε λογαριασμός.</p>' : ''),
      buttons: [
        { label: 'Κλείσιμο' },
        creds.length
          ? {
              label: 'Αποθήκευση σε Excel',
              cls: 'btn-primary',
              icon: 'download',
              id: 'cred-excel',
              keepOpen: true,
              onClick: async () => {
                const r = window.XL.buildCredentials(creds, { server: Remote.url.replace(/^https?:\/\//, ''), title: C.yearLabel(S().db, S().yearId) });
                await App.saveWorkbook(r.wb, 'Κωδικοί_σπουδαστών_' + new Date().toISOString().slice(0, 10) + '.xlsx');
              },
            }
          : null,
      ].filter(Boolean),
    });
  }

  App.actions.acCreate = async () => {
    const acc = accountMap();
    const sel = studentRows().filter((s) => A.selected.has(s.id));
    const fresh = sel.filter((s) => !acc.has(amKey(s.am)));
    if (!fresh.length) return toast('Όλοι οι επιλεγμένοι έχουν ήδη λογαριασμό. Για νέο κωδικό πατήστε «Νέοι κωδικοί».', 'info');
    await App.createAccounts(fresh, false);
    A.selected.clear();
    rerender();
  };
  App.actions.acReset = async () => {
    const acc = accountMap();
    const sel = studentRows().filter((s) => A.selected.has(s.id) && acc.has(amKey(s.am)));
    if (!(await confirmDialog('Νέοι κωδικοί', 'Θα δημιουργηθούν νέοι κωδικοί για <b>' + plural(sel.length, 'σπουδαστή', 'σπουδαστές') + '</b>. Οι παλιοί κωδικοί θα πάψουν να ισχύουν.', { okText: 'Νέοι κωδικοί' }))) return;
    await App.createAccounts(sel, true);
    A.selected.clear();
    rerender();
  };
  App.actions.acOneReset = async (el) => {
    const u = (A.users || []).find((x) => String(x.id) === el.dataset.uid);
    if (!u) return;
    if (!(await confirmDialog('Νέος κωδικός', 'Νέος κωδικός για τον λογαριασμό <b>' + esc(u.username) + '</b> (' + esc(u.name) + ');', { okText: 'Δημιουργία' }))) return;
    const r = await Remote.resetPassword(u.id);
    if (u.role === 'teacher') {
      openModal({ title: 'Νέος κωδικός καθηγητή', size: 'sm', body: '<table class="table cred-table"><tbody><tr><td>Όνομα χρήστη</td><td class="mono strong">' + esc(u.username) + '</td></tr><tr><td>Κωδικός</td><td class="pw">' + esc(r.password) + '</td></tr></tbody></table><p class="small muted">Ο κωδικός εμφανίζεται μόνο τώρα.</p>', buttons: [{ label: 'Κλείσιμο' }] });
      return;
    }
    const st = S().db.students.find((s) => amKey(s.am) === amKey(u.am));
    showCredentials([{ am: u.am, name: u.name, className: st ? classNameOf(st) : '', username: u.username, password: r.password }], { title: 'Νέος κωδικός' });
  };
  App.actions.acToggle = async (el) => {
    const u = (A.users || []).find((x) => String(x.id) === el.dataset.uid);
    if (!u) return;
    await Remote.updateUser(u.id, { active: !u.active });
    await loadUsers();
    toast(u.active ? 'Ο λογαριασμός απενεργοποιήθηκε' : 'Ο λογαριασμός ενεργοποιήθηκε');
    rerender();
  };
  App.actions.acDelete = async (el) => {
    const u = (A.users || []).find((x) => String(x.id) === el.dataset.uid);
    if (!u) return;
    if (!(await confirmDialog('Διαγραφή λογαριασμού', 'Να διαγραφεί ο λογαριασμός <b>' + esc(u.username) + '</b>; ' + (u.role === 'student' ? 'Τα αποτελέσματα εξετάσεων του σπουδαστή παραμένουν.' : ''), { okText: 'Διαγραφή', danger: true }))) return;
    await Remote.deleteUser(u.id);
    await loadUsers();
    rerender();
  };
  App.actions.acNewAdmin = () => {
    openModal({
      title: 'Νέος διαχειριστής',
      size: 'sm',
      body: '<div class="stack"><div class="field"><label>Όνομα χρήστη</label><input class="input" id="na-user" placeholder="π.χ. grammateia" autofocus /></div><div class="field"><label>Ονοματεπώνυμο</label><input class="input" id="na-name" /></div><div class="field"><label>Κωδικός</label><input class="input" type="password" id="na-pass" /><div class="hint">Τουλάχιστον 8 χαρακτήρες.</div></div></div>',
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Δημιουργία',
          cls: 'btn-primary',
          onClick: async (ctx) => {
            await Remote.createAdmin({ username: ctx.q('#na-user').value.trim(), name: ctx.q('#na-name').value.trim(), password: ctx.q('#na-pass').value });
            await loadUsers();
            toast('Ο διαχειριστής δημιουργήθηκε');
            rerender();
          },
        },
      ],
    });
  };
  App.actions.acAdminPw = (el) => {
    const u = (A.users || []).find((x) => String(x.id) === el.dataset.uid);
    openModal({
      title: 'Νέος κωδικός διαχειριστή',
      sub: esc(u.username),
      size: 'sm',
      body: '<div class="field"><label>Νέος κωδικός</label><input class="input" type="password" id="ap-pass" autofocus /><div class="hint">Τουλάχιστον 8 χαρακτήρες.</div></div>',
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Αποθήκευση',
          cls: 'btn-primary',
          onClick: async (ctx) => {
            await Remote.resetPassword(u.id, ctx.q('#ap-pass').value);
            toast('Ο κωδικός άλλαξε');
          },
        },
      ],
    });
  };

  App.accounts = {
    reset() {
      Object.assign(A, { tab: 'students', cls: 'YEAR', q: '', users: null, loading: false, error: '', at: 0, tried: 0, pending: null, gen: A.gen + 1 });
      A.selected.clear();
    },
    async map() {
      if (!A.users) await loadUsers();
      return accountMap();
    },
    reload: loadUsers,
    amKey,
    /** Cached accounts for other pages: {users (null until loaded), loading, error, at (ms), tried (ms)}. */
    state: () => ({ users: A.users, loading: A.loading, error: A.error, at: A.at, tried: A.tried }),
  };
})();
