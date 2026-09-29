/*
 * Syllabus (Ύλη) + language in the real app (run under xvfb, needs a server with /api/my/syllabus):
 * login ΕΛ | EN switch remembered per PC, X-Lang on every request, Remote syllabus API (admin),
 * the student's English portal → Syllabus tab → in-app PDF viewer (blob: iframe, «Save a copy»),
 * English "session expired" and password dialogs for students.
 *
 *   cd server && go build -o /tmp/gmc-new-server . && cd .. && GMC_SERVER_BIN=/tmp/gmc-new-server xvfb-run -a node test/e2e-syllabus.js
 */
const { _electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e-syllabus';
const SAVE = TMP + '/out';
const PREFS = TMP + '/prefs.json'; // next to the data folder (main.js)
const SHOTS = path.join(__dirname, 'shots');
const GREEK = /[Ͱ-Ͽἀ-῿]/;
let app, win, server, url;
const errors = [];
const reqs = [];

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

async function api(method, u, body, token, headers) {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(url + u, {
    method,
    headers: Object.assign({ 'Content-Type': raw ? 'application/pdf' : 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, headers || {}),
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(u + ': ' + JSON.stringify(data));
  return data;
}

async function launch() {
  app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, GMC_REGISTRY_DATA_DIR: TMP + '/local', GMC_REGISTRY_SAVE_DIR: SAVE, GMC_REGISTRY_TEST: '1', GMC_REGISTRY_SERVER: url },
  });
  win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('request', (r) => {
    if (r.url().startsWith(url + '/api/') && r.method() !== 'OPTIONS') reqs.push({ path: r.url().slice(url.length), lang: r.headers()['x-lang'] || null });
  });
  await win.setViewportSize({ width: 1280, height: 820 });
  await win.waitForSelector('.srv-dot.ok');
}

async function login(u, p) {
  await win.fill('#lg-user', u);
  await win.fill('#lg-pass', p);
  await win.click('#lg-go');
}

const text = (sel) => win.textContent(sel);
const step = (m) => console.log('• ' + m);

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP + '/local', { recursive: true });
  fs.mkdirSync(SAVE, { recursive: true });
  server = await startServer();
  url = server.url;

  // registry: a Deck student of Operational Level A; subjects of his level (Deck + common), an Engine one and a Support one
  const adm = (await api('POST', '/api/setup', { username: 'admin', password: 'Admin-12345' })).token;
  const reg = C.createEmptyDb(new Date());
  const yearId = reg.settings.currentYearId;
  const st = C.createStudent(reg, { am: '30002', lastName: 'ΔΟΚΙΜΟΣ', firstName: 'ΠΕΤΡΟΣ', specialty: 'DECK' });
  C.setEnrollment(reg, st.id, yearId, 'OLA');
  const nav = C.createSubject(reg, { levelId: 'OLA', code: 'NAV101', name: 'Navigation I', specialty: 'DECK' });
  const eng = C.createSubject(reg, { levelId: 'OLA', code: 'ENG101', name: 'Maritime English', specialty: 'COMMON' });
  const mar = C.createSubject(reg, { levelId: 'OLA', code: 'MAR101', name: 'Marine Engines', specialty: 'ENGINE' });
  C.createSubject(reg, { levelId: 'OLA', code: 'MET101', name: 'Meteorology', specialty: 'COMMON' }); // no files
  const sup = C.createSubject(reg, { levelId: 'SUP', code: 'SUP101', name: 'Basic Safety' });
  await api('PUT', '/api/registry', { baseRev: 0, data: reg }, adm);
  const pw = (await api('POST', '/api/users/students', { students: [{ am: st.am, name: 'ΔΟΚΙΜΟΣ ΠΕΤΡΟΣ' }] }, adm)).results[0].password;

  const pdf = tinyPdf('Navigation - Chapter 1');
  const navName = 'Navigation – Chapter 1.pdf';
  const navFile = (await api('POST', '/api/syllabus/' + nav.id, pdf, adm, { 'X-File-Name': encodeURIComponent(navName) })).file;
  assert.strictEqual(navFile.name, navName);
  const marFile = (await api('POST', '/api/syllabus/' + mar.id, tinyPdf('Engines'), adm, { 'X-File-Name': encodeURIComponent('Engines.pdf') })).file;
  await api('POST', '/api/syllabus/' + sup.id, tinyPdf('Safety'), adm, { 'X-File-Name': encodeURIComponent('Safety.pdf') });

  // ---------------------------------------------------------------- login screen: ΕΛ | EN
  step('login screen: ΕΛ by default, switch to EN (all texts English, remembered on this PC)');
  await launch();
  assert.ok(await win.isVisible('#lg-lang-el.on'), 'Greek by default');
  assert.ok((await text('#lg-go')).includes('Σύνδεση'));
  await win.click('#lg-go'); // empty fields → client-side error
  await win.waitForSelector('#lg-error:not(.hidden)');
  assert.ok((await text('#lg-error')).includes('Συμπληρώστε'));
  await win.click('#lg-lang-en');
  await win.waitForSelector('#lg-lang-en.on');
  assert.strictEqual(await text('#lg-error'), 'Enter your username (or Student ID) and password.', 'the error follows the language');
  assert.ok((await text('#lg-go')).includes('Sign in'));
  assert.ok((await text('.login-card')).includes('Username or Student ID'));
  assert.ok((await text('.login-server')).includes('connected') && (await text('.login-server')).includes('Change'));
  const card = (await text('.login-card')).replace((await text('.login-lang')), ''); // «ΕΛ» of the switch stays Greek
  assert.ok(!GREEK.test(card), 'no Greek on the English login screen: ' + card);
  assert.strictEqual(await win.evaluate(() => window.Remote.lang), 'en');
  for (let i = 0; i < 20 && !(fs.existsSync(PREFS) && JSON.parse(fs.readFileSync(PREFS, 'utf8')).lang === 'en'); i++) await win.waitForTimeout(100);
  assert.strictEqual(JSON.parse(fs.readFileSync(PREFS, 'utf8')).lang, 'en', 'api.setPrefs({lang})');
  await win.click('#lg-change');
  await win.waitForSelector('#lg-server');
  assert.ok((await text('#lg-test')).includes('Test connection'));
  assert.ok((await text('.login-card')).includes('Server address'));
  await win.click('#lg-test');
  await win.waitForSelector('.srv-dot.ok');
  await login(st.am, 'wrong-password');
  await win.waitForSelector('#lg-error:not(.hidden)');
  const wrong = await text('#lg-error');
  assert.ok(wrong && !GREEK.test(wrong), 'server error in English (X-Lang: en): ' + wrong);
  assert.ok(reqs.some((r) => r.path === '/api/login' && r.lang === 'en'), 'X-Lang: en sent with the login');
  await win.screenshot({ path: path.join(SHOTS, '50-login-en.png') });
  await app.close();

  step('restart: the login screen is still English');
  await launch();
  await win.waitForSelector('#lg-lang-en.on');
  assert.ok((await text('#lg-go')).includes('Sign in'));

  // ---------------------------------------------------------------- admin: Greek app, Remote syllabus API
  step('admin (from the English login screen) works in Greek; Remote syllabus API');
  await login('admin', 'Admin-12345');
  await win.waitForSelector('#nav .nav-item');
  assert.strictEqual(await win.evaluate(() => [window.Remote.lang, document.documentElement.lang].join()), 'el,el');
  reqs.length = 0;
  const r = await win.evaluate(
    async ({ sid, b64 }) => {
      const R = window.Remote;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const up = await R.uploadSyllabus(sid, 'Maritime English — Unit 1.pdf', bytes);
      const one = await R.syllabus(sid);
      const all = await R.syllabus();
      const back = await R.syllabusFile(up.file.id);
      let notPdf = null;
      try {
        await R.uploadSyllabus(sid, 'fake.pdf', new TextEncoder().encode('hello'));
      } catch (e) {
        notPdf = { status: e.status, message: e.message, remote: e instanceof R.RemoteError };
      }
      const tmp = await R.uploadSyllabus(sid, 'temp.pdf', bytes);
      const del = await R.deleteSyllabus(tmp.file.id);
      let gone = null;
      try {
        await R.syllabusFile(tmp.file.id);
      } catch (e) {
        gone = { status: e.status, message: e.message };
      }
      return { file: up.file, n: one.files.length, nAll: all.files.length, u8: back instanceof Uint8Array, same: back.length === bytes.length && back.every((x, i) => x === bytes[i]), notPdf, del, gone };
    },
    { sid: eng.id, b64: pdf.toString('base64') }
  );
  assert.strictEqual(r.file.name, 'Maritime English — Unit 1.pdf', 'X-File-Name round trip');
  assert.strictEqual(r.file.subjectId, eng.id);
  assert.strictEqual(r.file.size, pdf.length);
  assert.strictEqual(r.n, 1, 'syllabus(subjectId)');
  assert.strictEqual(r.nAll, 4, 'syllabus() → all files for the admin');
  assert.ok(r.u8 && r.same, 'syllabusFile → the same bytes as a Uint8Array');
  assert.ok(r.notPdf && r.notPdf.status === 400 && r.notPdf.remote && GREEK.test(r.notPdf.message), 'JSON error of a binary request: ' + JSON.stringify(r.notPdf));
  assert.deepStrictEqual(r.del, { ok: true });
  assert.strictEqual(r.gone && r.gone.status, 404);
  assert.ok(reqs.length >= 7 && reqs.every((x) => x.lang === 'el'), 'X-Lang: el on every admin request: ' + JSON.stringify(reqs));
  const engFile = r.file;

  step('App.pdfViewer in Greek (for the admin/teacher screens)');
  await win.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.App.pdfViewer.open({ title: 'Δοκιμή', bytes, fileName: 'Δοκιμή', lang: 'el' });
  }, pdf.toString('base64'));
  await win.waitForSelector('.modal.pdfv iframe.pdfv-frame');
  assert.strictEqual((await text('#pdfv-save')).trim(), 'Αποθήκευση αντιγράφου');
  assert.strictEqual((await text('#pdfv-close')).trim(), 'Κλείσιμο');
  await win.click('#pdfv-close');
  await win.waitForSelector('.modal.pdfv', { state: 'detached' });
  await win.click('button[data-action="logout"]');
  await win.waitForSelector('#lg-form');
  assert.ok(await win.isVisible('#lg-lang-en.on'), 'back on the English login screen');
  assert.strictEqual(await win.evaluate(() => window.Remote.lang), 'en');

  // ---------------------------------------------------------------- student: Syllabus tab + viewer
  step('student: English portal, Syllabus tab lists his subjects and files');
  await login(st.am, pw);
  await win.waitForSelector('#sp-tab-syllabus');
  assert.strictEqual(await win.evaluate(() => [window.Remote.lang, document.documentElement.lang].join()), 'en,en');
  reqs.length = 0;
  await win.click('#sp-tab-syllabus');
  await win.waitForSelector('.sy-list');
  assert.ok(reqs.some((x) => x.path === '/api/my/syllabus' && x.lang === 'en'), 'X-Lang: en for the student');
  const body = await text('.sp-body');
  assert.ok(!GREEK.test(body), 'no Greek in the syllabus page: ' + body);
  assert.ok(body.includes('Operational Level A'), 'level name');
  const subjects = await win.$$eval('.sy-subj .sy-name', (n) => n.map((x) => x.textContent));
  assert.deepStrictEqual(subjects, ['Navigation INAV101', 'Maritime EnglishENG101', 'MeteorologyMET101'], 'his subjects only (no Engine, no Support): ' + subjects.join(' | '));
  assert.ok((await text('.sy-subj:has-text("Meteorology") .sy-n')).includes('No files yet'));
  const row = await text('.sy-file:has-text("Navigation")');
  assert.ok(row.includes(navName), row);
  assert.ok(/\d+ (B|KB) · \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/.test(row), 'size and date: ' + row);
  await win.screenshot({ path: path.join(SHOTS, '51-student-syllabus.png') });

  step('clicking a file opens the in-app viewer (blob: PDF), «Save a copy», close revokes the URL');
  // (the CSP does not allow fetch() of blob: URLs, so the Blob and the revocation are observed here)
  await win.evaluate(() => {
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    window.__blobs = {};
    window.__revoked = [];
    URL.createObjectURL = function (b) {
      const u = create.call(URL, b);
      window.__blobs[u] = { size: b.size, type: b.type };
      return u;
    };
    URL.revokeObjectURL = function (u) {
      window.__revoked.push(u);
      return revoke.call(URL, u);
    };
  });
  await win.click('.sy-file:has-text("Navigation")');
  await win.waitForSelector('.modal.pdfv iframe.pdfv-frame');
  const src = await win.getAttribute('.pdfv-frame', 'src');
  assert.ok(src.startsWith('blob:'), 'blob: URL: ' + src);
  assert.strictEqual((await text('.modal.pdfv .modal-head h2')).trim(), 'Navigation – Chapter 1');
  assert.ok((await text('.modal.pdfv .modal-head .sub')).includes('NAV101'));
  assert.strictEqual((await text('#pdfv-save')).trim(), 'Save a copy');
  assert.strictEqual((await text('#pdfv-close')).trim(), 'Close');
  const blob = await win.evaluate((u) => window.__blobs[u], src);
  assert.deepStrictEqual(blob, { size: pdf.length, type: 'application/pdf' });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(SHOTS, '52-student-pdf-viewer.png') });
  await win.click('#pdfv-save');
  await win.waitForSelector('.toast:has-text("Saved:")');
  const saved = path.join(SAVE, navName);
  assert.ok(fs.existsSync(saved), 'copy saved as ' + saved);
  assert.ok(fs.readFileSync(saved).equals(pdf), 'the saved copy is the PDF');
  await win.click('#pdfv-close');
  await win.waitForSelector('.modal.pdfv', { state: 'detached' });
  const revoked = await win.evaluate((u) => window.__revoked.includes(u), src);
  assert.ok(revoked, 'the blob: URL is revoked when the viewer closes');
  // the second subject's file (uploaded through Remote.uploadSyllabus) opens too
  await win.click('.sy-file:has-text("Unit 1")');
  await win.waitForSelector('.modal.pdfv iframe.pdfv-frame');
  assert.strictEqual((await text('.modal.pdfv .modal-head h2')).trim(), 'Maritime English — Unit 1');
  await win.keyboard.press('Escape');
  await win.waitForSelector('.modal.pdfv', { state: 'detached' });

  step('a file of another subject is refused (English error); the student never gets the admin list');
  const deny = await win.evaluate(async ({ other, own }) => {
    const out = {};
    try {
      await window.Remote.mySyllabusFile(other);
    } catch (e) {
      out.other = { status: e.status, message: e.message };
    }
    const b = await window.Remote.mySyllabusFile(own);
    out.own = b instanceof Uint8Array ? b.length : -1;
    try {
      await window.Remote.syllabus();
    } catch (e) {
      out.list = e.status;
    }
    return out;
  }, { other: marFile.id, own: engFile.id });
  assert.strictEqual(deny.other.status, 404);
  assert.ok(!GREEK.test(deny.other.message), 'English: ' + deny.other.message);
  assert.strictEqual(deny.own, pdf.length);
  assert.strictEqual(deny.list, 403);

  step('session expired → English re-login dialog, then the page goes on');
  await win.evaluate(() => (window.Remote.token = 'expired-session'));
  await win.click('#sp-tab-exams');
  await win.waitForSelector('.modal:has-text("Your session has expired")');
  const rl = await text('.modal');
  assert.ok(rl.includes('Sign in') && rl.includes('Sign out') && rl.includes('Password') && !GREEK.test(rl.replace(st.am, '')), rl);
  await win.fill('#rl-pass', pw);
  await win.click('#rl-go');
  await win.waitForSelector('.modal', { state: 'detached' });
  await win.waitForSelector('.sp-body h2:has-text("My exams")');
  await win.waitForSelector('.sp-body .card:has-text("There are no exams for you at the moment.")');

  step('password change dialog in English');
  await win.click('[data-sx="password"]');
  await win.waitForSelector('.modal:has-text("Change password")');
  await win.fill('#pw-cur', pw);
  await win.fill('#pw-new', 'abc');
  await win.click('#pw-save');
  await win.waitForSelector('.modal-error:not(.hidden)');
  assert.strictEqual(await text('.modal-error'), 'The new password must be at least 6 characters long.');
  const pwd = await text('.modal');
  assert.ok(pwd.includes('Current password') && pwd.includes('Repeat the new password') && pwd.includes('Cancel') && !GREEK.test(pwd), pwd);
  await win.screenshot({ path: path.join(SHOTS, '53-student-password-en.png') });
  await win.click('.modal-foot button:has-text("Cancel")');
  await win.waitForSelector('.modal', { state: 'detached' });

  await win.click('[data-sx="logout"]');
  await win.waitForSelector('#lg-form');
  assert.ok(await win.isVisible('#lg-lang-en.on'));
  await app.close();
  await server.stop();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('SYLLABUS E2E OK');
})().catch(async (e) => {
  console.error('SYLLABUS E2E FAILED:', e.message);
  console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  try {
    await win.screenshot({ path: path.join(SHOTS, '99-syllabus-failure.png') });
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
