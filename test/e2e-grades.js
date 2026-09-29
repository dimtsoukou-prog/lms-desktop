/*
 * Gradebook + Excel outputs (v2.2) in the real app (run under xvfb):
 * period filter in the gradebook, typing 0Δ / 0Α, Re-exam mode (grade.re on the server, the original
 * kept, the result uses the final grade), «R» badge in the normal mode, per-subject export (class sheets
 * per period + «Re-exam» sheet), teacher template (list validation with the codes + «Re-exam» sheet),
 * transcript picker with period classes, export page period filter, student template «Περίοδος».
 *
 *   GMC_SERVER_BIN=/home/claude/stable-bin/gmc-registry-server xvfb-run -a node test/e2e-grades.js
 */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e-grades';
const SAVE = TMP + '/out';
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
  if (!r.ok) throw new Error(u + ': ' + JSON.stringify(data));
  return data;
}

async function launch() {
  app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    // own profile folder: other E2E runs on this machine do not collide with the single-instance lock
    args: ['--no-sandbox', '--user-data-dir=' + TMP + '/profile', ROOT],
    env: { ...process.env, GMC_REGISTRY_DATA_DIR: TMP + '/local', GMC_REGISTRY_SAVE_DIR: SAVE, GMC_REGISTRY_TEST: '1', GMC_REGISTRY_SERVER: url },
  });
  win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push('console: ' + m.text());
  });
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('.srv-dot.ok');
}

const step = (m) => console.log('• ' + m);
const text = (sel) => win.textContent(sel);
const shot = async (name) => {
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(SHOTS, name + '.png') });
};

async function settle() {
  await win.waitForTimeout(700); // debounce + network save
  await win.waitForFunction(() => !document.querySelector('#save-status.saving'), null, { timeout: 10000 });
}

function newest(prefix) {
  const list = fs.readdirSync(SAVE).filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'));
  list.sort((a, b) => fs.statSync(path.join(SAVE, b)).mtimeMs - fs.statSync(path.join(SAVE, a)).mtimeMs);
  return list[0];
}

/** Wait for a new saved file with that prefix (the save toast) and return its path. */
async function saved(prefix) {
  await win.waitForSelector('.toast:has-text("' + prefix + '")');
  const f = newest(prefix);
  assert.ok(f, 'saved file ' + prefix);
  const p = path.join(SAVE, f);
  await win.evaluate(() => document.querySelectorAll('#toast-root .toast').forEach((t) => t.remove()));
  return p;
}

const rowsOf = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
/** Data rows after the header row that has `first` in column `col`. */
function tableRows(wb, name, col, first) {
  const rows = rowsOf(wb, name);
  const h = rows.findIndex((r) => r && r[col] === first);
  assert.ok(h >= 0, 'header row in ' + name);
  const out = [];
  for (let i = h + 1; i < rows.length && rows[i] && rows[i][0] !== null && typeof rows[i][0] === 'number'; i++) out.push(rows[i]);
  return out;
}
const noteOf = (wb, sheet, addr) => {
  const c = wb.Sheets[sheet][addr];
  return c && c.c ? c.c.map((x) => x.t).join('\n') : '';
};

function registry() {
  return server.registry();
}
const gradeOf = (db, sid, subId) => db.grades.find((g) => g.studentId === sid && g.subjectId === subId && g.yearId === db.settings.currentYearId) || null;

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP + '/local', { recursive: true });
  fs.mkdirSync(SAVE, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  server = await startServer();
  url = server.url;

  // ---------------------------------------------------------------- seed
  const adm = (await api('POST', '/api/setup', { username: 'admin', password: 'Admin-12345' })).token;
  const reg = C.createEmptyDb(new Date());
  const y = reg.settings.currentYearId;
  const mk = (am, ln, fn, sp, lv, sec, per) => {
    const s = C.createStudent(reg, { am, lastName: ln, firstName: fn, specialty: sp });
    C.setEnrollment(reg, s.id, y, lv, sec, per);
    return s;
  };
  // Support: October and January intakes (+ one without a period); Operational A (single period)
  const S1 = mk('26001', 'ΑΛΕΞΙΟΥ', 'ΑΝΝΑ', 'DECK', 'SUP', 'M1', 'OCT');
  const S2 = mk('26002', 'ΒΑΣΙΛΕΙΟΥ', 'ΒΑΣΙΛΗΣ', 'ENGINE', 'SUP', 'M1', 'JAN');
  const S3 = mk('26003', 'ΓΕΩΡΓΙΟΥ', 'ΓΙΩΡΓΟΣ', 'DECK', 'SUP', 'M2', 'OCT');
  const S4 = mk('26004', 'ΔΗΜΟΥ', 'ΔΗΜΗΤΡΑ', 'ENGINE', 'SUP', 'M2', 'JAN');
  const S5 = mk('26005', 'ΕΥΑΓΓΕΛΟΥ', 'ΕΛΕΝΗ', 'DECK', 'SUP', 'M1', null);
  const S6 = mk('26006', 'ΖΑΦΕΙΡΙΟΥ', 'ΖΩΗ', 'DECK', 'SUP', 'M2', 'JAN');
  const O1 = mk('26101', 'ΗΛΙΟΠΟΥΛΟΣ', 'ΗΛΙΑΣ', 'DECK', 'OLA', 'MO');
  const O2 = mk('26102', 'ΘΕΟΔΩΡΟΥ', 'ΘΑΝΟΣ', 'DECK', 'OLA', 'AF');
  assert.strictEqual(C.getEnrollment(reg, O1.id, y).period, 'OCT', 'Operational A gets its only period');
  assert.strictEqual(C.getEnrollment(reg, S5.id, y).period, null);
  const SUP01 = C.createSubject(reg, { levelId: 'SUP', code: 'SUP01', name: 'Βασική Ασφάλεια' });
  const SUP02 = C.createSubject(reg, { levelId: 'SUP', code: 'SUP02', name: 'Πρώτες Βοήθειες' });
  const NAV = C.createSubject(reg, { levelId: 'OLA', code: 'NAV101', name: 'Ναυσιπλοΐα', specialty: 'DECK' });
  const ENGL = C.createSubject(reg, { levelId: 'OLA', code: 'ENGL', name: 'Ναυτικά Αγγλικά', specialty: 'COMMON' });
  const g = (st, sj, v, x) => C.setGrade(reg, st.id, sj.id, y, Object.assign({ value: v, absent: false, source: 'import' }, x || {}));
  g(S1, SUP01, 0, { att: 'U' }); // 0Α
  g(S2, SUP01, 0, { att: 'J' }); // 0Δ
  g(S3, SUP01, null, { absent: true }); // ΑΠ
  g(S4, SUP01, 0); // written 0
  g(S5, SUP01, 4);
  g(S6, SUP01, 5);
  g(S1, SUP02, 3);
  g(S2, SUP02, 2);
  g(S3, SUP02, 5);
  g(S4, SUP02, 4);
  g(S6, SUP02, 5);
  g(O1, NAV, 4);
  g(O2, NAV, 0);
  g(O1, ENGL, 5);
  g(O2, ENGL, 3);
  await api('PUT', '/api/registry', { baseRev: 0, data: reg }, adm);

  // ---------------------------------------------------------------- login
  step('admin logs in');
  await launch();
  await win.fill('#lg-user', 'admin');
  await win.fill('#lg-pass', 'Admin-12345');
  await win.click('#lg-go');
  await win.waitForSelector('#nav .nav-item');

  // ---------------------------------------------------------------- gradebook: period filter
  step('gradebook: period filter (Support has October + January; «Χωρίς περίοδο» because 26005 has none)');
  await win.click('.nav-item:has-text("Βαθμολόγιο")');
  await win.waitForSelector('table.gb');
  await win.click('.tab[data-level="SUP"]');
  await win.waitForSelector('#gb-period');
  const perOpts = await win.$$eval('#gb-period option', (o) => o.map((x) => x.value + '=' + x.textContent));
  assert.deepStrictEqual(perOpts, ['ALL=Όλες οι περίοδοι', 'OCT=Οκτώβριος', 'JAN=Ιανουάριος', 'NONE=Χωρίς περίοδο']);
  const sids = () => win.$$eval('table.gb tbody tr', (t) => t.map((x) => x.dataset.sid));
  assert.deepStrictEqual(await sids(), [S1.id, S3.id, S2.id, S6.id, S4.id, S5.id], 'order: period (October, January, none), class, specialty');
  const tags = await win.$$eval('table.gb tbody .badge-per', (t) => t.map((x) => x.textContent));
  assert.deepStrictEqual(tags, ['Οκτ', 'Οκτ', 'Ιαν', 'Ιαν', 'Ιαν', 'χωρίς περίοδο'], 'period tag next to the class');
  assert.strictEqual(await win.inputValue('input[data-gsid="' + S1.id + '"][data-gsub="' + SUP01.id + '"]'), '0Α');
  assert.strictEqual(await win.inputValue('input[data-gsid="' + S2.id + '"][data-gsub="' + SUP01.id + '"]'), '0Δ');
  const cls1 = await win.getAttribute('td:has(> input[data-gsid="' + S1.id + '"][data-gsub="' + SUP01.id + '"])', 'class');
  assert.ok(/\bfail\b/.test(cls1) && /\batt\b/.test(cls1), 'a code is a failing grade: ' + cls1);
  await shot('60-gradebook-periods');
  await win.selectOption('#gb-period', 'OCT');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 2);
  assert.deepStrictEqual(await sids(), [S1.id, S3.id]);
  assert.ok((await text('#gb-host .card-head h3')).includes('Οκτώβριος'), 'title names the period');
  assert.strictEqual(await win.$$eval('table.gb tbody .badge-per', (t) => t.length), 0, 'no tag when one period is shown');
  await win.selectOption('#gb-period', 'JAN');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 3);
  assert.deepStrictEqual(await sids(), [S2.id, S6.id, S4.id]);
  await win.selectOption('#gb-period', 'NONE');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 1);
  assert.deepStrictEqual(await sids(), [S5.id]);
  assert.ok((await text('#gb-host .card-head h3')).includes('χωρίς περίοδο'));
  await win.selectOption('#gb-period', 'ALL');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 6);
  // Operational A has a single period → no filter
  await win.click('.tab[data-level="OLA"]');
  await win.waitForSelector('table.gb');
  assert.strictEqual(await win.$('#gb-period'), null, 'no period filter for a single-period level');
  await shot('65-gradebook-ola-toolbar');
  await win.click('.tab[data-level="SUP"]');
  await win.waitForSelector('#gb-period');

  // ---------------------------------------------------------------- gradebook: 0Δ / 0Α
  step('gradebook: typing 0Δ (Greek, lower case) and 0A (Latin) — stored as att J / U, shown as 0Δ / 0Α');
  const cell = (sid, sub, re) => 'input[data-gsid="' + sid + '"][data-gsub="' + sub + '"]' + (re ? '[data-re]' : ':not([data-re])');
  await win.click(cell(S5.id, SUP02.id));
  await win.keyboard.type('0δ');
  await win.keyboard.press('Enter');
  await win.waitForFunction((s) => document.querySelector(s).value === '0Δ', cell(S5.id, SUP02.id));
  await win.click(cell(S4.id, SUP02.id));
  await win.keyboard.type('0a');
  await win.keyboard.press('Enter');
  await win.waitForFunction((s) => document.querySelector(s).value === '0Α', cell(S4.id, SUP02.id));
  const cls5 = await win.getAttribute('td:has(> ' + cell(S5.id, SUP02.id) + ')', 'class');
  assert.ok(/\bfail\b/.test(cls5) && /\batt\b/.test(cls5), 'red like 0 / ΑΠ: ' + cls5);
  assert.ok((await text('tr[data-sid="' + S5.id + '"] td.res')).includes('Υπολείπεται'), '0Δ fails the subject');
  // a wrong value: the error lists the codes
  await win.click(cell(S6.id, SUP02.id));
  await win.keyboard.type('7');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.toast.error:has-text("0Δ")');
  assert.strictEqual(await win.inputValue(cell(S6.id, SUP02.id)), '5', 'the old value is back');
  await win.evaluate(() => document.querySelectorAll('#toast-root .toast').forEach((t) => t.remove()));
  await settle();
  let d = registry();
  let gr = gradeOf(d, S5.id, SUP02.id);
  assert.deepStrictEqual([gr.value, gr.absent, gr.att, gr.source], [0, false, 'J', 'manual'], '0Δ on the server');
  gr = gradeOf(d, S4.id, SUP02.id);
  assert.deepStrictEqual([gr.value, gr.absent, gr.att], [0, false, 'U'], '0Α on the server');
  assert.strictEqual(gradeOf(d, S6.id, SUP02.id).value, 5);

  // ---------------------------------------------------------------- re-exam mode
  step('Re-exam mode: only students with ΑΠ / 0 / 0Δ / 0Α; original small, input for the re-exam grade');
  await win.click('#gb-mode button[data-v="reexam"]');
  await win.waitForSelector('table.gb.gb-re');
  assert.strictEqual((await text('#gb-re-count')).trim(), '5 σπουδαστές για re-exam');
  assert.deepStrictEqual(await sids(), [S1.id, S3.id, S2.id, S4.id, S5.id], '26006 (all passed) is not listed');
  assert.strictEqual(await text('td:has(> ' + cell(S1.id, SUP01.id, true) + ') .re-orig'), '0Α');
  assert.strictEqual(await text('td:has(> ' + cell(S3.id, SUP01.id, true) + ') .re-orig'), 'ΑΠ');
  assert.strictEqual(await text('td:has(> ' + cell(S4.id, SUP01.id, true) + ') .re-orig'), '0');
  assert.strictEqual(await win.inputValue(cell(S1.id, SUP01.id, true)), '');
  // passed subject: read-only final grade
  const ro = await win.$$eval('tr[data-sid="' + S1.id + '"] td.g.ro', (t) => t.map((x) => x.textContent + '|' + x.querySelectorAll('input').length));
  assert.deepStrictEqual(ro, ['3|0'], 'SUP02 = 3 is read-only');
  assert.ok((await text('#gb-re-done')).includes('0 / 6'));
  // type the re-exam grade: Enter goes to the next student of the column
  await win.click(cell(S1.id, SUP01.id, true));
  await win.keyboard.type('3');
  await win.keyboard.press('Enter');
  await win.waitForFunction((sid) => document.activeElement && document.activeElement.dataset.gsid === sid && document.activeElement.dataset.re === '1', S3.id);
  await win.keyboard.type('0α');
  await win.keyboard.press('Enter');
  await win.waitForFunction((sid) => document.activeElement && document.activeElement.dataset.gsid === sid, S2.id);
  await win.keyboard.type('9'); // out of the scale
  await win.keyboard.press('Enter');
  await win.waitForSelector('.toast.error:has-text("re-exam")');
  assert.strictEqual(await win.inputValue(cell(S2.id, SUP01.id, true)), '');
  await win.evaluate(() => document.querySelectorAll('#toast-root .toast').forEach((t) => t.remove()));
  // arrow right from S4 SUP01 → S4 SUP02 (the next editable cell of the row)
  await win.click(cell(S4.id, SUP01.id, true));
  await win.keyboard.type('2');
  await win.keyboard.press('ArrowRight');
  await win.waitForFunction((sub) => document.activeElement && document.activeElement.dataset.gsub === sub, SUP02.id);
  await win.keyboard.type('ΑΠ');
  await win.keyboard.press('Tab');
  await win.waitForTimeout(200);
  assert.strictEqual(await win.inputValue(cell(S1.id, SUP01.id, true)), '3');
  assert.strictEqual(await win.inputValue(cell(S3.id, SUP01.id, true)), '0Α');
  const c1 = await win.getAttribute('td:has(> ' + cell(S1.id, SUP01.id, true) + ')', 'class');
  assert.ok(/re-pass/.test(c1), 'passing re-exam cell: ' + c1);
  assert.ok((await text('tr[data-sid="' + S1.id + '"] td.res')).includes('Επιτυχία'), 'the result uses the final grade');
  assert.ok((await text('tr[data-sid="' + S3.id + '"] td.res')).includes('Υπολείπεται'));
  assert.ok((await text('#gb-re-done')).includes('4 / 6'), await text('#gb-re-done'));
  await shot('61-gradebook-reexam');
  await settle();
  d = registry();
  gr = gradeOf(d, S1.id, SUP01.id);
  assert.deepStrictEqual([gr.value, gr.absent, gr.att], [0, false, 'U'], 'the original stays 0Α');
  assert.deepStrictEqual([gr.re.value, gr.re.absent, gr.re.by], [3, false, 'admin'], 'grade.re on the server');
  assert.ok(gr.re.at, 're.at');
  gr = gradeOf(d, S3.id, SUP01.id);
  assert.ok(gr.absent && gr.re && gr.re.value === 0 && gr.re.att === 'U', 'ΑΠ → re-exam 0Α');
  assert.ok(!gradeOf(d, S2.id, SUP01.id).re, 'invalid value not stored');
  assert.deepStrictEqual([gradeOf(d, S4.id, SUP01.id).re.value, gradeOf(d, S4.id, SUP02.id).re.absent], [2, true]);
  const st1 = d.students.find((s) => s.id === S1.id);
  assert.strictEqual(C.studentResult(d, st1, y, 'SUP').status, 'pass', 'core: 26001 passes with the re-exam');
  // clear a re-exam grade: empty cell = remove
  await win.click(cell(S3.id, SUP01.id, true));
  await win.keyboard.press('Delete');
  await win.keyboard.press('Enter');
  await win.waitForFunction((s) => document.querySelector(s).value === '', cell(S3.id, SUP01.id, true));
  await settle();
  d = registry();
  gr = gradeOf(d, S3.id, SUP01.id);
  assert.ok(gr && gr.absent && !gr.re, 're-exam removed, the original ΑΠ kept');
  // re-exam mode keeps the period filter
  await win.selectOption('#gb-period', 'OCT');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 2);
  assert.strictEqual((await text('#gb-re-count')).trim(), '2 σπουδαστές για re-exam');
  await win.selectOption('#gb-period', 'ALL');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 5);

  // ---------------------------------------------------------------- normal mode: R badge
  step('normal mode: original grade + badge «R3», tooltip, legend line');
  await win.click('#gb-mode button[data-v="normal"]');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 6);
  assert.strictEqual(await win.inputValue(cell(S1.id, SUP01.id)), '0Α', 'the original is shown');
  const td1 = 'td:has(> ' + cell(S1.id, SUP01.id) + ')';
  assert.strictEqual(await text(td1 + ' .re-badge'), 'R3');
  assert.ok((await win.getAttribute(td1 + ' .re-badge', 'class')).includes('ok'));
  assert.ok((await win.getAttribute(td1, 'title')).startsWith('Αρχικός: 0Α · Re-exam: 3'), await win.getAttribute(td1, 'title'));
  assert.strictEqual(await text('td:has(> ' + cell(S4.id, SUP02.id) + ') .re-badge'), 'RΑΠ');
  assert.ok((await text('tr[data-sid="' + S1.id + '"] td.res')).includes('Επιτυχία'));
  const legend = (await text('#gb-codes')).replace(/\s+/g, ' ').trim();
  assert.strictEqual(legend, 'ΑΠ = απών · 0Δ = 0 λόγω δικαιολογημένων απουσιών · 0Α = 0 λόγω αδικαιολόγητων απουσιών · R = βαθμός re-exam');
  await shot('62-gradebook-re-badge');
  // the original is changed to a passing grade → the re-exam grade goes away
  await win.click(cell(S4.id, SUP01.id));
  await win.keyboard.type('1');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.toast:has-text("re-exam διαγράφηκε")');
  assert.strictEqual(await win.$$eval('td:has(> ' + cell(S4.id, SUP01.id) + ') .re-badge', (b) => b.length), 0);
  await win.evaluate(() => document.querySelectorAll('#toast-root .toast').forEach((t) => t.remove()));
  await settle();
  d = registry();
  gr = gradeOf(d, S4.id, SUP01.id);
  assert.ok(gr.value === 1 && !gr.re, 'setGrade removed re');

  // ---------------------------------------------------------------- gradebook export with a period
  step('gradebook «Εξαγωγή Excel» with the January filter');
  await win.selectOption('#gb-period', 'JAN');
  await win.waitForFunction(() => document.querySelectorAll('table.gb tbody tr').length === 3);
  await win.click('button[data-action="gbExport"]');
  let f = await saved('Συνολική_Βαθμολογία_');
  assert.ok(/_Support_Ιαν\.xlsx$/.test(f), f);
  let wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Σύνοψη', 'Support Ιαν']);
  let tr = tableRows(wb, 'Support Ιαν', 0, 'Α/Α');
  assert.deepStrictEqual(tr.map((r) => r[1]), [26002, 26006, 26004]);
  assert.deepStrictEqual(tr.map((r) => r.slice(5, 7)), [['0Δ', 2], [5, 5], [1, 'ΑΠ']], 'codes as text, 0–5 as numbers; S4 SUP02 = re-exam ΑΠ');
  assert.ok(noteOf(wb, 'Support Ιαν', 'G' + (rowsOf(wb, 'Support Ιαν').findIndex((r) => r && r[1] === 26004) + 1)).includes('Re-exam — αρχικός βαθμός: 0Α'));
  await win.selectOption('#gb-period', 'ALL');

  // ---------------------------------------------------------------- per-subject export
  step('per-subject export (gradebook header button): a sheet per class incl. period + «Re-exam»');
  await win.click('th button.subj-export[data-id="' + SUP01.id + '"]');
  f = await saved('Βαθμολογία_SUP01');
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Support Morning 1 Οκτ', 'Support Morning 2 Οκτ', 'Support Morning 1 Ιαν', 'Support Morning 2 Ιαν', 'Support Morning 1', 'Re-exam']);
  assert.ok(String(rowsOf(wb, 'Support Morning 1 Ιαν')[2][0]).includes('Support Morning 1 – Ιανουάριος'), 'class title with the period');
  assert.deepStrictEqual(tableRows(wb, 'Support Morning 1 Οκτ', 1, 'Α.Μ.').map((r) => [r[1], r[2]]), [[26001, 3]], 'final grade (re-exam)');
  const r26001 = rowsOf(wb, 'Support Morning 1 Οκτ').findIndex((r) => r && r[1] === 26001) + 1;
  assert.strictEqual(noteOf(wb, 'Support Morning 1 Οκτ', 'C' + r26001), 'Re-exam — αρχικός βαθμός: 0Α');
  assert.deepStrictEqual(tableRows(wb, 'Support Morning 2 Ιαν', 1, 'Α.Μ.').map((r) => [r[1], r[2]]), [[26004, 1], [26006, 5]]);
  assert.deepStrictEqual(tableRows(wb, 'Support Morning 1 Ιαν', 1, 'Α.Μ.').map((r) => [r[1], r[2]]), [[26002, '0Δ']]);
  let re = tableRows(wb, 'Re-exam', 1, 'Τμήμα');
  assert.deepStrictEqual(rowsOf(wb, 'Re-exam').find((r) => r && r[1] === 'Τμήμα'), ['Α/Α', 'Τμήμα', 'Α.Μ.', 'Βαθμός', 'Αιτία', 'Re-exam']);
  assert.deepStrictEqual(re, [
    [1, 'Support Morning 1 – Οκτώβριος', 26001, '0Α', '0 – αδικαιολόγητες απουσίες', 3],
    [2, 'Support Morning 2 – Οκτώβριος', 26003, 'ΑΠ', 'Απών', null],
    [3, 'Support Morning 1 – Ιανουάριος', 26002, '0Δ', '0 – δικαιολογημένες απουσίες', null],
  ]);
  // Operational A: nobody failed ENGL → the sheet exists with a one-line note
  await win.click('.tab[data-level="OLA"]');
  await win.waitForSelector('th button.subj-export[data-id="' + ENGL.id + '"]');
  await win.click('th button.subj-export[data-id="' + ENGL.id + '"]');
  f = await saved('Βαθμολογία_ENGL');
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['OL A Deck Morning', 'OL A Deck Afternoon', 'Re-exam'], 'single period → names without it');
  assert.ok(rowsOf(wb, 'Re-exam').some((r) => r && String(r[0]).startsWith('Κανένας σπουδαστής δεν χρειάζεται re-exam')));
  assert.ok(!rowsOf(wb, 'Re-exam').some((r) => r && r[1] === 'Τμήμα'), 'no table');

  // ---------------------------------------------------------------- teacher template
  step('teacher template: list validation 0–5, ΑΠ, 0Δ, 0Α + «Re-exam» sheet; classes with periods');
  await win.click('.tab[data-level="SUP"]');
  await win.waitForSelector('#gb-period');
  await win.click('button[data-action="gbTemplates"]');
  await win.waitForSelector('#tt-subj');
  await win.selectOption('#tt-level', 'SUP');
  await win.selectOption('#tt-subj', SUP01.id);
  const tcls = await win.$$eval('#tt-class option', (o) => o.map((x) => x.textContent));
  assert.ok(tcls.includes('Support Morning 1 – Οκτώβριος (1)') && tcls.includes('Support Morning 2 – Ιανουάριος (2)'), tcls.join(' | '));
  assert.ok((await text('#tt-info')).includes('Re-exam'), await text('#tt-info'));
  await win.check('#tt-names');
  await win.check('#tt-prefill');
  await win.click('.modal-foot button:has-text("Δημιουργία Excel")');
  f = await saved('Βαθμολόγιο_SUP01');
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Βαθμολογίες', 'Οδηγίες', 'Re-exam']);
  const tg = rowsOf(wb, 'Βαθμολογίες');
  assert.deepStrictEqual(tg[0], ['Α.Μ.', 'Επώνυμο', 'Όνομα', 'Βαθμός']);
  const pre = new Map(tg.slice(1).map((r) => [r[0], r[3]]));
  assert.deepStrictEqual([pre.get(26001), pre.get(26002), pre.get(26003), pre.get(26004), pre.get(26005)], ['0Α', '0Δ', 'ΑΠ', 1, 4], 'prefill: the original grades, codes as text');
  assert.ok(rowsOf(wb, 'Οδηγίες').some((r) => r && String(r[1]).includes('0Δ = 0 λόγω δικαιολογημένων απουσιών')), 'instructions mention the codes');
  re = tableRows(wb, 'Re-exam', 1, 'Τμήμα');
  assert.deepStrictEqual(rowsOf(wb, 'Re-exam').find((r) => r && r[1] === 'Τμήμα'), ['Α/Α', 'Τμήμα', 'Α.Μ.', 'Επώνυμο', 'Όνομα', 'Βαθμός', 'Αιτία', 'Re-exam']);
  assert.deepStrictEqual(re.map((r) => [r[2], r[3], r[5], r[6], r[7]]), [
    [26001, 'ΑΛΕΞΙΟΥ', '0Α', '0 – αδικαιολόγητες απουσίες', 3],
    [26003, 'ΓΕΩΡΓΙΟΥ', 'ΑΠ', 'Απών', null],
    [26002, 'ΒΑΣΙΛΕΙΟΥ', '0Δ', '0 – δικαιολογημένες απουσίες', null],
  ]);
  const xw = new ExcelJS.Workbook();
  await xw.xlsx.readFile(f);
  const dv = xw.getWorksheet('Βαθμολογίες').getCell('D2').dataValidation;
  assert.strictEqual(dv.type, 'list', 'list validation');
  assert.strictEqual(dv.formulae[0], '"0,1,2,3,4,5,ΑΠ,0Δ,0Α"');
  assert.ok(dv.error.includes('0Δ') && dv.error.includes('0Α'));
  assert.ok(C.parseGradeCell('0Δ').att === 'J' && C.parseGradeCell('0Α').att === 'U', 'the listed codes parse on import');

  // ---------------------------------------------------------------- export page
  step('export page: period filter for Support (not for Operational A); overall export per class and period');
  await win.click('.nav-item:has-text("Εξαγωγή")');
  await win.waitForSelector('button[data-action="exGrades"]');
  assert.strictEqual(await win.$('#ex-period'), null, 'all levels → no period filter');
  await win.selectOption('select[data-k="level"]', 'OLA');
  await win.waitForTimeout(150);
  assert.strictEqual(await win.$('#ex-period'), null, 'Operational A → no period filter');
  await win.selectOption('select[data-k="level"]', 'SUP');
  await win.waitForSelector('#ex-period');
  assert.deepStrictEqual(await win.$$eval('#ex-period option', (o) => o.map((x) => x.value)), ['ALL', 'OCT', 'JAN', 'NONE']);
  await win.selectOption('#ex-period', 'OCT');
  await win.waitForTimeout(150);
  assert.ok((await text('.page .card')).includes('1 φύλλο') && (await text('.page .card')).includes('2 σπουδαστές'), 'preview counts follow the period');
  await win.click('button[data-action="exGrades"]');
  f = await saved('Συνολική_Βαθμολογία_');
  assert.ok(/_Support_Οκτ\.xlsx$/.test(f), f);
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Σύνοψη', 'Support Οκτ']);
  tr = tableRows(wb, 'Support Οκτ', 0, 'Α/Α');
  assert.deepStrictEqual(tr.map((r) => [r[1], r[5], r[6]]), [[26001, 3, 3], [26003, 'ΑΠ', 5]], 'final grades');
  await win.selectOption('#ex-period', 'ALL');
  await win.check('input[data-k="splitSections"]');
  await win.waitForTimeout(150);
  assert.ok((await text('.page .card')).includes('Ένα φύλλο για κάθε τμήμα και περίοδο'));
  await win.click('button[data-action="exGrades"]');
  f = await saved('Συνολική_Βαθμολογία_');
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Σύνοψη', 'Support Morning 1 Οκτ', 'Support Morning 2 Οκτ', 'Support Morning 1 Ιαν', 'Support Morning 2 Ιαν', 'Support Morning 1 - χωρίς περ.']);
  assert.ok(rowsOf(wb, 'Σύνοψη').some((r) => r && r[0] === 'Support Morning 2 – Ιανουάριος' && r[2] === 2));
  await win.uncheck('input[data-k="splitSections"]');
  await win.waitForTimeout(150);
  await win.click('button[data-action="exGrades"]');
  f = await saved('Συνολική_Βαθμολογία_');
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Σύνοψη', 'Support']);
  const sh = rowsOf(wb, 'Support').find((r) => r && r[0] === 'Α/Α');
  assert.deepStrictEqual(sh.slice(4, 6), ['Τμήμα', 'Περίοδος'], 'a «Περίοδος» column when every period is on one sheet');
  assert.ok(tableRows(wb, 'Support', 0, 'Α/Α').some((r) => r[1] === 26005 && r[5] === '—'));
  await shot('63-export-period');

  step('export page: per-subject export of one class (class key incl. period)');
  await win.selectOption('select[data-k="sLevel"]', 'SUP');
  await win.waitForTimeout(100);
  await win.selectOption('select[data-k="sSubject"]', SUP01.id);
  await win.waitForTimeout(100);
  const sOpts = await win.$$eval('#ex-sclass option', (o) => o.map((x) => x.value + '=' + x.textContent));
  assert.ok(sOpts.includes('SUP||M1|JAN=Support Morning 1 – Ιανουάριος') && sOpts.includes('SUP||M1|OCT=Support Morning 1 – Οκτώβριος'), sOpts.join(' | '));
  assert.ok((await text('.ex-re-chip')).includes('3'), 'Re-exam chip');
  await win.selectOption('#ex-sclass', 'SUP||M1|JAN');
  await win.waitForTimeout(100);
  assert.ok((await text('.ex-re-chip')).includes('1'));
  await win.click('button[data-action="exSubject"]');
  f = await saved('Βαθμολογία_SUP01_Support_Morning_1_–_Ιανουάριος');
  wb = XLSX.readFile(f);
  assert.deepStrictEqual(wb.SheetNames, ['Support Morning 1 Ιαν', 'Re-exam']);
  assert.deepStrictEqual(tableRows(wb, 'Re-exam', 1, 'Τμήμα').map((r) => r[2]), [26002]);

  step('student template has a «Περίοδος» column');
  await win.click('button[data-action="dlStudentTemplate"]');
  f = await saved('Πρότυπο_σπουδαστών');
  wb = XLSX.readFile(f);
  const st = rowsOf(wb, 'Σπουδαστές');
  assert.deepStrictEqual(st[0], ['Α.Μ.', 'Επώνυμο', 'Όνομα', 'Πατρώνυμο', 'Ειδικότητα', 'Επίπεδο', 'Τμήμα', 'Περίοδος', 'Email', 'Τηλέφωνο']);
  assert.strictEqual(st[1][7], 'Οκτώβριος');
  assert.strictEqual(C.guessColumnRole('Περίοδος'), 'period');

  // ---------------------------------------------------------------- transcripts
  step('transcript picker: classes with periods; a January student is found in his class');
  await win.evaluate((id) => window.App.transcriptsModal({ studentIds: [id] }), S2.id);
  await win.waitForSelector('#tt-cls');
  const keys = await win.$$eval('#tt-cls option', (o) => o.map((x) => x.value));
  ['SUP||M1|OCT', 'SUP||M2|OCT', 'SUP||M1|JAN', 'SUP||M2|JAN', 'SUP||M1', 'OLA|DECK|MO', 'OLA|DECK|AF'].forEach((k) => assert.ok(keys.includes(k), k + ' in ' + keys.join(' ')));
  assert.strictEqual(await win.inputValue('#tt-cls'), 'SUP||M1|JAN', 'the student’s own class (with its period)');
  assert.strictEqual(await win.inputValue('#tt-student'), S2.id);
  assert.ok((await text('#tt-cls option[value="SUP||M1|JAN"]')).startsWith('Support Morning 1 – Ιανουάριος'));
  await shot('64-transcript-periods');
  await win.click('#tt-go');
  f = await saved('Αναλυτική_26002_');
  assert.ok(/_Support_Ιαν_\d{4}-\d{4}\.xlsx$/.test(f), 'file name with the period: ' + f);
  wb = XLSX.readFile(f);
  let rows = rowsOf(wb, wb.SheetNames[0]);
  let h = rows.findIndex((r) => r && r[0] === 'Α.Μ.' && r[1] === 'Ονοματεπώνυμο');
  assert.deepStrictEqual(rows[h + 1].slice(0, 4), [26002, 'ΒΑΣΙΛΕΙΟΥ ΒΑΣΙΛΗΣ', '0Δ', 2]);
  assert.ok(rows.some((r) => r && String(r[0]).startsWith('Support Morning 1 – Ιανουάριος')), 'class with the period');
  // the re-exam grade counts in the transcript (note with the original)
  await win.evaluate((id) => window.App.transcriptsModal({ studentIds: [id] }), S1.id);
  await win.waitForSelector('#tt-cls');
  assert.strictEqual(await win.inputValue('#tt-cls'), 'SUP||M1|OCT');
  await win.click('#tt-go');
  f = await saved('Αναλυτική_26001_');
  wb = XLSX.readFile(f);
  rows = rowsOf(wb, wb.SheetNames[0]);
  h = rows.findIndex((r) => r && r[0] === 'Α.Μ.' && r[1] === 'Ονοματεπώνυμο');
  assert.deepStrictEqual(rows[h + 1].slice(0, 5), [26001, 'ΑΛΕΞΙΟΥ ΑΝΝΑ', 3, 3, 3]);
  assert.strictEqual(rows[h + 1][5], 'Επιτυχία');
  assert.strictEqual(noteOf(wb, wb.SheetNames[0], 'C' + (h + 2)), 'Re-exam — αρχικός βαθμός: 0Α');

  await app.close();
  await server.stop();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('GRADES E2E OK');
})().catch(async (e) => {
  console.error('GRADES E2E FAILED:', e.message);
  console.error(e.stack.split('\n').slice(1, 5).join('\n'));
  try {
    await win.screenshot({ path: path.join(SHOTS, '99-grades-failure.png') });
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
