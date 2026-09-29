/* Μητρώο σπουδαστών: list, filters, student card, enrollment, promotion. */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, fmtDate, plural, options, toast, openModal, confirmDialog, emptyState, specBadge, resultBadge } = App.ui;

  const F = { q: '', scope: 'year', level: 'ALL', spec: 'ALL', section: 'ALL', period: 'ALL', status: 'ALL', selected: new Set() };

  function S() {
    return App.S;
  }

  /** Period filter choices of a level (null when it has fewer than two periods). */
  function periodFilterOptions(levelId) {
    const { db, yearId } = S();
    const lp = C.levelPeriods(db, levelId);
    if (lp.length < 2) return null;
    const list = [{ value: 'ALL', label: 'Όλες οι περίοδοι' }].concat(lp.map((p) => ({ value: p.id, label: p.name })));
    if (db.enrollments.some((e) => e.yearId === yearId && e.levelId === levelId && !e.period)) list.push({ value: 'NONE', label: 'Χωρίς περίοδο' });
    return list;
  }

  function anyPeriods(db) {
    return C.LEVEL_IDS.some((l) => C.levelHasPeriods(db, l));
  }

  /** Small tag with the period of an enrollment (a warning tag when its level has periods but it has none). */
  function periodTag(en) {
    if (!en) return '';
    if (en.period) return '<span class="badge badge-period" title="' + esc(C.periodName(en.period)) + '">' + esc(C.periodShort(en.period)) + '</span>';
    return C.levelHasPeriods(S().db, en.levelId) ? '<span class="badge badge-period none" title="Δεν έχει οριστεί περίοδος">Χωρίς</span>' : '<span class="faint">—</span>';
  }

  /**
   * Keep a «Περίοδος» select in step with a level select: hidden when the level has no periods,
   * fixed (auto-selected) when it has one. o.keep: label of a first «no change» choice (bulk edits).
   */
  function wirePeriodSelect(ctx, levelSel, perSel, fieldSel, initial, o) {
    const lvl = ctx.q(levelSel);
    const per = ctx.q(perSel);
    const field = ctx.q(fieldSel);
    const hint = field ? field.querySelector('.hint') : null;
    const upd = (keep) => {
      const lp = lvl.value ? C.levelPeriods(S().db, lvl.value) : [];
      const cur = keep !== undefined ? keep : per.value;
      if (field) field.classList.toggle('hidden', !lp.length);
      if (hint) hint.textContent = '';
      if (!lp.length) {
        per.innerHTML = '<option value="">—</option>';
        per.disabled = true;
        return;
      }
      if (lp.length === 1) {
        per.innerHTML = options([{ value: lp[0].id, label: lp[0].name }], lp[0].id);
        per.disabled = true;
        if (hint) hint.textContent = 'Το επίπεδο έχει μία περίοδο — ορίζεται αυτόματα.';
        return;
      }
      const list = (o && o.keep ? [{ value: '__keep', label: o.keep }] : []).concat([{ value: '', label: '— Χωρίς περίοδο —' }]).concat(lp.map((p) => ({ value: p.id, label: p.name })));
      per.innerHTML = options(list, list.some((x) => x.value === cur) ? cur : list[0].value);
      per.disabled = false;
    };
    lvl.addEventListener('change', () => upd());
    upd(initial || '');
  }
  App.wirePeriodSelect = wirePeriodSelect;

  /** Value of a select wired by wirePeriodSelect: a period id, null (none) or undefined (no periods / keep / automatic). */
  function periodValue(ctx, perSel) {
    const el = ctx.q(perSel);
    if (!el || el.closest('.hidden') || el.value === '__keep') return undefined;
    if (el.disabled) return el.value || undefined;
    return el.value || null;
  }

  /** Level choices; with a specialty the Management levels read "Management Deck/Engine Function N". */
  function levelOptions(withAll, allLabel, spec) {
    const list = C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(S().db, l.id, spec) }));
    if (withAll) list.unshift({ value: 'ALL', label: allLabel || 'Όλα τα επίπεδα' });
    return list;
  }

  /** Section choices for a level ('' = none). Management has one shift for the whole class. */
  function sectionChoices(levelId, withNone) {
    if (!levelId || C.isShiftLevel(levelId)) return [];
    const list = C.levelSections(levelId).map((s) => ({ value: s.id, label: s.name }));
    if (withNone) list.unshift({ value: '', label: '— Χωρίς τμήμα —' });
    return list;
  }

  /** Label for the Τμήμα column, e.g. "Morning 1", "Afternoon" (Management: the class shift). */
  function sectionLabel(s, en) {
    if (!en) return '';
    const sec = C.studentSection(S().db, s, S().yearId, en);
    return sec ? C.sectionName(en.levelId, sec) : '';
  }

  function computeRows() {
    const { db, yearId } = S();
    const gidx = C.buildGradeIndex(db, yearId);
    const enrollByStudent = new Map(db.enrollments.filter((e) => e.yearId === yearId).map((e) => [e.studentId, e]));
    const q = C.normText(F.q);
    let list = db.students.map((s) => {
      const en = enrollByStudent.get(s.id) || null;
      const res = en ? C.studentResult(db, s, yearId, en.levelId, gidx) : null;
      return { s, en, res };
    });
    if (F.scope === 'year') list = list.filter((r) => r.en);
    if (F.level !== 'ALL') list = list.filter((r) => r.en && r.en.levelId === F.level);
    if (F.level !== 'ALL' && F.section !== 'ALL') {
      list = list.filter((r) => {
        const sec = C.studentSection(db, r.s, yearId, r.en);
        return F.section === 'NONE' ? !sec : sec === F.section;
      });
    }
    if (F.level !== 'ALL' && F.period !== 'ALL') list = list.filter((r) => r.en && (F.period === 'NONE' ? !r.en.period : r.en.period === F.period));
    if (F.spec !== 'ALL') list = list.filter((r) => (F.spec === 'NONE' ? !r.s.specialty : r.s.specialty === F.spec));
    if (F.status !== 'ALL') {
      list = list.filter((r) => {
        if (F.status === 'unenrolled') return !r.en;
        if (F.status === 'withdrawn') return r.en && r.en.withdrawn;
        return r.res && r.res.status === F.status;
      });
    }
    if (q) {
      list = list.filter((r) => {
        const hay = C.normText([r.s.am, r.s.lastName, r.s.firstName, r.s.fatherName, r.s.email].join(' '));
        return q.split(' ').every((t) => hay.includes(t));
      });
    }
    list.sort(
      (a, b) =>
        (F.scope === 'year' && F.level === 'ALL' && a.en && b.en ? C.LEVEL_IDS.indexOf(a.en.levelId) - C.LEVEL_IDS.indexOf(b.en.levelId) : 0) ||
        (a.en && b.en && a.en.levelId === b.en.levelId ? C.periodIndex(a.en.period) - C.periodIndex(b.en.period) : 0) ||
        (a.en && b.en && a.en.levelId === b.en.levelId ? C.sectionIndex(a.en.levelId, C.studentSection(db, a.s, yearId, a.en)) - C.sectionIndex(b.en.levelId, C.studentSection(db, b.s, yearId, b.en)) : 0) ||
        C.compareText(a.s.lastName, b.s.lastName) ||
        C.compareText(a.s.firstName, b.s.firstName)
    );
    return list;
  }

  App.pages.students = {
    subtitle: () => 'Σπουδαστές, αριθμοί μητρώου και εγγραφές ανά ακαδημαϊκό έτος',
    setLevel(l) {
      F.level = l;
      F.section = 'ALL';
      F.period = 'ALL';
    },
    render() {
      const { db, yearId } = S();
      const yl = C.yearLabel(db, yearId);
      const perOpts = F.level !== 'ALL' ? periodFilterOptions(F.level) : null;
      if (!perOpts || !perOpts.some((o) => o.value === F.period)) F.period = 'ALL';
      let h = '<div class="page">';
      h += '<div class="toolbar">' +
        '<div class="seg"><button class="' + (F.scope === 'year' ? 'on' : '') + '" data-action="stScope" data-v="year">Εγγεγραμμένοι ' + esc(yl) + '</button><button class="' + (F.scope === 'all' ? 'on' : '') + '" data-action="stScope" data-v="all">Όλο το μητρώο</button></div>' +
        '<div class="spacer"></div>' +
        '<button class="btn" data-action="transferModal" title="Μεταφορά σπουδαστών σε άλλο έτος, επίπεδο ή τμήμα">' + icon('graduation') + 'Μεταφορά σπουδαστών</button>' +
        '<button class="btn" data-action="go" data-page="import" data-tab="students">' + icon('upload') + 'Εισαγωγή Excel</button>' +
        '<button class="btn btn-primary" data-action="newStudent">' + icon('plus') + 'Νέος σπουδαστής</button>' +
        '</div><div class="toolbar">' +
        '<input class="input input-search" id="st-search" placeholder="Αναζήτηση ονόματος ή Α.Μ." value="' + esc(F.q) + '" data-on-input="stSearch" />' +
        '<select class="select" style="max-width:300px" data-on-change="stLevel">' + options(levelOptions(true), F.level) + '</select>' +
        (F.level !== 'ALL' && !C.isShiftLevel(F.level)
          ? '<select class="select" data-on-change="stSection">' + options([{ value: 'ALL', label: 'Όλα τα τμήματα' }].concat(sectionChoices(F.level, false)).concat([{ value: 'NONE', label: 'Χωρίς τμήμα' }]), F.section) + '</select>'
          : '') +
        (perOpts ? '<select class="select" id="st-period" data-on-change="stPeriod" title="Περίοδος (κύκλος έναρξης)">' + options(perOpts, F.period) + '</select>' : '') +
        '<select class="select" data-on-change="stSpec">' + options([{ value: 'ALL', label: 'Deck & Engine' }, { value: 'DECK', label: 'Deck' }, { value: 'ENGINE', label: 'Engine' }, { value: 'NONE', label: 'Χωρίς ειδικότητα' }], F.spec) + '</select>' +
        '<select class="select" data-on-change="stStatus">' + options([{ value: 'ALL', label: 'Κάθε κατάσταση' }, { value: 'pass', label: 'Επιτυχία' }, { value: 'fail', label: 'Υπολείπονται' }, { value: 'incomplete', label: 'Εκκρεμούν βαθμοί' }, { value: 'withdrawn', label: 'Διέκοψαν τη φοίτηση' }, { value: 'unenrolled', label: 'Χωρίς εγγραφή ' + yl }], F.status) + '</select>' +
        '</div>';
      h += '<div id="st-table-host">' + tableHtml() + '</div>';
      h += '</div>';
      return h;
    },
    mount() {
      const s = document.getElementById('st-search');
      if (s && F.q) {
        s.focus();
        s.setSelectionRange(F.q.length, F.q.length);
      }
    },
  };

  function tableHtml() {
    const { db, yearId } = S();
    const rows = computeRows();
    const yl = C.yearLabel(db, yearId);
    // prune selection to visible
    const visible = new Set(rows.map((r) => r.s.id));
    Array.from(F.selected).forEach((id) => {
      if (!db.students.some((s) => s.id === id)) F.selected.delete(id);
    });
    if (!db.students.length) {
      return '<div class="card">' + emptyState('users', 'Το μητρώο είναι άδειο', 'Εισάγετε τους σπουδαστές από ένα αρχείο Excel με <b>ονοματεπώνυμο</b> και <b>αριθμό μητρώου (Α.Μ.)</b>, ή προσθέστε τους έναν-έναν.',
        '<div class="row" style="justify-content:center"><button class="btn btn-primary" data-action="go" data-page="import" data-tab="students">' + icon('upload') + 'Εισαγωγή από Excel</button><button class="btn" data-action="newStudent">' + icon('plus') + 'Νέος σπουδαστής</button></div>') + '</div>';
    }
    let h = '<div class="card"><div class="card-head"><div><h3>' + plural(rows.length, 'σπουδαστής', 'σπουδαστές') + '</h3><div class="sub">' +
      (F.scope === 'year' ? 'Εγγεγραμμένοι στο ακαδημαϊκό έτος ' + esc(yl) : 'Όλοι οι σπουδαστές του μητρώου · επίπεδο & βαθμοί για ' + esc(yl)) +
      '</div></div><button class="btn btn-sm btn-ghost" data-action="exportRegistry">' + icon('download') + 'Εξαγωγή λίστας</button></div>';
    if (!rows.length) {
      h += emptyState('users', 'Κανένα αποτέλεσμα', F.scope === 'year' && !F.q ? 'Δεν υπάρχουν εγγεγραμμένοι σπουδαστές στο ' + esc(yl) + ' για αυτά τα φίλτρα. Δείτε «Όλο το μητρώο» ή χρησιμοποιήστε «Μεταφορά σπουδαστών».' : 'Δοκιμάστε διαφορετική αναζήτηση ή φίλτρα.') + '</div>';
      return h;
    }
    const allSel = rows.length && rows.every((r) => F.selected.has(r.s.id));
    const showPer = anyPeriods(db) || rows.some((r) => r.en && r.en.period);
    h += '<div class="table-wrap" style="max-height:calc(100vh - 260px)"><table class="table table-compact"><thead><tr>' +
      '<th class="chk"><input type="checkbox" data-on-change="stSelAll" ' + (allSel ? 'checked' : '') + ' /></th>' +
      '<th>Α.Μ.</th><th>Επώνυμο</th><th>Όνομα</th><th>Πατρώνυμο</th><th>Ειδικότητα</th><th>Επίπεδο ' + esc(yl) + '</th><th>Τμήμα</th>' + (showPer ? '<th>Περίοδος</th>' : '') + '<th class="num">Βαθμοί</th><th class="num">Μ.Ο.</th><th>Κατάσταση</th></tr></thead><tbody>';
    rows.forEach((r) => {
      const sel = F.selected.has(r.s.id);
      const cls = r.en ? C.studentClass(db, r.s, yearId, r.en) : null;
      h += '<tr class="clickable' + (sel ? ' selected' : '') + '" data-action="openStudent" data-id="' + r.s.id + '">' +
        '<td class="chk" data-stop><input type="checkbox" data-on-change="stSel" data-id="' + r.s.id + '" ' + (sel ? 'checked' : '') + ' /></td>' +
        '<td class="am">' + esc(r.s.am) + '</td>' +
        '<td class="strong">' + esc(r.s.lastName) + '</td><td>' + esc(r.s.firstName) + '</td><td class="muted">' + esc(r.s.fatherName || '') + '</td>' +
        '<td>' + specBadge(r.s.specialty) + '</td>' +
        '<td>' + (r.en ? '<span class="badge badge-level" title="' + esc(cls ? cls.name : '') + '">' + esc(C.levelShort(r.en.levelId, r.s.specialty)) + '</span>' : '<span class="faint">Χωρίς εγγραφή</span>') + '</td>' +
        '<td>' + (r.en ? (sectionLabel(r.s, r.en) ? '<span class="badge badge-sec">' + esc(sectionLabel(r.s, r.en)) + '</span>' : '<span class="faint">—</span>') : '') + '</td>' +
        (showPer ? '<td class="per-cell">' + periodTag(r.en) + '</td>' : '') +
        '<td class="num">' + (r.res ? r.res.total - r.res.missing + '/' + r.res.total : '') + '</td>' +
        '<td class="num strong">' + (r.res && r.res.avg !== null ? C.formatGrade(r.res.avg) : '') + '</td>' +
        '<td>' + (r.en && r.en.withdrawn ? '<span class="badge badge-sec">Διέκοψε</span>' : r.res ? resultBadge(r.res) : '') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    if (F.selected.size) {
      h += '<div class="selection-bar"><b>' + plural(F.selected.size, 'επιλεγμένος', 'επιλεγμένοι') + '</b><div class="spacer"></div>' +
        '<button class="btn btn-sm" data-action="bulkEnroll">' + icon('layers') + 'Επίπεδο & τμήμα (' + esc(yl) + ')</button>' +
        (anyPeriods(db) ? '<button class="btn btn-sm" data-action="bulkPeriod">' + icon('calendar') + 'Ορισμός περιόδου</button>' : '') +
        '<button class="btn btn-sm" data-action="bulkSpec">Ορισμός ειδικότητας</button>' +
        '<button class="btn btn-sm" data-action="bulkTransfer">' + icon('graduation') + 'Μεταφορά</button>' +
        '<button class="btn btn-sm" data-action="bulkTranscripts">' + icon('download') + 'Αναλυτικές Excel</button>' +
        '<button class="btn btn-sm" data-action="bulkWithdraw" title="Σταμάτησαν μέσα στη χρονιά">Διακοπή φοίτησης</button>' +
        '<button class="btn btn-sm" data-action="bulkUnenroll">Αφαίρεση από ' + esc(yl) + '</button>' +
        '<button class="btn btn-sm btn-danger" data-action="bulkDelete">' + icon('trash') + 'Διαγραφή</button>' +
        '<button class="btn btn-sm btn-icon" data-action="clearSel" title="Καθαρισμός επιλογής">' + icon('x') + '</button></div>';
    }
    return h;
  }

  function refreshTable() {
    const host = document.getElementById('st-table-host');
    if (host) host.innerHTML = tableHtml();
  }

  App.inputs.stSearch = App.ui.debounce((el) => {
    F.q = el.value;
    refreshTable();
  }, 120);
  App.actions.stScope = (el) => {
    F.scope = el.dataset.v;
    App.render();
  };
  App.changes.stLevel = (el) => {
    F.level = el.value;
    F.section = 'ALL';
    F.period = 'ALL';
    App.render();
  };
  App.changes.stSection = (el) => {
    F.section = el.value;
    refreshTable();
  };
  App.changes.stPeriod = (el) => {
    F.period = el.value;
    refreshTable();
  };
  App.changes.stSpec = (el) => {
    F.spec = el.value;
    refreshTable();
  };
  App.changes.stStatus = (el) => {
    F.status = el.value;
    if (el.value === 'unenrolled') F.scope = 'all';
    App.render();
  };
  App.changes.stSel = (el) => {
    if (el.checked) F.selected.add(el.dataset.id);
    else F.selected.delete(el.dataset.id);
    refreshTable();
  };
  App.changes.stSelAll = (el) => {
    const rows = computeRows();
    rows.forEach((r) => (el.checked ? F.selected.add(r.s.id) : F.selected.delete(r.s.id)));
    refreshTable();
  };
  App.actions.clearSel = () => {
    F.selected.clear();
    refreshTable();
  };

  // prevent row click when clicking the checkbox cell
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest('[data-stop]') && !e.target.matches('input')) {
        const cb = e.target.closest('[data-stop]').querySelector('input');
        if (cb) cb.click();
        e.stopPropagation();
      } else if (e.target.closest('[data-stop]')) e.stopPropagation();
    },
    true
  );

  // ------------------------------------------------------------ bulk actions
  App.actions.bulkEnroll = () => {
    const { db, yearId } = S();
    const ids = Array.from(F.selected);
    openModal({
      title: 'Επίπεδο & τμήμα',
      sub: plural(ids.length, 'σπουδαστής', 'σπουδαστές') + ' · Ακαδημαϊκό έτος ' + esc(C.yearLabel(db, yearId)),
      size: 'sm',
      body: '<div class="stack"><div class="field"><label>Επίπεδο</label><select class="select" id="be-level">' + options(levelOptions(false, null, commonSpec(ids)), F.level !== 'ALL' ? F.level : 'SUP') + '</select></div>' +
        '<div class="field" id="be-sec-field"><label>Τμήμα</label><select class="select" id="be-sec"></select><div class="hint" id="be-sec-hint"></div></div>' +
        '<div class="field" id="be-per-field"><label>Περίοδος</label><select class="select" id="be-per"></select><div class="hint"></div></div></div>' +
        '<p class="small muted" style="margin-bottom:0">Αν κάποιος σπουδαστής είναι ήδη εγγεγραμμένος σε άλλο επίπεδο αυτό το έτος, η εγγραφή του θα αλλάξει.</p>',
      onMount(ctx) {
        wireSectionSelect(ctx, '#be-level', '#be-sec', '#be-sec-hint', F.section !== 'ALL' && F.section !== 'NONE' ? F.section : '');
        wirePeriodSelect(ctx, '#be-level', '#be-per', '#be-per-field', F.period !== 'ALL' && F.period !== 'NONE' ? F.period : '__keep', { keep: '— Όπως είναι (ή αυτόματα) —' });
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εγγραφή',
          cls: 'btn-primary',
          onClick: (ctx) => {
            const lvl = ctx.q('#be-level').value;
            const sec = ctx.q('#be-sec').value || null;
            const per = periodValue(ctx, '#be-per');
            App.mutate((d) => ids.forEach((id) => C.setEnrollment(d, id, yearId, lvl, sec, per)));
            toast(plural(ids.length, 'σπουδαστής εγγράφηκε', 'σπουδαστές εγγράφηκαν') + ' στο ' + esc(C.levelName(db, lvl, commonSpec(ids))));
          },
        },
      ],
    });
  };

  /**
   * Keep a "Τμήμα" select in step with a level select. Management levels have no per-student
   * class (the whole class is morning or afternoon — set from the Βαθμολόγιο).
   */
  function wireSectionSelect(ctx, levelSel, secSel, hintSel, initial) {
    const lvl = ctx.q(levelSel);
    const sec = ctx.q(secSel);
    const hint = hintSel ? ctx.q(hintSel) : null;
    const upd = (keep) => {
      const levelId = lvl.value;
      const cur = keep !== undefined ? keep : sec.value;
      const shift = C.isShiftLevel(levelId);
      sec.innerHTML = shift || !levelId ? '<option value="">—</option>' : options(sectionChoices(levelId, true), cur);
      sec.disabled = shift || !levelId;
      if (hint) hint.textContent = shift ? 'Στα Management όλο το τμήμα είναι είτε πρωί είτε απόγευμα — ορίζεται από το Βαθμολόγιο.' : '';
    };
    lvl.addEventListener('change', () => upd());
    upd(initial || '');
  }
  App.wireSectionSelect = wireSectionSelect;

  function commonSpec(ids) {
    const specs = new Set(ids.map((id) => (S().db.students.find((s) => s.id === id) || {}).specialty || ''));
    return specs.size === 1 ? Array.from(specs)[0] : null;
  }

  App.actions.bulkSpec = () => {
    const ids = Array.from(F.selected);
    openModal({
      title: 'Ορισμός ειδικότητας',
      sub: plural(ids.length, 'σπουδαστής', 'σπουδαστές'),
      size: 'sm',
      body: '<div class="field"><label>Ειδικότητα</label><select class="select" id="bs-spec">' + options([{ value: 'DECK', label: 'Deck' }, { value: 'ENGINE', label: 'Engine' }], 'DECK') + '</select></div>',
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εφαρμογή',
          cls: 'btn-primary',
          onClick: (ctx) => {
            const sp = ctx.q('#bs-spec').value;
            App.mutate((d) => ids.forEach((id) => C.updateStudent(d, id, { specialty: sp })));
            toast('Η ειδικότητα ενημερώθηκε');
          },
        },
      ],
    });
  };

  /** Set the period (intake) of the selected students' enrollments in the working year. */
  App.actions.bulkPeriod = () => {
    const { db, yearId } = S();
    const yl = C.yearLabel(db, yearId);
    const ids = Array.from(F.selected).filter((id) => C.getEnrollment(db, id, yearId));
    if (!ids.length) return toast('Κανένας από τους επιλεγμένους δεν είναι εγγεγραμμένος στο ' + esc(yl), 'warn');
    const levelOf = (id) => C.getEnrollment(S().db, id, yearId).levelId;
    const levels = Array.from(new Set(ids.map(levelOf)));
    const pers = (db.settings.periods || []).filter((p) => levels.some((l) => C.validPeriodFor(db, l, p.id)));
    if (!pers.length) return toast('Τα επίπεδα των επιλεγμένων σπουδαστών δεν έχουν περιόδους (Ρυθμίσεις → Περίοδοι).', 'warn');
    const eligible = (per) => ids.filter((id) => !per || C.validPeriodFor(S().db, levelOf(id), per));
    const choices = pers.map((p) => ({ value: p.id, label: p.name })).concat([{ value: '', label: 'Χωρίς περίοδο' }]);
    openModal({
      title: 'Ορισμός περιόδου',
      sub: plural(ids.length, 'εγγεγραμμένος σπουδαστής', 'εγγεγραμμένοι σπουδαστές') + ' · Ακαδημαϊκό έτος ' + esc(yl),
      size: 'sm',
      body: '<div class="field"><label>Περίοδος</label><select class="select" id="bp-per">' + options(choices, pers.some((p) => p.id === F.period) ? F.period : pers[0].id) + '</select><div class="hint" id="bp-hint"></div></div>' +
        '<p class="small muted" style="margin-bottom:0">Η περίοδος αλλάζει μόνο σε όσους το επίπεδό τους την έχει. Επίπεδο με μία περίοδο την κρατά πάντα.</p>',
      onMount(ctx) {
        const sel = ctx.q('#bp-per');
        const upd = () => {
          const n = eligible(sel.value || null).length;
          ctx.q('#bp-hint').textContent = n === ids.length ? 'Ισχύει για όλους τους επιλεγμένους.' : 'Ισχύει για ' + n + ' από ' + ids.length + ' (οι άλλοι είναι σε επίπεδο χωρίς αυτή την περίοδο).';
        };
        sel.addEventListener('change', upd);
        upd();
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Εφαρμογή',
          cls: 'btn-primary',
          id: 'bp-ok',
          onClick: (ctx) => {
            const per = ctx.q('#bp-per').value || null;
            const list = eligible(per);
            if (!list.length) throw new Error('Η περίοδος δεν ισχύει για το επίπεδο κανενός επιλεγμένου σπουδαστή.');
            App.mutate((d) =>
              list.forEach((id) => {
                const en = C.getEnrollment(d, id, yearId);
                C.setEnrollment(d, id, yearId, en.levelId, undefined, per);
              })
            );
            const skipped = ids.length - list.length;
            toast('Περίοδος <b>' + esc(per ? C.periodName(per) : 'χωρίς') + '</b>: ' + plural(list.length, 'σπουδαστής', 'σπουδαστές') + (skipped ? ' · ' + skipped + ' παραλείφθηκαν (άλλο επίπεδο)' : ''), skipped ? 'warn' : 'success');
          },
        },
      ],
    });
  };

  App.actions.bulkWithdraw = async () => {
    const { db, yearId } = S();
    const ids = Array.from(F.selected).filter((id) => C.getEnrollment(db, id, yearId));
    if (!ids.length) return toast('Κανένας από τους επιλεγμένους δεν είναι εγγεγραμμένος στο ' + esc(C.yearLabel(db, yearId)), 'warn');
    const ok = await confirmDialog('Διακοπή φοίτησης', 'Να σημειωθεί ότι ' + plural(ids.length, 'σπουδαστής διέκοψε', 'σπουδαστές διέκοψαν') + ' τη φοίτηση στο <b>' + esc(C.yearLabel(db, yearId)) + '</b>;<br><br>Οι βαθμοί τους μένουν. Αν επιστρέψουν αργότερα στο ίδιο επίπεδο, τα μαθήματα που έχουν περάσει μεταφέρονται αυτόματα.', { okText: 'Σημείωση διακοπής' });
    if (!ok) return;
    App.mutate((d) => ids.forEach((id) => C.setWithdrawn(d, id, yearId, true)));
    toast('Σημειώθηκε διακοπή φοίτησης');
  };

  App.actions.bulkUnenroll = async () => {
    const { db, yearId } = S();
    const ids = Array.from(F.selected).filter((id) => C.getEnrollment(db, id, yearId));
    if (!ids.length) return toast('Κανένας από τους επιλεγμένους δεν είναι εγγεγραμμένος στο ' + esc(C.yearLabel(db, yearId)), 'warn');
    const ok = await confirmDialog('Αφαίρεση εγγραφής', 'Να αφαιρεθεί η εγγραφή ' + plural(ids.length, 'σπουδαστή', 'σπουδαστών') + ' από το ακαδημαϊκό έτος <b>' + esc(C.yearLabel(db, yearId)) + '</b>; Οι σπουδαστές και οι βαθμοί τους παραμένουν στο μητρώο.', { okText: 'Αφαίρεση' });
    if (!ok) return;
    App.mutate((d) => ids.forEach((id) => C.removeEnrollment(d, id, yearId)));
    toast('Οι εγγραφές αφαιρέθηκαν');
  };

  App.actions.bulkDelete = async () => {
    const { db } = S();
    const ids = Array.from(F.selected);
    const nGrades = db.grades.filter((g) => F.selected.has(g.studentId)).length;
    const ok = await confirmDialog('Οριστική διαγραφή', 'Να διαγραφούν οριστικά <b>' + plural(ids.length, 'σπουδαστής', 'σπουδαστές') + '</b>' + (nGrades ? ' μαζί με <b>' + plural(nGrades, 'βαθμό', 'βαθμούς') + '</b>' : '') + ' από το μητρώο;<br><br>Θα δημιουργηθεί αντίγραφο ασφαλείας πριν τη διαγραφή.', { danger: true, okText: 'Διαγραφή' });
    if (!ok) return;
    await App.backup('pre-delete');
    App.mutate((d) => ids.forEach((id) => C.deleteStudent(d, id)));
    F.selected.clear();
    App.render();
    toast('Η διαγραφή ολοκληρώθηκε');
  };

  App.actions.exportRegistry = async () => {
    const { db, yearId } = S();
    const r = window.XL.buildRegistryExport(db, { yearId: F.scope === 'year' ? yearId : null });
    const name = F.scope === 'year' ? 'Μητρώο_' + C.yearLabel(db, yearId) + '.xlsx' : 'Μητρώο_πλήρες.xlsx';
    await App.saveWorkbook(r.wb, name);
  };

  // ------------------------------------------------------------ transfer / transcripts of the selection
  App.actions.bulkTransfer = () => {
    const { yearId } = S();
    const next = App.neighbourYear(yearId, 1);
    App.transferModal({ studentIds: Array.from(F.selected), fromYearId: yearId, toYearId: next || yearId, mode: next ? 'auto' : 'fixed' });
  };
  App.actions.bulkTranscripts = () => App.transcriptsModal({ studentIds: Array.from(F.selected) });

  // ------------------------------------------------------------ student form
  function studentFormHtml(s, opts) {
    const { db, yearId } = S();
    const nextAm = C.suggestNextAm(db);
    let h = '<div class="form-grid">' +
      '<div class="field"><label>Αριθμός μητρώου (Α.Μ.) *</label><div class="row"><input class="input" id="sf-am" value="' + esc(s ? s.am : '') + '" autofocus />' +
      (!s && nextAm ? '<button class="btn btn-sm" type="button" id="sf-next" title="Συμπλήρωση επόμενου ελεύθερου Α.Μ.">' + esc(nextAm) + '</button>' : '') + '</div><div class="hint" id="sf-am-hint">Μοναδικός για κάθε σπουδαστή.</div></div>' +
      '<div class="field"><label>Ειδικότητα</label><select class="select" id="sf-spec">' + options([{ value: '', label: '— Επιλέξτε —' }, { value: 'DECK', label: 'Deck' }, { value: 'ENGINE', label: 'Engine' }], s ? s.specialty : (opts && opts.spec) || '') + '</select></div>' +
      '<div class="field"><label>Επώνυμο *</label><input class="input" id="sf-ln" value="' + esc(s ? s.lastName : '') + '" /></div>' +
      '<div class="field"><label>Όνομα *</label><input class="input" id="sf-fn" value="' + esc(s ? s.firstName : '') + '" /></div>' +
      '<div class="field"><label>Πατρώνυμο</label><input class="input" id="sf-fa" value="' + esc(s ? s.fatherName : '') + '" /></div>' +
      '<div class="field"><label>Τηλέφωνο</label><input class="input" id="sf-ph" value="' + esc(s ? s.phone : '') + '" /></div>' +
      '<div class="field span-2"><label>Email</label><input class="input" id="sf-em" value="' + esc(s ? s.email : '') + '" /></div>' +
      '<div class="field span-2"><label>Σημειώσεις</label><textarea class="textarea" id="sf-no" rows="2">' + esc(s ? s.notes : '') + '</textarea></div>';
    if (!s) {
      h += '<div class="field"><label>Εγγραφή στο ακαδημαϊκό έτος ' + esc(C.yearLabel(db, yearId)) + '</label><select class="select" id="sf-level">' + options([{ value: '', label: '— Χωρίς εγγραφή —' }].concat(levelOptions(false, null, s ? s.specialty : opts && opts.spec)), (opts && opts.level) || '') + '</select></div>' +
        '<div class="field"><label>Τμήμα</label><select class="select" id="sf-sec"></select><div class="hint" id="sf-sec-hint"></div></div>' +
        '<div class="field" id="sf-per-field"><label>Περίοδος</label><select class="select" id="sf-per"></select><div class="hint"></div></div>';
    }
    h += '</div>';
    return h;
  }

  function readStudentForm(ctx) {
    const data = {
      am: ctx.q('#sf-am').value.trim(),
      specialty: ctx.q('#sf-spec').value,
      lastName: ctx.q('#sf-ln').value.trim(),
      firstName: ctx.q('#sf-fn').value.trim(),
      fatherName: ctx.q('#sf-fa').value.trim(),
      phone: ctx.q('#sf-ph').value.trim(),
      email: ctx.q('#sf-em').value.trim(),
      notes: ctx.q('#sf-no').value.trim(),
    };
    if (!data.lastName || !data.firstName) throw new Error('Συμπληρώστε επώνυμο και όνομα.');
    return data;
  }

  function wireAmCheck(ctx, excludeId) {
    const inp = ctx.q('#sf-am');
    const hint = ctx.q('#sf-am-hint');
    const check = () => {
      const err = inp.value.trim() ? C.validateAm(S().db, inp.value, excludeId) : null;
      const same = !excludeId && err ? S().db.students.find((x) => C.normAm(x.am) === C.normAm(inp.value)) : null;
      inp.classList.toggle('invalid', !!err && !same);
      hint.textContent = same ? 'Ο Α.Μ. υπάρχει ήδη (' + C.studentName(same) + '). Αν είναι ο ίδιος σπουδαστής που μπαίνει σε άλλο τμήμα, συμπληρώστε το ονοματεπώνυμο και το νέο τμήμα — θα ζητηθεί επιβεβαίωση.' : err || 'Μοναδικός για κάθε σπουδαστή.';
      hint.className = 'hint' + (same ? ' warning-text' : err ? ' danger-text' : '');
    };
    inp.addEventListener('input', check);
    // keep the level names in step with the chosen specialty (Management Deck/Engine Function N)
    const lvl = ctx.q('#sf-level');
    const spec = ctx.q('#sf-spec');
    if (lvl && spec)
      spec.addEventListener('change', () => {
        const cur = lvl.value;
        lvl.innerHTML = options([{ value: '', label: '— Χωρίς εγγραφή —' }].concat(levelOptions(false, null, spec.value)), cur);
      });
    if (ctx.q('#sf-sec')) wireSectionSelect(ctx, '#sf-level', '#sf-sec', '#sf-sec-hint', ctx.initialSection || '');
    if (ctx.q('#sf-per')) wirePeriodSelect(ctx, '#sf-level', '#sf-per', '#sf-per-field', ctx.initialPeriod || '');
    const nb = ctx.q('#sf-next');
    if (nb)
      nb.addEventListener('click', () => {
        inp.value = nb.textContent;
        check();
        ctx.q('#sf-ln').focus();
      });
  }

  /**
   * Save the «Νέος σπουδαστής» form. If the Α.Μ. already exists with the same name, the user is asked
   * whether it is the same student entering another class — then the existing record is enrolled
   * (history and grades kept) instead of creating a duplicate.
   */
  async function saveNewStudent(ctx, again) {
    const { db, yearId } = S();
    const data = readStudentForm(ctx);
    const lvl = ctx.q('#sf-level').value;
    const sec = ctx.q('#sf-sec').value || null;
    const per = lvl ? periodValue(ctx, '#sf-per') : undefined; // id | null (none chosen) | undefined (level without periods)
    const ex = data.am ? db.students.find((x) => C.normAm(x.am) === C.normAm(data.am)) : null;
    let st;
    if (ex && C.nameMatch(data, ex)) {
      if (!lvl) throw new Error('Ο Α.Μ. ' + data.am + ' υπάρχει ήδη (' + C.studentName(ex) + '). Αν είναι ο ίδιος σπουδαστής, επιλέξτε το τμήμα στο οποίο μπαίνει.');
      const en = C.getEnrollment(db, ex.id, yearId);
      if (en && en.levelId === lvl && (C.isShiftLevel(lvl) || (en.section || null) === sec) && (!per || (en.period || null) === per))
        throw new Error(C.studentName(ex) + ' (Α.Μ. ' + ex.am + ') είναι ήδη εγγεγραμμένος/η σε αυτό το τμήμα για το ' + C.yearLabel(db, yearId) + '.');
      const spec = C.isUnifiedLevel(lvl) ? null : C.hasSpec(ex.specialty) ? ex.specialty : null;
      const shown = C.classPeriod(db, lvl, per || null);
      const idc = C.identityCheck(db, ex, yearId, lvl, sec, per || null) || {
        prev: { yearId, className: en ? '—' : 'Χωρίς εγγραφή σε τμήμα' },
        next: { yearId, className: C.isShiftLevel(lvl) ? C.levelName(db, lvl, spec) + (shown ? ' – ' + C.periodName(shown) : '') : C.classFullName(db, lvl, spec, sec, shown) },
      };
      const ans = await App.confirmSameStudents([{ key: ex.id, student: ex, fileName: C.studentName(data), match: C.nameMatch(data, ex), prev: idc.prev, next: idc.next }]);
      if (!ans) return false;
      if (ans.notSame.length) throw new Error('Ο Α.Μ. ' + data.am + ' ανήκει ήδη στον/στην ' + C.studentName(ex) + '. Δώστε άλλον Α.Μ. για τον νέο σπουδαστή.');
      st = App.mutate((d) => {
        const s0 = d.students.find((x) => x.id === ex.id);
        // no period chosen → keep his current one (same level) or the level's only period
        C.setEnrollment(d, s0.id, yearId, lvl, sec, per || undefined);
        return s0;
      });
      toast('<b>' + esc(C.studentName(st)) + '</b> (Α.Μ. ' + esc(st.am) + ') εγγράφηκε στο ' + esc(idc.next.className) + ' — το ιστορικό του διατηρείται');
    } else {
      st = App.mutate((d) => {
        const s0 = C.createStudent(d, data);
        if (lvl) C.setEnrollment(d, s0.id, yearId, lvl, sec, per);
        return s0;
      });
      toast('Καταχωρίστηκε: <b>' + esc(C.studentName(st)) + '</b> (Α.Μ. ' + esc(st.am) + ')');
    }
    if (again) {
      ctx.close();
      App.actions.newStudentKeep(data.specialty, lvl, sec, per || '');
    }
  }

  App.actions.newStudent = () => openStudentCreate(saveNewStudent, {});
  App.actions.newStudentKeep = (spec, level, section, period) => openStudentCreate(saveNewStudent, { spec, level, section, period });

  function openStudentCreate(onSave, opts) {
    openModal({
      title: 'Νέος σπουδαστής',
      size: 'lg',
      body: studentFormHtml(null, { spec: opts.spec || (F.spec === 'DECK' || F.spec === 'ENGINE' ? F.spec : ''), level: opts.level || (F.level !== 'ALL' ? F.level : '') }),
      onMount: (ctx) => {
        ctx.initialSection = opts.section || (F.section !== 'ALL' && F.section !== 'NONE' ? F.section : '');
        ctx.initialPeriod = opts.period || (F.period !== 'ALL' && F.period !== 'NONE' ? F.period : '');
        wireAmCheck(ctx, null);
      },
      buttons: [
        { label: 'Άκυρο' },
        { label: 'Αποθήκευση & νέος', onClick: (ctx) => onSave(ctx, true), keepOpen: true },
        { label: 'Αποθήκευση', cls: 'btn-primary', onClick: (ctx) => onSave(ctx, false) },
      ],
    });
  }

  // ------------------------------------------------------------ student card
  App.actions.openStudent = (el) => openStudentCard(el.dataset.id, 'grades');

  function openStudentCard(id, tab) {
    const { db } = S();
    const s = db.students.find((x) => x.id === id);
    if (!s) return;
    const initials = ((s.lastName || '?')[0] + (s.firstName || '')[0] || '').toUpperCase();
    const ctx = openModal({
      titleHtml: '<div class="student-head"><div class="avatar">' + esc(initials) + '</div><div><div>' + esc(C.studentName(s)) + '</div><div class="row" style="gap:6px;margin-top:4px"><span class="badge badge-info">Α.Μ. ' + esc(s.am) + '</span>' + App.ui.specBadge(s.specialty) + '</div></div></div>',
      size: 'xl',
      body: '<div class="tabs" id="sc-tabs"></div><div id="sc-body"></div>',
      buttons: [
        { label: 'Διαγραφή σπουδαστή', cls: 'btn-ghost danger-text', left: true, icon: 'trash', keepOpen: true, onClick: (c) => deleteOne(s, c) },
        { label: 'Αναλυτική σε Excel', icon: 'download', keepOpen: true, onClick: () => exportTranscript(s) },
        { label: 'Κλείσιμο' },
      ],
      onClose: () => App.render(),
    });
    const tabs = [
      { id: 'grades', label: 'Βαθμολογίες' },
      { id: 'absences', label: 'Απουσίες' },
      { id: 'info', label: 'Στοιχεία' },
      { id: 'enroll', label: 'Εγγραφές ανά έτος' },
    ];
    const show = (t) => {
      ctx.q('#sc-tabs').innerHTML = tabs.map((x) => '<button class="tab' + (x.id === t ? ' on' : '') + '" data-sctab="' + x.id + '">' + esc(x.label) + '</button>').join('');
      ctx.q('#sc-tabs').querySelectorAll('[data-sctab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.sctab)));
      const body = ctx.q('#sc-body');
      ctx.setError(null);
      if (t === 'grades') body.innerHTML = gradesTabHtml(s);
      if (t === 'absences') body.innerHTML = absencesTabHtml(s);
      if (t === 'info') {
        body.innerHTML = studentFormHtml(s) + '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="sf-save">' + icon('save') + 'Αποθήκευση στοιχείων</button></div>' +
          '<p class="small faint" style="margin-top:10px">Καταχώριση: ' + fmtDate(s.createdAt, true) + ' · Τελευταία αλλαγή: ' + fmtDate(s.updatedAt, true) + '</p>';
        wireAmCheck(ctx, s.id);
        ctx.q('#sf-save').addEventListener('click', () => {
          try {
            const data = readStudentForm(ctx);
            const oldAm = s.am;
            App.mutate((d) => C.updateStudent(d, s.id, data), { render: false });
            toast('Τα στοιχεία αποθηκεύτηκαν' + (oldAm !== s.am ? ' · νέος Α.Μ. <b>' + esc(s.am) + '</b>' : ''));
            ctx.close();
            openStudentCard(s.id, 'info');
          } catch (e) {
            ctx.setError(e.message);
          }
        });
      }
      if (t === 'enroll') {
        body.innerHTML = enrollTabHtml(s);
        body.querySelectorAll('[data-en-year]').forEach((sel) =>
          sel.addEventListener('change', () => {
            const y = sel.dataset.enYear;
            App.mutate((d) => (sel.value ? C.setEnrollment(d, s.id, y, sel.value) : C.removeEnrollment(d, s.id, y)), { render: false });
            toast('Η εγγραφή ενημερώθηκε');
            show('enroll');
          })
        );
        body.querySelectorAll('[data-en-wd]').forEach((cb) =>
          cb.addEventListener('change', () => {
            App.mutate((d) => C.setWithdrawn(d, s.id, cb.dataset.enWd, cb.checked), { render: false });
            toast(cb.checked ? 'Σημειώθηκε διακοπή φοίτησης για το ' + esc(C.yearLabel(S().db, cb.dataset.enWd)) : 'Αφαιρέθηκε η διακοπή φοίτησης');
            show('enroll');
          })
        );
        body.querySelectorAll('[data-en-sec]').forEach((sel) =>
          sel.addEventListener('change', () => {
            const y = sel.dataset.enSec;
            const en = C.getEnrollment(S().db, s.id, y);
            App.mutate((d) => C.setEnrollment(d, s.id, y, en.levelId, sel.value || null), { render: false });
            toast('Το τμήμα ενημερώθηκε');
            show('enroll');
          })
        );
        body.querySelectorAll('[data-en-per]').forEach((sel) =>
          sel.addEventListener('change', () => {
            const y = sel.dataset.enPer;
            const en = C.getEnrollment(S().db, s.id, y);
            App.mutate((d) => C.setEnrollment(d, s.id, y, en.levelId, undefined, sel.value || null), { render: false });
            toast('Η περίοδος ενημερώθηκε' + (sel.value ? ': <b>' + esc(C.periodName(sel.value)) + '</b>' : ''));
            show('enroll');
          })
        );
      }
    };
    show(tab || 'grades');
  }
  App.openStudentCard = openStudentCard;

  /** Hours of absence per academic year and subject against the subject's limit. */
  function absencesTabHtml(s) {
    const { db } = S();
    let h = '';
    C.sortYears(db.years).forEach((y) => {
      const en = C.getEnrollment(db, s.id, y.id);
      const att = C.attendance(db, y.id);
      const key = en ? C.studentCalendarKey(db, s, y.id, en) : null;
      const ids = new Set();
      if (key) att.cal.days.forEach((n, k) => k.startsWith(key + '|') && k.split('|').length === 5 && ids.add(k.slice(key.length + 1)));
      att.abs.bySubject.forEach((l, k) => k.startsWith(s.id + '|') && ids.add(k.slice(s.id.length + 1)));
      const subjects = db.subjects.filter((x) => ids.has(x.id)).sort((a, b) => C.LEVEL_IDS.indexOf(a.levelId) - C.LEVEL_IDS.indexOf(b.levelId) || a.order - b.order);
      if (!subjects.length) return;
      h += '<div class="section-title">' + esc(y.label) + (key ? ' · ' + esc(C.calendarClassName(db, y.id, key)) : '') + '</div><div class="card"><table class="table table-compact"><thead><tr><th>Μάθημα</th><th class="num">Ημέρες</th><th class="num">Όριο (ώρες)</th><th class="num">Ώρες απουσίας</th><th>Πότε</th></tr></thead><tbody>';
      subjects.forEach((sj) => {
        const st = C.absenceStatus(db, s, sj.id, y.id, att);
        h += '<tr><td class="strong">' + esc(C.subjectLabel(sj)) + '</td><td class="num">' + (st.days || '—') + '</td><td class="num">' + (st.limit === null ? '—' : st.limit) + '</td>' +
          '<td class="num' + (st.over ? ' danger-text strong' : '') + '">' + st.count + (st.over ? ' <span class="badge badge-danger">εκτός ορίου</span>' : '') + '</td>' +
          '<td class="small muted">' + esc(C.absenceEntriesText(st.entries).join(' · ')) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });
    return (
      (h || emptyState('calendar', 'Χωρίς απουσίες', 'Δεν υπάρχουν ημέρες μαθημάτων στο ημερολόγιο του τμήματός του ή απουσίες.')) +
      '<p class="small muted" style="margin-top:12px">Το όριο κάθε μαθήματος (σε ώρες) ορίζεται στα «Μαθήματα». Οι απουσίες αλλάζουν από το «Ημερολόγιο & απουσίες».</p>'
    );
  }

  function gradesTabHtml(s) {
    const { db } = S();
    const years = C.sortYears(db.years);
    let h = '';
    let any = false;
    years.forEach((y) => {
      const en = C.getEnrollment(db, s.id, y.id);
      const gy = db.grades.filter((g) => g.studentId === s.id && g.yearId === y.id);
      if (!en && !gy.length) return;
      any = true;
      const subjects = en ? C.gradebookSubjects(db, y.id, en.levelId, s.specialty || 'ALL') : [];
      const extra = gy.map((g) => db.subjects.find((x) => x.id === g.subjectId)).filter((x) => x && !subjects.includes(x));
      const res = en ? C.studentResult(db, s, y.id, en.levelId) : null;
      // other years in the same level (student left and came back)
      const sameLevel = en ? C.sortYears(db.years).filter((yy) => yy.id !== y.id && (C.getEnrollment(db, s.id, yy.id) || {}).levelId === en.levelId).map((yy) => yy.label).reverse() : [];
      const cls = en ? C.studentClass(db, s, y.id, en) : null;
      h += '<div class="year-block"><div class="year-block-head"><span class="strong">' + esc(y.label) + '</span>' + (cls ? '<span class="badge badge-level">' + esc(cls.name) + '</span>' + ((en.period ? !C.classPeriod(db, en.levelId, en.period) : C.levelHasPeriods(db, en.levelId)) ? periodTag(en) : '') : '<span class="badge badge-warning">Χωρίς εγγραφή</span>') +
        (en && en.withdrawn ? '<span class="badge badge-sec">Διέκοψε τη φοίτηση</span>' : '') +
        (sameLevel.length ? '<span class="small muted">Το ίδιο επίπεδο και: ' + esc(sameLevel.join(', ')) + '</span>' : '') +
        '<div class="spacer"></div>' + (res ? '<span class="small muted">Μ.Ο.</span> <b>' + (res.avg !== null ? C.formatGrade(res.avg) : '—') + '</b> ' + App.ui.resultBadge(res) : '') + '</div>';
      if (!subjects.length && !extra.length) h += '<div class="card-body small muted">Δεν έχουν οριστεί μαθήματα για αυτό το επίπεδο.</div>';
      else {
        h += '<table class="table table-compact"><thead><tr><th>Κωδικός</th><th>Μάθημα</th><th>Ειδικότητα</th><th class="num">Συντ.</th><th class="center">Βαθμός</th><th>Αντιστοιχία</th><th>Προέλευση</th></tr></thead><tbody>';
        subjects.concat(extra).forEach((sub) => {
          const own = C.getGrade(db, s.id, sub.id, y.id);
          const carried = own ? null : C.carriedGrade(db, s.id, sub.id, y.id);
          const g = own || carried;
          const fail = g && (g.absent || g.value < C.PASS_GRADE);
          h += '<tr><td class="mono">' + esc(sub.code || '') + '</td><td>' + esc(sub.name) + (extra.includes(sub) ? ' <span class="badge badge-warning">άλλο επίπεδο</span>' : '') + '</td><td>' + App.ui.specBadge(sub.specialty) + '</td><td class="num">' + esc(C.formatGrade(sub.weight || 1)) + '</td>' +
            '<td class="center strong ' + (fail ? 'danger-text' : '') + '" style="font-size:14px">' + (g ? esc(C.gradeText(g)) : '<span class="faint">—</span>') + '</td>' +
            '<td class="small muted">' + (g ? (g.absent ? 'Απών' : esc(C.gradeBand(g.value)) + (g.percent !== null && g.percent !== undefined ? ' (αρχείο: ' + esc(C.formatGrade(g.percent)) + '%)' : '')) : '') + '</td>' +
            '<td class="small muted">' + (carried ? '<span class="badge badge-info">Από το ' + esc(C.yearLabel(db, carried.yearId)) + '</span>' : g ? (g.source === 'import' ? 'Εισαγωγή Excel' : 'Χειροκίνητα') + ' · ' + fmtDate(g.updatedAt) : '') + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div>';
    });
    if (!any) h = emptyState('grid', 'Χωρίς εγγραφές', 'Ο σπουδαστής δεν έχει εγγραφή ή βαθμούς σε κανένα ακαδημαϊκό έτος. Ορίστε επίπεδο από την καρτέλα «Εγγραφές ανά έτος».');
    return h;
  }

  function enrollTabHtml(s) {
    const { db } = S();
    let h = '<p class="small muted" style="margin-top:0">Σε κάθε ακαδημαϊκό έτος ο σπουδαστής ανήκει σε ένα επίπεδο, τμήμα και περίοδο. Αν σταματήσει και επιστρέψει αργότερα στο ίδιο επίπεδο, τα μαθήματα που είχε περάσει μεταφέρονται αυτόματα.</p>';
    h += '<table class="table en-table"><thead><tr><th>Ακαδημαϊκό έτος</th><th>Επίπεδο</th><th>Τμήμα</th><th>Περίοδος</th><th>Διέκοψε</th><th class="num">Βαθμοί</th></tr></thead><tbody>';
    C.sortYears(db.years).forEach((y) => {
      const en = C.getEnrollment(db, s.id, y.id);
      const n = db.grades.filter((g) => g.studentId === s.id && g.yearId === y.id).length;
      let secCell = '<span class="faint">—</span>';
      if (en && C.isShiftLevel(en.levelId)) {
        const sh = C.studentSection(db, s, y.id, en);
        secCell = '<span class="small muted">' + (sh ? esc(C.sectionName(en.levelId, sh)) + ' (όλο το τμήμα)' : 'ορίζεται από το Βαθμολόγιο') + '</span>';
      } else if (en) {
        secCell = '<select class="select" data-en-sec="' + y.id + '">' + options(sectionChoices(en.levelId, true), en.section || '') + '</select>';
      }
      h += '<tr><td class="strong">' + esc(y.label) + '</td><td style="width:38%"><select class="select" data-en-year="' + y.id + '">' + options([{ value: '', label: '— Χωρίς εγγραφή —' }].concat(levelOptions(false, null, s.specialty)), en ? en.levelId : '') + '</select></td><td style="width:22%">' + secCell + '</td><td style="width:18%">' + periodCell(db, y.id, en) + '</td><td>' + (en ? '<label class="checkbox" title="Ο σπουδαστής σταμάτησε μέσα στη χρονιά — οι βαθμοί του μένουν και μεταφέρονται αν επιστρέψει"><input type="checkbox" data-en-wd="' + y.id + '"' + (en.withdrawn ? ' checked' : '') + ' /></label>' : '') + '</td><td class="num">' + n + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /** «Περίοδος» of one enrollment in the card: a select when the level has 2+ periods, the automatic one when it has one. */
  function periodCell(db, yearId, en) {
    if (!en) return '<span class="faint">—</span>';
    const lp = C.levelPeriods(db, en.levelId);
    const orphan = en.period && !lp.some((p) => p.id === en.period); // a period the level no longer has
    if (lp.length >= 2 || orphan) {
      const list = [{ value: '', label: '— Χωρίς περίοδο —' }].concat(lp.map((p) => ({ value: p.id, label: p.name })));
      if (orphan) list.push({ value: en.period, label: C.periodName(en.period) + ' (δεν ισχύει)' });
      return '<select class="select" data-en-per="' + yearId + '">' + options(list, en.period || '') + '</select>';
    }
    if (lp.length === 1) return '<span class="badge badge-period" title="Η μοναδική περίοδος του επιπέδου — ορίζεται αυτόματα">' + esc(lp[0].name) + '</span>';
    return '<span class="faint" title="Το επίπεδο δεν έχει περιόδους">—</span>';
  }

  async function deleteOne(s, ctx) {
    const { db } = S();
    const n = db.grades.filter((g) => g.studentId === s.id).length;
    const ok = await confirmDialog('Οριστική διαγραφή', 'Να διαγραφεί οριστικά ο/η <b>' + esc(C.studentName(s)) + '</b> (Α.Μ. ' + esc(s.am) + ')' + (n ? ' μαζί με ' + plural(n, 'βαθμό', 'βαθμούς') : '') + ';', { danger: true, okText: 'Διαγραφή' });
    if (!ok) return;
    await App.backup('pre-delete');
    App.mutate((d) => C.deleteStudent(d, s.id), { render: false });
    F.selected.delete(s.id);
    ctx.close();
    toast('Ο σπουδαστής διαγράφηκε');
  }

  async function exportTranscript(s) {
    const db = S().db;
    const r = window.XL.buildTranscript(db, s); // every level he attended, with the academic years of each
    await App.saveWorkbook(r.wb, window.XL.transcriptFileName(db, s, null));
  }
})();
