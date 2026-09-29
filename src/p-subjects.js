/* Μαθήματα: per level, specialty (Deck / Engine / Κοινό), weight, order. */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, plural, options, toast, openModal, confirmDialog, emptyState, specBadge, fmtDate } = App.ui;
  const Remote = window.Remote;

  const F = { levelId: 'SUP', spec: 'ALL' };
  const S = () => App.S;

  // ------------------------------------------------------------ syllabus (Ύλη): shared by this page and the teacher portal
  /**
   * App.syllabusUi — PDF files of a subject (Remote.syllabus*): picking/checking a PDF, the file rows and the viewer.
   * Rows carry data-syl="view|del" data-id="<file id>"; the caller wires the clicks.
   */
  const SYL = {
    MAX: 50 * 1024 * 1024, // same limit as the server
    fmtSize(n) {
      const b = Number(n) || 0;
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
      return (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0).replace('.', ',') + ' MB';
    },
    isPdf(b) {
      return !!b && b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // %PDF-
    },
    /** Who uploaded a file: "Γ. Παπαδόπουλος (καθηγητής)". */
    uploader(f) {
      const who = f.byName || f.by || '';
      return who ? who + (f.byRole === 'teacher' ? ' (καθηγητής)' : f.byRole === 'admin' ? ' (γραμματεία)' : '') : '';
    },
    /** File picker (PDF only) → {name, bytes} | null; throws (Greek) when the file is not a PDF or larger than 50 MB. */
    async pick() {
      const f = await window.api.openFile({ title: 'Επιλογή αρχείου PDF (ύλη μαθήματος)', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!f) return null;
      const bytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || []);
      const name = f.name || 'ύλη.pdf';
      if (!bytes.length) throw new Error('Το αρχείο «' + name + '» είναι κενό.');
      if (bytes.length > SYL.MAX) throw new Error('Το αρχείο «' + name + '» είναι πολύ μεγάλο (' + SYL.fmtSize(bytes.length) + ') — μέγιστο 50 MB.');
      if (!SYL.isPdf(bytes)) throw new Error('Το αρχείο «' + name + '» δεν είναι PDF.');
      return { name, bytes };
    },
    /** Pick a PDF and upload it to a subject → the new entry, or null when cancelled. */
    async upload(subjectId) {
      const f = await SYL.pick();
      if (!f) return null;
      const r = await Remote.uploadSyllabus(subjectId, f.name, f.bytes);
      return r.file;
    },
    /** Download a file and show it in the in-app viewer (Greek labels). sub: second line (e.g. the subject). */
    async view(f, sub) {
      const bytes = await Remote.syllabusFile(f.id);
      return App.pdfViewer.open({ title: String(f.name || '').replace(/\.pdf$/i, '') || 'Ύλη', sub: sub || '', bytes, fileName: f.name, lang: 'el' });
    },
    /** Ask, then delete → true when deleted. */
    async remove(f, subjectText) {
      const ok = await confirmDialog('Διαγραφή αρχείου ύλης', 'Να διαγραφεί το αρχείο <b>' + esc(f.name) + '</b>' + (subjectText ? ' από την ύλη του μαθήματος <b>' + esc(subjectText) + '</b>' : '') + ';<br><br>Οι σπουδαστές δεν θα το βλέπουν πια.', { okText: 'Διαγραφή', danger: true });
      if (!ok) return false;
      await Remote.deleteSyllabus(f.id);
      return true;
    },
    /** The rows of a file list. o.busy: id of the file being opened. */
    rowsHtml(files, o) {
      const busy = (o && o.busy) || null;
      return '<div class="syl-list">' +
        files
          .map((f) => {
            const meta = [SYL.fmtSize(f.size), f.uploadedAt ? fmtDate(f.uploadedAt, true) : '', SYL.uploader(f)].filter(Boolean).join(' · ');
            const on = busy !== null && String(busy) === String(f.id);
            return '<div class="syl-row" data-fid="' + esc(f.id) + '"><span class="sy-pdf" aria-hidden="true">PDF</span>' +
              '<div class="syl-main"><div class="syl-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div><div class="syl-meta">' + esc(meta) + '</div></div>' +
              '<button class="btn btn-sm" data-syl="view" data-id="' + esc(f.id) + '"' + (busy !== null ? ' disabled' : '') + '>' + (on ? '<span class="syl-spin"></span>Άνοιγμα…' : icon('eye') + 'Προβολή') + '</button>' +
              '<button class="btn btn-sm btn-ghost btn-icon" data-syl="del" data-id="' + esc(f.id) + '" title="Διαγραφή"' + (busy !== null ? ' disabled' : '') + '>' + icon('trash') + '</button></div>';
          })
          .join('') +
        '</div>';
    },
  };
  App.syllabusUi = SYL;

  /** Syllabus files of every subject (one Remote.syllabus() call) → counts on this page. */
  const SY = { files: null, loading: false, error: '', at: 0, tried: 0, token: null };
  function loadSyllabusCounts() {
    if (SY.loading) return Promise.resolve(false);
    SY.loading = true;
    SY.tried = Date.now();
    const token = Remote.token;
    const before = JSON.stringify(SY.files);
    return Remote.syllabus()
      .then((r) => {
        if (Remote.token !== token) return false;
        SY.files = (r && r.files) || [];
        SY.at = Date.now();
        SY.token = token;
        SY.error = '';
        return JSON.stringify(SY.files) !== before;
      })
      .catch((e) => {
        SY.error = e.message;
        return !SY.files; // (the tooltip of the buttons tells why there are no counts)
      })
      .finally(() => (SY.loading = false));
  }
  function syllabusCount(subjectId) {
    return SY.files && SY.token === Remote.token ? SY.files.filter((f) => f.subjectId === subjectId).length : null;
  }
  /** A subject's list changed in a dialog: keep the page's counts right without asking the server again. */
  function setSubjectFiles(subjectId, files) {
    if (!SY.files) return;
    SY.files = SY.files.filter((f) => f.subjectId !== subjectId).concat(files);
  }

  // ------------------------------------------------------------ teachers of a subject (accounts cache of p-accounts.js)
  const users = () => (App.accounts && App.accounts.state ? App.accounts.state() : { users: null, loading: false, error: '', at: 0, tried: 0 });

  /** Teachers with assignments of this subject in a year → [{u, as:[assignment]}] (by name). */
  function subjectTeachers(list, yearId, subjectId) {
    return (list || [])
      .filter((u) => u.role === 'teacher')
      .map((u) => ({ u, as: (u.assignments || []).filter((a) => a.yearId === yearId && a.subjectId === subjectId) }))
      .filter((x) => x.as.length)
      .sort((a, b) => String(a.u.name || a.u.username).localeCompare(String(b.u.name || b.u.username), 'el'));
  }

  function teachersCell(db, yearId, s) {
    const st = users();
    const manage = (label) =>
      '<button class="btn btn-sm btn-ghost ' + (label ? 'sb-tadd' : 'btn-icon sb-tedit') + '" data-action="sbTeachers" data-id="' + s.id + '" title="Καθηγητές του μαθήματος (' + esc(C.yearLabel(db, yearId)) + ')">' + icon(label ? 'plus' : 'edit') + (label || '') + '</button>';
    if (!st.users) {
      if (st.error && !st.loading)
        return '<div class="sb-teachers"><span class="sb-terr" title="' + esc('Οι καθηγητές δεν φορτώθηκαν: ' + st.error) + '">' + icon('alert', 'width="13" height="13"') + 'μη διαθέσιμο</span></div>';
      return '<div class="sb-teachers"><span class="faint">…</span></div>';
    }
    const list = subjectTeachers(st.users, yearId, s.id);
    if (!list.length) return '<div class="sb-teachers">' + manage('Ανάθεση') + '</div>';
    return '<div class="sb-teachers"><div class="sb-tnames">' +
      list
        .map(({ u, as }) => {
          const tip = (u.name || u.username) + ' (' + u.username + ')' + (u.active ? '' : ' — ανενεργός') + '\n' + as.map((a) => '• ' + C.assignmentLabel(db, a)).join('\n');
          return '<span class="sb-teacher' + (u.active ? '' : ' off') + '" title="' + esc(tip) + '">' + esc(u.name || u.username) + '</span>';
        })
        .join('') +
      '</div>' + manage('') + '</div>';
  }

  function syllabusButton(s) {
    const n = syllabusCount(s.id);
    const tip = n === null ? (SY.error ? 'Η ύλη δεν φορτώθηκε: ' + SY.error : 'Ύλη μαθήματος (PDF)') : n ? plural(n, 'αρχείο', 'αρχεία') + ' PDF ύλης' : 'Δεν έχει ανέβει ύλη — πατήστε για ανέβασμα PDF';
    return '<button class="btn btn-sm sb-syl' + (n ? ' has' : '') + '" data-action="sbSyllabus" data-id="' + s.id + '" title="' + esc(tip) + '">' + icon('file') + 'Ύλη' +
      (n === null ? '' : '<span class="sb-count">' + n + '</span>') + '</button>';
  }

  App.pages.subjects = {
    subtitle: () => 'Τα μαθήματα κάθε επιπέδου — ισχύουν για όλα τα ακαδημαϊκά έτη',
    setLevel(l) {
      F.levelId = l;
    },
    render() {
      const { db, yearId } = S();
      let h = '<div class="page">';
      h += '<div class="tabs">' + C.LEVELS.map((l) => '<button class="tab' + (l.id === F.levelId ? ' on' : '') + '" data-action="sbLevel" data-level="' + l.id + '">' + esc(l.short) + '<span class="count">' + C.subjectsOfLevel(db, l.id).length + '</span></button>').join('') + '</div>';
      const unified = C.isUnifiedLevel(F.levelId);
      const spec = unified ? 'ALL' : F.spec;
      const all = C.subjectsOfLevel(db, F.levelId);
      const list = all.filter((s) => spec === 'ALL' || s.specialty === spec);
      h += '<div class="toolbar"><div><div class="strong" style="font-size:15px">' + esc(C.levelName(db, F.levelId, spec === 'DECK' || spec === 'ENGINE' ? spec : null)) + '</div><div class="small muted">' + plural(all.length, 'μάθημα', 'μαθήματα') + ' · ' +
        (unified
          ? 'όλα κοινά για Deck & Engine'
          : all.filter((s) => s.specialty === 'COMMON').length + ' κοινά · ' + all.filter((s) => s.specialty === 'DECK').length + ' Deck · ' + all.filter((s) => s.specialty === 'ENGINE').length + ' Engine') +
        '</div></div><div class="spacer"></div>' +
        (unified ? '' : '<div class="seg">' + [['ALL', 'Όλα'], ['COMMON', 'Κοινά'], ['DECK', 'Deck'], ['ENGINE', 'Engine']].map((x) => '<button class="' + (spec === x[0] ? 'on' : '') + '" data-action="sbSpec" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>') +
        '<button class="btn" data-action="sbBulk">' + icon('list') + 'Μαζική προσθήκη</button>' +
        '<button class="btn btn-primary" data-action="sbNew">' + icon('plus') + 'Νέο μάθημα</button></div>';

      h += '<div class="card">';
      if (!all.length) {
        h += emptyState('book', 'Δεν υπάρχουν μαθήματα στο ' + C.levelShort(F.levelId), unified ? 'Προσθέστε τα μαθήματα του Support. Όλα είναι κοινά για Deck και Engine.' : 'Προσθέστε τα μαθήματα του επιπέδου. Ορίστε αν κάθε μάθημα είναι <b>κοινό</b> ή μόνο για <b>Deck</b> / <b>Engine</b> — έτσι κάθε σπουδαστής βαθμολογείται μόνο στα δικά του μαθήματα.',
          '<div class="row" style="justify-content:center"><button class="btn btn-primary" data-action="sbNew">' + icon('plus') + 'Νέο μάθημα</button><button class="btn" data-action="sbBulk">' + icon('list') + 'Μαζική προσθήκη</button></div>');
      } else if (!list.length) {
        h += emptyState('book', 'Κανένα μάθημα με αυτό το φίλτρο', 'Επιλέξτε «Όλα» για να δείτε όλα τα μαθήματα του επιπέδου.');
      } else {
        h += '<div class="table-wrap"><table class="table sb-table"><thead><tr><th style="width:70px">Σειρά</th><th>Κωδικός</th><th>Μάθημα</th>' + (unified ? '' : '<th>Ειδικότητα</th>') + '<th class="num">Συντελεστής</th><th class="num" title="Βαθμοί του ' + esc(C.yearLabel(db, yearId)) + '">Βαθμοί</th><th title="Καθηγητές του ' + esc(C.yearLabel(db, yearId)) + ' (κάθε καθηγητής βλέπει μόνο τα τμήματά του)">Καθηγητές</th><th>Κατάσταση</th><th></th></tr></thead><tbody>';
        list.forEach((s, i) => {
          const n = db.grades.filter((g) => g.subjectId === s.id && g.yearId === yearId).length;
          h += '<tr' + (s.active === false ? ' style="opacity:.6"' : '') + '><td class="nowrap"><button class="btn btn-ghost btn-icon btn-sm" data-action="sbMove" data-id="' + s.id + '" data-dir="-1" title="Πάνω"' + (i === 0 || spec !== 'ALL' ? ' disabled' : '') + '>' + icon('up') + '</button><button class="btn btn-ghost btn-icon btn-sm" data-action="sbMove" data-id="' + s.id + '" data-dir="1" title="Κάτω"' + (i === list.length - 1 || spec !== 'ALL' ? ' disabled' : '') + '>' + icon('down') + '</button></td>' +
            '<td class="mono strong">' + esc(s.code || '—') + '</td><td class="strong">' + esc(s.name) + '</td>' + (unified ? '' : '<td>' + specBadge(s.specialty) + '</td>') + '<td class="num">' + esc(C.formatGrade(s.weight || 1)) + '</td><td class="num">' + n + '</td>' +
            '<td class="sb-tcell">' + teachersCell(db, yearId, s) + '</td>' +
            '<td>' + (s.active === false ? '<span class="badge">Ανενεργό</span>' : '<span class="badge badge-success">Ενεργό</span>') + '</td>' +
            '<td class="right nowrap">' + syllabusButton(s) + ' <button class="btn btn-sm" data-action="sbTemplate" data-id="' + s.id + '" title="Πρότυπο Excel για τον καθηγητή">' + icon('sheet') + '<span class="sb-lbl">Πρότυπο</span></button> ' +
            '<button class="btn btn-sm btn-soft" data-action="exportSubject" data-id="' + s.id + '" title="Εξαγωγή της βαθμολογίας του μαθήματος (μόνο Α.Μ. και βαθμός)"' + (n ? '' : ' disabled') + '>' + icon('download') + '<span class="sb-lbl">Βαθμολογία</span></button> ' +
            (C.gradeLock(db, S().yearId, s.id)
              ? '<button class="btn btn-sm btn-lock on" data-action="sbLock" data-id="' + s.id + '" data-on="0" title="Η βαθμολογία του ' + esc(C.yearLabel(db, S().yearId)) + ' είναι κλειδωμένη για τους καθηγητές — πατήστε για ξεκλείδωμα">' + icon('lock') + '<span class="sb-lbl">Κλειδωμένη</span></button>'
              : '<button class="btn btn-sm btn-ghost btn-lock" data-action="sbLock" data-id="' + s.id + '" data-on="1" title="Κλείδωμα βαθμολογίας ' + esc(C.yearLabel(db, S().yearId)) + ': ο καθηγητής δεν θα μπορεί να αλλάξει βαθμούς">' + icon('lock') + '</button>') +
            ' <button class="btn btn-sm btn-ghost btn-icon" data-action="sbEdit" data-id="' + s.id + '" title="Επεξεργασία">' + icon('edit') + '</button><button class="btn btn-sm btn-ghost btn-icon" data-action="sbDelete" data-id="' + s.id + '" title="Διαγραφή">' + icon('trash') + '</button></td></tr>';
        });
        h += '</tbody></table></div>';
      }
      h += '</div>';
      h += '<p class="small muted" style="margin-top:12px">' + icon('info', 'width="13" height="13" style="vertical-align:-2px"') + ' Ο <b>συντελεστής</b> βαραίνει το μάθημα στον μέσο όρο (προεπιλογή 1). Ένα μάθημα με βαθμούς δεν διαγράφεται — απενεργοποιήστε το για να μην εμφανίζεται σε νέα έτη.</p>';
      h += '</div>';
      return h;
    },
    /** Teachers (accounts) and syllabus counts come from the server: loaded in the background, kept for a minute. */
    mount() {
      const now = Date.now();
      const jobs = [];
      const st = users();
      if (App.accounts && !st.loading && now - st.tried > 15000 && (!st.users || now - st.at > 60000)) {
        const before = JSON.stringify(st.users);
        jobs.push(App.accounts.reload().then(() => JSON.stringify(users().users) !== before || !!users().error));
      }
      if (!SY.loading && now - SY.tried > 15000 && (!SY.files || now - SY.at > 60000 || SY.token !== Remote.token)) jobs.push(loadSyllabusCounts());
      if (!jobs.length) return;
      Promise.all(jobs).then((changed) => {
        if (changed.some(Boolean) && S().page === 'subjects' && S().db) App.render();
      });
    },
  };

  App.actions.sbLevel = (el) => {
    F.levelId = el.dataset.level;
    App.render();
  };
  App.actions.sbSpec = (el) => {
    F.spec = el.dataset.v;
    App.render();
  };
  App.actions.sbMove = (el) => {
    App.mutate((d) => C.moveSubject(d, el.dataset.id, Number(el.dataset.dir)));
  };

  function subjectForm(s) {
    const levelOpts = C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(S().db, l.id) }));
    return (
      '<div class="form-grid">' +
      '<div class="field span-2"><label>Επίπεδο</label><select class="select" id="sb-level"' + (s && C.subjectUsage(S().db, s.id) ? ' disabled title="Το μάθημα έχει βαθμούς"' : '') + '>' + options(levelOpts, s ? s.levelId : F.levelId) + '</select></div>' +
      '<div class="field"><label>Κωδικός</label><input class="input" id="sb-code" value="' + esc(s ? s.code : '') + '" placeholder="π.χ. NAV101" /><div class="hint">Προαιρετικός — εμφανίζεται στις στήλες του Excel.</div></div>' +
      '<div class="field"><label>Συντελεστής</label><input class="input" id="sb-weight" type="number" min="0.5" step="0.5" value="' + esc(s ? s.weight : 1) + '" /></div>' +
      '<div class="field span-2"><label>Όνομα μαθήματος *</label><input class="input" id="sb-name" value="' + esc(s ? s.name : '') + '" autofocus /></div>' +
      '<div class="field span-2"><label>Αφορά</label><select class="select" id="sb-spec">' + options(C.SUBJECT_SPECIALTIES.map((x) => ({ value: x.id, label: x.name })), s ? s.specialty : F.spec !== 'ALL' && !C.isUnifiedLevel(F.levelId) ? F.spec : 'COMMON') + '</select><div class="hint" id="sb-spec-hint"></div></div>' +
      (s ? '<label class="checkbox span-2"><input type="checkbox" id="sb-active"' + (s.active !== false ? ' checked' : '') + ' /> Ενεργό μάθημα</label>' : '') +
      '</div>'
    );
  }

  /** Support subjects are always common: lock the "Αφορά" selector while that level is chosen. */
  function wireSpecLock(ctx, levelSel, specSel, hintSel) {
    const lvl = ctx.q(levelSel);
    const spec = ctx.q(specSel);
    const hint = hintSel ? ctx.q(hintSel) : null;
    const upd = () => {
      const unified = C.isUnifiedLevel(lvl.value);
      if (unified) spec.value = 'COMMON';
      spec.disabled = unified;
      if (hint) hint.textContent = unified ? 'Στο Support όλα τα μαθήματα είναι κοινά για Deck και Engine.' : '';
    };
    lvl.addEventListener('change', upd);
    upd();
  }

  function readForm(ctx) {
    return {
      levelId: ctx.q('#sb-level').value,
      code: ctx.q('#sb-code').value,
      name: ctx.q('#sb-name').value,
      weight: ctx.q('#sb-weight').value,
      specialty: ctx.q('#sb-spec').value,
      active: ctx.q('#sb-active') ? ctx.q('#sb-active').checked : true,
    };
  }

  App.actions.sbNew = () => {
    const create = (ctx, again) => {
      const data = readForm(ctx);
      const s = App.mutate((d) => C.createSubject(d, data));
      F.levelId = s.levelId;
      App.render();
      toast('Προστέθηκε το μάθημα <b>' + esc(C.subjectLabel(s)) + '</b>');
      if (again) {
        ctx.q('#sb-code').value = '';
        ctx.q('#sb-name').value = '';
        ctx.q('#sb-name').focus();
        return false;
      }
    };
    openModal({
      title: 'Νέο μάθημα',
      body: subjectForm(null),
      buttons: [
        { label: 'Άκυρο' },
        { label: 'Αποθήκευση & νέο', onClick: (ctx) => create(ctx, true) },
        { label: 'Αποθήκευση', cls: 'btn-primary', onClick: (ctx) => create(ctx, false) },
      ],
      onMount(ctx) {
        wireSpecLock(ctx, '#sb-level', '#sb-spec', '#sb-spec-hint');
        ctx.q('#sb-name').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') ctx.el.querySelectorAll('.modal-foot .btn')[1].click();
        });
      },
    });
  };

  App.actions.sbEdit = (el) => {
    const s = S().db.subjects.find((x) => x.id === el.dataset.id);
    openModal({
      title: 'Επεξεργασία μαθήματος',
      body: subjectForm(s),
      onMount: (ctx) => wireSpecLock(ctx, '#sb-level', '#sb-spec', '#sb-spec-hint'),
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Αποθήκευση',
          cls: 'btn-primary',
          onClick: (ctx) => {
            const data = readForm(ctx);
            App.mutate((d) => {
              if (data.levelId !== s.levelId && !C.subjectUsage(d, s.id)) {
                s.levelId = data.levelId;
                s.order = C.subjectsOfLevel(d, data.levelId).length;
              }
              C.updateSubject(d, s.id, data);
            });
            toast('Το μάθημα ενημερώθηκε');
          },
        },
      ],
    });
  };

  App.actions.sbDelete = async (el) => {
    const { db } = S();
    const s = db.subjects.find((x) => x.id === el.dataset.id);
    const n = C.subjectUsage(db, s.id);
    if (n) {
      const ok = await confirmDialog('Το μάθημα έχει βαθμούς', 'Το μάθημα <b>' + esc(s.name) + '</b> έχει ' + plural(n, 'καταχωρισμένο βαθμό', 'καταχωρισμένους βαθμούς') + ' και δεν μπορεί να διαγραφεί.<br><br>Θέλετε να το <b>απενεργοποιήσετε</b>; Θα συνεχίσει να εμφανίζεται μόνο στα έτη όπου έχει βαθμούς.', { okText: 'Απενεργοποίηση' });
      if (ok) App.mutate((d) => C.updateSubject(d, s.id, { active: false }));
      return;
    }
    if (!(await confirmDialog('Διαγραφή μαθήματος', 'Να διαγραφεί το μάθημα <b>' + esc(C.subjectLabel(s)) + '</b>;', { danger: true, okText: 'Διαγραφή' }))) return;
    App.mutate((d) => C.deleteSubject(d, s.id));
    toast('Το μάθημα διαγράφηκε');
  };

  App.actions.sbBulk = () => {
    const levelOpts = C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(S().db, l.id) }));
    openModal({
      title: 'Μαζική προσθήκη μαθημάτων',
      size: 'lg',
      body:
        '<div class="form-grid"><div class="field"><label>Επίπεδο</label><select class="select" id="bk-level">' + options(levelOpts, F.levelId) + '</select></div>' +
        '<div class="field"><label>Αφορά (αν δεν ορίζεται στη γραμμή)</label><select class="select" id="bk-spec">' + options(C.SUBJECT_SPECIALTIES.map((x) => ({ value: x.id, label: x.name })), F.spec !== 'ALL' ? F.spec : 'COMMON') + '</select></div>' +
        '<div class="field span-2"><label>Ένα μάθημα ανά γραμμή</label><textarea class="textarea mono" id="bk-text" rows="10" placeholder="NAV101; Ναυσιπλοΐα; Deck; 2\nENG101; Ναυτικές Μηχανές; Engine\nΝαυτικά Αγγλικά"></textarea>' +
        '<div class="hint">Μορφή: <b>Κωδικός; Όνομα; Deck/Engine/Κοινό; Συντελεστής</b> — ή μόνο το όνομα. Μπορείτε να κάνετε επικόλληση απευθείας από στήλες Excel.</div></div></div>' +
        '<div id="bk-prev" class="small muted" style="margin-top:10px"></div>',
      onMount(ctx) {
        wireSpecLock(ctx, '#bk-level', '#bk-spec', null);
        const upd = () => {
          const items = C.parseSubjectLines(ctx.q('#bk-text').value);
          ctx.q('#bk-prev').textContent = items.length ? 'Θα προστεθούν ' + plural(items.length, 'μάθημα', 'μαθήματα') + '.' : '';
        };
        ctx.q('#bk-text').addEventListener('input', upd);
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Προσθήκη',
          cls: 'btn-primary',
          onClick: (ctx) => {
            const levelId = ctx.q('#bk-level').value;
            const defSpec = ctx.q('#bk-spec').value;
            const items = C.parseSubjectLines(ctx.q('#bk-text').value);
            if (!items.length) throw new Error('Γράψτε τουλάχιστον ένα μάθημα.');
            // validate first so that nothing is half-added
            const test = JSON.parse(JSON.stringify(S().db));
            items.forEach((it, i) => {
              try {
                C.createSubject(test, { levelId, code: it.code, name: it.name, specialty: it.specialty || defSpec, weight: it.weight });
              } catch (e) {
                throw new Error('Γραμμή ' + (i + 1) + ': ' + e.message);
              }
            });
            App.mutate((d) => items.forEach((it) => C.createSubject(d, { levelId, code: it.code, name: it.name, specialty: it.specialty || defSpec, weight: it.weight })));
            F.levelId = levelId;
            App.render();
            toast('Προστέθηκαν ' + plural(items.length, 'μάθημα', 'μαθήματα'));
          },
        },
      ],
    });
  };

  App.actions.sbTemplate = (el) => App.teacherTemplateModal(el.dataset.id);

  // ------------------------------------------------------------ teachers of a subject (from the subject side)
  /**
   * Rows [teacher · class · period] of one subject for the working year. Several teachers may share the subject,
   * even the same class. Saving rewrites, for every teacher whose rows changed, his whole list
   * (his other subjects and years stay as they are on the server).
   */
  App.actions.sbTeachers = async (el) => {
    const { db, yearId } = S();
    const sj = db.subjects.find((x) => x.id === el.dataset.id);
    if (!sj) return;
    const TA = App.teacherAssign;
    await App.accounts.reload(); // what the server has now (another PC may have changed it)
    const st = users();
    if (!st.users) throw new Error('Δεν ήταν δυνατή η φόρτωση των καθηγητών: ' + (st.error || 'άγνωστο σφάλμα'));
    if (S().page === 'subjects') App.render();
    const teachers = st.users.filter((u) => u.role === 'teacher').sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username), 'el'));
    const rows = [];
    subjectTeachers(st.users, yearId, sj.id).forEach(({ u, as }) => as.forEach((a) => rows.push({ uid: String(u.id), cls: (a.spec || '') + '|' + (a.section || ''), period: a.period || '' })));
    const teacherOptions = (sel) =>
      '<option value="">— Καθηγητής —</option>' +
      teachers.map((u) => '<option value="' + esc(u.id) + '"' + (String(u.id) === sel ? ' selected' : '') + '>' + esc((u.name || u.username) + ' (' + u.username + ')' + (u.active ? '' : ' — ανενεργός')) + '</option>').join('');
    const body = () => {
      if (!teachers.length)
        return '<div class="callout">' + icon('info') + '<p style="flex:1">Δεν υπάρχουν ακόμη λογαριασμοί καθηγητών. Δημιουργήστε τους από <b>Λογαριασμοί → Καθηγητές</b> και μετά αναθέστε τους το μάθημα.</p><button class="btn btn-sm" id="st-go-accounts">' + icon('key') + 'Λογαριασμοί</button></div>';
      return '<div class="small muted" style="margin-bottom:12px">Ακαδημαϊκό έτος <b>' + esc(C.yearLabel(db, yearId)) + '</b> — σε παρένθεση ο αριθμός σπουδαστών. Το ίδιο μάθημα μπορούν να το έχουν πολλοί καθηγητές, ακόμη και στο ίδιο τμήμα.</div>' +
        (rows.length
          ? '<div class="ta-grid"><div class="ta-h">Καθηγητής</div><div class="ta-h">Τμήμα</div><div class="ta-h">Περίοδος</div><div></div>' +
            rows
              .map((r, i) =>
                '<select class="select" data-st="uid" data-i="' + i + '">' + teacherOptions(r.uid) + '</select>' +
                '<select class="select" data-st="cls" data-i="' + i + '">' + TA.clsOptionsHtml(db, yearId, sj, r.cls, r.period) + '</select>' +
                TA.periodCellHtml(db, yearId, sj, r.cls, r.period, 'data-st="period" data-i="' + i + '"') +
                '<button class="btn btn-ghost btn-icon" data-st-del="' + i + '" title="Αφαίρεση">' + icon('x') + '</button>'
              )
              .join('') +
            '</div>'
          : '<div class="muted small" style="margin:8px 0 12px">Δεν έχει ανατεθεί σε κανέναν καθηγητή.</div>') +
        '<button class="btn btn-sm" id="st-add" style="margin-top:12px">' + icon('plus') + 'Καθηγητής</button>';
    };
    openModal({
      title: 'Καθηγητές μαθήματος: ' + C.subjectLabel(sj),
      sub: esc(C.levelName(db, sj.levelId) + (sj.specialty !== 'COMMON' && !C.isUnifiedLevel(sj.levelId) ? ' · ' + C.specialtyName(sj.specialty) : '')) + ' — κάθε καθηγητής βλέπει και βαθμολογεί μόνο τους σπουδαστές των τμημάτων του',
      size: 'xl',
      body: '<div id="st-body"></div>',
      onMount(ctx) {
        const paint = () => (ctx.q('#st-body').innerHTML = body());
        paint();
        ctx.el.addEventListener('change', (e) => {
          const t = e.target;
          if (!t.dataset.st) return;
          const r = rows[Number(t.dataset.i)];
          r[t.dataset.st] = t.value;
          if (t.dataset.st !== 'uid') paint(); // the numbers of students follow the class / period
        });
        ctx.el.addEventListener('click', (e) => {
          if (e.target.closest('#st-add')) {
            rows.push({ uid: '', cls: TA.firstCls(db, sj), period: '' });
            paint();
            const sels = ctx.qa('select[data-st="uid"]');
            if (sels.length) sels[sels.length - 1].focus();
          }
          const d = e.target.closest('[data-st-del]');
          if (d) {
            rows.splice(Number(d.dataset.stDel), 1);
            paint();
          }
          if (e.target.closest('#st-go-accounts')) {
            ctx.close();
            App.go('accounts', () => App.pages.accounts.setTab && App.pages.accounts.setTab('teachers'));
          }
        });
      },
      buttons: [
        { label: 'Άκυρο' },
        {
          label: 'Αποθήκευση',
          cls: 'btn-primary',
          id: 'st-save',
          onClick: async () => {
            const want = new Map(); // teacher id → his assignments of this subject (working year)
            rows.forEach((r) => {
              if (!r.uid) return;
              if (!want.has(r.uid)) want.set(r.uid, []);
              const a = TA.make(db, yearId, sj.id, r.cls, r.period);
              if (!want.get(r.uid).some((x) => TA.key(x) === TA.key(a))) want.get(r.uid).push(a);
            });
            const fresh = (await Remote.users()).filter((u) => u.role === 'teacher');
            const mineOf = (u) => (u.assignments || []).filter((a) => a.yearId === yearId && a.subjectId === sj.id);
            const involved = fresh.filter((u) => want.has(String(u.id)) || mineOf(u).length);
            const gone = Array.from(want.keys()).filter((id) => !fresh.some((u) => String(u.id) === id));
            if (gone.length) throw new Error('Ένας καθηγητής διαγράφηκε στο μεταξύ — κλείστε και ανοίξτε ξανά το παράθυρο.');
            let changed = 0;
            for (const u of involved) {
              const next = want.get(String(u.id)) || [];
              if (TA.sameSet(mineOf(u), next)) continue;
              const others = (u.assignments || []).filter((a) => !(a.yearId === yearId && a.subjectId === sj.id));
              await Remote.setTeacherAssignments(u.id, others.concat(next));
              changed++;
            }
            await App.accounts.reload();
            App.render();
            toast(changed ? 'Οι καθηγητές του μαθήματος αποθηκεύτηκαν (' + plural(changed, 'καθηγητής', 'καθηγητές') + ')' : 'Δεν έγιναν αλλαγές', changed ? 'success' : 'info');
          },
        },
      ],
    });
  };

  // ------------------------------------------------------------ syllabus of a subject (admin)
  App.actions.sbSyllabus = (el) => {
    const { db } = S();
    const sj = db.subjects.find((x) => x.id === el.dataset.id);
    if (!sj) return;
    const label = C.subjectLabel(sj);
    const M = { files: null, error: '', busy: null };
    let ctxRef = null;
    const paint = () => {
      if (!ctxRef || ctxRef.closed) return;
      let h;
      if (!M.files) h = M.error ? '<div class="callout warn">' + icon('alert') + '<p>Δεν ήταν δυνατή η φόρτωση της ύλης: ' + esc(M.error) + '</p></div>' : '<div class="syl-empty muted">Φόρτωση…</div>';
      else if (!M.files.length) h = '<div class="syl-empty">' + icon('file', 'width="26" height="26"') + '<div><b>Δεν έχει ανέβει ακόμη ύλη</b><br><span class="small muted">Ανεβάστε αρχεία PDF — οι σπουδαστές του μαθήματος τα βλέπουν στην καρτέλα «Syllabus».</span></div></div>';
      else h = SYL.rowsHtml(M.files, { busy: M.busy });
      ctxRef.q('#syl-body').innerHTML = h;
    };
    const load = async () => {
      try {
        M.files = (await Remote.syllabus(sj.id)).files || [];
        M.error = '';
        setSubjectFiles(sj.id, M.files);
      } catch (e) {
        M.error = e.message;
      }
      paint();
      if (S().page === 'subjects' && S().db) App.render();
    };
    openModal({
      title: 'Ύλη: ' + label,
      sub: 'Αρχεία PDF του μαθήματος (έως 50 MB το καθένα) — τα βλέπουν οι σπουδαστές του και οι καθηγητές του',
      size: 'lg',
      body: '<div id="syl-body"></div>',
      onMount(ctx) {
        ctxRef = ctx;
        paint();
        load();
        ctx.el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-syl]');
          if (!b || b.disabled || !M.files) return;
          const f = M.files.find((x) => String(x.id) === b.dataset.id);
          if (!f) return;
          ctx.setError(null);
          try {
            if (b.dataset.syl === 'view') {
              M.busy = f.id;
              paint();
              try {
                await SYL.view(f, label);
              } finally {
                M.busy = null;
                paint();
              }
            } else if (b.dataset.syl === 'del' && (await SYL.remove(f, label))) {
              toast('Το αρχείο <b>' + esc(f.name) + '</b> διαγράφηκε');
              await load();
            }
          } catch (err) {
            ctx.setError(err.message || String(err));
            if (err.status === 404) load();
          }
        });
      },
      buttons: [
        { label: 'Κλείσιμο' },
        {
          label: 'Ανέβασμα PDF',
          cls: 'btn-primary',
          icon: 'upload',
          id: 'syl-upload',
          keepOpen: true,
          onClick: async () => {
            const file = await SYL.upload(sj.id);
            if (!file) return;
            toast('Ανέβηκε το αρχείο <b>' + esc(file.name) + '</b>', 'success');
            await load();
          },
        },
      ],
    });
  };

  /** Export one subject's grades: registry number (Α.Μ.) and grade only — no names. */
  App.actions.sbLock = async (el) => {
    const { db, yearId } = S();
    const sj = db.subjects.find((x) => x.id === el.dataset.id);
    if (!sj) return;
    const on = el.dataset.on === '1';
    if (on && !(await confirmDialog('Κλείδωμα βαθμολογίας', 'Κλείδωμα της βαθμολογίας <b>' + esc(C.subjectLabel(sj)) + '</b> για το ' + esc(C.yearLabel(db, yearId)) + ';<br><br>Οι καθηγητές δεν θα μπορούν πλέον να αλλάξουν βαθμούς του μαθήματος. Εσείς μπορείτε πάντα να τους διορθώσετε ή να το ξεκλειδώσετε.', { okText: 'Κλείδωμα' }))) return;
    App.mutate((d) => C.setGradeLock(d, yearId, sj.id, on, window.Remote && window.Remote.user ? window.Remote.user.username : ''));
    toast(on ? 'Η βαθμολογία κλείδωσε' : 'Η βαθμολογία ξεκλείδωσε');
  };

  App.exportSubject = async function (subjectId, yearId, section) {
    const { db } = S();
    const y = yearId || S().yearId;
    const subject = db.subjects.find((s) => s.id === subjectId);
    if (!subject) throw new Error('Το μάθημα δεν βρέθηκε.');
    const r = window.XL.buildSubjectExport(db, { subject, yearId: y, section: section || 'ALL' });
    if (!r.graded) {
      toast('Το μάθημα <b>' + esc(C.subjectLabel(subject)) + '</b> δεν έχει ακόμη βαθμούς για το ' + esc(C.yearLabel(db, y)) + '.', 'warn');
      return null;
    }
    const one = section && section !== 'ALL' && r.classes.length === 1 ? r.classes[0].name : null;
    const saved = await App.saveWorkbook(r.wb, one ? window.XL.fileSafe('Βαθμολογία_' + (subject.code || subject.name) + '_' + one + '_' + C.yearLabel(db, y)) + '.xlsx' : window.XL.subjectExportFileName(db, subject, y));
    if (saved && r.missing) toast(plural(r.missing, 'σπουδαστής δεν έχει', 'σπουδαστές δεν έχουν') + ' ακόμη βαθμό — το κελί τους έμεινε κενό.', 'warn', { duration: 6000 });
    return saved;
  };
  App.actions.exportSubject = (el) => App.exportSubject(el.dataset.id, el.dataset.year || null);
})();
