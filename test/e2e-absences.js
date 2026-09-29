/*
 * Calendar & absences end to end in the real app, against a real server — run under xvfb:
 *
 *   xvfb-run -a node test/e2e-absences.js
 *
 * admin: fills the calendar of Support Morning 1 (one subject per day), records an absence in a day's dialog,
 * changes a day's subject, sees the summary, changes the limit % in Ρυθμίσεις · teacher: «Απουσίες» tab,
 * marks absences of past days → the student goes over the limit · student over the limit: the exam card says
 * he is not eligible and there is no Start button (the server refuses too), another student can start ·
 * admin: the results show "Χωρίς δικαίωμα (απουσίες)" → «Να γράψει» → the student can now start the exam.
 */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e-absences';
const SHOTS = path.join(__dirname, 'shots');
const ADMIN = 'admin';
const ADMIN_PW = 'Admin-12345';
const TEACHER = { username: 'marinou', name: 'Μαρίνου Σοφία', password: 'Teach-2026' };

let app, win, server, url;
const errors = [];

async function api(method, u, body, token) {
  const r = await fetch(url + u, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(method + ' ' + u + ' → ' + r.status + ' ' + JSON.stringify(data));
  return data;
}

async function launch() {
  app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, GMC_REGISTRY_DATA_DIR: TMP + '/local', GMC_REGISTRY_SAVE_DIR: TMP, GMC_REGISTRY_TEST: '1', GMC_REGISTRY_SERVER: url },
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
  await win.fill('#lg-user', u);
  await win.fill('#lg-pass', p);
  await win.click('#lg-go');
}

async function shot(name) {
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function settle() {
  await win.waitForTimeout(600);
  await win.waitForFunction(() => !document.querySelector('#save-status.saving'), null, { timeout: 10000 });
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

const step = (m) => console.log('• ' + m);
const text = (sel) => win.textContent(sel);

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP + '/local', { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  server = await startServer();
  url = server.url;

  // ---------------------------------------------------------------- seed: a past academic year (every day of it has passed)
  const adm = (await api('POST', '/api/setup', { username: ADMIN, password: ADMIN_PW })).token;
  const reg = C.createEmptyDb(new Date(2025, 9, 1)); // 2025-2026
  const y = reg.settings.currentYearId;
  const mk = (am, last, first, sec) => {
    const s = C.createStudent(reg, { am, lastName: last, firstName: first, specialty: 'DECK' });
    C.setEnrollment(reg, s.id, y, 'SUP', sec, 'OCT');
    return s;
  };
  const a = mk('60001', 'ΑΝΤΩΝΙΟΥ', 'ΑΝΝΑ', 'M1');
  const b = mk('60002', 'ΒΛΑΧΟΣ', 'ΒΑΣΙΛΗΣ', 'M1');
  mk('60003', 'ΓΚΙΚΑΣ', 'ΓΙΩΡΓΟΣ', 'M1');
  mk('60004', 'ΔΟΥΚΑ', 'ΔΑΦΝΗ', 'M2');
  const nav = C.createSubject(reg, { levelId: 'SUP', code: 'NAV101', name: 'Βασική Ναυσιπλοΐα' });
  const eng = C.createSubject(reg, { levelId: 'SUP', code: 'ENG101', name: 'Ναυτικά Αγγλικά' });
  await api('PUT', '/api/registry', { baseRev: 0, data: reg }, adm);
  const t = await api('POST', '/api/users/teachers', { username: TEACHER.username, name: TEACHER.name, password: TEACHER.password }, adm);
  await api('PUT', '/api/users/' + t.id + '/assignments', { assignments: [{ yearId: y, subjectId: nav.id, spec: '', section: 'M1', period: '' }] }, adm);
  const pw = {};
  (await api('POST', '/api/users/students', { students: [{ am: a.am, name: 'ΑΝΤΩΝΙΟΥ ΑΝΝΑ' }, { am: b.am, name: 'ΒΛΑΧΟΣ ΒΑΣΙΛΗΣ' }] }, adm)).results.forEach((x) => (pw[x.am] = x.password));
  const exam = await api('POST', '/api/exams', {
    title: 'Πρόοδος Ναυσιπλοΐας',
    subjectId: nav.id,
    subjectName: 'NAV101 Βασική Ναυσιπλοΐα',
    levelId: 'SUP',
    yearId: y,
    startsAt: Date.now() - 60000,
    durationMinutes: 30,
    entryMinutes: 60,
    questions: [{ type: 'tf', text: 'Η πυξίδα δείχνει τον μαγνητικό βορρά', answer: true }],
  }, adm);
  await api('PUT', '/api/exams/' + exam.id + '/assignments', { students: [{ am: a.am, studentId: a.id, name: 'ΑΝΤΩΝΙΟΥ ΑΝΝΑ', className: 'Support Morning 1' }, { am: b.am, studentId: b.id, name: 'ΒΛΑΧΟΣ ΒΑΣΙΛΗΣ', className: 'Support Morning 1' }] }, adm);
  await api('POST', '/api/exams/' + exam.id + '/publish', { published: true }, adm);

  // ================================================================ admin: calendar
  step('admin: «Ημερολόγιο & απουσίες» — fill two weeks of NAV101 for Support Morning 1');
  await launch();
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await win.click('.nav-item:has-text("Ημερολόγιο")');
  await win.waitForSelector('#cal-cls');
  const clsOpts = await win.$$eval('#cal-cls option', (o) => o.map((x) => x.textContent));
  assert.deepStrictEqual(clsOpts, ['Support Morning 1 – Οκτώβριος (3)', 'Support Morning 2 – Οκτώβριος (1)']);
  assert.strictEqual((await text('#cal-month')).trim(), 'Σεπτέμβριος 2025', 'a past year opens at its first month');
  await win.click('#cal-fill');
  await win.waitForSelector('#cf-subject');
  await win.selectOption('#cf-subject', nav.id);
  await win.fill('#cf-from', '2025-10-06');
  await win.fill('#cf-to', '2025-10-17');
  await win.dispatchEvent('#cf-to', 'change');
  await until(async () => /Θα οριστούν 10 ημέρες/.test(await text('#cf-preview')), 'fill preview');
  await shot('50-calendar-fill');
  await win.click('#cf-go');
  await settle();
  assert.strictEqual((await text('#cal-month')).trim(), 'Οκτώβριος 2025');
  assert.strictEqual(await win.locator('.cal-day .cal-subj:has-text("NAV101")').count(), 10);
  assert.ok((await text('.cal-legend')).includes('10 ημέρες · έως 3 απουσίες'), await text('.cal-legend'));

  step('admin: a day → its subject and who was absent; another day becomes English');
  await win.click('button.cal-day[data-date="2025-10-06"]');
  await win.waitForSelector('#cd-subject');
  assert.strictEqual(await win.inputValue('#cd-subject'), nav.id);
  await win.check('[data-cd="' + a.id + '"]');
  assert.ok((await text('[data-cd-n="' + a.id + '"]')).startsWith('1 / 3'));
  await shot('51-calendar-day');
  await win.click('#cd-save');
  await settle();
  assert.ok((await text('button.cal-day[data-date="2025-10-06"]')).includes('1 απουσία'));
  await win.click('button.cal-day[data-date="2025-10-20"]');
  await win.waitForSelector('#cd-subject');
  await win.selectOption('#cd-subject', eng.id);
  await win.click('#cd-save');
  await settle();
  assert.ok((await text('button.cal-day[data-date="2025-10-20"]')).includes('ENG101'));
  await shot('52-calendar-month');
  let saved = server.registry();
  assert.strictEqual(saved.calendar.length, 11);

  step('admin: Morning 2 copies the calendar of Morning 1 (days only, not absences)');
  await win.selectOption('#cal-cls', 'SUP||M2|OCT');
  await win.waitForSelector('.cal-legend:has-text("Σύνολο: 0 ημέρες")');
  await win.click('#cal-copy');
  await win.waitForSelector('#cc-from');
  await win.click('#cc-go');
  await settle();
  assert.strictEqual(await win.locator('.cal-day .cal-subj').count(), 11);
  assert.strictEqual(await win.locator('.cal-day .cal-abs').count(), 0);
  saved = server.registry();
  assert.strictEqual(saved.calendar.length, 22);
  await win.selectOption('#cal-cls', 'SUP||M1|OCT');
  await win.waitForSelector('.cal-day .cal-abs');
  assert.deepStrictEqual(saved.absences.map((x) => [x.studentId, x.date, x.subjectId, x.src]), [[a.id, '2025-10-06', nav.id, 'admin']]);

  step('admin: the limit % in Ρυθμίσεις (30 → 20: 10 days → 2 absences)');
  await win.click('.nav-item:has-text("Ρυθμίσεις")');
  await win.waitForSelector('#abs-pct');
  assert.strictEqual(await win.inputValue('#abs-pct'), '30');
  await win.fill('#abs-pct', '20');
  await win.click('[data-action="saveAbsencePct"]');
  await settle();
  assert.strictEqual(server.registry().settings.absenceLimitPct, 20);
  await win.click('.nav-item:has-text("Ημερολόγιο")');
  await win.waitForSelector('.cal-legend');
  assert.ok((await text('.cal-legend')).includes('10 ημέρες · έως 2 απουσίες'), await text('.cal-legend'));
  await win.click('button.link:has-text("Αλλαγή ποσοστού")');
  await win.waitForSelector('#abs-pct');
  await win.click('button[data-action="logout"]');
  await win.waitForSelector('#lg-form');

  // ================================================================ teacher
  step('teacher: «Απουσίες» — the latest day is shown; two more absences → over the limit');
  await login(TEACHER.username, TEACHER.password);
  await win.waitForSelector('.tp-item');
  await win.click('#tp-tab-abs');
  await win.waitForSelector('#tp-abs-date');
  assert.strictEqual(await win.inputValue('#tp-abs-date'), '2025-10-17', 'the latest day of the subject');
  const days = await win.$$eval('#tp-abs-date option', (o) => o.map((x) => x.value));
  assert.strictEqual(days.length, 10, 'only NAV days (not the English one)');
  assert.ok((await text('#tp-abs-date option[value="2025-10-06"]')).includes('1 απών'));
  assert.strictEqual(await win.locator('input[data-abs]').count(), 3, 'his class only');
  await win.check('input[data-abs="' + a.id + '"]');
  await until(async () => (await text('tr[data-sid="' + a.id + '"] .tp-abs-cnt')).startsWith('2 / 2'), 'count after the first absence');
  await win.selectOption('#tp-abs-date', '2025-10-16');
  await win.waitForSelector('input[data-abs="' + a.id + '"]:not(:checked)');
  await win.check('input[data-abs="' + a.id + '"]');
  await until(async () => (await text('tr[data-sid="' + a.id + '"] .tp-abs-cnt')).includes('εκτός ορίου'), 'over the limit');
  await win.check('input[data-abs="' + b.id + '"]');
  await until(async () => (await text('tr[data-sid="' + b.id + '"] .tp-abs-cnt')).startsWith('1 / 2'), 'b at 1');
  await win.uncheck('input[data-abs="' + b.id + '"]'); // a mistake, taken back
  await until(async () => (await text('tr[data-sid="' + b.id + '"] .tp-abs-cnt')).startsWith('0 / 2'), 'b back to 0');
  await shot('53-teacher-absences');
  saved = server.registry();
  const mine = saved.absences.filter((x) => x.src === 'teacher');
  assert.deepStrictEqual(mine.map((x) => [x.studentId, x.date, x.by]).sort(), [[a.id, '2025-10-16', TEACHER.username], [a.id, '2025-10-17', TEACHER.username]]);
  await win.click('#tp-logout');
  await win.waitForSelector('#lg-form');

  // ================================================================ students
  step('student over the limit: "not eligible", no Start button; the server refuses too');
  await login(a.am, pw[a.am]);
  await win.waitForSelector('.exam-card');
  assert.ok(await win.isVisible('.exam-card.barred'));
  assert.strictEqual(await win.locator('[data-sx="start"]').count(), 0);
  const msg = await text('.ec-barred');
  assert.ok(msg.includes('You are not allowed to take this exam because of your absences.'), msg);
  assert.ok(msg.includes('You have 3 absences in this subject and the limit is 2.'), msg);
  assert.ok((await text('.exam-card .ec-side')).includes('Not eligible'));
  const refused = await win.evaluate(async (id) => {
    try {
      await window.Remote.startExam(id);
      return null;
    } catch (e) {
      return { status: e.status, state: e.data && e.data.state, message: e.message };
    }
  }, exam.id);
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.state, 'barred');
  assert.ok(/because of your absences \(3 absences, limit 2\)/.test(refused.message), refused.message);
  await shot('54-student-not-eligible');
  await win.click('[data-sx="logout"]');
  await win.waitForSelector('#lg-form');
  await login(b.am, pw[b.am]);
  await win.waitForSelector('[data-sx="start"]');
  assert.strictEqual(await win.locator('.exam-card.barred').count(), 0, 'no absences: can start');
  await win.click('[data-sx="logout"]');
  await win.waitForSelector('#lg-form');

  // ================================================================ admin: summary + permission
  step('admin: summary (3 / 2 in red) and «Να γράψει» in the exam results');
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await win.click('.nav-item:has-text("Ημερολόγιο")');
  await win.waitForSelector('#cal-views');
  await win.click('#cal-views button:has-text("Απουσίες")');
  await win.waitForSelector('.abs-table');
  assert.ok((await text('.abs-table tr:has-text("60001") .abs-cell.over')).startsWith('3/2'), await text('.abs-table tr:has-text("60001")'));
  await win.click('.abs-table tr:has-text("60001") .abs-cell.over');
  await win.waitForSelector('.modal-head h2:has-text("ΑΝΤΩΝΙΟΥ ΑΝΝΑ — NAV101")');
  const list = await text('.modal-body');
  assert.ok(list.includes('Δευτέρα 6 Οκτωβρίου 2025') && list.includes('καθηγητής ' + TEACHER.username) && list.includes('εκτός ορίου'), list);
  await shot('55-absence-summary');
  await win.keyboard.press('Escape');
  await win.click('.nav-item:has-text("Μητρώο")');
  await win.click('tr:has-text("60001") >> text=ΑΝΤΩΝΙΟΥ');
  await win.waitForSelector('[data-sctab="absences"]');
  await win.click('[data-sctab="absences"]');
  await win.waitForSelector('#sc-body .table');
  const card = await text('#sc-body');
  assert.ok(card.includes('2025-2026 · Support Morning 1 – Οκτώβριος') && card.includes('NAV101 – Βασική Ναυσιπλοΐα') && card.includes('εκτός ορίου') && card.includes('06/10/2025, 16/10/2025, 17/10/2025'), card);
  await win.keyboard.press('Escape');
  await win.click('.nav-item:has-text("Εξετάσεις")');
  await win.waitForSelector('button[data-action="exResults"]');
  await win.click('button[data-action="exResults"]');
  await win.waitForSelector('tr[data-am="60001"]');
  assert.ok((await text('tr[data-am="60001"]')).includes('Χωρίς δικαίωμα (απουσίες)'));
  assert.ok((await text('#ex-res-barred')).includes('1 σπουδαστής έχει'));
  await shot('56-exam-results-barred');
  await win.click('tr[data-am="60001"] [data-action="exAllow"]');
  await win.waitForSelector('.modal:has-text("Άδεια συμμετοχής")');
  await win.click('.modal-foot button:has-text("Να γράψει")');
  await until(async () => (await text('tr[data-am="60001"]')).includes('άδεια'), 'allowed');
  assert.ok(!(await text('tr[data-am="60001"]')).includes('Χωρίς δικαίωμα'));
  assert.strictEqual(server.exams().find((e) => e.id === exam.id).absenceAllowed[a.am].by, ADMIN);
  // the exam editor shows the same in its list of students
  await win.click('button[data-action="exOpen"]');
  await win.waitForSelector('#ex-title');
  await win.waitForSelector('td.ex-abs');
  const edRow = await text('tr:has(td.am:text-is("60001"))');
  assert.ok(edRow.includes('3 / 2') && edRow.includes('άδεια') && edRow.includes('Ανάκληση άδειας'), edRow);
  assert.strictEqual(await win.locator('#ex-over-note').count(), 0, 'nobody is left without a permission');
  await win.click('button[data-action="logout"]');
  await win.waitForSelector('#lg-form');

  step('student: allowed by the admin → can start the exam');
  await login(a.am, pw[a.am]);
  await win.waitForSelector('[data-sx="start"]');
  await win.click('[data-sx="start"]');
  await win.click('.modal-foot button:has-text("Start")');
  await win.waitForSelector('.xm-q');
  assert.strictEqual(server.attempts(exam.id).length, 1);
  await app.close();
  await server.stop();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('ABSENCES E2E OK');
})().catch(async (e) => {
  console.error('ABSENCES E2E FAILED:', e);
  try {
    await win.screenshot({ path: path.join(SHOTS, '99-absences-failure.png') });
  } catch (e2) {}
  try {
    await app.close();
  } catch (e3) {}
  try {
    await server.stop();
  } catch (e4) {}
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
});
