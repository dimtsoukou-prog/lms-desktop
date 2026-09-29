/*
 * Βαθμολόγιο: editable students × subjects grid for one year/level/specialty (and period).
 * Two modes: «Κανονική εξέταση» (the original grades) and «Re-exam» (only the students with a failing
 * original grade — ΑΠ, 0, 0Δ, 0Α — the admin types the re-exam grade; the original stays as it is).
 */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, plural, options, toast, openModal, emptyState, specBadge, resultBadge } = App.ui;

  const F = { levelId: 'SUP', spec: 'DECK', section: 'ALL', period: 'ALL', mode: 'normal', q: '' };

  /** Spec actually used for the grid: Support is always everyone together. */
  function curSpec() {
    return C.isUnifiedLevel(F.levelId) ? 'ALL' : F.spec;
  }

  /** Section filter: Management has one shift per class, so no per-student filter there. */
  function curSection() {
    return C.isShiftLevel(F.levelId) ? 'ALL' : F.section;
  }

  /** Period filter choices of the level (null when it has fewer than 2 periods). */
  function periodChoices() {
    const { db, yearId } = S();
    const list = C.levelPeriods(db, F.levelId);
    if (list.length < 2) return null;
    const opts = [{ value: 'ALL', label: 'Όλες οι περίοδοι' }].concat(list.map((p) => ({ value: p.id, label: p.name })));
    if (db.enrollments.some((e) => e.yearId === yearId && e.levelId === F.levelId && !e.period)) opts.push({ value: 'NONE', label: 'Χωρίς περίοδο' });
    return opts;
  }

  /** Period used for the grid: 'ALL' | period id | 'NONE'. */
  function curPeriod() {
    const opts = periodChoices();
    if (!opts) return 'ALL';
    if (!opts.some((o) => o.value === F.period)) F.period = 'ALL';
    return F.period;
  }

  const reMode = () => F.mode === 'reexam';

  function sectionOptions(levelId) {
    return [{ value: 'ALL', label: 'Όλα τα τμήματα' }]
      .concat(C.levelSections(levelId).map((s) => ({ value: s.id, label: s.name })))
      .concat([{ value: 'NONE', label: 'Χωρίς τμήμα' }]);
  }
  const S = () => App.S;
  const username = () => (window.Remote && window.Remote.user ? window.Remote.user.username : '');

  App.pages.gradebook = {
    subtitle: () => 'Βαθμοί ανά επίπεδο και ειδικότητα — ακαδημαϊκό έτος ' + C.yearLabel(S().db, S().yearId),
    setLevel(l) {
      if (F.levelId !== l) {
        F.section = 'ALL';
        F.period = 'ALL';
      }
      F.levelId = l;
    },
    setSpec(sp) {
      F.spec = sp;
    },
    setPeriod(p) {
      F.period = p || 'ALL';
    },
    render() {
      const { db, yearId } = S();
      let h = '<div class="page page-wide">';
      h += '<div class="tabs">' + C.LEVELS.map((l) => {
        const n = db.enrollments.filter((e) => e.yearId === yearId && e.levelId === l.id).length;
        return '<button class="tab' + (l.id === F.levelId ? ' on' : '') + '" data-action="gbLevel" data-level="' + l.id + '">' + esc(l.short) + '<span class="count">' + n + '</span></button>';
      }).join('') + '</div>';

      const unified = C.isUnifiedLevel(F.levelId);
      const shiftLevel = C.isShiftLevel(F.levelId);
      const specOn = F.spec === 'DECK' || F.spec === 'ENGINE';
      let classCtl = '';
      if (shiftLevel) {
        // Management: the whole class is either morning or afternoon
        classCtl = specOn
          ? '<div class="row" style="gap:6px"><span class="label">Τμήμα</span><select class="select" style="width:auto" data-on-change="gbShift">' +
            options([{ value: '', label: '— Πρωί ή απόγευμα; —' }].concat(C.levelSections(F.levelId).map((s) => ({ value: s.id, label: s.name }))), C.getMgmtShift(db, yearId, F.levelId, F.spec) || '') +
            '</select></div>'
          : '';
      } else {
        classCtl = '<select class="select" style="width:auto;min-width:150px" data-on-change="gbSection">' + options(sectionOptions(F.levelId), F.section) + '</select>';
      }
      const perOpts = periodChoices();
      const perCtl = perOpts ? '<select class="select gb-period" id="gb-period" data-on-change="gbPeriod" title="Περίοδος (εισαγωγή σπουδαστών)">' + options(perOpts, curPeriod()) + '</select>' : '';
      const modeCtl = '<div class="seg gb-mode" id="gb-mode">' + [['normal', 'Κανονική εξέταση'], ['reexam', 'Re-exam']].map((x) => '<button class="' + (F.mode === x[0] ? 'on' : '') + '" data-action="gbMode" data-v="' + x[0] + '"' + (x[0] === 'reexam' ? ' title="Επαναληπτική εξέταση: οι σπουδαστές με ΑΠ, 0, 0Δ ή 0Α"' : '') + '>' + x[1] + '</button>').join('') + '</div>';
      h += '<div class="toolbar">' +
        (unified ? '' : '<div class="seg">' + [['DECK', 'Deck'], ['ENGINE', 'Engine'], ['ALL', 'Όλοι']].map((x) => '<button class="' + (F.spec === x[0] ? 'on' : '') + '" data-action="gbSpec" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>') +
        classCtl +
        perCtl +
        modeCtl +
        '<input class="input input-search gb-search" placeholder="Αναζήτηση σπουδαστή" value="' + esc(F.q) + '" data-on-input="gbSearch" />' +
        '<div class="spacer"></div>' +
        '<button class="btn" data-action="gbTemplates" title="Πρότυπο Excel με Α.Μ. για τον καθηγητή">' + icon('sheet') + 'Πρότυπο</button>' +
        '<button class="btn" data-action="go" data-page="import" data-tab="grades" title="Εισαγωγή βαθμολογίας καθηγητή">' + icon('upload') + 'Εισαγωγή</button>' +
        '<button class="btn btn-primary" data-action="gbExport">' + icon('download') + 'Εξαγωγή Excel</button>' +
        '</div>';
      const noSpec = unified ? 0 : C.enrolledStudents(db, yearId, F.levelId, 'NONE').length;
      if (noSpec && F.spec !== 'ALL')
        h += '<div class="callout warn" style="margin-bottom:12px">' + icon('alert') + '<p>' + plural(noSpec, 'σπουδαστής', 'σπουδαστές') + ' του επιπέδου δεν έχουν ορισμένη ειδικότητα και εμφανίζονται μόνο στην επιλογή «Όλοι». Ορίστε ειδικότητα από το μητρώο.</p></div>';
      h += '<div id="gb-host">' + gridHtml() + '</div>';
      if (reMode())
        h += '<div class="legend" style="margin-top:12px"><span>Re-exam: γράψτε τον βαθμό της επαναληπτικής εξέτασης (0–5, <b>ΑΠ</b>, <b>0Δ</b> ή <b>0Α</b>) · ο αρχικός βαθμός φαίνεται μικρός και μένει ως έχει · <span class="kbd">Enter</span> επόμενη γραμμή · κενό = διαγραφή</span>' +
          '<span><span class="sw" style="background:var(--danger-soft)"></span><span class="danger-text strong">Κόκκινο</span> = κάτω από τη βάση</span></div>';
      else
        h += '<div class="legend" style="margin-top:12px"><span>Κάντε κλικ σε ένα κελί για να γράψετε βαθμό 0–5, <b>ΑΠ</b>, <b>0Δ</b> ή <b>0Α</b> · <span class="kbd">Enter</span> επόμενη γραμμή · <span class="kbd">Delete</span> διαγραφή</span>' +
          '<span><span class="sw" style="background:var(--danger-soft)"></span><span class="danger-text strong">Κόκκινο</span> = κάτω από τη βάση</span>' +
          '<span><span class="sw" style="background:repeating-linear-gradient(-45deg,#f6f7f9,#f6f7f9 3px,#e3e6ea 3px,#e3e6ea 6px)"></span>Δεν αφορά την ειδικότητα</span>' +
          '<span><span class="sw" style="background:#eef6ff"></span><i>Πλάγια μπλε</i> = βαθμός από προηγούμενο έτος (επανεγγραφή)</span></div>';
      h += '<div class="legend gb-codes" id="gb-codes"><span><b>ΑΠ</b> = απών · <b>0Δ</b> = 0 λόγω δικαιολογημένων απουσιών · <b>0Α</b> = 0 λόγω αδικαιολόγητων απουσιών · <span class="re-badge ok re-badge-inline">R</span> = βαθμός re-exam</span></div>';
      h += '</div>';
      return h;
    },
    mount() {
      wireGrid();
    },
  };

  /** Title of the grid (class / level + specialty, and the period when one is chosen). */
  function gridTitle(spec, section, period) {
    const { db, yearId } = S();
    const unified = C.isUnifiedLevel(F.levelId);
    const specOn = spec === 'DECK' || spec === 'ENGINE';
    const lvlName = C.levelName(db, F.levelId, specOn ? spec : null);
    const per = period !== 'ALL' && period !== 'NONE' ? C.classPeriod(db, F.levelId, period) : null;
    let title;
    if (section !== 'ALL') title = C.classFullName(db, F.levelId, specOn ? spec : null, section === 'NONE' ? null : section, per) + (section === 'NONE' ? ' — χωρίς τμήμα' : '');
    else if (C.isShiftLevel(F.levelId) && specOn) {
      const shift = C.getMgmtShift(db, yearId, F.levelId, spec);
      title = C.classFullName(db, F.levelId, spec, shift, per);
    } else {
      title = unified ? lvlName : lvlName + ' · ' + (specOn ? C.specialtyName(spec) : 'Deck & Engine');
      if (per) title += ' – ' + C.periodName(per);
    }
    if (period === 'NONE') title += ' — χωρίς περίοδο';
    return title;
  }

  /** Does a row have a failing ORIGINAL grade (own, this year) in one of the visible subjects? */
  function needsRe(r) {
    return r.cells.some((c) => c.applies && c.grade && C.needsReexam(c.grade));
  }

  function gridHtml() {
    const { db, yearId } = S();
    const spec = curSpec();
    const section = curSection();
    const period = curPeriod();
    const sheet = C.buildGradeSheet(db, yearId, F.levelId, spec, section, period);
    const re = reMode();
    const base = re ? sheet.rows.filter(needsRe) : sheet.rows;
    const q = C.normText(F.q);
    const rows = q ? base.filter((r) => C.normText(r.student.am + ' ' + C.studentName(r.student)).includes(q)) : base;
    const unified = C.isUnifiedLevel(F.levelId);
    const title = gridTitle(spec, section, period);
    const showSec = section === 'ALL' && !C.isShiftLevel(F.levelId);
    const showPer = !!periodChoices() && period === 'ALL';
    let h = '<div class="card"><div class="card-head"><div><h3>' + esc(title) + '</h3><div class="sub">';
    if (re) h += '<span class="gb-re-count" id="gb-re-count">' + base.length + ' ' + (base.length === 1 ? 'σπουδαστής' : 'σπουδαστές') + ' για re-exam</span> · από ' + plural(sheet.rows.length, 'σπουδαστή', 'σπουδαστές');
    else h += plural(sheet.rows.length, 'σπουδαστής', 'σπουδαστές');
    h += ' · ' + plural(sheet.subjects.length, 'μάθημα', 'μαθήματα') + ' · ' + esc(C.yearLabel(db, yearId)) + '</div></div>';
    if (re) {
      const rc = reCounts(sheet, base);
      if (rc.total) h += '<div class="row"><span class="badge badge-info" id="gb-re-done">Re-exam καταχωρισμένα ' + rc.done + ' / ' + rc.total + '</span></div>';
    } else {
      const counts = { pass: 0, fail: 0, incomplete: 0 };
      sheet.rows.forEach((r) => counts[r.result.status] !== undefined && counts[r.result.status]++);
      if (sheet.rows.length) h += '<div class="row"><span class="badge badge-success">Επιτυχία ' + counts.pass + '</span><span class="badge badge-danger">Υπολείπονται ' + counts.fail + '</span><span class="badge badge-warning">Εκκρεμούν ' + counts.incomplete + '</span></div>';
    }
    h += '</div>';
    if (!sheet.subjects.length) {
      h += emptyState('book', 'Δεν υπάρχουν μαθήματα', 'Δεν έχουν οριστεί μαθήματα για το ' + esc(title) + '.', '<button class="btn btn-primary" data-action="go" data-page="subjects" data-level="' + F.levelId + '">' + icon('book') + 'Μετάβαση στα μαθήματα</button>') + '</div>';
      return h;
    }
    if (!sheet.rows.length) {
      h += emptyState('users', 'Δεν υπάρχουν εγγεγραμμένοι σπουδαστές', 'Κανένας σπουδαστής δεν είναι εγγεγραμμένος στο ' + esc(title) + ' για το ' + esc(C.yearLabel(db, yearId)) + '.', '<button class="btn btn-primary" data-action="go" data-page="students" data-level="' + F.levelId + '">' + icon('users') + 'Μητρώο σπουδαστών</button>') + '</div>';
      return h;
    }
    if (re && !base.length) {
      h += emptyState('check', 'Κανένας σπουδαστής για re-exam', 'Κανένας σπουδαστής του ' + esc(title) + ' δεν έχει <b>ΑΠ</b>, <b>0</b>, <b>0Δ</b> ή <b>0Α</b> στα μαθήματα που εμφανίζονται.', '<button class="btn" data-action="gbMode" data-v="normal">Κανονική εξέταση</button>') + '</div>';
      return h;
    }
    h += '<div class="gb-wrap"><table class="gb' + (re ? ' gb-re' : '') + '"><thead><tr><th class="sticky-1"><div class="th-in">Α.Μ.</div></th><th class="sticky-2" style="text-align:left"><div class="th-in">Σπουδαστής</div></th>';
    sheet.subjects.forEach((s) => {
      h += '<th class="subj-h" title="' + esc(C.subjectLabel(s) + ' · ' + (s.specialty === 'COMMON' ? 'Κοινό' : C.specialtyName(s.specialty)) + ' · συντελεστής ' + (s.weight || 1)) + '"><div class="th-in"><div class="code">' + esc(s.code || '') + '</div><div class="nm">' + esc(s.name) + '</div>' + (s.weight && s.weight !== 1 ? '<div class="w">×' + esc(C.formatGrade(s.weight)) + '</div>' : '') + (spec === 'ALL' && s.specialty !== 'COMMON' ? '<div style="margin-top:3px">' + specBadge(s.specialty) + '</div>' : '') +
        (C.gradeLock(S().db, S().yearId, s.id) ? '<span class="subj-lock" title="Κλειδωμένη βαθμολογία — ο καθηγητής δεν μπορεί να την αλλάξει">' + icon('lock', 'width="12" height="12"') + '</span>' : '') +
        '<button class="subj-export" data-action="exportSubject" data-id="' + s.id + '" title="Εξαγωγή βαθμολογίας του μαθήματος (Α.Μ. + βαθμός, ένα φύλλο ανά τμήμα + φύλλο «Re-exam»)">' + icon('download') + '</button></div></th>';
    });
    h += '<th style="min-width:70px"><div class="th-in">Μ.Ο.</div></th><th style="min-width:190px;text-align:left"><div class="th-in">Αποτέλεσμα</div></th></tr></thead><tbody>';
    rows.forEach((r) => {
      h += '<tr data-sid="' + r.student.id + '"><td class="am-cell sticky-1">' + esc(r.student.am) + '</td><td class="name-cell sticky-2"><a class="link" data-action="gbOpenStudent" data-id="' + r.student.id + '" style="color:var(--text)"><b>' + esc(r.student.lastName) + '</b> ' + esc(r.student.firstName) + '</a>' +
        (spec === 'ALL' && !unified ? ' ' + specBadge(r.student.specialty) : '') +
        (showSec ? ' <span class="badge badge-sec">' + esc(C.sectionName(F.levelId, r.section) || 'χωρίς τμήμα') + '</span>' : '') +
        (showPer ? ' ' + periodTag(r.period) : '') + '</td>';
      r.cells.forEach((c) => {
        h += re ? reCellHtml(r.student, c) : cellHtml(r.student, c);
      });
      h += '<td class="avg">' + (r.result.avg !== null ? esc(C.formatGrade(r.result.avg)) : '<span class="faint">—</span>') + '</td><td class="res">' + (r.withdrawn ? '<span class="badge badge-sec">Διέκοψε τη φοίτηση</span>' : resultBadge(r.result)) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td class="sticky-1"></td><td class="sticky-2">' + (re ? 'Re-exam: καταχωρισμένα / σπουδαστές' : 'Μ.Ο. / καταχωρισμένοι') + '</td>';
    footCells(sheet, base).forEach((x) => (h += '<td>' + x + '</td>'));
    h += '<td></td><td></td></tr></tfoot></table></div></div>';
    return h;
  }

  function periodTag(period) {
    if (!period) return '<span class="badge badge-per none" title="Χωρίς περίοδο">χωρίς περίοδο</span>';
    return '<span class="badge badge-per" title="Περίοδος: ' + esc(C.periodName(period)) + '">' + esc(C.periodShort(period)) + '</span>';
  }

  /** Re-exam grades entered / students who sit it, over the given rows (visible subjects). */
  function reCounts(sheet, rows) {
    let done = 0;
    let total = 0;
    rows.forEach((r) =>
      r.cells.forEach((c) => {
        if (!c.applies || !c.grade || !C.needsReexam(c.grade)) return;
        total++;
        if (c.grade.re) done++;
      })
    );
    return { done, total };
  }

  /** Footer cell contents: normal mode → average + entered/expected; re-exam mode → re-exam entered / candidates. */
  function footCells(sheet, reRows) {
    if (!reMode()) return sheet.stats.map((st) => (st.avg !== null ? '<b>' + esc(C.formatGrade(st.avg)) + '</b>' : '—') + '<div>' + st.entered + '/' + st.expected + '</div>');
    return sheet.subjects.map((s, i) => {
      let n = 0;
      let done = 0;
      reRows.forEach((r) => {
        const c = r.cells[i];
        if (!c.applies || !c.grade || !C.needsReexam(c.grade)) return;
        n++;
        if (c.grade.re) done++;
      });
      return n ? '<b>' + done + '</b> / ' + n : '<span class="faint">—</span>';
    });
  }

  function isCode(g) {
    return !!g && !g.absent && !!C.ATT_TEXT[g.att] && Number(g.value) === 0;
  }

  /** «Απών», «0 – δικαιολογημένες απουσίες», «κάτω από 50%», «70–79%»… */
  function gradeDesc(g) {
    if (!g) return '';
    if (g.absent) return 'Απών';
    if (isCode(g)) return C.ATT_LABEL[g.att];
    return C.gradeBand(g.value);
  }

  function reBadge(g) {
    if (!g || !g.re) return '';
    return '<span class="re-badge ' + (C.isPassing(g) ? 'ok' : 'bad') + '">R' + esc(C.reText(g)) + '</span>';
  }

  function cellHtml(student, c) {
    if (!c.applies) return '<td class="g na" title="Δεν αφορά ' + esc(C.specialtyName(student.specialty) || 'την ειδικότητα') + '"></td>';
    const g = c.grade || c.carried;
    const look = cellLook(g, !c.grade && !!c.carried);
    return '<td class="' + look.cls + '" title="' + esc(look.title) + '"><input data-gsid="' + student.id + '" data-gsub="' + c.subject.id + '" value="' + esc(C.gradeText(g)) + '" data-orig="' + esc(C.gradeText(g)) + '" />' + reBadge(g) + '</td>';
  }

  /** Class + tooltip of a grade cell; carried = passed in an earlier academic year (student came back). */
  function cellLook(g, carried) {
    let cls = 'g';
    if (g) {
      cls += carried ? ' carried' : g.source === 'import' ? ' imported' : ' manual';
      if (!carried) {
        if (g.absent) cls += ' absent fail';
        else if (Number(g.value) < C.PASS_GRADE) cls += ' fail';
      }
      if (isCode(g)) cls += ' att';
      if (g.re) cls += ' has-re';
    }
    const reInfo = g && g.re ? 'Αρχικός: ' + C.gradeText(g) + ' · Re-exam: ' + C.reText(g) : '';
    let title = 'Χωρίς βαθμό';
    if (g && carried) title = 'Βαθμός από το ακαδημαϊκό έτος ' + C.yearLabel(S().db, g.yearId) + (reInfo ? ' (' + reInfo + ')' : '') + ' (ο σπουδαστής είχε περάσει το μάθημα) · γράψτε νέο βαθμό για να τον αντικαταστήσετε';
    else if (g) title = (reInfo || gradeDesc(g)) + ' · ' + (g.source === 'import' ? 'από Excel' : g.source === 'teacher' ? 'από καθηγητή' : 'χειροκίνητα') + (g.by ? ' · ' + g.by : '') + ' · ' + App.ui.fmtDate(g.updatedAt, true);
    return { cls, title };
  }

  /** Re-exam mode: failing original → small original + input for the re-exam grade; else read-only final grade. */
  function reCellHtml(student, c) {
    if (!c.applies) return '<td class="g na" title="Δεν αφορά ' + esc(C.specialtyName(student.specialty) || 'την ειδικότητα') + '"></td>';
    const g = c.grade;
    if (g && C.needsReexam(g)) {
      const look = reLook(g);
      const txt = C.reText(g);
      return '<td class="' + look.cls + '" title="' + esc(look.title) + '"><span class="re-orig">' + esc(C.gradeText(g)) + '</span><input data-gsid="' + student.id + '" data-gsub="' + c.subject.id + '" data-re="1" value="' + esc(txt) + '" data-orig="' + esc(txt) + '" placeholder="—" /></td>';
    }
    const f = c.final;
    const carried = !c.grade && !!c.carried;
    let cls = 'g ro' + (carried ? ' carried' : '');
    if (f && !carried && (f.absent || Number(f.value) < C.PASS_GRADE)) cls += ' fail';
    const title = !f ? 'Χωρίς βαθμό' : carried ? 'Βαθμός από το ακαδημαϊκό έτος ' + C.yearLabel(S().db, c.carried.yearId) : 'Δεν χρειάζεται re-exam · ' + gradeDesc(f);
    return '<td class="' + cls + '" title="' + esc(title) + '"><span class="ro-val">' + (f ? esc(C.gradeText(f)) : '') + '</span></td>';
  }

  function reLook(g) {
    let cls = 'g re-edit';
    if (g.re) cls += C.isPassing(g) ? ' re-pass' : ' fail re-fail';
    const title = 'Αρχικός: ' + C.gradeText(g) + ' (' + C.gradeReason(g) + ')' + (g.re ? ' · Re-exam: ' + C.reText(g) + (g.re.by ? ' · ' + g.re.by : '') + (g.re.at ? ' · ' + App.ui.fmtDate(g.re.at, true) : '') : ' · γράψτε τον βαθμό της επαναληπτικής');
    return { cls, title };
  }

  function refreshRow(tr) {
    const { db, yearId } = S();
    const sid = tr.dataset.sid;
    const st = db.students.find((s) => s.id === sid);
    const res = C.studentResult(db, st, yearId, F.levelId);
    tr.querySelector('td.avg').innerHTML = res.avg !== null ? esc(C.formatGrade(res.avg)) : '<span class="faint">—</span>';
    const en = C.getEnrollment(db, sid, yearId);
    tr.querySelector('td.res').innerHTML = en && en.withdrawn ? '<span class="badge badge-sec">Διέκοψε τη φοίτηση</span>' : resultBadge(res);
  }

  function refreshFooter() {
    const { db, yearId } = S();
    const sheet = C.buildGradeSheet(db, yearId, F.levelId, curSpec(), curSection(), curPeriod());
    const reRows = reMode() ? sheet.rows.filter(needsRe) : sheet.rows;
    const tds = document.querySelectorAll('.gb tfoot td');
    footCells(sheet, reRows).forEach((x, i) => {
      const td = tds[i + 2];
      if (td) td.innerHTML = x;
    });
    if (reMode()) {
      const b = document.getElementById('gb-re-done');
      const rc = reCounts(sheet, reRows);
      if (b) b.textContent = 'Re-exam καταχωρισμένα ' + rc.done + ' / ' + rc.total;
    }
  }

  function commitCell(inp) {
    if (inp.dataset.re) return commitReexam(inp);
    const { yearId } = S();
    const val = inp.value.trim();
    if (val === inp.dataset.orig) return true;
    const p = C.parseManualGrade(val);
    if (p.error) {
      toast(esc(p.error), 'error');
      inp.value = inp.dataset.orig;
      return false;
    }
    const sid = inp.dataset.gsid;
    const sub = inp.dataset.gsub;
    const before = C.getGrade(S().db, sid, sub, yearId);
    const hadRe = !!(before && before.re);
    App.mutate(
      (d) => {
        if (p.clear) C.clearGrade(d, sid, sub, yearId);
        else C.setGrade(d, sid, sub, yearId, { value: p.value, absent: p.absent, att: p.att, source: 'manual' });
      },
      { render: false }
    );
    const own = C.getGrade(S().db, sid, sub, yearId);
    const carried = own ? null : C.carriedGrade(S().db, sid, sub, yearId);
    const g = own || carried;
    const txt = C.gradeText(g);
    inp.value = txt;
    inp.dataset.orig = txt;
    const td = inp.parentElement;
    const look = cellLook(g, !own && !!carried);
    td.className = look.cls;
    td.title = look.title;
    const old = td.querySelector('.re-badge');
    if (old) old.remove();
    const badge = reBadge(g);
    if (badge) td.insertAdjacentHTML('beforeend', badge);
    if (hadRe && !(own && own.re)) toast(p.clear ? 'Ο βαθμός διαγράφηκε μαζί με τον βαθμό re-exam.' : 'Ο νέος αρχικός βαθμός είναι προβιβάσιμος — ο βαθμός re-exam διαγράφηκε.', 'info');
    refreshRow(inp.closest('tr'));
    refreshFooter();
    return true;
  }

  /** Re-exam mode: save the re-exam grade (C.setReexam); the original grade stays. */
  function commitReexam(inp) {
    const { yearId } = S();
    const val = inp.value.trim();
    if (val === inp.dataset.orig) return true;
    const p = C.parseManualGrade(val);
    if (p.error) {
      toast(esc(p.error.replace('Μη έγκυρος βαθμός', 'Μη έγκυρος βαθμός re-exam')), 'error');
      inp.value = inp.dataset.orig;
      return false;
    }
    const sid = inp.dataset.gsid;
    const sub = inp.dataset.gsub;
    try {
      App.mutate((d) => C.setReexam(d, sid, sub, yearId, p.clear ? { clear: true } : { value: p.value, absent: p.absent, att: p.att }, username()), { render: false });
    } catch (e) {
      toast(esc(e.message || String(e)), 'error');
      inp.value = inp.dataset.orig;
      return false;
    }
    const g = C.getGrade(S().db, sid, sub, yearId);
    const txt = C.reText(g);
    inp.value = txt;
    inp.dataset.orig = txt;
    const td = inp.parentElement;
    if (g) {
      const look = reLook(g);
      td.className = look.cls;
      td.title = look.title;
    }
    refreshRow(inp.closest('tr'));
    refreshFooter();
    return true;
  }

  function moveFocus(inp, dRow, dCol) {
    const tr = inp.closest('tr');
    if (!tr) return;
    const td = inp.parentElement;
    const colIdx = Array.from(tr.children).indexOf(td);
    let target = null;
    if (dRow) {
      let r = dRow > 0 ? tr.nextElementSibling : tr.previousElementSibling;
      while (r && !target) {
        const cell = r.children[colIdx];
        target = cell && cell.querySelector('input');
        if (!target) r = dRow > 0 ? r.nextElementSibling : r.previousElementSibling;
      }
    } else {
      let c = dCol > 0 ? td.nextElementSibling : td.previousElementSibling;
      while (c && !target) {
        target = c.querySelector('input');
        if (!target) c = dCol > 0 ? c.nextElementSibling : c.previousElementSibling;
      }
    }
    if (target) {
      target.focus();
      target.select();
    }
  }

  function wireGrid() {
    const host = document.getElementById('gb-host');
    if (!host) return;
    host.addEventListener('focusin', (e) => {
      if (e.target.matches('input[data-gsid]')) e.target.select();
    });
    host.addEventListener('focusout', (e) => {
      if (e.target.matches('input[data-gsid]')) commitCell(e.target);
    });
    host.addEventListener('keydown', (e) => {
      const inp = e.target;
      if (!inp.matches('input[data-gsid]')) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (commitCell(inp)) moveFocus(inp, 1, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commitCell(inp)) moveFocus(inp, -1, 0);
      } else if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) {
        e.preventDefault();
        if (commitCell(inp)) moveFocus(inp, 0, 1);
      } else if (e.key === 'ArrowLeft' && inp.selectionStart === 0) {
        e.preventDefault();
        if (commitCell(inp)) moveFocus(inp, 0, -1);
      } else if (e.key === 'Escape') {
        inp.value = inp.dataset.orig;
        inp.blur();
      } else if (e.key === 'Delete' && inp.selectionStart === 0 && inp.selectionEnd === inp.value.length) {
        inp.value = '';
      }
    });
  }

  App.actions.gbLevel = (el) => {
    if (F.levelId !== el.dataset.level) {
      F.section = 'ALL';
      F.period = 'ALL';
    }
    F.levelId = el.dataset.level;
    App.render();
  };
  App.changes.gbSection = (el) => {
    F.section = el.value;
    App.render();
  };
  App.changes.gbPeriod = (el) => {
    F.period = el.value;
    App.render();
  };
  App.actions.gbMode = (el) => {
    F.mode = el.dataset.v === 'reexam' ? 'reexam' : 'normal';
    App.render();
  };
  App.changes.gbShift = (el) => {
    const { db, yearId } = S();
    App.mutate((d) => C.setMgmtShift(d, yearId, F.levelId, F.spec, el.value || null));
    toast(esc(C.levelName(db, F.levelId, F.spec)) + ': ' + (el.value ? esc(C.sectionName(F.levelId, el.value)) : 'χωρίς τμήμα') + ' για το ' + esc(C.yearLabel(db, yearId)));
  };
  App.actions.gbSpec = (el) => {
    F.spec = el.dataset.v;
    App.render();
  };
  App.inputs.gbSearch = App.ui.debounce((el) => {
    F.q = el.value;
    document.getElementById('gb-host').innerHTML = gridHtml();
  }, 150);
  App.actions.gbOpenStudent = (el) => App.openStudentCard(el.dataset.id, 'grades');

  App.actions.gbExport = async () => {
    const { db, yearId } = S();
    const spec = curSpec();
    const section = curSection();
    const period = curPeriod();
    const specs = spec === 'ALL' ? ['DECK', 'ENGINE', 'NONE'] : [spec];
    const r = window.XL.buildGradeExport(db, { yearId, levelIds: [F.levelId], specialties: specs, section, period, includePercent: true, includeStats: true, includeFather: false });
    if (!r.studentsWritten) return toast('Δεν υπάρχουν σπουδαστές για εξαγωγή.', 'warn');
    const specOn = spec === 'DECK' || spec === 'ENGINE';
    const per = period !== 'ALL' && period !== 'NONE' ? C.classPeriod(db, F.levelId, period) : null;
    let label = section !== 'ALL' && section !== 'NONE' ? C.classShortName(F.levelId, specOn ? spec : null, section, per) : C.levelShort(F.levelId, spec) + (specOn && !C.isSplitLevel(F.levelId) ? ' ' + C.specialtyName(spec) : '') + (per ? ' ' + C.periodShort(per) : '');
    if (period === 'NONE') label += ' χωρίς περίοδο';
    await App.saveWorkbook(r.wb, window.XL.fileSafe('Συνολική_Βαθμολογία_' + C.yearLabel(db, yearId) + '_' + label) + '.xlsx');
  };

  App.actions.gbTemplates = () => App.teacherTemplateModal(null, F.levelId, F.spec);

  /** Shared: export an AM list for a teacher to fill in. */
  App.teacherTemplateModal = function (subjectId, levelId, spec) {
    const { db, yearId } = S();
    const pickStudents = (s, key) => {
      const groups = C.subjectRosterByClass(db, s, yearId);
      const group = key && key !== 'ALL' ? groups.find((g) => g.key === key) || null : null;
      const rows = group ? group.rows : groups.reduce((a, g) => a.concat(g.rows), []);
      return { group, students: rows.map((x) => x.student) };
    };
    const subj0 = subjectId ? db.subjects.find((s) => s.id === subjectId) : null;
    const lvl0 = subj0 ? subj0.levelId : levelId || 'SUP';
    const subjOpts = (lvl) => C.subjectsOfLevel(db, lvl).filter((s) => s.active !== false).map((s) => ({ value: s.id, label: C.subjectLabel(s) + (s.specialty !== 'COMMON' ? ' (' + C.specialtyName(s.specialty) + ')' : '') }));
    openModal({
      title: 'Πρότυπο βαθμολογίου για καθηγητή',
      sub: 'Excel με τους αριθμούς μητρώου — ο καθηγητής συμπληρώνει μόνο τη στήλη «Βαθμός» (0–5, ΑΠ, 0Δ ή 0Α)',
      body:
        '<div class="form-grid">' +
        '<div class="field span-2"><label>Επίπεδο</label><select class="select" id="tt-level">' + options(C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(db, l.id) })), lvl0) + '</select></div>' +
        '<div class="field span-2"><label>Μάθημα</label><select class="select" id="tt-subj"></select></div>' +
        '<div class="field span-2"><label>Τμήμα</label><select class="select" id="tt-class"></select></div>' +
        '<label class="checkbox span-2"><input type="checkbox" id="tt-names" /> Να περιλαμβάνονται και τα ονόματα (αλλιώς μόνο Α.Μ.)</label>' +
        '<label class="checkbox span-2"><input type="checkbox" id="tt-prefill" /> Προσυμπλήρωση με τους ήδη καταχωρισμένους βαθμούς</label>' +
        '</div><div id="tt-info" class="small muted" style="margin-top:12px"></div>',
      onMount(ctx) {
        const fill = () => {
          const lvl = ctx.q('#tt-level').value;
          const opts = subjOpts(lvl);
          ctx.q('#tt-subj').innerHTML = opts.length ? options(opts, subj0 && subj0.levelId === lvl ? subj0.id : opts[0].value) : '<option value="">— Δεν υπάρχουν μαθήματα —</option>';
          classes();
        };
        const classes = () => {
          const s = db.subjects.find((x) => x.id === ctx.q('#tt-subj').value);
          const groups = s ? C.subjectRosterByClass(db, s, yearId) : [];
          ctx.q('#tt-class').innerHTML = options([{ value: 'ALL', label: 'Όλα τα τμήματα' }].concat(groups.map((g) => ({ value: g.key, label: g.name + ' (' + g.rows.length + ')' }))), 'ALL');
          info();
        };
        const info = () => {
          const s = db.subjects.find((x) => x.id === ctx.q('#tt-subj').value);
          if (!s) return (ctx.q('#tt-info').textContent = '');
          const list = pickStudents(s, ctx.q('#tt-class').value).students;
          const nRe = list.filter((st) => C.needsReexam(C.getGrade(db, st.id, s.id, yearId))).length;
          ctx.q('#tt-info').innerHTML = 'Θα περιληφθούν <b>' + plural(list.length, 'σπουδαστής', 'σπουδαστές') + '</b> (' + esc(C.yearLabel(db, yearId)) + ').' + (list.length ? ' Φύλλο «Re-exam»: ' + plural(nRe, 'σπουδαστής', 'σπουδαστές') + '.' : '');
        };
        ctx.q('#tt-level').addEventListener('change', fill);
        ctx.q('#tt-subj').addEventListener('change', classes);
        ctx.q('#tt-class').addEventListener('change', info);
        fill();
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Δημιουργία Excel',
          cls: 'btn-primary',
          icon: 'download',
          onClick: async (ctx) => {
            const s = db.subjects.find((x) => x.id === ctx.q('#tt-subj').value);
            if (!s) throw new Error('Επιλέξτε μάθημα.');
            const pick = pickStudents(s, ctx.q('#tt-class').value);
            const students = pick.students;
            if (!students.length) throw new Error('Δεν υπάρχουν εγγεγραμμένοι σπουδαστές για αυτό το μάθημα στο ' + C.yearLabel(db, yearId) + '.');
            const r = window.XL.buildTeacherTemplate(db, { subject: s, students, yearId, className: pick.group ? pick.group.name : null, includeNames: ctx.q('#tt-names').checked, prefill: ctx.q('#tt-prefill').checked });
            const name = window.XL.fileSafe('Βαθμολόγιο_' + (s.code || s.name) + (pick.group ? '_' + pick.group.short : '') + '_' + C.yearLabel(db, yearId)) + '.xlsx';
            const saved = await App.saveWorkbook(r.wb, name);
            if (!saved) return false;
          },
        },
      ],
    });
  };
})();
