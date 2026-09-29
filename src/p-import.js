/* Εισαγωγή: grades (Α.Μ. + βαθμός) and students (όνομα + Α.Μ.) from Excel, plus history/undo. */
(function () {
  'use strict';
  const App = window.App;
  const C = window.Core;
  const { esc, icon, fmtDate, plural, options, toast, openModal, confirmDialog, emptyState, specBadge } = App.ui;
  const S = () => App.S;

  let TAB = 'grades';
  const G = freshGrades();
  const T = freshStudents();

  function freshGrades() {
    return { step: 1, file: null, sheetIdx: 0, headerRow: 0, table: null, amCol: -1, colMap: {}, mode: 'auto', plan: null, replaceExisting: true, includeWarnings: true, filter: 'all', result: null };
  }
  function freshStudents() {
    return {
      step: 1, file: null, sheetIdx: 0, headerRow: 0, table: null,
      map: { am: -1, lastName: -1, firstName: -1, fullName: -1, fatherName: -1, specialty: -1, level: -1, section: -1, period: -1, email: -1, phone: -1 },
      nameMode: 'split', nameOrder: 'LF', defLevel: '', defSpec: '', defSec: '', defPer: '', updateExisting: true, plan: null, filter: 'all', result: null,
    };
  }
  function reset(obj, fresh) {
    Object.keys(obj).forEach((k) => delete obj[k]);
    Object.assign(obj, fresh);
  }

  App.pages.import = {
    subtitle: () => 'Τα δεδομένα καταχωρίζονται στο ακαδημαϊκό έτος ' + C.yearLabel(S().db, S().yearId),
    setTab(t) {
      TAB = t;
    },
    render() {
      const { db } = S();
      let h = '<div class="page">';
      h += '<div class="tabs">' +
        tab('grades', 'sheet', 'Βαθμολογίες καθηγητών', 'Α.Μ. + βαθμός') +
        tab('students', 'users', 'Σπουδαστές', 'Ονοματεπώνυμο + Α.Μ.') +
        tab('history', 'refresh', 'Ιστορικό εισαγωγών', null, db.imports.length) +
        '</div>';
      if (TAB === 'grades') h += gradesHtml();
      else if (TAB === 'students') h += studentsHtml();
      else h += historyHtml();
      h += '</div>';
      return h;
    },
    mount(root) {
      const dz = root.querySelector('.dropzone');
      if (dz) wireDropzone(dz);
    },
  };

  function tab(id, ic, label, hint, count) {
    return '<button class="tab' + (TAB === id ? ' on' : '') + '" data-action="imTab" data-v="' + id + '">' + icon(ic, 'width="16" height="16"') + esc(label) + (hint ? ' <span class="faint small">(' + esc(hint) + ')</span>' : '') + (count !== undefined ? '<span class="count">' + count + '</span>' : '') + '</button>';
  }

  App.actions.imTab = (el) => {
    TAB = el.dataset.v;
    App.render();
  };

  function wizardSteps(step, labels) {
    return '<div class="wizard-steps">' + labels.map((l, i) => {
      const n = i + 1;
      const cls = n < step ? 'done' : n === step ? 'on' : '';
      return (i ? '<div class="sep"></div>' : '') + '<div class="ws ' + cls + '"><span class="n">' + (n < step ? '✓' : n) + '</span>' + esc(l) + '</div>';
    }).join('') + '</div>';
  }

  function dropzoneHtml(kind, title, text) {
    return '<div class="dropzone" data-kind="' + kind + '" data-action="imPick" data-kindv="' + kind + '"><div class="dz-icon">' + icon('upload') + '</div><div class="dz-title">' + esc(title) + '</div><div>' + text + '</div><div style="margin-top:14px"><span class="btn btn-primary">' + icon('file') + 'Επιλογή αρχείου Excel</span></div><div class="small faint" style="margin-top:10px">.xlsx · .xls · .csv · .ods — ή σύρετε το αρχείο εδώ</div></div>';
  }

  function wireDropzone(dz) {
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz.classList.remove('over');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        loadFile(dz.dataset.kind, { name: file.name, data: buf });
      } catch (err) {
        toast(esc(err.message), 'error');
      }
    });
  }

  App.actions.imPick = async (el) => {
    const f = await App.pickExcel();
    if (f) loadFile(el.dataset.kindv, f);
  };

  /**
   * The «Re-exam» sheet of the per-subject Excel files (failed students + re-exam grades): never imported
   * as grades — re-exam grades are entered by hand in the gradebook. "Re-exam", "Reexam", "Re exam"…
   */
  function isReexamSheet(name) {
    const k = C.compact(name);
    return k.startsWith('reexam') || k.startsWith('επανεξετασ');
  }
  const usableSheet = (s) => s.grid.length > 0 && !isReexamSheet(s.name);
  const hasAmHeader = (s) => s.grid.slice(0, 25).some((r) => (r || []).some((c) => C.guessColumnRole(C.cellText(c)) === 'am'));
  /** Sheets read together by «Όλα τα φύλλα» (grade import): every usable sheet with a Α.Μ. column. */
  const multiSheets = (sheets) => sheets.filter((s) => usableSheet(s) && hasAmHeader(s));
  const ALL_SHEETS = -1;

  function loadFile(kind, f) {
    let wb;
    try {
      wb = window.XL.readWorkbook(f.data, f.name);
    } catch (e) {
      toast('Δεν ήταν δυνατή η ανάγνωση του αρχείου: ' + esc(e.message), 'error');
      return;
    }
    const withData = wb.sheets.filter(usableSheet);
    if (!withData.length) {
      toast(wb.sheets.some((s) => s.grid.length) ? 'Το αρχείο έχει μόνο φύλλο «Re-exam», που δεν εισάγεται — οι βαθμοί re-exam καταχωρίζονται χειροκίνητα στο Βαθμολόγιο.' : 'Το αρχείο δεν περιέχει δεδομένα.', 'warn', { duration: 7000 });
      return;
    }
    const st = kind === 'grades' ? G : T;
    if (wb.sheets.some((s) => s.truncated)) toast('Το αρχείο είναι πολύ μεγάλο — διαβάστηκαν μόνο οι πρώτες 20.000 γραμμές / 200 στήλες.', 'warn', { duration: 9000 });
    st.file = { name: f.name, sheets: wb.sheets };
    // prefer the first sheet that has an AM-looking header (never the «Re-exam» sheet)
    let idx = wb.sheets.findIndex((s) => usableSheet(s) && hasAmHeader(s));
    if (idx < 0) idx = wb.sheets.indexOf(withData[0]);
    st.sheetIdx = idx;
    // a grade file with one sheet per class (e.g. the per-subject export): read them all together
    if (kind === 'grades' && multiSheets(wb.sheets).length >= 2) st.sheetIdx = ALL_SHEETS;
    applySheet(kind);
    st.step = 2;
    App.render();
  }

  function applySheet(kind) {
    const st = kind === 'grades' ? G : T;
    st.headerRow = st.sheetIdx === ALL_SHEETS ? 0 : C.detectHeaderRow(st.file.sheets[st.sheetIdx].grid);
    rebuild(kind, true);
  }

  function rebuild(kind, auto) {
    const st = kind === 'grades' ? G : T;
    st.table = st.sheetIdx === ALL_SHEETS ? combinedTable(st.file.sheets) : C.tableFromGrid(st.file.sheets[st.sheetIdx].grid, st.headerRow);
    if (auto) (kind === 'grades' ? autoMapGrades : autoMapStudents)();
  }

  /**
   * One table from several sheets (header row detected on each; columns matched by title).
   * Row numbers become "Sheet!12" so that the preview says where each line comes from.
   */
  function combinedTable(sheets) {
    const headers = [];
    const byTitle = new Map();
    const rows = [];
    multiSheets(sheets).forEach((s) => {
      const t = C.tableFromGrid(s.grid, C.detectHeaderRow(s.grid));
      const colOf = t.headers.map((hd) => {
        const k = C.compact(hd.title) || hd.letter;
        if (!byTitle.has(k)) {
          byTitle.set(k, headers.length);
          headers.push({ index: headers.length, letter: C.columnLetter(headers.length), title: hd.title });
        }
        return byTitle.get(k);
      });
      t.rows.forEach((r) => {
        const cells = [];
        r.cells.forEach((c, j) => (cells[colOf[j]] = c));
        rows.push({ rowNum: s.name + '!' + r.rowNum, sheet: s.name, cells });
      });
    });
    rows.forEach((r) => {
      for (let i = 0; i < headers.length; i++) if (r.cells[i] === undefined) r.cells[i] = null;
    });
    return { headers, rows, headerRow: 0 };
  }

  function samples(table, col, n) {
    const out = [];
    for (const r of table.rows) {
      const t = C.cellText(r.cells[col]);
      if (t) out.push(t);
      if (out.length >= (n || 4)) break;
    }
    return out;
  }

  // ======================================================================
  // GRADES
  // ======================================================================
  function matchSubject(text) {
    const { db } = S();
    const nt = C.normText(text);
    const ct = C.compact(text);
    let best = null;
    db.subjects.forEach((s) => {
      let score = 0;
      if (s.code && C.compact(s.code).length >= 2 && ct.includes(C.compact(s.code))) score = 10 + C.compact(s.code).length;
      if (s.name && C.normText(s.name).length >= 4 && nt.includes(C.normText(s.name))) score = Math.max(score, 5 + C.normText(s.name).length);
      if (!score) return;
      if (!best || score > best.score) best = { s, score, tie: false };
      else if (score === best.score) best.tie = true;
    });
    return best && !best.tie ? best.s : null; // same code/name in several levels → let the user choose
  }

  function autoMapGrades() {
    const { db } = S();
    const tbl = G.table;
    const roles = tbl.headers.map((h) => C.guessColumnRole(h.title));
    let am = roles.indexOf('am');
    if (am < 0) {
      const idx = C.buildAmIndex(db);
      let best = { col: -1, n: 0 };
      tbl.headers.forEach((h, i) => {
        let n = 0;
        tbl.rows.forEach((r) => {
          const t = C.cellText(r.cells[i]);
          if (t && idx.find(t)) n++;
        });
        if (n > best.n) best = { col: i, n };
      });
      am = best.col;
    }
    G.amCol = am;
    G.colMap = {};
    const skip = ['index', 'lastName', 'firstName', 'fullName', 'fatherName', 'email', 'phone', 'specialty', 'level', 'am'];
    const gradeCols = [];
    tbl.headers.forEach((h, i) => {
      if (i === am || skip.includes(roles[i])) return;
      if (!C.columnLooksNumeric(tbl, i)) return;
      gradeCols.push(i);
      const subj = matchSubject(h.title);
      if (subj) G.colMap[i] = subj.id;
    });
    if (!Object.keys(G.colMap).length && gradeCols.length) {
      const sheetName = G.sheetIdx === ALL_SHEETS ? '' : G.file.sheets[G.sheetIdx].name;
      const subj = gradeCols.length === 1 ? matchSubject(G.file.name.replace(/\.[a-z]+$/i, '') + ' ' + sheetName) : null;
      // prefer the column titled "grade"/"βαθμός"; otherwise all numeric columns
      const preferred = gradeCols.filter((i) => roles[i] === 'grade');
      const cols = preferred.length ? preferred : gradeCols;
      cols.forEach((i) => (G.colMap[i] = ''));
      if (subj && cols.length === 1) G.colMap[cols[0]] = subj.id;
    }
  }

  function subjectSelectOptions(selected) {
    const { db } = S();
    let h = '';
    C.LEVELS.forEach((l) => {
      const list = C.subjectsOfLevel(db, l.id);
      if (!list.length) return;
      h += '<optgroup label="' + esc(C.levelName(db, l.id)) + '">' + list.map((s) => '<option value="' + s.id + '"' + (s.id === selected ? ' selected' : '') + '>' + esc(C.subjectLabel(s)) + (s.specialty !== 'COMMON' ? ' · ' + C.specialtyName(s.specialty) : '') + (s.active === false ? ' (ανενεργό)' : '') + '</option>').join('') + '</optgroup>';
    });
    return h;
  }

  function gradesHtml() {
    const { db, yearId } = S();
    const yl = C.yearLabel(db, yearId);
    let h = wizardSteps(G.step, ['Αρχείο', 'Αντιστοίχιση στηλών', 'Έλεγχος', 'Ολοκλήρωση']);
    if (G.step === 1) {
      h += '<div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">';
      h += '<div class="card card-pad">' + dropzoneHtml('grades', 'Excel βαθμολογίας από τον καθηγητή', 'Το αρχείο πρέπει να έχει μια στήλη με τον <b>αριθμό μητρώου (Α.Μ.)</b> και μία ή περισσότερες στήλες με <b>βαθμούς</b>.') + '</div>';
      h += '<div class="card card-pad"><h3 style="margin:0 0 10px;font-size:14.5px">Πώς λειτουργεί</h3><ol style="margin:0;padding-left:18px;line-height:1.7" class="small">' +
        '<li>Επιλέγετε το αρχείο που ανέβασε ο καθηγητής.</li>' +
        '<li>Ορίζετε ποια στήλη είναι ο Α.Μ. και σε ποιο <b>μάθημα</b> αντιστοιχεί κάθε στήλη βαθμών.</li>' +
        '<li>Η εφαρμογή βρίσκει κάθε σπουδαστή από τον Α.Μ. και σας δείχνει τι θα καταχωριστεί.</li>' +
        '<li>Οι βαθμοί καταχωρίζονται στο έτος <b>' + esc(yl) + '</b>. Κάθε εισαγωγή μπορεί να αναιρεθεί.</li></ol>' +
        '<div class="callout" style="margin-top:14px">' + icon('info') + '<p>Δεκτές τιμές: ακέραιοι <b>0–5</b>, <b>ΑΠ</b> (απών), <b>0Δ</b> (0 λόγω δικαιολογημένων απουσιών) και <b>0Α</b> (0 λόγω αδικαιολόγητων απουσιών). Δεκαδικοί και ποσοστά απορρίπτονται. Το φύλλο «Re-exam» δεν εισάγεται — οι βαθμοί re-exam καταχωρίζονται στο Βαθμολόγιο.</p></div>' +
        (db.subjects.length ? '' : '<div class="callout warn" style="margin-top:10px">' + icon('alert') + '<p>Δεν έχετε δημιουργήσει ακόμη μαθήματα. <button class="link" data-action="go" data-page="subjects">Δημιουργία μαθημάτων</button></p></div>') +
        (db.students.length ? '' : '<div class="callout warn" style="margin-top:10px">' + icon('alert') + '<p>Το μητρώο σπουδαστών είναι άδειο — οι Α.Μ. δεν θα αντιστοιχιστούν. <button class="link" data-action="imTab" data-v="students">Εισαγωγή σπουδαστών</button></p></div>') +
        '<button class="btn btn-sm" style="margin-top:14px" data-action="gbTemplates">' + icon('sheet') + 'Δημιουργία προτύπου για καθηγητή</button>' +
        '</div></div>';
      return h;
    }
    h += fileBar('grades', G);
    if (G.step === 2) return h + gradesMappingHtml();
    if (G.step === 3) return h + gradesPreviewHtml();
    return h + gradesResultHtml();
  }

  function fileBar(kind, st) {
    const sheets = st.file.sheets;
    const all = st.sheetIdx === ALL_SHEETS;
    const multi = kind === 'grades' ? multiSheets(sheets) : [];
    const sheetOpts = (multi.length >= 2 ? [{ value: ALL_SHEETS, label: 'Όλα τα φύλλα με Α.Μ. (' + multi.length + ')' }] : []).concat(
      sheets.map((s, i) => {
        const re = isReexamSheet(s.name);
        return { value: i, label: s.name + (re ? ' (re-exam — δεν εισάγεται)' : s.grid.length ? '' : ' (κενό)'), disabled: re && kind === 'grades' };
      })
    );
    return '<div class="card card-pad" style="margin-bottom:16px"><div class="row row-wrap">' +
      '<span class="file-chip">' + icon('sheet') + esc(st.file.name) + '</span>' +
      (sheets.length > 1 ? '<div class="row"><span class="label">Φύλλο</span><select class="select" style="width:auto" data-on-change="imSheet" data-kind="' + kind + '"' + (st.step > 2 ? ' disabled' : '') + '>' + options(sheetOpts, st.sheetIdx) + '</select></div>' : '') +
      (all
        ? '<span class="small muted" title="Η γραμμή επικεφαλίδων βρίσκεται αυτόματα σε κάθε φύλλο">' + esc(multi.map((s) => s.name).join(' · ')) + '</span>'
        : '<div class="row"><span class="label">Γραμμή επικεφαλίδων</span><input class="input" type="number" min="1" style="width:74px" value="' + (st.headerRow + 1) + '" data-on-change="imHeader" data-kind="' + kind + '"' + (st.step > 2 ? ' disabled' : '') + ' /></div>') +
      '<span class="small muted">' + plural(st.table.rows.length, 'γραμμή δεδομένων', 'γραμμές δεδομένων') + '</span>' +
      (kind === 'grades' && sheets.some((s) => isReexamSheet(s.name)) ? '<span class="badge" title="Οι βαθμοί re-exam καταχωρίζονται χειροκίνητα στο Βαθμολόγιο">Το φύλλο «Re-exam» αγνοείται</span>' : '') +
      '<div class="spacer"></div><button class="btn btn-sm btn-ghost" data-action="imReset" data-kind="' + kind + '">' + icon('x') + 'Άλλο αρχείο</button></div></div>';
  }

  App.changes.imSheet = (el) => {
    const st = el.dataset.kind === 'grades' ? G : T;
    const v = Number(el.value);
    if (v !== ALL_SHEETS && el.dataset.kind === 'grades' && isReexamSheet(st.file.sheets[v].name)) return App.render();
    st.sheetIdx = v;
    applySheet(el.dataset.kind);
    App.render();
  };
  App.changes.imHeader = (el) => {
    const st = el.dataset.kind === 'grades' ? G : T;
    if (st.sheetIdx === ALL_SHEETS) return;
    const n = Math.max(1, parseInt(el.value, 10) || 1) - 1;
    st.headerRow = Math.min(n, Math.max(0, st.file.sheets[st.sheetIdx].grid.length - 1));
    rebuild(el.dataset.kind, true);
    App.render();
  };
  App.actions.imReset = (el) => {
    if (el.dataset.kind === 'grades') reset(G, freshGrades());
    else reset(T, freshStudents());
    App.render();
  };

  function gradesMappingHtml() {
    const { db, yearId } = S();
    const tbl = G.table;
    let h = '<div class="card"><div class="card-head"><div><h3>Αντιστοίχιση στηλών</h3><div class="sub">Ορίστε τη στήλη του Α.Μ. και το μάθημα κάθε στήλης βαθμών</div></div>' +
      '<div class="row"><span class="badge badge-info" title="ΑΠ = απών · 0Δ = 0 λόγω δικαιολογημένων απουσιών · 0Α = 0 λόγω αδικαιολόγητων απουσιών · δεκαδικοί βαθμοί και ποσοστά απορρίπτονται">Δεκτοί βαθμοί: 0, 1, 2, 3, 4, 5 ή ΑΠ · 0Δ / 0Α</span></div></div>';
    if (!db.subjects.length) h += '<div class="card-body"><div class="callout warn">' + icon('alert') + '<p>Δεν υπάρχουν μαθήματα. Δημιουργήστε πρώτα τα μαθήματα και επιστρέψτε. <button class="link" data-action="go" data-page="subjects">Μαθήματα</button></p></div></div>';
    h += '<table class="table map-table"><thead><tr><th style="width:60px">Στήλη</th><th>Τίτλος στο αρχείο</th><th>Δείγμα τιμών</th><th style="width:42%">Αντιστοίχιση</th></tr></thead><tbody>';
    tbl.headers.forEach((col, i) => {
      const smp = samples(tbl, i, 5);
      if (!smp.length && i !== G.amCol && G.colMap[i] === undefined) return; // hide empty columns
      let val = '__ignore';
      if (i === G.amCol) val = '__am';
      else if (G.colMap[i] !== undefined) val = G.colMap[i];
      const pending = val === '';
      let detected = '';
      if (G.colMap[i]) {
        const bad = tbl.rows.filter((r) => C.parseGradeCell(r.cells[i]).kind === 'invalid').length;
        if (bad) detected = '<div class="small warning-text" style="margin-top:3px">' + bad + (bad === 1 ? ' τιμή δεν είναι έγκυρη' : ' τιμές δεν είναι έγκυρες') + ' (π.χ. δεκαδικός) — θα παραλειφθ' + (bad === 1 ? 'εί' : 'ούν') + '</div>';
      }
      h += '<tr><td class="mono strong">' + col.letter + '</td><td class="strong">' + esc(col.title) + '</td><td><div class="sample">' + esc(smp.join(' · ')) + '</div></td>' +
        '<td><select class="select' + (pending ? ' invalid' : '') + '" data-on-change="gMap" data-col="' + i + '" style="' + (pending ? 'border-color:var(--warning)' : val !== '__ignore' ? 'border-color:var(--primary-line);background-color:var(--primary-soft)' : '') + '">' +
        '<option value="__ignore"' + (val === '__ignore' ? ' selected' : '') + '>— Αγνόηση στήλης —</option>' +
        '<option value="__am"' + (val === '__am' ? ' selected' : '') + '>Α.Μ. (αριθμός μητρώου)</option>' +
        '<option value=""' + (pending ? ' selected' : '') + '>Βαθμός → επιλέξτε μάθημα…</option>' +
        subjectSelectOptions(val) + '</select>' + detected + '</td></tr>';
    });
    h += '</tbody></table>';
    const mapped = Object.values(G.colMap).filter(Boolean).length;
    const pendingN = Object.values(G.colMap).filter((v) => v === '').length;
    let problem = '';
    if (G.amCol < 0) problem = 'Ορίστε ποια στήλη περιέχει τον αριθμό μητρώου (Α.Μ.).';
    else if (pendingN) problem = 'Επιλέξτε μάθημα για ' + (pendingN === 1 ? 'τη στήλη βαθμών' : 'τις ' + pendingN + ' στήλες βαθμών') + ' (ή «Αγνόηση στήλης»).';
    else if (!mapped) problem = 'Αντιστοιχίστε τουλάχιστον μία στήλη βαθμών σε μάθημα.';
    h += '<div class="card-body" style="border-top:1px solid var(--border)"><div class="row">' +
      (problem ? '<span class="warning-text small">' + icon('alert', 'width="14" height="14" style="vertical-align:-2px"') + ' ' + esc(problem) + '</span>' : '<span class="small muted">Έτος καταχώρισης: <b>' + esc(C.yearLabel(db, yearId)) + '</b> · ' + plural(mapped, 'μάθημα', 'μαθήματα') + '</span>') +
      '<div class="spacer"></div><button class="btn" data-action="imReset" data-kind="grades">Πίσω</button><button class="btn btn-primary" data-action="gPreview"' + (problem ? ' disabled' : '') + '>Έλεγχος ' + icon('arrowRight') + '</button></div></div></div>';
    return h;
  }

  App.actions.gMode = (el) => {
    G.mode = el.dataset.v;
    App.render();
  };
  App.changes.gMap = (el) => {
    const i = Number(el.dataset.col);
    const v = el.value;
    if (v === '__am') {
      if (G.amCol >= 0 && G.amCol !== i) delete G.colMap[G.amCol];
      G.amCol = i;
      delete G.colMap[i];
    } else {
      if (G.amCol === i) G.amCol = -1;
      if (v === '__ignore') delete G.colMap[i];
      else G.colMap[i] = v;
    }
    App.render();
  };

  function buildGradePlan() {
    const { db, yearId } = S();
    const columns = Object.keys(G.colMap)
      .filter((k) => G.colMap[k])
      .map((k) => ({ col: Number(k), subjectId: G.colMap[k] }));
    G.plan = C.planGradeImport(db, { table: G.table, amCol: G.amCol, columns, mode: G.mode, yearId });
  }

  App.actions.gPreview = () => {
    buildGradePlan();
    G.step = 3;
    G.filter = 'all';
    App.render();
  };
  App.actions.gBack = () => {
    G.step = 2;
    App.render();
  };

  const G_STATUS = {
    new: ['Νέος βαθμός', 'badge-success'],
    update: ['Αλλαγή βαθμού', 'badge-info'],
    same: ['Ίδιος βαθμός', ''],
    unknown_am: ['Άγνωστος Α.Μ.', 'badge-danger'],
    invalid: ['Μη έγκυρη τιμή', 'badge-danger'],
    duplicate: ['Διπλή γραμμή', 'badge-danger'],
    no_am: ['Χωρίς Α.Μ.', 'badge-danger'],
    empty: ['Κενό κελί', ''],
  };

  function warningText(w, item) {
    const { db, yearId } = S();
    if (w === 'not_enrolled') return 'Δεν είναι εγγεγραμμένος στο ' + C.yearLabel(db, yearId);
    if (w === 'other_level') {
      const en = C.getEnrollment(db, item.student.id, yearId);
      return 'Εγγεγραμμένος στο ' + (en ? C.levelShort(en.levelId, item.student.specialty) : '—') + ', όχι στο ' + C.levelShort(item.subject.levelId, item.student.specialty);
    }
    if (w === 'specialty') return 'Ο σπουδαστής είναι ' + C.specialtyName(item.student.specialty) + ', το μάθημα ' + C.specialtyName(item.subject.specialty);
    return w;
  }

  function isProblem(i) {
    return ['unknown_am', 'invalid', 'duplicate', 'no_am'].includes(i.status);
  }

  function willImport(i) {
    if (i.status === 'new') return !i.warnings.length || G.includeWarnings;
    if (i.status === 'update') return G.replaceExisting && (!i.warnings.length || G.includeWarnings);
    return false;
  }

  function gradesPreviewHtml() {
    const p = G.plan;
    const sm = p.summary;
    const problems = sm.unknown_am + sm.invalid + sm.duplicate + sm.no_am;
    const count = p.items.filter(willImport).length;
    const chips = [
      ['all', 'Όλες', p.items.filter((i) => i.status !== 'empty').length, '#6b778a'],
      ['new', 'Νέοι', sm.new, 'var(--success)'],
      ['update', 'Αλλαγές', sm.update, 'var(--primary)'],
      ['same', 'Ίδιοι', sm.same, '#98a3b3'],
      ['problems', 'Προβλήματα', problems, 'var(--danger)'],
      ['warnings', 'Προειδοποιήσεις', sm.warnings, 'var(--warning)'],
      ['empty', 'Κενά', sm.empty, '#c8d0db'],
    ];
    let h = '<div class="card"><div class="card-head" style="flex-wrap:wrap"><div class="chips">' +
      chips.map((c) => '<button class="chip' + (G.filter === c[0] ? ' on' : '') + '" data-action="gFilter" data-v="' + c[0] + '"><span class="dot" style="background:' + c[3] + '"></span>' + esc(c[1]) + ' <b>' + c[2] + '</b></button>').join('') + '</div></div>';

    const opts = [];
    if (sm.update) opts.push('<label class="checkbox"><input type="checkbox" data-on-change="gOpt" data-k="replaceExisting"' + (G.replaceExisting ? ' checked' : '') + ' /> Αντικατάσταση υπαρχόντων βαθμών (' + sm.update + ')</label>');
    if (sm.warnings) opts.push('<label class="checkbox"><input type="checkbox" data-on-change="gOpt" data-k="includeWarnings"' + (G.includeWarnings ? ' checked' : '') + ' /> Καταχώριση και των γραμμών με προειδοποίηση (' + sm.warnings + ')</label>');
    if (problems) opts.push('<span class="small danger-text">' + icon('alert', 'width="14" height="14" style="vertical-align:-2px"') + ' ' + plural(problems, 'γραμμή δεν θα καταχωριστεί', 'γραμμές δεν θα καταχωριστούν') + ' (δείτε «Προβλήματα»)' + (sm.unknown_am ? ' — για άγνωστους Α.Μ. προσθέστε πρώτα τον σπουδαστή στο μητρώο και επαναλάβετε την εισαγωγή' : '') + '</span>');
    if (opts.length) h += '<div class="card-body row row-wrap" style="gap:18px;border-bottom:1px solid var(--border)">' + opts.join('') + '</div>';

    let items = p.items;
    if (G.filter === 'all') items = items.filter((i) => i.status !== 'empty');
    else if (G.filter === 'problems') items = items.filter(isProblem);
    else if (G.filter === 'warnings') items = items.filter((i) => i.warnings.length && !isProblem(i));
    else items = items.filter((i) => i.status === G.filter);
    const multi = new Set(p.items.map((i) => i.subject.id)).size > 1;

    if (!items.length) h += '<div class="card-body muted center">Καμία γραμμή σε αυτή την κατηγορία.</div>';
    else {
      h += '<div class="table-wrap" style="max-height:calc(100vh - 430px);min-height:200px"><table class="table table-compact"><thead><tr><th class="num">Γρ.</th><th>Α.Μ.</th><th>Σπουδαστής</th>' + (multi ? '<th>Μάθημα</th>' : '') + '<th class="center">Τιμή αρχείου</th><th class="center">Βαθμός</th><th class="center">Τρέχων</th><th>Κατάσταση</th></tr></thead><tbody>';
      items.forEach((i) => {
        const st = G_STATUS[i.status];
        const newTxt = i.parsed.kind === 'grade' ? C.gradeText({ value: i.parsed.value, absent: false, att: i.parsed.att }) : i.parsed.kind === 'absent' ? C.gradeText({ absent: true, value: null }) : '';
        const newTitle = i.parsed.att ? C.ATT_LABEL[i.parsed.att] : i.parsed.kind === 'absent' ? 'Απών' : '';
        const failing = i.parsed.kind === 'absent' || (i.parsed.kind === 'grade' && i.parsed.value < C.PASS_GRADE);
        const reNote = i.reexam && i.prev
          ? '<span class="reexam-note" title="Υπάρχει ήδη βαθμός re-exam (' + esc(C.reText(i.prev)) + '). Μένει όπως είναι — αφαιρείται μόνο αν ο νέος αρχικός βαθμός είναι προβιβάσιμος.">έχει re-exam</span>'
          : '';
        const skipped = ((i.status === 'new' || i.status === 'update') && !willImport(i)) || isProblem(i);
        h += '<tr' + (skipped ? ' style="opacity:.55"' : '') + '><td class="num muted nowrap">' + esc(i.rowNum) + '</td><td class="am">' + esc(i.amRaw || '—') + '</td>' +
          '<td>' + (i.student ? '<b>' + esc(i.student.lastName) + '</b> ' + esc(i.student.firstName) + ' ' + specBadge(i.student.specialty) : '<span class="danger-text">Δεν βρέθηκε στο μητρώο</span>') + '</td>' +
          (multi ? '<td class="small">' + esc(i.subject.code || i.subject.name) + '</td>' : '') +
          '<td class="center muted">' + esc(i.raw) + '</td>' +
          '<td class="center strong' + (failing ? ' danger-text' : '') + '" style="font-size:14px"' + (newTitle ? ' title="' + esc(newTitle) + '"' : '') + '>' + esc(newTxt) + '</td>' +
          '<td class="center muted">' + (i.prev ? '<span' + (C.gradeReason(i.prev) ? ' title="' + esc(C.gradeReason(i.prev)) + '"' : '') + '>' + esc(C.gradeText(i.prev)) + '</span>' : '') + reNote + '</td>' +
          '<td><span class="badge ' + st[1] + '">' + esc(st[0]) + '</span>' + (i.status === 'duplicate' ? ' <span class="small ' + (i.dupConflict ? 'danger-text' : 'muted') + '">' + (i.dupConflict ? 'διαφορετικός βαθμός για τον ίδιο Α.Μ. στη γρ. ' : 'ίδιος Α.Μ. και βαθμός στη γρ. ') + esc((i.dupRows || []).join(', ')) + '</span>' : '') + (i.parsed.reason ? ' <span class="small muted">' + esc(i.parsed.reason) + '</span>' : '') +
          i.warnings.map((w) => ' <span class="badge badge-warning" title="' + esc(warningText(w, i)) + '">' + icon('alert', 'width="11" height="11"') + esc(warningText(w, i)) + '</span>').join('') +
          (skipped && !isProblem(i) ? ' <span class="small muted">— παραλείπεται</span>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    if (p.missing.length) {
      h += '<details style="border-top:1px solid var(--border)"><summary class="card-body" style="cursor:pointer"><b>' + plural(p.missing.length, 'εγγεγραμμένος σπουδαστής δεν υπάρχει', 'εγγεγραμμένοι σπουδαστές δεν υπάρχουν') + ' στο αρχείο</b> <span class="small muted">— θα παραμείνουν χωρίς βαθμό (ή με τον τρέχοντα)</span></summary>' +
        '<div style="padding:0 18px 14px" class="small">' + p.missing.map((m) => '<span class="badge" style="margin:2px">' + esc(m.student.am) + ' · ' + esc(C.studentName(m.student)) + (multi ? ' · ' + esc(m.subject.code || m.subject.name) : '') + '</span>').join('') + '</div></details>';
    }
    h += '<div class="card-body" style="border-top:1px solid var(--border)"><div class="row"><span class="small muted">Έτος: <b>' + esc(C.yearLabel(S().db, G.plan.yearId)) + '</b> · Μάθημα: <b>' + esc(Array.from(new Set(p.items.map((i) => C.subjectLabel(i.subject)))).join(', ')) + '</b></span><div class="spacer"></div>' +
      '<button class="btn" data-action="gBack">' + icon('left') + 'Πίσω</button>' +
      '<button class="btn btn-primary btn-lg" data-action="gCommit"' + (count ? '' : ' disabled') + '>' + icon('check') + 'Καταχώριση ' + plural(count, 'βαθμού', 'βαθμών') + '</button></div></div></div>';
    return h;
  }

  App.actions.gFilter = (el) => {
    G.filter = el.dataset.v;
    App.render();
  };
  App.changes.gOpt = (el) => {
    G[el.dataset.k] = el.checked;
    App.render();
  };

  App.actions.gCommit = async (el) => {
    if (G.committing) return;
    G.committing = true;
    el.disabled = true;
    try {
      await gCommitInner();
    } finally {
      G.committing = false;
    }
  };

  async function gCommitInner() {
    const { yearId } = S();
    if (G.plan.yearId !== yearId) {
      toast('Το ακαδημαϊκό έτος άλλαξε — ο έλεγχος επαναλήφθηκε.', 'warn');
      buildGradePlan();
      App.render();
      return;
    }
    // re-plan against the current data (in case something changed meanwhile)
    buildGradePlan();
    await App.backup('pre-import');
    const rec = App.mutate((d) => C.commitGradeImport(d, G.plan, { replaceExisting: G.replaceExisting, includeWarnings: G.includeWarnings, fileName: G.file.name }), { render: false });
    G.result = rec;
    G.step = 4;
    App.render();
    toast('Καταχωρίστηκαν ' + plural(rec.stats.added + rec.stats.updated, 'βαθμός', 'βαθμοί'));
  }

  function gradesResultHtml() {
    const r = G.result;
    const { db } = S();
    const subj = r.subjectIds.map((id) => db.subjects.find((s) => s.id === id)).filter(Boolean);
    const lvl = subj.length ? subj[0].levelId : 'SUP';
    let h = '<div class="card card-pad" style="text-align:center;padding:36px 20px">';
    h += '<div class="empty-icon" style="background:var(--success-soft);color:var(--success);width:54px;height:54px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center">' + icon('check', 'width="28" height="28"') + '</div>';
    h += '<h2 style="margin:14px 0 6px;font-size:19px">Η εισαγωγή ολοκληρώθηκε</h2>';
    h += '<p class="muted" style="margin:0 0 18px">' + esc(r.fileName) + ' · ' + esc(subj.map((s) => C.subjectLabel(s)).join(', ')) + ' · ' + esc(C.yearLabel(db, r.yearId)) + '</p>';
    h += '<div class="row" style="justify-content:center;gap:28px;margin-bottom:22px">' +
      stat(r.stats.added, 'νέοι βαθμοί', 'success-text') + stat(r.stats.updated, 'αλλαγές', '') + (r.stats.same ? stat(r.stats.same, 'ίδιοι με πριν', 'muted') : '') + stat(r.stats.skipped, 'παραλείφθηκαν', r.stats.skipped ? 'warning-text' : 'muted') + '</div>';
    h += '<div class="row" style="justify-content:center">' +
      (r.undone ? '<span class="badge">Αναιρέθηκε</span>' : '<button class="btn" data-action="undoImport" data-id="' + r.id + '">' + icon('undo') + 'Αναίρεση εισαγωγής</button>') +
      '<button class="btn" data-action="imReset" data-kind="grades">' + icon('upload') + 'Νέα εισαγωγή</button>' +
      '<button class="btn" data-action="go" data-page="gradebook" data-level="' + lvl + '">' + icon('grid') + 'Άνοιγμα βαθμολογίου</button></div>';
    if (!r.undone && subj.length) {
      h += '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)"><div class="small muted" style="margin-bottom:10px">Εξαγωγή της βαθμολογίας του μαθήματος — μόνο <b>Α.Μ.</b> και <b>βαθμός</b>, ένα φύλλο για κάθε τμήμα:</div><div class="row row-wrap" style="justify-content:center">' +
        subj.map((s) => '<button class="btn btn-primary" data-action="exportSubject" data-id="' + s.id + '" data-year="' + r.yearId + '">' + icon('download') + 'Βαθμολογία ' + esc(s.code || s.name) + '</button>').join('') + '</div></div>';
    }
    h += '</div>';
    return h;
  }

  function stat(v, l, cls) {
    return '<div><div style="font-size:28px;font-weight:750" class="tnum ' + (cls || '') + '">' + v + '</div><div class="small muted">' + esc(l) + '</div></div>';
  }

  // ======================================================================
  // STUDENTS
  // ======================================================================
  function autoMapStudents() {
    const tbl = T.table;
    const roles = tbl.headers.map((h) => C.guessColumnRole(h.title));
    const m = T.map;
    Object.keys(m).forEach((k) => (m[k] = -1));
    roles.forEach((r, i) => {
      if (r && m[r] !== undefined && m[r] < 0) m[r] = i;
    });
    if (m.am < 0) {
      // guess: first mostly-numeric column that is not an index
      const cand = tbl.headers.findIndex((h, i) => roles[i] !== 'index' && samples(tbl, i, 8).length && samples(tbl, i, 8).every((v) => /\d/.test(v)));
      m.am = cand;
    }
    if (m.fullName >= 0 && (m.lastName < 0 || m.firstName < 0)) T.nameMode = 'full';
    else T.nameMode = 'split';
    if (T.nameMode === 'split' && m.lastName < 0 && m.firstName < 0) {
      // No recognised name header: first non-AM text column as full name
      const cand = tbl.headers.findIndex((h, i) => i !== m.am && roles[i] !== 'index' && samples(tbl, i, 5).some((v) => /[a-zα-ω]/i.test(v)));
      if (cand >= 0) {
        m.fullName = cand;
        T.nameMode = 'full';
      }
    }
  }

  function colSelect(key, required) {
    const tbl = T.table;
    const v = T.map[key];
    return '<select class="select' + (required && v < 0 ? ' invalid' : '') + '" data-on-change="tMap" data-k="' + key + '">' +
      '<option value="-1">' + (required ? '— Επιλέξτε στήλη —' : '— Δεν υπάρχει —') + '</option>' +
      tbl.headers.map((h, i) => '<option value="' + i + '"' + (i === v ? ' selected' : '') + '>' + esc(h.letter + ' · ' + h.title) + '</option>').join('') + '</select>';
  }

  function mapRow(label, key, required, extra) {
    const v = T.map[key];
    const smp = v >= 0 ? samples(T.table, v, 3).join(' · ') : '';
    return '<tr><td class="strong" style="width:230px">' + esc(label) + (required ? ' <span class="danger-text">*</span>' : '') + '</td><td style="width:36%">' + colSelect(key, required) + '</td><td><div class="sample">' + esc(smp) + '</div>' + (extra || '') + '</td></tr>';
  }

  function studentsHtml() {
    const { db, yearId } = S();
    let h = wizardSteps(T.step, ['Αρχείο', 'Αντιστοίχιση στηλών', 'Έλεγχος', 'Ολοκλήρωση']);
    if (T.step === 1) {
      h += '<div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">';
      h += '<div class="card card-pad">' + dropzoneHtml('students', 'Excel με τους σπουδαστές', 'Χρειάζονται τουλάχιστον οι στήλες <b>ονοματεπώνυμο</b> (μία ή δύο στήλες) και <b>αριθμός μητρώου (Α.Μ.)</b>. Προαιρετικά: πατρώνυμο, ειδικότητα, επίπεδο, τμήμα, <b>περίοδος</b> (Οκτ / Ιαν / Μάι), email, τηλέφωνο.') + '</div>';
      h += '<div class="card card-pad"><h3 style="margin:0 0 10px;font-size:14.5px">Αριθμοί μητρώου</h3><ul style="margin:0;padding-left:18px;line-height:1.7" class="small">' +
        '<li>Ο <b>Α.Μ.</b> είναι το κλειδί κάθε σπουδαστή — με αυτόν αντιστοιχίζονται οι βαθμολογίες των καθηγητών.</li>' +
        '<li>Αν ένας Α.Μ. υπάρχει ήδη, ο σπουδαστής <b>δεν διπλασιάζεται</b> — μόνο ενημερώνονται τα στοιχεία του.</li>' +
        '<li>Οι σπουδαστές μπορούν να εγγραφούν απευθείας σε επίπεδο για το έτος <b>' + esc(C.yearLabel(db, yearId)) + '</b>.</li>' +
        '<li>Διπλοί ή κενοί Α.Μ. στο αρχείο εντοπίζονται πριν την καταχώριση.</li></ul>' +
        '<button class="btn btn-sm" style="margin-top:14px" data-action="dlStudentTemplate">' + icon('download') + 'Κατέβασμα προτύπου Excel</button></div></div>';
      return h;
    }
    h += fileBar('students', T);
    if (T.step === 2) return h + studentsMappingHtml();
    if (T.step === 3) return h + studentsPreviewHtml();
    return h + studentsResultHtml();
  }

  function studentsMappingHtml() {
    const { db, yearId } = S();
    const m = T.map;
    let h = '<div class="grid" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);align-items:start">';
    h += '<div class="card"><div class="card-head"><div><h3>Αντιστοίχιση στηλών</h3><div class="sub">Ποια στήλη του αρχείου περιέχει κάθε στοιχείο</div></div></div><table class="table map-table"><tbody>';
    h += mapRow('Αριθμός μητρώου (Α.Μ.)', 'am', true);
    h += '<tr><td class="strong">Ονοματεπώνυμο</td><td colspan="2"><div class="seg"><button class="' + (T.nameMode === 'split' ? 'on' : '') + '" data-action="tNameMode" data-v="split">Επώνυμο & Όνομα σε χωριστές στήλες</button><button class="' + (T.nameMode === 'full' ? 'on' : '') + '" data-action="tNameMode" data-v="full">Σε μία στήλη</button></div></td></tr>';
    if (T.nameMode === 'split') {
      h += mapRow('Επώνυμο', 'lastName', true);
      h += mapRow('Όνομα', 'firstName', true);
    } else {
      h += mapRow('Ονοματεπώνυμο', 'fullName', true, '<div class="row" style="margin-top:6px"><span class="small muted">Σειρά:</span><div class="seg"><button class="' + (T.nameOrder === 'LF' ? 'on' : '') + '" data-action="tOrder" data-v="LF">Επώνυμο Όνομα</button><button class="' + (T.nameOrder === 'FL' ? 'on' : '') + '" data-action="tOrder" data-v="FL">Όνομα Επώνυμο</button></div></div>');
    }
    h += mapRow('Πατρώνυμο', 'fatherName', false);
    h += mapRow('Ειδικότητα (Deck/Engine)', 'specialty', false);
    h += mapRow('Επίπεδο', 'level', false, '<div class="small muted" style="margin-top:3px">Μπορεί να περιέχει και όλο το τμήμα, π.χ. «Operational Level A Deck Morning».</div>');
    h += mapRow('Τμήμα', 'section', false);
    h += mapRow('Περίοδος', 'period', false, '<div class="small muted" style="margin-top:3px">Π.χ. «Οκτ», «Ιανουάριος», «10» ή ημερομηνία έναρξης. Μπορεί να γράφεται και μέσα στο τμήμα, π.χ. «Support Morning 1 Oct».</div>');
    h += mapRow('Email', 'email', false);
    h += mapRow('Τηλέφωνο', 'phone', false);
    h += '</tbody></table></div>';

    h += '<div class="card"><div class="card-head"><div><h3>Προεπιλογές</h3><div class="sub">Για όσους δεν έχουν τιμή στο αρχείο</div></div></div><div class="card-body stack">';
    h += '<div class="field"><label>Εγγραφή στο ακαδημαϊκό έτος ' + esc(C.yearLabel(db, yearId)) + ' στο επίπεδο</label><select class="select" data-on-change="tDef" data-k="defLevel">' + options([{ value: '', label: '— Χωρίς εγγραφή —' }].concat(C.LEVELS.map((l) => ({ value: l.id, label: C.levelName(db, l.id, T.defSpec || null) }))), T.defLevel) + '</select>' +
      '<div class="hint">' + (m.level >= 0 ? 'Χρησιμοποιείται μόνο όταν η στήλη «Επίπεδο» είναι κενή.' : 'Όλοι οι σπουδαστές του αρχείου θα εγγραφούν σε αυτό το επίπεδο.') + '</div></div>';
    if (T.defLevel && !C.isShiftLevel(T.defLevel))
      h += '<div class="field"><label>Τμήμα</label><select class="select" data-on-change="tDef" data-k="defSec">' + options([{ value: '', label: '— Χωρίς —' }].concat(C.levelSections(T.defLevel).map((x) => ({ value: x.id, label: x.name }))), T.defSec) + '</select>' +
        '<div class="hint">' + (m.section >= 0 || m.level >= 0 ? 'Χρησιμοποιείται μόνο όταν το αρχείο δεν ορίζει τμήμα.' : 'Εφαρμόζεται σε όλους τους σπουδαστές του αρχείου.') + '</div></div>';
    h += defaultPeriodHtml();
    h += '<div class="field"><label>Ειδικότητα</label><select class="select" data-on-change="tDef" data-k="defSpec">' + options([{ value: '', label: '— Χωρίς —' }, { value: 'DECK', label: 'Deck' }, { value: 'ENGINE', label: 'Engine' }], T.defSpec) + '</select>' +
      '<div class="hint">' + (m.specialty >= 0 ? 'Χρησιμοποιείται μόνο όταν η στήλη «Ειδικότητα» είναι κενή.' : 'Εφαρμόζεται σε όλους τους σπουδαστές του αρχείου.') + '</div></div>';
    h += '</div></div></div>';

    let problem = '';
    if (m.am < 0) problem = 'Επιλέξτε τη στήλη του αριθμού μητρώου.';
    else if (T.nameMode === 'split' && (m.lastName < 0 || m.firstName < 0)) problem = 'Επιλέξτε τις στήλες επωνύμου και ονόματος.';
    else if (T.nameMode === 'full' && m.fullName < 0) problem = 'Επιλέξτε τη στήλη ονοματεπωνύμου.';
    h += '<div class="card card-pad" style="margin-top:16px"><div class="row">' + (problem ? '<span class="warning-text small">' + icon('alert', 'width="14" height="14" style="vertical-align:-2px"') + ' ' + esc(problem) + '</span>' : '<span class="small muted">' + plural(T.table.rows.length, 'γραμμή', 'γραμμές') + ' προς έλεγχο</span>') +
      '<div class="spacer"></div><button class="btn" data-action="imReset" data-kind="students">Πίσω</button><button class="btn btn-primary" data-action="tPreview"' + (problem ? ' disabled' : '') + '>Έλεγχος ' + icon('arrowRight') + '</button></div></div>';
    return h;
  }

  /** Periods offered as the default: those of the default level, else every period some level has. */
  function defaultPeriodChoices() {
    const { db } = S();
    if (T.defLevel) return C.levelPeriods(db, T.defLevel);
    return (db.settings.periods || []).filter((p) => C.LEVEL_IDS.some((l) => C.validPeriodFor(db, l, p.id)));
  }

  /** «Προεπιλεγμένη περίοδος» (opts.defaultPeriod of the plan). */
  function defaultPeriodHtml() {
    const { db } = S();
    const list = defaultPeriodChoices();
    if (!list.some((p) => p.id === T.defPer)) T.defPer = '';
    if (!list.length) return '';
    if (T.defLevel && list.length === 1)
      return '<div class="field"><label>Προεπιλεγμένη περίοδος</label><input class="input" value="' + esc(list[0].name + ' (αυτόματα)') + '" disabled />' +
        '<div class="hint">Το ' + esc(C.levelName(db, T.defLevel, T.defSpec || null)) + ' έχει μόνο αυτή την περίοδο.</div></div>';
    const m = T.map;
    const hint = m.period >= 0
      ? 'Χρησιμοποιείται μόνο όταν η στήλη «Περίοδος» είναι κενή.'
      : T.defLevel
        ? 'Εφαρμόζεται σε όλους τους σπουδαστές του αρχείου.'
        : 'Εφαρμόζεται σε όσους το επίπεδό τους έχει αυτή την περίοδο.';
    return '<div class="field"><label>Προεπιλεγμένη περίοδος</label><select class="select" id="t-def-per" data-on-change="tDef" data-k="defPer">' +
      options([{ value: '', label: '— Χωρίς —' }].concat(list.map((p) => ({ value: p.id, label: p.name }))), T.defPer) + '</select><div class="hint">' + esc(hint) + '</div></div>';
  }

  App.changes.tMap = (el) => {
    T.map[el.dataset.k] = Number(el.value);
    App.render();
  };
  App.actions.tNameMode = (el) => {
    T.nameMode = el.dataset.v;
    App.render();
  };
  App.actions.tOrder = (el) => {
    T.nameOrder = el.dataset.v;
    App.render();
  };
  App.changes.tDef = (el) => {
    T[el.dataset.k] = el.value;
    if (el.dataset.k === 'defLevel') T.defSec = '';
    App.render();
  };

  function buildStudentPlan() {
    const { db, yearId } = S();
    const map = Object.assign({}, T.map);
    if (T.nameMode === 'split') map.fullName = -1;
    else {
      map.lastName = -1;
      map.firstName = -1;
    }
    T.plan = C.planStudentImport(db, {
      table: T.table,
      map,
      nameOrder: T.nameOrder,
      defaults: { yearId, levelId: T.defLevel, specialty: T.defSpec, section: T.defSec },
      defaultPeriod: defaultPeriodChoices().some((p) => p.id === T.defPer) ? T.defPer : undefined,
      updateExisting: T.updateExisting,
    });
  }

  App.actions.tPreview = () => {
    buildStudentPlan();
    T.step = 3;
    T.filter = 'all';
    App.render();
  };
  App.actions.tBack = () => {
    T.step = 2;
    App.render();
  };
  App.actions.tFilter = (el) => {
    T.filter = el.dataset.v;
    App.render();
  };
  App.changes.tUpd = (el) => {
    T.updateExisting = el.checked;
    App.render();
  };

  const FIELD_LABEL = { lastName: 'Επώνυμο', firstName: 'Όνομα', fatherName: 'Πατρώνυμο', email: 'Email', phone: 'Τηλέφωνο', specialty: 'Ειδικότητα' };

  function studentsPreviewHtml() {
    const { db, yearId } = S();
    const p = T.plan;
    const sm = p.summary;
    const bad = sm.invalid + sm.duplicate + sm.conflict;
    const isBad = (i) => i.status === 'invalid' || i.status === 'duplicate' || i.status === 'conflict';
    const warned = p.items.filter((i) => !isBad(i) && i.issues.length).length;
    const chips = [
      ['all', 'Όλες', p.items.length, '#6b778a'],
      ['new', 'Νέοι σπουδαστές', sm.new, 'var(--success)'],
      ['update', 'Αλλαγή στοιχείων', sm.update, 'var(--primary)'],
      ['existing', 'Ήδη στο μητρώο', sm.existing, '#98a3b3'],
      ['bad', 'Με σφάλμα', bad, 'var(--danger)'],
    ];
    if (warned) chips.push(['warn', 'Με προειδοποίηση', warned, 'var(--warning)']);
    if (T.filter === 'warn' && !warned) T.filter = 'all';
    const showPer = p.items.some((i) => i.period) || T.map.period >= 0 || (T.defLevel ? C.levelHasPeriods(db, T.defLevel) : C.LEVEL_IDS.some((l) => C.levelHasPeriods(db, l)));
    let h = '<div class="card"><div class="card-head"><div class="chips">' + chips.map((c) => '<button class="chip' + (T.filter === c[0] ? ' on' : '') + '" data-action="tFilter" data-v="' + c[0] + '"><span class="dot" style="background:' + c[3] + '"></span>' + esc(c[1]) + ' <b>' + c[2] + '</b></button>').join('') + '</div></div>';
    const opts = [];
    if (sm.update) opts.push('<label class="checkbox"><input type="checkbox" data-on-change="tUpd"' + (T.updateExisting ? ' checked' : '') + ' /> Ενημέρωση στοιχείων υπαρχόντων σπουδαστών (' + sm.update + ')</label>');
    if (bad) opts.push('<span class="small danger-text">' + icon('alert', 'width="14" height="14" style="vertical-align:-2px"') + ' ' + plural(bad, 'γραμμή θα παραλειφθεί', 'γραμμές θα παραλειφθούν') + '</span>');
    if (opts.length) h += '<div class="card-body row row-wrap" style="gap:18px;border-bottom:1px solid var(--border)">' + opts.join('') + '</div>';

    let items = p.items;
    if (T.filter === 'bad') items = items.filter(isBad);
    else if (T.filter === 'warn') items = items.filter((i) => !isBad(i) && i.issues.length);
    else if (T.filter !== 'all') items = items.filter((i) => i.status === T.filter);
    const ST = { new: ['Νέος', 'badge-success'], update: ['Αλλαγή στοιχείων', 'badge-info'], existing: ['Υπάρχει ήδη', ''], invalid: ['Σφάλμα', 'badge-danger'], duplicate: ['Διπλός Α.Μ.', 'badge-danger'], conflict: ['Άλλο πρόσωπο', 'badge-danger'] };
    if (!items.length) h += '<div class="card-body muted center">Καμία γραμμή σε αυτή την κατηγορία.</div>';
    else {
      h += '<div class="table-wrap" style="max-height:calc(100vh - 430px);min-height:200px"><table class="table table-compact"><thead><tr><th class="num">Γρ.</th><th>Α.Μ.</th><th>Επώνυμο</th><th>Όνομα</th><th>Πατρώνυμο</th><th>Ειδικότητα</th><th>Εγγραφή ' + esc(C.yearLabel(db, yearId)) + '</th><th>Τμήμα</th>' + (showPer ? '<th>Περίοδος</th>' : '') + '<th>Κατάσταση</th></tr></thead><tbody>';
      items.forEach((i) => {
        const st = ST[i.status];
        const d = i.data;
        const skip = i.status === 'invalid' || i.status === 'duplicate' || i.status === 'conflict';
        let enroll = '';
        if (!skip && i.levelId) {
          if (i.enroll === 'new') enroll = '<span class="badge badge-level">' + esc(C.levelShort(i.levelId, d.specialty)) + '</span>';
          else if (i.enroll === 'change') {
            const cur = C.getEnrollment(db, i.existing.id, yearId);
            enroll = '<span class="small muted">' + esc(C.levelShort(cur.levelId, d.specialty)) + ' →</span> <span class="badge badge-level">' + esc(C.levelShort(i.levelId, d.specialty)) + '</span>';
          } else enroll = '<span class="small muted">' + esc(C.levelShort(i.levelId, d.specialty)) + ' (ήδη)</span>';
        }
        let secTxt = '';
        if (!skip && i.levelId) {
          const sec = i.section || (i.existing ? C.studentSection(db, i.existing, yearId) : null);
          secTxt = sec ? '<span class="badge badge-sec">' + esc(C.sectionName(i.levelId, sec)) + '</span>' : '<span class="faint">—</span>';
        }
        let perTxt = '';
        if (showPer && !skip && i.levelId) {
          const cur = i.existing ? C.getEnrollment(db, i.existing.id, yearId) : null;
          const curPer = cur && cur.levelId === i.levelId ? cur.period || null : null;
          const tag = (id) => '<span class="badge badge-period" title="' + esc(C.periodName(id)) + '">' + esc(C.periodShort(id)) + '</span>';
          if (i.period) perTxt = (curPer && curPer !== i.period ? '<span class="small muted">' + esc(C.periodShort(curPer)) + ' →</span> ' : '') + tag(i.period);
          else if (curPer) perTxt = '<span class="small muted">' + esc(C.periodShort(curPer)) + ' (ήδη)</span>';
          else perTxt = C.levelHasPeriods(db, i.levelId) ? '<span class="badge badge-period none" title="Χωρίς περίοδο">Χωρίς</span>' : '<span class="faint">—</span>';
        }
        let notes = i.issues.map((x) => '<span class="small ' + (skip ? 'danger-text' : 'warning-text') + '">' + esc(x) + '</span>').join(' · ');
        if (!skip && i.identity) notes += (notes ? ' · ' : '') + '<span class="badge badge-warning" title="Θα ζητηθεί επιβεβαίωση ότι είναι ο ίδιος σπουδαστής">' + icon('users', 'width="12" height="12"') + ' ' + esc(i.identity.prev.className) + ' (' + esc(C.yearLabel(db, i.identity.prev.yearId)) + ') → ' + esc(i.identity.next.className) + '</span>';
        if (i.status === 'update') {
          notes += (notes ? ' · ' : '') + '<span class="small muted">' + i.changes.map((f) => esc(FIELD_LABEL[f]) + ': ' + esc(f === 'specialty' ? C.specialtyName(i.existing[f]) || '—' : i.existing[f] || '—') + ' → <b>' + esc(f === 'specialty' ? C.specialtyName(d[f]) : d[f]) + '</b>').join(', ') + '</span>';
        }
        h += '<tr' + (skip ? ' style="background:#fff8f8"' : '') + '><td class="num muted">' + i.rowNum + '</td><td class="am">' + esc(d.am || '—') + '</td><td class="strong">' + esc(d.lastName) + '</td><td>' + esc(d.firstName) + '</td><td class="muted">' + esc(d.fatherName) + '</td><td>' + specBadge(d.specialty) + '</td><td>' + enroll + '</td><td>' + secTxt + '</td>' + (showPer ? '<td class="per-cell">' + perTxt + '</td>' : '') +
          '<td><span class="badge ' + st[1] + '">' + esc(st[0]) + '</span> ' + notes + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    const creates = sm.new;
    const enrolls = p.items.filter((i) => ['new', 'update', 'existing'].includes(i.status) && i.levelId && i.enroll !== 'same').length;
    const updates = T.updateExisting ? sm.update : 0;
    const total = creates + enrolls + updates;
    h += '<div class="card-body" style="border-top:1px solid var(--border)"><div class="row"><span class="small muted">' + plural(creates, 'νέος σπουδαστής', 'νέοι σπουδαστές') + ' · ' + plural(updates, 'ενημέρωση', 'ενημερώσεις') + ' · ' + plural(enrolls, 'εγγραφή', 'εγγραφές') + ' στο ' + esc(C.yearLabel(db, yearId)) + '</span><div class="spacer"></div>' +
      '<button class="btn" data-action="tBack">' + icon('left') + 'Πίσω</button><button class="btn btn-primary btn-lg" data-action="tCommit"' + (total ? '' : ' disabled') + '>' + icon('check') + 'Καταχώριση στο μητρώο</button></div></div></div>';
    return h;
  }

  App.actions.tCommit = async (el) => {
    if (T.committing) return;
    T.committing = true;
    el.disabled = true;
    try {
      await tCommitInner();
    } finally {
      T.committing = false;
    }
  };

  async function tCommitInner() {
    buildStudentPlan();
    // existing Α.Μ. entering another class/level → ask whether it is the same student
    const answer = await App.confirmSameStudents(T.plan.items.filter((i) => i.identity && (i.status === 'update' || i.status === 'existing')).map((i) => ({
      key: i.rowNum,
      student: i.existing,
      fileName: C.studentName(i.data),
      match: i.identity.match,
      prev: i.identity.prev,
      next: i.identity.next,
    })));
    if (!answer) return;
    await App.backup('pre-import');
    const rec = App.mutate((d) => C.commitStudentImport(d, T.plan, { fileName: T.file.name, updateExisting: T.updateExisting, notSameRows: answer.notSame }), { render: false });
    T.result = rec;
    T.step = 4;
    App.render();
    toast('Το μητρώο ενημερώθηκε');
  }

  function studentsResultHtml() {
    const r = T.result;
    let h = '<div class="card card-pad" style="text-align:center;padding:36px 20px">';
    h += '<div style="background:var(--success-soft);color:var(--success);width:54px;height:54px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center">' + icon('check', 'width="28" height="28"') + '</div>';
    h += '<h2 style="margin:14px 0 6px;font-size:19px">Το μητρώο ενημερώθηκε</h2><p class="muted" style="margin:0 0 18px">' + esc(r.fileName) + '</p>';
    h += '<div class="row" style="justify-content:center;gap:28px;margin-bottom:22px">' + stat(r.stats.created, 'νέοι σπουδαστές', 'success-text') + stat(r.stats.updated, 'ενημερώσεις', '') + stat(r.stats.enrolled, 'εγγραφές σε επίπεδο', '') + stat(r.stats.skipped, 'παραλείφθηκαν', r.stats.skipped ? 'warning-text' : 'muted') + '</div>';
    h += '<div class="row" style="justify-content:center">' + (r.undone ? '<span class="badge">Αναιρέθηκε</span>' : '<button class="btn" data-action="undoImport" data-id="' + r.id + '">' + icon('undo') + 'Αναίρεση</button>') +
      '<button class="btn" data-action="imReset" data-kind="students">' + icon('upload') + 'Νέα εισαγωγή</button><button class="btn btn-primary" data-action="go" data-page="students">' + icon('users') + 'Άνοιγμα μητρώου</button></div></div>';
    return h;
  }

  /**
   * «Είναι ο ίδιος σπουδαστής;» — for existing Α.Μ. that move to another class/level.
   * list: [{key, student, fileName, match, prev:{yearId,className}, next:{yearId,className}}]
   * Resolves {notSame:[keys]} or null when cancelled. Empty list → resolves immediately.
   */
  App.confirmSameStudents = function (list) {
    if (!list || !list.length) return Promise.resolve({ notSame: [] });
    const { db } = S();
    return new Promise((resolve) => {
      let done = false;
      const rows = list.map((x, n) =>
        '<tr><td class="am">' + esc(x.student.am) + '</td><td><div class="strong">' + esc(C.studentName(x.student)) + '</div>' +
        (x.match !== 'exact' ? '<div class="small warning-text">στο αρχείο: ' + esc(x.fileName) + '</div>' : '') + '</td>' +
        '<td>' + esc(x.prev.className) + '<div class="small muted">' + esc(C.yearLabel(db, x.prev.yearId)) + '</div></td>' +
        '<td class="strong">' + esc(x.next.className) + '<div class="small muted">' + esc(C.yearLabel(db, x.next.yearId)) + '</div></td>' +
        '<td><div class="seg seg-sm" data-n="' + n + '"><button class="on" data-same="1">Ναι, ο ίδιος</button><button data-same="0">Όχι</button></div></td></tr>'
      ).join('');
      const same = list.map(() => true);
      openModal({
        title: list.length === 1 ? 'Είναι ο ίδιος σπουδαστής;' : 'Είναι οι ίδιοι σπουδαστές;',
        sub: 'Ο Α.Μ. και το ονοματεπώνυμο ταιριάζουν με σπουδαστή του μητρώου που μπαίνει σε άλλο τμήμα',
        size: 'lg',
        body: '<div class="callout">' + icon('info') + '<p>Με «Ναι» ο σπουδαστής συνεχίζει με το ίδιο μητρώο: κρατά το ιστορικό και τους βαθμούς του και εγγράφεται στο νέο τμήμα. Με «Όχι» η γραμμή δεν καταχωρίζεται — ελέγξτε τον Α.Μ. στο αρχείο.</p></div>' +
          '<div class="table-wrap" style="max-height:52vh;margin-top:12px"><table class="table" id="same-table"><thead><tr><th>Α.Μ.</th><th>Σπουδαστής</th><th>Ήταν στο</th><th>Μπαίνει στο</th><th style="width:170px">Ίδιος σπουδαστής;</th></tr></thead><tbody>' + rows + '</tbody></table></div>',
        onMount(ctx) {
          ctx.el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-same]');
            if (!b) return;
            const seg = b.parentElement;
            same[Number(seg.dataset.n)] = b.dataset.same === '1';
            seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          });
        },
        buttons: [
          { label: 'Άκυρο' },
          {
            label: 'Συνέχεια',
            cls: 'btn-primary',
            id: 'same-ok',
            icon: 'check',
            onClick: () => {
              done = true;
              resolve({ notSame: list.filter((x, n) => !same[n]).map((x) => x.key) });
            },
          },
        ],
        onClose: () => {
          if (!done) resolve(null);
        },
      });
    });
  };

  App.actions.dlStudentTemplate = async () => {
    const r = window.XL.buildStudentTemplate(S().db);
    await App.saveWorkbook(r.wb, 'Πρότυπο_σπουδαστών.xlsx');
  };

  // ======================================================================
  // HISTORY
  // ======================================================================
  function historyHtml() {
    const { db } = S();
    if (!db.imports.length) return '<div class="card">' + emptyState('refresh', 'Καμία εισαγωγή ακόμη', 'Εδώ θα εμφανίζονται όλα τα αρχεία Excel που έχετε καταχωρίσει, με δυνατότητα αναίρεσης.') + '</div>';
    let h = '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Ημερομηνία</th><th>Τύπος</th><th>Αρχείο</th><th>Έτος</th><th>Αποτέλεσμα</th><th>Κατάσταση</th><th></th></tr></thead><tbody>';
    db.imports.forEach((r) => {
      h += '<tr><td class="nowrap">' + fmtDate(r.date, true) + '</td><td>' + (r.type === 'grades' ? '<span class="badge badge-info">Βαθμολογίες</span>' : r.type === 'transfer' ? '<span class="badge badge-sec">Μεταφορά</span>' : '<span class="badge badge-level">Σπουδαστές</span>') + '</td><td class="strong" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.fileName || '—') + (r.by ? '<div class="small muted" style="font-weight:400">από ' + esc(r.byName || r.by) + (r.byRole === 'teacher' ? ' (καθηγητής)' : '') + '</div>' : '') + '</td><td>' + esc(C.yearLabel(db, r.yearId)) + '</td><td class="small">' + esc(App.importSummaryText(r)) + '</td>' +
        '<td>' + (r.undone ? '<span class="badge">Αναιρέθηκε ' + fmtDate(r.undoneAt) + '</span>' : '<span class="badge badge-success">Ενεργή</span>') + '</td>' +
        '<td class="right">' + (r.undone ? '' : '<button class="btn btn-sm" data-action="undoImport" data-id="' + r.id + '">' + icon('undo') + 'Αναίρεση</button>') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    h += '<p class="small muted" style="margin-top:10px">Η αναίρεση επαναφέρει τους προηγούμενους βαθμούς. Βαθμοί που άλλαξαν χειροκίνητα μετά την εισαγωγή δεν επηρεάζονται.</p>';
    return h;
  }

  App.actions.undoImport = async (el) => {
    const { db } = S();
    const rec = db.imports.find((r) => r.id === el.dataset.id);
    if (!rec) return;
    const what =
      rec.type === 'grades'
        ? plural(rec.changes.length, 'βαθμός θα επανέλθει', 'βαθμοί θα επανέλθουν') + ' στην προηγούμενη κατάσταση.'
        : rec.type === 'transfer'
          ? plural(rec.stats.moved, 'εγγραφή θα επανέλθει', 'εγγραφές θα επανέλθουν') + ' στην προηγούμενη κατάσταση.'
          : plural(rec.stats.created, 'νέος σπουδαστής θα αφαιρεθεί', 'νέοι σπουδαστές θα αφαιρεθούν') + ' και οι αλλαγές/εγγραφές θα αναιρεθούν.';
    const ok = await confirmDialog('Αναίρεση εισαγωγής', 'Αναίρεση της ενέργειας <b>' + esc(rec.fileName || (rec.type === 'transfer' ? 'Μεταφορά σπουδαστών' : '')) + '</b> (' + fmtDate(rec.date, true) + ');<br><br>' + what, { okText: 'Αναίρεση', danger: true });
    if (!ok) return;
    await App.backup('pre-undo');
    const r = App.mutate((d) => C.undoImport(d, rec.id));
    toast('Η εισαγωγή αναιρέθηκε' + (r.conflicts ? ' · ' + plural(r.conflicts, 'εγγραφή άλλαξε', 'εγγραφές άλλαξαν') + ' μετέπειτα και διατηρήθηκαν' : ''), r.conflicts ? 'warn' : 'success');
  };
})();
