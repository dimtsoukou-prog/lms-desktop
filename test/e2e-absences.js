/*
 * Calendar & absences end to end in the real app, against a real server — run under xvfb:
 *
 *   xvfb-run -a node test/e2e-absences.js
 *
 * admin: sets the absence limit of a subject (hours), fills the calendar of Support Morning 1 (one subject per day),
 * toggles hours of absence in a day's dialog, changes a day's subject, sees the summary · teacher: «Απουσίες» tab,
 * toggles the hours of a past day → the student goes over the limit · student over the limit: the exam card says
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
  await win.waitForSelector('.srv-dot.ok'); // the form is drawn again when the server check ends
  await win.fill('#lg-user', u);
  await win.fill('#lg-pass', p);
  if ((await win.inputValue('#lg-user')) !== u || (await win.inputValue('#lg-pass')) !== p) {
    await win.fill('#lg-user', u);
    await win.fill('#lg-pass', p);
  }
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
  step('admin: «Μαθήματα» → the absence limit of NAV101 = 5 hours');
  await launch();
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await win.click('.nav-item:has-text("Μαθήματα")');
  await win.click('button[data-action="sbEdit"][data-id="' + nav.id + '"]');
  await win.waitForSelector('#sb-abs');
  await win.waitForFunction(() => document.activeElement && document.activeElement.id === 'sb-name'); // the dialog's own focus first
  assert.strictEqual(await win.inputValue('#sb-abs'), '', 'no limit yet');
  await win.fill('#sb-abs', '5');
  await win.click('.modal-foot button:has-text("Αποθήκευση")');
  await settle();
  assert.strictEqual(server.registry().subjects.find((x) => x.id === nav.id).absenceLimit, 5);
  assert.ok((await text('tr:has-text("NAV101")')).includes('5 ώρ.'));

  step('admin: «Ημερολόγιο & απουσίες» — fill two weeks of NAV101 for Support Morning 1');
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
  const legend = await text('.cal-legend');
  assert.ok(legend.includes('10 ημέρες · όριο 5 ώρες') && legend.includes('ENG101') && legend.includes('χωρίς όριο'), legend);

  step('admin: a day → its subject and the hours each student was absent; another day becomes English');
  await win.click('button.cal-day[data-date="2025-10-06"]');
  await win.waitForSelector('#cd-subject');
  assert.strictEqual(await win.inputValue('#cd-subject'), nav.id);
  assert.strictEqual(await win.locator('button[data-cd="' + a.id + '"]').count(), 5, '4 hours + «όλες»');
  await win.click('button[data-cd="' + a.id + '"][data-h="1"]');
  await win.click('button[data-cd="' + a.id + '"][data-h="2"]');
  assert.ok((await text('[data-cd-n="' + a.id + '"]')).startsWith('2 / 5'));
  assert.strictEqual(await win.getAttribute('button[data-cd="' + a.id + '"][data-h="2"]', 'aria-pressed'), 'true');
  await win.click('button[data-cd="' + b.id + '"][data-h="all"]');
  assert.ok((await text('[data-cd-n="' + b.id + '"]')).startsWith('4 / 5'));
  await win.click('button[data-cd="' + b.id + '"][data-h="all"]'); // again: present all day
  assert.ok((await text('[data-cd-n="' + b.id + '"]')).startsWith('0 / 5'));
  assert.strictEqual((await text('#cd-count')).trim(), '1 σπουδαστής · 2 ώρες');
  await shot('51-calendar-day');
  await win.click('#cd-save');
  await settle();
  assert.ok(!(await text('button.cal-day[data-date="2025-10-06"]')).includes('απουσ'), 'no hours of absence under the days');
  await win.click('button.cal-day[data-date="2025-10-20"]');
  await win.waitForSelector('#cd-subject');
  await win.selectOption('#cd-subject', eng.id);
  await win.click('#cd-save');
  await settle();
  assert.ok((await text('button.cal-day[data-date="2025-10-20"]')).includes('ENG101'));
  await shot('52-calendar-month');
  let saved = server.registry();
  assert.strictEqual(saved.calendar.length, 11);
  assert.deepStrictEqual(saved.absences.map((x) => [x.studentId, x.date, x.hour, x.subjectId, x.src]), [[a.id, '2025-10-06', 1, nav.id, 'admin'], [a.id, '2025-10-06', 2, nav.id, 'admin']]);

  step('admin: Morning 2 copies the calendar of Morning 1 (days only, not absences)');
  await win.selectOption('#cal-cls', 'SUP||M2|OCT');
  await win.waitForSelector('.cal-legend:has-text("Σύνολο: 0 ημέρες")');
  await win.click('#cal-copy');
  await win.waitForSelector('#cc-from');
  await win.click('#cc-go');
  await settle();
  assert.strictEqual(await win.locator('.cal-day .cal-subj').count(), 11);
  assert.strictEqual(await win.locator('.cal-day .cal-abs').count(), 0);
  assert.strictEqual(server.registry().calendar.length, 22);
  await win.selectOption('#cal-cls', 'SUP||M1|OCT');
  await win.waitForSelector('.cal-legend:has-text("Σύνολο: 11 ημέρες")');

  step('admin: Ρυθμίσεις → hours per day (4)');
  await win.click('.nav-item:has-text("Ρυθμίσεις")');
  await win.waitForSelector('#abs-hpd');
  assert.strictEqual(await win.inputValue('#abs-hpd'), '4');
  assert.ok((await text('#absence-card')).includes('ορίζεται σε κάθε μάθημα'));
  await win.click('button[data-action="logout"]');
  await win.waitForSelector('#lg-form');

  // ================================================================ teacher
  step('teacher: «Απουσίες» — hour toggles of the latest day; a whole day → over the limit');
  await login(TEACHER.username, TEACHER.password);
  await win.waitForSelector('.tp-item');
  await win.click('#tp-tab-abs');
  await win.waitForSelector('#tp-abs-date');
  assert.strictEqual(await win.inputValue('#tp-abs-date'), '2025-10-17', 'the latest day of the subject');
  const days = await win.$$eval('#tp-abs-date option', (o) => o.map((x) => x.value));
  assert.strictEqual(days.length, 10, 'only NAV days (not the English one)');
  assert.ok((await text('#tp-abs-date option[value="2025-10-06"]')).includes('1 απών'));
  assert.strictEqual(await win.locator('tr[data-sid]').count(), 3, 'his class only');
  assert.strictEqual(await win.locator('tr[data-sid="' + a.id + '"] button[data-tabs]').count(), 5, '4 hours + «όλες»');
  assert.ok((await text('.tp-help')).includes('Όριο του μαθήματος: 5 ώρες'));
  await win.click('tr[data-sid="' + a.id + '"] button[data-h="all"]');
  await until(async () => (await text('tr[data-sid="' + a.id + '"] .tp-abs-cnt')).startsWith('6 / 5'), 'a whole day of absence');
  assert.ok((await text('tr[data-sid="' + a.id + '"] .tp-abs-cnt')).includes('εκτός ορίου'));
  await win.click('tr[data-sid="' + b.id + '"] button[data-h="2"]');
  await until(async () => (await text('tr[data-sid="' + b.id + '"] .tp-abs-cnt')).startsWith('1 / 5'), 'b: 2nd hour');
  await until(async () => (await win.getAttribute('tr[data-sid="' + b.id + '"] button[data-h="2"]', 'aria-pressed')) === 'true', 'toggle on');
  await win.click('tr[data-sid="' + b.id + '"] button[data-h="2"]'); // a mistake, taken back
  await until(async () => (await text('tr[data-sid="' + b.id + '"] .tp-abs-cnt')).startsWith('0 / 5'), 'b back to 0');
  await win.selectOption('#tp-abs-date', '2025-10-06');
  await win.waitForSelector('tr[data-sid="' + a.id + '"] button[data-h="1"].on');
  assert.strictEqual(await win.locator('tr[data-sid="' + a.id + '"] button.on').count(), 2, 'the 2 hours the secretariat recorded');
  await shot('53-teacher-absences');
  saved = server.registry();
  const mine = saved.absences.filter((x) => x.src === 'teacher');
  assert.deepStrictEqual(mine.map((x) => [x.studentId, x.date, x.hour, x.by]), [1, 2, 3, 4].map((h) => [a.id, '2025-10-17', h, TEACHER.username]));
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
  assert.ok(msg.includes('You have 6 hours of absence in this subject and the limit is 5 hours.'), msg);
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
  assert.ok(/because of your absences \(6 hours of absence, limit 5\)/.test(refused.message), refused.message);
  await shot('54-student-not-eligible');
  step('student: «Absences» tab — his hours per subject and day, no limits');
  await win.click('#sp-tab-absences');
  await win.waitForSelector('.ab-subj');
  const mineAbs = await text('.sp-body');
  assert.ok(mineAbs.includes('Your hours of absence in 2025-2026') && mineAbs.includes('Total: 6 hours'), mineAbs);
  assert.ok(mineAbs.includes('NAV101') && mineAbs.includes('6 hours'), mineAbs);
  const dayRows = await win.$$eval('.ab-day', (x) => x.map((r) => r.textContent));
  assert.deepStrictEqual(dayRows, ['Mon 6 Oct 2025hours 1, 2', 'Fri 17 Oct 2025hours 1, 2, 3, 4']);
  assert.ok(!/limit/i.test(mineAbs), 'the limit is not shown there');
  await shot('57-student-absences');
  await win.click('[data-sx="logout"]');
  await win.waitForSelector('#lg-form');
  await login(b.am, pw[b.am]);
  await win.waitForSelector('[data-sx="start"]');
  assert.strictEqual(await win.locator('.exam-card.barred').count(), 0, 'no absences: can start');
  await win.click('#sp-tab-absences');
  await win.waitForSelector('#ab-none');
  assert.ok((await text('#ab-none')).includes('You have no absences.'));
  await win.click('[data-sx="logout"]');
  await win.waitForSelector('#lg-form');

  // ================================================================ admin: summary + permission
  step('admin: summary (6 / 5 in red) and «Να γράψει» in the exam results');
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await win.click('.nav-item:has-text("Ημερολόγιο")');
  await win.waitForSelector('#cal-views');
  // «1 εκτός ορίου» of NAV101 → only the students over its limit
  await win.click('.cal-over[data-subject="' + nav.id + '"]');
  await win.waitForSelector('.abs-table');
  assert.deepStrictEqual(await win.$$eval('.abs-table tbody td.am', (x) => x.map((t) => t.textContent)), ['60001']);
  assert.ok((await text('#abs-filter')).includes('Μόνο εκτός ορίου (1)'));
  assert.strictEqual((await text('#abs-filter-subject')).trim(), 'NAV101');
  await win.click('#abs-filter button:has-text("Όλοι")');
  await until(async () => (await win.locator('.abs-table tbody tr').count()) === 3, 'every student again');
  await win.click('#abs-filter button:has-text("Μόνο εκτός ορίου")');
  await until(async () => (await win.locator('.abs-table tbody tr').count()) === 1, 'only over the limit');
  assert.ok((await text('.abs-table tr:has-text("60001") .abs-cell.over')).startsWith('6/5'), await text('.abs-table tr:has-text("60001")'));
  await win.click('.abs-table tr:has-text("60001") .abs-cell.over');
  await win.waitForSelector('.modal-head h2:has-text("ΑΝΤΩΝΙΟΥ ΑΝΝΑ — NAV101")');
  const list = await text('.modal-body');
  assert.ok(list.includes('Δευτέρα 6 Οκτωβρίου 2025') && list.includes('4η ώρα') && list.includes('καθηγητής ' + TEACHER.username) && list.includes('6 ώρες απουσίας · όριο 5 ώρες'), list);
  await shot('55-absence-summary');
  await win.keyboard.press('Escape');
  await win.click('.nav-item:has-text("Μητρώο")');
  await win.click('tr:has-text("60001") >> text=ΑΝΤΩΝΙΟΥ');
  await win.waitForSelector('[data-sctab="absences"]');
  await win.click('[data-sctab="absences"]');
  await win.waitForSelector('#sc-body .table');
  const card = await text('#sc-body');
  assert.ok(card.includes('2025-2026 · Support Morning 1 – Οκτώβριος') && card.includes('NAV101 – Βασική Ναυσιπλοΐα') && card.includes('εκτός ορίου') && card.includes('06/10/2025 (1η, 2η ώρα) · 17/10/2025 (1η, 2η, 3η, 4η ώρα)'), card);
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
  assert.ok((await text('.modal:has-text("Άδεια συμμετοχής") .modal-body')).includes('6 ώρες απουσίας στο μάθημα (όριο 5 ώρες)'));
  await win.click('.modal-foot button:has-text("Να γράψει")');
  await until(async () => (await text('tr[data-am="60001"]')).includes('άδεια'), 'allowed');
  assert.ok(!(await text('tr[data-am="60001"]')).includes('Χωρίς δικαίωμα'));
  assert.strictEqual(server.exams().find((e) => e.id === exam.id).absenceAllowed[a.am].by, ADMIN);
  // the exam editor shows the same in its list of students
  await win.click('button[data-action="exOpen"]');
  await win.waitForSelector('#ex-title');
  await win.waitForSelector('td.ex-abs');
  const edRow = await text('tr:has(td.am:text-is("60001"))');
  assert.ok(edRow.includes('6 / 5') && edRow.includes('άδεια') && edRow.includes('Ανάκληση άδειας'), edRow);
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
