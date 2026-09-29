/* Μεταφορά σπουδαστών: from any year/class to any year/class (promotion, repeats, class changes). */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, plural, options, toast, openModal, specBadge, resultBadge } = App.ui;
  const S = () => App.S;

  const ST_LABEL = {
    new: ['Νέα εγγραφή', 'badge-success'],
    change: ['Αλλαγή εγγραφής', 'badge-info'],
    same: ['Ήδη εκεί', ''],
    exists: ['Ήδη εγγεγραμμένος — κρατιέται', 'badge-warning'],
    final: ['Τελευταίο επίπεδο — ολοκλήρωσε', 'badge-level'],
  };

  function yearsAsc() {
    return C.sortYears(S().db.years).slice().reverse();
  }

  /** The year right after / before another one (by label), or null. */
  function neighbourYear(yearId, dir) {
    const asc = yearsAsc();
    const i = asc.findIndex((y) => y.id === yearId);
    const j = i + dir;
    return i >= 0 && j >= 0 && j < asc.length ? asc[j].id : null;
  }
  App.neighbourYear = neighbourYear;

  function clsName(levelId, student, section) {
    if (!levelId) return '';
    const spec = C.isUnifiedLevel(levelId) ? null : student.specialty || null;
    return C.classShortName(levelId, spec, section) + (section || C.isShiftLevel(levelId) ? '' : ' · χωρίς τμήμα');
  }

  /** Period tag next to a class in the preview (a warning tag when the level has periods but none is set). */
  function perTag(db, levelId, period) {
    if (!levelId) return '';
    if (period) return ' <span class="badge badge-period" title="' + esc(C.periodName(period)) + '">' + esc(C.periodShort(period)) + '</span>';
    return C.levelHasPeriods(db, levelId) ? ' <span class="badge badge-period none" title="Χωρίς περίοδο">Χωρίς περίοδο</span>' : '';
  }

  /**
   * preset: { fromYearId, toYearId, levelId, studentIds, mode }
   */
  App.transferModal = function (preset) {
    const p = preset || {};
    const { yearId } = S();
    const db0 = S().db;
    const toYearId = p.toYearId || yearId;
    const fromYearId = p.fromYearId || neighbourYear(toYearId, -1) || toYearId;
    const st = {
      fromYearId,
      toYearId,
      levelId: p.levelId || 'ALL',
      spec: 'ALL',
      section: 'ALL',
      period: 'ALL',
      mode: p.mode || (fromYearId === toYearId ? 'fixed' : 'auto'),
      toLevelId: p.toLevelId || 'SUP',
      toSection: 'same',
      toPeriod: 'same',
      overwrite: false,
      studentIds: p.studentIds || null,
      unchecked: new Set(),
    };
    let plan = null;
    if (!db0.years.some((y) => y.id === st.fromYearId)) st.fromYearId = yearId;

    // always the current registry (it may be replaced by a merge with a teacher's changes while the dialog is open)
    const dbNow = () => S().db;
    const yearOpts = () => C.sortYears(dbNow().years).map((y) => ({ value: y.id, label: y.label }));
    const levelOpts = () => C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(dbNow(), l.id) }));

    /** Source period filter choices (null when the source level has fewer than two periods). */
    function fromPeriodOpts() {
      const db = dbNow();
      if (st.levelId === 'ALL') return null;
      const lp = C.levelPeriods(db, st.levelId);
      if (lp.length < 2) return null;
      const list = [{ value: 'ALL', label: 'Όλες οι περίοδοι' }].concat(lp.map((x) => ({ value: x.id, label: x.name })));
      if (db.enrollments.some((e) => e.yearId === st.fromYearId && e.levelId === st.levelId && !e.period)) list.push({ value: 'NONE', label: 'Χωρίς περίοδο' });
      return list;
    }

    /** Target period choices: «Ίδια περίοδος», the target level's periods (auto: of every level), «Χωρίς». */
    function toPeriodOpts() {
      const db = dbNow();
      let lp;
      if (st.mode === 'fixed') lp = C.levelPeriods(db, st.toLevelId);
      else lp = (db.settings.periods || []).filter((x) => C.LEVEL_IDS.some((l) => C.validPeriodFor(db, l, x.id)));
      if (!lp.length) return null;
      return [{ value: 'same', label: 'Ίδια περίοδος' }].concat(lp.map((x) => ({ value: x.id, label: x.name }))).concat([{ value: '', label: 'Χωρίς' }]);
    }

    function formHtml() {
      const db = dbNow();
      const secFilter = st.levelId !== 'ALL' && !C.isShiftLevel(st.levelId);
      const specFilter = !(st.levelId !== 'ALL' && C.isUnifiedLevel(st.levelId));
      const fpo = fromPeriodOpts();
      if (!fpo || !fpo.some((o) => o.value === st.period)) st.period = 'ALL';
      const tpo = toPeriodOpts();
      if (!tpo || !tpo.some((o) => o.value === st.toPeriod)) st.toPeriod = 'same';
      let h = '<div class="tr-grid">';
      // ---- from
      h += '<div class="tr-box"><div class="tr-title">' + icon('users') + 'Από</div><div class="form-grid">' +
        '<div class="field"><label>Ακαδημαϊκό έτος</label><select class="select" data-tr="fromYearId">' + options(yearOpts(), st.fromYearId) + '</select></div>' +
        '<div class="field"><label>Επίπεδο</label><select class="select" data-tr="levelId">' + options([{ value: 'ALL', label: 'Όλα τα επίπεδα' }].concat(levelOpts()), st.levelId) + '</select></div>' +
        (specFilter ? '<div class="field"><label>Ειδικότητα</label><select class="select" data-tr="spec">' + options([{ value: 'ALL', label: 'Deck & Engine' }, { value: 'DECK', label: 'Deck' }, { value: 'ENGINE', label: 'Engine' }], st.spec) + '</select></div>' : '<div class="field"><label>Ειδικότητα</label><input class="input" value="Deck & Engine μαζί" disabled /></div>') +
        (secFilter
          ? '<div class="field"><label>Τμήμα</label><select class="select" data-tr="section">' + options([{ value: 'ALL', label: 'Όλα τα τμήματα' }].concat(C.levelSections(st.levelId).map((s) => ({ value: s.id, label: s.name }))).concat([{ value: 'NONE', label: 'Χωρίς τμήμα' }]), st.section) + '</select></div>'
          : '<div class="field"><label>Τμήμα</label><input class="input" value="Όλα τα τμήματα" disabled /></div>') +
        (fpo ? '<div class="field"><label>Περίοδος</label><select class="select" data-tr="period" id="tr-period">' + options(fpo, st.period) + '</select></div>' : '') +
        '</div>' +
        (st.studentIds ? '<div class="callout" style="margin-top:12px">' + icon('info') + '<p>Μόνο οι <b>' + st.studentIds.length + '</b> επιλεγμένοι σπουδαστές. <button class="link" data-tr-act="allStudents">Όλοι οι σπουδαστές</button></p></div>' : '') +
        '</div>';
      // ---- to
      const toSecOpts = [{ value: 'same', label: 'Αντίστοιχο (Morning → Morning)' }, { value: '', label: 'Χωρίς τμήμα' }];
      if (st.mode === 'fixed') C.levelSections(st.toLevelId).forEach((s) => toSecOpts.push({ value: s.id, label: s.name }));
      if (!toSecOpts.some((o) => o.value === st.toSection)) st.toSection = 'same';
      h += '<div class="tr-arrow">' + icon('arrowRight') + '</div>';
      h += '<div class="tr-box"><div class="tr-title">' + icon('graduation') + 'Προς</div><div class="form-grid">' +
        '<div class="field"><label>Ακαδημαϊκό έτος</label><select class="select" data-tr="toYearId">' + options(yearOpts(), st.toYearId) + '</select></div>' +
        '<div class="field"><label title="Αυτόματα: όσοι πέτυχαν σε όλα πάνε στο επόμενο επίπεδο, οι υπόλοιποι (και όσοι διέκοψαν) επαναλαμβάνουν">Κανόνας</label><select class="select" data-tr="mode">' + options([{ value: 'auto', label: 'Αυτόματα (με βάση το αποτέλεσμα)' }, { value: 'fixed', label: 'Όλοι σε ένα επίπεδο' }], st.mode) + '</select></div>' +
        (st.mode === 'fixed' ? '<div class="field"><label>Επίπεδο</label><select class="select" data-tr="toLevelId">' + options(levelOpts(), st.toLevelId) + '</select></div>' : '<div class="field"><label>Επίπεδο</label><input class="input" value="Ανάλογα με το αποτέλεσμα" disabled /></div>') +
        '<div class="field"><label>Τμήμα</label><select class="select" data-tr="toSection">' + options(toSecOpts, st.toSection) + '</select></div>' +
        (tpo
          ? '<div class="field"><label title="«Ίδια περίοδος»: κρατά την περίοδο του σπουδαστή όταν ισχύει στο νέο επίπεδο — αλλιώς τη μοναδική περίοδο του επιπέδου">Περίοδος</label><select class="select" data-tr="toPeriod" id="tr-to-period">' + options(tpo, st.toPeriod) + '</select></div>'
          : '') +
        '</div>' +
        (st.fromYearId !== st.toYearId
          ? '<label class="checkbox" style="margin-top:12px"><input type="checkbox" data-tr="overwrite"' + (st.overwrite ? ' checked' : '') + ' /> Να αλλάξει η εγγραφή και όσων είναι ήδη εγγεγραμμένοι στο ' + esc(C.yearLabel(db, st.toYearId)) + '</label>'
          : '<div class="small muted" style="margin-top:12px">Ίδιο έτος: αλλάζει το επίπεδο / τμήμα των σπουδαστών.</div>') +
        '</div>';
      h += '</div>';
      return h;
    }

    function planOpts() {
      return {
        fromYearId: st.fromYearId,
        toYearId: st.toYearId,
        levelId: st.levelId,
        spec: st.spec,
        section: st.section,
        period: st.period,
        studentIds: st.studentIds,
        mode: st.mode,
        toLevelId: st.toLevelId,
        toSection: st.toSection,
        toPeriod: st.toPeriod,
        overwrite: st.overwrite,
      };
    }

    function listHtml() {
      const db = dbNow();
      plan = C.planTransfer(db, planOpts());
      const sm = plan.summary;
      if (!plan.items.length) return '<div class="card-body muted center" style="padding:30px">Δεν υπάρχουν εγγεγραμμένοι σπουδαστές στο ' + esc(C.yearLabel(db, st.fromYearId)) + ' για αυτή την επιλογή.</div>';
      const movable = plan.items.filter((i) => i.status === 'new' || i.status === 'change');
      const chosen = movable.filter((i) => !st.unchecked.has(i.student.id));
      let h = '<div class="row row-wrap" style="margin:16px 0 10px;gap:8px">' +
        '<span class="badge">' + plural(sm.total, 'σπουδαστής', 'σπουδαστές') + '</span>' +
        (sm.passed ? '<span class="badge badge-success">Επιτυχόντες ' + sm.passed + '</span>' : '') +
        (sm.new ? '<span class="badge badge-success">Νέες εγγραφές ' + sm.new + '</span>' : '') +
        (sm.change ? '<span class="badge badge-info">Αλλαγές ' + sm.change + '</span>' : '') +
        (sm.same ? '<span class="badge">Ήδη εκεί ' + sm.same + '</span>' : '') +
        (sm.exists ? '<span class="badge badge-warning">Ήδη εγγεγραμμένοι ' + sm.exists + '</span>' : '') +
        (sm.final ? '<span class="badge badge-level">Ολοκλήρωσαν το τελευταίο επίπεδο ' + sm.final + '</span>' : '') +
        '</div>';
      h += '<div class="table-wrap" style="max-height:40vh;border:1px solid var(--border);border-radius:10px"><table class="table table-compact"><thead><tr>' +
        '<th class="chk"><input type="checkbox" data-tr-all' + (movable.length && chosen.length === movable.length ? ' checked' : '') + (movable.length ? '' : ' disabled') + ' /></th>' +
        '<th>Α.Μ.</th><th>Σπουδαστής</th><th>Από (' + esc(C.yearLabel(db, st.fromYearId)) + ')</th><th>Αποτέλεσμα</th><th></th><th>Προς (' + esc(C.yearLabel(db, st.toYearId)) + ')</th><th>Κατάσταση</th></tr></thead><tbody>';
      plan.items.forEach((i) => {
        const can = i.status === 'new' || i.status === 'change';
        const on = can && !st.unchecked.has(i.student.id);
        const lab = ST_LABEL[i.status];
        const to = i.toLevelId ? esc(clsName(i.toLevelId, i.student, i.toSection)) + perTag(db, i.toLevelId, i.toPeriod) : '—';
        const ex = i.status === 'exists' || i.status === 'change' ? '<div class="small muted">τώρα: ' + esc(clsName(i.existing.levelId, i.student, i.existing.section)) + (i.existing.period ? ' · ' + esc(C.periodShort(i.existing.period)) : '') + '</div>' : '';
        h += '<tr' + (can ? '' : ' style="opacity:.6"') + '><td class="chk">' + (can ? '<input type="checkbox" data-tr-one="' + i.student.id + '"' + (on ? ' checked' : '') + ' />' : '') + '</td>' +
          '<td class="am">' + esc(i.student.am) + '</td><td><b>' + esc(i.student.lastName) + '</b> ' + esc(i.student.firstName) + ' ' + (C.isUnifiedLevel(i.fromLevelId) ? '' : specBadge(i.student.specialty)) + '</td>' +
          '<td class="small tr-from" data-period="' + esc(i.fromPeriod || '') + '">' + esc(clsName(i.fromLevelId, i.student, i.fromSection)) + perTag(db, i.fromLevelId, i.fromPeriod) + '</td>' +
          '<td>' + resultBadge(i.result) + '</td><td class="muted">' + icon('arrowRight', 'width="14" height="14"') + '</td>' +
          '<td class="small strong tr-to" data-period="' + esc(i.toPeriod || '') + '">' + to + ex + '</td>' +
          '<td><span class="badge ' + lab[1] + '">' + esc(lab[0]) + '</span></td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="small muted" style="margin-top:10px">Θα γίνουν <b>' + plural(chosen.length, 'εγγραφή', 'εγγραφές') + '</b> στο ' + esc(C.yearLabel(db, st.toYearId)) + '. Οι βαθμοί και οι εγγραφές του ' + esc(C.yearLabel(db, st.fromYearId)) + ' μένουν όπως είναι. Η μεταφορά αναιρείται από το Ιστορικό εισαγωγών.</div>';
      return h;
    }

    function chosenIds() {
      return plan ? plan.items.filter((i) => (i.status === 'new' || i.status === 'change') && !st.unchecked.has(i.student.id)).map((i) => i.student.id) : [];
    }

    let ctxRef = null;
    function refresh(full) {
      if (full) ctxRef.q('#tr-form').innerHTML = formHtml();
      ctxRef.q('#tr-list').innerHTML = listHtml();
      const btn = ctxRef.q('#tr-go');
      const n = chosenIds().length;
      btn.disabled = !n;
      btn.lastChild.textContent = n ? 'Μεταφορά ' + plural(n, 'σπουδαστή', 'σπουδαστών') : 'Μεταφορά';
    }

    openModal({
      title: 'Μεταφορά σπουδαστών',
      sub: 'Σε επόμενο ή προηγούμενο ακαδημαϊκό έτος, σε νέο επίπεδο ή σε άλλο τμήμα',
      size: 'xl',
      body: '<div id="tr-form"></div><div id="tr-list"></div>',
      onMount(ctx) {
        ctxRef = ctx;
        ctx.el.addEventListener('change', (e) => {
          const t = e.target;
          if (t.dataset.tr) {
            const k = t.dataset.tr;
            st[k] = t.type === 'checkbox' ? t.checked : t.value;
            if (k === 'levelId') {
              st.section = 'ALL';
              st.period = 'ALL';
              if (C.isUnifiedLevel(st.levelId)) st.spec = 'ALL';
            }
            if (k === 'fromYearId' || k === 'toYearId') st.mode = st.fromYearId === st.toYearId ? 'fixed' : st.mode;
            st.unchecked.clear();
            refresh(true);
          } else if (t.dataset.trOne) {
            if (t.checked) st.unchecked.delete(t.dataset.trOne);
            else st.unchecked.add(t.dataset.trOne);
            refresh(false);
          } else if (t.hasAttribute('data-tr-all')) {
            plan.items.forEach((i) => (t.checked ? st.unchecked.delete(i.student.id) : st.unchecked.add(i.student.id)));
            refresh(false);
          }
        });
        ctx.el.addEventListener('click', (e) => {
          const a = e.target.closest('[data-tr-act]');
          if (a && a.dataset.trAct === 'allStudents') {
            st.studentIds = null;
            refresh(true);
          }
        });
        refresh(true);
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Μεταφορά',
          cls: 'btn-primary',
          id: 'tr-go',
          icon: 'check',
          onClick: async () => {
            let ids = chosenIds();
            if (!ids.length) throw new Error('Δεν έχει επιλεγεί κανένας σπουδαστής.');
            // students who change level (e.g. Support → Operational Level A): confirm they are the same persons
            const db0 = S().db;
            const cname = (st0, levelId, section, period) => {
              const sp = C.isUnifiedLevel(levelId) ? null : C.hasSpec(st0.specialty) ? st0.specialty : null;
              const per = C.classPeriod(db0, levelId, period || null);
              return C.isShiftLevel(levelId) ? C.levelName(db0, levelId, sp) + (per ? ' – ' + C.periodName(per) : '') : C.classFullName(db0, levelId, sp, section, per);
            };
            const moving = plan.items.filter((i) => ids.includes(i.student.id) && (i.status === 'new' || i.status === 'change') && i.toLevelId && i.toLevelId !== i.fromLevelId);
            const ans = await App.confirmSameStudents(moving.map((i) => ({
              key: i.student.id,
              student: i.student,
              fileName: C.studentName(i.student),
              match: 'exact',
              prev: { yearId: plan.fromYearId, className: cname(i.student, i.fromLevelId, i.fromSection, i.fromPeriod) },
              next: { yearId: plan.toYearId, className: cname(i.student, i.toLevelId, i.toSection, i.toPeriod) },
            })));
            if (!ans) return false;
            ids = ids.filter((id) => !ans.notSame.includes(id));
            if (!ids.length) return false;
            await App.backup('pre-transfer');
            // plan again on the registry as it is now (the save before the backup may have merged a teacher's changes)
            const rec = App.mutate((d) => C.commitTransfer(d, C.planTransfer(d, planOpts()), ids));
            const target = st.toYearId;
            toast(
              plural(rec.stats.moved, 'σπουδαστής μεταφέρθηκε', 'σπουδαστές μεταφέρθηκαν') + ' στο <b>' + esc(C.yearLabel(S().db, target)) + '</b>',
              'success',
              target !== S().yearId ? { action: { label: 'Μετάβαση στο ' + C.yearLabel(S().db, target), onClick: () => App.setYear(target) }, duration: 9000 } : null
            );
          },
        },
      ],
    });
  };

  App.actions.transferModal = () => App.transferModal({});
})();
