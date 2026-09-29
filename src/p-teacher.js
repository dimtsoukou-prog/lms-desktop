/*
 * Teacher portal: the teacher sees only the subjects + classes (+ period) the admin assigned to him, enters grades
 * by hand or uploads the Excel (Α.Μ. + βαθμός). Grades go straight into the central registry — the
 * admin's gradebook shows them right away; an Excel upload appears in the admin's import history
 * (with the teacher's name) and can be undone there. When the admin locks a subject, it is read-only here.
 * A grade that already has a re-exam grade (entered by the secretariat) cannot be changed by the teacher.
 * The «Ύλη» block of a subject lists its PDF files (view / delete / upload).
 */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, toast, openModal, emptyState, plural, fmtDate } = App.ui;
  const Remote = window.Remote;

  const POLL_MS = 10000;
  const ASSIGN_EVERY = 6; // every 6th poll (~1 min) also looks for new assignments (they do not change the registry revision)

  // sy: syllabus files per subjectId {files, error, loading, at} · syBusy: 'upload' | file id being opened | null
  // tab: 'grades' | 'absences' · absDate: the day shown in «Απουσίες» ("YYYY-MM-DD", null = the latest one)
  const T = { db: null, rev: 0, assignments: [], yearId: null, sel: null, timer: null, wired: false, busy: 0, sy: {}, syBusy: null, tick: 0, gen: 0, tab: 'grades', absDate: null };

  const root = () => document.getElementById('teacher-root');
  const aKey = (a) => [a.yearId, a.subjectId, a.spec || '', a.section || '', a.period || ''].join('|');

  function subjectOf(a) {
    return (a && T.db.subjects.find((x) => x.id === a.subjectId)) || null;
  }
  /** "Support Morning 1 – Οκτώβριος" */
  function classLabel(a) {
    return C.assignmentLabel(T.db, a) || a.label || '';
  }
  function roster(a) {
    return C.assignmentStudents(T.db, a);
  }
  function locked(a) {
    return !!C.gradeLock(T.db, a.yearId, a.subjectId);
  }
  const mineOfYear = () => T.assignments.filter((a) => a.yearId === T.yearId);

  function apply(r, keepSel) {
    T.rev = r.rev || 0;
    T.assign = r.assign || null;
    T.assignments = r.assignments || [];
    T.db = C.normalizeDb(r.data || { students: [], subjects: [], enrollments: [], grades: [], years: [], imports: [], settings: {} });
    const years = Array.from(new Set(T.assignments.map((a) => a.yearId))).filter((id) => T.db.years.some((y) => y.id === id));
    if (!years.includes(T.yearId)) {
      const cur = T.db.settings.currentYearId;
      const sorted = C.sortYears(T.db.years.filter((y) => years.includes(y.id)));
      T.yearId = years.includes(cur) ? cur : sorted[0] ? sorted[0].id : cur;
    }
    const mine = mineOfYear();
    if (!keepSel || !mine.some((a) => aKey(a) === T.sel)) T.sel = mine.length ? aKey(mine[0]) : null;
  }

  async function load(keepSel) {
    const gen = T.gen;
    const r = await Remote.teacherData();
    if (gen !== T.gen) return false; // signed out meanwhile
    apply(r, keepSel);
    return true;
  }

  // ------------------------------------------------------------ rendering
  function topBar() {
    const u = Remote.user || {};
    const years = Array.from(new Set(T.assignments.map((a) => a.yearId)));
    const ys = C.sortYears(T.db.years.filter((y) => years.includes(y.id)));
    return '<div class="sp-top"><div class="sp-brand">' + icon('anchor', 'width="22" height="22"') + '<div>GMC Maritime Academy<small>Βαθμολογίες καθηγητή</small></div></div><div class="spacer"></div>' +
      (ys.length > 1 ? '<select class="select tp-year" data-tx="year">' + ys.map((y) => '<option value="' + y.id + '"' + (y.id === T.yearId ? ' selected' : '') + '>' + esc(y.label) + '</option>').join('') + '</select>' : ys.length ? '<span class="tp-yearlabel">' + esc(ys[0].label) + '</span>' : '') +
      '<div class="sp-user"><b>' + esc(u.name || '') + '</b><br>' + esc(u.username || '') + '</div>' +
      '<button class="btn btn-sm" data-tx="password" id="tp-password" title="Αλλαγή κωδικού">' + icon('key') + '</button>' +
      '<button class="btn btn-sm" data-tx="logout" id="tp-logout">' + icon('logout') + 'Έξοδος</button></div>';
  }

  const hasGrade = (a, s) => !!C.getGrade(T.db, s.id, a.subjectId, a.yearId);

  function listHtml(mine) {
    return '<div class="section-title">Τα μαθήματά μου</div>' +
      mine
        .map((a) => {
          const sj = subjectOf(a);
          const st = roster(a);
          const done = st.filter((s) => hasGrade(a, s)).length;
          const k = aKey(a);
          return '<button class="tp-item' + (k === T.sel ? ' on' : '') + '" data-tx="sel" data-k="' + esc(k) + '"><div class="tp-item-t">' + esc(sj ? C.subjectLabel(sj) : 'Μάθημα') + (locked(a) ? ' ' + icon('lock', 'width="12" height="12"') : '') + '</div>' +
            '<div class="tp-item-s">' + esc(classLabel(a)) + '</div><div class="tp-bar"><span style="width:' + (st.length ? Math.round((done / st.length) * 100) : 0) + '%"></span></div><div class="tp-item-n">' + done + ' / ' + st.length + ' βαθμοί</div></button>';
        })
        .join('');
  }

  function note(a, s) {
    const g = C.getGrade(T.db, s.id, a.subjectId, a.yearId);
    if (g && g.re) return '<span class="tp-re" title="Ο βαθμός της επανεξέτασης καταχωρίστηκε από τη γραμματεία — ο αρχικός βαθμός δεν αλλάζει πια από εδώ">' + icon('lock', 'width="12" height="12"') + 'Re-exam: <b>' + esc(C.reText(g)) + '</b> (από τη γραμματεία)</span>';
    if (g) {
      const why = g.absent ? 'Απών' : g.att ? C.ATT_LABEL[g.att] : '';
      return '<span class="small muted">' + (why ? esc(why) + ' · ' : '') + (g.source === 'import' ? 'Excel' : 'χειροκίνητα') + (g.by && g.by !== (Remote.user || {}).username ? ' · ' + esc(g.by) : '') + ' · ' + esc(fmtDate(g.updatedAt, true)) + '</span>';
    }
    const c = C.carriedGrade(T.db, s.id, a.subjectId, a.yearId);
    if (c) return '<span class="small" style="color:var(--primary)">Έχει περάσει το ' + esc(C.yearLabel(T.db, c.yearId)) + ' με ' + esc(C.finalText(c)) + '</span>';
    return '';
  }

  function gradeInput(a, s, lk) {
    const g = C.getGrade(T.db, s.id, a.subjectId, a.yearId);
    const txt = C.gradeText(g);
    const re = !!(g && g.re);
    const tip = re ? 'Έχει βαθμό re-exam — αλλαγές μόνο από τη γραμματεία' : g && g.att ? C.ATT_LABEL[g.att] : g && g.absent ? 'Απών' : '';
    return '<input class="input tp-grade' + (C.needsReexam(g) ? ' fail' : '') + (re ? ' has-re' : '') + '" data-tsid="' + s.id + '" value="' + esc(txt) + '" data-orig="' + esc(txt) + '"' + (lk || re ? ' disabled' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + ' placeholder="—" />';
  }

  function tabsHtml() {
    return '<div class="seg tp-tabs" id="tp-tabs"><button class="' + (T.tab === 'grades' ? 'on' : '') + '" data-tx="tab" data-tab="grades">Βαθμοί</button><button class="' + (T.tab === 'absences' ? 'on' : '') + '" data-tx="tab" data-tab="absences" id="tp-tab-abs">Απουσίες</button></div>';
  }

  function panelHtml(a) {
    const sj = subjectOf(a);
    if (!sj) return '<div class="card card-pad muted">Το μάθημα δεν υπάρχει πια στο μητρώο.</div>';
    if (T.tab === 'absences') return absencesHtml(a, sj);
    const st = roster(a);
    const lk = locked(a);
    const done = st.filter((s) => hasGrade(a, s)).length;
    const nRe = st.filter((s) => {
      const g = C.getGrade(T.db, s.id, a.subjectId, a.yearId);
      return g && g.re;
    }).length;
    let h = '<div class="card"><div class="card-head"><div><h2>' + esc(C.subjectLabel(sj)) + '</h2><div class="sub">' + esc(classLabel(a)) + ' · ' + esc(C.yearLabel(T.db, a.yearId)) + ' · ' + done + ' / ' + st.length + ' βαθμοί</div></div>' +
      '<div class="row">' + tabsHtml() + '<button class="btn" data-tx="template">' + icon('sheet') + 'Πρότυπο Excel</button><button class="btn btn-primary" data-tx="import" id="tp-import"' + (lk || !st.length ? ' disabled' : '') + '>' + icon('upload') + 'Εισαγωγή από Excel</button></div></div>';
    if (lk) h += '<div class="card-body tp-lockbar"><div class="callout warn" style="margin:0">' + icon('lock') + '<p>Η βαθμολογία του μαθήματος <b>κλείδωσε</b> από τη γραμματεία — δεν γίνονται πλέον αλλαγές. Για διόρθωση απευθυνθείτε στη γραμματεία.</p></div></div>';
    if (!st.length) return h + '<div class="card-body">' + emptyState('users', 'Δεν υπάρχουν σπουδαστές', 'Δεν υπάρχουν ακόμη εγγεγραμμένοι σπουδαστές σε αυτό το τμήμα.') + '</div></div>';
    h += '<div class="table-wrap tp-wrap"><table class="table tp-table"><thead><tr><th class="num" style="width:44px">Α/Α</th><th style="width:110px">Α.Μ.</th><th>Επώνυμο</th><th>Όνομα</th><th style="width:110px">Βαθμός</th><th></th></tr></thead><tbody>';
    st.forEach((s, i) => {
      h += '<tr data-sid="' + s.id + '"><td class="num muted">' + (i + 1) + '</td><td class="am">' + esc(s.am) + '</td><td class="strong">' + esc(s.lastName) + '</td><td>' + esc(s.firstName) + '</td>' +
        '<td>' + gradeInput(a, s, lk) + '</td><td class="tp-note">' + note(a, s) + '</td></tr>';
    });
    h += '</tbody></table></div><div class="card-body small muted tp-help">Γράψτε τον βαθμό και πατήστε Enter — αποθηκεύεται αμέσως στο κεντρικό μητρώο. Δεκτές τιμές: <b>0, 1, 2, 3, 4, 5</b>, <b>ΑΠ</b> (απών), <b>0Δ</b> (0 λόγω δικαιολογημένων απουσιών) ή <b>0Α</b> (0 λόγω αδικαιολόγητων απουσιών). Για διαγραφή αφήστε το κελί κενό.' +
      (nRe ? '<br>' + icon('lock', 'width="12" height="12" style="vertical-align:-1px"') + ' ' + plural(nRe, 'σπουδαστής έχει', 'σπουδαστές έχουν') + ' βαθμό re-exam από τη γραμματεία — ο βαθμός τους δεν αλλάζει από εδώ.' : '') + '</div></div>';
    return h;
  }

  // ------------------------------------------------------------ absences of the selected subject (one day at a time)
  const today = () => C.isoDate(new Date(Remote.now()));
  const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
  const dayLabel = (d) => DAYS[C.isoWeekday(d)] + ' ' + C.dateText(d);

  /** The days of the subject in the calendars of the teacher's classes, up to today → {all, past, date, day}. */
  function absenceDays(a) {
    const all = C.subjectDates(T.db, a.yearId, a.subjectId, roster(a));
    const t = today();
    const past = all.filter((x) => x.date <= t);
    if (!past.some((x) => x.date === T.absDate)) T.absDate = past.length ? past[past.length - 1].date : null;
    return { all, past, date: T.absDate, day: past.find((x) => x.date === T.absDate) || null };
  }

  function absCountHtml(a, s, att) {
    const st = C.absenceStatus(T.db, s, a.subjectId, a.yearId, att);
    const at = !st.over && st.limit !== null && st.count > 0 && st.count === st.limit;
    return '<span class="tp-abs-n' + (st.over ? ' over' : at ? ' at' : '') + '">' + st.count + (st.limit !== null ? ' / ' + st.limit : '') + '</span>' +
      (st.over ? ' <span class="badge badge-danger" title="Πάνω από το όριο: δεν μπορεί να γράψει τις εξετάσεις του μαθήματος">εκτός ορίου</span>' : '');
  }

  function absencesHtml(a, sj) {
    const D = absenceDays(a);
    const att = C.attendance(T.db, a.yearId);
    const pct = C.absenceLimitPct(T.db);
    let h = '<div class="card" id="tp-abs"><div class="card-head"><div><h2>' + esc(C.subjectLabel(sj)) + '</h2><div class="sub">' + esc(classLabel(a)) + ' · ' + esc(C.yearLabel(T.db, a.yearId)) + ' · ' + plural(D.all.length, 'ημέρα μαθήματος', 'ημέρες μαθήματος') + ' στο ημερολόγιο</div></div><div class="row">' + tabsHtml() + '</div></div>';
    if (!D.all.length)
      return h + '<div class="card-body">' + emptyState('calendar', 'Δεν υπάρχουν ημέρες του μαθήματος στο ημερολόγιο', 'Η γραμματεία ορίζει στο ημερολόγιο ποια ημέρα κάνει κάθε τμήμα το μάθημα. Μόλις οριστούν, θα περνάτε εδώ τις απουσίες κάθε ημέρας.') + '</div></div>';
    if (!D.day)
      return h + '<div class="card-body">' + emptyState('calendar', 'Το μάθημα δεν έχει ξεκινήσει ακόμη', 'Η πρώτη ημέρα του μαθήματος είναι ' + esc(dayLabel(D.all[0].date)) + '. Απουσίες περνιούνται από την ημέρα του μαθήματος και μετά.') + '</div></div>';
    const i = D.past.indexOf(D.day);
    const absentOn = (d, list) => list.filter((s) => att.abs.byDay.has(s.id + '|' + d)).length;
    h += '<div class="tp-abs-bar"><button class="btn btn-sm btn-ghost btn-icon" data-tx="absday" data-d="' + (i > 0 ? D.past[i - 1].date : '') + '" title="Προηγούμενη ημέρα"' + (i > 0 ? '' : ' disabled') + '>' + icon('left') + '</button>' +
      '<select class="select tp-abs-date" data-tx="absdate" id="tp-abs-date">' + D.past.slice().reverse().map((x) => {
        const n = absentOn(x.date, x.students);
        return '<option value="' + x.date + '"' + (x.date === D.date ? ' selected' : '') + '>' + esc(dayLabel(x.date)) + (n ? ' — ' + plural(n, 'απών', 'απόντες') : '') + '</option>';
      }).join('') + '</select>' +
      '<button class="btn btn-sm btn-ghost btn-icon" data-tx="absday" data-d="' + (i < D.past.length - 1 ? D.past[i + 1].date : '') + '" title="Επόμενη ημέρα"' + (i < D.past.length - 1 ? '' : ' disabled') + '>' + icon('right') + '</button>' +
      '<div class="spacer"></div><span class="small muted">' + (D.all.length > D.past.length ? plural(D.all.length - D.past.length, 'ημέρα ακολουθεί', 'ημέρες ακολουθούν') : 'όλες οι ημέρες έχουν περάσει') + '</span></div>';
    h += '<div class="table-wrap tp-wrap"><table class="table tp-table tp-abs-table"><thead><tr><th class="chk" title="Απών">Απών</th><th class="num" style="width:44px">Α/Α</th><th style="width:110px">Α.Μ.</th><th>Επώνυμο</th><th>Όνομα</th><th title="Απουσίες στο μάθημα / όριο">Απουσίες μαθήματος</th></tr></thead><tbody>';
    D.day.students.forEach((s, n) => {
      const on = att.abs.byDay.has(s.id + '|' + D.date);
      h += '<tr data-sid="' + s.id + '"' + (on ? ' class="absent"' : '') + '><td class="chk"><input type="checkbox" data-abs="' + s.id + '"' + (on ? ' checked' : '') + ' title="Απών/Απούσα" /></td><td class="num muted">' + (n + 1) + '</td><td class="am">' + esc(s.am) + '</td><td class="strong">' + esc(s.lastName) + '</td><td>' + esc(s.firstName) + '</td>' +
        '<td class="tp-abs-cnt">' + absCountHtml(a, s, att) + '</td></tr>';
    });
    h += '</tbody></table></div><div class="card-body small muted tp-help">Σημειώστε όσους <b>έλειψαν</b> — αποθηκεύεται αμέσως στο κεντρικό μητρώο και το βλέπει η γραμματεία. ' +
      'Όριο: ' + pct + '% των ημερών του μαθήματος στο τμήμα, στρογγυλεμένο προς τα κάτω. Με περισσότερες απουσίες ο σπουδαστής <b>δεν μπορεί να γράψει</b> τις εξετάσεις του μαθήματος (εκτός αν του δώσει άδεια η γραμματεία).</div></div>';
    return h;
  }

  async function saveAbsence(cb) {
    const a = current();
    const date = T.absDate;
    if (!a || !date || cb.disabled) return;
    const sid = cb.dataset.abs;
    const on = cb.checked;
    const tr = cb.closest('tr');
    cb.disabled = true;
    if (tr) tr.classList.add('saving');
    T.busy++;
    const gen = T.gen;
    try {
      const r = await Remote.teacherAbsences({ yearId: a.yearId, subjectId: a.subjectId, date, changes: [{ studentId: sid, absent: on }] });
      if (gen !== T.gen || !T.db) return; // signed out meanwhile
      takeRev(r.rev);
      C.setAbsence(T.db, sid, a.yearId, date, on, { by: (Remote.user || {}).username, src: 'teacher' });
      if (tr) {
        tr.classList.toggle('absent', on);
        tr.querySelector('.tp-abs-cnt').innerHTML = absCountHtml(a, T.db.students.find((s) => s.id === sid) || { id: sid }, null);
      }
      const opt = root().querySelector('#tp-abs-date option[value="' + date + '"]');
      if (opt) {
        const n = root().querySelectorAll('input[data-abs]:checked').length;
        opt.textContent = dayLabel(date) + (n ? ' — ' + plural(n, 'απών', 'απόντες') : '');
      }
    } catch (e) {
      if (gen !== T.gen) return;
      cb.checked = !on;
      toast(esc(e.message), 'error');
      if (e.status === 400 || e.status === 403) {
        // the calendar or the assignment changed meanwhile: show the current state
        if (await load(true)) render();
      }
    } finally {
      if (gen === T.gen) {
        T.busy = Math.max(0, T.busy - 1);
        cb.disabled = false;
        if (tr) tr.classList.remove('saving');
      }
    }
  }

  // ------------------------------------------------------------ syllabus (Ύλη) of the selected subject
  function syllabusHtml(a) {
    const sj = subjectOf(a);
    if (!sj) return '';
    const c = T.sy[sj.id];
    const SYL = App.syllabusUi;
    let h = '<div class="card tp-sy" id="tp-sy"><div class="card-head"><div><h3>' + icon('file', 'width="16" height="16" style="vertical-align:-3px;margin-right:6px"') + 'Ύλη μαθήματος' + (c && c.files ? '<span class="tp-sy-n">' + c.files.length + '</span>' : '') + '</h3>' +
      '<div class="sub">Αρχεία PDF του ' + esc(C.subjectLabel(sj)) + ' — τα βλέπουν οι σπουδαστές του μαθήματος στην καρτέλα «Syllabus».</div></div>' +
      '<button class="btn" data-tx="syupload" id="tp-sy-upload"' + (T.syBusy !== null ? ' disabled' : '') + '>' + (T.syBusy === 'upload' ? '<span class="syl-spin"></span>Ανέβασμα…' : icon('upload') + 'Ανέβασμα PDF') + '</button></div>';
    if (!c || (!c.files && !c.error)) h += '<div class="card-body muted small">Φόρτωση…</div>';
    else if (!c.files) h += '<div class="card-body"><div class="callout warn" style="margin:0">' + icon('alert') + '<p style="flex:1">Δεν ήταν δυνατή η φόρτωση της ύλης: ' + esc(c.error) + '</p><button class="btn btn-sm" data-tx="syreload">' + icon('refresh') + 'Ξανά</button></div></div>';
    else if (!c.files.length) h += '<div class="card-body tp-sy-empty">Δεν έχει ανέβει ακόμη ύλη για αυτό το μάθημα. Ανεβάστε αρχεία PDF (έως 50 MB το καθένα).</div>';
    else h += '<div class="tp-sy-list">' + SYL.rowsHtml(c.files, { busy: T.syBusy !== null && T.syBusy !== 'upload' ? T.syBusy : null }) + '</div>';
    return h + '</div>';
  }

  function paintSyllabus() {
    const box = root() && root().querySelector('#tp-sy-wrap');
    const a = current();
    if (box && a) box.innerHTML = syllabusHtml(a);
  }

  async function loadSyllabus(subjectId, force) {
    const c = T.sy[subjectId];
    if (c && c.loading) return;
    if (c && c.files && !force && Date.now() - c.at < 60000) return;
    const gen = T.gen;
    T.sy[subjectId] = Object.assign({}, c || {}, { loading: true });
    try {
      const r = await Remote.syllabus(subjectId);
      if (gen !== T.gen) return;
      T.sy[subjectId] = { files: (r && r.files) || [], error: '', loading: false, at: Date.now() };
    } catch (e) {
      if (gen !== T.gen) return;
      T.sy[subjectId] = Object.assign({}, T.sy[subjectId], { error: e.message, loading: false, at: Date.now() });
      if (c && c.files && force) toast(esc(e.message), 'error');
    }
    const a = current();
    if (a && a.subjectId === subjectId) paintSyllabus();
  }

  function render() {
    if (!T.db) return;
    const mine = mineOfYear();
    const a = mine.find((x) => aKey(x) === T.sel);
    let h = topBar() + '<div class="tp-body">';
    if (!mine.length) h += '<div class="card" style="grid-column:1/-1">' + emptyState('book', 'Δεν σας έχουν ανατεθεί μαθήματα', 'Η γραμματεία αναθέτει σε κάθε καθηγητή τα μαθήματα και τα τμήματά του. Μόλις γίνει η ανάθεση, θα τα δείτε εδώ.') + '</div>';
    else h += '<div class="tp-list">' + listHtml(mine) + '</div><div class="tp-main">' + (a ? panelHtml(a) + '<div id="tp-sy-wrap">' + syllabusHtml(a) + '</div>' : '') + '</div>';
    root().innerHTML = h + '</div>';
    if (a && subjectOf(a)) loadSyllabus(a.subjectId, false);
  }

  // ------------------------------------------------------------ saving grades
  function current() {
    return T.assignments.find((x) => aKey(x) === T.sel) || null;
  }

  /** The server answered with rev: take it only when nobody else wrote in between (else the next poll reloads). */
  function takeRev(rev) {
    if (rev === T.rev + 1) T.rev = rev;
  }

  async function saveCell(inp) {
    const a = current();
    if (!a || inp.disabled) return;
    const val = inp.value.trim();
    if (val === (inp.dataset.orig || '')) return;
    const p = C.parseManualGrade(val);
    if (p.error) {
      toast(esc(p.error), 'error');
      inp.value = inp.dataset.orig || '';
      return;
    }
    const change = p.clear ? { studentId: inp.dataset.tsid, clear: true } : { studentId: inp.dataset.tsid, value: p.absent ? null : p.value, absent: !!p.absent };
    if (!p.clear && p.att) change.att = p.att; // 0Δ → 'J', 0Α → 'U'
    inp.classList.add('saving');
    T.busy++;
    const gen = T.gen;
    try {
      const r = await Remote.teacherGrades({ yearId: a.yearId, subjectId: a.subjectId, source: 'manual', changes: [change] });
      if (gen !== T.gen || !T.db) return; // signed out meanwhile
      takeRev(r.rev);
      if (p.clear) C.clearGrade(T.db, change.studentId, a.subjectId, a.yearId);
      else {
        const g = C.setGrade(T.db, change.studentId, a.subjectId, a.yearId, { value: change.value, absent: change.absent, att: change.att, source: 'teacher' });
        g.by = (Remote.user || {}).username;
      }
      const g = C.getGrade(T.db, change.studentId, a.subjectId, a.yearId);
      inp.dataset.orig = C.gradeText(g);
      inp.value = inp.dataset.orig;
      inp.title = g && g.att ? C.ATT_LABEL[g.att] : g && g.absent ? 'Απών' : '';
      inp.classList.remove('saving');
      inp.classList.add('saved');
      setTimeout(() => inp.classList.remove('saved'), 900);
      inp.classList.toggle('fail', C.needsReexam(g));
      const tr = inp.closest('tr');
      if (tr) tr.querySelector('.tp-note').innerHTML = note(a, { id: change.studentId });
      const list = root().querySelector('.tp-list');
      if (list) list.innerHTML = listHtml(mineOfYear());
      const sub = root().querySelector('.tp-main .card-head .sub');
      if (sub) {
        const st = roster(a);
        sub.textContent = classLabel(a) + ' · ' + C.yearLabel(T.db, a.yearId) + ' · ' + st.filter((s) => hasGrade(a, s)).length + ' / ' + st.length + ' βαθμοί';
      }
    } catch (e) {
      if (gen !== T.gen) return;
      inp.classList.remove('saving');
      inp.value = inp.dataset.orig || '';
      toast(esc(e.message), 'error');
      if (e.data && (e.data.locked || e.data.reexam)) {
        // locked subject / re-exam grade entered by the secretariat meanwhile: show it
        if (await load(true)) render();
      }
    } finally {
      if (gen === T.gen) T.busy = Math.max(0, T.busy - 1);
    }
  }

  // ------------------------------------------------------------ Excel upload
  const RE_SHEET = /^\s*re[\s\-_–]*exam\s*$/i; // the "Re-exam" sheet of the template lists failed students — never grades

  async function importExcel() {
    const a = current();
    const sj = a && subjectOf(a);
    if (!sj) return;
    const f = await App.pickExcel();
    if (!f) return;
    const wb = window.XL.readWorkbook(f.data, f.name);
    const usable = wb.sheets.filter((s) => !RE_SHEET.test(s.name || ''));
    if (!usable.length) throw new Error('Το αρχείο έχει μόνο το φύλλο «Re-exam» — δεν βρέθηκε φύλλο βαθμολογίας.');
    const sheet = usable.find((s) => s.grid.length > 1) || usable[0];
    if (!sheet || !sheet.grid.length) throw new Error('Το αρχείο είναι κενό.');
    const tbl = C.tableFromGrid(sheet.grid, C.detectHeaderRow(sheet.grid));
    const roles = tbl.headers.map((h) => C.guessColumnRole(h.title));
    let amCol = roles.indexOf('am');
    if (amCol < 0) {
      const idx = C.buildAmIndex(T.db);
      let best = { col: -1, n: 0 };
      tbl.headers.forEach((h, i) => {
        const n = tbl.rows.filter((r) => {
          const t = C.cellText(r.cells[i]);
          return t && idx.find(t);
        }).length;
        if (n > best.n) best = { col: i, n };
      });
      amCol = best.col;
    }
    if (amCol < 0) throw new Error('Δεν βρέθηκε στήλη με Α.Μ. στο αρχείο.');
    const skip = ['index', 'lastName', 'firstName', 'fullName', 'fatherName', 'email', 'phone', 'specialty', 'level', 'section', 'period', 'am'];
    const code = C.compact(sj.code || '');
    let gradeCol = -1;
    tbl.headers.forEach((h, i) => {
      if (gradeCol >= 0 || i === amCol || skip.includes(roles[i])) return;
      if (code && C.compact(h.title).includes(code)) gradeCol = i;
    });
    if (gradeCol < 0) gradeCol = tbl.headers.findIndex((h, i) => i !== amCol && !skip.includes(roles[i]) && /βαθμ|grade|score|mark/i.test(C.normText(h.title)));
    if (gradeCol < 0) gradeCol = tbl.headers.findIndex((h, i) => i !== amCol && !skip.includes(roles[i]) && C.columnLooksNumeric(tbl, i));
    if (gradeCol < 0) throw new Error('Δεν βρέθηκε στήλη βαθμών (Βαθμός) στο αρχείο.');
    const plan = C.planGradeImport(T.db, { table: tbl, amCol, columns: [{ col: gradeCol, subjectId: sj.id }], mode: 'scale', yearId: a.yearId });
    const mine = new Set(roster(a).map((s) => s.id));
    const ok = [];
    const reexam = []; // the secretariat entered a re-exam grade: the teacher's file does not change it
    const problems = [];
    plan.items.forEach((i) => {
      if (i.status === 'empty') return;
      if (['new', 'update', 'same'].includes(i.status)) {
        if (!mine.has(i.student.id)) problems.push({ i, why: 'Ο σπουδαστής δεν είναι σε αυτό το τμήμα' });
        else if (i.reexam) reexam.push(i);
        else ok.push(i);
      } else if (i.status === 'unknown_am') problems.push({ i, why: 'Άγνωστος Α.Μ. (δεν είναι στα τμήματά σας)' });
      else if (i.status === 'invalid') problems.push({ i, why: i.parsed.reason || 'Μη έγκυρος βαθμός' });
      else if (i.status === 'duplicate') problems.push({ i, why: 'Ο Α.Μ. υπάρχει δύο φορές' + (i.dupConflict ? ' με διαφορετικό βαθμό' : '') });
      else if (i.status === 'no_am') problems.push({ i, why: 'Λείπει ο Α.Μ.' });
    });
    const cnt = (s) => ok.filter((i) => i.status === s).length;
    const present = new Set(ok.concat(reexam).map((i) => i.student.id));
    const missing = roster(a).filter((s) => !present.has(s.id) && !problems.some((p) => p.i.student && p.i.student.id === s.id));
    const fileText = (i) => (i.parsed.kind === 'absent' ? 'ΑΠ' : i.parsed.att ? C.ATT_TEXT[i.parsed.att] : String(i.parsed.value));
    let body = '<div class="row tp-stats">' + stat(cnt('new'), 'νέοι βαθμοί', 'success-text') + stat(cnt('update'), 'αλλαγές', 'warning-text') + stat(cnt('same'), 'ίδιοι', 'muted') +
      (reexam.length ? stat(reexam.length, 'με re-exam (δεν αλλάζουν)', 'tp-re-text') : '') + stat(problems.length, 'προβλήματα', problems.length ? 'danger-text' : 'muted') + '</div>';
    body += '<div class="small muted" style="margin-bottom:10px">Φύλλο: <b>' + esc(sheet.name) + '</b> · στήλη Α.Μ.: <b>' + esc(tbl.headers[amCol].title) + '</b> · στήλη βαθμών: <b>' + esc(tbl.headers[gradeCol].title) + '</b></div>';
    if (cnt('update')) body += '<div class="callout warn" style="margin-bottom:10px">' + icon('alert') + '<p>' + plural(cnt('update'), 'υπάρχων βαθμός θα αλλάξει', 'υπάρχοντες βαθμοί θα αλλάξουν') + '.</p></div>';
    if (reexam.length)
      body += '<div class="table-wrap tp-imp-re"><table class="table table-compact"><thead><tr><th class="num">Γρ.</th><th>Α.Μ.</th><th>Ονοματεπώνυμο</th><th>Στο αρχείο</th><th>Βαθμός / re-exam</th><th></th></tr></thead><tbody>' +
        reexam.map((i) => '<tr><td class="num muted">' + i.rowNum + '</td><td class="am">' + esc(i.student.am) + '</td><td>' + esc(C.studentName(i.student)) + '</td><td>' + esc(fileText(i)) + '</td><td>' + esc(C.gradeText(i.prev)) + ' / <b>' + esc(C.reText(i.prev)) + '</b></td><td class="small tp-re-text">έχει re-exam — δεν αλλάζει</td></tr>').join('') +
        '</tbody></table></div>';
    if (problems.length)
      body += '<div class="table-wrap" style="max-height:34vh;margin-top:10px"><table class="table table-compact"><thead><tr><th class="num">Γρ.</th><th>Α.Μ.</th><th>Τιμή</th><th>Πρόβλημα (δεν καταχωρίζεται)</th></tr></thead><tbody>' +
        problems.map((p) => '<tr><td class="num muted">' + p.i.rowNum + '</td><td class="am">' + esc(p.i.amRaw || '—') + '</td><td>' + esc(p.i.raw || '') + '</td><td class="danger-text small">' + esc(p.why) + '</td></tr>').join('') + '</tbody></table></div>';
    if (missing.length) body += '<p class="small muted" style="margin:10px 0 0">Χωρίς βαθμό στο αρχείο: ' + missing.map((s) => esc(s.am)).join(', ') + '</p>';
    openModal({
      title: 'Εισαγωγή βαθμολογίας',
      sub: esc(f.name) + ' → ' + esc(C.subjectLabel(sj)) + ' · ' + esc(classLabel(a)),
      size: 'lg',
      body,
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Καταχώριση ' + plural(ok.length, 'βαθμού', 'βαθμών'),
          cls: 'btn-primary',
          id: 'tp-commit',
          onClick: async () => {
            if (!ok.length) throw new Error('Δεν υπάρχουν έγκυροι βαθμοί για καταχώριση.');
            const changes = ok.map((i) => {
              const c = { studentId: i.student.id, value: i.parsed.kind === 'absent' ? null : i.parsed.value, absent: i.parsed.kind === 'absent' };
              if (i.parsed.att) c.att = i.parsed.att;
              return c;
            });
            const r = await Remote.teacherGrades({ yearId: a.yearId, subjectId: sj.id, source: 'import', fileName: f.name, changes });
            if (await load(true)) render();
            const s = r.stats || {};
            toast('Καταχωρίστηκαν <b>' + ((s.added || 0) + (s.updated || 0) + (s.same || 0)) + '</b> βαθμοί στο κεντρικό μητρώο' + (s.reexam ? ' · ' + plural(s.reexam, 'σπουδαστής με re-exam δεν άλλαξε', 'σπουδαστές με re-exam δεν άλλαξαν') : ''), 'success', { duration: 6000 });
          },
        },
      ],
    });
  }

  function stat(v, label, cls) {
    return '<div><div class="tp-stat-v ' + (cls || '') + '">' + v + '</div><div class="small muted">' + esc(label) + '</div></div>';
  }

  async function template() {
    const a = current();
    const sj = a && subjectOf(a);
    if (!sj) return;
    const r = window.XL.buildTeacherTemplate(T.db, { subject: sj, students: roster(a), yearId: a.yearId, className: classLabel(a), includeNames: true, prefill: true });
    await App.saveWorkbook(r.wb, window.XL.fileSafe('Βαθμολόγιο_' + (sj.code || sj.name) + '_' + classLabel(a) + '_' + C.yearLabel(T.db, a.yearId)) + '.xlsx');
  }

  // ------------------------------------------------------------ syllabus actions
  async function syllabusAction(kind, id) {
    const a = current();
    const sj = subjectOf(a);
    if (!sj || T.syBusy !== null) return;
    const SYL = App.syllabusUi;
    const c = T.sy[sj.id];
    if (kind === 'upload') {
      T.syBusy = 'upload';
      paintSyllabus();
      let file = null;
      try {
        file = await SYL.upload(sj.id);
      } finally {
        T.syBusy = null;
        paintSyllabus();
      }
      if (file) {
        toast('Ανέβηκε το αρχείο <b>' + esc(file.name) + '</b>', 'success');
        await loadSyllabus(sj.id, true);
      }
      return;
    }
    const f = c && c.files && c.files.find((x) => String(x.id) === String(id));
    if (!f) return;
    if (kind === 'view') {
      T.syBusy = f.id;
      paintSyllabus();
      try {
        await SYL.view(f, C.subjectLabel(sj));
      } catch (e) {
        if (e.status === 404) loadSyllabus(sj.id, true);
        throw e;
      } finally {
        T.syBusy = null;
        paintSyllabus();
      }
    } else if (kind === 'del') {
      if (!(await SYL.remove(f, C.subjectLabel(sj)))) return;
      toast('Το αρχείο <b>' + esc(f.name) + '</b> διαγράφηκε');
      await loadSyllabus(sj.id, true);
    }
  }

  // ------------------------------------------------------------ events
  function wire() {
    if (T.wired) return;
    T.wired = true;
    const el = root();
    el.addEventListener('click', async (e) => {
      const sb = e.target.closest('[data-syl]');
      if (sb && !sb.disabled) {
        try {
          await syllabusAction(sb.dataset.syl, sb.dataset.id);
        } catch (err) {
          toast(esc(err.message || String(err)), 'error');
        }
        return;
      }
      const b = e.target.closest('[data-tx]');
      if (!b || b.disabled || b.tagName === 'SELECT') return;
      const act = b.dataset.tx;
      try {
        if (act === 'logout') return App.logout();
        if (act === 'password') return App.auth.changePassword(false);
        if (act === 'sel') {
          T.sel = b.dataset.k;
          T.absDate = null;
          render();
        } else if (act === 'tab') {
          T.tab = b.dataset.tab === 'absences' ? 'absences' : 'grades';
          render();
        } else if (act === 'absday') {
          if (b.dataset.d) T.absDate = b.dataset.d;
          render();
        } else if (act === 'import') await importExcel();
        else if (act === 'template') await template();
        else if (act === 'syupload') await syllabusAction('upload');
        else if (act === 'syreload') {
          const a = current();
          if (a) await loadSyllabus(a.subjectId, true);
        }
      } catch (err) {
        toast(esc(err.message || String(err)), 'error');
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.tx === 'year') {
        T.yearId = e.target.value;
        const mine = mineOfYear();
        T.sel = mine.length ? aKey(mine[0]) : null;
        T.absDate = null;
        render();
      } else if (e.target.dataset.tx === 'absdate') {
        T.absDate = e.target.value;
        render();
      } else if (e.target.matches('input[data-abs]')) saveAbsence(e.target);
      else if (e.target.matches('input[data-tsid]')) saveCell(e.target);
    });
    el.addEventListener('keydown', (e) => {
      if (!e.target.matches('input[data-tsid]')) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = Array.from(el.querySelectorAll('input[data-tsid]:not(:disabled)'));
        const i = all.indexOf(e.target);
        const next = all[i + (e.key === 'ArrowUp' ? -1 : 1)];
        e.target.blur(); // → change → save
        if (next) {
          next.focus();
          next.select();
        }
      }
    });
  }

  /** One poll: the registry revision (every time) and the assignments (every ASSIGN_EVERY-th time). */
  async function poll() {
    if (!T.db || T.busy || document.querySelector('.modal-backdrop')) return;
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('input[data-tsid]')) return;
    const gen = T.gen;
    T.tick++;
    try {
      const r = await Remote.teacherRev();
      if (gen !== T.gen) return;
      if (r.rev !== T.rev || (r.assign && T.assign && r.assign !== T.assign)) {
        if (await load(true)) render();
        return;
      }
      if (!r.assign && T.tick % ASSIGN_EVERY === 0) {
        // older server without the assignments fingerprint
        const d = await Remote.teacherData();
        if (gen !== T.gen || T.busy) return;
        if (JSON.stringify(d.assignments || []) !== JSON.stringify(T.assignments)) {
          apply(d, true);
          render();
        }
      }
    } catch (e) {
      /* offline for a moment */
    }
  }

  App.startTeacher = async function () {
    App.setMode('teacher');
    wire();
    T.gen++;
    T.sy = {};
    T.syBusy = null;
    T.tick = 0;
    root().innerHTML = '<div class="sp-body"><div class="muted">Φόρτωση…</div></div>';
    await load(false);
    render();
    clearInterval(T.timer);
    // changes by the admin (new students, locks, re-exam grades, corrections) and by other teachers show up here by themselves
    T.timer = setInterval(poll, POLL_MS);
  };

  App.teacher = {
    stop() {
      clearInterval(T.timer);
      T.timer = null;
      T.gen++;
      T.db = null;
      T.assignments = [];
      T.sel = null;
      T.yearId = null;
      T.sy = {};
      T.syBusy = null;
      T.busy = 0;
      T.tab = 'grades';
      T.absDate = null;
      const r = root();
      if (r) r.innerHTML = '';
    },
  };
})();
