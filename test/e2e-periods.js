/*
 * Periods (intakes) + admin/teacher sync in the real app (run under xvfb, needs a v2.2 server):
 * Ρυθμίσεις → «Περίοδοι» card (add a period, tick a level), student import with a «Περίοδος» column
 * (Οκτ / Ιαν mixed) + default period, students page period filter / tag / card editor / bulk
 * «Ορισμός περιόδου» / new student with a period, transfer with a target period, dashboard split,
 * grade import that ignores a "Re-exam" sheet (multi-sheet, 0Δ / 0Α, «έχει re-exam»),
 * and the automatic merge of the admin's save with a teacher's grade (409 → merge → saved without
 * a dialog), a real same-record conflict (dialog, «Κράτηση της δικής μου» / «Φόρτωση νέας έκδοσης»)
 * and the 10 s polling.
 *
 *   GMC_SERVER_BIN=/home/claude/stable-bin/gmc-registry-server xvfb-run -a node test/e2e-periods.js
 */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const XLSX = require('xlsx');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e-periods';
const SAVE = TMP + '/out';
const SAMPLES = TMP + '/samples';
const SHOTS = path.join(__dirname, 'shots');
let app, win, server, url;
const errors = [];

async function api(method, u, body, token) {
  const r = await fetch(url + u, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(method + ' ' + u + ' → ' + r.status + ': ' + JSON.stringify(data));
  return data;
}

const step = (m) => console.log('• ' + m);
const shot = async (name) => {
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(SHOTS, 'per-' + name + '.png') });
};
async function settle() {
  await win.waitForTimeout(700); // debounce + network save
  await win.waitForFunction(() => !document.querySelector('#save-status.saving'), null, { timeout: 15000 });
}
async function nav(label) {
  await win.click('.nav-item:has-text("' + label + '")');
  await win.waitForTimeout(150);
}
async function stubOpen(file) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
}
const reg = () => server.registry();
const byAm = (d, am) => d.students.find((s) => s.am === am);
const enOf = (d, am, yearId) => d.enrollments.find((e) => e.studentId === byAm(d, am).id && e.yearId === yearId);

function writeXlsx(file, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name));
  XLSX.writeFile(wb, file);
  return file;
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  [TMP + '/local', SAVE, SAMPLES].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  fs.mkdirSync(SHOTS, { recursive: true });
  server = await startServer();
  url = server.url;

  // ---------------------------------------------------------------- seed (built with Core in Node)
  const adm = (await api('POST', '/api/setup', { username: 'admin', password: 'Admin-12345' })).token;
  const db = C.createEmptyDb(new Date(2026, 8, 1));
  const Y1 = db.settings.currentYearId;
  const Y2 = C.addYear(db, '2027-2028').id;
  const sup01 = C.createSubject(db, { levelId: 'SUP', code: 'SUP01', name: 'Βασική Ασφάλεια' });
  C.createSubject(db, { levelId: 'OLA', code: 'NAV101', name: 'Ναυσιπλοΐα', specialty: 'DECK' });
  const seed = [
    ['27001', 'ΑΛΦΑΣ', 'ΑΝΔΡΕΑΣ', 'DECK', 'SUP', 'M1', 'OCT'],
    ['27002', 'ΒΗΤΑΣ', 'ΒΑΣΙΛΗΣ', 'ENGINE', 'SUP', 'M1', 'OCT'],
    ['27003', 'ΓΑΜΑΣ', 'ΓΙΩΡΓΟΣ', 'DECK', 'SUP', 'M2', 'OCT'],
    ['27004', 'ΔΕΛΤΑΣ', 'ΔΗΜΗΤΡΗΣ', 'ENGINE', 'SUP', 'M1', 'JAN'],
    ['27005', 'ΕΨΙΛΟΝ', 'ΕΛΕΝΗ', 'DECK', 'SUP', 'AF', 'JAN'],
    ['27010', 'ΖΗΤΑΣ', 'ΖΑΧΑΡΙΑΣ', 'DECK', 'OLA', 'MO', undefined],
  ];
  seed.forEach(([am, ln, fn, sp, lv, sec, per]) => {
    const s = C.createStudent(db, { am, lastName: ln, firstName: fn, specialty: sp });
    C.setEnrollment(db, s.id, Y1, lv, sec, per);
  });
  assert.strictEqual(enOf(db, '27010', Y1).period, 'OCT', 'Operational A gets its only period automatically');
  // 27003 was absent and already has a re-exam grade (3)
  C.setGrade(db, byAm(db, '27003').id, sup01.id, Y1, { value: null, absent: true, source: 'manual' });
  C.setReexam(db, byAm(db, '27003').id, sup01.id, Y1, { value: 3, absent: false }, 'admin');
  await api('PUT', '/api/registry', { baseRev: 0, data: db }, adm);
  // a teacher of SUP01 (all periods)
  const teacher = await api('POST', '/api/users/teachers', { username: 'teach1', password: 'Teach-12345', name: 'Καθηγητής Ένα' }, adm);
  await api('PUT', '/api/users/' + teacher.id + '/assignments', { assignments: [{ yearId: Y1, subjectId: sup01.id, spec: '', section: '', period: '', label: '' }] }, adm);
  const tch = (await api('POST', '/api/login', { username: 'teach1', password: 'Teach-12345' })).token;

  // sample files
  const studentsFile = writeXlsx(path.join(SAMPLES, '5_Σπουδαστές_περίοδοι.xlsx'), [
    ['Νέοι σπουδαστές', [
      ['Α.Μ.', 'Επώνυμο', 'Όνομα', 'Ειδικότητα', 'Τμήμα', 'Περίοδος'],
      [27101, 'ΚΑΠΠΑΣ', 'ΚΩΣΤΑΣ', 'Deck', 'Morning 1', 'Οκτ'],
      [27102, 'ΛΑΜΔΑΣ', 'ΛΑΜΠΡΟΣ', 'Engine', 'Morning 2', 'Ιανουάριος'],
      [27103, 'ΜΙΧΑΛΗΣ', 'ΜΑΝΟΣ', 'Deck', 'Afternoon', ''],
      [27104, 'ΝΙΚΟΥ', 'ΝΙΚΟΣ', 'Engine', 'Morning 1', 10],
      [27105, 'ΞΕΝΟΣ', 'ΞΕΝΟΦΩΝ', 'Deck', 'Morning 1', 'Μάι'],
    ]],
  ]);
  const gradesFile = writeXlsx(path.join(SAMPLES, '6_SUP01_Βαθμοί.xlsx'), [
    ['Support Morning 1', [['Α.Μ.', 'Βαθμός'], [27001, 4], [27002, '0Δ'], [27003, 0]]],
    ['Support Morning 1 Ιαν', [['Α.Μ.', 'Βαθμός'], [27004, '0Α'], [27005, 'ΑΠ']]],
    ['Re-exam', [['Α.Μ.', 'Ονοματεπώνυμο', 'Αιτία', 'Βαθμός'], [27003, 'ΓΑΜΑΣ ΓΙΩΡΓΟΣ', 'Απών', 3], [27101, 'ΚΑΠΠΑΣ ΚΩΣΤΑΣ', 'Γραπτό 0', 5]]],
  ]);
  const reexamFirst = writeXlsx(path.join(SAMPLES, '7_SUP01_reexam_first.xlsx'), [
    ['Reexam', [['Α.Μ.', 'Βαθμός'], [27001, 5]]],
    ['Βαθμολογία', [['Α.Μ.', 'Βαθμός'], [27001, 4]]],
  ]);

  // ---------------------------------------------------------------- login
  app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, GMC_REGISTRY_DATA_DIR: TMP + '/local', GMC_REGISTRY_SAVE_DIR: SAVE, GMC_REGISTRY_TEST: '1', GMC_REGISTRY_SERVER: url },
  });
  win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push('console: ' + m.text());
  });
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('.srv-dot.ok');
  await win.fill('#lg-user', 'admin');
  await win.fill('#lg-pass', 'Admin-12345');
  await win.click('#lg-go');
  await win.waitForSelector('#nav .nav-item');

  // ---------------------------------------------------------------- dashboard split (seed)
  step('dashboard: Support card split by period');
  await win.waitForSelector('.level-card[data-level="SUP"] .lc-periods');
  assert.strictEqual((await win.textContent('.level-card[data-level="SUP"] .lc-periods')).replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim(), 'Οκτ 3 · Ιαν 2');
  assert.strictEqual(await win.$$eval('.level-card[data-level="OLA"] .lc-periods', (n) => n.length), 0, 'Operational A has one period: no split');

  // ---------------------------------------------------------------- settings: «Περίοδοι»
  step('settings: add a period, tick it for Support, rename, delete refused while used');
  await nav('Ρυθμίσεις');
  await win.waitForSelector('#periods-card');
  assert.deepStrictEqual(await win.$$eval('#periods-card .per-table tbody tr input[data-f="name"]', (n) => n.map((x) => x.value)), ['Οκτώβριος', 'Ιανουάριος', 'Μάιος']);
  assert.ok((await win.textContent('#periods-card .per-table tr[data-period-row="OCT"]')).includes('4 εγγραφές'), 'usage count');
  await win.fill('#per-new-name', 'Μάρτιος');
  await win.fill('#per-new-short', 'Μάρ');
  await win.click('button[data-action="perAdd"]');
  await win.waitForSelector('#periods-card tr[data-period-row="MAR"]');
  await win.click('input[data-on-change="lpToggle"][data-level="SUP"][data-period="MAR"]');
  await win.waitForSelector('.toast:has-text("Μάρτιος")');
  await settle();
  let d = await reg();
  assert.deepStrictEqual(d.settings.periods.find((p) => p.id === 'MAR'), { id: 'MAR', name: 'Μάρτιος', short: 'Μάρ' });
  assert.deepStrictEqual(d.settings.levelPeriods.SUP, ['OCT', 'JAN', 'MAR']);
  // rename the short name (and a duplicate short name is refused with a toast)
  await win.fill('#periods-card tr[data-period-row="MAR"] input[data-f="short"]', 'Μαρ');
  await win.press('#periods-card tr[data-period-row="MAR"] input[data-f="short"]', 'Tab');
  await settle();
  await win.fill('#periods-card tr[data-period-row="MAR"] input[data-f="short"]', 'Οκτ');
  await win.press('#periods-card tr[data-period-row="MAR"] input[data-f="short"]', 'Tab');
  await win.waitForSelector('.toast.error:has-text("συντομογραφία")');
  assert.strictEqual(await win.inputValue('#periods-card tr[data-period-row="MAR"] input[data-f="short"]'), 'Μαρ', 'back to the stored short name');
  await win.click('button[data-action="perDel"][data-id="OCT"]');
  await win.waitForSelector('.toast.error:has-text("χρησιμοποιείται")');
  // an unused period is deleted after a confirmation
  await win.fill('#per-new-name', 'Ιούνιος');
  await win.click('button[data-action="perAdd"]');
  await win.waitForSelector('#periods-card tr[data-period-row="JUN"]');
  await win.click('button[data-action="perDel"][data-id="JUN"]');
  await win.click('.modal-foot button:has-text("Διαγραφή")');
  await win.waitForSelector('#periods-card tr[data-period-row="JUN"]', { state: 'detached' });
  // Operational B keeps January + May; Management has none
  assert.strictEqual(await win.isChecked('input[data-level="OLB"][data-period="MAY"]'), true);
  assert.strictEqual(await win.isChecked('input[data-level="MF1"][data-period="OCT"]'), false);
  assert.ok((await win.textContent('#periods-card .per-matrix')).includes('Management Function 1'), 'the MF levels once, by level name');
  await win.$eval('#periods-card', (el) => el.scrollIntoView());
  await shot('settings-periods');
  await settle();
  d = await reg();
  assert.strictEqual(d.settings.periods.find((p) => p.id === 'MAR').short, 'Μαρ');

  // ---------------------------------------------------------------- student import with a period column
  step('student import: «Περίοδος» column (Οκτ / Ιαν / 10 / empty / Μάι) + default period');
  await nav('Εισαγωγή');
  await win.click('.tab:has-text("Σπουδαστές")');
  await stubOpen(studentsFile);
  await win.click('.dropzone');
  await win.waitForSelector('button[data-action="tPreview"]');
  const perCol = await win.$eval('select[data-on-change="tMap"][data-k="period"]', (s) => s.options[s.selectedIndex].text);
  assert.ok(perCol.includes('Περίοδος'), 'period column auto-mapped: ' + perCol);
  await win.selectOption('select[data-k="defLevel"]', 'SUP');
  await win.waitForSelector('#t-def-per');
  assert.deepStrictEqual(await win.$$eval('#t-def-per option', (o) => o.map((x) => x.value)), ['', 'OCT', 'JAN', 'MAR'], 'default period choices follow the level');
  await win.selectOption('#t-def-per', 'JAN');
  await shot('import-students-mapping');
  await win.click('button[data-action="tPreview"]');
  await win.waitForSelector('button[data-action="tCommit"]');
  const chips = await win.textContent('.chips');
  assert.ok(/Νέοι σπουδαστές\s*5/.test(chips) && /Με προειδοποίηση\s*1/.test(chips), chips);
  const perCells = await win.$$eval('table tbody tr', (rows) => rows.map((r) => [r.children[1].textContent, r.querySelector('.per-cell').textContent]));
  assert.deepStrictEqual(perCells, [['27101', 'Οκτ'], ['27102', 'Ιαν'], ['27103', 'Ιαν'], ['27104', 'Οκτ'], ['27105', 'Χωρίς']]);
  assert.ok((await win.textContent('tr:has(td.am:has-text("27105"))')).includes('δεν ισχύει για το Support'), 'period warning shown');
  await shot('import-students-preview');
  await win.click('button[data-action="tCommit"]');
  await win.waitForSelector('text=Το μητρώο ενημερώθηκε');
  await settle();
  d = await reg();
  assert.deepStrictEqual(['27101', '27102', '27103', '27104', '27105'].map((am) => enOf(d, am, Y1).period), ['OCT', 'JAN', 'JAN', 'OCT', null]);
  assert.strictEqual(enOf(d, '27102', Y1).section, 'M2');

  // ---------------------------------------------------------------- students page
  step('students page: period filter, tag, «Χωρίς περίοδο»');
  await nav('Μητρώο');
  await win.waitForSelector('#st-table-host table');
  assert.strictEqual(await win.$$eval('#st-period', (n) => n.length), 0, 'no period filter for all levels');
  await win.selectOption('select[data-on-change="stLevel"]', 'SUP');
  await win.waitForSelector('#st-period');
  assert.deepStrictEqual(await win.$$eval('#st-period option', (o) => o.map((x) => x.value)), ['ALL', 'OCT', 'JAN', 'MAR', 'NONE']);
  await win.selectOption('#st-period', 'JAN');
  await win.waitForTimeout(150);
  let ams = await win.$$eval('#st-table-host tbody td.am', (n) => n.map((x) => x.textContent));
  assert.deepStrictEqual(ams.sort(), ['27004', '27005', '27102', '27103']);
  assert.ok((await win.$$eval('#st-table-host tbody .per-cell', (n) => n.map((x) => x.textContent))).every((t) => t === 'Ιαν'));
  await shot('students-period-filter');
  await win.selectOption('#st-period', 'NONE');
  await win.waitForTimeout(150);
  ams = await win.$$eval('#st-table-host tbody td.am', (n) => n.map((x) => x.textContent));
  assert.deepStrictEqual(ams, ['27105']);

  step('student card: change the period of an enrollment');
  await win.click('tr.clickable:has(td.am:has-text("27105"))');
  await win.waitForSelector('.modal .year-block');
  await win.click('[data-sctab="enroll"]');
  await win.waitForSelector('select[data-en-per="' + Y1 + '"]');
  await win.selectOption('select[data-en-per="' + Y1 + '"]', 'MAR');
  await win.waitForSelector('.toast:has-text("Η περίοδος ενημερώθηκε")');
  await shot('student-card-period');
  await win.click('.modal [data-mclose]');
  await settle();
  d = await reg();
  assert.strictEqual(enOf(d, '27105', Y1).period, 'MAR');

  step('bulk «Ορισμός περιόδου» on selected students');
  await win.selectOption('#st-period', 'OCT');
  await win.waitForTimeout(150);
  await win.click('input[data-on-change="stSel"][data-id="' + byAm(d, '27104').id + '"]');
  await win.waitForSelector('button[data-action="bulkPeriod"]');
  await win.click('button[data-action="bulkPeriod"]');
  await win.waitForSelector('#bp-per');
  await win.selectOption('#bp-per', 'JAN');
  await win.click('#bp-ok');
  await settle();
  d = await reg();
  assert.strictEqual(enOf(d, '27104', Y1).period, 'JAN');
  await win.click('button[data-action="clearSel"]');

  step('new student: the period select follows the level (hidden for Management)');
  await win.click('button[data-action="newStudent"]');
  await win.waitForSelector('#sf-per-field');
  await win.fill('#sf-am', '27106');
  await win.fill('#sf-ln', 'ΟΜΙΚΡΟΝ');
  await win.fill('#sf-fn', 'ΟΡΕΣΤΗΣ');
  await win.selectOption('#sf-spec', 'DECK');
  await win.selectOption('#sf-level', 'MF1');
  assert.ok(await win.$eval('#sf-per-field', (el) => el.classList.contains('hidden')), 'Management: no periods');
  await win.selectOption('#sf-level', 'OLA');
  assert.strictEqual(await win.inputValue('#sf-per'), 'OCT', 'Operational A: its only period, selected');
  assert.ok(await win.isDisabled('#sf-per'));
  await win.selectOption('#sf-level', 'SUP');
  await win.selectOption('#sf-sec', 'M1');
  await win.selectOption('#sf-per', 'MAR');
  await shot('new-student-period');
  await win.click('.modal-foot button:has-text("Αποθήκευση") >> nth=1');
  await settle();
  d = await reg();
  assert.deepStrictEqual([enOf(d, '27106', Y1).levelId, enOf(d, '27106', Y1).section, enOf(d, '27106', Y1).period], ['SUP', 'M1', 'MAR']);

  step('same Α.Μ. again into another period → "same student?" shows the periods');
  await win.click('button[data-action="newStudent"]');
  await win.fill('#sf-am', '27001');
  await win.fill('#sf-ln', 'ΑΛΦΑΣ');
  await win.fill('#sf-fn', 'ΑΝΔΡΕΑΣ');
  await win.selectOption('#sf-level', 'SUP');
  await win.selectOption('#sf-sec', 'M1');
  await win.selectOption('#sf-per', 'OCT');
  await win.click('.modal-foot button:has-text("Αποθήκευση") >> nth=1');
  await win.waitForSelector('.modal-error:has-text("ήδη εγγεγραμμένος")'); // same class and period
  await win.selectOption('#sf-per', 'JAN');
  await win.click('.modal-foot button:has-text("Αποθήκευση") >> nth=1');
  await win.waitForSelector('#same-table');
  const sameTxt = await win.textContent('#same-table');
  assert.ok(sameTxt.includes('Οκτώβριος') && sameTxt.includes('Ιανουάριος'), 'previous and next class with periods: ' + sameTxt);
  await win.click('.modal:has(#same-table) .modal-foot button:has-text("Άκυρο")');
  await win.click('.modal-foot button:has-text("Άκυρο")');
  await win.waitForSelector('.modal', { state: 'detached' });

  // ---------------------------------------------------------------- dashboard
  step('dashboard: «Οκτ · Ιαν · Μαρ» counts');
  await nav('Αρχική');
  await win.waitForSelector('.level-card[data-level="SUP"] .lc-periods');
  // OCT: 27001 27002 27003 27101 · JAN: 27004 27005 27102 27103 27104 · MAR: 27105 27106
  assert.strictEqual((await win.textContent('.level-card[data-level="SUP"] .lc-periods')).replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim(), 'Οκτ 4 · Ιαν 5 · Μαρ 2');
  await shot('dashboard');

  // ---------------------------------------------------------------- grade import: Re-exam sheet ignored
  step('grade import: several class sheets read together, "Re-exam" ignored, 0Δ / 0Α, «έχει re-exam»');
  await nav('Εισαγωγή');
  await win.click('.tab:has-text("Βαθμολογίες καθηγητών")');
  await stubOpen(gradesFile);
  await win.click('.dropzone');
  await win.waitForSelector('select[data-on-change="gMap"]');
  assert.strictEqual(await win.inputValue('select[data-on-change="imSheet"]'), '-1', 'all sheets by default');
  const sheetOpts = await win.$$eval('select[data-on-change="imSheet"] option', (o) => o.map((x) => [x.textContent, x.disabled]));
  assert.ok(sheetOpts[0][0].startsWith('Όλα τα φύλλα με Α.Μ. (2)'), JSON.stringify(sheetOpts));
  assert.ok(sheetOpts.some(([t, dis]) => t.startsWith('Re-exam') && dis), 'Re-exam listed but disabled: ' + JSON.stringify(sheetOpts));
  assert.ok(await win.isVisible('text=Δεκτοί βαθμοί: 0, 1, 2, 3, 4, 5 ή ΑΠ'), 'hint still has the old wording (e2e.js)');
  assert.ok((await win.textContent('.card-head .badge-info')).includes('0Δ / 0Α'));
  const mapped = await win.$eval('select[data-on-change="gMap"][data-col="1"]', (s) => s.options[s.selectedIndex].text);
  assert.ok(mapped.includes('SUP01'), 'mapped by file name: ' + mapped);
  await win.click('button[data-action="gPreview"]');
  await win.waitForSelector('button[data-action="gCommit"]');
  const gChips = await win.textContent('.chips');
  assert.ok(/Νέοι\s*4/.test(gChips) && /Αλλαγές\s*1/.test(gChips), gChips);
  const gRows = await win.$$eval('table tbody tr', (rows) => rows.map((r) => ({ row: r.children[0].textContent, am: r.children[1].textContent, grade: r.children[4].textContent, cur: r.children[5].textContent })));
  assert.ok(!gRows.some((r) => r.am === '27101'), 'nothing from the Re-exam sheet');
  const g = (am) => gRows.find((r) => r.am === am);
  assert.strictEqual(g('27002').grade, '0Δ');
  assert.strictEqual(g('27004').grade, '0Α');
  assert.strictEqual(g('27005').grade, 'ΑΠ');
  assert.strictEqual(g('27004').row, 'Support Morning 1 Ιαν!2', 'row numbers name their sheet');
  assert.ok(g('27003').cur.includes('ΑΠ') && g('27003').cur.includes('έχει re-exam'), 're-exam note: ' + g('27003').cur);
  await shot('import-grades-reexam');
  await win.click('button[data-action="gCommit"]');
  await win.waitForSelector('text=Η εισαγωγή ολοκληρώθηκε');
  await settle();
  d = await reg();
  const gr = (am) => d.grades.find((x) => x.studentId === byAm(d, am).id && x.subjectId === sup01.id && x.yearId === Y1);
  assert.deepStrictEqual([gr('27002').value, gr('27002').att], [0, 'J']);
  assert.deepStrictEqual([gr('27004').value, gr('27004').att], [0, 'U']);
  assert.strictEqual(gr('27001').value, 4);
  assert.ok(!gr('27101'), 'Re-exam sheet not imported');
  assert.strictEqual(gr('27003').value, 0);
  assert.strictEqual(gr('27003').re && gr('27003').re.value, 3, 'the re-exam grade is kept (0 still fails)');

  step('grade import: a file whose first sheet is "Reexam" → the other sheet is chosen');
  await win.click('button[data-action="imReset"][data-kind="grades"]');
  await stubOpen(reexamFirst);
  await win.click('.dropzone');
  await win.waitForSelector('select[data-on-change="gMap"]');
  assert.strictEqual(await win.inputValue('select[data-on-change="imSheet"]'), '1');
  await win.click('button[data-action="imReset"][data-kind="grades"]');

  // ---------------------------------------------------------------- transfer with a target period
  step('transfer: source period filter + target period');
  await nav('Μητρώο');
  await win.click('button[data-action="transferModal"]');
  await win.waitForSelector('#tr-list');
  await win.selectOption('select[data-tr="fromYearId"]', Y1);
  await win.selectOption('select[data-tr="toYearId"]', Y2);
  await win.selectOption('select[data-tr="levelId"]', 'SUP');
  await win.waitForSelector('#tr-period');
  await win.selectOption('#tr-period', 'OCT');
  await win.selectOption('select[data-tr="mode"]', 'fixed');
  await win.selectOption('select[data-tr="toLevelId"]', 'SUP');
  await win.waitForSelector('#tr-to-period');
  assert.deepStrictEqual(await win.$$eval('#tr-to-period option', (o) => o.map((x) => x.value)), ['same', 'OCT', 'JAN', 'MAR', '']);
  assert.strictEqual(await win.inputValue('#tr-to-period'), 'same', '«Ίδια περίοδος» by default');
  await win.selectOption('#tr-to-period', 'JAN');
  await win.waitForTimeout(200);
  const trRows = await win.$$eval('#tr-list tbody tr', (rows) => rows.map((r) => [r.querySelector('td.am').textContent, r.querySelector('.tr-from').dataset.period, r.querySelector('.tr-to').dataset.period]));
  assert.deepStrictEqual(trRows.map((r) => r[0]).sort(), ['27001', '27002', '27003', '27101']);
  assert.ok(trRows.every((r) => r[1] === 'OCT' && r[2] === 'JAN'), JSON.stringify(trRows));
  await shot('transfer-period');
  await win.click('#tr-go');
  await win.waitForSelector('.modal:has(#tr-list)', { state: 'detached' });
  await settle();
  d = await reg();
  ['27001', '27002', '27003', '27101'].forEach((am) => assert.deepStrictEqual([enOf(d, am, Y2).levelId, enOf(d, am, Y2).period], ['SUP', 'JAN'], am));
  assert.strictEqual(enOf(d, '27101', Y2).section, 'M1', 'same class');
  assert.ok(!enOf(d, '27004', Y2), 'January students not moved');

  // ---------------------------------------------------------------- merge with a teacher's grade
  step('sync (gradebook): the admin types grades while a teacher saves one → merged, focus and scroll kept');
  await win.click('button[data-action="go"][data-page="gradebook"], .nav-item:has-text("Βαθμολόγιο")');
  await win.waitForSelector('table.gb');
  await win.click('.tab:has-text("Support")');
  const cell = (am) => 'input[data-gsid="' + byAm(d, am).id + '"][data-gsub="' + sup01.id + '"]';
  await win.waitForSelector(cell('27001'));
  await win.click(cell('27001')); // focused: the 10 s polling leaves the page alone
  await api('POST', '/api/teacher/grades', { yearId: Y1, subjectId: sup01.id, source: 'manual', changes: [{ studentId: byAm(d, '27104').id, value: 3 }] }, tch);
  await win.keyboard.type('5');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.toast:has-text("Συγχωνεύτηκαν αλλαγές από άλλον χρήστη")');
  await settle();
  assert.strictEqual(await win.$$eval('#conflict-reload', (n) => n.length), 0, 'no conflict dialog');
  assert.ok(await win.evaluate(() => !!(document.activeElement && document.activeElement.matches('input[data-gsid]'))), 'a grade cell still has the focus after the re-render');
  if (await win.$(cell('27104'))) assert.strictEqual(await win.inputValue(cell('27104')), '3', "the teacher's grade is shown");
  d = await reg();
  const gAt = (am) => d.grades.find((x) => x.studentId === byAm(d, am).id && x.subjectId === sup01.id && x.yearId === Y1);
  assert.strictEqual(gAt('27001').value, 5, 'the admin grade is on the server');
  assert.ok(gAt('27104').value === 3 && gAt('27104').source === 'teacher', 'the teacher grade too');
  await shot('gradebook-merged');
  await win.evaluate(() => document.activeElement && document.activeElement.blur());

  step('sync: a teacher writes a grade while the admin edits → the save merges, no dialog');
  await nav('Μητρώο');
  await win.fill('#st-search', '27010');
  await win.waitForTimeout(300);
  await win.selectOption('select[data-on-change="stLevel"]', 'ALL');
  await win.waitForSelector('tr.clickable:has(td.am:has-text("27010"))');
  await win.click('tr.clickable:has(td.am:has-text("27010"))');
  await win.waitForSelector('.modal .year-block');
  await win.click('[data-sctab="info"]');
  await win.waitForSelector('#sf-ph');
  const revBefore = await win.evaluate(() => window.Remote.rev);
  const t1 = await api('POST', '/api/teacher/grades', { yearId: Y1, subjectId: sup01.id, source: 'manual', changes: [{ studentId: byAm(d, '27102').id, value: 5 }] }, tch);
  assert.strictEqual(t1.stats.added, 1);
  await win.fill('#sf-ph', '6900000001');
  await win.click('#sf-save');
  await win.waitForSelector('.toast:has-text("Συγχωνεύτηκαν αλλαγές από άλλον χρήστη")');
  await settle();
  assert.strictEqual(await win.$$eval('#conflict-reload', (n) => n.length), 0, 'no conflict dialog');
  d = await reg();
  assert.strictEqual(byAm(d, '27010').phone, '6900000001', 'the admin change is on the server');
  const tg = d.grades.find((x) => x.studentId === byAm(d, '27102').id && x.subjectId === sup01.id);
  assert.ok(tg && tg.value === 5 && tg.source === 'teacher', 'the teacher grade is still on the server');
  assert.ok((await win.evaluate(() => window.Remote.rev)) >= revBefore + 2);
  assert.ok(await win.evaluate((sid) => window.App.S.db.grades.some((x) => x.studentId === sid && x.value === 5), byAm(d, '27102').id), 'the teacher grade is in the admin copy too');

  step('sync: the same record changed on both sides → conflict dialog listing it; «Κράτηση της δικής μου»');
  const adm2 = (await api('POST', '/api/login', { username: 'admin', password: 'Admin-12345' })).token;
  let cur = await api('GET', '/api/registry', undefined, adm2);
  byAm(cur.data, '27010').phone = '111';
  cur.data.settings.levelNames = Object.assign({}, cur.data.settings.levelNames, { OLB: 'Operational B (δοκιμή)' });
  await api('PUT', '/api/registry', { baseRev: cur.rev, data: cur.data }, adm2);
  await win.fill('#sf-ph', '222');
  await win.click('#sf-save');
  await win.waitForSelector('#conflict-reload');
  const cText = await win.textContent('.merge-conflicts');
  assert.ok(cText.includes('Στοιχεία σπουδαστή') && cText.includes('27010'), 'conflict listed: ' + cText);
  assert.ok(!cText.includes('επιπέδων'), 'the other change merged, not listed: ' + cText);
  await shot('conflict-dialog');
  await win.click('#conflict-mine');
  await win.waitForSelector('#conflict-reload', { state: 'detached' });
  await settle();
  d = await reg();
  assert.strictEqual(byAm(d, '27010').phone, '222', 'mine kept for the conflicting record');
  assert.strictEqual(d.settings.levelNames.OLB, 'Operational B (δοκιμή)', 'the other side kept for the rest');

  step('sync: conflict → «Φόρτωση νέας έκδοσης» keeps the server version');
  cur = await api('GET', '/api/registry', undefined, adm2);
  byAm(cur.data, '27010').phone = '333';
  await api('PUT', '/api/registry', { baseRev: cur.rev, data: cur.data }, adm2);
  await win.fill('#sf-ph', '444');
  await win.click('#sf-save');
  await win.waitForSelector('#conflict-reload');
  await win.click('#conflict-reload');
  await win.waitForSelector('#conflict-reload', { state: 'detached' });
  await settle();
  d = await reg();
  assert.strictEqual(byAm(d, '27010').phone, '333');
  assert.strictEqual(await win.evaluate((id) => window.App.S.db.students.find((s) => s.id === id).phone, byAm(d, '27010').id), '333');
  await win.keyboard.press('Escape');
  await win.waitForSelector('.modal', { state: 'detached' });

  step('sync: polling (10 s) brings a teacher grade in while the admin is idle');
  await win.fill('#st-search', '');
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await api('POST', '/api/teacher/grades', { yearId: Y1, subjectId: sup01.id, source: 'manual', changes: [{ studentId: byAm(d, '27103').id, value: 2 }] }, tch);
  await win.waitForFunction((sid) => window.App.S.db.grades.some((x) => x.studentId === sid && x.value === 2), byAm(d, '27103').id, { timeout: 16000 });
  await win.waitForSelector('.toast:has-text("Τα δεδομένα ενημερώθηκαν")');

  await app.close();
  await server.stop();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('PERIODS E2E OK');
})().catch(async (e) => {
  console.error('PERIODS E2E FAILED:', e.message);
  console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  try {
    await win.screenshot({ path: path.join(SHOTS, 'per-99-failure.png') });
  } catch (e2) {}
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  try {
    await app.close();
  } catch (e3) {}
  try {
    await server.stop();
  } catch (e4) {}
  process.exit(1);
});
