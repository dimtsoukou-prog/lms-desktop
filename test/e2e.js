/* End-to-end test of the real app against a real central server (run under xvfb). */
const { _electron, chromium } = require('playwright-core');
const { spawn } = require('child_process');
const net = require('net');
const DRIVER = process.env.E2E_DRIVER || 'electron'; // 'electron' | 'neu'
const NEU_BIN = '/home/claude/gmc-neu/dist/GMC-Student-Registry/GMC-Student-Registry-linux_x64';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const C = require('../src/core.js');
const { startServer } = require('./serverproc.js');

const ROOT = path.join(__dirname, '..');
const TMP = '/tmp/claude-0/gmc-e2e';
const DATA = TMP + '/local-data'; // data folder of the PREVIOUS version on this PC (migration offer)
const CFG = TMP + '/config';
const SAVE = TMP + '/out';
const SRV = TMP + '/server';
const SHOTS = path.join(__dirname, DRIVER === 'neu' ? 'shots-neu' : 'shots');
const SAMPLES = path.join(__dirname, 'samples');
const ADMIN = 'jim';
const ADMIN_PW = 'Gmc-Admin-2026!';

let app, win, server, serverUrl;
const errors = [];
let shotN = 10;

function waitPort(port, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => {
        s.destroy();
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() > until) reject(new Error('port ' + port + ' not open'));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function hookErrors() {
  win.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push('console: ' + m.text());
  });
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}

let neuPort = 5190;
async function launchNeu() {
  const port = ++neuPort;
  const proc = spawn(NEU_BIN, ['--mode=browser', '--port=' + port, '--config-dir=' + CFG, '--data-dir=' + DATA, '--save-dir=' + SAVE, '--server=' + serverUrl], { cwd: path.dirname(NEU_BIN), stdio: 'ignore' });
  await waitPort(port, 15000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  win = page;
  app = {
    async close() {
      await page.waitForTimeout(400);
      await browser.close();
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    },
  };
  hookErrors();
  await page.goto('http://127.0.0.1:' + port + '/');
  await win.waitForSelector('#lg-form');
}

async function launch() {
  if (DRIVER === 'neu') return launchNeu();
  app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, GMC_REGISTRY_DATA_DIR: DATA, GMC_REGISTRY_SAVE_DIR: SAVE, GMC_REGISTRY_TEST: '1', GMC_REGISTRY_SERVER: serverUrl },
  });
  win = await app.firstWindow();
  hookErrors();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('#lg-form');
}

async function login(user, pass) {
  await win.waitForSelector('#lg-user');
  await win.waitForSelector('.srv-dot.ok');
  await win.fill('#lg-user', user);
  await win.fill('#lg-pass', pass);
  await win.click('#lg-go');
}

async function shot(name) {
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(SHOTS, shotN++ + '-' + name + '.png') });
}

async function stubOpen(file) {
  if (DRIVER === 'neu') {
    await win.evaluate((p) => (window.__testOpenQueue = [p]), file);
    return;
  }
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
}

async function nav(label) {
  await win.click('.nav-item:has-text("' + label + '")');
  await win.waitForTimeout(150);
}

/** The registry as stored on the central server. */
async function db() {
  return server.registry();
}

async function settle() {
  await win.waitForTimeout(700); // debounce + network save
  await win.waitForFunction(() => !document.querySelector('#save-status.saving'), null, { timeout: 10000 });
}

function newest(prefix, ext) {
  const list = fs.readdirSync(SAVE).filter((f) => f.startsWith(prefix) && (!ext || f.endsWith(ext)));
  list.sort((a, b) => fs.statSync(path.join(SAVE, b)).mtimeMs - fs.statSync(path.join(SAVE, a)).mtimeMs);
  return list[0];
}

function step(msg) {
  console.log('• ' + msg);
}

async function api(method, url, body, token) {
  const r = await fetch(serverUrl + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  [DATA, CFG, SAVE, SRV].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.readdirSync(SHOTS).filter((f) => /^\d\d-/.test(f) && !f.startsWith('01-')).forEach((f) => fs.unlinkSync(path.join(SHOTS, f)));
  // the previous version left a registry on this PC
  const old = C.createEmptyDb(new Date(2026, 8, 1));
  C.createStudent(old, { am: '11111', lastName: 'ΠΑΛΙΟΣ', firstName: 'ΣΠΟΥΔΑΣΤΗΣ' });
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify(old));
  if (DRIVER === 'electron') fs.rmSync(path.join(path.dirname(DATA), 'prefs.json'), { force: true });

  server = await startServer({ dataDir: SRV });
  serverUrl = server.url;
  await launch();

  // ---------------------------------------------------------------- login & first start
  step('new server: the app asks for the administrator (username + password)');
  await win.waitForSelector('.srv-dot.ok');
  await win.waitForSelector('#su-user');
  await shot('first-setup');
  await win.fill('#su-user', ADMIN);
  await win.fill('#su-pass', ADMIN_PW);
  await win.fill('#su-pass2', 'something-else');
  await win.click('#su-go');
  await win.waitForSelector('#lg-error:has-text("δεν ταιριάζουν")');
  await win.fill('#su-pass2', ADMIN_PW);
  await win.click('#su-go');
  // empty server + data of the previous version on this PC → offer to upload it
  await win.waitForSelector('.modal:has-text("Πρώτη σύνδεση με τον διακομιστή")');
  await shot('first-connection-offer');
  await win.click('.modal-foot button:has-text("Κενό μητρώο")');
  await win.waitForSelector('#nav .nav-item');
  await settle();
  let d = await db();
  assert.ok(d && d.students.length === 0, 'empty registry created on the server');
  assert.ok((await win.textContent('#user-chip')).includes(ADMIN));

  // ---------------------------------------------------------------- students import
  step('import students');
  await nav('Εισαγωγή');
  await win.click('.tab:has-text("Σπουδαστές")');
  await stubOpen(path.join(SAMPLES, '1_Σπουδαστές_2026-2027.xlsx'));
  await win.click('.dropzone');
  await win.waitForSelector('button[data-action="tPreview"]');
  const hdr = await win.inputValue('input[data-on-change="imHeader"][data-kind="students"]');
  assert.strictEqual(hdr, '4', 'header row detected at row 4');
  await win.click('button[data-action="tPreview"]');
  await win.waitForSelector('text=Καταχώριση στο μητρώο');
  const chipsText = await win.textContent('.chips');
  assert.ok(/Νέοι σπουδαστές\s*24/.test(chipsText), 'expected 24 new: ' + chipsText);
  await win.click('button[data-action="tCommit"]');
  await win.waitForSelector('text=Το μητρώο ενημερώθηκε');
  await settle();
  d = await db();
  assert.strictEqual(d.students.length, 24);
  assert.strictEqual(d.enrollments.length, 24);
  const s0 = d.students.find((s) => s.am === '26001');
  assert.strictEqual(s0.lastName, 'ΠΑΠΑΔΟΠΟΥΛΟΣ');
  const secOf = (am) => d.enrollments.find((e) => e.studentId === d.students.find((s) => s.am === am).id);
  assert.deepStrictEqual([secOf('26001').levelId, secOf('26001').section], ['OLA', 'MO']);
  assert.deepStrictEqual([secOf('26009').levelId, secOf('26009').section], ['OLA', 'MO']); // "MORGNIN"
  assert.deepStrictEqual([secOf('26016').levelId, secOf('26016').section], ['SUP', 'M2']);

  // ---------------------------------------------------------------- subjects
  step('create subjects (bulk)');
  await nav('Μαθήματα');
  await win.click('.tab:has-text("Operational A")');
  await win.click('button[data-action="sbBulk"]');
  await win.fill('#bk-text', 'NAV101; Ναυσιπλοΐα; Deck; 2\nNAV102; Ναυτική Μετεωρολογία; Deck\nENG101; Ναυτικές Μηχανές; Engine\nENG102; Ηλεκτροτεχνία; Engine\nENGL; Ναυτικά Αγγλικά; Κοινό\nSAF; Ασφάλεια Πλοίου; Κοινό');
  await win.click('.modal-foot button:has-text("Προσθήκη")');
  await win.waitForSelector('td:has-text("Ναυσιπλοΐα")');
  await win.click('.tab:has-text("Support")');
  await win.click('button[data-action="sbNew"]');
  await win.fill('#sb-code', 'SUP01');
  await win.fill('#sb-name', 'Βασική Ασφάλεια');
  await win.click('.modal-foot button:has-text("Αποθήκευση")>>nth=1');
  await win.waitForSelector('td:has-text("Βασική Ασφάλεια")');
  await settle();
  d = await db();
  assert.strictEqual(d.subjects.length, 7);

  // ---------------------------------------------------------------- grades import: whole numbers only
  step('import teacher grades (NAV101, 0–5)');
  await nav('Εισαγωγή');
  await win.click('.tab:has-text("Βαθμολογίες καθηγητών")');
  await stubOpen(path.join(SAMPLES, '2_NAV101_Ναυσιπλοΐα_OLA.xlsx'));
  await win.click('.dropzone');
  await win.waitForSelector('select[data-on-change="gMap"]');
  const mapVal = await win.$eval('select[data-on-change="gMap"][data-col="1"]', (s) => s.options[s.selectedIndex].text);
  assert.ok(mapVal.includes('NAV101'), 'auto-mapped NAV101, got ' + mapVal);
  assert.ok(await win.isVisible('text=Δεκτοί βαθμοί: 0, 1, 2, 3, 4, 5 ή ΑΠ'));
  await shot('import-grades-mapping');
  await win.click('button[data-action="gPreview"]');
  await win.waitForSelector('button[data-action="gCommit"]');
  const gChips = await win.textContent('.chips');
  assert.ok(/Νέοι\s*8/.test(gChips), 'expected 8 new: ' + gChips);
  await win.click('button[data-action="gCommit"]');
  await win.waitForSelector('text=Η εισαγωγή ολοκληρώθηκε');

  step('per-subject export right after the import (Α.Μ. only, one sheet per class)');
  await win.click('button[data-action="exportSubject"]:has-text("NAV101")');
  await win.waitForSelector('.toast:has-text("Βαθμολογία_NAV101")');
  const swb = XLSX.readFile(path.join(SAVE, newest('Βαθμολογία_NAV101')));
  assert.deepStrictEqual(swb.SheetNames, ['OL A Deck Morning', 'OL A Deck Afternoon', 'Re-exam']);
  const srows = XLSX.utils.sheet_to_json(swb.Sheets['OL A Deck Morning'], { header: 1, defval: null });
  const sh = srows.findIndex((r) => r && r[1] === 'Α.Μ.');
  assert.deepStrictEqual(srows.slice(sh + 1).map((r) => [r[1], r[2]]), [[26001, 4], [26002, 3], [26003, 5], [26004, 2]]);

  step('decimal grades are rejected (English: one "3.5")');
  await win.click('button[data-action="imReset"][data-kind="grades"]');
  await stubOpen(path.join(SAMPLES, '3_Αγγλικά.xlsx'));
  await win.click('.dropzone');
  await win.waitForSelector('select[data-on-change="gMap"]');
  const mv = await win.$eval('select[data-on-change="gMap"][data-col="1"]', (s) => s.options[s.selectedIndex].text);
  if (!mv.includes('ENGL')) {
    const val = await win.$eval('select[data-on-change="gMap"][data-col="1"]', (s) => Array.from(s.options).find((o) => o.text.includes('ENGL')).value);
    await win.selectOption('select[data-on-change="gMap"][data-col="1"]', val);
  }
  assert.ok(await win.isVisible('text=1 τιμή δεν είναι έγκυρη'), 'decimal flagged on the mapping screen');
  await win.click('button[data-action="gPreview"]');
  await win.waitForSelector('button[data-action="gCommit"]');
  const eChips = await win.textContent('.chips');
  assert.ok(/Νέοι\s*13/.test(eChips) && /Προβλήματα\s*1/.test(eChips), 'english chips: ' + eChips);
  await win.click('.chip:has-text("Προβλήματα")');
  assert.ok(await win.isVisible('text=Δεκαδικός βαθμός'));
  await shot('import-decimal-rejected');
  await win.click('button[data-action="gCommit"]');
  await win.waitForSelector('text=Η εισαγωγή ολοκληρώθηκε');

  step('import multi-subject file (ENG101 + ENG102, "3,5" rejected)');
  await win.click('button[data-action="imReset"][data-kind="grades"]');
  await stubOpen(path.join(SAMPLES, '4_Engine_ENG101_ENG102.xlsx'));
  await win.click('.dropzone');
  await win.waitForSelector('select[data-on-change="gMap"]');
  await win.click('button[data-action="gPreview"]');
  await win.waitForSelector('button[data-action="gCommit"]');
  const mChips = await win.textContent('.chips');
  assert.ok(/Νέοι\s*11/.test(mChips), 'expected 11 new: ' + mChips);
  await win.click('button[data-action="gCommit"]');
  await win.waitForSelector('text=Η εισαγωγή ολοκληρώθηκε');
  await settle();
  d = await db();
  const eng = d.subjects.find((s) => s.code === 'ENGL');
  assert.strictEqual(d.grades.find((g) => g.subjectId === eng.id && g.studentId === s0.id).value, 4);
  assert.ok(d.grades.every((g) => g.value === null || Number.isInteger(g.value)), 'only whole grades stored');
  assert.strictEqual(d.imports.length, 4);

  // ---------------------------------------------------------------- gradebook manual edit
  step('gradebook manual edit (decimal refused)');
  await win.click('button[data-action="go"][data-page="gradebook"]');
  await win.waitForSelector('table.gb');
  await win.click('.tab:has-text("Operational A")');
  await win.waitForSelector('table.gb');
  const nav102 = d.subjects.find((s) => s.code === 'NAV102');
  await win.click('input[data-gsid="' + s0.id + '"][data-gsub="' + nav102.id + '"]');
  await win.keyboard.type('3');
  await win.keyboard.press('Enter');
  const saf = d.subjects.find((s) => s.code === 'SAF');
  await win.click('input[data-gsid="' + s0.id + '"][data-gsub="' + saf.id + '"]');
  await win.keyboard.type('5');
  await win.keyboard.press('Enter');
  const s1 = d.students.find((s) => s.am === '26002');
  await win.click('input[data-gsid="' + s1.id + '"][data-gsub="' + saf.id + '"]');
  await win.keyboard.type('2,5');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.toast.error:has-text("όχι δεκαδικοί")');
  await shot('gradebook-decimal-refused');
  await settle();
  d = await db();
  assert.ok(d.grades.some((g) => g.studentId === s0.id && g.subjectId === nav102.id && g.value === 3 && g.source === 'manual'));
  assert.ok(!d.grades.some((g) => g.studentId === s1.id && g.subjectId === saf.id));
  const res = await win.textContent('tr[data-sid="' + s0.id + '"] td.res');
  assert.ok(res.includes('Επιτυχία'), 'student 0 passes all: ' + res);
  await win.waitForTimeout(7200); // let the error toast fade
  await shot('gradebook-deck');

  // ---------------------------------------------------------------- another PC saves at the same time
  step('two PCs: a change from another PC is merged automatically; the same record on both sides → conflict dialog');
  const other = (await api('POST', '/api/login', { username: ADMIN, password: ADMIN_PW })).data.token;
  let cur = (await api('GET', '/api/registry', null, other)).data;
  cur.data.settings.levelNames = { SUP: 'Support Level' };
  assert.strictEqual((await api('PUT', '/api/registry', { baseRev: cur.rev, data: cur.data }, other)).status, 200);
  await nav('Μητρώο');
  await win.waitForSelector('table.table');
  await win.fill('#st-search', '26001');
  await win.waitForTimeout(300);
  await win.click('tr.clickable >> nth=0');
  await win.click('[data-sctab="info"]');
  await win.fill('#sf-ph', '6900000001');
  await win.click('#sf-save');
  await win.waitForSelector('.toast:has-text("Συγχωνεύτηκαν αλλαγές")');
  await settle();
  assert.ok(!(await win.isVisible('#conflict-reload')), 'no dialog for changes to different records');
  d = await db();
  assert.strictEqual(d.students.find((s) => s.am === '26001').phone, '6900000001', 'the local change is saved');
  assert.strictEqual(d.settings.levelNames.SUP, 'Support Level', 'the other PC change is kept');
  cur = (await api('GET', '/api/registry', null, other)).data;
  cur.data.students.find((s) => s.am === '26001').phone = '2100000000';
  assert.strictEqual((await api('PUT', '/api/registry', { baseRev: cur.rev, data: cur.data }, other)).status, 200);
  await win.fill('#sf-ph', '6900000002');
  await win.click('#sf-save');
  await win.waitForSelector('#conflict-reload');
  assert.ok((await win.textContent('.merge-conflicts')).includes('26001'), 'the conflicting record is listed');
  await shot('conflict');
  await win.click('#conflict-reload');
  await settle();
  await win.keyboard.press('Escape'); // the student card
  await win.fill('#st-search', '');
  d = await db();
  assert.strictEqual(d.students.find((s) => s.am === '26001').phone, '2100000000', 'the conflicting change was not written over the other PC');
  assert.strictEqual(d.settings.levelNames.SUP, 'Support Level', 'the other PC change is kept');
  assert.strictEqual(d.students.length, 24);

  // ---------------------------------------------------------------- students list + card
  step('students page + card');
  await nav('Μητρώο');
  await win.waitForSelector('table.table');
  await win.fill('#st-search', 'παπαδοπ');
  await win.waitForTimeout(300);
  await win.click('tr.clickable >> nth=0');
  await win.waitForSelector('.modal .year-block');
  await shot('student-card');
  await win.click('.modal [data-mclose]');
  await win.fill('#st-search', '');
  await win.waitForTimeout(300);
  await win.click('button[data-action="newStudent"]');
  await win.click('#sf-next');
  assert.strictEqual(await win.inputValue('#sf-am'), '26025');
  await win.fill('#sf-ln', 'ΝΕΟΣ');
  await win.fill('#sf-fn', 'ΣΠΟΥΔΑΣΤΗΣ');
  await win.selectOption('#sf-spec', 'DECK');
  await win.selectOption('#sf-level', 'OLB');
  await win.click('.modal-foot button:has-text("Αποθήκευση") >> nth=1');
  await settle();
  d = await db();
  assert.strictEqual(d.students.length, 25);

  // ---------------------------------------------------------------- export overall grades + transcripts
  step('export overall grades');
  await nav('Εξαγωγή');
  await win.click('button[data-action="exGrades"]');
  await win.waitForSelector('.toast:has-text("Αποθηκεύτηκε")');
  const wb = XLSX.readFile(path.join(SAVE, newest('Συνολική_Βαθμολογία')));
  assert.ok(wb.SheetNames.includes('Operational A - Deck'));
  assert.ok(wb.SheetNames.includes('Support') && !wb.SheetNames.some((n) => /^Support - /.test(n)), 'Support in one sheet');

  step('detailed transcript: fields Τμήμα + Μαθητής, subjects as columns');
  await win.click('button[data-action="transcriptsModal"]');
  await win.waitForSelector('#tt-cls');
  await win.selectOption('#tt-cls', 'OLA|DECK|AF');
  const st7 = d.students.find((s) => s.am === '26007');
  const opts = await win.$$eval('#tt-student option', (o) => o.map((x) => x.textContent));
  assert.ok(opts.some((t) => t.startsWith('26007 — ') && t.includes('2026-2027')), 'student dropdown of the class: ' + opts.join(' | '));
  assert.strictEqual(opts.filter((t) => /^\d{5} — /.test(t)).length, 4, 'only the 4 students of the class');
  await win.selectOption('#tt-student', st7.id);
  await win.waitForSelector('#tt-preview table');
  await shot('transcript-modal');
  await win.click('#tt-go');
  await win.waitForSelector('.toast:has-text("Αναλυτική_26007_")');
  const tfile = newest('Αναλυτική_26007_');
  assert.ok(/_OL_A_Deck_2026-2027\.xlsx$/.test(tfile), 'file name with class and year: ' + tfile);
  const twb = XLSX.readFile(path.join(SAVE, tfile));
  const trows = XLSX.utils.sheet_to_json(twb.Sheets[twb.SheetNames[0]], { header: 1, defval: null });
  const th = trows.findIndex((r) => r && r[0] === 'Α.Μ.' && r[1] === 'Ονοματεπώνυμο');
  assert.ok(th > 0, 'transposed header row');
  const theads = trows[th].filter((x) => x !== null);
  assert.ok(theads.some((x) => String(x).startsWith('NAV101')) && theads.includes('Μ.Ο.') && theads.includes('Αποτέλεσμα'), 'subjects are columns: ' + theads.join(' | '));
  assert.strictEqual(trows[th + 1][0], 26007);
  assert.ok(String(trows[th + 1][1]).includes(st7.lastName));
  assert.ok(trows.some((r) => r && String(r[0]).includes('Operational Level A Deck Afternoon') && String(r[0]).includes('2026-2027')), 'class + academic year line');
  assert.strictEqual(twb.SheetNames.length, 1, 'only this student');
  // one file per student of the class
  await win.click('button[data-action="transcriptsModal"]');
  await win.selectOption('#tt-cls', 'OLA|DECK|AF');
  await win.selectOption('#tt-student', '__each');
  await win.click('#tt-go');
  await win.waitForSelector('.toast:has-text("αρχεία")');
  const tdir = fs.readdirSync(SAVE).find((f) => f.startsWith('Αναλυτικές_') && !f.endsWith('.xlsx'));
  assert.strictEqual(fs.readdirSync(path.join(SAVE, tdir)).length, 4, 'one file per student');

  // ---------------------------------------------------------------- undo + new year + transfer
  step('undo import from history');
  await nav('Εισαγωγή');
  await win.click('.tab:has-text("Ιστορικό")');
  await settle();
  d = await db();
  const before = d.grades.length;
  await win.click('button[data-action="undoImport"] >> nth=0');
  await win.click('.modal-foot button:has-text("Αναίρεση")');
  await settle();
  d = await db();
  assert.strictEqual(d.grades.length, before - 11, 'undo removed the 11 grades of the last import');

  step('new academic year + transfer (level changes confirmed as the same students)');
  await win.selectOption('#year-select', '__new');
  await win.waitForSelector('#ny-label');
  assert.strictEqual(await win.inputValue('#ny-label'), '2027-2028');
  await win.click('.modal-foot button:has-text("Δημιουργία")');
  await win.waitForSelector('#tr-list table');
  assert.strictEqual(await win.$$eval('#tr-list tbody tr', (t) => t.length), 25, 'all enrolled students listed');
  await win.click('#tr-go');
  await win.waitForSelector('#same-table');
  assert.ok((await win.textContent('#same-table')).includes('26001'), 'the promoted student is listed');
  await shot('same-students-transfer');
  await win.click('#same-ok');
  await settle();
  d = await db();
  const y1 = d.years.find((y) => y.label === '2026-2027');
  const y2 = d.years.find((y) => y.label === '2027-2028');
  const enY2 = (am) => d.enrollments.find((e) => e.yearId === y2.id && e.studentId === d.students.find((s) => s.am === am).id);
  assert.deepStrictEqual([enY2('26001').levelId, enY2('26001').section], ['OLB', 'MO'], 'passing student promoted to OLB, same class');
  assert.deepStrictEqual([enY2('26007').levelId, enY2('26007').section], ['OLA', 'AF'], 'failing student repeats OLA');

  step('manual entry of an existing Α.Μ. with the same name into another class → "same student?"');
  const sup = d.students.find((s) => s.am === '26016'); // Support Morning 2 in 2026-2027
  await nav('Μητρώο');
  await win.click('button[data-action="newStudent"]');
  await win.fill('#sf-am', '26016');
  await win.waitForSelector('#sf-am-hint.warning-text');
  await win.fill('#sf-ln', sup.lastName);
  await win.fill('#sf-fn', sup.firstName);
  await win.selectOption('#sf-spec', 'ENGINE');
  await win.selectOption('#sf-level', 'OLA');
  await win.click('.modal-foot button:has-text("Αποθήκευση") >> nth=1');
  await win.waitForSelector('.modal:has-text("Είναι ο ίδιος σπουδαστής;")');
  assert.ok(await win.isVisible('.modal:has-text("Support Morning 2")'), 'shows the previous class');
  await shot('same-student-confirm');
  await win.click('#same-ok');
  await settle();
  d = await db();
  assert.strictEqual(d.students.filter((s) => s.am === '26016').length, 1, 'no duplicate student');
  assert.strictEqual(enY2('26016').levelId, 'OLA', 'the same record enters OL A in 2027-2028');

  // transcript of a student across years: the Support year is taken automatically
  await nav('Εξαγωγή');
  await win.click('button[data-action="transcriptsModal"]');
  await win.selectOption('#tt-cls', 'SUP||M2');
  await win.selectOption('#tt-student', sup.id);
  await win.click('#tt-go');
  await win.waitForSelector('.toast:has-text("Αναλυτική_26016_")');
  assert.ok(/_Support_2026-2027\.xlsx$/.test(newest('Αναλυτική_26016_')), 'Support transcript carries its own year: ' + newest('Αναλυτική_26016_'));
  await win.selectOption('#year-select', y1.id);

  // ---------------------------------------------------------------- accounts
  step('student accounts from Α.Μ.');
  await nav('Λογαριασμοί');
  await win.waitForSelector('select[data-on-change="acClass"]');
  const acKey = await win.$eval('select[data-on-change="acClass"]', (s) => Array.from(s.options).find((o) => o.text.startsWith('Operational Level A Deck Morning')).value);
  await win.selectOption('select[data-on-change="acClass"]', acKey);
  await win.waitForTimeout(200);
  await win.check('input[data-on-change="acAll"]');
  await win.click('button[data-action="acCreate"]');
  await win.waitForSelector('.cred-table');
  await shot('accounts-created');
  await win.click('#cred-excel');
  await win.waitForSelector('.toast:has-text("Κωδικοί_σπουδαστών")');
  await win.click('.modal-foot button:has-text("Κλείσιμο")');
  const cwb = XLSX.readFile(path.join(SAVE, newest('Κωδικοί_σπουδαστών')));
  const crows = XLSX.utils.sheet_to_json(cwb.Sheets['Κωδικοί'], { header: 1, defval: null });
  const cred = crows.find((r) => r && r[1] === 26001);
  assert.ok(cred && /^[a-z0-9]{8}$/.test(cred[5]), 'password in the credentials file');
  const studentPw = cred[5];
  await shot('accounts');

  // ---------------------------------------------------------------- exams (admin)
  step('create an exam: questions from Excel, assign, schedule, publish');
  const qx = new ExcelJS.Workbook();
  const qws = qx.addWorksheet('Ερωτήσεις');
  qws.addRow(['Ερώτηση', 'Τύπος', 'Α', 'Β', 'Γ', 'Δ', 'Σωστή', 'Μονάδες']);
  qws.addRow(['Μονάδα ταχύτητας πλοίου;', '', 'km/h', 'knots', 'm/s', '', 'Β', 1]);
  qws.addRow(['Χρώματα πλευρικών φανών;', '', 'Κόκκινο', 'Πράσινο', 'Μπλε', '', 'Α, Β', 1]);
  qws.addRow(['Η πυξίδα δείχνει τον μαγνητικό βορρά.', '', '', '', '', '', 'Σωστό', 1]);
  qws.addRow(['Γλώσσα επικοινωνίας γέφυρας (SMCP);', '', '', '', '', '', 'Αγγλικά | English', 1]);
  const qfile = path.join(SAVE, 'questions.xlsx');
  await qx.xlsx.writeFile(qfile);
  await nav('Εξετάσεις');
  await win.waitForSelector('#ex-new');
  await shot('exams-empty');
  await win.click('#ex-new');
  await win.waitForSelector('#ex-title');
  const nav101 = d.subjects.find((s) => s.code === 'NAV101');
  await win.selectOption('select[data-on-change="exSubject"]', nav101.id);
  await win.fill('#ex-title', '1η Πρόοδος Ναυσιπλοΐας');
  const now = new Date(Date.now() - 60000);
  const p2 = (n) => String(n).padStart(2, '0');
  await win.fill('#ex-date', now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()));
  await win.fill('#ex-time', p2(now.getHours()) + ':' + p2(now.getMinutes()));
  await win.fill('#ex-dur', '30');
  await win.check('#ex-counts');
  await stubOpen(qfile);
  await win.click('button[data-action="exQImport"]');
  await win.waitForSelector('#qi-go');
  assert.ok((await win.textContent('.modal')).includes('Βρέθηκαν 4 ερωτήσεις'));
  await win.click('#qi-go');
  await win.waitForSelector('.q-card >> nth=3');
  await win.click('#ex-assign');
  await win.waitForSelector('#as-body');
  await win.click('#as-roster'); // everybody who has NAV101 (8 Deck students)
  assert.ok((await win.textContent('#as-count')).startsWith('8 '), await win.textContent('#as-count'));
  await win.click('#as-ok');
  await win.waitForSelector('text=Ανάθεση σε σπουδαστές (8)');
  await shot('exam-editor');
  await win.click('#ex-save');
  await win.waitForSelector('.toast:has-text("Η εξέταση αποθηκεύτηκε")');
  await win.click('#ex-publish');
  await win.waitForSelector('.modal:has-text("Δημοσίευση εξέτασης")');
  assert.ok((await win.textContent('.modal')).includes('4 σπουδαστές δεν έχουν'), '4 of the 8 without an account');
  await win.click('.modal-foot button:has-text("Δημοσίευση")');
  await win.waitForSelector('.toast:has-text("δημοσιεύτηκε")');
  const exRow = server.exams()[0];
  assert.strictEqual(exRow.status, 'published');
  assert.strictEqual(exRow.countsFinal, true);
  assert.strictEqual(exRow.questions.length, 4);
  assert.strictEqual(exRow.assignments.length, 8);
  await win.click('button[data-action="exBack"]');
  await win.waitForSelector('tr.clickable');
  await shot('exams-list');

  // ---------------------------------------------------------------- the student takes the exam
  step('student logs in: English portal, sees only his exam, no grades; takes it');
  assert.strictEqual(await win.evaluate(() => window.Remote.lang), 'el', 'the administrator works in Greek');
  await win.click('button[data-action="logout"]');
  await win.waitForSelector('#lg-form');
  assert.ok(await win.isVisible('#lg-lang-el.on'), 'login screen in Greek by default');
  await login('26001', studentPw);
  await win.waitForSelector('.exam-card');
  await shot('student-exams');
  let sp = await win.textContent('#student-root');
  assert.ok(sp.includes('1η Πρόοδος Ναυσιπλοΐας'));
  assert.ok(sp.includes('My exams') && sp.includes('Available now') && sp.includes('Sign out'), 'the student portal is in English');
  assert.ok(!/Εξετάσεις|Έξοδος|Έναρξη|λεπτά|ερωτήσεις/.test(sp), 'no Greek interface texts on the student screen');
  assert.strictEqual(await win.evaluate(() => [window.Remote.lang, document.documentElement.lang].join()), 'en,en');
  assert.ok(!/Βαθμ|Μ\.Ο\.|Επιτυχία|Αποτέλεσμα|\bgrades?\b|\bscores?\b|\bresults?\b|\baverage\b/i.test(sp), 'no grades anywhere on the student screen');
  assert.ok(!(await win.isVisible('#nav')), 'no admin navigation');
  // Syllabus tab (this server may not have the syllabus yet: then an English error card with «Try again»)
  await win.click('#sp-tab-syllabus');
  await win.waitForSelector('.sp-body h2:has-text("Syllabus")');
  await win.waitForSelector('.sy-list, .sp-body .card:has-text("No subjects"), [data-sx="syreload"]');
  await shot('student-syllabus');
  await win.click('#sp-tab-exams');
  await win.waitForSelector('[data-sx="start"]');
  await win.click('[data-sx="start"]');
  await win.click('.modal-foot button:has-text("Start")');
  await win.waitForSelector('.xm-q');
  await shot('student-exam-question');
  for (let i = 0; i < 4; i++) {
    const qt = await win.textContent('.xm-qtext');
    if (qt.includes('ταχύτητας')) await win.click('.xm-opt:has-text("knots")');
    else if (qt.includes('φανών')) await win.click('.xm-opt:has-text("Κόκκινο")'); // only one of the two → wrong
    else if (qt.includes('πυξίδα')) await win.click('.xm-opt:has-text("True")');
    else await win.fill('#xm-short', 'english');
    await win.waitForTimeout(150);
    if (i < 3) await win.click('[data-sx="next"]');
  }
  await win.waitForSelector('#xm-save:has-text("Saved")');
  await win.waitForTimeout(800);
  await shot('student-exam-answered');
  await win.click('#xm-side [data-sx="submit"]');
  await win.waitForSelector('.modal:has-text("Submit exam")');
  await win.click('.modal-foot button:has-text("Submit")');
  await win.waitForSelector('.xm-done');
  await shot('student-exam-submitted');
  sp = await win.textContent('#student-root');
  assert.ok(sp.includes('Exam submitted'));
  assert.ok(!/\d+\s*%|Βαθμ|μονάδες|\bscore|\bgrade|\bpoints\b/i.test(sp), 'no score after submitting');
  await win.click('[data-sx="back"]');
  await win.waitForSelector('.pill-state.ok:has-text("Submitted")');
  await win.click('[data-sx="logout"]');
  await win.waitForSelector('#lg-form');
  assert.strictEqual(await win.evaluate(() => window.Remote.lang), 'el', 'back on the (Greek) login screen');

  // ---------------------------------------------------------------- results (admin)
  step('admin sees the automatic score; exports the results');
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await nav('Εξετάσεις');
  await win.waitForSelector('button[data-action="exResults"]');
  await win.click('button[data-action="exResults"]');
  await win.waitForSelector('#ex-res-excel');
  await win.waitForSelector('td.am:has-text("26001")');
  await shot('exam-results');
  const rrow = await win.textContent('tr:has(td.am:has-text("26001"))');
  assert.ok(rrow.includes('3 / 4') && rrow.includes('75%'), 'score 3/4: ' + rrow);
  await win.click('#ex-res-excel');
  await win.waitForSelector('.toast:has-text("Αποτελέσματα_")');
  const rwb = XLSX.readFile(path.join(SAVE, newest('Αποτελέσματα_')));
  const rr = XLSX.utils.sheet_to_json(rwb.Sheets['Αποτελέσματα'], { header: 1, defval: null });
  const r1 = rr.find((r) => r && r[1] === 26001);
  assert.strictEqual(r1[7], 3, 'grade 0–5 in the results file (75% → 3)');
  assert.ok(rwb.SheetNames.includes('Ανάλυση ερωτήσεων'));
  // the test score never enters the gradebook
  d = await db();
  assert.ok(!d.grades.some((g) => g.source && /exam/i.test(g.source)), 'no grades written by the exam');

  // ---------------------------------------------------------------- settings + restart
  step('settings (server backups)');
  await nav('Ρυθμίσεις');
  await win.waitForSelector('#backup-list table');
  await win.waitForSelector('#local-data-box .callout');
  await shot('settings');

  step('restart: log in again, data comes from the server');
  await app.close();
  await launch();
  await login(ADMIN, ADMIN_PW);
  await win.waitForSelector('#nav .nav-item');
  await nav('Μητρώο');
  const count = await win.textContent('.card-head h3');
  assert.ok(count.includes('σπουδαστ'), count);
  d = await db();
  assert.strictEqual(d.students.length, 25);
  await app.close();
  await server.stop(true);

  if (errors.length) {
    console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else console.log('E2E OK — no console errors');
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  try {
    await win.screenshot({ path: path.join(SHOTS, '99-failure.png') });
  } catch (e2) {}
  if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
  try {
    await app.close();
  } catch (e3) {}
  try {
    await server.stop(true);
  } catch (e4) {}
  process.exit(1);
});
