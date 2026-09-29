/* Application shell: state, persistence, navigation, dashboard, settings. Loaded last. */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, fmtDate, plural, pct, options, toast, openModal, confirmDialog, emptyState } = App.ui;
  const api = window.api;
  const Remote = window.Remote;

  const S = (App.S = {
    db: null,
    info: null,
    page: 'dashboard',
    yearId: null,
  });

  // ------------------------------------------------------------ persistence
  // Every change is saved to the server (PUT /api/registry with the revision it started from).
  // Teachers write grades straight into the server registry while the admin works, so a save often
  // meets a newer revision (409). Then the server copy is downloaded and 3-way-merged
  // (Core.mergeRegistry: base = the registry as last loaded / saved, mine = S.db, theirs = the server's)
  // and saved again; the conflict dialog appears only when the same record changed on both sides.
  let saveTimer = null;
  let dirty = false;
  let saving = null;
  let baseText = null; // JSON of the registry as the server had it at Remote.rev (last load or successful save)
  let keepMine = false; // «Κράτηση της δικής μου»: the next merge keeps my version of the conflicting records
  const MAX_MERGES = 5; // merges in a row for one save (the others may keep saving meanwhile)

  function setSaveStatus(kind, msg) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = 'save-status ' + (kind || '');
    const text = kind === 'saving' ? 'Αποθήκευση…' : kind === 'error' ? 'Σφάλμα αποθήκευσης' : 'Αποθηκεύτηκε';
    el.innerHTML = '<span class="dot"></span>' + esc(text);
    el.title = msg || (kind === 'error' ? '' : 'Όλες οι αλλαγές αποθηκεύονται αυτόματα');
  }

  function persist() {
    S.db.updatedAt = C.nowIso();
    dirty = true;
    setSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
  }

  /** Save the pending changes (resolves when saved — including a merge with a newer server revision — or given up). */
  async function flush() {
    if (!dirty || !S.db) return;
    if (saving) await saving;
    if (!dirty || !S.db) return;
    saving = saveNow().finally(() => (saving = null));
    return saving;
  }

  async function saveNow() {
    for (let merges = 0; ; merges++) {
      if (!S.db) return;
      dirty = false;
      const text = JSON.stringify(S.db);
      try {
        await Remote.saveRegistry(text);
        baseText = text; // what the server now has at Remote.rev
        setSaveStatus(dirty ? 'saving' : 'saved');
        return;
      } catch (e) {
        dirty = true;
        if (e.status === 409) {
          if (merges < MAX_MERGES && (await mergeWithServer(e))) continue;
          if (merges >= MAX_MERGES) conflict(e, null);
          return;
        }
        setSaveStatus('error', e.message);
        if (e.status === 401 || e.status === 403) return;
        toast('Δεν ήταν δυνατή η αποθήκευση στον διακομιστή: ' + esc(e.message) + ' — νέα προσπάθεια σε λίγα δευτερόλεπτα.', 'error');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 5000);
        return;
      }
    }
  }

  /** Make a registry's classes/periods the active ones in Core (normalizeDb does it too). */
  function activate(db) {
    if (!db || !db.settings) return;
    C.useSections(db.settings.sections);
    C.usePeriods(db.settings);
  }

  /**
   * The server has a newer revision (409): download it and merge it with the local changes.
   * true → the merged registry is in S.db and must be saved now; false → nothing to save now
   * (conflict dialog shown, or the download failed and a retry is scheduled).
   */
  async function mergeWithServer(e) {
    if (!baseText) {
      if (keepMine && e.data && e.data.rev != null) {
        // nothing to merge with (e.g. the registry was empty when loaded): write over it as asked
        keepMine = false;
        Remote.rev = e.data.rev;
        return true;
      }
      conflict(e, null);
      return false;
    }
    setSaveStatus('saving', 'Συγχώνευση με τις αλλαγές άλλου χρήστη…');
    let r;
    try {
      r = await Remote.loadRegistry();
    } catch (err) {
      setSaveStatus('error', err.message);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 5000);
      return false;
    }
    if (!S.db) return false; // logged out meanwhile
    if (!r || !r.data) {
      conflict(e, null);
      return false;
    }
    // edits made while downloading are in S.db, so they are merged too
    const theirs = C.normalizeDb(r.data);
    const m = C.mergeRegistry(JSON.parse(baseText), S.db, theirs);
    if (m.conflicts.length && !keepMine) {
      activate(S.db);
      conflict(e, { rev: r.rev, updatedBy: r.updatedBy, updatedAt: r.updatedAt, conflicts: m.conflicts, theirs });
      return false;
    }
    keepMine = false;
    const keepYear = S.yearId;
    S.db = C.normalizeDb(m.merged);
    S.yearId = S.db.years.some((y) => y.id === keepYear) ? keepYear : S.db.settings.currentYearId;
    Remote.rev = r.rev || 0;
    baseText = JSON.stringify(theirs); // the version the next save starts from
    dirty = true;
    quietRender();
    toast('Συγχωνεύτηκαν αλλαγές από άλλον χρήστη' + (r.updatedBy ? ' (' + esc(r.updatedBy) + ')' : '') + '.', 'info', { duration: 3000 });
    return true;
  }

  /** Short readable list of the records changed on both sides. */
  function conflictLines(conflicts, theirs) {
    const find = (coll, id) => ((S.db && S.db[coll]) || []).find((x) => x.id === id) || ((theirs && theirs[coll]) || []).find((x) => x.id === id);
    const stName = (id) => {
      const s = find('students', id);
      return s ? C.studentName(s) + ' (Α.Μ. ' + s.am + ')' : 'σπουδαστής';
    };
    const subj = (id) => {
      const s = find('subjects', id);
      return s ? C.subjectLabel(s) : 'μάθημα';
    };
    const year = (id) => {
      const y = find('years', id);
      return y ? ' · ' + y.label : '';
    };
    const SET = { levelNames: 'ονομασίες επιπέδων', sections: 'τμήματα', periods: 'περίοδοι', levelPeriods: 'περίοδοι επιπέδων', gradeLocks: 'κλείδωμα βαθμολογίας', currentYearId: 'τρέχον έτος', absenceLimitPct: 'όριο απουσιών' };
    const out = [];
    conflicts.forEach((c) => {
      const k = String(c.key).split('|');
      let t;
      if (c.collection === 'grades') t = 'Βαθμός: ' + stName(k[0]) + ' · ' + subj(k[1]) + year(k[2]);
      else if (c.collection === 'enrollments') t = 'Εγγραφή: ' + stName(k[0]) + year(k[1]);
      else if (c.collection === 'students') t = 'Στοιχεία σπουδαστή: ' + stName(k[0]);
      else if (c.collection === 'subjects') t = 'Μάθημα: ' + subj(k[0]);
      else if (c.collection === 'years') t = 'Ακαδημαϊκό έτος' + year(k[0]);
      else if (c.collection === 'imports') t = 'Ιστορικό εισαγωγών';
      else if (c.collection === 'calendar') t = 'Ημερολόγιο: ' + C.calendarClassName(S.db, k[0], k.slice(1, 5).join('|')) + ' · ' + C.dateText(k[5]);
      else if (c.collection === 'absences') t = 'Απουσία: ' + stName(k[0]) + ' · ' + C.dateText(k[2]);
      else if (/^settings/.test(c.collection)) {
        const key = c.collection === 'settings' ? c.key : c.collection.slice(9);
        t = 'Ρυθμίσεις: ' + (SET[key] || key);
      } else t = c.collection + (c.key ? ' · ' + c.key : '');
      if (!out.includes(t)) out.push(t);
    });
    return out;
  }

  /**
   * The same records were changed here and by someone else (or the merge was not possible).
   * info: {rev, updatedBy, updatedAt, conflicts, theirs} from the merge attempt, or null.
   */
  let conflictOpen = false;
  function conflict(e, info) {
    dirty = true;
    setSaveStatus('error', 'Διένεξη με αλλαγές άλλου χρήστη');
    if (conflictOpen) return;
    conflictOpen = true;
    const d = info || e.data || {};
    const who = d.updatedBy ? ' (χρήστης <b>' + esc(d.updatedBy) + '</b>' + (d.updatedAt ? ', ' + fmtDate(d.updatedAt, true) : '') + ')' : '';
    let body;
    if (info && info.conflicts.length) {
      const lines = conflictLines(info.conflicts, info.theirs);
      const shown = lines.slice(0, 8);
      body =
        'Το μητρώο άλλαξε από άλλον χρήστη' + who + ' ενώ δουλεύατε. Οι υπόλοιπες αλλαγές συγχωνεύονται αυτόματα, αλλά ' +
        (lines.length === 1 ? 'η ακόλουθη εγγραφή άλλαξε' : 'οι ακόλουθες εγγραφές άλλαξαν') + ' και από τους δύο:' +
        '<ul class="merge-conflicts">' + shown.map((t) => '<li>' + esc(t) + '</li>').join('') + (lines.length > shown.length ? '<li class="muted">… και ' + (lines.length - shown.length) + ' ακόμη</li>' : '') + '</ul>' +
        'Οι αλλαγές σας <b>δεν αποθηκεύτηκαν</b> ακόμη.<br><br>«Φόρτωση νέας έκδοσης»: κρατιέται η έκδοση του διακομιστή — επαναλάβετε την αλλαγή σας. «Κράτηση της δικής μου»: σε ' +
        (lines.length === 1 ? 'αυτή την εγγραφή' : 'αυτές τις εγγραφές') + ' κρατιέται η δική σας εκδοχή, όλες οι άλλες αλλαγές του άλλου χρήστη διατηρούνται.';
    } else {
      body = 'Το μητρώο άλλαξε από άλλον υπολογιστή' + who + ' ενώ δουλεύατε. Η τελευταία σας αλλαγή <b>δεν αποθηκεύτηκε</b>.<br><br>Φορτώστε τη νέα έκδοση και επαναλάβετε την αλλαγή σας. (Με «Κράτηση της δικής μου» οι αλλαγές του άλλου υπολογιστή θα χαθούν.)';
    }
    openModal({
      title: info && info.conflicts.length ? 'Ίδιες εγγραφές άλλαξαν από δύο χρήστες' : 'Αλλαγές από άλλον υπολογιστή',
      size: 'sm',
      body: '<div class="conflict-body" style="font-size:13.5px;line-height:1.55">' + body + '</div>',
      buttons: [
        {
          label: 'Κράτηση της δικής μου',
          left: true,
          id: 'conflict-mine',
          onClick: async () => {
            keepMine = true;
            dirty = true;
            try {
              await flush();
            } finally {
              keepMine = false;
            }
          },
        },
        {
          label: 'Φόρτωση νέας έκδοσης',
          cls: 'btn-primary',
          id: 'conflict-reload',
          onClick: async () => {
            dirty = false;
            await reloadRegistry(true);
          },
        },
      ],
      onClose: () => (conflictOpen = false),
    });
  }

  /** Fetch the registry again from the server (after a conflict, or changes from another PC / a teacher). */
  async function reloadRegistry(quiet) {
    const r = await Remote.loadRegistry();
    if (!S.db) return; // logged out meanwhile
    // an edit made while downloading wins: keep it (the next save merges it with the newer revision)
    if (!quiet && (dirty || saving)) return;
    Remote.rev = r.rev || 0;
    const keepYear = S.yearId;
    S.db = C.normalizeDb(r.data || C.createEmptyDb(new Date()));
    baseText = r.data ? JSON.stringify(S.db) : null;
    S.yearId = S.db.years.some((y) => y.id === keepYear) ? keepYear : S.db.settings.currentYearId;
    setSaveStatus('saved');
    quietRender();
    if (!quiet) toast('Τα δεδομένα ενημερώθηκαν με αλλαγές από άλλον χρήστη' + (r.updatedBy ? ' (' + esc(r.updatedBy) + ')' : '') + '.', 'info', { duration: 3000 });
  }

  /**
   * A CSS selector that finds a form field again after a re-render (id, or its name / data-* attributes;
   * data-orig holds the stored value — e.g. a gradebook cell — and may change with the new data).
   */
  function fieldSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const attrs = Array.from(el.attributes).filter((a) => a.name === 'name' || (/^data-/.test(a.name) && a.name !== 'data-orig'));
    if (!attrs.length) return null;
    return el.tagName.toLowerCase() + attrs.map((a) => '[' + a.name + '="' + CSS.escape(a.value) + '"]').join('');
  }

  /**
   * Re-render the current page after data came from the server, without disturbing the user:
   * the focused field (and what is being typed in it) and the scroll positions are kept.
   */
  function quietRender() {
    const content = document.getElementById('content');
    if (!content || !S.db) return render();
    const ae = document.activeElement;
    let keep = null;
    if (ae && content.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
      // being typed = differs from the stored value (data-orig when the field has one, else its rendered value);
      // a value that was already committed is never put back over newer data
      const stored = ae.dataset && ae.dataset.orig !== undefined ? ae.dataset.orig : ae.defaultValue;
      const typed = ae.tagName !== 'SELECT' && ae.type !== 'checkbox' && ae.type !== 'radio' && ae.value !== stored;
      let s = null;
      let en = null;
      try {
        s = ae.selectionStart;
        en = ae.selectionEnd;
      } catch (err) {
        /* not a text field */
      }
      keep = { sel: fieldSelector(ae), value: typed ? ae.value : null, s, en };
    }
    const SCROLLERS = '.table-wrap, .gb-wrap';
    const scrolls = Array.from(content.querySelectorAll(SCROLLERS)).map((x) => [x.scrollTop, x.scrollLeft]);
    const top = content.scrollTop;
    render();
    content.scrollTop = top;
    const now = content.querySelectorAll(SCROLLERS);
    if (now.length === scrolls.length) now.forEach((x, i) => ((x.scrollTop = scrolls[i][0]), (x.scrollLeft = scrolls[i][1])));
    if (keep && keep.sel) {
      const el = content.querySelector(keep.sel);
      if (el && !el.disabled) {
        if (keep.value !== null) el.value = keep.value;
        el.focus({ preventScroll: true });
        try {
          if (keep.s !== null) el.setSelectionRange(keep.s, keep.en);
        } catch (err) {
          /* not a text field */
        }
      }
    }
  }

  // changes made on another PC (or by a teacher) appear here too, checked every 10 s while idle;
  // with unsaved local edits nothing is downloaded — their save merges the newer revision
  const POLL_MS = 10000;
  let pollTimer = null;
  let polling = false;
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, POLL_MS);
  }
  async function pollOnce() {
    if (polling || !S.db || !Remote.user || Remote.user.role !== 'admin' || dirty || saving || conflictOpen) return;
    if (document.querySelector('.modal-backdrop')) return; // never under an open dialog
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest('#content')) return; // nor while typing
    polling = true;
    try {
      const r = await Remote.registryRev();
      if (r.rev !== Remote.rev && !dirty && !saving && !conflictOpen) await reloadRegistry(false);
    } catch (e) {
      /* offline for a moment: try again later */
    } finally {
      polling = false;
    }
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  window.addEventListener('beforeunload', () => {
    // commit a grade that is still being typed in the gradebook
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('input[data-gsid]')) ae.blur();
  });

  /** Mutate the db inside fn, then persist & re-render. */
  function mutate(fn, opts) {
    const r = fn(S.db);
    persist();
    if (!opts || opts.render !== false) render();
    return r;
  }

  async function backup(label) {
    await flush();
    try {
      await Remote.createBackup(label);
    } catch (e) {
      console.warn('backup failed', e);
    }
  }

  // ------------------------------------------------------------ file helpers
  async function saveWorkbook(wb, defaultName) {
    const bytes = await window.XL.toBytes(wb);
    const r = await api.saveFile({ defaultName, data: bytes, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (!r) return null;
    toast('Αποθηκεύτηκε: <b>' + esc(r.name) + '</b>', 'success', {
      action: { label: 'Άνοιγμα', onClick: () => api.openPath(r.path) },
      duration: 8000,
    });
    return r;
  }

  async function pickExcel() {
    const f = await api.openFile({ title: 'Επιλογή αρχείου Excel' });
    return f;
  }

  // ------------------------------------------------------------ navigation
  const NAV = [
    { id: 'dashboard', label: 'Αρχική', icon: 'home', title: 'Αρχική' },
    { id: 'students', label: 'Μητρώο σπουδαστών', icon: 'users', title: 'Μητρώο σπουδαστών' },
    { id: 'subjects', label: 'Μαθήματα', icon: 'book', title: 'Μαθήματα' },
    { id: 'gradebook', label: 'Βαθμολόγιο', icon: 'grid', title: 'Βαθμολόγιο' },
    { id: 'calendar', label: 'Ημερολόγιο & απουσίες', icon: 'calendar', title: 'Ημερολόγιο & απουσίες' },
    { section: 'Αρχεία Excel' },
    { id: 'import', label: 'Εισαγωγή', icon: 'upload', title: 'Εισαγωγή από Excel' },
    { id: 'export', label: 'Εξαγωγή', icon: 'download', title: 'Εξαγωγή σε Excel' },
    { section: 'Εξετάσεις' },
    { id: 'exams', label: 'Εξετάσεις', icon: 'clipboard', title: 'Εξετάσεις (ενδιάμεσα τεστ)' },
    { id: 'accounts', label: 'Λογαριασμοί', icon: 'key', title: 'Λογαριασμοί σύνδεσης' },
    { section: 'Σύστημα' },
    { id: 'settings', label: 'Ρυθμίσεις', icon: 'settings', title: 'Ρυθμίσεις & αντίγραφα' },
  ];

  function go(page, patch) {
    S.page = page;
    if (patch) patch();
    render();
    document.getElementById('content').scrollTop = 0;
  }

  function renderNav() {
    const counts = { students: S.db.students.length, subjects: S.db.subjects.length };
    document.getElementById('nav').innerHTML = NAV.map((n) =>
      n.section
        ? '<div class="nav-section">' + esc(n.section) + '</div>'
        : '<button class="nav-item' + (S.page === n.id ? ' active' : '') + '" data-action="nav" data-page="' + n.id + '">' + icon(n.icon) + '<span>' + esc(n.label) + '</span>' + (counts[n.id] !== undefined ? '<span class="nav-count">' + counts[n.id] + '</span>' : '') + '</button>'
    ).join('');
    const v = S.info ? S.info.version : '';
    document.getElementById('sidebar-foot').innerHTML =
      '<div class="year-pill">' + icon('calendar', 'width="13" height="13"') + esc(C.yearLabel(S.db, S.yearId)) + '</div>' +
      '<div title="' + esc(Remote.url) + '">Έκδοση ' + esc(v) + ' · Διακομιστής ' + esc(Remote.url.replace(/^https?:\/\//, '')) + '</div>';
    const uc = document.getElementById('user-chip');
    if (uc && Remote.user) uc.innerHTML = '<span class="user-chip-name" title="Συνδεδεμένος ως ' + esc(Remote.user.username) + '">' + icon('user', 'width="14" height="14"') + esc(Remote.user.name) + '</span><button class="btn btn-sm btn-ghost" data-action="logout" title="Αποσύνδεση">' + icon('logout', 'width="15" height="15"') + 'Έξοδος</button>';
  }

  function renderYearSelect() {
    const sel = document.getElementById('year-select');
    const years = C.sortYears(S.db.years);
    sel.innerHTML = years.map((y) => '<option value="' + y.id + '"' + (y.id === S.yearId ? ' selected' : '') + '>' + esc(y.label) + '</option>').join('') + '<option value="__new">+ Νέο ακαδημαϊκό έτος…</option>';
  }

  function render() {
    if (!S.db) return; // logged out / student session
    renderNav();
    renderYearSelect();
    const nav = NAV.find((n) => n.id === S.page) || NAV[0];
    document.getElementById('page-title').textContent = nav.title;
    const page = App.pages[S.page];
    const content = document.getElementById('content');
    const sub = document.getElementById('page-sub');
    sub.textContent = page && page.subtitle ? page.subtitle() : '';
    content.innerHTML = page ? page.render() : '';
    if (page && page.mount) page.mount(content);
  }

  App.actions.nav = async (el) => {
    const cur = App.pages[S.page];
    if (cur && cur.confirmLeave && S.page !== el.dataset.page && !(await cur.confirmLeave())) return;
    go(el.dataset.page);
  };
  App.actions.reloadApp = () => boot();
  App.actions.go = (el) => {
    const page = el.dataset.page;
    go(page, () => {
      if (el.dataset.level && App.pages[page].setLevel) App.pages[page].setLevel(el.dataset.level);
      if (el.dataset.spec && App.pages[page].setSpec) App.pages[page].setSpec(el.dataset.spec);
      if (el.dataset.tab && App.pages[page].setTab) App.pages[page].setTab(el.dataset.tab);
    });
  };

  App.changes.switchYear = (el) => {
    if (el.value === '__new') {
      el.value = S.yearId;
      addYearModal();
      return;
    }
    setYear(el.value);
  };

  function setYear(id) {
    S.yearId = id; // working year of this session (other PCs keep their own)
    render();
    toast('Ακαδημαϊκό έτος εργασίας: <b>' + esc(C.yearLabel(S.db, id)) + '</b>', 'info', { duration: 2200 });
  }

  function addYearModal() {
    const latest = C.sortYears(S.db.years)[0];
    const suggestion = C.nextYearLabel(latest ? latest.label : C.academicYearLabelFor(new Date()));
    openModal({
      title: 'Νέο ακαδημαϊκό έτος',
      size: 'sm',
      body:
        '<div class="field"><label>Ακαδημαϊκό έτος</label><input class="input" id="ny-label" value="' + esc(suggestion) + '" placeholder="π.χ. 2027-2028" autofocus />' +
        '<div class="hint">Μορφή: ΕΕΕΕ-ΕΕΕΕ (π.χ. 2027-2028).</div></div>' +
        '<label class="checkbox" style="margin-top:14px"><input type="checkbox" id="ny-switch" checked /> Μετάβαση στο νέο έτος</label>' +
        (latest ? '<label class="checkbox" style="margin-top:10px"><input type="checkbox" id="ny-transfer" checked /> Μεταφορά σπουδαστών από το ' + esc(latest.label) + ' (επιτυχόντες στο επόμενο επίπεδο)</label>' : ''),
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Δημιουργία',
          cls: 'btn-primary',
          onClick: (ctx) => {
            const label = ctx.q('#ny-label').value;
            const y = C.addYear(S.db, label);
            if (ctx.q('#ny-switch').checked) S.db.settings.currentYearId = y.id;
            persist();
            if (ctx.q('#ny-switch').checked) setYear(y.id);
            else render();
            toast('Δημιουργήθηκε το έτος <b>' + esc(y.label) + '</b>');
            const tr = ctx.q('#ny-transfer');
            if (tr && tr.checked) {
              const from = App.neighbourYear(y.id, -1);
              setTimeout(() => App.transferModal({ fromYearId: from || latest.id, toYearId: y.id, mode: 'auto' }), 50);
            }
          },
        },
      ],
    });
  }

  // ------------------------------------------------------------ dashboard
  App.pages.dashboard = {
    subtitle: () => 'Επισκόπηση ακαδημαϊκού έτους ' + C.yearLabel(S.db, S.yearId),
    render() {
      const db = S.db;
      const y = S.yearId;
      const sums = C.LEVELS.map((l) => ({ l, s: C.levelSummary(db, y, l.id) }));
      const tot = sums.reduce(
        (a, x) => ({
          students: a.students + x.s.students,
          deck: a.deck + x.s.deck,
          engine: a.engine + x.s.engine,
          expected: a.expected + x.s.expected,
          entered: a.entered + x.s.entered,
          pass: a.pass + x.s.counts.pass,
        }),
        { students: 0, deck: 0, engine: 0, expected: 0, entered: 0, pass: 0 }
      );
      const gradesYear = db.grades.filter((g) => g.yearId === y).length;

      let h = '<div class="page">';
      h +=
        '<div class="hero"><div style="position:relative;z-index:1">' +
        '<div class="hero-kicker">Ακαδημαϊκό έτος εργασίας</div>' +
        '<div class="hero-year">' + esc(C.yearLabel(db, y)) + '</div>' +
        '<div class="hero-sub">' + plural(db.students.length, 'σπουδαστής', 'σπουδαστές') + ' στο μητρώο · ' + plural(db.subjects.length, 'μάθημα', 'μαθήματα') + ' · ' + plural(db.years.length, 'ακαδημαϊκό έτος', 'ακαδημαϊκά έτη') + '</div>' +
        '</div><div class="hero-stats">' +
        heroStat(tot.students, 'Εγγεγραμμένοι') +
        heroStat(tot.deck, 'Deck') +
        heroStat(tot.engine, 'Engine') +
        heroStat(gradesYear, 'Βαθμοί') +
        heroStat(tot.expected ? pct(tot.entered / tot.expected) : '—', 'Συμπλήρωση') +
        '</div></div>';

      const steps = [
        { done: db.students.length > 0, t: 'Σπουδαστές & Α.Μ.', d: 'Εισάγετε από Excel τη λίστα με ονοματεπώνυμο και αριθμό μητρώου.', a: '<button class="btn btn-sm btn-soft" data-action="go" data-page="import" data-tab="students">' + icon('upload') + 'Εισαγωγή σπουδαστών</button>' },
        { done: db.subjects.length > 0, t: 'Μαθήματα', d: 'Δημιουργήστε τα μαθήματα κάθε επιπέδου (Deck / Engine / Κοινά).', a: '<button class="btn btn-sm btn-soft" data-action="go" data-page="subjects">' + icon('book') + 'Μαθήματα</button>' },
        { done: db.grades.length > 0, t: 'Βαθμολογίες καθηγητών', d: 'Εισάγετε το Excel του καθηγητή (Α.Μ. + βαθμός) — η αντιστοίχιση γίνεται αυτόματα.', a: '<button class="btn btn-sm btn-soft" data-action="go" data-page="import" data-tab="grades">' + icon('upload') + 'Εισαγωγή βαθμών</button>' },
        { done: false, t: 'Συνολική βαθμολογία', d: 'Εξαγωγή σε Excel με ονόματα, βαθμούς, μέσο όρο και αποτέλεσμα.', a: '<button class="btn btn-sm btn-soft" data-action="go" data-page="export">' + icon('download') + 'Εξαγωγή</button>' },
      ];
      const prevY = App.neighbourYear ? App.neighbourYear(y, -1) : null;
      if (prevY && !db.enrollments.some((e) => e.yearId === y) && db.enrollments.some((e) => e.yearId === prevY)) {
        h += '<div class="callout" style="margin-top:18px;align-items:center">' + icon('graduation') + '<p style="flex:1">Δεν υπάρχουν ακόμη εγγραφές στο <b>' + esc(C.yearLabel(db, y)) + '</b>. Μεταφέρετε τους σπουδαστές από το ' + esc(C.yearLabel(db, prevY)) + ' — οι επιτυχόντες πηγαίνουν στο επόμενο επίπεδο.</p><button class="btn btn-sm btn-primary" data-action="transferModal">Μεταφορά σπουδαστών</button></div>';
      }
      const showSteps = !db.students.length || !db.subjects.length || !db.grades.length;
      if (showSteps) {
        h += '<div class="section-title" style="margin-top:24px">Ροή εργασίας</div><div class="steps">';
        steps.forEach((s, i) => {
          h += '<div class="card step' + (s.done ? ' done' : '') + '"><div class="n">' + (s.done ? icon('check', 'width="14" height="14"') : i + 1) + '</div><h4>' + esc(s.t) + '</h4><p>' + esc(s.d) + '</p>' + s.a + '</div>';
        });
        h += '</div>';
      }

      h += '<div class="section-title" style="margin-top:24px">Επίπεδα — ' + esc(C.yearLabel(db, y)) + '</div><div class="grid grid-3">';
      // Support / Operational: one card each (Deck & Engine together).
      // Management: separate cards for Deck and Engine (Management Deck Function 1, Management Engine Function 1, …).
      const cards = [];
      sums.filter(({ l }) => !l.split).forEach((x) => cards.push({ l: x.l, s: x.s, spec: null }));
      ['DECK', 'ENGINE'].forEach((sp) => C.LEVELS.filter((l) => l.split).forEach((l) => cards.push({ l, s: C.levelSummary(db, y, l.id, sp), spec: sp })));
      cards.forEach(({ l, s, spec }) => {
        const comp = s.expected ? s.entered / s.expected : 0;
        const meta = spec
          ? '<span class="badge ' + (spec === 'DECK' ? 'badge-deck' : 'badge-engine') + '">' + C.specialtyName(spec) + '</span>'
          : C.isUnifiedLevel(l.id)
            ? '<span class="badge">Deck & Engine μαζί</span>'
            : '<span class="badge badge-deck">Deck ' + s.deck + '</span><span class="badge badge-engine">Engine ' + s.engine + '</span>';
        // classes (τμήματα)
        let classes = '';
        if (spec && C.isShiftLevel(l.id)) {
          const sh = C.getMgmtShift(db, y, l.id, spec);
          classes = '<div class="lc-classes"><span>Τμήμα: <b>' + (sh ? esc(C.sectionName(l.id, sh)) : '—') + '</b></span></div>';
        } else if (s.students) {
          const parts = C.levelSections(l.id).map((sec) => {
            const n = C.enrolledStudents(db, y, l.id, 'ALL', sec.id).length;
            return n ? '<span>' + esc(sec.name) + ': <b>' + n + '</b></span>' : '';
          });
          const none = C.enrolledStudents(db, y, l.id, 'ALL', 'NONE').length;
          if (none) parts.push('<span class="warning-text">Χωρίς τμήμα: <b>' + none + '</b></span>');
          classes = '<div class="lc-classes">' + parts.join('') + '</div>';
        }
        h +=
          '<div class="card level-card" data-action="go" data-page="gradebook" data-level="' + l.id + '"' + (spec ? ' data-spec="' + spec + '"' : '') + '>' +
          '<div class="lc-top"><div><div class="lc-code">' + esc(C.levelShort(l.id, spec)) + '</div><div class="lc-name">' + esc(C.levelName(db, l.id, spec)) + '</div></div>' +
          '<div class="right"><div class="lc-count">' + s.students + '</div><div class="small muted">σπουδαστές</div></div></div>' +
          '<div class="lc-meta">' + meta + '<span class="badge">' + plural(s.subjects, 'μάθημα', 'μαθήματα') + '</span></div>' + (s.students ? periodSplitHtml(db, y, l.id, spec) : '') + classes +
          '<div class="progress' + (comp >= 1 ? ' good' : '') + '"><span style="width:' + Math.round(comp * 100) + '%"></span></div>' +
          '<div class="lc-foot"><span>Βαθμοί ' + s.entered + ' / ' + s.expected + '</span><span>' +
          (s.students ? '<span class="success-text">' + s.counts.pass + ' επιτ.</span> · <span class="danger-text">' + s.counts.fail + ' υπολ.</span>' : '—') +
          '</span></div></div>';
      });
      h += '</div>';

      // recent imports + registry
      const recent = db.imports.slice(0, 6);
      h += '<div class="grid grid-2" style="margin-top:24px">';
      h += '<div class="card"><div class="card-head"><div><h3>Πρόσφατες εισαγωγές</h3><div class="sub">Αρχεία Excel που καταχωρίστηκαν</div></div><button class="btn btn-sm btn-ghost" data-action="go" data-page="import" data-tab="history">Όλες ' + icon('right') + '</button></div>';
      if (!recent.length) h += '<div class="card-body muted">Δεν έχει γίνει ακόμη καμία εισαγωγή.</div>';
      recent.forEach((r) => {
        h += '<div class="list-item"><div class="list-icon ' + (r.undone ? 'gray' : r.type === 'grades' ? 'green' : '') + '">' + icon(r.type === 'grades' ? 'sheet' : r.type === 'transfer' ? 'graduation' : 'users') + '</div>' +
          '<div style="min-width:0;flex:1"><div class="strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.fileName || (r.type === 'grades' ? 'Βαθμολογίες' : r.type === 'transfer' ? 'Μεταφορά σπουδαστών' : 'Σπουδαστές')) + '</div>' +
          '<div class="small muted">' + fmtDate(r.date, true) + ' · ' + esc(App.importSummaryText(r)) + '</div></div>' +
          (r.undone ? '<span class="badge">Αναιρέθηκε</span>' : '') + '</div>';
      });
      h += '</div>';

      const unenrolled = db.students.filter((s) => !C.getEnrollment(db, s.id, y)).length;
      h += '<div class="card"><div class="card-head"><div><h3>Μητρώο</h3><div class="sub">Αριθμοί μητρώου & εγγραφές</div></div><button class="btn btn-sm btn-ghost" data-action="go" data-page="students">Μητρώο ' + icon('right') + '</button></div><div class="card-body"><div class="kv">' +
        '<div class="k">Σύνολο σπουδαστών</div><div class="strong">' + db.students.length + '</div>' +
        '<div class="k">Εγγεγραμμένοι ' + esc(C.yearLabel(db, y)) + '</div><div class="strong">' + tot.students + '</div>' +
        '<div class="k">Χωρίς εγγραφή φέτος</div><div class="strong">' + unenrolled + '</div>' +
        '<div class="k">Επόμενος ελεύθερος Α.Μ.</div><div class="strong mono">' + esc(C.suggestNextAm(db) || '—') + '</div>' +
        '<div class="k">Τελευταία αλλαγή</div><div>' + fmtDate(db.updatedAt, true) + '</div>' +
        '</div><div class="row row-wrap" style="margin-top:16px"><button class="btn btn-sm" data-action="newStudent">' + icon('plus') + 'Νέος σπουδαστής</button><button class="btn btn-sm" data-action="go" data-page="import" data-tab="grades">' + icon('upload') + 'Εισαγωγή βαθμολογίας</button><button class="btn btn-sm btn-primary" data-action="go" data-page="export">' + icon('download') + 'Συνολική βαθμολογία</button></div></div></div>';
      h += '</div></div>';
      return h;
    },
  };

  function heroStat(v, l) {
    return '<div class="hero-stat"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>';
  }

  /** «Οκτ 45 · Ιαν 30» on a level card, when the level has two or more periods (intakes). */
  function periodSplitHtml(db, yearId, levelId, spec) {
    const list = C.levelPeriods(db, levelId);
    if (list.length < 2) return '';
    const sp = spec || 'ALL';
    const parts = list.map((p) => '<span class="lc-per" data-period="' + esc(p.id) + '" title="' + esc(p.name) + '">' + esc(p.short) + ' <b>' + C.enrolledStudents(db, yearId, levelId, sp, undefined, p.id).length + '</b></span>');
    const none = C.enrolledStudents(db, yearId, levelId, sp, undefined, 'NONE').length;
    if (none) parts.push('<span class="lc-per none" title="Εγγραφές χωρίς περίοδο">Χωρίς περίοδο <b>' + none + '</b></span>');
    return '<div class="lc-periods">' + parts.join('<span class="lc-sep">·</span>') + '</div>';
  }

  App.importSummaryText = function (r) {
    if (r.type === 'grades') {
      const subj = (r.subjectIds || []).map((id) => S.db.subjects.find((s) => s.id === id)).filter(Boolean);
      const names = subj.map((s) => s.code || s.name).join(', ');
      return (r.stats.added + r.stats.updated) + ' βαθμοί' + (names ? ' · ' + names : '') + ' · ' + C.yearLabel(S.db, r.yearId);
    }
    if (r.type === 'transfer') return 'Μεταφορά ' + r.stats.moved + ' σπουδαστών ' + C.yearLabel(S.db, r.fromYearId) + ' → ' + C.yearLabel(S.db, r.yearId);
    return r.stats.created + ' νέοι, ' + r.stats.updated + ' ενημερώσεις, ' + r.stats.enrolled + ' εγγραφές';
  };

  // ------------------------------------------------------------ settings
  /** Settings card: the periods (intakes) and which levels have which periods. */
  function periodsCardHtml(db) {
    const list = db.settings.periods || [];
    let h = '<div class="card" id="periods-card"><div class="card-head"><div><h3>Περίοδοι</h3><div class="sub">Κύκλοι έναρξης μέσα στο ακαδημαϊκό έτος — κάθε περίοδος λειτουργεί σαν χωριστό τμήμα</div></div></div><div class="card-body stack">';
    h += '<table class="table table-compact per-table"><thead><tr><th>Όνομα</th><th>Συντομογραφία</th><th class="num">Χρήση</th><th></th></tr></thead><tbody>';
    list.forEach((p) => {
      const n = C.periodUsage(db, p.id);
      h += '<tr data-period-row="' + esc(p.id) + '"><td><input class="input" value="' + esc(p.name) + '" data-on-change="perRename" data-id="' + esc(p.id) + '" data-f="name" /></td>' +
        '<td><input class="input per-short" value="' + esc(p.short) + '" data-on-change="perRename" data-id="' + esc(p.id) + '" data-f="short" /></td>' +
        '<td class="num nowrap small ' + (n ? '' : 'muted') + '">' + (n ? plural(n, 'εγγραφή', 'εγγραφές') : 'αχρησιμοποίητη') + '</td>' +
        '<td class="right"><button class="btn btn-sm btn-ghost btn-icon" title="' + (n ? 'Χρησιμοποιείται — δεν διαγράφεται' : 'Διαγραφή') + '" data-action="perDel" data-id="' + esc(p.id) + '">' + icon('trash') + '</button></td></tr>';
    });
    if (!list.length) h += '<tr><td colspan="4" class="muted small">Δεν υπάρχουν περίοδοι.</td></tr>';
    h += '</tbody></table>';
    h += '<div class="row per-add"><input class="input" id="per-new-name" placeholder="Νέα περίοδος (π.χ. Μάρτιος)" /><input class="input per-short" id="per-new-short" placeholder="Συντ." /><button class="btn btn-sm" data-action="perAdd">' + icon('plus') + 'Προσθήκη</button></div>';
    if (list.length) {
      h += '<div><div class="label" style="margin-bottom:6px">Περίοδοι ανά επίπεδο</div><div class="table-wrap per-matrix-wrap"><table class="table table-compact per-matrix"><thead><tr><th>Επίπεδο</th>' +
        list.map((p) => '<th class="center" title="' + esc(p.name) + '">' + esc(p.short) + '</th>').join('') + '<th></th></tr></thead><tbody>';
      C.LEVEL_IDS.forEach((lv) => {
        const on = C.levelPeriods(db, lv).map((p) => p.id);
        const note = !on.length ? 'χωρίς περιόδους' : on.length === 1 ? 'αυτόματα σε όλους' : on.length + ' περίοδοι';
        h += '<tr><td class="strong nowrap">' + esc(C.levelName(db, lv)) + '</td>' +
          list.map((p) => '<td class="center"><label class="checkbox" title="' + esc(C.levelName(db, lv) + ' – ' + p.name) + '"><input type="checkbox" data-on-change="lpToggle" data-level="' + lv + '" data-period="' + esc(p.id) + '"' + (on.includes(p.id) ? ' checked' : '') + ' /></label></td>').join('') +
          '<td class="small muted nowrap">' + esc(note) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }
    h += '<p class="small muted" style="margin:0">Η περίοδος αποθηκεύεται στην εγγραφή κάθε σπουδαστή. Επίπεδο με μία περίοδο: δίνεται αυτόματα σε όλους (π.χ. Operational A → Οκτώβριος). Επίπεδο χωρίς περίοδο: οι σπουδαστές του δεν έχουν περίοδο (π.χ. Management).</p>';
    h += '</div></div>';
    return h;
  }

  App.pages.settings = {
    subtitle: () => 'Ακαδημαϊκά έτη, επίπεδα, τμήματα, περίοδοι, κλίμακα, αντίγραφα ασφαλείας',
    render() {
      const db = S.db;
      let h = '<div class="page"><div class="grid grid-2" style="align-items:start">';
      // years
      h += '<div class="card"><div class="card-head"><div><h3>Ακαδημαϊκά έτη</h3><div class="sub">Το επιλεγμένο έτος ισχύει σε όλη την εφαρμογή</div></div><button class="btn btn-sm btn-primary" data-action="addYear">' + icon('plus') + 'Νέο έτος</button></div>';
      h += '<table class="table"><thead><tr><th>Έτος</th><th class="num">Εγγραφές</th><th class="num">Βαθμοί</th><th></th></tr></thead><tbody>';
      C.sortYears(db.years).forEach((y) => {
        const u = C.yearUsage(db, y.id);
        h += '<tr><td class="strong">' + esc(y.label) + (y.id === S.yearId ? ' <span class="badge badge-info">Τρέχον</span>' : '') + '</td><td class="num">' + u.enrollments + '</td><td class="num">' + u.grades + '</td><td class="right nowrap">' +
          (y.id !== S.yearId ? '<button class="btn btn-sm" data-action="useYear" data-id="' + y.id + '">Μετάβαση</button> ' : '') +
          (!u.enrollments && !u.grades && db.years.length > 1 ? '<button class="btn btn-sm btn-ghost btn-icon" title="Διαγραφή" data-action="delYear" data-id="' + y.id + '">' + icon('trash') + '</button>' : '') +
          '</td></tr>';
      });
      h += '</tbody></table></div>';

      // scale
      h += '<div class="card"><div class="card-head"><div><h3>Κλίμακα βαθμολογίας</h3><div class="sub">0–5 · βάση το 1 (50%)</div></div></div><div class="card-body">';
      h += '<table class="table table-compact scale-table"><thead><tr><th>Βαθμός</th><th>Αντιστοιχία</th><th>Αποτέλεσμα</th></tr></thead><tbody>';
      for (let g = 0; g <= 5; g++) {
        h += '<tr><td><span class="scale-pill' + (g < 1 ? ' fail' : '') + '">' + g + '</span></td><td>' + esc(C.gradeBand(g)) + '</td><td>' + (g < 1 ? '<span class="danger-text">Κάτω από βάση</span>' : '<span class="success-text">Προβιβάσιμος</span>') + '</td></tr>';
      }
      h += '</tbody></table><p class="small muted" style="margin:12px 0 0">Οι βαθμοί των καθηγητών είναι <b>ακέραιοι 0, 1, 2, 3, 4, 5</b> ή «ΑΠ» (απών). Δεκαδικοί βαθμοί (π.χ. 3,5) και ποσοστά δεν γίνονται δεκτοί — οι γραμμές αυτές εμφανίζονται ως σφάλμα στην εισαγωγή. Ο μέσος όρος είναι σταθμισμένος με τον συντελεστή κάθε μαθήματος.</p></div></div>';

      // levels
      h += '<div class="card"><div class="card-head"><div><h3>Ονομασίες επιπέδων</h3><div class="sub">Εμφανίζονται στις οθόνες και στις εξαγωγές Excel</div></div><button class="btn btn-sm btn-primary" data-action="saveLevelNames">' + icon('save') + 'Αποθήκευση</button></div><div class="card-body form-grid">';
      C.levelVariants().forEach((v) => {
        const key = C.levelNameKey(v.levelId, v.spec);
        h += '<div class="field"><label>' + esc(C.levelShort(v.levelId, v.spec)) + '</label><input class="input" data-level-name="' + key + '" data-level-id="' + v.levelId + '" data-level-spec="' + (v.spec || '') + '" value="' + esc(C.levelName(db, v.levelId, v.spec)) + '" placeholder="' + esc(C.defaultLevelName(v.levelId, v.spec)) + '" /></div>';
      });
      h += '</div></div>';

      // classes (τμήματα)
      h += '<div class="card"><div class="card-head"><div><h3>Τμήματα</h3><div class="sub">Προσθέστε, μετονομάστε ή διαγράψτε τμήματα (π.χ. «Morning 3»)</div></div></div><div class="card-body stack">';
      [['SUP', 'Support'], ['OL', 'Operational A / B (για Deck & Engine) και Management']].forEach(([g, title]) => {
        h += '<div><div class="label" style="margin-bottom:6px">' + esc(title) + '</div><div class="stack" style="gap:6px">';
        db.settings.sections[g].forEach((sec) => {
          const n = C.sectionUsage(db, g, sec.id);
          h += '<div class="row"><input class="input" style="max-width:260px" value="' + esc(sec.name) + '" data-on-change="secRename" data-group="' + g + '" data-id="' + sec.id + '" />' +
            '<span class="small muted" style="min-width:90px">' + (n ? plural(n, 'εγγραφή', 'εγγραφές') : 'αχρησιμοποίητο') + '</span>' +
            (n ? '' : '<button class="btn btn-sm btn-ghost btn-icon" title="Διαγραφή" data-action="secDel" data-group="' + g + '" data-id="' + sec.id + '">' + icon('trash') + '</button>') + '</div>';
        });
        h += '<div class="row"><input class="input" style="max-width:260px" placeholder="Νέο τμήμα…" id="sec-new-' + g + '" /><button class="btn btn-sm" data-action="secAdd" data-group="' + g + '">' + icon('plus') + 'Προσθήκη</button></div>';
        h += '</div></div>';
      });
      h += '<p class="small muted" style="margin:0">Στο Management όλο το τμήμα είναι είτε πρωί είτε απόγευμα — ορίζεται από το Βαθμολόγιο.</p></div></div>';

      // periods (intakes)
      h += periodsCardHtml(db);

      // absence limit
      const pct = C.absenceLimitPct(db);
      h += '<div class="card" id="absence-card"><div class="card-head"><div><h3>Όριο απουσιών</h3><div class="sub">Ισχύει για κάθε μάθημα — ημέρες από το «Ημερολόγιο & απουσίες»</div></div><button class="btn btn-sm btn-primary" data-action="saveAbsencePct">' + icon('save') + 'Αποθήκευση</button></div><div class="card-body">' +
        '<div class="row"><input class="input" id="abs-pct" type="number" min="0" max="100" step="1" value="' + pct + '" style="width:90px" /><span>% των ημερών του μαθήματος στο ημερολόγιο του τμήματος</span></div>' +
        '<p class="small muted" style="margin:12px 0 0;line-height:1.55">Μετράνε όλες οι απουσίες. Το όριο στρογγυλεύεται προς τα κάτω: με ' + pct + '% και 20 ημέρες μαθήματος επιτρέπονται έως <b>' + C.absenceLimit(20, pct) + '</b> απουσίες. ' +
        'Με περισσότερες ο σπουδαστής <b>δεν μπορεί να ξεκινήσει</b> τις εξετάσεις του μαθήματος (βλέπει μήνυμα στην οθόνη του), εκτός αν του δώσετε άδεια στη συγκεκριμένη εξέταση (Εξετάσεις → Αποτελέσματα).</p></div></div>';

      // server & backups
      const info = S.info || {};
      h += '<div class="card"><div class="card-head"><div><h3>Διακομιστής & αντίγραφα ασφαλείας</h3><div class="sub">Όλα τα δεδομένα βρίσκονται στον κεντρικό διακομιστή της ακαδημίας</div></div></div><div class="card-body">';
      h += '<div class="kv" style="margin-bottom:14px"><div class="k">Διακομιστής</div><div class="mono small">' + esc(Remote.url) + ' <span class="badge badge-success">συνδεδεμένος</span></div>' +
        '<div class="k">Χρήστης</div><div class="small"><b>' + esc(Remote.user ? Remote.user.name : '') + '</b> (' + esc(Remote.user ? Remote.user.username : '') + ') · διαχειριστής</div>' +
        '<div class="k">Αυτόματα αντίγραφα</div><div class="small">Στον διακομιστή: ένα κάθε μέρα και πριν από κάθε εισαγωγή/μεταφορά/επαναφορά, και καθημερινό αντίγραφο όλης της βάσης (φάκελος backups).</div></div>';
      h += '<div class="row row-wrap"><button class="btn btn-sm" data-action="backupNow">' + icon('shield') + 'Αντίγραφο τώρα</button><button class="btn btn-sm" data-action="exportBackup">' + icon('download') + 'Αποθήκευση αντιγράφου ως…</button><button class="btn btn-sm" data-action="restoreFromFile">' + icon('upload') + 'Επαναφορά από αρχείο…</button><button class="btn btn-sm" data-action="changeMyPassword">' + icon('key') + 'Αλλαγή κωδικού μου</button></div>';
      h += '<div id="local-data-box"></div>';
      h += '<div class="section-title" style="margin-top:18px">Πρόσφατα αντίγραφα στον διακομιστή</div><div id="backup-list" class="small muted">Φόρτωση…</div>';
      h += '</div></div>';
      h += '</div>';
      h += '<p class="small faint" style="margin-top:18px">GMC Maritime Academy Student Registry · έκδοση ' + esc(info.version || '') + ' · ' + esc(info.engine || '') + '</p></div>';
      return h;
    },
    async mount() {
      const el = document.getElementById('backup-list');
      // data of the previous version (local folder / shared folder) that can be moved to the server once
      const box = document.getElementById('local-data-box');
      if (box && api.localDataInfo) {
        api.localDataInfo().then((li) => {
          if (li && box.isConnected)
            box.innerHTML = '<div class="callout" style="margin-top:14px;align-items:center">' + icon('upload') + '<p style="flex:1">Σε αυτόν τον υπολογιστή υπάρχουν δεδομένα της προηγούμενης έκδοσης (' + Math.max(1, Math.round(li.size / 1024)) + ' KB).<br><span class="mono small">' + esc(li.path) + '</span></p><button class="btn btn-sm" data-action="uploadLocalData">Ανέβασμα στον διακομιστή…</button></div>';
        }).catch(() => {});
      }
      try {
        const list = await Remote.listBackups();
        if (!list.length) {
          el.textContent = 'Δεν υπάρχουν ακόμη αντίγραφα.';
          return;
        }
        el.innerHTML =
          '<table class="table table-compact"><tbody>' +
          list
            .slice(0, 8)
            .map(
              (b) =>
                '<tr><td>' + esc(backupLabel(b.reason)) + '</td><td class="nowrap">' + fmtDate(b.createdAt, true) + '</td><td class="small muted">' + esc(b.byUser || '') + '</td><td class="num nowrap">' + Math.max(1, Math.round(b.size / 1024)) + ' KB</td><td class="right"><button class="btn btn-sm" data-action="restoreBackup" data-name="' + esc(b.id) + '" data-label="' + esc(backupLabel(b.reason) + ' ' + fmtDate(b.createdAt, true)) + '">Επαναφορά</button></td></tr>'
            )
            .join('') +
          '</tbody></table>';
      } catch (e) {
        el.textContent = 'Δεν ήταν δυνατή η ανάγνωση: ' + e.message;
      }
    },
  };

  function backupLabel(reason) {
    const map = {
      auto: 'Ημερήσιο αυτόματο',
      manual: 'Χειροκίνητο',
      'pre-import': 'Πριν από εισαγωγή Excel',
      'pre-restore': 'Πριν από επαναφορά',
      'pre-delete': 'Πριν από διαγραφή',
      'pre-promote': 'Πριν από μεταφορά έτους',
      'pre-transfer': 'Πριν από μεταφορά σπουδαστών',
      'pre-datadir': 'Πριν από αλλαγή φακέλου δεδομένων',
      'pre-undo': 'Πριν από αναίρεση',
      'pre-bigchange': 'Πριν από μεγάλη αλλαγή',
      'pre-upload': 'Πριν από ανέβασμα τοπικών δεδομένων',
      corrupt: 'Κατεστραμμένο αρχείο (διασώθηκε)',
    };
    return map[reason] || reason || '';
  }

  // ------------------------------------------------------------ data of the previous version → server
  /** Read the registry.json the previous version kept on this PC (or in its shared folder). */
  async function readLocalRegistry() {
    const text = await api.readLocalData();
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('Τα τοπικά δεδομένα δεν είναι έγκυρα.');
    }
    const err = C.validateDbShape(obj);
    if (err) throw new Error(err);
    return obj;
  }

  App.actions.uploadLocalData = async () => {
    const obj = await readLocalRegistry();
    const msg = 'Τα δεδομένα του διακομιστή θα <b>αντικατασταθούν</b> από τα τοπικά δεδομένα αυτού του υπολογιστή (' +
      plural(obj.students.length, 'σπουδαστής', 'σπουδαστές') + ', ' + plural(obj.grades.length, 'βαθμός', 'βαθμοί') + ').<br><br>Πριν την αντικατάσταση κρατιέται αντίγραφο των τωρινών δεδομένων του διακομιστή.';
    if (!(await confirmDialog('Ανέβασμα τοπικών δεδομένων', msg, { okText: 'Ανέβασμα', danger: true }))) return;
    await backup('pre-upload');
    S.db = C.normalizeDb(obj);
    S.yearId = S.db.settings.currentYearId;
    persist();
    await flush();
    render();
    toast('Τα τοπικά δεδομένα ανέβηκαν στον διακομιστή', 'success');
  };

  App.actions.addYear = () => addYearModal();
  App.actions.useYear = (el) => setYear(el.dataset.id);
  App.actions.delYear = async (el) => {
    const y = S.db.years.find((x) => x.id === el.dataset.id);
    if (!(await confirmDialog('Διαγραφή έτους', 'Να διαγραφεί το ακαδημαϊκό έτος <b>' + esc(y.label) + '</b>;', { danger: true, okText: 'Διαγραφή' }))) return;
    mutate((db) => C.deleteYear(db, y.id));
    S.yearId = S.db.settings.currentYearId;
    render();
  };
  App.actions.secAdd = (el) => {
    const g = el.dataset.group;
    const inp = document.getElementById('sec-new-' + g);
    const sec = mutate((db) => C.addSection(db, g, inp.value));
    toast('Προστέθηκε το τμήμα <b>' + esc(sec.name) + '</b>');
  };
  App.changes.secRename = (el) => {
    mutate((db) => C.renameSection(db, el.dataset.group, el.dataset.id, el.value));
    toast('Το τμήμα μετονομάστηκε');
  };
  App.actions.secDel = async (el) => {
    const g = el.dataset.group;
    const sec = S.db.settings.sections[g].find((x) => x.id === el.dataset.id);
    if (!(await confirmDialog('Διαγραφή τμήματος', 'Να διαγραφεί το τμήμα <b>' + esc(sec.name) + '</b>;', { danger: true, okText: 'Διαγραφή' }))) return;
    mutate((db) => C.removeSection(db, g, sec.id));
  };

  // ---- periods (intakes)
  /** Run a settings change; a refusal from Core (duplicate name, period in use…) becomes a toast. */
  function tryMutate(fn) {
    try {
      return { ok: true, value: mutate(fn) };
    } catch (e) {
      toast(esc(e.message || String(e)), 'error');
      return { ok: false };
    }
  }

  App.actions.perAdd = () => {
    const name = document.getElementById('per-new-name').value;
    const short = document.getElementById('per-new-short').value;
    const r = tryMutate((db) => C.addPeriod(db, name, short));
    if (r.ok) toast('Προστέθηκε η περίοδος <b>' + esc(r.value.name) + '</b> — επιλέξτε σε ποια επίπεδα ισχύει');
  };
  App.changes.perRename = (el) => {
    const row = el.closest('tr');
    const name = row.querySelector('[data-f="name"]').value;
    const short = row.querySelector('[data-f="short"]').value;
    if (tryMutate((db) => C.renamePeriod(db, el.dataset.id, name, short)).ok) toast('Η περίοδος μετονομάστηκε');
    else render(); // back to the stored names
  };
  App.actions.perDel = async (el) => {
    const p = (S.db.settings.periods || []).find((x) => x.id === el.dataset.id);
    if (!p) return;
    // a period in use cannot be deleted: Core says why (shown as a toast)
    if (C.periodUsage(S.db, p.id)) return void tryMutate((db) => C.removePeriod(db, p.id));
    if (!(await confirmDialog('Διαγραφή περιόδου', 'Να διαγραφεί η περίοδος <b>' + esc(p.name) + '</b>; Αφαιρείται και από τα επίπεδα που την έχουν.', { danger: true, okText: 'Διαγραφή' }))) return;
    if (tryMutate((db) => C.removePeriod(db, p.id)).ok) toast('Η περίοδος διαγράφηκε');
  };
  App.changes.lpToggle = async (el) => {
    const lv = el.dataset.level;
    const pid = el.dataset.period;
    const ids = Array.from(document.querySelectorAll('input[data-on-change="lpToggle"][data-level="' + lv + '"]')).filter((x) => x.checked).map((x) => x.dataset.period);
    const lname = C.levelName(S.db, lv);
    // taking a period off a level: its enrollments with that period are left without one
    const used = el.checked ? 0 : S.db.enrollments.filter((e) => e.levelId === lv && e.period === pid).length;
    if (used) {
      const pname = C.periodName(pid);
      const ok = await confirmDialog(
        'Αφαίρεση περιόδου από επίπεδο',
        plural(used, 'εγγραφή', 'εγγραφές') + ' του <b>' + esc(lname) + '</b> έχ' + (used === 1 ? 'ει' : 'ουν') + ' την περίοδο <b>' + esc(pname) + '</b>. Αν αφαιρεθεί, θα μείνουν χωρίς περίοδο' + (ids.length === 1 ? ' (ή θα πάρουν αυτόματα τη μοναδική περίοδο του επιπέδου)' : '') + '.',
        { okText: 'Αφαίρεση', danger: true }
      );
      if (!ok) {
        el.checked = true;
        return;
      }
    }
    mutate((db) => {
      if (used)
        db.enrollments.forEach((e) => {
          if (e.levelId === lv && e.period === pid) {
            e.period = null;
            e.updatedAt = C.nowIso();
          }
        });
      C.setLevelPeriods(db, lv, ids);
    });
    const now = C.levelPeriods(S.db, lv);
    toast('<b>' + esc(lname) + '</b>: ' + esc(now.length ? now.map((p) => p.name).join(', ') : 'χωρίς περιόδους'));
  };

  App.actions.saveAbsencePct = () => {
    const v = document.getElementById('abs-pct').value;
    const r = tryMutate((db) => C.setAbsenceLimitPct(db, v));
    if (r.ok) toast('Όριο απουσιών: <b>' + r.value + '%</b> των ημερών κάθε μαθήματος');
  };

  App.actions.saveLevelNames = () => {
    const names = {};
    document.querySelectorAll('[data-level-name]').forEach((inp) => {
      const key = inp.dataset.levelName;
      const v = inp.value.trim();
      const def = C.defaultLevelName(inp.dataset.levelId, inp.dataset.levelSpec || null);
      if (v && v !== def) names[key] = v;
    });
    mutate((db) => (db.settings.levelNames = names));
    toast('Οι ονομασίες επιπέδων αποθηκεύτηκαν');
  };
  App.actions.backupNow = async () => {
    await flush();
    await Remote.createBackup('manual');
    toast('Δημιουργήθηκε αντίγραφο στον διακομιστή');
    render();
  };
  App.actions.exportBackup = async () => {
    await flush();
    const d = new Date();
    const name = 'GMC-Registry-backup-' + d.toISOString().slice(0, 10) + '.json';
    const bytes = new TextEncoder().encode(JSON.stringify(S.db, null, 1));
    const r = await api.saveFile({ defaultName: name, data: bytes, filters: [{ name: 'Αντίγραφο μητρώου', extensions: ['json'] }] });
    if (r) toast('Το αντίγραφο αποθηκεύτηκε: <b>' + esc(r.name) + '</b>');
  };

  async function restoreText(text, label) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('Το αρχείο δεν είναι έγκυρο αντίγραφο (JSON).');
    }
    const err = C.validateDbShape(obj);
    if (err) throw new Error(err);
    const msg =
      'Τα τρέχοντα δεδομένα θα αντικατασταθούν από το αντίγραφο <b>' + esc(label) + '</b> (' +
      plural(obj.students.length, 'σπουδαστής', 'σπουδαστές') + ', ' + plural(obj.grades.length, 'βαθμός', 'βαθμοί') + ').<br><br>Πριν την επαναφορά θα δημιουργηθεί αντίγραφο της τρέχουσας κατάστασης.';
    if (!(await confirmDialog('Επαναφορά αντιγράφου', msg, { okText: 'Επαναφορά', danger: true }))) return;
    await backup('pre-restore');
    S.db = C.normalizeDb(obj);
    S.yearId = S.db.settings.currentYearId;
    persist();
    await flush();
    render();
    toast('Η επαναφορά ολοκληρώθηκε');
  }
  App.actions.restoreBackup = async (el) => {
    const text = await Remote.readBackup(el.dataset.name);
    await restoreText(text, el.dataset.label || el.dataset.name);
  };
  App.actions.restoreFromFile = async () => {
    const f = await api.openFile({ title: 'Επιλογή αντιγράφου', filters: [{ name: 'Αντίγραφο μητρώου', extensions: ['json'] }] });
    if (!f) return;
    await restoreText(new TextDecoder().decode(f.data), f.name);
  };

  // ------------------------------------------------------------ expose & boot
  Object.assign(App, { mutate, persist, flush, render, go, backup, saveWorkbook, pickExcel, setYear, setSaveStatus });

  /** Show one of the three screens: login, admin application, student portal. */
  function setMode(mode) {
    document.body.classList.remove('mode-login', 'mode-admin', 'mode-student', 'mode-teacher', 'mode-loading');
    document.body.classList.add('mode-' + mode);
  }
  App.setMode = setMode;

  /** After an admin logs in: load the registry from the server. */
  App.startAdmin = async function () {
    setMode('loading');
    conflictOpen = false;
    const r = await Remote.loadRegistry();
    Remote.rev = r.rev || 0;
    let obj = r.data;
    if (!obj) {
      // empty server: first start — offer the data kept on this PC by the previous version
      let local = null;
      try {
        local = api.localDataInfo ? await api.localDataInfo() : null;
      } catch (e) {
        local = null;
      }
      if (local) {
        let parsed = null;
        try {
          parsed = await readLocalRegistry();
        } catch (e) {
          parsed = null;
        }
        if (parsed && (await confirmDialog('Πρώτη σύνδεση με τον διακομιστή', 'Ο διακομιστής δεν έχει ακόμη δεδομένα. Σε αυτόν τον υπολογιστή βρέθηκε το μητρώο της προηγούμενης έκδοσης (' + plural(parsed.students.length, 'σπουδαστής', 'σπουδαστές') + ', ' + plural(parsed.grades.length, 'βαθμός', 'βαθμοί') + ').<br><br>Να ανέβει στον διακομιστή ώστε να το βλέπουν όλοι οι υπολογιστές;', { okText: 'Ανέβασμα', cancelText: 'Κενό μητρώο' })))
          obj = parsed;
      }
    }
    const fresh = !r.data;
    S.db = C.normalizeDb(obj || C.createEmptyDb(new Date()));
    baseText = fresh ? null : JSON.stringify(S.db); // the server's version (as normalised here): base of later merges
    keepMine = false;
    S.yearId = S.db.settings.currentYearId;
    S.page = 'dashboard';
    setMode('admin');
    if (fresh) {
      persist();
      await flush();
    }
    setSaveStatus('saved');
    render();
    startPolling();
  };

  /** Log out (keeps nothing of the registry in memory). */
  let loggingOut = false;
  App.logout = async function () {
    if (loggingOut) return;
    loggingOut = true;
    try {
      if (S.db && dirty && Remote.token) await flush();
      if (saving) await saving;
      stopPolling();
      clearTimeout(saveTimer);
      if (App.student && App.student.stop) App.student.stop();
      if (App.teacher && App.teacher.stop) App.teacher.stop();
      if (App.exams && App.exams.reset) App.exams.reset();
      if (App.calendar && App.calendar.reset) App.calendar.reset();
      if (App.accounts && App.accounts.reset) App.accounts.reset();
      App.ui.closeAllModals();
      await Remote.logout();
      S.db = null;
      S.page = 'dashboard';
      dirty = false;
      conflictOpen = false;
      baseText = null;
      keepMine = false;
      document.getElementById('content').innerHTML = '';
      document.getElementById('nav').innerHTML = '';
      const tr = document.getElementById('toast-root');
      if (tr) tr.innerHTML = ''; // nothing of the previous user stays on screen
      App.auth.showLogin();
    } finally {
      loggingOut = false;
    }
  };
  App.actions.logout = async () => {
    if (dirty || saving) await flush();
    if (saving) await saving;
    if (dirty) {
      const ok = await confirmDialog('Μη αποθηκευμένες αλλαγές', 'Οι τελευταίες αλλαγές σας <b>δεν αποθηκεύτηκαν</b> στον διακομιστή (δείτε το μήνυμα αποθήκευσης επάνω δεξιά). Αν βγείτε τώρα θα χαθούν.', { okText: 'Έξοδος χωρίς αποθήκευση', cancelText: 'Παραμονή', danger: true });
      if (!ok) return;
    }
    const cur = App.pages[S.page];
    if (cur && cur.confirmLeave && !(await cur.confirmLeave())) return;
    await App.logout();
  };

  let wired = false;
  async function boot() {
    if (!wired) {
      App.ui.wire();
      wired = true;
      if (api && api.onCloseRequest) {
        api.onCloseRequest(async () => {
          const ae = document.activeElement;
          if (ae && ae.matches && ae.matches('input[data-gsid], input[data-tsid]')) ae.blur();
          if (S.db) await flush();
          if (saving) await saving;
          if (App.student && App.student.flush) await App.student.flush();
        });
      }
    }
    if (!api || !Remote) {
      document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Η εφαρμογή πρέπει να εκτελείται μέσα από το πρόγραμμα.</div>';
      return;
    }
    try {
      S.info = await api.appInfo();
    } catch (e) {
      S.info = {};
    }
    App.auth.showLogin();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
