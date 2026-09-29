const assert = require('assert');
const C = require('../src/core.js');

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL', name, '\n  ', e.message);
    process.exitCode = 1;
  }
}

t('academic year label', () => {
  assert.strictEqual(C.academicYearLabelFor(new Date(2026, 8, 25)), '2026-2027');
  assert.strictEqual(C.academicYearLabelFor(new Date(2027, 2, 1)), '2026-2027');
  assert.strictEqual(C.nextYearLabel('2026-2027'), '2027-2028');
  assert.strictEqual(C.parseYearLabel('2026-27').label, '2026-2027');
  assert.strictEqual(C.parseYearLabel('2026-2028'), null);
});

t('percent to grade', () => {
  assert.strictEqual(C.percentToGrade(49.9), 0);
  assert.strictEqual(C.percentToGrade(50), 1);
  assert.strictEqual(C.percentToGrade(59), 1);
  assert.strictEqual(C.percentToGrade(60), 2);
  assert.strictEqual(C.percentToGrade(75), 3);
  assert.strictEqual(C.percentToGrade(89), 4);
  assert.strictEqual(C.percentToGrade(90), 5);
  assert.strictEqual(C.percentToGrade(100), 5);
  assert.strictEqual(C.gradeBand(2), '60–69%');
  assert.strictEqual(C.gradeBand(5), '90–100%');
  assert.strictEqual(C.gradeBand(0), 'κάτω από 50%');
});

t('parse grade cells — whole numbers 0–5 or ΑΠ only', () => {
  assert.deepStrictEqual(C.parseGradeCell(3, 'auto'), { kind: 'grade', value: 3, percent: null });
  [0, 1, 2, 3, 4, 5, '0', '5', ' 4 ', '4,0', 4.0].forEach((v) => assert.strictEqual(C.parseGradeCell(v).kind, 'grade', 'accept ' + v));
  // decimals are rejected (no rational grades)
  ['3,5', '3.5', 3.5, 4.25, '0,5'].forEach((v) => {
    const p = C.parseGradeCell(v);
    assert.strictEqual(p.kind, 'invalid', 'reject ' + v);
    assert.ok(/Δεκαδικός/.test(p.reason), 'reason for ' + v);
  });
  assert.strictEqual(C.parseGradeCell({ v: 45, w: '4,5' }).kind, 'invalid'); // CSV thousands-separator misread → still decimal
  // out of scale / percentages
  assert.strictEqual(C.parseGradeCell(7).kind, 'invalid');
  assert.strictEqual(C.parseGradeCell(72).kind, 'invalid');
  assert.strictEqual(C.parseGradeCell('85%').kind, 'invalid');
  assert.strictEqual(C.parseGradeCell({ v: 0.72, w: '72%' }).kind, 'invalid');
  assert.strictEqual(C.parseGradeCell(-1).kind, 'invalid');
  assert.strictEqual(C.parseGradeCell('ΑΠ', 'auto').kind, 'absent');
  assert.strictEqual(C.parseGradeCell('Απών', 'auto').kind, 'absent');
  assert.strictEqual(C.parseGradeCell('Α.Π.', 'auto').kind, 'absent');
  assert.strictEqual(C.parseGradeCell('AΠ', 'auto').kind, 'absent');
  assert.strictEqual(C.parseGradeCell('-', 'auto').kind, 'empty');
  assert.strictEqual(C.parseGradeCell('', 'auto').kind, 'empty');
  assert.strictEqual(C.parseGradeCell('abc', 'auto').kind, 'invalid');
  assert.strictEqual(C.detectValueMode([1, 55, 90]), 'scale');
  assert.strictEqual(C.percentToGrade(0.3 * 1 + 0.7 * 71), 1); // 49.999999 → 50
  assert.strictEqual(C.parseManualGrade('-').error !== undefined, true);
  assert.ok(C.parseManualGrade('3,5').error);
  assert.ok(C.parseManualGrade('2.5').error);
  assert.deepStrictEqual(C.parseManualGrade('4'), { value: 4, absent: false });
  assert.deepStrictEqual(C.parseManualGrade('απ'), { absent: true, value: null });
});

t('column role guessing', () => {
  assert.strictEqual(C.guessColumnRole('Α.Μ.'), 'am');
  assert.strictEqual(C.guessColumnRole('Αριθμός Μητρώου'), 'am');
  assert.strictEqual(C.guessColumnRole('ID number'), 'am');
  assert.strictEqual(C.guessColumnRole('Ονοματεπώνυμο'), 'fullName');
  assert.strictEqual(C.guessColumnRole('Επώνυμο'), 'lastName');
  assert.strictEqual(C.guessColumnRole('Όνομα'), 'firstName');
  assert.strictEqual(C.guessColumnRole('Πατρώνυμο'), 'fatherName');
  assert.strictEqual(C.guessColumnRole('Βαθμός'), 'grade');
  assert.strictEqual(C.guessColumnRole('Ειδικότητα'), 'specialty');
  assert.strictEqual(C.guessColumnRole('Επίπεδο'), 'level');
  assert.strictEqual(C.guessColumnRole('Α/Α'), 'index');
});

t('specialty/level parsing', () => {
  assert.strictEqual(C.parseSpecialty('Deck'), 'DECK');
  assert.strictEqual(C.parseSpecialty('Πλοίαρχοι'), 'DECK');
  assert.strictEqual(C.parseSpecialty('ENGINE'), 'ENGINE');
  assert.strictEqual(C.parseSpecialty('Μηχανικοί'), 'ENGINE');
  assert.strictEqual(C.parseLevel('Support'), 'SUP');
  assert.strictEqual(C.parseLevel('Operational Level A'), 'OLA');
  assert.strictEqual(C.parseLevel('operational level b'), 'OLB');
  assert.strictEqual(C.parseLevel('OL B'), 'OLB');
  assert.strictEqual(C.parseLevel('Management Deck or Engn Fun 2'), 'MF2');
  assert.strictEqual(C.parseLevel('Management Deck or Engine Function 3'), 'MF3');
  assert.strictEqual(C.parseLevel('MF1'), 'MF1');
  assert.strictEqual(C.parseLevel('xyz'), null);
});

t('names', () => {
  assert.deepStrictEqual(C.splitFullName('ΠΑΠΑΔΟΠΟΥΛΟΣ ΓΕΩΡΓΙΟΣ', 'LF'), { lastName: 'ΠΑΠΑΔΟΠΟΥΛΟΣ', firstName: 'ΓΕΩΡΓΙΟΣ' });
  assert.deepStrictEqual(C.splitFullName('Γιώργος Παπαδόπουλος', 'FL'), { firstName: 'Γιώργος', lastName: 'Παπαδόπουλος' });
});

function sampleDb() {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const s1 = C.createStudent(db, { am: '1001', lastName: 'Αλεξίου', firstName: 'Νίκος', specialty: 'DECK' });
  const s2 = C.createStudent(db, { am: '1002', lastName: 'Βασιλείου', firstName: 'Μαρία', specialty: 'ENGINE' });
  const s3 = C.createStudent(db, { am: '00123', lastName: 'Γεωργίου', firstName: 'Κώστας', specialty: 'DECK' });
  [s1, s2, s3].forEach((s) => C.setEnrollment(db, s.id, y, 'OLA'));
  const nav = C.createSubject(db, { levelId: 'OLA', code: 'N101', name: 'Ναυσιπλοΐα', specialty: 'DECK' });
  const eng = C.createSubject(db, { levelId: 'OLA', code: 'E101', name: 'Μηχανές', specialty: 'ENGINE' });
  const eng2 = C.createSubject(db, { levelId: 'OLA', code: 'C101', name: 'Αγγλικά', specialty: 'COMMON', weight: 2 });
  return { db, y, s1, s2, s3, nav, eng, eng2 };
}

t('AM validation & suggestion', () => {
  const { db } = sampleDb();
  assert.ok(C.validateAm(db, '1001'));
  assert.strictEqual(C.validateAm(db, '1003'), null);
  assert.strictEqual(C.suggestNextAm(db), '1003');
  assert.throws(() => C.createStudent(db, { am: ' 1001 ', lastName: 'X' }));
  assert.strictEqual(C.findStudentByAm(db, 123).lastName, 'Γεωργίου'); // leading zeros dropped by Excel
});

t('grade import plan & commit & undo', () => {
  const { db, y, s1, s2, nav, eng2 } = sampleDb();
  const table = {
    headers: [{ index: 0 }, { index: 1 }, { index: 2 }],
    rows: [
      { rowNum: 2, cells: [1001, 4, 3] },
      { rowNum: 3, cells: [1002, 2, 5] }, // engine student with Deck subject → warning
      { rowNum: 4, cells: [9999, 3, 3] }, // unknown
      { rowNum: 5, cells: [123, '', 'ΑΠ'] }, // loose match
      { rowNum: 6, cells: [1001, 4, 3] }, // duplicate with identical values
      { rowNum: 7, cells: [null, null, null] },
    ],
  };
  const plan = C.planGradeImport(db, {
    table,
    amCol: 0,
    columns: [
      { col: 1, subjectId: nav.id },
      { col: 2, subjectId: eng2.id },
    ],
    mode: 'auto',
    yearId: y,
  });
  assert.strictEqual(plan.summary.new, 5);
  assert.strictEqual(plan.summary.unknown_am, 2);
  assert.strictEqual(plan.summary.duplicate, 2);
  assert.strictEqual(plan.summary.empty, 1);
  const w = plan.items.find((i) => i.student && i.student.id === s2.id && i.subject.id === nav.id);
  assert.deepStrictEqual(w.warnings, ['specialty']);
  const rec = C.commitGradeImport(db, plan, { fileName: 'test.xlsx' });
  assert.strictEqual(rec.stats.added, 5);
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y).value, 4);
  // re-import with a change → update
  const plan2 = C.planGradeImport(db, {
    table: { rows: [{ rowNum: 2, cells: [1001, 5] }, { rowNum: 3, cells: [1002, 2] }] },
    amCol: 0,
    columns: [{ col: 1, subjectId: nav.id }],
    mode: 'scale',
    yearId: y,
  });
  assert.strictEqual(plan2.summary.update, 1);
  assert.strictEqual(plan2.summary.same, 1);
  const rec2 = C.commitGradeImport(db, plan2, {});
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y).value, 5);
  C.undoImport(db, rec2.id);
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y).value, 4);
  const r = C.undoImport(db, rec.id);
  assert.strictEqual(r.reverted, 5);
  assert.strictEqual(db.grades.length, 0);
});

t('results & weighted average', () => {
  const { db, y, s1, nav, eng2 } = sampleDb();
  C.setGrade(db, s1.id, nav.id, y, { value: 2 });
  let r = C.studentResult(db, s1, y, 'OLA');
  assert.strictEqual(r.status, 'incomplete');
  C.setGrade(db, s1.id, eng2.id, y, { value: 5 });
  r = C.studentResult(db, s1, y, 'OLA');
  assert.strictEqual(r.status, 'pass');
  assert.strictEqual(r.avg, 4); // (2*1 + 5*2)/3
  C.setGrade(db, s1.id, nav.id, y, { value: 0 });
  r = C.studentResult(db, s1, y, 'OLA');
  assert.strictEqual(r.status, 'fail');
  const sheet = C.buildGradeSheet(db, y, 'OLA', 'DECK');
  assert.strictEqual(sheet.subjects.length, 2);
  assert.strictEqual(sheet.rows.length, 2);
});

t('student import plan & commit & undo', () => {
  const { db, y } = sampleDb();
  const table = {
    rows: [
      { rowNum: 2, cells: ['1001', 'ΑΛΕΞΙΟΥ ΝΙΚΟΛΑΟΣ', 'Deck', 'Operational Level B'] },
      { rowNum: 3, cells: ['2001', 'ΔΗΜΗΤΡΙΟΥ ΕΛΕΝΗ', 'Engine', ''] },
      { rowNum: 4, cells: ['', 'ΧΩΡΙΣ ΑΜ', 'Deck', ''] },
      { rowNum: 5, cells: ['2001', 'ΔΙΠΛΟΣ', 'Deck', ''] },
    ],
  };
  const plan = C.planStudentImport(db, {
    table,
    map: { am: 0, fullName: 1, specialty: 2, level: 3, lastName: -1, firstName: -1 },
    nameOrder: 'LF',
    defaults: { yearId: y, levelId: 'SUP', specialty: '' },
    updateExisting: true,
  });
  assert.strictEqual(plan.summary.new, 1);
  assert.strictEqual(plan.summary.update, 1);
  assert.strictEqual(plan.summary.invalid, 1);
  assert.strictEqual(plan.summary.duplicate, 1);
  assert.strictEqual(plan.items[0].enroll, 'change');
  assert.strictEqual(plan.items[1].levelId, 'SUP');
  const before = db.students.length;
  const rec = C.commitStudentImport(db, plan, {});
  assert.strictEqual(db.students.length, before + 1);
  assert.strictEqual(C.findStudentByAm(db, '1001').firstName, 'ΝΙΚΟΛΑΟΣ');
  assert.strictEqual(C.getEnrollment(db, C.findStudentByAm(db, '1001').id, y).levelId, 'OLB');
  C.undoImport(db, rec.id);
  assert.strictEqual(db.students.length, before);
  assert.strictEqual(C.findStudentByAm(db, '1001').firstName, 'Νίκος');
  assert.strictEqual(C.getEnrollment(db, C.findStudentByAm(db, '1001').id, y).levelId, 'OLA');
});

t('header detection', () => {
  const grid = [
    [{ v: 'GMC Maritime Academy' }],
    [{ v: 'Μάθημα: Ναυσιπλοΐα' }],
    [],
    [{ v: 'Α/Α' }, { v: 'Α.Μ.' }, { v: 'Βαθμός' }],
    [{ v: 1 }, { v: 1001 }, { v: 4 }],
  ];
  assert.strictEqual(C.detectHeaderRow(grid), 3);
  const tbl = C.tableFromGrid(grid, 3);
  assert.strictEqual(tbl.rows.length, 1);
  assert.strictEqual(tbl.headers[1].title, 'Α.Μ.');
  assert.ok(C.columnLooksNumeric(tbl, 2));
});

t('zero padded AM cells', () => {
  assert.strictEqual(C.cellText({ v: 123, w: '00123' }), '00123');
  assert.strictEqual(C.cellText({ v: 26001, w: '26,001' }), '26001');
  assert.strictEqual(C.cellText({ v: 0.72, w: '72%' }), '72%');
});

t('bulk subject lines', () => {
  const out = C.parseSubjectLines('N101; Ναυσιπλοΐα; Deck; 2\nΑγγλικά\nE1\tΜηχανές\tEngine');
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[0], { code: 'N101', name: 'Ναυσιπλοΐα', specialty: 'DECK', weight: 2 });
  assert.strictEqual(out[1].name, 'Αγγλικά');
  assert.strictEqual(out[2].specialty, 'ENGINE');
});


t('students without specialty are not lost', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Β', specialty: '' });
  C.setEnrollment(db, a.id, y, 'SUP');
  C.createSubject(db, { levelId: 'SUP', name: 'Deck only', specialty: 'DECK' });
  assert.strictEqual(C.enrolledStudents(db, y, 'SUP', 'DECK').length, 0);
  assert.strictEqual(C.enrolledStudents(db, y, 'SUP', 'NONE').length, 1);
  assert.strictEqual(C.buildGradeSheet(db, y, 'SUP', 'NONE').subjects.length, 1);
});
t('conflicting duplicates are not imported; same-value re-import protects grades', () => {
  const { db, y, s1, s2, nav } = sampleDb();
  let plan = C.planGradeImport(db, { table: { rows: [{ rowNum: 2, cells: [1001, 4] }, { rowNum: 3, cells: [1001, 2] }, { rowNum: 4, cells: [1002, 3] }] }, amCol: 0, columns: [{ col: 1, subjectId: nav.id }], mode: 'scale', yearId: y });
  assert.strictEqual(plan.summary.duplicate, 2);
  assert.strictEqual(plan.summary.new, 1);
  const recA = C.commitGradeImport(db, plan, {});
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y), null);
  // B re-imports the same value for s2 → B owns it; undoing A must keep it
  plan = C.planGradeImport(db, { table: { rows: [{ rowNum: 2, cells: [1002, 3] }] }, amCol: 0, columns: [{ col: 1, subjectId: nav.id }], mode: 'scale', yearId: y });
  assert.strictEqual(plan.summary.same, 1);
  const recB = C.commitGradeImport(db, plan, {});
  C.undoImport(db, recA.id);
  assert.strictEqual(C.getGrade(db, s2.id, nav.id, y).value, 3);
  // then undoing B must not bring back A's (undone) value
  C.undoImport(db, recB.id);
  assert.strictEqual(C.getGrade(db, s2.id, nav.id, y), null);
});

t('out-of-order undo does not resurrect undone values', () => {
  const { db, y, s1, nav } = sampleDb();
  const imp = (v) => C.commitGradeImport(db, C.planGradeImport(db, { table: { rows: [{ rowNum: 2, cells: [1001, v] }] }, amCol: 0, columns: [{ col: 1, subjectId: nav.id }], mode: 'scale', yearId: y }), {});
  const a = imp(2);
  const b = imp(4);
  const ra = C.undoImport(db, a.id);
  assert.strictEqual(ra.conflicts, 1);
  C.undoImport(db, b.id);
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y), null);
});

t('AM leading-zero collisions', () => {
  const { db } = sampleDb();
  assert.ok(C.validateAm(db, '000123')); // 00123 exists
  assert.ok(C.validateAm(db, '01001'));
  const plan = C.planStudentImport(db, {
    table: { rows: [{ rowNum: 2, cells: ['0555', 'Α Β'] }, { rowNum: 3, cells: ['555', 'Γ Δ'] }] },
    map: { am: 0, fullName: 1 }, nameOrder: 'LF', defaults: { yearId: db.years[0].id, levelId: '', specialty: '' }, updateExisting: true,
  });
  assert.strictEqual(plan.summary.new, 1);
  assert.strictEqual(plan.summary.duplicate, 1);
});

t('student import: different person with same AM is a conflict', () => {
  const { db } = sampleDb();
  const plan = C.planStudentImport(db, {
    table: { rows: [{ rowNum: 2, cells: ['1001', 'ΖΑΦΕΙΡΙΟΥ ΠΕΤΡΟΣ'] }] },
    map: { am: 0, fullName: 1 }, nameOrder: 'LF', defaults: { yearId: db.years[0].id, levelId: '', specialty: '' }, updateExisting: true,
  });
  assert.strictEqual(plan.summary.conflict, 1);
  C.commitStudentImport(db, plan, {});
  assert.strictEqual(C.findStudentByAm(db, '1001').lastName, 'Αλεξίου');
});

t('student undo keeps manual changes made after the import', () => {
  const { db, y } = sampleDb();
  const plan = C.planStudentImport(db, {
    table: { rows: [{ rowNum: 2, cells: ['3001', 'ΝΕΟΣ ΑΝΘΡΩΠΟΣ', 'OLB'] }, { rowNum: 3, cells: ['1001', 'ΑΛΕΞΙΟΥ ΝΙΚΟΛΑΟΣ', 'OLB'] }] },
    map: { am: 0, fullName: 1, level: 2 }, nameOrder: 'LF', defaults: { yearId: y, levelId: '', specialty: '' }, updateExisting: true,
  });
  const rec = C.commitStudentImport(db, plan, {});
  const s = C.findStudentByAm(db, '1001');
  C.setEnrollment(db, s.id, y, 'MF1'); // manual change after import
  const r = C.undoImport(db, rec.id);
  assert.strictEqual(C.getEnrollment(db, s.id, y).levelId, 'MF1');
  assert.strictEqual(s.firstName, 'Νίκος');
  assert.strictEqual(C.findStudentByAm(db, '3001'), null);
  assert.ok(r.conflicts >= 1);
});

t('inactive subject only counts where graded', () => {
  const { db, y, s1, s3, nav, eng2 } = sampleDb();
  const saf = C.createSubject(db, { levelId: 'OLA', name: 'Παλιό', specialty: 'COMMON' });
  C.setGrade(db, s1.id, saf.id, y, { value: 3 });
  C.updateSubject(db, saf.id, { active: false });
  C.setGrade(db, s3.id, nav.id, y, { value: 3 });
  C.setGrade(db, s3.id, eng2.id, y, { value: 3 });
  assert.strictEqual(C.studentResult(db, s3, y, 'OLA').status, 'pass');
  assert.strictEqual(C.studentResult(db, s1, y, 'OLA').total, 3);
});

t('management levels are named per specialty', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  assert.strictEqual(C.levelName(db, 'MF1', 'DECK'), 'Management Deck Function 1');
  assert.strictEqual(C.levelName(db, 'MF3', 'ENGINE'), 'Management Engine Function 3');
  assert.strictEqual(C.levelName(db, 'MF2'), 'Management Function 2');
  assert.strictEqual(C.levelName(db, 'OLA', 'DECK'), 'Operational Level A');
  assert.ok(!C.LEVELS.some((l) => /deck or engine/i.test(l.name)));
  assert.strictEqual(C.parseLevel('Management Engine Function 2'), 'MF2');
  assert.strictEqual(C.parseLevel('Management Deck F3'), 'MF3');
  db.settings.levelNames = { 'MF1:DECK': 'Πλοίαρχοι Α' };
  assert.strictEqual(C.levelName(db, 'MF1', 'DECK'), 'Πλοίαρχοι Α');
  assert.strictEqual(C.levelName(db, 'MF1', 'ENGINE'), 'Management Engine Function 1');
  assert.strictEqual(C.parseLevel('Πλοίαρχοι Α', db), 'MF1');
  // specialty is taken from the level text when there is no specialty column
  const plan = C.planStudentImport(db, {
    table: { rows: [{ rowNum: 2, cells: ['5001', 'ΑΑΑ ΒΒΒ', 'Management Engine Function 1'] }] },
    map: { am: 0, fullName: 1, level: 2 }, nameOrder: 'LF', defaults: { yearId: db.years[0].id, levelId: '', specialty: '' }, updateExisting: true,
  });
  assert.strictEqual(plan.items[0].levelId, 'MF1');
  assert.strictEqual(plan.items[0].data.specialty, 'ENGINE');
});

t('classes (τμήματα)', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  assert.strictEqual(C.guessColumnRole('Τμήμα'), 'section');
  assert.strictEqual(C.guessColumnRole('Ειδικότητα'), 'specialty');
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '2', lastName: 'Β', firstName: 'Β', specialty: 'ENGINE' });
  const c = C.createStudent(db, { am: '3', lastName: 'Γ', firstName: 'Γ', specialty: 'DECK' });
  C.setEnrollment(db, a.id, y, 'SUP', 'M2');
  C.setEnrollment(db, b.id, y, 'SUP', 'M1');
  assert.strictEqual(C.studentSection(db, a, y), 'M2');
  C.setEnrollment(db, a.id, y, 'OLA'); // M2 is not valid in OL → cleared
  assert.strictEqual(C.studentSection(db, a, y), null);
  C.setEnrollment(db, a.id, y, 'OLA', 'AF');
  assert.strictEqual(C.classFullName(db, 'OLA', 'DECK', 'AF'), 'Operational Level A Deck Afternoon');
  assert.strictEqual(C.classFullName(db, 'SUP', null, 'M1'), 'Support Morning 1');
  assert.strictEqual(C.classShortName('OLB', 'ENGINE', 'MO'), 'OL B Engine Morning');
  // management: shift for the whole class
  C.setEnrollment(db, c.id, y, 'MF1', 'MO');
  assert.strictEqual(C.getEnrollment(db, c.id, y).section, null);
  assert.strictEqual(C.studentSection(db, c, y), null);
  C.setMgmtShift(db, y, 'MF1', 'DECK', 'AF');
  assert.strictEqual(C.studentSection(db, c, y), 'AF');
  assert.strictEqual(C.classFullName(db, 'MF1', 'DECK', 'AF'), 'Management Deck Function 1 Afternoon');
  assert.strictEqual(C.enrolledStudents(db, y, 'SUP', 'ALL', 'M1').length, 1);
  // per-subject roster split by class
  const sub = C.createSubject(db, { levelId: 'OLA', name: 'Αγγλικά', specialty: 'COMMON' });
  const d = C.createStudent(db, { am: '4', lastName: 'Δ', firstName: 'Δ', specialty: 'ENGINE' });
  C.setEnrollment(db, d.id, y, 'OLA', 'MO');
  C.setGrade(db, a.id, sub.id, y, { value: 3 });
  const groups = C.subjectRosterByClass(db, sub, y);
  assert.deepStrictEqual(groups.map((g) => g.name), ['Operational Level A Deck Afternoon', 'Operational Level A Engine Morning']);
  // student import with the full class name in the level column
  const plan = C.planStudentImport(db, {
    table: { rows: [
      { rowNum: 2, cells: ['10', 'ΚΚ ΛΛ', 'OPERATIONAL LEVEL A ENGINE MORGNIN'] },
      { rowNum: 3, cells: ['11', 'ΜΜ ΝΝ', 'SUPPORT MORNING 2'] },
      { rowNum: 4, cells: ['12', 'ΞΞ ΟΟ', 'Management Engn Fun 2 Afternoon'] },
    ] },
    map: { am: 0, fullName: 1, level: 2 }, nameOrder: 'LF', defaults: { yearId: y, levelId: '', specialty: '', section: '' }, updateExisting: true,
  });
  assert.deepStrictEqual(plan.items.map((i) => [i.levelId, i.data.specialty, i.section]), [['OLA', 'ENGINE', 'MO'], ['SUP', '', 'M2'], ['MF2', 'ENGINE', 'AF']]);
  const rec = C.commitStudentImport(db, plan, {});
  assert.strictEqual(C.studentSection(db, C.findStudentByAm(db, '11'), y), 'M2');
  assert.strictEqual(C.getMgmtShift(db, y, 'MF2', 'ENGINE'), 'AF');
  C.undoImport(db, rec.id);
  assert.strictEqual(C.getMgmtShift(db, y, 'MF2', 'ENGINE'), null);
  assert.strictEqual(C.findStudentByAm(db, '11'), null);
});

t('support is one class group; subjects always common', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const s = C.createSubject(db, { levelId: 'SUP', name: 'X', specialty: 'DECK' });
  assert.strictEqual(s.specialty, 'COMMON');
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '2', lastName: 'Β', firstName: 'Β', specialty: 'ENGINE' });
  C.setEnrollment(db, a.id, y, 'SUP', 'AF');
  C.setEnrollment(db, b.id, y, 'SUP', 'M1');
  const sheet = C.buildGradeSheet(db, y, 'SUP', 'DECK');
  assert.strictEqual(sheet.rows.length, 2); // Deck filter ignored in Support
  assert.deepStrictEqual(sheet.rows.map((r) => r.section), ['M1', 'AF']); // ordered by class
});

t('transfer between years and classes (with undo)', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y1 = db.years[0].id;
  const y2 = C.addYear(db, '2027-2028').id;
  const sub = C.createSubject(db, { levelId: 'SUP', name: 'Α' });
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '2', lastName: 'Β', firstName: 'Β', specialty: 'ENGINE' });
  const c = C.createStudent(db, { am: '3', lastName: 'Γ', firstName: 'Γ', specialty: 'DECK' });
  C.setEnrollment(db, a.id, y1, 'SUP', 'M2');
  C.setEnrollment(db, b.id, y1, 'SUP', 'AF');
  C.setEnrollment(db, c.id, y1, 'MF3');
  C.setGrade(db, a.id, sub.id, y1, { value: 4 });
  C.setGrade(db, b.id, sub.id, y1, { value: 0 });
  let plan = C.planTransfer(db, { fromYearId: y1, toYearId: y2, mode: 'auto', toSection: 'same' });
  const byAm = (am) => plan.items.find((i) => i.student.am === am);
  assert.deepStrictEqual([byAm('1').toLevelId, byAm('1').toSection, byAm('1').status], ['OLA', 'MO', 'new']); // passed → next level, Morning 2 → Morning
  assert.deepStrictEqual([byAm('2').toLevelId, byAm('2').toSection], ['SUP', 'AF']); // failed → repeats
  assert.deepStrictEqual([byAm('3').toLevelId, byAm('3').status], ['MF3', 'new']); // no result yet → stays
  const m3 = C.createSubject(db, { levelId: 'MF3', name: 'Μ', specialty: 'COMMON' });
  C.setGrade(db, c.id, m3.id, y1, { value: 5 });
  plan = C.planTransfer(db, { fromYearId: y1, toYearId: y2, mode: 'auto', toSection: 'same' });
  assert.strictEqual(plan.items.find((i) => i.student.am === '3').status, 'final'); // passed the last level
  const rec = C.commitTransfer(db, plan);
  assert.strictEqual(C.getEnrollment(db, a.id, y2).levelId, 'OLA');
  assert.strictEqual(C.studentSection(db, a, y2), 'MO');
  assert.strictEqual(C.getEnrollment(db, a.id, y1).levelId, 'SUP'); // history kept
  // re-plan: now they exist → 'same'
  plan = C.planTransfer(db, { fromYearId: y1, toYearId: y2, mode: 'auto', toSection: 'same' });
  assert.strictEqual(plan.items.find((i) => i.student.am === '1').status, 'same');
  // move a class to another class, backwards in time, fixed target
  const back = C.planTransfer(db, { fromYearId: y2, levelId: 'OLA', toYearId: y1, mode: 'fixed', toLevelId: 'OLB', toSection: 'AF' });
  assert.strictEqual(back.items[0].status, 'exists'); // already enrolled in y1 → kept unless overwrite
  const back2 = C.planTransfer(db, { fromYearId: y2, levelId: 'OLA', toYearId: y1, mode: 'fixed', toLevelId: 'OLB', toSection: 'AF', overwrite: true });
  C.commitTransfer(db, back2);
  assert.deepStrictEqual([C.getEnrollment(db, a.id, y1).levelId, C.getEnrollment(db, a.id, y1).section], ['OLB', 'AF']);
  C.undoImport(db, db.imports[0].id);
  assert.deepStrictEqual([C.getEnrollment(db, a.id, y1).levelId, C.getEnrollment(db, a.id, y1).section], ['SUP', 'M2']);
  C.undoImport(db, rec.id);
  assert.strictEqual(C.getEnrollment(db, a.id, y2), null);
});

t('configurable classes', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const s3 = C.addSection(db, 'SUP', 'Morning 3');
  assert.deepStrictEqual(C.levelSections('SUP').map((x) => x.name), ['Morning 1', 'Morning 2', 'Afternoon', 'Morning 3']);
  assert.strictEqual(C.parseSection('SUPPORT MORNING 3', 'SUP'), s3.id);
  assert.strictEqual(C.parseSection('SUPPORT MORNING 1', 'SUP'), 'M1');
  assert.throws(() => C.addSection(db, 'SUP', 'morning 3'));
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Α' });
  C.setEnrollment(db, a.id, y, 'SUP', s3.id);
  assert.throws(() => C.removeSection(db, 'SUP', s3.id));
  C.renameSection(db, 'SUP', s3.id, 'Evening');
  assert.strictEqual(C.classFullName(db, 'SUP', null, s3.id), 'Support Evening');
  const db2 = C.normalizeDb(JSON.parse(JSON.stringify(db)));
  assert.strictEqual(C.sectionName('SUP', s3.id), 'Evening');
  C.createEmptyDb(); // resets to defaults
  assert.strictEqual(C.levelSections('SUP').length, 3);
  void db2;
});

t('student who leaves and comes back keeps passed subjects', () => {
  const db = C.createEmptyDb(new Date(2025, 8, 25)); // 2025-2026
  const y1 = db.years[0].id;
  const y2 = C.addYear(db, '2026-2027').id;
  const y3 = C.addYear(db, '2027-2028').id;
  const a = C.createStudent(db, { am: '77', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const s1 = C.createSubject(db, { levelId: 'OLA', name: 'Ναυσιπλοΐα', specialty: 'DECK' });
  const s2 = C.createSubject(db, { levelId: 'OLA', name: 'Αγγλικά' });
  const s3 = C.createSubject(db, { levelId: 'OLA', name: 'Ασφάλεια' });
  C.setEnrollment(db, a.id, y1, 'OLA', 'MO');
  C.setGrade(db, a.id, s1.id, y1, { value: 4 });
  C.setGrade(db, a.id, s2.id, y1, { value: 0 }); // failed
  C.setWithdrawn(db, a.id, y1, true); // left mid-year
  // 2026-2027: away. 2027-2028: back in OLA
  C.setEnrollment(db, a.id, y3, 'OLA', 'AF');
  assert.strictEqual(C.carriedGrade(db, a.id, s1.id, y3).value, 4);
  assert.strictEqual(C.carriedGrade(db, a.id, s2.id, y3), null); // failed subjects must be retaken
  let r = C.studentResult(db, a, y3, 'OLA');
  assert.deepStrictEqual([r.status, r.total - r.missing], ['incomplete', 1]);
  C.setGrade(db, a.id, s2.id, y3, { value: 3 });
  C.setGrade(db, a.id, s3.id, y3, { value: 2 });
  r = C.studentResult(db, a, y3, 'OLA');
  assert.strictEqual(r.status, 'pass');
  assert.strictEqual(r.avg, 3); // (4 + 3 + 2) / 3
  const sheet = C.buildGradeSheet(db, y3, 'OLA', 'DECK');
  const cell = sheet.rows[0].cells.find((c) => c.subject.id === s1.id);
  assert.ok(!cell.grade && cell.carried && cell.carried.yearId === y1);
  // the old year stays as it was
  assert.strictEqual(C.studentResult(db, a, y1, 'OLA').status, 'fail');
  assert.strictEqual(C.buildGradeSheet(db, y1, 'OLA', 'DECK').rows[0].withdrawn, true);
  // withdrawn students repeat the level in an automatic transfer
  const plan = C.planTransfer(db, { fromYearId: y1, toYearId: y2, mode: 'auto' });
  assert.strictEqual(plan.items[0].toLevelId, 'OLA');
  // per-subject roster shows the carried grade
  const roster = C.subjectRoster(db, s1, y3);
  assert.ok(roster[0].carried && roster[0].grade.value === 4);
  void y2;
});

t('transcript: classes across years, per-level record with its own academic years', () => {
  const db = C.createEmptyDb(new Date(2023, 8, 25)); // 2023-2024
  const y1 = db.years[0].id;
  const y2 = C.addYear(db, '2024-2025').id;
  const y3 = C.addYear(db, '2025-2026').id;
  const M1 = C.levelSections('SUP')[0].id;
  const MOR = C.levelSections('OLA')[0].id;
  const a = C.createStudent(db, { am: '26003', lastName: 'Παπαδόπουλος', firstName: 'Γιώργος', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '26004', lastName: 'Αλεξίου', firstName: 'Νίκος', specialty: 'ENGINE' });
  const sup1 = C.createSubject(db, { levelId: 'SUP', code: 'S1', name: 'Αγγλικά', specialty: 'COMMON' });
  const sup2 = C.createSubject(db, { levelId: 'SUP', code: 'S2', name: 'Μαθηματικά', specialty: 'COMMON' });
  const ola = C.createSubject(db, { levelId: 'OLA', code: 'N1', name: 'Ναυσιπλοΐα', specialty: 'DECK' });
  // a: Support 2023-2024, OL A 2024-2025 ; b: Support 2023-2024 (left), again Support 2025-2026
  C.setEnrollment(db, a.id, y1, 'SUP', M1);
  C.setEnrollment(db, a.id, y2, 'OLA', MOR);
  C.setEnrollment(db, b.id, y1, 'SUP', M1);
  C.setWithdrawn(db, b.id, y1, true);
  C.setEnrollment(db, b.id, y3, 'SUP', M1);
  C.setGrade(db, a.id, sup1.id, y1, { value: 4 });
  C.setGrade(db, a.id, sup2.id, y1, { value: 3 });
  C.setGrade(db, a.id, ola.id, y2, { value: 5 });
  C.setGrade(db, b.id, sup1.id, y1, { value: 2 }); // passed in the first attempt → carried
  C.setGrade(db, b.id, sup2.id, y3, { value: 1 });

  const classes = C.transcriptClasses(db);
  const supM1 = classes.find((c) => c.levelId === 'SUP' && c.section === M1);
  assert.ok(supM1, 'Support Morning 1 listed');
  assert.deepStrictEqual(supM1.students.map((x) => x.student.am), ['26004', '26003']); // by surname
  assert.deepStrictEqual(supM1.students.find((x) => x.student.id === b.id).years, [y1, y3]);
  assert.ok(classes.some((c) => c.levelId === 'OLA' && c.spec === 'DECK' && c.section === MOR));

  // Support record of a → 2023-2024 even though the app is in another year
  const ra = C.studentLevelRecord(db, a, 'SUP');
  assert.deepStrictEqual(ra.years, [y1]);
  assert.deepStrictEqual(ra.subjects.map((x) => x.grade && x.grade.value), [4, 3]);
  assert.strictEqual(ra.result.status, 'pass');
  assert.deepStrictEqual(C.studentLevels(db, a), ['SUP', 'OLA']);
  // returning student: both years, carried grade flagged
  const rb = C.studentLevelRecord(db, b, 'SUP');
  assert.deepStrictEqual(rb.years, [y1, y3]);
  const e = rb.subjects.find((x) => x.subject.id === sup1.id);
  assert.ok(e.carried && e.grade.yearId === y1);
  assert.strictEqual(rb.perYear[0].withdrawn, true);
  assert.strictEqual(rb.result.status, 'pass');
});

t('same student entering another class: detected, confirmed or rejected', () => {
  const db = C.createEmptyDb(new Date(2023, 8, 25));
  const y1 = db.years[0].id;
  const y2 = C.addYear(db, '2024-2025').id;
  const M1 = C.levelSections('SUP')[0].id;
  const a = C.createStudent(db, { am: '26003', lastName: 'Παπαδόπουλος', firstName: 'Γιώργος', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '26004', lastName: 'Αλεξίου', firstName: 'Νίκος', specialty: 'DECK' });
  C.setEnrollment(db, a.id, y1, 'SUP', M1);
  C.setEnrollment(db, b.id, y1, 'SUP', M1);
  assert.strictEqual(C.nameMatch({ lastName: 'ΠΑΠΑΔΟΠΟΥΛΟΣ', firstName: 'γιωργος' }, a), 'exact');
  assert.strictEqual(C.nameMatch({ lastName: 'Παπαδόπουλος', firstName: 'Γιώργης' }, a), 'partial');
  const idc = C.identityCheck(db, a, y2, 'OLA', C.levelSections('OLA')[0].id);
  assert.ok(idc && idc.levelChange);
  assert.strictEqual(idc.prev.className, 'Support Morning 1');
  assert.strictEqual(idc.next.className, 'Operational Level A Deck Morning');
  assert.strictEqual(C.identityCheck(db, a, y2, 'SUP', M1), null); // same class again → nothing to ask
  // import of the new year's OL A list
  const table = { rows: [
    { rowNum: 2, cells: ['26003', 'Παπαδόπουλος Γιώργος', 'OPERATIONAL LEVEL A DECK MORNING'] },
    { rowNum: 3, cells: ['26004', 'Αλεξίου Νίκος', 'OPERATIONAL LEVEL A DECK MORNING'] },
    { rowNum: 4, cells: ['26010', 'Νέος Σπουδαστής', 'OPERATIONAL LEVEL A DECK MORNING'] },
  ] };
  const plan = C.planStudentImport(db, { table, map: { am: 0, fullName: 1, section: 2 }, nameOrder: 'last-first', defaults: { yearId: y2 } });
  assert.strictEqual(plan.summary.identity, 2);
  assert.ok(plan.items[0].identity && plan.items[0].identity.match === 'exact');
  assert.ok(!plan.items[2].identity);
  // the user answers «Όχι» for 26004 → that row is skipped, 26003 continues with the same record
  const rec = C.commitStudentImport(db, plan, { notSameRows: [3] });
  assert.strictEqual(C.getEnrollment(db, a.id, y2).levelId, 'OLA');
  assert.strictEqual(C.getEnrollment(db, b.id, y2), null);
  assert.strictEqual(rec.stats.created, 1);
  assert.strictEqual(db.students.filter((x) => x.am === '26003').length, 1);
});

// ------------------------------------------------------------------ v2.2: periods
t('periods: defaults, normalize and single-period fill', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  assert.deepStrictEqual(db.settings.periods, C.DEFAULT_PERIODS);
  assert.deepStrictEqual(db.settings.levelPeriods, C.DEFAULT_LEVEL_PERIODS);
  assert.deepStrictEqual(C.levelPeriods(db, 'SUP').map((p) => p.id), ['OCT', 'JAN']);
  assert.deepStrictEqual(C.levelPeriods(db, 'OLB').map((p) => p.id), ['JAN', 'MAY']);
  assert.deepStrictEqual(C.levelPeriods(db, 'MF1'), []);
  assert.ok(C.levelHasPeriods(db, 'OLA') && !C.levelHasPeriods(db, 'MF3'));
  assert.ok(C.validPeriodFor(db, 'OLB', 'MAY') && !C.validPeriodFor(db, 'OLB', 'OCT') && !C.validPeriodFor(db, 'MF1', 'OCT'));
  assert.strictEqual(C.periodName('JAN'), 'Ιανουάριος');
  assert.strictEqual(C.periodShort('MAY'), 'Μάι');
  assert.strictEqual(C.periodName(null), '');
  // an older registry: no period settings, enrollments without a period
  const y = db.years[0].id;
  const old = JSON.parse(JSON.stringify(db));
  delete old.settings.periods;
  delete old.settings.levelPeriods;
  old.students = [{ id: 'a', am: '1' }, { id: 'b', am: '2' }, { id: 'c', am: '3' }];
  old.enrollments = [
    { id: 'e1', studentId: 'a', yearId: y, levelId: 'OLA', section: 'MO' },
    { id: 'e2', studentId: 'b', yearId: y, levelId: 'SUP', section: 'M1' },
    { id: 'e3', studentId: 'c', yearId: y, levelId: 'MF1' },
  ];
  const n = C.normalizeDb(old);
  assert.deepStrictEqual(n.settings.periods, C.DEFAULT_PERIODS);
  assert.deepStrictEqual(n.settings.levelPeriods, C.DEFAULT_LEVEL_PERIODS);
  assert.deepStrictEqual(n.enrollments.map((e) => e.period), ['OCT', null, null]); // OLA has only October
  // invalid lists → defaults; unknown ids / levels are dropped
  const bad = JSON.parse(JSON.stringify(db));
  bad.settings.periods = [{ id: 'OCT' }];
  bad.settings.levelPeriods = { SUP: ['OCT', 'XXX'], ZZZ: ['JAN'], OLB: ['MAY'] };
  C.normalizeDb(bad);
  assert.deepStrictEqual(bad.settings.periods, C.DEFAULT_PERIODS);
  assert.deepStrictEqual(bad.settings.levelPeriods, { SUP: ['OCT'], OLB: ['MAY'] });
  C.createEmptyDb(); // back to the defaults
  assert.deepStrictEqual(C.periodList().map((p) => p.id), ['OCT', 'JAN', 'MAY']);
});

t('periods: setEnrollment keeps / assigns the period', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  let e = C.setEnrollment(db, a.id, y, 'SUP', 'M1', 'JAN');
  assert.strictEqual(e.period, 'JAN');
  e = C.setEnrollment(db, a.id, y, 'SUP', 'M2'); // period undefined → kept
  assert.deepStrictEqual([e.section, e.period], ['M2', 'JAN']);
  e = C.setEnrollment(db, a.id, y, 'OLA'); // other level, single period → October
  assert.strictEqual(e.period, 'OCT');
  e = C.setEnrollment(db, a.id, y, 'OLB'); // other level with two periods → none
  assert.strictEqual(e.period, null);
  e = C.setEnrollment(db, a.id, y, 'OLB', 'MO', 'MAY');
  assert.strictEqual(e.period, 'MAY');
  e = C.setEnrollment(db, a.id, y, 'OLB', 'AF', 'OCT'); // not an OL B period
  assert.strictEqual(e.period, null);
  e = C.setEnrollment(db, a.id, y, 'OLA', null, 'JAN'); // invalid → the single period
  assert.strictEqual(e.period, 'OCT');
  e = C.setEnrollment(db, a.id, y, 'SUP', null, null);
  assert.strictEqual(e.period, null);
  e = C.setEnrollment(db, a.id, y, 'MF1', null, 'OCT'); // Management: no periods
  assert.strictEqual(e.period, null);
  const b = C.createStudent(db, { am: '2', lastName: 'Β', firstName: 'Β' });
  assert.strictEqual(C.setEnrollment(db, b.id, y, 'OLA').period, 'OCT'); // new enrollment
});

function periodDb() {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const a = C.createStudent(db, { am: '101', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '102', lastName: 'Β', firstName: 'Β', specialty: 'ENGINE' });
  const c = C.createStudent(db, { am: '103', lastName: 'Γ', firstName: 'Γ', specialty: 'DECK' });
  C.setEnrollment(db, a.id, y, 'SUP', 'M1', 'OCT');
  C.setEnrollment(db, b.id, y, 'SUP', 'M1', 'JAN');
  C.setEnrollment(db, c.id, y, 'SUP', 'M1');
  const sub = C.createSubject(db, { levelId: 'SUP', code: 'S1', name: 'Αγγλικά' });
  return { db, y, a, b, c, sub };
}

t('periods: filters, class names, sheets, rosters, transcripts', () => {
  const { db, y, a, b, c, sub } = periodDb();
  const ams = (list) => list.map((s) => s.am);
  assert.deepStrictEqual(ams(C.enrolledStudents(db, y, 'SUP', 'ALL', 'ALL', 'OCT')), ['101']);
  assert.deepStrictEqual(ams(C.enrolledStudents(db, y, 'SUP', 'ALL', 'M1', 'JAN')), ['102']);
  assert.deepStrictEqual(ams(C.enrolledStudents(db, y, 'SUP', 'ALL', 'ALL', 'NONE')), ['103']);
  assert.strictEqual(C.enrolledStudents(db, y, 'SUP').length, 3);
  assert.strictEqual(C.enrolledStudents(db, y, 'SUP', 'ALL', 'ALL', 'ALL').length, 3);
  // names
  assert.strictEqual(C.classFullName(db, 'SUP', null, 'M1', 'OCT'), 'Support Morning 1 – Οκτώβριος');
  assert.strictEqual(C.classFullName(db, 'SUP', null, 'M1'), 'Support Morning 1');
  assert.strictEqual(C.classFullName(db, 'OLB', 'ENGINE', 'MO', 'MAY'), 'Operational Level B Engine Morning – Μάιος');
  assert.strictEqual(C.classShortName('SUP', null, 'M1', 'JAN'), 'Support Morning 1 Ιαν');
  assert.strictEqual(C.classShortName('OLB', 'ENGINE', 'AF', 'MAY'), 'OL B Engine Afternoon Μάι');
  assert.ok(C.classShortName('OLB', 'ENGINE', 'AF', 'MAY').length <= 31);
  assert.strictEqual(C.classShortName('OLB', 'ENGINE', 'MO'), 'OL B Engine Morning');
  // single-period level: the period does not tell classes apart
  assert.strictEqual(C.classPeriod(db, 'OLA', 'OCT'), null);
  assert.strictEqual(C.classPeriod(db, 'SUP', 'OCT'), 'OCT');
  const d = C.createStudent(db, { am: '104', lastName: 'Δ', firstName: 'Δ', specialty: 'DECK' });
  C.setEnrollment(db, d.id, y, 'OLA', 'MO');
  assert.strictEqual(C.studentClass(db, d, y).name, 'Operational Level A Deck Morning');
  assert.strictEqual(C.studentClass(db, d, y).period, 'OCT');
  assert.strictEqual(C.studentClass(db, a, y).name, 'Support Morning 1 – Οκτώβριος');
  assert.strictEqual(C.studentClass(db, a, y).key, 'SUP||M1|OCT');
  // grade sheet
  let sheet = C.buildGradeSheet(db, y, 'SUP', 'ALL', 'ALL', 'JAN');
  assert.deepStrictEqual(sheet.rows.map((r) => [r.student.am, r.period]), [['102', 'JAN']]);
  sheet = C.buildGradeSheet(db, y, 'SUP', 'ALL', 'M1');
  assert.deepStrictEqual(sheet.rows.map((r) => r.period), ['OCT', 'JAN', null]); // October, January, none
  assert.strictEqual(C.levelSummary(db, y, 'SUP', null, 'OCT').students, 1);
  assert.strictEqual(C.levelSummary(db, y, 'SUP').students, 3);
  // per-subject export: one group per class incl. period
  const groups = C.subjectRosterByClass(db, sub, y);
  assert.deepStrictEqual(groups.map((g) => g.name), ['Support Morning 1 – Οκτώβριος', 'Support Morning 1 – Ιανουάριος', 'Support Morning 1']);
  assert.deepStrictEqual(groups.map((g) => g.short), ['Support Morning 1 Οκτ', 'Support Morning 1 Ιαν', 'Support Morning 1']);
  assert.strictEqual(groups[2].key, 'SUP||M1'); // same key as before periods when there is none
  assert.deepStrictEqual(C.subjectRoster(db, sub, y, 'JAN').map((x) => x.student.am), ['102']);
  assert.deepStrictEqual(C.subjectRoster(db, sub, y, { period: 'OCT', section: 'M1' }).map((x) => x.student.am), ['101']);
  assert.strictEqual(C.subjectRoster(db, sub, y).length, 3);
  // transcripts: classes of different periods are separate
  const cls = C.transcriptClasses(db).filter((x) => x.levelId === 'SUP');
  assert.deepStrictEqual(cls.map((x) => x.key), ['SUP||M1|OCT', 'SUP||M1|JAN', 'SUP||M1']);
  assert.strictEqual(cls[0].name, 'Support Morning 1 – Οκτώβριος');
  assert.strictEqual(C.transcriptClassKey('SUP', null, 'M1'), 'SUP||M1');
  const rec = C.studentLevelRecord(db, b, 'SUP');
  assert.strictEqual(rec.className, 'Support Morning 1 – Ιανουάριος');
  assert.strictEqual(rec.perYear[0].period, 'JAN');
  void c;
});

t('periods: parsePeriod variants', () => {
  C.createEmptyDb();
  const cases = {
    OCT: ['OCT', 'oct', 'Oct', 'October', 'OCTOBER', 'Οκτώβριος', 'οκτωβριος', 'ΟΚΤΩΒΡΙΟΣ', 'Οκτωβρίου', 'Οκτ', 'Οκτ.', 'οκτ', '10', 10, '01/10/2026', '1.10.2026', '2026-10-01', '10/2026', 'Περίοδος Οκτωβρίου 2026', 'Oct-26', new Date(2026, 9, 1), new Date(2026, 9, 31, 10, 0)],
    JAN: ['JAN', 'jan', 'January', 'Ιανουάριος', 'ιανουαριος', 'Ιανουαρίου', 'Ιαν', '1', '01', 1, '15/01/2027', new Date(2027, 0, 15)],
    MAY: ['MAY', 'may', 'May', 'Μάιος', 'μαιος', 'ΜΑΪΟΣ', 'Μαΐου', 'μαιου', 'Μάι', '5', '05', 5, '2027-05-03', new Date(2027, 4, 2)],
  };
  Object.keys(cases).forEach((id) => cases[id].forEach((v) => assert.strictEqual(C.parsePeriod(v), id, 'parse ' + String(v))));
  [null, undefined, '', 'xyz', 'Σεπτέμβριος', 'Sept', 13, 0, '2026', 'Morning'].forEach((v) => assert.strictEqual(C.parsePeriod(v), null, 'reject ' + String(v)));
  // Excel: a date cell (cellDates) and a serial number
  assert.strictEqual(C.parsePeriod({ v: new Date(2027, 0, 10), w: '1/10/27' }), 'JAN');
  const serial = (Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.strictEqual(C.parsePeriod(serial), 'OCT');
  // a date a few hours before midnight (time-zone shifted Excel date) → the next day
  assert.strictEqual(C.parsePeriod(new Date(2026, 8, 30, 23, 58)), 'OCT');
  // class texts can carry the period
  assert.strictEqual(C.parseClassText('SUPPORT MORNING 1 OCT').period, 'OCT');
  assert.deepStrictEqual(C.parseClassText('Operational Level B Engine Afternoon Μάι'), { levelId: 'OLB', spec: 'ENGINE', section: 'AF', period: 'MAY' });
  assert.strictEqual(C.parseClassText('OPERATIONAL LEVEL A DECK MORNING').period, null);
  assert.strictEqual(C.parseClassText('Management Deck Function 1').period, null);
});

t('periods: admin edits (add, rename, remove, per level)', () => {
  const { db, y, a } = periodDb();
  assert.throws(() => C.addPeriod(db, ''), /όνομα/);
  assert.throws(() => C.addPeriod(db, 'οκτωβριος'), /υπάρχει/);
  const sep = C.addPeriod(db, 'Σεπτέμβριος', 'Σεπ');
  assert.deepStrictEqual(sep, { id: 'SEP', name: 'Σεπτέμβριος', short: 'Σεπ' });
  assert.strictEqual(C.parsePeriod('9'), 'SEP');
  assert.strictEqual(C.parsePeriod('Σεπτεμβρίου'), 'SEP');
  const summer = C.addPeriod(db, 'Θερινή περίοδος', 'Θερ');
  assert.ok(summer.id && !['OCT', 'JAN', 'MAY', 'SEP'].includes(summer.id));
  assert.strictEqual(C.parsePeriod('Θερινή περίοδος'), summer.id);
  C.renamePeriod(db, 'SEP', 'Σεπτέμβρης');
  assert.strictEqual(C.periodName('SEP'), 'Σεπτέμβρης');
  assert.strictEqual(C.periodShort('SEP'), 'Σεπ'); // short kept
  assert.throws(() => C.renamePeriod(db, 'SEP', 'Μάιος'), /υπάρχει/);
  // Management F1 gets one period → its enrollments get it
  const m = C.createStudent(db, { am: '200', lastName: 'Μ', firstName: 'Μ', specialty: 'DECK' });
  C.setEnrollment(db, m.id, y, 'MF1');
  assert.deepStrictEqual(C.setLevelPeriods(db, 'MF1', ['SEP', 'XXX']), ['SEP']);
  assert.strictEqual(C.getEnrollment(db, m.id, y).period, 'SEP');
  assert.strictEqual(C.periodUsage(db, 'SEP'), 1);
  assert.throws(() => C.removePeriod(db, 'SEP'), /χρησιμοποιείται από 1 εγγραφή/);
  assert.deepStrictEqual(C.teachingPeriodOptions(db, { levelId: 'MF1' }), [{ period: '', label: 'Όλες οι περίοδοι' }, { period: 'SEP', label: 'Σεπτέμβρης' }]);
  assert.deepStrictEqual(C.teachingPeriodOptions(db, { levelId: 'MF2' }), []);
  assert.strictEqual(C.teachingPeriodOptions(db, { levelId: 'SUP' }).length, 3);
  // setting [] removes the level's periods
  C.setLevelPeriods(db, 'MF1', []);
  assert.strictEqual(db.settings.levelPeriods.MF1, undefined);
  assert.ok(!C.levelHasPeriods(db, 'MF1'));
  // an unused period is removed from every level
  C.removePeriod(db, summer.id);
  C.setLevelPeriods(db, 'OLB', ['MAY', summer.id]);
  assert.deepStrictEqual(db.settings.levelPeriods.OLB, ['MAY']);
  // survives a save/load round trip
  const n = C.normalizeDb(JSON.parse(JSON.stringify(db)));
  assert.deepStrictEqual(n.settings.periods.map((p) => p.id), ['OCT', 'JAN', 'MAY', 'SEP']);
  assert.strictEqual(C.periodName('SEP'), 'Σεπτέμβρης');
  assert.strictEqual(C.getEnrollment(n, a.id, y).period, 'OCT');
  C.createEmptyDb();
});

t('periods: student import (column, class text, default, warnings) with undo', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  ['Περίοδος', 'Period', 'Intake', 'Κύκλος', 'Έναρξη', 'Ημερομηνία έναρξης'].forEach((h) => assert.strictEqual(C.guessColumnRole(h), 'period', h));
  assert.strictEqual(C.guessColumnRole('Τμήμα'), 'section');
  assert.strictEqual(C.guessColumnRole('Βαθμός περιόδου'), 'grade');
  const old = C.createStudent(db, { am: '5100', lastName: 'ΠΑΛΙΟΣ', firstName: 'ΣΠΟΥΔΑΣΤΗΣ', specialty: 'DECK' });
  C.setEnrollment(db, old.id, y, 'SUP', 'M1', 'OCT');
  const table = { rows: [
    { rowNum: 2, cells: ['5001', 'ΑΑ ΒΒ', 'SUPPORT MORNING 1', 'Ιανουάριος'] },
    { rowNum: 3, cells: ['5002', 'ΓΓ ΔΔ', 'SUPPORT MORNING 2', ''] }, // → default
    { rowNum: 4, cells: ['5003', 'ΕΕ ΖΖ', 'OPERATIONAL LEVEL B DECK MORNING', 'Οκτ'] }, // not an OL B period
    { rowNum: 5, cells: ['5004', 'ΗΗ ΘΘ', 'OPERATIONAL LEVEL A ENGINE MORNING', ''] },
    { rowNum: 6, cells: ['5005', 'ΙΙ ΚΚ', 'Management Deck Function 1', 'Οκτ'] }, // no periods
    { rowNum: 7, cells: ['5006', 'ΛΛ ΜΜ', 'SUPPORT AFTERNOON', { v: new Date(2027, 0, 10), w: '1/10/27' }] },
    { rowNum: 8, cells: ['5007', 'ΝΝ ΞΞ', 'SUPPORT MORNING 1 JAN', ''] }, // period in the class text
    { rowNum: 9, cells: ['5008', 'ΟΟ ΠΠ', 'SUPPORT MORNING 1', 'Φθινόπωρο'] }, // unknown
    { rowNum: 10, cells: ['5100', 'ΠΑΛΙΟΣ ΣΠΟΥΔΑΣΤΗΣ', 'SUPPORT MORNING 1', 'Ιαν'] }, // period change
  ] };
  const plan = C.planStudentImport(db, {
    table,
    map: { am: 0, fullName: 1, level: 2, period: 3 },
    nameOrder: 'LF',
    defaults: { yearId: y, levelId: '', specialty: '' },
    defaultPeriod: 'OCT',
    updateExisting: true,
  });
  assert.deepStrictEqual(plan.items.map((i) => i.period), ['JAN', 'OCT', null, 'OCT', null, 'JAN', 'JAN', null, 'JAN']);
  const issues = (am) => plan.items.find((i) => i.data.am === am).issues;
  assert.deepStrictEqual(issues('5001'), []);
  assert.ok(issues('5003').some((x) => /Οκτώβριος/.test(x) && /δεν ισχύει/.test(x) && /Operational Level B/.test(x)), issues('5003').join());
  assert.deepStrictEqual(issues('5005'), []); // Management has no periods: silently none
  assert.ok(issues('5008').some((x) => /Άγνωστη περίοδος «Φθινόπωρο»/.test(x)));
  assert.strictEqual(plan.summary.new, 8); // warnings do not block
  const moved = plan.items.find((i) => i.data.am === '5100');
  assert.strictEqual(moved.enroll, 'change');
  const rec = C.commitStudentImport(db, plan, {});
  const per = (am) => C.getEnrollment(db, C.findStudentByAm(db, am).id, y).period;
  assert.deepStrictEqual(['5001', '5002', '5003', '5004', '5005', '5006', '5007', '5008', '5100'].map(per), ['JAN', 'OCT', null, 'OCT', null, 'JAN', 'JAN', null, 'JAN']);
  C.undoImport(db, rec.id);
  assert.strictEqual(C.findStudentByAm(db, '5001'), null);
  assert.strictEqual(C.getEnrollment(db, old.id, y).period, 'OCT'); // restored
  // no period column and no default: an existing student keeps his period
  const plan2 = C.planStudentImport(db, {
    table: { rows: [{ rowNum: 2, cells: ['5100', 'ΠΑΛΙΟΣ ΣΠΟΥΔΑΣΤΗΣ', 'SUPPORT MORNING 2'] }] },
    map: { am: 0, fullName: 1, level: 2 }, nameOrder: 'LF', defaults: { yearId: y }, updateExisting: true,
  });
  assert.strictEqual(plan2.items[0].period, null);
  C.commitStudentImport(db, plan2, {});
  assert.deepStrictEqual([C.getEnrollment(db, old.id, y).section, C.getEnrollment(db, old.id, y).period], ['M2', 'OCT']);
});

t('periods: transfer with toPeriod (with undo)', () => {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y1 = db.years[0].id;
  const y2 = C.addYear(db, '2027-2028').id;
  const supS = C.createSubject(db, { levelId: 'SUP', name: 'Α' });
  const olaS = C.createSubject(db, { levelId: 'OLA', name: 'Β' });
  const a = C.createStudent(db, { am: '1', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const b = C.createStudent(db, { am: '2', lastName: 'Β', firstName: 'Β', specialty: 'DECK' });
  const c = C.createStudent(db, { am: '3', lastName: 'Γ', firstName: 'Γ', specialty: 'DECK' });
  C.setEnrollment(db, a.id, y1, 'SUP', 'M1', 'JAN');
  C.setEnrollment(db, b.id, y1, 'SUP', 'M1', 'JAN');
  C.setEnrollment(db, c.id, y1, 'OLA', 'MO');
  C.setGrade(db, a.id, supS.id, y1, { value: 3 }); // passes → OL A
  C.setGrade(db, b.id, supS.id, y1, { value: 0 }); // repeats Support
  C.setGrade(db, c.id, olaS.id, y1, { value: 4 }); // passes → OL B
  let plan = C.planTransfer(db, { fromYearId: y1, toYearId: y2 });
  const it = (am) => plan.items.find((i) => i.student.am === am);
  assert.deepStrictEqual([it('1').toLevelId, it('1').fromPeriod, it('1').toPeriod], ['OLA', 'JAN', 'OCT']); // single period
  assert.deepStrictEqual([it('2').toLevelId, it('2').toPeriod], ['SUP', 'JAN']); // kept
  assert.deepStrictEqual([it('3').toLevelId, it('3').toPeriod], ['OLB', null]); // October is not an OL B period
  plan = C.planTransfer(db, { fromYearId: y1, toYearId: y2, toPeriod: 'MAY' });
  assert.deepStrictEqual([it('1').toPeriod, it('2').toPeriod, it('3').toPeriod], ['OCT', 'JAN', 'MAY']);
  assert.deepStrictEqual(C.planTransfer(db, { fromYearId: y1, toYearId: y2, period: 'JAN' }).items.map((i) => i.student.am), ['1', '2']);
  const rec = C.commitTransfer(db, plan);
  assert.deepStrictEqual([a, b, c].map((s) => C.getEnrollment(db, s.id, y2).period), ['OCT', 'JAN', 'MAY']);
  // re-plan: same class and period → 'same'; another period → 'exists'
  assert.strictEqual(C.planTransfer(db, { fromYearId: y1, toYearId: y2, toPeriod: 'MAY' }).items.find((i) => i.student.am === '3').status, 'same');
  const again = C.planTransfer(db, { fromYearId: y1, toYearId: y2, toPeriod: 'JAN' }).items.find((i) => i.student.am === '3');
  assert.deepStrictEqual([again.toPeriod, again.status, again.existing.period], ['JAN', 'exists', 'MAY']);
  C.undoImport(db, rec.id);
  assert.strictEqual(C.getEnrollment(db, c.id, y2), null);
  assert.strictEqual(C.getEnrollment(db, c.id, y1).period, 'OCT');
});

t('periods: teacher assignments', () => {
  const { db, y, sub } = periodDb();
  const ams = (list) => list.map((s) => s.am);
  assert.deepStrictEqual(ams(C.assignmentStudents(db, { yearId: y, subjectId: sub.id, spec: '', section: '', period: 'JAN' })), ['102']);
  assert.deepStrictEqual(ams(C.assignmentStudents(db, { yearId: y, subjectId: sub.id, spec: '', section: 'M1', period: 'OCT' })), ['101']);
  assert.strictEqual(C.assignmentStudents(db, { yearId: y, subjectId: sub.id, spec: '', section: '', period: '' }).length, 3);
  assert.strictEqual(C.assignmentStudents(db, { yearId: y, subjectId: sub.id, spec: '', section: '' }).length, 3); // old assignments
  assert.strictEqual(C.assignmentLabel(db, { yearId: y, subjectId: sub.id, spec: '', section: '', period: 'JAN' }), 'Support — όλα τα τμήματα – Ιανουάριος');
  assert.strictEqual(C.assignmentLabel(db, { yearId: y, subjectId: sub.id, spec: '', section: 'M1', period: '' }), 'Support Morning 1');
  assert.strictEqual(C.assignmentLabel(db, { yearId: y, subjectId: 'gone', spec: '', section: '', label: 'Παλιό' }), 'Παλιό');
  assert.deepStrictEqual(C.teachingPeriodOptions(db, sub).map((o) => o.period), ['', 'OCT', 'JAN']);
});

// ------------------------------------------------------------------ v2.2: 0Δ / 0Α
t('grade codes 0Δ / 0Α: parsing', () => {
  const J = ['0Δ', '0δ', '0 Δ', '0-Δ', '0.Δ.', '0Δικ', '0 δικ.', '0 δικαιολογημένες', '0 Δικαιολογημένες (απουσίες)', '0 ΔΙΚΑΙΟΛΟΓΗΜΕΝΕΣ ΑΠΟΥΣΙΕΣ', '0D', '0d', '0J', '0 j', '0 justified', '0 Justified absences'];
  const U = ['0Α', '0α', '0 Α', '0Αδ', '0Αδικ', '0 αδικαιολόγητες', '0 αδικαιολόγητες (απουσίες)', '0A', '0a', '0Aδ', '0U', '0u', '0 unjustified', '0-Α.'];
  J.forEach((v) => assert.deepStrictEqual(C.parseGradeCell(v), { kind: 'grade', value: 0, percent: null, att: 'J' }, 'J ' + v));
  U.forEach((v) => assert.deepStrictEqual(C.parseGradeCell(v), { kind: 'grade', value: 0, percent: null, att: 'U' }, 'U ' + v));
  assert.deepStrictEqual(C.parseGradeCell('0'), { kind: 'grade', value: 0, percent: null });
  assert.deepStrictEqual(C.parseGradeCell(0), { kind: 'grade', value: 0, percent: null });
  assert.strictEqual(C.parseGradeCell('ΑΠ').kind, 'absent');
  assert.strictEqual(C.parseGradeCell('Απουσίες').kind, 'absent');
  ['0X', 'Δ', '10Δ', '1Δ', '0Δ5', '00Δ', '0 abs'].forEach((v) => assert.strictEqual(C.parseGradeCell(v).kind, 'invalid', 'reject ' + v));
  assert.ok(/0Δ/.test(C.parseGradeCell('0X').reason) && /0Α/.test(C.GRADE_RULE));
  assert.deepStrictEqual(C.parseManualGrade('0Α'), { value: 0, absent: false, att: 'U' });
  assert.deepStrictEqual(C.parseManualGrade('0δ'), { value: 0, absent: false, att: 'J' });
  assert.deepStrictEqual(C.parseManualGrade('0'), { value: 0, absent: false });
  assert.ok(/0Δ/.test(C.parseManualGrade('0Q').error) && /0Α/.test(C.parseManualGrade('0Q').error));
  assert.strictEqual(C.parseAttCode('0 δικαιολογημένες'), 'J');
  assert.strictEqual(C.parseAttCode('3'), null);
});

t('grade codes 0Δ / 0Α: storage, text, snapshots, import & undo', () => {
  const { db, y, s1, s2, nav } = sampleDb();
  let g = C.setGrade(db, s1.id, nav.id, y, { value: 0, absent: false, att: 'J' });
  assert.strictEqual(g.att, 'J');
  assert.strictEqual(C.gradeText(g), '0Δ');
  assert.deepStrictEqual(C.gradeSnapshot(g).att, 'J');
  g = C.setGrade(db, s1.id, nav.id, y, { value: 0, att: 'U' });
  assert.strictEqual(C.gradeText(g), '0Α');
  g = C.setGrade(db, s1.id, nav.id, y, { value: 3, att: 'U' }); // only with 0
  assert.ok(!('att' in g));
  assert.strictEqual(C.gradeText(g), '3');
  g = C.setGrade(db, s1.id, nav.id, y, { absent: true, att: 'J' }); // not with ΑΠ
  assert.ok(!('att' in g));
  assert.strictEqual(C.gradeSnapshot(g).att, null);
  g = C.setGrade(db, s1.id, nav.id, y, { value: 0 });
  assert.strictEqual(C.gradeText(g), '0');
  assert.ok(C.sameGrade({ value: 0, att: 'J' }, { value: 0, att: 'J' }));
  assert.ok(!C.sameGrade({ value: 0, att: 'J' }, { value: 0 }));
  assert.ok(!C.sameGrade({ value: 0, att: 'J' }, { value: 0, att: 'U' }));
  assert.ok(C.sameGrade({ value: 0 }, { value: 0, att: null }));
  assert.strictEqual(C.gradeReason({ absent: true, value: null }), 'Απών');
  assert.strictEqual(C.gradeReason({ value: 0 }), 'Γραπτό 0');
  assert.strictEqual(C.gradeReason({ value: 0, att: 'J' }), '0 – δικαιολογημένες απουσίες');
  assert.strictEqual(C.gradeReason({ value: 0, att: 'U' }), C.ATT_LABEL.U);
  assert.strictEqual(C.gradeReason({ value: 3 }), '');
  assert.strictEqual(C.gradeReason(null), '');
  assert.deepStrictEqual(C.ATT_TEXT, { J: '0Δ', U: '0Α' });
  C.clearGrade(db, s1.id, nav.id, y);
  // import: 0Δ → new, 0Α over it → update (not "same"), undo restores 0Δ, undo again removes it
  const imp = (v1, v2) => C.planGradeImport(db, { table: { rows: [{ rowNum: 2, cells: [1001, v1] }, { rowNum: 3, cells: [1002, v2] }] }, amCol: 0, columns: [{ col: 1, subjectId: nav.id }], mode: 'scale', yearId: y });
  let plan = imp('0Δ', '0A');
  assert.strictEqual(plan.summary.new, 2);
  const r1 = C.commitGradeImport(db, plan, {});
  assert.deepStrictEqual([C.getGrade(db, s1.id, nav.id, y).att, C.getGrade(db, s2.id, nav.id, y).att], ['J', 'U']);
  assert.strictEqual(r1.changes[0].after.att, 'J');
  plan = imp('0Α', '0αδικ');
  assert.deepStrictEqual([plan.summary.update, plan.summary.same], [1, 1]);
  const r2 = C.commitGradeImport(db, plan, {});
  assert.deepStrictEqual([r2.changes[0].before.att, r2.changes[0].after.att], ['J', 'U']);
  assert.strictEqual(C.gradeText(C.getGrade(db, s1.id, nav.id, y)), '0Α');
  C.undoImport(db, r2.id);
  assert.strictEqual(C.gradeText(C.getGrade(db, s1.id, nav.id, y)), '0Δ');
  C.undoImport(db, r1.id);
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y), null);
  // the same student with 0Δ and 0 in one file is a conflicting duplicate
  plan = C.planGradeImport(db, { table: { rows: [{ rowNum: 2, cells: [1001, '0Δ'] }, { rowNum: 3, cells: [1001, 0] }] }, amCol: 0, columns: [{ col: 1, subjectId: nav.id }], mode: 'scale', yearId: y });
  assert.strictEqual(plan.summary.duplicate, 2);
});

// ------------------------------------------------------------------ v2.2: re-exam
t('re-exam: setReexam rules, final grade, results, stats', () => {
  const { db, y, s1, s3, nav, eng2 } = sampleDb();
  assert.throws(() => C.setReexam(db, s1.id, nav.id, y, { value: 3 }, 'admin'), /Δεν υπάρχει αρχικός βαθμός/);
  C.setGrade(db, s1.id, nav.id, y, { value: 4 });
  assert.throws(() => C.setReexam(db, s1.id, nav.id, y, { value: 3 }, 'admin'), /έχει περάσει/);
  C.setGrade(db, s1.id, nav.id, y, { value: 0, att: 'U' });
  C.setGrade(db, s1.id, eng2.id, y, { value: 5 });
  assert.ok(C.needsReexam(C.getGrade(db, s1.id, nav.id, y)));
  assert.ok(!C.needsReexam(C.getGrade(db, s1.id, eng2.id, y)));
  assert.ok(C.needsReexam({ absent: true, value: null }) && !C.needsReexam(null));
  assert.strictEqual(C.studentResult(db, s1, y, 'OLA').status, 'fail');
  assert.throws(() => C.setReexam(db, s1.id, nav.id, y, { value: 7 }, 'admin'), /Μη έγκυρος/);
  assert.throws(() => C.setReexam(db, s1.id, nav.id, y, { value: 2.5 }, 'admin'), /Μη έγκυρος/);
  let g = C.setReexam(db, s1.id, nav.id, y, C.parseManualGrade('2'), 'admin');
  assert.deepStrictEqual([g.re.value, g.re.absent, g.re.by, typeof g.re.at], [2, false, 'admin', 'string']);
  assert.strictEqual(g.value, 0); // the original stays
  assert.strictEqual(C.gradeText(g), '0Α');
  assert.strictEqual(C.finalText(g), '2');
  assert.strictEqual(C.reText(g), '2');
  const f = C.finalGrade(g);
  assert.deepStrictEqual([f.value, f.absent, f.isRe, f.first === g], [2, false, true, true]);
  assert.strictEqual(C.finalGrade(C.getGrade(db, s1.id, eng2.id, y)), C.getGrade(db, s1.id, eng2.id, y)); // no re → itself
  assert.ok(C.isPassing(g));
  const r = C.studentResult(db, s1, y, 'OLA');
  assert.deepStrictEqual([r.status, r.avg], ['pass', 4]); // (2*1 + 5*2) / 3
  const sheet = C.buildGradeSheet(db, y, 'OLA', 'DECK');
  const row = sheet.rows.find((x) => x.student.id === s1.id);
  const cell = row.cells.find((c) => c.subject.id === nav.id);
  assert.deepStrictEqual([cell.grade.value, cell.final.value], [0, 2]);
  assert.strictEqual(sheet.stats.find((x) => x.subject.id === nav.id).passed, 1);
  // re-exam 0Δ / ΑΠ
  g = C.setReexam(db, s1.id, nav.id, y, C.parseManualGrade('0Δ'), 'admin');
  assert.deepStrictEqual([g.re.value, g.re.att, C.reText(g), C.finalText(g)], [0, 'J', '0Δ', '0Δ']);
  assert.ok(!C.isPassing(g));
  g = C.setReexam(db, s1.id, nav.id, y, C.parseManualGrade('ΑΠ'), 'admin');
  assert.deepStrictEqual([g.re.absent, g.re.value, C.reText(g)], [true, null, 'ΑΠ']);
  assert.strictEqual(C.studentResult(db, s1, y, 'OLA').status, 'fail');
  C.setReexam(db, s1.id, nav.id, y, { clear: true });
  assert.ok(!('re' in C.getGrade(db, s1.id, nav.id, y)));
  // a new failing original keeps the re-exam; a passing one drops it
  C.setReexam(db, s1.id, nav.id, y, { value: 3 }, 'admin');
  C.setGrade(db, s1.id, nav.id, y, { absent: true, source: 'teacher' });
  assert.strictEqual(C.getGrade(db, s1.id, nav.id, y).re.value, 3);
  C.setGrade(db, s1.id, nav.id, y, { value: 1 });
  assert.ok(!('re' in C.getGrade(db, s1.id, nav.id, y)));
  void s3;
});

t('re-exam: carry-over uses the final grade; snapshots keep it', () => {
  const db = C.createEmptyDb(new Date(2025, 8, 25));
  const y1 = db.years[0].id;
  const y2 = C.addYear(db, '2026-2027').id;
  const a = C.createStudent(db, { am: '7', lastName: 'Α', firstName: 'Α', specialty: 'DECK' });
  const s = C.createSubject(db, { levelId: 'OLA', name: 'Ναυσιπλοΐα' });
  C.setEnrollment(db, a.id, y1, 'OLA');
  C.setEnrollment(db, a.id, y2, 'OLA');
  C.setGrade(db, a.id, s.id, y1, { value: 0 });
  assert.strictEqual(C.carriedGrade(db, a.id, s.id, y2), null);
  C.setReexam(db, a.id, s.id, y1, { value: 4 }, 'admin');
  const carried = C.carriedGrade(db, a.id, s.id, y2);
  assert.ok(carried && carried.yearId === y1 && carried.value === 0 && carried.re.value === 4); // the stored grade
  assert.strictEqual(C.studentResult(db, a, y2, 'OLA').status, 'pass');
  assert.strictEqual(C.studentLevelRecord(db, a, 'OLA').subjects[0].final.value, 4);
  const snap = C.gradeSnapshot(C.getGrade(db, a.id, s.id, y1));
  assert.deepStrictEqual([snap.value, snap.re.value], [0, 4]);
  // an admin import of a passing original drops the re-exam; undo brings it back
  const plan = C.planGradeImport(db, { table: { rows: [{ rowNum: 2, cells: ['7', 3] }] }, amCol: 0, columns: [{ col: 1, subjectId: s.id }], mode: 'scale', yearId: y1 });
  assert.ok(plan.items[0].reexam);
  const rec = C.commitGradeImport(db, plan, {});
  assert.ok(!('re' in C.getGrade(db, a.id, s.id, y1)));
  C.undoImport(db, rec.id);
  const back = C.getGrade(db, a.id, s.id, y1);
  assert.deepStrictEqual([back.value, back.re.value], [0, 4]);
});

t('re-exam: candidates', () => {
  const { db, y, s1, s2, s3, eng2 } = sampleDb();
  C.setGrade(db, s1.id, eng2.id, y, { value: 0, att: 'J' });
  C.setGrade(db, s2.id, eng2.id, y, { absent: true });
  C.setGrade(db, s3.id, eng2.id, y, { value: 3 });
  let list = C.reexamCandidates(db, eng2, y); // s3 passed → not listed
  assert.deepStrictEqual(list.map((x) => [x.student.am, x.reason]), [
    ['1001', '0 – δικαιολογημένες απουσίες'],
    ['1002', 'Απών'],
  ]);
  C.setReexam(db, s2.id, eng2.id, y, { value: 2 }, 'admin');
  list = C.reexamCandidates(db, eng2, y);
  assert.strictEqual(list.length, 2); // still listed (original failed), with the re-exam grade
  assert.strictEqual(C.reText(list.find((x) => x.student.id === s2.id).grade), '2');
  assert.deepStrictEqual(C.reexamCandidates(db, eng2, y, { spec: 'ENGINE' }).map((x) => x.student.am), ['1002']);
  assert.deepStrictEqual(C.reexamCandidates(db, eng2, y, { spec: '', section: '', period: '' }).length, 2);
  // Γραπτό 0 and periods
  const p = periodDb();
  C.setGrade(p.db, p.a.id, p.sub.id, p.y, { value: 0 });
  C.setGrade(p.db, p.b.id, p.sub.id, p.y, { value: 0, att: 'U' });
  assert.deepStrictEqual(C.reexamCandidates(p.db, p.sub, p.y).map((x) => [x.student.am, x.reason, x.period]), [['101', 'Γραπτό 0', 'OCT'], ['102', '0 – αδικαιολόγητες απουσίες', 'JAN']]);
  assert.deepStrictEqual(C.reexamCandidates(p.db, p.sub, p.y, { period: 'JAN' }).map((x) => x.student.am), ['102']);
});

// ------------------------------------------------------------------ v2.2: 3-way merge
t('mergeRegistry: disjoint changes, conflicts, deletions, settings, order', () => {
  const { db, y, s1, s2, s3, nav, eng2 } = sampleDb();
  C.setGrade(db, s1.id, nav.id, y, { value: 2 });
  const base = JSON.parse(JSON.stringify(db));
  const mine = JSON.parse(JSON.stringify(db));
  const theirs = JSON.parse(JSON.stringify(db));
  // admin: edits a student, adds a student + enrollment, sets a level name, deletes s3's enrollment
  mine.students.find((s) => s.id === s1.id).phone = '6900000000';
  mine.students.push({ id: 'st_new', am: '3000', lastName: 'Νέος', firstName: 'Ν' });
  mine.enrollments.push({ id: 'en_new', studentId: 'st_new', yearId: y, levelId: 'OLA', section: null, period: 'OCT' });
  mine.enrollments = mine.enrollments.filter((e) => e.studentId !== s3.id);
  mine.settings.levelNames = { OLA: 'Επίπεδο Α' };
  mine.updatedAt = '2026-09-28T10:00:00.000Z';
  // teacher (server): enters grades, an import record and a lock; keys in another order
  theirs.grades.push({ id: 'gr_t', studentId: s2.id, subjectId: eng2.id, yearId: y, value: 0, absent: false, att: 'J', source: 'teacher' });
  const g1 = theirs.grades.find((g) => g.studentId === s1.id);
  g1.value = 3;
  theirs.imports.unshift({ id: 'im_t', type: 'grades', date: '2026-09-28T09:00:00.000Z', changes: [] });
  theirs.settings.gradeLocks = { [y + '|' + nav.id]: { at: 1, by: 'admin' } };
  theirs.students = theirs.students.map((s) => (s.id === s2.id ? Object.fromEntries(Object.entries(s).reverse()) : s));
  theirs.updatedAt = '2026-09-28T11:00:00.000Z';
  const snap = JSON.stringify([base, mine, theirs]);
  let r = C.mergeRegistry(base, mine, theirs);
  assert.deepStrictEqual(r.conflicts, []);
  const M = r.merged;
  assert.strictEqual(M.students.find((s) => s.id === s1.id).phone, '6900000000');
  assert.ok(M.students.some((s) => s.id === 'st_new'));
  assert.deepStrictEqual(M.students.map((s) => s.id), [s1.id, s2.id, s3.id, 'st_new']); // theirs' order, then mine's new ones
  assert.ok(M.enrollments.some((e) => e.studentId === 'st_new'));
  assert.ok(!M.enrollments.some((e) => e.studentId === s3.id)); // deletion kept
  assert.strictEqual(M.grades.find((g) => g.studentId === s1.id).value, 3);
  assert.strictEqual(M.grades.find((g) => g.id === 'gr_t').att, 'J');
  assert.deepStrictEqual(M.settings.levelNames, { OLA: 'Επίπεδο Α' });
  assert.ok(M.settings.gradeLocks[y + '|' + nav.id]);
  assert.strictEqual(M.imports[0].id, 'im_t');
  assert.strictEqual(M.updatedAt, '2026-09-28T11:00:00.000Z');
  assert.strictEqual(JSON.stringify([base, mine, theirs]), snap); // inputs untouched
  M.students[0].lastName = 'Χ';
  assert.notStrictEqual(theirs.students[0].lastName, 'Χ'); // no shared objects
  // the same record changed on both sides → conflict, mine wins in merged
  const m2 = JSON.parse(JSON.stringify(base));
  const t2 = JSON.parse(JSON.stringify(base));
  m2.grades.find((g) => g.studentId === s1.id).value = 4;
  t2.grades.find((g) => g.studentId === s1.id).value = 5;
  m2.students.find((s) => s.id === s2.id).phone = '1';
  t2.students.find((s) => s.id === s2.id).phone = '1'; // same change → fine
  m2.settings.gradeLocks = { k: { at: 1 } };
  t2.settings.gradeLocks = { k: { at: 2 } };
  m2.settings.currentYearId = 'x';
  t2.settings.currentYearId = 'z';
  r = C.mergeRegistry(base, m2, t2);
  const keys = r.conflicts.map((c) => c.collection + ':' + c.key).sort();
  assert.deepStrictEqual(keys, ['grades:' + s1.id + '|' + nav.id + '|' + y, 'settings.gradeLocks:k', 'settings:currentYearId']);
  assert.strictEqual(r.merged.grades.find((g) => g.studentId === s1.id).value, 4);
  assert.strictEqual(r.merged.students.find((s) => s.id === s2.id).phone, '1');
  // deletions: deleted on one side and unchanged on the other → gone; deleted vs changed → conflict
  const m3 = JSON.parse(JSON.stringify(base));
  const t3 = JSON.parse(JSON.stringify(base));
  m3.students = m3.students.filter((s) => s.id !== s2.id); // admin deletes s2…
  t3.students.find((s) => s.id === s2.id).email = 'x@y'; // …that the other side changed
  t3.subjects = t3.subjects.filter((s) => s.id !== eng2.id); // other side deletes a subject
  r = C.mergeRegistry(base, m3, t3);
  assert.deepStrictEqual(r.conflicts, [{ collection: 'students', key: s2.id }]);
  assert.ok(!r.merged.students.some((s) => s.id === s2.id));
  assert.ok(!r.merged.subjects.some((s) => s.id === eng2.id));
  // nothing changed → theirs; no base → only differences conflict
  assert.deepStrictEqual(C.mergeRegistry(base, base, base).merged, base);
  assert.deepStrictEqual(C.mergeRegistry(null, base, base).conflicts, []);
  assert.ok(C.deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
  assert.ok(!C.deepEqual({ a: 1 }, { a: 1, b: null }));
  assert.ok(C.deepEqual({ a: 1, b: undefined }, { a: 1 }));
});

t('mergeRegistry: large registry stays fast', () => {
  const base = { schema: 1, settings: {}, years: [], students: [], enrollments: [], subjects: [], grades: [], imports: [] };
  for (let i = 0; i < 5000; i++) base.students.push({ id: 's' + i, am: String(i), lastName: 'L' + i, firstName: 'F' });
  for (let i = 0; i < 100000; i++) base.grades.push({ id: 'g' + i, studentId: 's' + (i % 5000), subjectId: 'j' + Math.floor(i / 5000), yearId: 'y', value: i % 6, absent: false });
  const mine = JSON.parse(JSON.stringify(base));
  const theirs = JSON.parse(JSON.stringify(base));
  mine.students[10].phone = '1';
  theirs.grades[500].value = 5;
  const t0 = Date.now();
  const r = C.mergeRegistry(base, mine, theirs);
  const ms = Date.now() - t0;
  assert.deepStrictEqual(r.conflicts, []);
  assert.strictEqual(r.merged.grades.length, 100000);
  assert.strictEqual(r.merged.grades[500].value, 5);
  assert.strictEqual(r.merged.students[10].phone, '1');
  assert.ok(ms < 3000, 'merge took ' + ms + ' ms');
});

console.log(passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
