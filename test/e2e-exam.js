/* Student exam edge cases in the real app: resume after closing the app, automatic submission when time runs out. */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e-exam';
let app, win, server, url;
const errors = [];

async function api(method, u, body, token) {
  const r = await fetch(url + u, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(u + ': ' + JSON.stringify(data));
  return data;
}

async function launch(noServerHint) {
  const env = { ...process.env, GMC_REGISTRY_DATA_DIR: TMP + '/local', GMC_REGISTRY_SAVE_DIR: TMP, GMC_REGISTRY_TEST: '1', GMC_REGISTRY_SERVER: url };
  if (noServerHint) delete env.GMC_REGISTRY_SERVER;
  app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env,
  });
  win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1280, height: 820 });
  await win.waitForSelector('.srv-dot.ok');
}

async function login(u, p) {
  await win.fill('#lg-user', u);
  await win.fill('#lg-pass', p);
  await win.click('#lg-go');
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP + '/local', { recursive: true });
  fs.rmSync(path.join(TMP, 'prefs.json'), { force: true });
  server = await startServer();
  url = server.url;
  const adm = (await api('POST', '/api/setup', { username: 'admin', password: 'Admin-12345' })).token;
  const reg = C.createEmptyDb(new Date());
  const st = C.createStudent(reg, { am: '30001', lastName: 'ΔΟΚΙΜΟΣ', firstName: 'ΝΙΚΟΣ' });
  await api('PUT', '/api/registry', { baseRev: 0, data: reg }, adm);
  const pw = (await api('POST', '/api/users/students', { students: [{ am: st.am, name: 'ΔΟΚΙΜΟΣ ΝΙΚΟΣ' }] }, adm)).results[0].password;
  const q = [
    { type: 'tf', text: 'Πρώτη ερώτηση', answer: true },
    { type: 'single', text: 'Δεύτερη ερώτηση', options: [{ text: 'Α1' }, { text: 'Β1' }], correct: ['a'] },
  ];
  const id = (await api('POST', '/api/exams', { title: 'Τεστ χρόνου', startsAt: Date.now() - 5000, durationMinutes: 10, entryMinutes: 5, shuffleQuestions: false, questions: q }, adm)).id;
  await api('PUT', '/api/exams/' + id + '/assignments', { students: [{ am: st.am, name: 'ΔΟΚΙΜΟΣ ΝΙΚΟΣ' }] }, adm);
  await api('POST', '/api/exams/' + id + '/publish', { published: true }, adm);

  console.log('• student starts, answers, closes the app (the student portal is in English)');
  await launch();
  await login(st.am, pw);
  await win.waitForSelector('[data-sx="start"]');
  assert.strictEqual(await win.evaluate(() => window.Remote.lang), 'en', 'a student always gets Remote.lang = en');
  assert.ok((await win.textContent('.sp-top')).includes('Sign out'), 'English top bar');
  assert.ok(await win.isVisible('#sp-tab-syllabus'), 'Syllabus tab next to Exams');
  await win.click('[data-sx="start"]');
  await win.waitForSelector('.modal:has-text("Start exam")');
  await win.click('.modal-foot button:has-text("Start")');
  await win.waitForSelector('.xm-q');
  assert.ok(!(await win.isVisible('#sp-tabs')), 'no Syllabus tab while taking an exam');
  assert.ok((await win.textContent('.xm-qnum')).startsWith('Question 1 of 2'));
  await win.click('.xm-opt:has-text("True")');
  await win.waitForSelector('#xm-save:has-text("Saved")');
  await win.waitForTimeout(900);
  await app.close();

  console.log('• reopens: «Continue», the saved answer is still there, the clock keeps running');
  await launch();
  await login(st.am, pw);
  await win.waitForSelector('[data-sx="resume"]');
  assert.ok((await win.textContent('.exam-card')).includes('left'), 'remaining time shown in English');
  assert.ok(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}, \d\d:\d\d/.test(await win.textContent('.exam-card .ec-meta')), 'English date format');
  await win.click('[data-sx="resume"]');
  await win.waitForSelector('.xm-q');
  assert.ok((await win.textContent('.xm-qtext')).includes('Δεύτερη'), 'resumes at the first unanswered question');
  assert.ok(await win.isVisible('.xm-grid button.done'), 'question 1 marked as answered');
  const t = await win.textContent('#xm-timer span');
  assert.ok(/^\d+:\d\d$/.test(t) && Number(t.split(':')[0]) < 10, 'remaining time continues: ' + t);

  console.log('• time runs out → automatic submission');
  await win.evaluate(() => (window.Remote.offset += 11 * 60 * 1000));
  await win.waitForSelector('.xm-done:has-text("Time is up")', { timeout: 10000 });
  const a = server.attempts(id)[0];
  assert.strictEqual(a.status, 'submitted');
  assert.strictEqual(a.score, 1, 'the saved answer counted');
  await win.screenshot({ path: path.join(__dirname, 'shots', '40-exam-time-up.png') });
  await app.close();
  await server.stop();

  console.log('• a server on this same PC is found automatically (127.0.0.1:8080) and asks for the administrator');
  const local = await startServer({ port: 8080 });
  fs.rmSync(path.join(TMP, 'prefs.json'), { force: true });
  await launch(true);
  await win.waitForSelector('#su-user', { timeout: 15000 });
  assert.ok((await win.textContent('.login-server')).includes('127.0.0.1:8080'));
  await win.screenshot({ path: path.join(__dirname, 'shots', '41-local-server-setup.png') });
  await app.close();
  await local.stop();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('EXAM E2E OK');
})().catch(async (e) => {
  console.error('EXAM E2E FAILED:', e.message);
  try {
    await win.screenshot({ path: path.join(__dirname, 'shots', '99-exam-failure.png') });
  } catch (e2) {}
  try {
    await app.close();
  } catch (e3) {}
  try {
    await server.stop();
  } catch (e4) {}
  process.exit(1);
});
