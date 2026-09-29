/*
 * Calendar & absences (admin): the teaching calendar of each class (τμήμα) — one subject per day — and the
 * students' absences per hour (settings.hoursPerDay toggles a day). Click a day: its subject and the hours each
 * student was absent. «Συμπλήρωση» puts a subject on a range of days (e.g. every weekday for two weeks),
 * «Αντιγραφή» copies another class's calendar. «Απουσίες» sums the hours up per student and subject against
 * the subject's limit (set in «Μαθήματα»): above it a student cannot start the subject's exams unless the admin
 * allows it (Exams → results). Teachers record the hours of their own subjects from their portal.
 */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, plural, toast, openModal, confirmDialog, emptyState } = App.ui;
  const Remote = window.Remote;
  const S = () => App.S;

  const Z = { yearId: null, cls: null, month: null, view: 'month' };
  const MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  const MONTHS_GEN = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
  const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
  const DAYS_SHORT = ['Κυ', 'Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα'];
  const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const PALETTE = 10;

  /** "Δευτέρα 5 Οκτωβρίου 2026" */
  function longDate(d) {
    const [y, m, day] = d.split('-').map(Number);
    return DAYS[C.isoWeekday(d)] + ' ' + day + ' ' + MONTHS_GEN[m - 1] + ' ' + y;
  }
  /** "Δε 05/10" */
  function shortDate(d) {
    return DAYS_SHORT[C.isoWeekday(d)] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
  }
  const monthOf = (d) => d.slice(0, 7);
  const today = () => C.isoDate(new Date(Remote.now()));
  const me = () => (Remote.user && Remote.user.username) || '';

  // ------------------------------------------------------------ state
  function classes() {
    return C.calendarClasses(S().db, S().yearId);
  }

  /** The chosen class of the working year (the first one by default); a new working year starts over. */
  function current(list) {
    const { db, yearId } = S();
    if (Z.yearId !== yearId) {
      Z.yearId = yearId;
      Z.cls = null;
      Z.month = null;
    }
    const all = list || classes();
    let c = all.find((x) => x.key === Z.cls);
    if (!c) {
      c = all[0] || null;
      Z.cls = c ? c.key : null;
    }
    if (!Z.month) {
      const r = C.yearDateRange(db, yearId);
      const t = today();
      Z.month = !r || (t >= r.from && t <= r.to) ? monthOf(t) : monthOf(r.from);
    }
    return c;
  }

  /** Subject → colour index (the class's subjects in order). */
  function colours(subjects) {
    const m = new Map();
    subjects.forEach((s, i) => m.set(s.id, i % PALETTE));
    return m;
  }

  function subjectShort(s) {
    return s ? s.code || s.name : '';
  }

  // ------------------------------------------------------------ month view
  function monthCells(month) {
    const first = month + '-01';
    const offset = (C.isoWeekday(first) + 6) % 7; // Monday = 0
    let last = first;
    while (monthOf(C.addDays(last, 1)) === month) last = C.addDays(last, 1);
    const n = offset + Number(last.slice(8, 10));
    const weeks = Math.ceil(n / 7);
    const out = [];
    for (let i = 0; i < weeks * 7; i++) out.push(C.addDays(first, i - offset));
    return out;
  }

  function monthHtml(c) {
    const { db, yearId } = S();
    const A = C.attendance(db, yearId);
    const subjects = C.calendarSubjects(db, yearId, c.key);
    const col = colours(subjects);
    const byId = new Map(db.subjects.map((s) => [s.id, s]));
    const ids = new Set(c.students.map((s) => s.id));
    const perDay = new Map(); // date → hours of absence of the class's students
    A.abs.byDay.forEach((hours, k) => {
      const i = k.lastIndexOf('|');
      if (ids.has(k.slice(0, i))) perDay.set(k.slice(i + 1), (perDay.get(k.slice(i + 1)) || 0) + hours.length);
    });
    const range = C.yearDateRange(db, yearId);
    const t = today();
    const [yy, mm] = Z.month.split('-').map(Number);
    const prev = monthOf(C.addDays(Z.month + '-01', -1));
    const next = monthOf(C.addDays(Z.month + '-28', 7));
    const canPrev = !range || prev >= monthOf(range.from);
    const canNext = !range || next <= monthOf(range.to);
    let h = '<div class="card cal-card"><div class="cal-head">' +
      '<button class="btn btn-sm btn-ghost btn-icon" data-action="calMonth" data-m="' + prev + '" title="Προηγούμενος μήνας"' + (canPrev ? '' : ' disabled') + '>' + icon('left') + '</button>' +
      '<div class="cal-month" id="cal-month">' + MONTHS[mm - 1] + ' ' + yy + '</div>' +
      '<button class="btn btn-sm btn-ghost btn-icon" data-action="calMonth" data-m="' + next + '" title="Επόμενος μήνας"' + (canNext ? '' : ' disabled') + '>' + icon('right') + '</button>' +
      (!range || (t >= range.from && t <= range.to) ? '<button class="btn btn-sm btn-ghost" data-action="calMonth" data-m="' + monthOf(t) + '">Σήμερα</button>' : '') +
      '<span class="small muted cal-hint" title="Κάντε κλικ σε μια ημέρα για να ορίσετε το μάθημά της και τους απόντες">Κλικ σε μια ημέρα: μάθημα και απόντες</span></div>';
    h += '<div class="cal-grid">' + WEEK.map((wd) => '<div class="cal-wd' + (wd === 0 || wd === 6 ? ' wkend' : '') + '">' + DAYS_SHORT[wd] + '</div>').join('');
    monthCells(Z.month).forEach((d) => {
      const wd = C.isoWeekday(d);
      const inMonth = monthOf(d) === Z.month;
      const inYear = !range || (d >= range.from && d <= range.to);
      const cls = 'cal-day' + (wd === 0 || wd === 6 ? ' wkend' : '') + (d === t ? ' today' : '') + (!inMonth || !inYear ? ' out' : '');
      if (!inMonth || !inYear) {
        h += '<div class="' + cls + '"><span class="cal-dnum">' + Number(d.slice(8, 10)) + '</span></div>';
        return;
      }
      const sid = A.cal.day.get(c.key + '|' + d) || null;
      const sj = sid ? byId.get(sid) : null;
      const absent = sid ? perDay.get(d) || 0 : 0;
      h += '<button class="' + cls + (sj ? ' has' : '') + '" data-action="calDay" data-date="' + d + '" title="' + esc(longDate(d) + (sj ? ' — ' + C.subjectLabel(sj) : '')) + '">' +
        '<span class="cal-dnum">' + Number(d.slice(8, 10)) + '</span>' +
        (sj ? '<span class="cal-subj cs-' + (col.has(sid) ? col.get(sid) : 0) + '">' + esc(subjectShort(sj)) + '</span>' : sid ? '<span class="cal-subj cs-x">?</span>' : '') +
        (absent ? '<span class="cal-abs">' + plural(absent, 'ώρα απουσίας', 'ώρες απουσίας') + '</span>' : '') + '</button>';
    });
    return h + '</div></div>';
  }

  /** Side panel: every subject of the class with its days, limit and how many students are over it. */
  function legendHtml(c) {
    const { db, yearId } = S();
    const A = C.attendance(db, yearId);
    const subjects = C.calendarSubjects(db, yearId, c.key);
    const col = colours(subjects);
    let total = 0;
    let h = '<div class="card cal-legend"><div class="card-head"><div><h3>Μαθήματα του τμήματος</h3><div class="sub">Ημέρες στο ημερολόγιο · όριο απουσιών σε ώρες</div></div></div><div class="cal-leg-list">';
    subjects.forEach((s) => {
      const days = A.cal.days.get(c.key + '|' + s.id) || 0;
      total += days;
      const limit = C.subjectAbsenceLimit(s);
      const over = limit === null ? 0 : c.students.filter((st) => (A.abs.bySubject.get(st.id + '|' + s.id) || []).length > limit).length;
      h += '<div class="cal-leg' + (days ? '' : ' none') + '"><span class="cal-sw cs-' + col.get(s.id) + '"></span><div class="cal-leg-main"><div class="cal-leg-name" title="' + esc(C.subjectLabel(s)) + '">' + esc(C.subjectLabel(s)) + '</div>' +
        '<div class="cal-leg-meta">' + (days ? plural(days, 'ημέρα', 'ημέρες') : 'χωρίς ημέρες') + ' · ' + (limit === null ? '<span class="warning-text">χωρίς όριο</span>' : 'όριο <b>' + plural(limit, 'ώρα', 'ώρες') + '</b>') + '</div></div>' +
        (over ? '<button class="cal-over" data-action="calView" data-v="summary" title="Σπουδαστές πάνω από το όριο">' + over + ' εκτός ορίου</button>' : '') + '</div>';
    });
    if (!subjects.length) h += '<div class="card-body small muted">Το επίπεδο δεν έχει μαθήματα για αυτό το τμήμα — προσθέστε τα στη σελίδα «Μαθήματα».</div>';
    h += '</div><div class="card-body cal-leg-foot small muted">Σύνολο: <b>' + plural(total, 'ημέρα', 'ημέρες') + '</b> με μάθημα, ' + plural(A.hpd, 'ώρα', 'ώρες') + ' η καθεμία. ' +
      'Με περισσότερες ώρες απουσίας από το όριο ο σπουδαστής δεν ξεκινά τις εξετάσεις του μαθήματος. Το όριο ορίζεται σε κάθε μάθημα: <button class="link" data-action="go" data-page="subjects">Μαθήματα</button></div></div>';
    return h;
  }

  // ------------------------------------------------------------ summary view
  function summaryHtml(c) {
    const { db, yearId } = S();
    const sum = C.absenceSummary(db, yearId, c.key);
    if (!sum.subjects.length) return '<div class="card">' + emptyState('calendar', 'Δεν υπάρχει ακόμη ημερολόγιο', 'Ορίστε πρώτα τις ημέρες κάθε μαθήματος του τμήματος (καρτέλα «Ημερολόγιο») — από αυτές βγαίνει το όριο απουσιών.', '<button class="btn btn-primary" data-action="calView" data-v="month">' + icon('calendar') + 'Ημερολόγιο</button>') + '</div>';
    const over = sum.rows.filter((r) => r.over).length;
    let h = '<div class="card"><div class="card-head"><div><h3>Ώρες απουσίας ανά μάθημα</h3><div class="sub">' + plural(sum.rows.length, 'σπουδαστής', 'σπουδαστές') + ' · όριο κάθε μαθήματος σε ώρες (Μαθήματα)' +
      (over ? ' · <span class="danger-text strong">' + plural(over, 'σπουδαστής', 'σπουδαστές') + ' εκτός ορίου</span>' : '') + '</div></div></div>';
    h += '<div class="table-wrap abs-wrap"><table class="table table-compact abs-table"><thead><tr><th>Α.Μ.</th><th>Ονοματεπώνυμο</th>' +
      sum.subjects.map((x) => '<th class="num" title="' + esc(C.subjectLabel(x.subject)) + '"><div>' + esc(subjectShort(x.subject)) + '</div><div class="abs-th-sub">' + x.days + ' ημ. · ' + (x.limit === null ? 'χωρίς όριο' : 'όριο ' + x.limit + ' ώρ.') + '</div></th>').join('') +
      '<th class="num">Σύνολο</th></tr></thead><tbody>';
    sum.rows.forEach((r) => {
      h += '<tr' + (r.over ? ' class="abs-over-row"' : '') + '><td class="am">' + esc(r.student.am) + '</td><td class="strong nowrap">' + esc(C.studentName(r.student)) + (r.withdrawn ? ' <span class="badge">αποχώρησε</span>' : '') + '</td>' +
        r.cells.map((cell, i) => {
          const x = sum.subjects[i];
          const at = !cell.over && x.limit !== null && cell.count === x.limit && cell.count > 0;
          const tip = C.absenceEntriesText(cell.entries).join(' · ');
          return '<td class="num"><button class="abs-cell' + (cell.over ? ' over' : at ? ' at' : '') + (cell.count ? '' : ' zero') + '" data-action="calAbsList" data-sid="' + esc(r.student.id) + '" data-subject="' + esc(x.subject.id) + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + (cell.count ? '' : ' disabled') + '>' +
            cell.count + (x.limit !== null ? '<span class="abs-of">/' + x.limit + '</span>' : '') + '</button></td>';
        }).join('') +
        '<td class="num strong">' + r.total + '</td></tr>';
    });
    h += '</tbody></table></div><div class="card-body small muted abs-foot">Ώρες απουσίας. Κόκκινο: πάνω από το όριο — ο σπουδαστής <b>δεν μπορεί να ξεκινήσει</b> τις εξετάσεις του μαθήματος (βλέπει μήνυμα στην οθόνη του). Πορτοκαλί: ακριβώς στο όριο. ' +
      'Άδεια συμμετοχής δίνεται χειροκίνητα ανά εξέταση: Εξετάσεις → Αποτελέσματα ή Ανάθεση. Κλικ σε έναν αριθμό: οι ημέρες και οι ώρες.</div></div>';
    return h;
  }

  // ------------------------------------------------------------ page
  App.pages.calendar = {
    subtitle: () => 'Ένα μάθημα ανά ημέρα για κάθε τμήμα · απουσίες από γραμματεία και καθηγητές · ' + C.yearLabel(S().db, S().yearId),
    render() {
      const list = classes();
      const c = current(list);
      let h = '<div class="page page-wide">';
      if (!c)
        return h + '<div class="card">' + emptyState('calendar', 'Δεν υπάρχουν τμήματα στο ' + C.yearLabel(S().db, S().yearId), 'Το ημερολόγιο ορίζεται ανά τμήμα. Εγγράψτε πρώτα σπουδαστές σε επίπεδο και τμήμα για αυτό το ακαδημαϊκό έτος.', '<button class="btn btn-primary" data-action="go" data-page="students">' + icon('users') + 'Μητρώο σπουδαστών</button>') + '</div></div>';
      h += '<div class="row row-wrap cal-bar"><label class="small strong" for="cal-cls">Τμήμα</label><select class="select cal-cls" id="cal-cls" data-on-change="calCls">' +
        list.map((x) => '<option value="' + esc(x.key) + '"' + (x.key === c.key ? ' selected' : '') + '>' + esc(x.name) + ' (' + x.students.length + ')</option>').join('') + '</select>' +
        '<div class="seg" id="cal-views"><button class="' + (Z.view === 'month' ? 'on' : '') + '" data-action="calView" data-v="month">Ημερολόγιο</button><button class="' + (Z.view === 'summary' ? 'on' : '') + '" data-action="calView" data-v="summary">Απουσίες</button></div>' +
        '<div class="spacer"></div>' +
        (Z.view === 'month' ? '<button class="btn btn-sm" data-action="calCopy" id="cal-copy"' + (list.length > 1 ? '' : ' disabled') + '>' + icon('copy') + 'Αντιγραφή από τμήμα…</button><button class="btn btn-sm btn-primary" data-action="calFill" id="cal-fill">' + icon('calendar') + 'Συμπλήρωση ημερών…</button>' : '') + '</div>';
      if (Z.view === 'summary') h += summaryHtml(c);
      else h += '<div class="cal-layout">' + monthHtml(c) + legendHtml(c) + '</div>';
      return h + '</div>';
    },
    setTab(v) {
      Z.view = v === 'summary' ? 'summary' : 'month';
    },
  };

  App.changes.calCls = (el) => {
    Z.cls = el.value;
    App.render();
  };
  App.actions.calView = (el) => {
    Z.view = el.dataset.v === 'summary' ? 'summary' : 'month';
    App.render();
  };
  App.actions.calMonth = (el) => {
    Z.month = el.dataset.m;
    App.render();
  };

  // ------------------------------------------------------------ one day: its subject and each student's hours of absence
  /** Toggle buttons of the hours of a day (1…hpd); `on` = the hours absent. */
  function hourToggles(sid, hpd, on, attr) {
    let h = '<div class="hr-tog" role="group">';
    for (let i = 1; i <= hpd; i++)
      h += '<button type="button" class="hr' + (on.has(i) ? ' on' : '') + '" ' + attr + '="' + esc(sid) + '" data-h="' + i + '" aria-pressed="' + on.has(i) + '" title="' + i + 'η ώρα: ' + (on.has(i) ? 'απών' : 'παρών') + '">' + i + '</button>';
    return h + '<button type="button" class="hr hr-all" ' + attr + '="' + esc(sid) + '" data-h="all" title="Απών όλη την ημέρα / παρών">όλες</button></div>';
  }

  App.actions.calDay = (el) => {
    const { db, yearId } = S();
    const c = current();
    if (!c) return;
    const date = el.dataset.date;
    const day = C.calendarDay(db, yearId, c.key, date);
    const subjects = C.calendarSubjects(db, yearId, c.key);
    const A = C.attendance(db, yearId);
    const hpd = A.hpd;
    // studentId → hours absent that day
    const abs = new Map(c.students.map((st) => [st.id, new Set(A.abs.byDay.get(st.id + '|' + date) || [])]));
    const snap = () => c.students.map((st) => st.id + ':' + Array.from(abs.get(st.id)).sort().join('.')).join(',');
    const initial = snap();
    const hoursNow = () => c.students.reduce((n, st) => n + abs.get(st.id).size, 0);
    const before = hoursNow();
    let sid = day ? day.subjectId : '';
    const opts = '<option value="">— Χωρίς μάθημα —</option>' + subjects.map((s) => '<option value="' + esc(s.id) + '">' + esc(C.subjectLabel(s)) + '</option>').join('');
    function roster() {
      if (!sid) return '<div class="callout" style="margin-top:14px">' + icon('info') + '<p>Χωρίς μάθημα την ημέρα αυτή δεν καταχωρίζονται απουσίες.' + (before ? ' <b>Θα διαγραφούν ' + plural(before, 'ώρα απουσίας', 'ώρες απουσίας') + ' που υπάρχουν.</b>' : '') + '</p></div>';
      if (!c.students.length) return '<p class="muted small" style="margin-top:14px">Το τμήμα δεν έχει σπουδαστές.</p>';
      const sj = db.subjects.find((s) => s.id === sid);
      let h = '<div class="row" style="margin:14px 0 8px"><div class="label">Ώρες απουσίας</div><span class="small muted" id="cd-count"></span><div class="spacer"></div><button class="btn btn-sm btn-ghost" id="cd-none">Όλοι παρόντες</button></div>' +
        '<div class="table-wrap cd-wrap"><table class="table table-compact"><thead><tr><th>Α.Μ.</th><th>Ονοματεπώνυμο</th><th>Ώρες (κλικ = απών)</th><th class="num" title="Ώρες απουσίας στο μάθημα / όριο">' + esc(subjectShort(sj)) + ': σύνολο</th></tr></thead><tbody>';
      c.students.forEach((st) => {
        const s = C.absenceStatus(db, st, sid, yearId, A);
        const base = s.count - s.entries.filter((e) => e.date === date).length;
        h += '<tr><td class="am">' + esc(st.am) + '</td><td class="strong">' + esc(C.studentName(st)) + '</td><td>' + hourToggles(st.id, hpd, abs.get(st.id), 'data-cd') + '</td>' +
          '<td class="num small nowrap" data-cd-n="' + esc(st.id) + '" data-base="' + base + '" data-limit="' + (s.limit === null ? '' : s.limit) + '"></td></tr>';
      });
      return h + '</tbody></table></div>';
    }
    function paint(ctx) {
      ctx.qa('button[data-cd]').forEach((b) => {
        const set = abs.get(b.dataset.cd);
        const on = b.dataset.h === 'all' ? set.size === hpd : set.has(Number(b.dataset.h));
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      ctx.qa('[data-cd-n]').forEach((td) => {
        const n = Number(td.dataset.base) + abs.get(td.dataset.cdN).size;
        const lim = td.dataset.limit === '' ? null : Number(td.dataset.limit);
        td.innerHTML = n + (lim === null ? '' : ' / ' + lim) + (lim !== null && n > lim ? ' <span class="badge badge-danger">εκτός ορίου</span>' : '');
      });
      const k = ctx.q('#cd-count');
      if (k) {
        const who = c.students.filter((st) => abs.get(st.id).size).length;
        k.textContent = who ? plural(who, 'σπουδαστής', 'σπουδαστές') + ' · ' + plural(hoursNow(), 'ώρα', 'ώρες') : 'κανείς απών';
      }
    }
    openModal({
      title: longDate(date),
      sub: esc(c.name) + ' · ' + plural(hpd, 'ώρα', 'ώρες'),
      size: 'lg',
      body: '<div class="field"><label>Μάθημα της ημέρας</label><select class="select" id="cd-subject">' + opts + '</select></div><div id="cd-roster"></div>',
      onMount(ctx) {
        const sel = ctx.q('#cd-subject');
        sel.value = sid;
        const show = () => {
          ctx.q('#cd-roster').innerHTML = roster();
          paint(ctx);
        };
        show();
        sel.addEventListener('change', () => {
          sid = sel.value;
          show();
        });
        ctx.el.addEventListener('click', (e) => {
          if (e.target.closest('#cd-none')) {
            abs.forEach((set) => set.clear());
            return paint(ctx);
          }
          const b = e.target.closest('button[data-cd]');
          if (!b) return;
          const set = abs.get(b.dataset.cd);
          if (b.dataset.h === 'all') {
            const full = set.size === hpd;
            set.clear();
            if (!full) for (let i = 1; i <= hpd; i++) set.add(i);
          } else {
            const h = Number(b.dataset.h);
            if (set.has(h)) set.delete(h);
            else set.add(h);
          }
          paint(ctx);
        });
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Αποθήκευση',
          cls: 'btn-primary',
          id: 'cd-save',
          onClick: () => {
            if (sid === (day ? day.subjectId : '') && (!sid || snap() === initial)) return; // nothing changed
            App.mutate((d) => {
              C.setCalendarDay(d, yearId, c.key, date, sid || null);
              if (sid) c.students.forEach((st) => C.setDayAbsences(d, st.id, yearId, date, Array.from(abs.get(st.id)), { by: me(), src: 'admin' }));
            });
            const who = sid ? c.students.filter((st) => abs.get(st.id).size).length : 0;
            toast(sid ? longDate(date) + ': <b>' + esc(C.subjectLabel(db.subjects.find((s) => s.id === sid))) + '</b> · ' + (who ? plural(who, 'απών', 'απόντες') + ', ' + plural(hoursNow(), 'ώρα', 'ώρες') : 'κανείς απών') : longDate(date) + ': χωρίς μάθημα');
          },
        },
      ],
    });
  };

  // ------------------------------------------------------------ fill a range of days with one subject
  App.actions.calFill = () => {
    const { db, yearId } = S();
    const c = current();
    if (!c) return;
    const subjects = C.calendarSubjects(db, yearId, c.key);
    if (!subjects.length) throw new Error('Το τμήμα δεν έχει μαθήματα — προσθέστε τα στη σελίδα «Μαθήματα».');
    const range = C.yearDateRange(db, yearId);
    let from = Z.month + '-01';
    let to = from;
    while (monthOf(C.addDays(to, 1)) === Z.month) to = C.addDays(to, 1);
    if (range && from < range.from) from = range.from;
    if (range && to > range.to) to = range.to;
    const t = today();
    if (t > from && t <= to) from = t;
    openModal({
      title: 'Συμπλήρωση ημερών',
      sub: esc(c.name),
      size: 'md',
      body:
        '<div class="form-grid">' +
        '<div class="field span-2"><label>Μάθημα</label><select class="select" id="cf-subject">' + subjects.map((s) => '<option value="' + esc(s.id) + '">' + esc(C.subjectLabel(s)) + '</option>').join('') + '<option value="">— Καθαρισμός: χωρίς μάθημα —</option></select></div>' +
        '<div class="field"><label>Από</label><input class="input" type="date" id="cf-from" value="' + from + '"' + (range ? ' min="' + range.from + '" max="' + range.to + '"' : '') + ' /></div>' +
        '<div class="field"><label>Έως</label><input class="input" type="date" id="cf-to" value="' + to + '"' + (range ? ' min="' + range.from + '" max="' + range.to + '"' : '') + ' /></div>' +
        '<div class="field span-2"><label>Ημέρες της εβδομάδας</label><div class="row row-wrap cf-days">' +
        WEEK.map((wd) => '<label class="checkbox"><input type="checkbox" data-wd="' + wd + '"' + (wd >= 1 && wd <= 5 ? ' checked' : '') + ' /> ' + DAYS[wd] + '</label>').join('') + '</div></div>' +
        '<label class="checkbox span-2"><input type="checkbox" id="cf-over" /> Αντικατάσταση ημερών που έχουν ήδη άλλο μάθημα</label>' +
        '</div><div class="callout" id="cf-preview" style="margin-top:14px"></div>',
      onMount(ctx) {
        const read = () => ({
          subjectId: ctx.q('#cf-subject').value || null,
          from: ctx.q('#cf-from').value,
          to: ctx.q('#cf-to').value,
          weekdays: ctx.qa('[data-wd]').filter((x) => x.checked).map((x) => Number(x.dataset.wd)),
          overwrite: ctx.q('#cf-over').checked,
        });
        const preview = () => {
          const box = ctx.q('#cf-preview');
          try {
            const o = read();
            const p = C.planFill(db, yearId, c.key, o);
            box.className = 'callout' + (p.change ? '' : ' warn');
            box.innerHTML = icon('info') + '<p>' + (o.subjectId ? (p.change ? 'Θα οριστ' + (p.change === 1 ? 'εί <b>1 ημέρα</b>' : 'ούν <b>' + p.change + ' ημέρες</b>') : 'Καμία ημέρα δεν αλλάζει') + (p.keep ? ' · ' + plural(p.keep, 'ημέρα κρατά', 'ημέρες κρατούν') + ' το μάθημα που έχει' + (p.keep === 1 ? '' : 'ουν') : '') : p.change ? 'Θα καθαριστ' + (p.change === 1 ? 'εί <b>1 ημέρα</b>' : 'ούν <b>' + p.change + ' ημέρες</b>') + ' (και οι απουσίες τους)' : 'Καμία ημέρα με μάθημα στο διάστημα') + '.</p>';
            return p;
          } catch (e) {
            box.className = 'callout warn';
            box.innerHTML = icon('alert') + '<p>' + esc(e.message) + '</p>';
            return null;
          }
        };
        ctx.preview = preview;
        ctx.read = read;
        preview();
        ctx.el.addEventListener('change', preview);
        ctx.el.addEventListener('input', preview);
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εφαρμογή',
          cls: 'btn-primary',
          id: 'cf-go',
          onClick: async (ctx) => {
            const o = ctx.read();
            const p = C.planFill(db, yearId, c.key, o);
            if (!p.change) throw new Error('Καμία ημέρα δεν αλλάζει στο διάστημα αυτό.');
            const lost = p.dates.reduce((n, d) => n + c.students.reduce((m, st) => m + C.absenceHours(db, st.id, yearId, d).length, 0), 0);
            if (!o.subjectId && lost && !(await confirmDialog('Καθαρισμός ημερών', 'Στις ημέρες αυτές υπάρχουν <b>' + plural(lost, 'ώρα απουσίας', 'ώρες απουσίας') + '</b> — θα διαγραφούν.', { okText: 'Καθαρισμός', danger: true }))) return false;
            Z.month = monthOf(o.from);
            const r = App.mutate((d) => C.fillCalendar(d, yearId, c.key, o));
            toast(o.subjectId ? plural(r.set, 'ημέρα', 'ημέρες') + ' με <b>' + esc(C.subjectLabel(db.subjects.find((s) => s.id === o.subjectId))) + '</b>' + (r.moved ? ' · ' + plural(r.moved, 'ώρα απουσίας μεταφέρθηκε', 'ώρες απουσίας μεταφέρθηκαν') + ' στο νέο μάθημα' : '') : plural(r.set, 'ημέρα καθαρίστηκε', 'ημέρες καθαρίστηκαν') + (r.removed ? ' · ' + plural(r.removed, 'ώρα απουσίας διαγράφηκε', 'ώρες απουσίας διαγράφηκαν') : ''));
          },
        },
      ],
    });
  };

  // ------------------------------------------------------------ copy another class's calendar
  App.actions.calCopy = () => {
    const { db, yearId } = S();
    const list = classes();
    const c = current(list);
    if (!c) return;
    const A = C.attendance(db, yearId);
    const daysOf = (key) => {
      let n = 0;
      A.cal.day.forEach((sid, k) => k.slice(0, -11) === key && n++);
      return n;
    };
    const others = list.filter((x) => x.key !== c.key && x.levelId === c.levelId && daysOf(x.key));
    if (!others.length) throw new Error('Κανένα άλλο τμήμα του ίδιου επιπέδου δεν έχει ακόμη ημερολόγιο.');
    openModal({
      title: 'Αντιγραφή ημερολογίου',
      sub: 'Προς: ' + esc(c.name),
      size: 'sm',
      body: '<div class="field"><label>Από το τμήμα</label><select class="select" id="cc-from">' + others.map((x) => '<option value="' + esc(x.key) + '">' + esc(x.name) + ' — ' + plural(daysOf(x.key), 'ημέρα', 'ημέρες') + '</option>').join('') + '</select></div>' +
        '<label class="checkbox" style="margin-top:12px"><input type="checkbox" id="cc-over" /> Αντικατάσταση ημερών που έχουν ήδη άλλο μάθημα</label>' +
        '<p class="small muted" style="margin:12px 0 0">Αντιγράφονται οι ημέρες και τα μαθήματά τους — όχι οι απουσίες. Μαθήματα που δεν έχει αυτό το τμήμα παραλείπονται.</p>',
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Αντιγραφή',
          cls: 'btn-primary',
          id: 'cc-go',
          onClick: (ctx) => {
            const from = ctx.q('#cc-from').value;
            const over = ctx.q('#cc-over').checked;
            const r = App.mutate((d) => C.copyCalendar(d, yearId, from, c.key, over));
            toast('Αντιγράφηκαν ' + plural(r.set, 'ημέρα', 'ημέρες') + (r.kept ? ' · ' + plural(r.kept, 'ημέρα κράτησε', 'ημέρες κράτησαν') + ' το δικό τους μάθημα' : '') + (r.skipped ? ' · ' + r.skipped + ' παραλείφθηκαν' : ''));
          },
        },
      ],
    });
  };

  // ------------------------------------------------------------ the hours of absence of one student in one subject
  App.actions.calAbsList = (el) => {
    const { db, yearId } = S();
    const st = db.students.find((s) => s.id === el.dataset.sid);
    const sj = db.subjects.find((s) => s.id === el.dataset.subject);
    if (!st || !sj) return;
    const body = () => {
      const s = C.absenceStatus(S().db, st, sj.id, yearId);
      if (!s.entries.length) return '<p class="muted">Δεν υπάρχουν απουσίες.</p>';
      return '<div class="row" style="margin-bottom:10px"><span class="' + (s.over ? 'danger-text strong' : '') + '">' + plural(s.count, 'ώρα απουσίας', 'ώρες απουσίας') + (s.limit !== null ? ' · όριο ' + plural(s.limit, 'ώρα', 'ώρες') : ' · χωρίς όριο') + '</span>' + (s.over ? '<span class="badge badge-danger">εκτός ορίου</span>' : '') + '</div>' +
        '<table class="table table-compact"><tbody>' + s.entries.map((e) => {
          const a = C.getAbsence(S().db, st.id, yearId, e.date, e.hour);
          return '<tr><td class="nowrap">' + esc(longDate(e.date)) + '</td><td class="nowrap strong">' + e.hour + 'η ώρα</td><td class="small muted">' + esc(a && a.src === 'teacher' ? 'καθηγητής ' + (a.by || '') : 'γραμματεία' + (a && a.by ? ' (' + a.by + ')' : '')) + '</td><td class="right"><button class="btn btn-sm btn-ghost" data-al-del="' + e.date + '" data-al-h="' + e.hour + '">' + icon('trash') + 'Διαγραφή</button></td></tr>';
        }).join('') + '</tbody></table>';
    };
    openModal({
      title: C.studentName(st) + ' — ' + C.subjectLabel(sj),
      sub: 'Α.Μ. ' + esc(st.am) + ' · ώρες απουσίας ' + esc(C.yearLabel(db, yearId)),
      size: 'md',
      body: body(),
      onMount(ctx) {
        ctx.el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-al-del]');
          if (!b) return;
          const d = b.dataset.alDel;
          const h = Number(b.dataset.alH);
          if (!(await confirmDialog('Διαγραφή απουσίας', 'Να διαγραφεί η απουσία της ' + h + 'ης ώρας, ' + esc(longDate(d)) + ';', { okText: 'Διαγραφή', danger: true }))) return;
          App.mutate((db2) => C.setAbsence(db2, st.id, yearId, d, h, false));
          ctx.setBody(body());
        });
      },
      buttons: [{ label: 'Κλείσιμο' }],
    });
  };

  App.calendar = {
    state: Z,
    reset() {
      Object.assign(Z, { yearId: null, cls: null, month: null, view: 'month' });
    },
    longDate,
    shortDate,
  };
})();
