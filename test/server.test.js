/* Central server: auth, roles (students never see grades), registry revisions, accounts, exams. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./serverproc.js');
const EC = require('../src/exam-core.js');

let passed = 0;
const tests = [];
const t = (name, fn) => tests.push({ name, fn });

let app;
let base;
async function call(method, url, body, token, headers) {
  const r = await fetch(base + url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await r.json();
  } catch (e) {
    data = null;
  }
  return { status: r.status, data };
}
const login = async (u, p) => (await call('POST', '/api/login', { username: u, password: p })).data;

t('exam-core: grading, integer 0–5 scale, answers never trusted', () => {
  const qs = [
    { id: 'q1', type: 'single', text: 'A?', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], correct: ['b'], points: 2 },
    { id: 'q2', type: 'multi', text: 'B?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }], correct: ['a', 'c'] },
    { id: 'q3', type: 'tf', text: 'C?', answer: false },
    { id: 'q4', type: 'short', text: 'D?', accept: ['Πειραιάς', 'Piraeus'] },
    { id: 'q5', type: 'short', text: 'E?', accept: ['3,5'] },
  ].map(EC.normalizeQuestion);
  assert.deepStrictEqual(EC.validateQuestions(qs), []);
  const g = EC.gradeAnswers(qs, { q1: 'b', q2: ['c', 'a'], q3: false, q4: ' ΠΕΙΡΑΙΑΣ. ', q5: '3.5', bogus: 1 });
  assert.strictEqual(g.score, 6);
  assert.strictEqual(g.percent, 100);
  assert.strictEqual(g.grade, 5);
  const h = EC.gradeAnswers(qs, { q1: 'a', q2: ['a'], q3: true });
  assert.strictEqual(h.score, 0);
  assert.strictEqual(h.grade, 0);
  assert.strictEqual(EC.gradeAnswers(qs, { q1: 'b', q2: ['a', 'c'] }).grade, 1); // 3/6 = 50% → 1 (pass)
  const s = EC.questionsForStudent(qs, EC.makeOrder(qs, true, true));
  assert.ok(s.every((q) => q.correct === undefined && q.answer === undefined && q.accept === undefined));
  assert.strictEqual(EC.percentToGrade(59.99), 1);
  assert.strictEqual(EC.percentToGrade(60), 2);
  assert.strictEqual(EC.percentToGrade(49.9), 0);
});

t('exam-core: questions from an Excel table', () => {
  const rows = [
    ['Ερώτηση', 'Τύπος', 'Α', 'Β', 'Γ', 'Δ', 'Σωστή', 'Μονάδες'],
    ['Πρωτεύουσα της Ελλάδας;', '', 'Αθήνα', 'Πάτρα', 'Βόλος', '', 'Α', ''],
    ['Ποια είναι λιμάνια;', '', 'Πειραιάς', 'Λάρισα', 'Βόλος', '', 'Α, Γ', 2],
    ['Ο ήλιος είναι αστέρι', '', '', '', '', '', 'Σωστό', ''],
    ['Knots = ναυτικά μίλια ανά …', 'Σύντομη απάντηση', '', '', '', '', 'ώρα | ωρα', ''],
    ['Λάθος γραμμή', '', 'x', 'y', '', '', 'Ζ', ''],
  ];
  const r = EC.parseQuestionTable(rows);
  assert.strictEqual(r.questions.length, 5);
  assert.deepStrictEqual(r.questions.map((q) => q.type), ['single', 'multi', 'tf', 'short', 'single']);
  assert.deepStrictEqual(r.questions[1].correct, ['a', 'c']);
  assert.strictEqual(r.questions[1].points, 2);
  assert.strictEqual(r.questions[2].answer, true);
  assert.strictEqual(r.problems.length, 1);
  assert.strictEqual(r.problems[0].row, 6);
});

t('first start: the administrator is created from the app (username + password)', async () => {
  let r = await call('GET', '/api/health');
  assert.strictEqual(r.data.needsSetup, true);
  assert.strictEqual((await call('POST', '/api/setup', { username: 'ad', password: 'Admin-12345' })).status, 400, 'short username');
  assert.strictEqual((await call('POST', '/api/setup', { username: 'admin', password: 'short' })).status, 400, 'short password');
  r = await call('POST', '/api/setup', { username: 'admin', name: 'Διαχειριστής', password: 'Admin-12345' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.token && r.data.user.role === 'admin' && !r.data.user.mustChange);
  assert.strictEqual((await call('GET', '/api/health')).data.needsSetup, false);
  assert.strictEqual((await call('POST', '/api/setup', { username: 'other', password: 'Other-12345' })).status, 409, 'only once');
});

t('login, roles and registry revisions', async () => {
  assert.strictEqual((await call('GET', '/api/registry')).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
  const adm = await login('admin', 'Admin-12345');
  assert.ok(adm.token && adm.user.role === 'admin');
  let r = await call('GET', '/api/registry', undefined, adm.token);
  assert.deepStrictEqual(r.data, { rev: 0, data: null });
  const reg = { students: [{ id: 'st1', am: '26003', lastName: 'Παπαδόπουλος', firstName: 'Γιώργος' }], subjects: [], grades: [{ studentId: 'st1', value: 4 }], enrollments: [], years: [] };
  r = await call('PUT', '/api/registry', { baseRev: 0, data: reg }, adm.token);
  assert.strictEqual(r.data.rev, 1);
  r = await call('PUT', '/api/registry', { baseRev: 0, data: reg }, adm.token);
  assert.strictEqual(r.status, 409, 'stale revision rejected');
  assert.strictEqual(r.data.rev, 1);
  r = await call('GET', '/api/registry', undefined, adm.token);
  assert.strictEqual(r.data.rev, 1);
  assert.strictEqual(r.data.data.grades[0].value, 4);
  assert.strictEqual((await call('PUT', '/api/registry', { baseRev: 1, data: { students: 1 } }, adm.token)).status, 400);
  r = await call('POST', '/api/registry/backups', { reason: 'manual' }, adm.token);
  assert.ok(r.data.id);
  r = await call('GET', '/api/registry/backups', undefined, adm.token);
  assert.ok(r.data.length >= 1);
  r = await call('GET', '/api/registry/backups/' + r.data[0].id, undefined, adm.token);
  assert.strictEqual(r.data.data.students[0].am, '26003');
});

let adminToken;
let studentPw;
t('accounts from Α.Μ.; a student can never read grades or the registry', async () => {
  adminToken = (await login('admin', 'Admin-12345')).token;
  let r = await call('POST', '/api/users/students', { students: [{ am: '26003', name: 'Παπαδόπουλος Γιώργος' }, { am: '26004', name: 'Αλεξίου Νίκος' }] }, adminToken);
  assert.deepStrictEqual(r.data.results.map((x) => x.status), ['created', 'created']);
  studentPw = r.data.results[0].password;
  assert.ok(/^[a-z0-9]{8}$/.test(studentPw));
  r = await call('POST', '/api/users/students', { students: [{ am: '26003', name: 'x' }] }, adminToken);
  assert.strictEqual(r.data.results[0].status, 'exists');
  assert.strictEqual(r.data.results[0].password, undefined);
  const st = await login('26003', studentPw);
  assert.strictEqual(st.user.role, 'student');
  assert.strictEqual(st.user.am, '26003');
  for (const [m, u] of [['GET', '/api/registry'], ['GET', '/api/registry/rev'], ['GET', '/api/registry/backups'], ['GET', '/api/users'], ['GET', '/api/exams'], ['PUT', '/api/registry'], ['GET', '/api/audit']]) {
    const x = await call(m, u, m === 'PUT' ? { baseRev: 1, data: {} } : undefined, st.token);
    assert.strictEqual(x.status, 403, m + ' ' + u + ' must be forbidden for students');
  }
  r = await call('GET', '/api/my/exams', undefined, st.token);
  assert.deepStrictEqual(r.data.exams, []);
  assert.strictEqual((await call('GET', '/api/my/exams', undefined, adminToken)).status, 403);
  // wrong passwords → temporary lock
  for (let i = 0; i < 5; i++) await call('POST', '/api/login', { username: '26004', password: 'nope' });
  assert.strictEqual((await call('POST', '/api/login', { username: '26004', password: 'nope' })).status, 429);
});

t('exams: create, assign, schedule, take, auto-grade — student never sees a score', async () => {
  const q = [
    { type: 'single', text: 'Μονάδα ταχύτητας πλοίου;', options: [{ text: 'km/h' }, { text: 'knots' }], correct: ['b'] },
    { type: 'tf', text: 'Η πυξίδα δείχνει τον μαγνητικό βορρά', answer: true },
    { type: 'short', text: 'Διεθνής γλώσσα ναυσιπλοΐας;', accept: ['Αγγλικά', 'English'] },
    { type: 'multi', text: 'Χρώματα φανών πλευρών;', options: [{ text: 'Κόκκινο' }, { text: 'Πράσινο' }, { text: 'Μπλε' }], correct: ['a', 'b'] },
  ];
  const startsAt = Date.now() + 3600000; // in one hour
  let r = await call('POST', '/api/exams', { title: 'Πρόοδος Ναυσιπλοΐας', subjectName: 'NAV101 Ναυσιπλοΐα', startsAt, durationMinutes: 30, entryMinutes: 10, countsFinal: true, questions: q }, adminToken);
  assert.ok(r.data.id, JSON.stringify(r.data));
  const id = r.data.id;
  assert.strictEqual((await call('POST', '/api/exams/' + id + '/publish', { published: true }, adminToken)).status, 400, 'no students assigned yet');
  r = await call('PUT', '/api/exams/' + id + '/assignments', { students: [{ am: '26003', name: 'Παπαδόπουλος Γιώργος', className: 'OL A Deck Morning' }, { am: '26004', name: 'Αλεξίου Νίκος' }] }, adminToken);
  assert.strictEqual(r.data.assigned, 2);
  r = await call('POST', '/api/exams/' + id + '/publish', { published: true }, adminToken);
  assert.strictEqual(r.data.status, 'published');

  const st = (await login('26003', studentPw)).token;
  r = await call('GET', '/api/my/exams', undefined, st);
  assert.strictEqual(r.data.exams.length, 1);
  assert.strictEqual(r.data.exams[0].state, 'upcoming');
  assert.strictEqual((await call('POST', '/api/my/exams/' + id + '/start', {}, st)).status, 409, 'cannot start before the scheduled time');

  // move the exam to "now"
  const ex = (await call('GET', '/api/exams/' + id, undefined, adminToken)).data;
  r = await call('PUT', '/api/exams/' + id, Object.assign({}, ex, { startsAt: Date.now() - 1000 }), adminToken);
  assert.ok(r.data.id);
  r = await call('POST', '/api/my/exams/' + id + '/start', {}, st);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const payload = r.data;
  assert.strictEqual(payload.questions.length, 4);
  const txt = JSON.stringify(payload);
  assert.ok(!/"correct"|"answer"|"accept"/.test(txt), 'no answer keys sent to the student');
  // answer: 3 of 4 correct (multi wrong)
  const ans = {};
  payload.questions.forEach((x) => {
    if (x.type === 'single') ans[x.id] = x.options.find((o) => o.text === 'knots').id;
    if (x.type === 'tf') ans[x.id] = true;
    if (x.type === 'short') ans[x.id] = 'english';
    if (x.type === 'multi') ans[x.id] = [x.options.find((o) => o.text === 'Κόκκινο').id];
  });
  r = await call('PUT', '/api/my/exams/' + id + '/answers', { answers: ans }, st);
  assert.strictEqual(r.data.saved, 4);
  // resuming returns the saved answers
  r = await call('GET', '/api/my/exams/' + id + '/attempt', undefined, st);
  assert.strictEqual(Object.keys(r.data.answers).length, 4);
  // structural change is refused once answers exist
  const ex2 = (await call('GET', '/api/exams/' + id, undefined, adminToken)).data;
  r = await call('PUT', '/api/exams/' + id, Object.assign({}, ex2, { questions: ex2.questions.slice(0, 3) }), adminToken);
  assert.strictEqual(r.status, 409);
  r = await call('POST', '/api/my/exams/' + id + '/submit', { answers: ans }, st);
  assert.deepStrictEqual(Object.keys(r.data).sort(), ['late', 'ok', 'state', 'submittedAt']);
  assert.ok(!/score|percent|grade/.test(JSON.stringify(r.data)), 'no score in the submit response');
  r = await call('GET', '/api/my/exams', undefined, st);
  assert.strictEqual(r.data.exams[0].state, 'submitted');
  assert.ok(!/score|percent|grade/i.test(JSON.stringify(r.data.exams)), 'no score in the exam list');
  assert.strictEqual((await call('POST', '/api/my/exams/' + id + '/start', {}, st)).status, 409, 'one attempt only');
  // the admin sees the result
  r = await call('GET', '/api/exams/' + id + '/results', undefined, adminToken);
  const row = r.data.rows.find((x) => x.am === '26003');
  assert.strictEqual(row.status, 'submitted');
  assert.strictEqual(row.score, 3);
  assert.strictEqual(row.percent, 75);
  assert.strictEqual(row.grade, 3);
  assert.strictEqual(r.data.rows.find((x) => x.am === '26004').status, 'not_started');
  r = await call('GET', '/api/exams/' + id + '/results/26003', undefined, adminToken);
  assert.strictEqual(r.data.items.filter((x) => x.correct).length, 3);
  // fixing the answer key re-grades
  const ex3 = (await call('GET', '/api/exams/' + id, undefined, adminToken)).data;
  ex3.questions[3].correct = ['a'];
  r = await call('PUT', '/api/exams/' + id, ex3, adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  r = await call('GET', '/api/exams/' + id + '/results', undefined, adminToken);
  assert.strictEqual(r.data.rows.find((x) => x.am === '26003').grade, 5);
  // retake allowed by the admin
  r = await call('POST', '/api/exams/' + id + '/attempts/26003/reset', {}, adminToken);
  assert.strictEqual(r.data.ok, true);
  r = await call('GET', '/api/my/exams', undefined, st);
  assert.strictEqual(r.data.exams[0].state, 'open');
  // another student cannot see an exam not assigned to him
  const other = await call('POST', '/api/users/students', { students: [{ am: '26099', name: 'Τρίτος' }] }, adminToken);
  const t3 = (await login('26099', other.data.results[0].password)).token;
  assert.deepStrictEqual((await call('GET', '/api/my/exams', undefined, t3)).data.exams, []);
  assert.strictEqual((await call('POST', '/api/my/exams/' + id + '/start', {}, t3)).status, 404);
});

t('time limit: late answers are refused, the attempt is closed with what was saved', async () => {
  const q = [{ type: 'tf', text: 'x', answer: true }];
  let r = await call('POST', '/api/exams', { title: 'Σύντομο τεστ', startsAt: Date.now() - 1000, durationMinutes: 1, entryMinutes: 5, questions: q }, adminToken);
  const id = r.data.id;
  await call('PUT', '/api/exams/' + id + '/assignments', { students: [{ am: '26003', name: 'Π' }] }, adminToken);
  await call('POST', '/api/exams/' + id + '/publish', { published: true }, adminToken);
  const st = (await login('26003', studentPw)).token;
  r = await call('POST', '/api/my/exams/' + id + '/start', {}, st);
  const qid = r.data.questions[0].id;
  await call('PUT', '/api/my/exams/' + id + '/answers', { answers: { [qid]: true } }, st);
  // simulate the clock running out
  await call('POST', '/api/_test/expire/' + id, {}, adminToken);
  r = await call('PUT', '/api/my/exams/' + id + '/answers', { answers: { [qid]: false } }, st);
  assert.strictEqual(r.status, 409);
  r = await call('GET', '/api/exams/' + id + '/results', undefined, adminToken);
  const row = r.data.rows[0];
  assert.strictEqual(row.status, 'submitted');
  assert.strictEqual(row.autoSubmitted, true);
  assert.strictEqual(row.grade, 5, 'the saved (correct) answer counts, the late change does not');
});

t('Greek / special Α.Μ. in URLs; entry window of at least one minute', async () => {
  let r = await call('POST', '/api/users/students', { students: [{ am: 'Α100', name: 'Ελληνικός Α.Μ.' }] }, adminToken);
  const pw = r.data.results[0].password;
  assert.strictEqual((await call('POST', '/api/exams', { title: 'x', startsAt: Date.now(), durationMinutes: 5, entryMinutes: 0, questions: [] }, adminToken)).status, 400, 'entry 0 refused');
  assert.strictEqual(EC.examPhase({ startsAt: 1000, entryMinutes: 0, durationMinutes: 5 }, 1000 + 30000).phase, 'open', 'old exams with 0 still get one minute');
  r = await call('POST', '/api/exams', { title: 'Τεστ Α.Μ.', startsAt: Date.now() - 1000, durationMinutes: 5, entryMinutes: 5, questions: [{ type: 'tf', text: 'x', answer: true }] }, adminToken);
  const id = r.data.id;
  await call('PUT', '/api/exams/' + id + '/assignments', { students: [{ am: 'Α100', name: 'Ελληνικός' }] }, adminToken);
  await call('POST', '/api/exams/' + id + '/publish', { published: true }, adminToken);
  const st = (await login('Α100', pw)).token;
  r = await call('POST', '/api/my/exams/' + id + '/start', {}, st);
  await call('POST', '/api/my/exams/' + id + '/submit', { answers: { [r.data.questions[0].id]: true } }, st);
  r = await call('GET', '/api/exams/' + id + '/results/' + encodeURIComponent('Α100'), undefined, adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.grade, 5);
  r = await call('POST', '/api/exams/' + id + '/attempts/' + encodeURIComponent('Α100') + '/reset', {}, adminToken);
  assert.strictEqual(r.data.ok, true);
  assert.strictEqual((await call('GET', '/api/exams/' + id + '/results/%E0%A4%A', undefined, adminToken)).status, 400);
});

t('teachers: only their subject + class, grades go straight into the registry, admin can undo, locks', async () => {
  const C = require('../src/core.js');
  // registry: OL A Deck Morning (2 students), Deck Afternoon (1), Engine Morning (1)
  const cur = (await call('GET', '/api/registry', undefined, adminToken)).data;
  const db = C.normalizeDb(cur.data);
  const y = db.settings.currentYearId;
  const mk = (am, ln, spec, sec) => {
    const st = C.createStudent(db, { am, lastName: ln, firstName: 'Τ', specialty: spec });
    C.setEnrollment(db, st.id, y, 'OLA', sec);
    return st;
  };
  const a1 = mk('70001', 'ΑΛΦΑ', 'DECK', 'MO');
  const a2 = mk('70002', 'ΒΗΤΑ', 'DECK', 'MO');
  const b1 = mk('70003', 'ΓΑΜΜΑ', 'DECK', 'AF');
  const e1 = mk('70004', 'ΔΕΛΤΑ', 'ENGINE', 'MO');
  const nav = C.createSubject(db, { levelId: 'OLA', code: 'T-NAV', name: 'Ναυσιπλοΐα Τ', specialty: 'DECK' });
  const other = C.createSubject(db, { levelId: 'OLA', code: 'T-ENG', name: 'Αγγλικά Τ', specialty: 'COMMON' });
  C.setGrade(db, e1.id, other.id, y, { value: 4 }); // not his subject
  let r = await call('PUT', '/api/registry', { baseRev: cur.rev, data: db }, adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));

  r = await call('POST', '/api/users/teachers', { username: 'papas', name: 'Παπάς Νίκος', password: 'Teach-2026' }, adminToken);
  assert.strictEqual(r.data.role, 'teacher');
  const tid = r.data.id;
  r = await call('PUT', '/api/users/' + tid + '/assignments', { assignments: [{ yearId: y, subjectId: nav.id, spec: 'DECK', section: 'MO', label: 'NAV — OL A Deck Morning' }] }, adminToken);
  assert.strictEqual(r.data.assignments.length, 1);
  const tt = (await login('papas', 'Teach-2026')).token;

  // what the teacher can see
  r = await call('GET', '/api/teacher/data', undefined, tt);
  assert.deepStrictEqual(r.data.data.students.map((x) => x.am).sort(), ['70001', '70002'], 'only his class');
  assert.deepStrictEqual(r.data.data.subjects.map((x) => x.id), [nav.id], 'only his subject');
  assert.strictEqual(r.data.data.grades.length, 0, 'no other grades');
  for (const [m, u] of [['GET', '/api/registry'], ['GET', '/api/users'], ['GET', '/api/exams'], ['GET', '/api/my/exams']]) assert.strictEqual((await call(m, u, undefined, tt)).status, 403, u);

  // manual grade + Excel import
  r = await call('POST', '/api/teacher/grades', { yearId: y, subjectId: nav.id, source: 'manual', changes: [{ studentId: a1.id, value: 4 }] }, tt);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  r = await call('POST', '/api/teacher/grades', { yearId: y, subjectId: nav.id, source: 'import', fileName: 'nav.xlsx', changes: [{ studentId: a1.id, value: 5 }, { studentId: a2.id, absent: true }] }, tt);
  assert.deepStrictEqual(r.data.stats, { added: 1, updated: 1, same: 0, cleared: 0 });
  // refused: decimal, other class, other subject
  assert.strictEqual((await call('POST', '/api/teacher/grades', { yearId: y, subjectId: nav.id, changes: [{ studentId: a1.id, value: 3.5 }] }, tt)).status, 400);
  assert.strictEqual((await call('POST', '/api/teacher/grades', { yearId: y, subjectId: nav.id, changes: [{ studentId: b1.id, value: 3 }] }, tt)).status, 400);
  assert.strictEqual((await call('POST', '/api/teacher/grades', { yearId: y, subjectId: other.id, changes: [{ studentId: a1.id, value: 3 }] }, tt)).status, 403);

  // the admin's registry has the grades and the import in its history → undo works with the app's own code
  r = await call('GET', '/api/registry', undefined, adminToken);
  const reg = C.normalizeDb(r.data.data);
  assert.strictEqual(C.getGrade(reg, a1.id, nav.id, y).value, 5);
  assert.strictEqual(C.getGrade(reg, a2.id, nav.id, y).absent, true);
  assert.strictEqual(C.getGrade(reg, e1.id, other.id, y).value, 4, 'other grades untouched');
  const imp = reg.imports[0];
  assert.strictEqual(imp.by, 'papas');
  assert.strictEqual(imp.fileName, 'nav.xlsx');
  const u = C.undoImport(reg, imp.id);
  assert.strictEqual(u.reverted, 2);
  assert.strictEqual(C.getGrade(reg, a1.id, nav.id, y).value, 4, 'back to the manual grade');
  assert.strictEqual(C.getGrade(reg, a2.id, nav.id, y), null);
  r = await call('PUT', '/api/registry', { baseRev: r.data.rev, data: reg }, adminToken);
  assert.strictEqual(r.status, 200);

  // locked by the admin → no more changes
  reg.settings.gradeLocks = { [y + '|' + nav.id]: { at: Date.now(), by: 'admin' } };
  r = await call('PUT', '/api/registry', { baseRev: r.data.rev, data: reg }, adminToken);
  r = await call('POST', '/api/teacher/grades', { yearId: y, subjectId: nav.id, changes: [{ studentId: a1.id, value: 2 }] }, tt);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.locked, true);
  assert.strictEqual((await call('GET', '/api/teacher/data', undefined, tt)).data.data.settings.gradeLocks[y + '|' + nav.id].by, 'admin');
});

t('admin accounts and deactivation', async () => {
  let r = await call('POST', '/api/users/admins', { username: 'secretary', password: 'short' }, adminToken);
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/users/admins', { username: 'secretary', password: 'Secretary-2026', name: 'Γραμματεία' }, adminToken);
  assert.strictEqual(r.data.role, 'admin');
  const users = (await call('GET', '/api/users', undefined, adminToken)).data;
  assert.ok(users.every((u) => u.pass_hash === undefined && u.pass_salt === undefined));
  const s = users.find((u) => u.username === '26099');
  await call('PATCH', '/api/users/' + s.id, { active: false }, adminToken);
  r = await call('POST', '/api/users/' + s.id + '/password', {}, adminToken);
  assert.ok(r.data.password);
  assert.strictEqual((await call('POST', '/api/login', { username: '26099', password: r.data.password })).status, 401, 'inactive account');
  const me = users.find((u) => u.username === 'admin');
  assert.strictEqual((await call('DELETE', '/api/users/' + me.id, undefined, adminToken)).status, 400, 'cannot delete yourself');
});

// ---- v2.2: periods, 0Δ/0Α codes, re-exam, syllabus, English student errors
const v22 = {};
async function adminDb() {
  const C = require('../src/core.js');
  const cur = (await call('GET', '/api/registry', undefined, adminToken)).data;
  return { C, rev: cur.rev, db: C.normalizeDb(cur.data) };
}
async function saveDb(rev, db) {
  const r = await call('PUT', '/api/registry', { baseRev: rev, data: db }, adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return r.data.rev;
}
const regGrade = (reg, sid, subjectId) => reg.grades.find((g) => g.studentId === sid && g.subjectId === subjectId);

t('periods: a teacher assigned to one intake (period) sees and grades only its students', async () => {
  const { C, rev, db } = await adminDb();
  const y = db.settings.currentYearId;
  db.settings.periods = [
    { id: 'OCT', name: 'Οκτώβριος', short: 'Οκτ' },
    { id: 'JAN', name: 'Ιανουάριος', short: 'Ιαν' },
    { id: 'MAY', name: 'Μάιος', short: 'Μάι' },
  ];
  db.settings.levelPeriods = { SUP: ['OCT', 'JAN'], OLA: ['OCT'], OLB: ['JAN', 'MAY'] };
  const mk = (am, ln, period) => {
    const st = C.createStudent(db, { am, lastName: ln, firstName: 'Π', specialty: 'DECK' });
    C.setEnrollment(db, st.id, y, 'SUP', 'M1').period = period;
    return st;
  };
  v22.p1 = mk('71001', 'ΟΚΤΩΒΡΙΟΥ', 'OCT');
  v22.p2 = mk('71002', 'ΙΑΝΟΥΑΡΙΟΥ', 'JAN');
  v22.p3 = mk('71003', 'ΙΑΝΟΥΑΡΙΟΥ Β', 'JAN');
  v22.sup = C.createSubject(db, { levelId: 'SUP', code: 'P-SUP', name: 'Περίοδοι Τ' });
  v22.y = y;
  await saveDb(rev, db);

  let r = await call('POST', '/api/users/teachers', { username: 'perit', name: 'Περιόδου Καθηγητής', password: 'Teach-2026' }, adminToken);
  const tid = r.data.id;
  const as = (period) => ({ yearId: y, subjectId: v22.sup.id, spec: '', section: '', period, label: 'SUP ' + period });
  r = await call('PUT', '/api/users/' + tid + '/assignments', { assignments: [as(' JAN '), as('JAN'), as('OCT')] }, adminToken);
  assert.deepStrictEqual(r.data.assignments.map((a) => a.period), ['JAN', 'OCT'], 'period trimmed, part of the duplicate key');
  r = await call('PUT', '/api/users/' + tid + '/assignments', { assignments: [as('JAN')] }, adminToken);
  assert.strictEqual(r.data.assignments[0].period, 'JAN');
  v22.tt = (await login('perit', 'Teach-2026')).token;

  r = await call('GET', '/api/teacher/data', undefined, v22.tt);
  assert.deepStrictEqual(r.data.data.students.map((x) => x.am).sort(), ['71002', '71003'], 'only the January intake');
  assert.ok(r.data.data.enrollments.length === 2 && r.data.data.enrollments.every((e) => e.period === 'JAN'), 'enrollments keep their period');
  assert.strictEqual(r.data.data.settings.periods.length, 3);
  assert.deepStrictEqual(r.data.data.settings.levelPeriods.SUP, ['OCT', 'JAN']);
  assert.strictEqual(r.data.assignments[0].period, 'JAN');

  r = await call('POST', '/api/teacher/grades', { yearId: y, subjectId: v22.sup.id, changes: [{ studentId: v22.p2.id, value: 3 }] }, v22.tt);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  r = await call('POST', '/api/teacher/grades', { yearId: y, subjectId: v22.sup.id, changes: [{ studentId: v22.p1.id, value: 3 }] }, v22.tt);
  assert.strictEqual(r.status, 400, 'October student is not in his class');
});

t('grade codes: 0Δ (J) / 0Α (U) only with value 0, stored in "att", in import snapshots', async () => {
  const { y, sup, p2, p3, tt } = v22;
  const post = (changes, extra) => call('POST', '/api/teacher/grades', Object.assign({ yearId: y, subjectId: sup.id, source: 'manual', changes }, extra || {}), tt);
  let r = await post([{ studentId: p2.id, value: 0, att: 'J' }]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.stats.updated, 1);
  let g = regGrade(app.registry(), p2.id, sup.id);
  assert.strictEqual(g.value, 0);
  assert.strictEqual(g.absent, false);
  assert.strictEqual(g.att, 'J');
  assert.strictEqual((await post([{ studentId: p2.id, value: 0, att: 'J' }])).data.stats.same, 1, 'same code = same grade');
  r = await post([{ studentId: p2.id, value: 0, att: 'U' }]);
  assert.strictEqual(r.data.stats.updated, 1, '0Δ → 0Α is a change');
  assert.strictEqual(regGrade(app.registry(), p2.id, sup.id).att, 'U');
  for (const bad of [{ value: 2, att: 'J' }, { absent: true, att: 'U' }, { value: 0, att: 'X' }]) {
    r = await post([Object.assign({ studentId: p2.id }, bad)]);
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
    assert.ok(/[α-ω]/i.test(r.data.error), 'Greek message');
  }
  r = await post([{ studentId: p3.id, value: 0, att: 'U' }], { source: 'import', fileName: 'att.xlsx' });
  assert.strictEqual(r.data.stats.added, 1);
  const imp = app.registry().imports[0];
  assert.strictEqual(imp.fileName, 'att.xlsx');
  assert.strictEqual(imp.changes[0].before, null);
  assert.strictEqual(imp.changes[0].after.att, 'U');
  r = await post([{ studentId: p2.id, value: 0 }]);
  assert.strictEqual(r.data.stats.updated, 1);
  g = regGrade(app.registry(), p2.id, sup.id);
  assert.ok(g.value === 0 && !('att' in g), 'plain written 0 has no code');
});

t('re-exam: teachers cannot change a grade with "re" (409), an import skips it (stats.reexam)', async () => {
  const { y, sup, p2, p3, tt } = v22;
  const { rev, db } = await adminDb();
  const re = { value: 3, absent: false, att: null, at: new Date().toISOString(), by: 'admin' };
  regGrade(db, p2.id, sup.id).re = re;
  await saveDb(rev, db);
  const post = (changes, extra) => call('POST', '/api/teacher/grades', Object.assign({ yearId: y, subjectId: sup.id, source: 'manual', changes }, extra || {}), tt);
  for (const ch of [{ studentId: p2.id, value: 4 }, { studentId: p2.id, clear: true }]) {
    const r = await post([{ studentId: p3.id, value: 1 }, ch]);
    assert.strictEqual(r.status, 409, JSON.stringify(ch));
    assert.strictEqual(r.data.reexam, true);
    assert.strictEqual(r.data.error, 'Ο σπουδαστής έχει ήδη βαθμό re-exam — αλλαγές μόνο από τη γραμματεία.');
  }
  assert.strictEqual(regGrade(app.registry(), p3.id, sup.id).value, 0, 'a refused request changes nothing');
  let r = await post([{ studentId: p2.id, value: 5 }, { studentId: p3.id, value: 2 }], { source: 'import', fileName: 're.xlsx' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.stats.reexam, 1);
  assert.strictEqual(r.data.stats.updated, 1);
  const reg = app.registry();
  const g = regGrade(reg, p2.id, sup.id);
  assert.strictEqual(g.value, 0, 'original untouched');
  assert.deepStrictEqual(g.re, re, 're untouched');
  const g3 = regGrade(reg, p3.id, sup.id);
  assert.ok(g3.value === 2 && !('att' in g3));
  assert.strictEqual(reg.imports[0].stats.reexam, 1);
  assert.deepStrictEqual(reg.imports[0].changes.map((c) => c.studentId), [p3.id], 'the skipped student is not in the import');
  // a later normal change of another student keeps the re-exam grade
  r = await post([{ studentId: p3.id, value: 4 }]);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(regGrade(app.registry(), p2.id, sup.id).re, re);
});

t('syllabus: PDFs per subject — admin/assigned teacher upload & delete, students only their subjects', async () => {
  const { C, rev, db } = await adminDb();
  const y = db.settings.currentYearId;
  const s1 = C.createStudent(db, { am: '72001', lastName: 'ΥΛΗ', firstName: 'Deck', specialty: 'DECK' });
  C.setEnrollment(db, s1.id, y, 'OLA', 'MO');
  const s2 = C.createStudent(db, { am: '72002', lastName: 'ΥΛΗ', firstName: 'Support', specialty: 'ENGINE' });
  C.setEnrollment(db, s2.id, y, 'SUP', 'M1');
  // not enrolled this year: his latest year counts (2020-2021 → SUP)
  db.years.push({ id: 'yr_t2019', label: '2019-2020', mgmtShift: {} }, { id: 'yr_t2020', label: '2020-2021', mgmtShift: {} });
  const s3 = C.createStudent(db, { am: '72003', lastName: 'ΥΛΗ', firstName: 'Old', specialty: 'DECK' });
  C.setEnrollment(db, s3.id, 'yr_t2020', 'SUP', 'M1');
  C.setEnrollment(db, s3.id, 'yr_t2019', 'OLA', 'MO');
  const nav = C.createSubject(db, { levelId: 'OLA', code: 'Y-NAV', name: 'Ύλη Ναυσιπλοΐα', specialty: 'DECK' });
  const eng = C.createSubject(db, { levelId: 'OLA', code: 'Y-ME', name: 'Ύλη Μηχανές', specialty: 'ENGINE' });
  const com = C.createSubject(db, { levelId: 'OLA', code: 'Y-COM', name: 'Ύλη Κοινό', specialty: 'COMMON' });
  const old = C.createSubject(db, { levelId: 'OLA', code: 'Y-OLD', name: 'Ύλη Παλιό', specialty: 'COMMON', active: false });
  const sup = C.createSubject(db, { levelId: 'SUP', code: 'Y-SUP', name: 'Ύλη Support' });
  await saveDb(rev, db);

  let r = await call('POST', '/api/users/students', { students: [{ am: '72001', name: 'Deck' }, { am: '72002', name: 'Support' }, { am: '72003', name: 'Old' }] }, adminToken);
  const pw = Object.fromEntries(r.data.results.map((x) => [x.am, x.password]));
  const st1 = (await login('72001', pw['72001'])).token;
  const st2 = (await login('72002', pw['72002'])).token;
  const st3 = (await login('72003', pw['72003'])).token;
  r = await call('POST', '/api/users/teachers', { username: 'ylis', name: 'Ύλη Καθηγητής', password: 'Teach-2026' }, adminToken);
  // assigned to the common subject (another year: still "assigned")
  await call('PUT', '/api/users/' + r.data.id + '/assignments', { assignments: [{ yearId: 'yr_t2019', subjectId: com.id, spec: '', section: '' }] }, adminToken);
  const tt = (await login('ylis', 'Teach-2026')).token;

  const pdf = (tag) => Buffer.from('%PDF-1.4\n%' + tag + '\n' + 'x'.repeat(3000) + '\n%%EOF\n');
  const upload = async (subjectId, body, name, token) => {
    const res = await fetch(base + '/api/syllabus/' + encodeURIComponent(subjectId), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(name) },
      body,
    });
    return { status: res.status, data: await res.json() };
  };
  const download = async (url, token, headers) => {
    const res = await fetch(base + url, { headers: Object.assign({ Authorization: 'Bearer ' + token }, headers || {}) });
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  };

  // uploads
  r = await upload(nav.id, pdf('nav'), 'C:\\fakepath\\Ύλη Ναυσιπλοΐας.PDF', adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const fNav = r.data.file;
  assert.deepStrictEqual(Object.keys(fNav).sort(), ['by', 'byName', 'byRole', 'id', 'name', 'size', 'subjectId', 'uploadedAt']);
  assert.strictEqual(fNav.name, 'Ύλη Ναυσιπλοΐας.pdf');
  assert.strictEqual(fNav.size, pdf('nav').length);
  assert.strictEqual(fNav.subjectId, nav.id);
  assert.ok(fNav.by === 'admin' && fNav.byRole === 'admin' && !isNaN(Date.parse(fNav.uploadedAt)));
  const fEng = (await upload(eng.id, pdf('eng'), 'eng.pdf', adminToken)).data.file;
  const fOld = (await upload(old.id, pdf('old'), 'old.pdf', adminToken)).data.file;
  const fSup = (await upload(sup.id, pdf('sup'), 'support', adminToken)).data.file;
  assert.strictEqual(fSup.name, 'support.pdf', '.pdf extension forced');
  r = await upload(com.id, pdf('com'), 'κοινό.pdf', tt);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const fCom = r.data.file;
  assert.ok(fCom.by === 'ylis' && fCom.byName === 'Ύλη Καθηγητής' && fCom.byRole === 'teacher');
  // refused
  assert.strictEqual((await upload(nav.id, pdf('x'), 'x.pdf', tt)).status, 403, 'teacher: subject not assigned');
  r = await upload(nav.id, Buffer.from('PK\u0003\u0004 this is a zip'), 'fake.pdf', adminToken);
  assert.strictEqual(r.status, 400, 'not a PDF');
  assert.ok(r.data.error);
  assert.strictEqual((await upload(com.id, Buffer.from('hello'), 'x.pdf', tt)).status, 400, 'not a PDF (teacher)');
  assert.strictEqual((await upload(com.id, Buffer.alloc(0), 'x.pdf', tt)).status, 400, 'empty');
  assert.strictEqual((await upload('sb_missing', pdf('x'), 'x.pdf', adminToken)).status, 404, 'unknown subject');
  assert.strictEqual((await upload(nav.id, pdf('x'), 'x.pdf', st1)).status, 403, 'students cannot upload');

  // lists
  r = await call('GET', '/api/syllabus', undefined, adminToken);
  assert.deepStrictEqual(r.data.files.map((f) => f.id), [fNav.id, fEng.id, fOld.id, fSup.id, fCom.id]);
  r = await call('GET', '/api/syllabus?subjectId=' + encodeURIComponent(nav.id), undefined, adminToken);
  assert.deepStrictEqual(r.data.files, [fNav]);
  r = await call('GET', '/api/syllabus', undefined, tt);
  assert.deepStrictEqual(r.data.files.map((f) => f.id), [fCom.id], 'teacher: only his subjects');
  assert.deepStrictEqual((await call('GET', '/api/syllabus?subjectId=' + encodeURIComponent(nav.id), undefined, tt)).data.files, []);
  assert.strictEqual((await call('GET', '/api/syllabus', undefined, st1)).status, 403);

  // admin / teacher downloads
  let d = await download('/api/syllabus/files/' + fCom.id, tt);
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.headers.get('content-type'), 'application/pdf');
  assert.strictEqual(d.headers.get('cache-control'), 'no-store');
  assert.ok(d.headers.get('content-disposition').startsWith('inline;'));
  assert.ok(d.headers.get('content-disposition').includes("filename*=UTF-8''" + encodeURIComponent('κοινό.pdf')));
  assert.ok(d.buf.equals(pdf('com')));
  assert.strictEqual((await download('/api/syllabus/files/' + fNav.id, tt)).status, 403);
  assert.ok((await download('/api/syllabus/files/' + fNav.id, adminToken)).buf.equals(pdf('nav')));
  assert.strictEqual((await download('/api/syllabus/files/nope', adminToken)).status, 404);

  // the student's syllabus: his level, his specialty's + common active subjects, in subject order
  r = await call('GET', '/api/my/syllabus', undefined, st1);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const names = db.settings.levelNames || {};
  assert.deepStrictEqual(r.data.level, { id: 'OLA', name: names.OLA || 'Operational Level A' });
  const expected = db.subjects
    .filter((s) => s.levelId === 'OLA' && s.active !== false && (s.specialty === 'COMMON' || s.specialty === 'DECK'))
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id);
  assert.deepStrictEqual(r.data.subjects.map((s) => s.id), expected);
  assert.ok(!r.data.subjects.some((s) => [eng.id, old.id, sup.id].includes(s.id)));
  const sNav = r.data.subjects.find((s) => s.id === nav.id);
  assert.deepStrictEqual(sNav, { id: nav.id, code: 'Y-NAV', name: 'Ύλη Ναυσιπλοΐα', files: [{ id: fNav.id, name: fNav.name, size: fNav.size, uploadedAt: fNav.uploadedAt }] });
  assert.deepStrictEqual(r.data.subjects.find((s) => s.id === com.id).files.map((f) => f.id), [fCom.id]);
  d = await download('/api/my/syllabus/files/' + fNav.id, st1);
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.headers.get('content-type'), 'application/pdf');
  assert.ok(d.buf.equals(pdf('nav')));
  for (const f of [fEng, fOld, fSup]) assert.strictEqual((await download('/api/my/syllabus/files/' + f.id, st1)).status, 404, f.name);
  d = await download('/api/my/syllabus/files/' + fSup.id, st1, { 'X-Lang': 'en' });
  assert.strictEqual(JSON.parse(d.buf.toString()).error, 'File not found.');
  assert.strictEqual((await download('/api/my/syllabus/files/' + fNav.id, tt)).status, 403, 'student route only');

  r = await call('GET', '/api/my/syllabus', undefined, st2);
  assert.strictEqual(r.data.level.id, 'SUP');
  assert.strictEqual(r.data.level.name, names.SUP || 'Support Level');
  assert.ok(r.data.subjects.some((s) => s.id === sup.id && s.files.length === 1));
  assert.ok(r.data.subjects.every((s) => s.id !== nav.id));
  assert.strictEqual((await download('/api/my/syllabus/files/' + fSup.id, st2)).status, 200);
  assert.strictEqual((await download('/api/my/syllabus/files/' + fNav.id, st2)).status, 404, 'another level');
  r = await call('GET', '/api/my/syllabus', undefined, st3);
  assert.strictEqual(r.data.level.id, 'SUP', 'latest enrollment when not enrolled in the current year');

  // delete
  assert.strictEqual((await call('DELETE', '/api/syllabus/files/' + fNav.id, undefined, tt)).status, 403);
  r = await call('DELETE', '/api/syllabus/files/' + fCom.id, undefined, tt);
  assert.deepStrictEqual(r.data, { ok: true });
  r = await call('DELETE', '/api/syllabus/files/' + fNav.id, undefined, adminToken);
  assert.deepStrictEqual(r.data, { ok: true });
  assert.strictEqual((await call('DELETE', '/api/syllabus/files/' + fNav.id, undefined, adminToken)).status, 404);
  assert.strictEqual((await download('/api/syllabus/files/' + fNav.id, adminToken)).status, 404);
  assert.strictEqual((await download('/api/my/syllabus/files/' + fNav.id, st1)).status, 404);
  assert.deepStrictEqual((await call('GET', '/api/my/syllabus', undefined, st1)).data.subjects.find((s) => s.id === nav.id).files, []);
  const dir = path.join(app.dataDir, 'syllabus');
  assert.ok(!fs.existsSync(path.join(dir, fNav.id + '.pdf')) && fs.existsSync(path.join(dir, fSup.id + '.pdf')));
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepStrictEqual(index.map((f) => f.id), [fEng.id, fOld.id, fSup.id]);
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temporary files left');
  const audit = (await call('GET', '/api/audit', undefined, adminToken)).data.map((a) => a.action);
  assert.ok(audit.includes('syllabus-upload') && audit.includes('syllabus-delete'));
});

t('absences: class calendar, a teacher records a day, over the limit → the exam cannot start until the admin allows it', async () => {
  const C = require('../src/core.js');
  const cur = (await call('GET', '/api/registry', undefined, adminToken)).data;
  const db = C.normalizeDb(cur.data);
  const y = (db.years.find((x) => x.label === '2019-2020') || C.addYear(db, '2019-2020')).id; // a past year: every day of it can hold absences
  const mk = (am, ln, sec) => {
    const st = C.createStudent(db, { am, lastName: ln, firstName: 'Α', specialty: 'DECK' });
    C.setEnrollment(db, st.id, y, 'SUP', sec, 'OCT');
    return st;
  };
  const s1 = mk('75001', 'ΠΡΩΤΟΣ', 'M1');
  const s2 = mk('75002', 'ΔΕΥΤΕΡΟΣ', 'M1');
  const s3 = mk('75003', 'ΤΡΙΤΟΣ', 'M2');
  const nav = C.createSubject(db, { levelId: 'SUP', code: 'A-NAV', name: 'Ναυσιπλοΐα Α' });
  const eng = C.createSubject(db, { levelId: 'SUP', code: 'A-ENG', name: 'Αγγλικά Α' });
  const M1 = C.studentCalendarKey(db, s1, y);
  C.fillCalendar(db, y, M1, { from: '2019-10-07', to: '2019-10-11', subjectId: nav.id }); // 5 days → limit ⌊5 × 30%⌋ = 1
  C.setCalendarDay(db, y, M1, '2019-10-14', eng.id);
  C.fillCalendar(db, y, C.studentCalendarKey(db, s3, y), { from: '2019-10-07', to: '2019-10-11', subjectId: nav.id });
  C.setAbsence(db, s2.id, y, '2019-10-07', true, { by: 'admin' }); // the secretariat: 1 = at the limit
  let r = await call('PUT', '/api/registry', { baseRev: cur.rev, data: db }, adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));

  // a teacher of NAV for Morning 1 records two days of absences of 75001
  r = await call('POST', '/api/users/teachers', { username: 'kalou', name: 'Καλού Μαρία', password: 'Teach-2028' }, adminToken);
  await call('PUT', '/api/users/' + r.data.id + '/assignments', { assignments: [{ yearId: y, subjectId: nav.id, section: 'M1' }] }, adminToken);
  const tt = (await login('kalou', 'Teach-2028')).token;
  r = await call('GET', '/api/teacher/data', undefined, tt);
  assert.strictEqual(r.data.data.calendar.length, 5, 'only the NAV days of Morning 1');
  assert.deepStrictEqual(r.data.data.absences.map((a) => a.date), ['2019-10-07']);
  const abs = (date, changes) => call('POST', '/api/teacher/absences', { yearId: y, subjectId: nav.id, date, changes }, tt);
  r = await abs('2019-10-07', [{ studentId: s1.id, absent: true }, { studentId: s2.id, absent: true }]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.deepStrictEqual(r.data.stats, { added: 1, removed: 0, same: 1 });
  r = await abs('2019-10-08', [{ studentId: s1.id, absent: true }]);
  assert.strictEqual(r.data.stats.added, 1);
  const rev = r.data.rev;
  r = await abs('2019-10-08', [{ studentId: s1.id, absent: true }]);
  assert.deepStrictEqual([r.data.rev, r.data.stats.same], [rev, 1], 'nothing changed → no new revision');
  assert.strictEqual((await abs('2019-10-08', [{ studentId: s3.id, absent: true }])).status, 400, 'not his class');
  r = await abs('2019-10-14', [{ studentId: s1.id, absent: true }]);
  assert.strictEqual(r.status, 400, 'an English day');
  assert.ok(/δεν έχει A-NAV/.test(r.data.error), r.data.error);
  assert.strictEqual((await abs(C.addDays(C.isoDate(), 3), [{ studentId: s1.id, absent: true }])).status, 400, 'future');
  assert.strictEqual((await call('POST', '/api/teacher/absences', { yearId: y, subjectId: eng.id, date: '2019-10-14', changes: [{ studentId: s1.id, absent: true }] }, tt)).status, 403);
  const reg = C.normalizeDb((await call('GET', '/api/registry', undefined, adminToken)).data.data);
  assert.deepStrictEqual(C.absenceStatus(reg, s1, nav.id, y), { count: 2, days: 5, limit: 1, pct: 30, over: true, left: -1, dates: ['2019-10-07', '2019-10-08'] });
  assert.strictEqual(C.getAbsence(reg, s1.id, y, '2019-10-07').src, 'teacher');
  assert.strictEqual(C.getAbsence(reg, s1.id, y, '2019-10-07').by, 'kalou');

  // an exam of NAV (that year), open now, for 75001 (over) and 75002 (at the limit)
  const pw = {};
  (await call('POST', '/api/users/students', { students: [{ am: '75001', name: 'ΠΡΩΤΟΣ' }, { am: '75002', name: 'ΔΕΥΤΕΡΟΣ' }] }, adminToken)).data.results.forEach((x) => (pw[x.am] = x.password));
  r = await call('POST', '/api/exams', { title: 'Πρόοδος Α-NAV', subjectId: nav.id, subjectName: 'A-NAV', yearId: y, startsAt: Date.now() - 5000, durationMinutes: 10, entryMinutes: 5, questions: [{ type: 'tf', text: 'Ερώτηση', answer: true }] }, adminToken);
  const id = r.data.id;
  await call('PUT', '/api/exams/' + id + '/assignments', { students: [{ am: '75001', studentId: s1.id, name: 'ΠΡΩΤΟΣ' }, { am: '75002', studentId: s2.id, name: 'ΔΕΥΤΕΡΟΣ' }] }, adminToken);
  assert.strictEqual((await call('POST', '/api/exams/' + id + '/publish', { published: true }, adminToken)).status, 200);
  const t1 = (await login('75001', pw['75001'])).token;
  const t2 = (await login('75002', pw['75002'])).token;
  const en = { 'X-Lang': 'en' };
  r = await call('GET', '/api/my/exams', undefined, t1);
  let ex = r.data.exams.find((x) => x.id === id);
  assert.deepStrictEqual([ex.state, ex.barred, ex.absences, ex.absenceLimit], ['open', true, 2, 1]);
  r = await call('POST', '/api/my/exams/' + id + '/start', {}, t1, en);
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual([r.data.state, r.data.code, r.data.absences, r.data.absenceLimit], ['barred', 'absences', 2, 1]);
  assert.strictEqual(r.data.error, 'You are not allowed to take this exam because of your absences (2 absences, limit 1). Please contact the Registrar’s office.');
  assert.strictEqual(app.attempts(id).length, 0);
  ex = (await call('GET', '/api/my/exams', undefined, t2)).data.exams.find((x) => x.id === id);
  assert.ok(!ex.barred, 'at the limit: allowed');
  assert.strictEqual((await call('POST', '/api/my/exams/' + id + '/start', {}, t2)).status, 200);

  // the admin sees it in the results and allows 75001 by hand
  r = await call('GET', '/api/exams/' + id + '/results', undefined, adminToken);
  const row = (am) => r.data.rows.find((x) => x.am === am);
  assert.deepStrictEqual([row('75001').absences, row('75001').absenceLimit, row('75001').absenceDays, row('75001').overLimit, row('75001').absenceAllowed], [2, 1, 5, true, false]);
  assert.deepStrictEqual([row('75002').absences, row('75002').overLimit], [1, false]);
  assert.strictEqual(r.data.exam.absenceCheck, true);
  assert.strictEqual((await call('POST', '/api/exams/' + id + '/absence-allow', { am: '79999', allowed: true }, adminToken)).status, 400, 'not assigned');
  assert.strictEqual((await call('POST', '/api/exams/' + id + '/absence-allow', { am: '75001', allowed: true }, t1)).status, 403, 'students cannot');
  r = await call('POST', '/api/exams/' + id + '/absence-allow', { am: '75001', allowed: true }, adminToken);
  assert.strictEqual(r.data.absenceAllowed['75001'].by, 'admin');
  assert.strictEqual((await call('GET', '/api/exams/' + id, undefined, adminToken)).data.absenceAllowed['75001'].by, 'admin');
  ex = (await call('GET', '/api/my/exams', undefined, t1)).data.exams.find((x) => x.id === id);
  assert.ok(!ex.barred);
  r = await call('POST', '/api/my/exams/' + id + '/start', {}, t1);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  r = await call('GET', '/api/exams/' + id + '/results', undefined, adminToken);
  assert.strictEqual(row('75001').absenceAllowed, true);
  // a copy of the exam starts without permissions; an unassigned student loses his
  r = await call('POST', '/api/exams/' + id + '/duplicate', {}, adminToken);
  assert.deepStrictEqual((await call('GET', '/api/exams/' + r.data.id, undefined, adminToken)).data.absenceAllowed, {});
  await call('POST', '/api/exams/' + r.data.id + '/absence-allow', { am: '75002', allowed: true }, adminToken);
  await call('PUT', '/api/exams/' + r.data.id + '/assignments', { students: [{ am: '75001' }] }, adminToken);
  assert.deepStrictEqual((await call('GET', '/api/exams/' + r.data.id, undefined, adminToken)).data.absenceAllowed, {});
  r = await call('POST', '/api/exams/' + id + '/absence-allow', { am: '75001', allowed: false }, adminToken);
  assert.deepStrictEqual(r.data.absenceAllowed, {});
});

t('English error texts for the student portal (X-Lang: en), CORS headers, version', async () => {
  const en = { 'X-Lang': 'en' };
  let r = await call('POST', '/api/login', { username: '72001', password: 'wrong-one' }, null, en);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.data.error, 'Wrong username or password.');
  r = await call('POST', '/api/login', { username: '72001', password: 'wrong-one' });
  assert.strictEqual(r.data.error, 'Λάθος όνομα χρήστη ή κωδικός.', 'Greek by default');
  r = await call('POST', '/api/login', { username: '', password: '' }, null, en);
  assert.strictEqual(r.status, 400);
  assert.ok(/^[\x20-\x7e—]+$/.test(r.data.error), r.data.error);
  r = await call('GET', '/api/my/syllabus', undefined, 'x'.repeat(40), en);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.data.code, 'auth');
  assert.ok(/session has expired/.test(r.data.error), r.data.error);
  const other = await call('POST', '/api/users/students', { students: [{ am: '72009', name: 'English' }] }, adminToken);
  const st = (await login('72009', other.data.results[0].password)).token;
  r = await call('POST', '/api/me/password', { current: 'nope', next: 'whatever-1' }, st, en);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'The current password is not correct.');
  r = await call('POST', '/api/my/exams/99999/start', {}, st, en);
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.data.error, 'Exam not found.');
  r = await call('POST', '/api/my/exams/99999/start', {}, st);
  assert.strictEqual(r.data.error, 'Η εξέταση δεν βρέθηκε.');
  const pre = await fetch(base + '/api/syllabus/x', { method: 'OPTIONS' });
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-headers'), 'Authorization, Content-Type, X-Lang, X-File-Name');
  assert.strictEqual((await call('GET', '/api/health')).data.version, '2.2.0');
});

(async () => {
  app = await startServer();
  base = app.url;
  for (const x of tests) {
    try {
      await x.fn();
      passed++;
    } catch (e) {
      console.error('✗ ' + x.name + '\n', e);
      process.exitCode = 1;
    }
  }
  await app.stop();
  console.log(passed + '/' + tests.length + ' server tests passed');
})();
