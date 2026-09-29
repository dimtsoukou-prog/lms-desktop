/*
 * Teachers end to end in the real app (one .exe for everyone), against a real server — run under xvfb:
 *
 *   GMC_SERVER_BIN=/home/claude/stable-bin/gmc-registry-server xvfb-run -a node test/e2e-teacher.js
 *
 * admin: creates two teachers (Accounts → Καθηγητές), assigns teacher 1 from the Subjects page (class + period OCT)
 * and teacher 2 to the same subject/class from the Accounts modal (both modals show the same data), uploads a
 * syllabus PDF from the Subjects page and views it · teacher 1: sees only the OCT students of his class, types
 * grades (0Δ / 0Α / ΑΠ), relogin when the session expires (the grade is not lost), Excel upload (the "Re-exam"
 * sheet is ignored), syllabus view / upload / delete, password change · teacher 2 grades the same subject ·
 * admin: gradebook + import history show the teachers' work, enters a re-exam grade · teacher 1: re-exam →
 * disabled input + note, 409 handled, import preview skips it, a re-exam set meanwhile shows up by polling ·
 * admin locks the subject → teacher sees the lock and disabled inputs.
 */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const XLSX = require('xlsx');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e-teacher';
const SAVE = TMP + '/out';
const FILES = TMP + '/files';
const SHOTS = path.join(__dirname, 'shots');
const ADMIN = 'admin';
const ADMIN_PW = 'Admin-12345';
const T1 = { username: 'papas', name: 'Γιώργος Παπάς', password: 'Teach-2026' };
const T2 = { username: 'nikou', name: 'Ελένη Νίκου', password: 'Teach-2027' };
const T1_NEW_PW = 'Teach-New-2026';

let app, win, server, url;
const errors = [];

/** A small valid one-page PDF. */
function tinyPdf(text) {
  const content = 'BT /F1 28 Tf 72 760 Td (' + text + ') Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += i + 1 + ' 0 obj\n' + o + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

async function api(method, u, body, token) {
  const r = await fetch(url + u, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  return { status: r.status, data };
}
async function apiOk(method, u, body, token) {
  const r = await api(method, u, body, token);
  if (r.status >= 300) throw new Error(method + ' ' + u + ' → ' + r.status + ' ' + JSON.stringify(r.data));
  return r.data;
}

async function launch() {
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
}

async function login(u, p) {
  await win.waitForSelector('#lg-user');
  await win.waitForSelector('.srv-dot.ok');
  await win.fill('#lg-user', u);
  await win.fill('#lg-pass', p);
  await win.click('#lg-go');
}

/** The next file dialog of the app returns this file. */
async function stubOpen(file) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
}

async function shot(name) {
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function until(fn, what, ms) {
  const end = Date.now() + (ms || 10000);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout: ' + what);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function settle() {
  await win.waitForTimeout(700);
  await win.waitForFunction(() => !document.querySelector('#save-status.saving'), null, { timeout: 10000 });
}

async function nav(label) {
  await win.click('.nav-item:has-text("' + label + '")');
  await win.waitForTimeout(150);
}

async function closeModal() {
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('.modal-backdrop'));
}

async function logoutAdmin() {
  await win.click('button[data-action="logout"]');
  await win.waitForSelector('#lg-form');
}
async function logoutTeacher() {
  await win.click('#tp-logout');
  await win.waitForSelector('#lg-form');
  assert.ok(await win.evaluate(() => document.body.classList.contains('mode-login')), 'back on the login screen');
  assert.strictEqual(await win.evaluate(() => document.getElementById('teacher-root').innerHTML), '', 'nothing of the teacher stays on screen');
}

const text = (sel) => win.textContent(sel);
const step = (m) => console.log('• ' + m);
const gradeOf = (reg, sid, subj) => (reg.grades || []).find((g) => g.studentId === sid && g.subjectId === subj && g.yearId === reg.settings.currentYearId) || null;
const inputSel = (sid) => 'input[data-tsid="' + sid + '"]';

/** Type a grade in the teacher portal and press Enter. */
async function typeGrade(sid, value) {
  await win.fill(inputSel(sid), value);
  await win.press(inputSel(sid), 'Enter');
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  [TMP + '/local', SAVE, FILES].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  fs.mkdirSync(SHOTS, { recursive: true });
  server = await startServer();
  url = server.url;

  // ---------------------------------------------------------------- seed: admin + registry
  const adm = (await apiOk('POST', '/api/setup', { username: ADMIN, password: ADMIN_PW })).token;
  const reg = C.createEmptyDb(new Date());
  const yearId = reg.settings.currentYearId;
  const mk = (am, last, first, spec, level, section, period) => {
    const s = C.createStudent(reg, { am, lastName: last, firstName: first, specialty: spec || undefined });
    C.setEnrollment(reg, s.id, yearId, level, section, period);
    return s;
  };
  // Support Morning 1: five in October, two in January; one October student in Morning 2
  const s1 = mk('40001', 'ΑΛΕΞΙΟΥ', 'ΑΝΝΑ', null, 'SUP', 'M1', 'OCT');
  const s2 = mk('40002', 'ΒΑΣΙΛΕΙΟΥ', 'ΒΑΣΙΛΗΣ', null, 'SUP', 'M1', 'OCT');
  const s3 = mk('40003', 'ΓΕΩΡΓΙΟΥ', 'ΓΙΑΝΝΗΣ', null, 'SUP', 'M1', 'OCT');
  const s4 = mk('40004', 'ΔΗΜΟΥ', 'ΔΗΜΗΤΡΑ', null, 'SUP', 'M1', 'OCT');
  const s5 = mk('40005', 'ΕΥΑΓΓΕΛΟΥ', 'ΕΛΕΝΗ', null, 'SUP', 'M1', 'OCT');
  const s6 = mk('40006', 'ΖΑΦΕΙΡΙΟΥ', 'ΖΩΗ', null, 'SUP', 'M2', 'OCT');
  const j1 = mk('40007', 'ΗΛΙΟΠΟΥΛΟΣ', 'ΗΛΙΑΣ', null, 'SUP', 'M1', 'JAN');
  const j2 = mk('40008', 'ΘΕΟΔΩΡΟΥ', 'ΘΕΟΝΗ', null, 'SUP', 'M1', 'JAN');
  const d1 = mk('50001', 'ΙΩΑΝΝΟΥ', 'ΙΑΣΟΝΑΣ', 'DECK', 'OLA', 'MO');
  mk('50002', 'ΚΩΣΤΑΣ', 'ΚΩΝΣΤΑΝΤΙΝΟΣ', 'ENGINE', 'OLA', 'MO');
  const navSj = C.createSubject(reg, { levelId: 'SUP', code: 'NAV101', name: 'Βασική Ναυσιπλοΐα' });
  C.createSubject(reg, { levelId: 'SUP', code: 'SAF101', name: 'Ατομική Ασφάλεια' });
  const olaNav = C.createSubject(reg, { levelId: 'OLA', code: 'NAV201', name: 'Ναυσιπλοΐα Ι', specialty: 'DECK' });
  C.createSubject(reg, { levelId: 'OLA', code: 'ENG201', name: 'Ναυτικές Μηχανές', specialty: 'ENGINE' });
  C.createSubject(reg, { levelId: 'OLA', code: 'MEN201', name: 'Ναυτικά Αγγλικά', specialty: 'COMMON' });
  await apiOk('PUT', '/api/registry', { baseRev: 0, data: reg }, adm);

  // files for the pickers
  const pdfA = tinyPdf('NAV101 - Chapter 1');
  const pdfAName = 'Ναυσιπλοΐα – Κεφάλαιο 1.pdf';
  fs.writeFileSync(path.join(FILES, pdfAName), pdfA);
  const pdfB = tinyPdf('NAV101 - Exercises');
  fs.writeFileSync(path.join(FILES, 'Ασκήσεις.pdf'), pdfB);
  fs.writeFileSync(path.join(FILES, 'Προσωρινό.pdf'), tinyPdf('temp'));
  fs.writeFileSync(path.join(FILES, 'fake.pdf'), 'hello, I am not a PDF');
  const big = Buffer.alloc(50 * 1024 * 1024 + 10, 0x20);
  pdfA.copy(big, 0);
  fs.writeFileSync(path.join(FILES, 'huge.pdf'), big);

  // ================================================================ admin
  step('admin: two teachers created in Accounts → Καθηγητές');
  await launch();
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await nav('Λογαριασμοί');
  await win.waitForSelector('.seg button[data-v="teachers"]');
  // the student list: classes of different periods stay separate
  const clsOpts = await win.$$eval('select[data-on-change="acClass"] option', (o) => o.map((x) => x.textContent));
  assert.ok(clsOpts.some((t) => t.startsWith('Support Morning 1 – Οκτώβριος (5)')), 'OCT class: ' + clsOpts.join(' | '));
  assert.ok(clsOpts.some((t) => t.startsWith('Support Morning 1 – Ιανουάριος (2)')), 'JAN class: ' + clsOpts.join(' | '));
  assert.ok(clsOpts.some((t) => t.startsWith('Operational Level A Deck Morning (1)')), 'OLA class name without its only period: ' + clsOpts.join(' | '));
  const rowClass = await text('tr:has-text("40007") td:nth-child(4)');
  assert.strictEqual(rowClass.trim(), 'Support Morning 1 – Ιανουάριος');
  await win.click('#ac-tab-teachers');
  for (const t of [T1, T2]) {
    await win.click('#ac-new-teacher');
    await win.fill('#nt-user', t.username);
    await win.fill('#nt-name', t.name);
    await win.fill('#nt-pass', t.password);
    await win.click('#nt-go');
    await win.waitForSelector('.modal-head h2:has-text("Μαθήματα καθηγητή: ' + t.name + '")'); // the assignment dialog opens by itself
    await closeModal();
  }
  let users = await apiOk('GET', '/api/users', undefined, adm);
  const u1 = users.find((u) => u.username === T1.username);
  const u2 = users.find((u) => u.username === T2.username);
  assert.ok(u1 && u2 && u1.role === 'teacher' && u2.role === 'teacher');

  step('Subjects page: «Καθηγητές» column, teacher 1 assigned from the subject side (Morning 1 + October)');
  await nav('Μαθήματα');
  const navRow = 'tr:has(td.mono:text-is("NAV101"))';
  await win.waitForSelector(navRow + ' .sb-tadd');
  assert.ok((await win.$$eval('.sb-table thead th', (h) => h.map((x) => x.textContent))).some((t) => t.startsWith('Καθηγητές')));
  await win.click(navRow + ' [data-action="sbTeachers"]');
  await win.waitForSelector('.modal-head h2:has-text("Καθηγητές μαθήματος: NAV101")');
  assert.ok((await text('.modal-body')).includes('Δεν έχει ανατεθεί σε κανέναν καθηγητή'));
  await win.click('#st-add');
  await win.selectOption('select[data-st="uid"][data-i="0"]', String(u1.id));
  const stCls = await win.$$eval('select[data-st="cls"][data-i="0"] option', (o) => o.map((x) => x.value + '=' + x.textContent));
  assert.ok(stCls.includes('|M1=Support Morning 1 (7)'), 'class options with the number of students: ' + stCls.join(' | '));
  await win.selectOption('select[data-st="cls"][data-i="0"]', '|M1');
  const stPer = await win.$$eval('select[data-st="period"][data-i="0"] option', (o) => o.map((x) => x.value + '=' + x.textContent));
  assert.deepStrictEqual(stPer, ['=Όλες οι περίοδοι (7)', 'OCT=Οκτώβριος (5)', 'JAN=Ιανουάριος (2)']);
  await win.selectOption('select[data-st="period"][data-i="0"]', 'OCT');
  assert.ok((await win.$$eval('select[data-st="cls"][data-i="0"] option', (o) => o.map((x) => x.textContent))).includes('Support Morning 1 (5)'), 'class counts follow the period');
  await shot('60-subject-teachers-modal');
  await win.click('#st-save');
  await win.waitForFunction(() => !document.querySelector('.modal-backdrop'));
  users = await apiOk('GET', '/api/users', undefined, adm);
  const a1 = users.find((u) => u.id === u1.id).assignments;
  assert.deepStrictEqual(a1, [{ yearId, subjectId: navSj.id, spec: '', section: 'M1', period: 'OCT', label: 'Support Morning 1 – Οκτώβριος' }]);
  await win.waitForSelector(navRow + ' .sb-teacher:has-text("' + T1.name + '")');
  const tip = await win.getAttribute(navRow + ' .sb-teacher', 'title');
  assert.ok(tip.includes('Support Morning 1 – Οκτώβριος') && tip.includes(T1.username), 'tooltip: classes/periods: ' + tip);

  step('Accounts modal: teacher 2 → same subject/class/period; OLA subject has no period select');
  await nav('Λογαριασμοί');
  await win.click('#ac-tab-teachers');
  await win.waitForSelector('tr:has-text("' + T1.username + '") td.small:has-text("NAV101 – Βασική Ναυσιπλοΐα — Support Morning 1 – Οκτώβριος")');
  await win.click('[data-action="acTeacherAssign"][data-uid="' + u2.id + '"]');
  await win.waitForSelector('#ta-add');
  await win.click('#ta-add');
  await win.selectOption('select[data-ta="subject"][data-i="0"]', navSj.id);
  await win.selectOption('select[data-ta="cls"][data-i="0"]', '|M1');
  await win.selectOption('select[data-ta="period"][data-i="0"]', 'OCT');
  await win.click('#ta-add');
  await win.selectOption('select[data-ta="subject"][data-i="1"]', olaNav.id);
  assert.strictEqual(await win.$$eval('select[data-ta="period"][data-i="1"]', (x) => x.length), 0, 'no period select for a level with one period');
  assert.strictEqual(await win.$$eval('.ta-grid .ta-noperiod', (x) => x.length), 1);
  await shot('61-accounts-assign-modal');
  await win.click('[data-ta-del="1"]');
  await win.click('#ta-save');
  await win.waitForFunction(() => !document.querySelector('.modal-backdrop'));
  users = await apiOk('GET', '/api/users', undefined, adm);
  assert.deepStrictEqual(users.find((u) => u.id === u2.id).assignments, [{ yearId, subjectId: navSj.id, spec: '', section: 'M1', period: 'OCT', label: 'Support Morning 1 – Οκτώβριος' }]);
  await win.waitForSelector('tr:has-text("' + T2.username + '") td.small:has-text("Support Morning 1 – Οκτώβριος")');
  await shot('62-accounts-teachers');

  step('both dialogs show the same data');
  await win.click('[data-action="acTeacherAssign"][data-uid="' + u1.id + '"]');
  await win.waitForSelector('select[data-ta="subject"][data-i="0"]');
  assert.deepStrictEqual(
    await win.evaluate(() => ['subject', 'cls', 'period'].map((k) => document.querySelector('select[data-ta="' + k + '"][data-i="0"]').value)),
    [navSj.id, '|M1', 'OCT']
  );
  assert.strictEqual(await win.$$eval('select[data-ta="subject"]', (x) => x.length), 1);
  await closeModal();
  await nav('Μαθήματα');
  await win.waitForSelector(navRow + ' .sb-teacher:has-text("' + T2.name + '")');
  await win.click(navRow + ' [data-action="sbTeachers"]');
  await win.waitForSelector('select[data-st="uid"][data-i="1"]');
  const stRows = await win.evaluate(() =>
    [0, 1].map((i) => ['uid', 'cls', 'period'].map((k) => document.querySelector('select[data-st="' + k + '"][data-i="' + i + '"]').value).join(' '))
  );
  assert.deepStrictEqual(stRows.sort(), [u1.id + ' |M1 OCT', u2.id + ' |M1 OCT'].sort());
  await win.click('.modal-foot button:has-text("Άκυρο")');
  await win.waitForFunction(() => !document.querySelector('.modal-backdrop'));

  step('Subjects page: «Ύλη» — upload (PDF checks), list, view');
  assert.strictEqual((await text(navRow + ' .sb-syl .sb-count')).trim(), '0');
  await win.click(navRow + ' [data-action="sbSyllabus"]');
  await win.waitForSelector('.modal-head h2:has-text("Ύλη: NAV101")');
  await win.waitForSelector('.syl-empty:has-text("Δεν έχει ανέβει ακόμη ύλη")');
  await stubOpen(path.join(FILES, 'fake.pdf'));
  await win.click('#syl-upload');
  await win.waitForSelector('.modal-error:not(.hidden):has-text("δεν είναι PDF")');
  await stubOpen(path.join(FILES, 'huge.pdf'));
  await win.click('#syl-upload');
  await win.waitForSelector('.modal-error:not(.hidden):has-text("πολύ μεγάλο")');
  await stubOpen(path.join(FILES, pdfAName));
  await win.click('#syl-upload');
  await win.waitForSelector('.syl-row:has-text("' + pdfAName + '")');
  assert.ok(await win.isHidden('.modal-error'), 'the old error is gone');
  const meta = await text('.syl-row .syl-meta');
  assert.ok(/^\d+ (B|KB) · \d\d\/\d\d\/\d{4} \d\d:\d\d · .+ \(γραμματεία\)$/.test(meta.trim()), 'size · date · uploader: ' + meta);
  await win.waitForSelector(navRow + ' .sb-syl .sb-count:text-is("1")');
  await shot('63-subject-syllabus-modal');
  await win.click('.syl-row [data-syl="view"]');
  await win.waitForSelector('.modal.pdfv iframe.pdfv-frame');
  assert.strictEqual((await text('.modal.pdfv .modal-head h2')).trim(), 'Ναυσιπλοΐα – Κεφάλαιο 1');
  assert.ok((await text('.modal.pdfv .modal-head .sub')).includes('NAV101'));
  assert.strictEqual((await text('#pdfv-close')).trim(), 'Κλείσιμο', 'Greek viewer');
  await win.click('#pdfv-close');
  await win.waitForSelector('.modal.pdfv', { state: 'detached' });
  await win.click('.modal-foot button:has-text("Κλείσιμο")');
  await win.waitForFunction(() => !document.querySelector('.modal-backdrop'));
  let files = (await apiOk('GET', '/api/syllabus?subjectId=' + navSj.id, undefined, adm)).files;
  assert.strictEqual(files.length, 1);
  assert.ok(Buffer.from(await (await fetch(url + '/api/syllabus/files/' + files[0].id, { headers: { Authorization: 'Bearer ' + adm } })).arrayBuffer()).equals(pdfA));
  await shot('64-subjects-page');
  await logoutAdmin();

  // ================================================================ teacher 1
  step('teacher 1: portal with only the October students of Morning 1');
  await login(T1.username, T1.password);
  await win.waitForSelector('.tp-item');
  assert.ok(await win.evaluate(() => document.body.classList.contains('mode-teacher')));
  assert.strictEqual((await text('.tp-item .tp-item-s')).trim(), 'Support Morning 1 – Οκτώβριος');
  assert.ok((await text('.tp-main .card-head .sub')).includes('Support Morning 1 – Οκτώβριος'));
  const ams = await win.$$eval('.tp-table tbody td.am', (t) => t.map((x) => x.textContent));
  assert.deepStrictEqual(ams, ['40001', '40002', '40003', '40004', '40005'], 'only his class and period: ' + ams.join(','));
  await win.waitForSelector('#tp-sy .syl-row:has-text("' + pdfAName + '")'); // the syllabus the admin uploaded

  step('typing grades: 4, 0Δ, 0α (→ 0Α), invalid 3,5 refused');
  await typeGrade(s1.id, '4');
  await typeGrade(s2.id, '0Δ');
  await typeGrade(s3.id, '0α');
  await until(async () => {
    const r = server.registry();
    return gradeOf(r, s1.id, navSj.id) && gradeOf(r, s2.id, navSj.id) && gradeOf(r, s3.id, navSj.id);
  }, 'three grades on the server');
  let R = server.registry();
  assert.deepStrictEqual([gradeOf(R, s1.id, navSj.id).value, gradeOf(R, s1.id, navSj.id).absent, gradeOf(R, s1.id, navSj.id).att], [4, false, undefined]);
  assert.deepStrictEqual([gradeOf(R, s2.id, navSj.id).value, gradeOf(R, s2.id, navSj.id).att, gradeOf(R, s2.id, navSj.id).by, gradeOf(R, s2.id, navSj.id).source], [0, 'J', T1.username, 'teacher']);
  assert.deepStrictEqual([gradeOf(R, s3.id, navSj.id).value, gradeOf(R, s3.id, navSj.id).att], [0, 'U']);
  await win.waitForFunction((sel) => document.querySelector(sel).value === '0Α', inputSel(s3.id));
  assert.strictEqual(await win.inputValue(inputSel(s2.id)), '0Δ');
  assert.ok(await win.$eval(inputSel(s2.id), (i) => i.classList.contains('fail')), '0Δ is failing (red)');
  assert.ok(await win.$eval(inputSel(s3.id), (i) => i.classList.contains('fail')), '0Α is failing (red)');
  assert.ok(!(await win.$eval(inputSel(s1.id), (i) => i.classList.contains('fail'))));
  assert.strictEqual(await win.getAttribute(inputSel(s2.id), 'title'), '0 – δικαιολογημένες απουσίες');
  assert.ok((await text('tr[data-sid="' + s3.id + '"] .tp-note')).includes('αδικαιολόγητες απουσίες'));
  await typeGrade(s5.id, '3,5');
  await win.waitForSelector('.toast.error:has-text("Μη έγκυρος βαθμός")');
  assert.strictEqual(await win.inputValue(inputSel(s5.id)), '');

  step('session expired while typing → re-login dialog, the grade (ΑΠ) is saved afterwards');
  await win.evaluate(() => (window.Remote.token = 'expired-session'));
  await typeGrade(s4.id, 'ΑΠ');
  await win.waitForSelector('.modal-head h2:has-text("Η σύνδεση έληξε")');
  await win.fill('#rl-pass', T1.password);
  await win.click('#rl-go');
  await until(() => {
    const g = gradeOf(server.registry(), s4.id, navSj.id);
    return g && g.absent;
  }, 'ΑΠ after re-login');
  await win.waitForFunction((sel) => document.querySelector(sel).value === 'ΑΠ' && document.querySelector(sel).classList.contains('fail'), inputSel(s4.id));
  assert.ok(await win.isVisible('.tp-item'), 'still in the portal');
  await shot('65-teacher-portal');

  step('Excel upload: the "Re-exam" sheet (first in the file) is ignored');
  const wbx = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet([['Α.Μ.', 'Ονοματεπώνυμο', 'Αιτία', 'Βαθμός re-exam'], ['40001', 'ΑΛΕΞΙΟΥ ΑΝΝΑ', 'Γραπτό 0', 5], ['40005', 'ΕΥΑΓΓΕΛΟΥ ΕΛΕΝΗ', 'Απών', 5]]), 'Re-exam');
  XLSX.utils.book_append_sheet(
    wbx,
    XLSX.utils.aoa_to_sheet([
      ['Α.Μ.', 'Επώνυμο', 'Όνομα', 'Βαθμός'],
      ['40001', 'ΑΛΕΞΙΟΥ', 'ΑΝΝΑ', 3],
      ['40002', 'ΒΑΣΙΛΕΙΟΥ', 'ΒΑΣΙΛΗΣ', '0Δ'],
      ['40004', 'ΔΗΜΟΥ', 'ΔΗΜΗΤΡΑ', 'απ'],
      ['40005', 'ΕΥΑΓΓΕΛΟΥ', 'ΕΛΕΝΗ', '0A'],
      ['40007', 'ΗΛΙΟΠΟΥΛΟΣ', 'ΗΛΙΑΣ', 2],
      ['99999', 'ΑΓΝΩΣΤΟΣ', 'Χ', 4],
    ]),
    'Βαθμολογία'
  );
  const xlsx1 = path.join(FILES, 'NAV101_Οκτώβριος.xlsx');
  XLSX.writeFile(wbx, xlsx1);
  await stubOpen(xlsx1);
  await win.click('#tp-import');
  await win.waitForSelector('#tp-commit');
  const prev = await text('.modal-body');
  assert.ok(prev.includes('Φύλλο: Βαθμολογία'), 'the grades sheet was chosen: ' + prev);
  // (a January student is not even sent to the teacher: unknown, like a wrong Α.Μ.)
  assert.strictEqual(await win.$$eval('.modal-body td.danger-text', (t) => t.filter((x) => x.textContent.startsWith('Άγνωστος Α.Μ.')).length), 2, prev);
  assert.ok(!prev.includes('re-exam'), 'nothing has a re-exam yet');
  assert.strictEqual((await text('#tp-commit')).trim(), 'Καταχώριση 4 βαθμών');
  await shot('66-teacher-import-preview');
  await win.click('#tp-commit');
  await win.waitForSelector('.toast:has-text("Καταχωρίστηκαν")');
  R = server.registry();
  assert.strictEqual(gradeOf(R, s1.id, navSj.id).value, 3, 'from the grades sheet, not the Re-exam one');
  assert.deepStrictEqual([gradeOf(R, s5.id, navSj.id).value, gradeOf(R, s5.id, navSj.id).att, gradeOf(R, s5.id, navSj.id).source], [0, 'U', 'import']);
  assert.ok(!gradeOf(R, j1.id, navSj.id), 'no grade for a January student');
  const imp = R.imports.find((i) => i.by === T1.username);
  assert.ok(imp && imp.fileName === 'NAV101_Οκτώβριος.xlsx' && imp.byRole === 'teacher', 'import record');
  assert.strictEqual(await win.inputValue(inputSel(s5.id)), '0Α');

  step('syllabus in the portal: view, upload, delete');
  await win.click('#tp-sy .syl-row [data-syl="view"]');
  await win.waitForSelector('.modal.pdfv iframe.pdfv-frame');
  assert.strictEqual((await text('#pdfv-save')).trim(), 'Αποθήκευση αντιγράφου');
  await win.click('#pdfv-close');
  await win.waitForSelector('.modal.pdfv', { state: 'detached' });
  await stubOpen(path.join(FILES, 'fake.pdf'));
  await win.click('#tp-sy-upload');
  await win.waitForSelector('.toast.error:has-text("δεν είναι PDF")');
  await stubOpen(path.join(FILES, 'Ασκήσεις.pdf'));
  await win.click('#tp-sy-upload');
  await win.waitForSelector('#tp-sy .syl-row:has-text("Ασκήσεις.pdf")');
  assert.ok((await text('#tp-sy .syl-row:has-text("Ασκήσεις.pdf") .syl-meta')).includes(T1.name + ' (καθηγητής)'));
  await stubOpen(path.join(FILES, 'Προσωρινό.pdf'));
  await win.click('#tp-sy-upload');
  await win.waitForSelector('#tp-sy .syl-row:has-text("Προσωρινό.pdf")');
  assert.strictEqual((await text('#tp-sy .tp-sy-n')).trim(), '3');
  await win.click('#tp-sy .syl-row:has-text("Προσωρινό.pdf") [data-syl="del"]');
  await win.click('.modal-foot .btn-danger:has-text("Διαγραφή")');
  await win.waitForSelector('#tp-sy .syl-row:has-text("Προσωρινό.pdf")', { state: 'detached' });
  files = (await apiOk('GET', '/api/syllabus?subjectId=' + navSj.id, undefined, adm)).files;
  assert.deepStrictEqual(files.map((f) => f.name), [pdfAName, 'Ασκήσεις.pdf']);
  await shot('67-teacher-portal-syllabus');

  step('password change (teacher)');
  await win.click('#tp-password');
  await win.waitForSelector('.modal-head h2:has-text("Αλλαγή κωδικού")');
  await win.fill('#pw-cur', T1.password);
  await win.fill('#pw-new', T1_NEW_PW);
  await win.fill('#pw-new2', T1_NEW_PW);
  await win.click('#pw-save');
  await win.waitForSelector('.toast:has-text("Ο κωδικός άλλαξε")');
  await logoutTeacher();

  // ================================================================ teacher 2
  step('teacher 2: same subject and class, sees and changes the grades');
  await login(T2.username, T2.password);
  await win.waitForSelector('.tp-table');
  assert.deepStrictEqual(await win.$$eval('.tp-table tbody td.am', (t) => t.map((x) => x.textContent)), ['40001', '40002', '40003', '40004', '40005']);
  assert.strictEqual(await win.inputValue(inputSel(s3.id)), '0Α');
  assert.ok((await text('tr[data-sid="' + s3.id + '"] .tp-note')).includes(T1.username), 'who wrote it');
  await typeGrade(s3.id, '2');
  await until(() => {
    const g = gradeOf(server.registry(), s3.id, navSj.id);
    return g && g.value === 2 && !g.att && g.by === T2.username;
  }, 'teacher 2 grade');
  await logoutTeacher();

  // ================================================================ admin
  step('admin: gradebook and import history show the teachers\' grades; a re-exam grade for 0Δ');
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await win.evaluate(() => window.App.go('gradebook', () => window.App.pages.gradebook.setLevel('SUP')));
  await win.waitForSelector('input[data-gsid][data-gsub="' + navSj.id + '"]');
  const gb = await win.evaluate((subj) => {
    const out = {};
    document.querySelectorAll('input[data-gsub="' + subj + '"]').forEach((i) => (out[i.dataset.gsid] = i.value));
    return out;
  }, navSj.id);
  assert.strictEqual(gb[s1.id], '3');
  assert.strictEqual(gb[s2.id], '0Δ');
  assert.strictEqual(gb[s3.id], '2');
  assert.strictEqual(gb[s4.id], 'ΑΠ');
  assert.strictEqual(gb[s5.id], '0Α');
  await shot('68-admin-gradebook');
  await win.evaluate(() => window.App.go('import', () => window.App.pages.import.setTab('history')));
  await win.waitForSelector('td:has-text("NAV101_Οκτώβριος.xlsx")');
  assert.ok((await text('td:has-text("NAV101_Οκτώβριος.xlsx")')).includes('από ' + T1.name + ' (καθηγητής)'));
  // the re-exam grade is entered by the admin (gradebook → Re-exam): same data path as the gradebook
  await win.evaluate(
    ({ sid, subj }) => window.App.mutate((d) => window.Core.setReexam(d, sid, subj, window.App.S.yearId, { value: 2, absent: false }, 'admin')),
    { sid: s2.id, subj: navSj.id }
  );
  await settle();
  assert.strictEqual(gradeOf(server.registry(), s2.id, navSj.id).re.value, 2);
  await logoutAdmin();

  // ================================================================ teacher 1 again
  step('teacher 1 (new password): re-exam → input disabled with a note; 409 handled; import skips it');
  await login(T1.username, T1.password);
  await win.waitForSelector('#lg-error:not(.hidden)'); // the old password no longer works
  await login(T1.username, T1_NEW_PW);
  await win.waitForSelector('.tp-table');
  assert.ok(await win.isDisabled(inputSel(s2.id)), 're-exam → disabled');
  assert.strictEqual(await win.inputValue(inputSel(s2.id)), '0Δ', 'the original stays');
  const reNote = (await text('tr[data-sid="' + s2.id + '"] .tp-note')).trim();
  assert.strictEqual(reNote, 'Re-exam: 2 (από τη γραμματεία)');
  assert.ok(!(await win.isDisabled(inputSel(s1.id))));
  // a stale screen (the input still enabled) → 409 from the server → message and the input is disabled again
  await win.evaluate((sel) => document.querySelector(sel).removeAttribute('disabled'), inputSel(s2.id));
  await typeGrade(s2.id, '3');
  await win.waitForSelector('.toast.error:has-text("re-exam")');
  await win.waitForFunction((sel) => document.querySelector(sel) && document.querySelector(sel).disabled && document.querySelector(sel).value === '0Δ', inputSel(s2.id));
  assert.strictEqual(gradeOf(server.registry(), s2.id, navSj.id).value, 0);
  // the import preview marks it and does not send it
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['Α.Μ.', 'Βαθμός'], ['40001', 4], ['40002', 5]]), 'Φύλλο1');
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['Α.Μ.', 'Αιτία', 'Re-exam'], ['40002', '0 – δικαιολογημένες απουσίες', 2]]), 'RE-EXAM');
  const xlsx2 = path.join(FILES, 'NAV101_διόρθωση.xlsx');
  XLSX.writeFile(wb2, xlsx2);
  await stubOpen(xlsx2);
  await win.click('#tp-import');
  await win.waitForSelector('#tp-commit');
  const prev2 = await text('.modal-body');
  assert.ok(prev2.includes('έχει re-exam — δεν αλλάζει') && prev2.includes('40002'), prev2);
  assert.strictEqual((await text('#tp-commit')).trim(), 'Καταχώριση 1 βαθμού');
  await shot('69-teacher-import-reexam');
  const sent = [];
  win.on('request', (r) => r.url().endsWith('/api/teacher/grades') && sent.push(JSON.parse(r.postData())));
  await win.click('#tp-commit');
  await win.waitForSelector('.toast:has-text("Καταχωρίστηκαν")');
  assert.deepStrictEqual(sent[0].changes.map((c) => c.studentId), [s1.id], 'the re-exam student is not sent');
  R = server.registry();
  assert.strictEqual(gradeOf(R, s1.id, navSj.id).value, 4);
  assert.deepStrictEqual([gradeOf(R, s2.id, navSj.id).value, gradeOf(R, s2.id, navSj.id).re.value], [0, 2]);

  step('a re-exam grade entered meanwhile (another PC) shows up by itself (poll every 10 s)');
  {
    const cur = await apiOk('GET', '/api/registry', undefined, adm);
    const d = C.normalizeDb(cur.data);
    C.setReexam(d, s4.id, navSj.id, yearId, { value: 3, absent: false }, ADMIN);
    await apiOk('PUT', '/api/registry', { baseRev: cur.rev, data: d }, adm);
  }
  await win.waitForFunction((sel) => document.querySelector(sel) && document.querySelector(sel).disabled, inputSel(s4.id), { timeout: 15000 });
  assert.strictEqual((await text('tr[data-sid="' + s4.id + '"] .tp-note')).trim(), 'Re-exam: 3 (από τη γραμματεία)');
  await shot('70-teacher-reexam');
  await logoutTeacher();

  // ================================================================ admin locks
  step('admin locks the subject (Subjects page)');
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await nav('Μαθήματα');
  await win.waitForSelector(navRow + ' .sb-teacher');
  assert.strictEqual((await text(navRow + ' .sb-syl .sb-count')).trim(), '2', 'the teacher\'s upload is counted');
  await win.click(navRow + ' [data-action="sbLock"]');
  await win.click('.modal-foot .btn-primary:has-text("Κλείδωμα")');
  await settle();
  await win.waitForSelector(navRow + ' .btn-lock.on');
  assert.ok(C.gradeLock(server.registry(), yearId, navSj.id), 'lock stored on the server');
  await logoutAdmin();

  step('teacher 1: lock callout, every input and the import disabled');
  await login(T1.username, T1_NEW_PW);
  await win.waitForSelector('.tp-table');
  await win.waitForSelector('.callout.warn:has-text("κλείδωσε")');
  assert.ok(await win.evaluate(() => Array.from(document.querySelectorAll('input[data-tsid]')).every((i) => i.disabled)), 'all inputs disabled');
  assert.ok(await win.isDisabled('#tp-import'));
  assert.ok(await win.isVisible('.tp-item svg'), 'lock icon in the list');
  const locked = await api('POST', '/api/teacher/grades', { yearId, subjectId: navSj.id, source: 'manual', changes: [{ studentId: s1.id, value: 5, absent: false }] }, await win.evaluate(() => window.Remote.token));
  assert.strictEqual(locked.status, 409);
  await shot('71-teacher-locked');
  await logoutTeacher();

  await app.close();
  await server.stop();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('TEACHER E2E OK');
})().catch(async (e) => {
  console.error('TEACHER E2E FAILED:', e.message);
  console.error(e.stack.split('\n').slice(1, 5).join('\n'));
  try {
    await win.screenshot({ path: path.join(SHOTS, '99-teacher-failure.png') });
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
