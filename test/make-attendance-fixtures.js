/* JS calendar/absence results used by the Go server tests (server/attendance_test.go) so both decide "over the limit" identically. */
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');

// limits: absence limit (hours) of each subject by code, hpd: settings.hoursPerDay
function registry(limits, hpd) {
  const db = C.createEmptyDb(new Date(2026, 8, 25));
  const y = db.years[0].id;
  const y2 = C.addYear(db, '2027-2028').id;
  if (hpd !== undefined) db.settings.hoursPerDay = hpd;
  const st = (am, spec) => C.createStudent(db, { am, lastName: 'L' + am, firstName: 'F', specialty: spec });
  const s = {
    supDeck: st('301', 'DECK'),
    supEng: st('302', 'ENGINE'),
    supJan: st('303', 'DECK'),
    olaDeck: st('304', 'DECK'),
    olaNone: st('305', ''),
    mfDeck: st('306', 'DECK'),
    olbEng: st('307', 'ENGINE'),
    nowhere: st('308', 'DECK'),
    nextYear: st('309', 'ENGINE'),
  };
  C.setEnrollment(db, s.supDeck.id, y, 'SUP', 'M1', 'OCT');
  C.setEnrollment(db, s.supEng.id, y, 'SUP', 'M1', 'OCT');
  C.setEnrollment(db, s.supJan.id, y, 'SUP', 'M2', 'JAN');
  C.setEnrollment(db, s.olaDeck.id, y, 'OLA', 'MO');
  C.setEnrollment(db, s.olaNone.id, y, 'OLA', 'MO');
  C.setEnrollment(db, s.mfDeck.id, y, 'MF1');
  C.setMgmtShift(db, y, 'MF1', 'DECK', 'AF');
  C.setEnrollment(db, s.olbEng.id, y, 'OLB', 'AF', 'MAY');
  C.setEnrollment(db, s.nextYear.id, y2, 'SUP', 'M1', 'OCT');
  const sj = (levelId, code, specialty) => C.createSubject(db, { levelId, code, name: code, specialty });
  const nav = sj('SUP', 'NAV');
  const eng = sj('SUP', 'ENG');
  const ola = sj('OLA', 'OLA1', 'DECK');
  const olaC = sj('OLA', 'OLA2', 'COMMON');
  const mf = sj('MF1', 'MF', 'DECK');
  const olb = sj('OLB', 'OLB', 'ENGINE');
  const fill = (key, subject, from, to, yr) => C.fillCalendar(db, yr || y, key, { from, to, subjectId: subject.id });
  const key = (student, yr) => C.studentCalendarKey(db, student, yr || y);
  fill(key(s.supDeck), nav, '2026-10-05', '2026-10-30'); // 20 days
  fill(key(s.supDeck), eng, '2026-11-02', '2026-11-10'); // 7 days
  fill(key(s.supJan), nav, '2027-01-11', '2027-01-13'); // 3 days
  fill(key(s.olaDeck), ola, '2026-10-05', '2026-10-16'); // 10 days (the key of a student without specialty differs)
  fill(key(s.olaNone), olaC, '2026-10-05', '2026-10-05'); // 1 day
  fill(key(s.mfDeck), mf, '2026-10-05', '2026-10-09'); // 5 days
  fill(key(s.olbEng), olb, '2027-05-03', '2027-05-14'); // 10 days
  fill(key(s.nextYear, y2), nav, '2027-10-04', '2027-10-15', y2); // 10 days, other year
  // hand-made oddities: a second record of a day (the first counts) and a record without a subject
  db.calendar.push({ yearId: y, cls: key(s.supDeck), date: '2026-10-05', subjectId: eng.id });
  db.calendar.push({ yearId: y, cls: key(s.supDeck), date: '2026-11-11', subjectId: '' });
  db.subjects.forEach((sj) => {
    if (limits[sj.code] !== undefined) sj.absenceLimit = limits[sj.code]; // also odd values, as a hand-edited registry could have
  });
  // hours absent per date: a number n = hours 1…n, an array = those hours
  const absent = (student, dates, yr) =>
    Object.keys(dates).forEach((d) => {
      const hs = Array.isArray(dates[d]) ? dates[d] : Array.from({ length: dates[d] }, (x, i) => i + 1);
      C.setDayAbsences(db, student.id, yr || y, d, hs, { by: 'x' });
    });
  absent(s.supDeck, { '2026-10-05': 4, '2026-10-06': [2], '2026-10-07': 2, '2026-10-12': [1, 3], '2026-11-02': 1 });
  absent(s.supEng, { '2026-10-05': 3, '2026-10-06': 4, '2026-11-02': [4], '2026-11-03': 2 });
  absent(s.supJan, { '2027-01-11': [2] });
  absent(s.olaDeck, { '2026-10-05': 4, '2026-10-06': 1 });
  absent(s.olaNone, { '2026-10-05': 2 });
  absent(s.mfDeck, { '2026-10-05': [1, 4], '2026-10-06': 1 });
  absent(s.olbEng, { '2027-05-03': 4, '2027-05-04': [3] });
  absent(s.nextYear, { '2027-10-04': 4, '2027-10-05': 4 }, y2);
  // a second record of an hour (the first counts), records without a subject / without a valid hour,
  // an old whole-day record (no hour: not counted until the app converts it), an absence of a student without enrollment
  db.absences.push({ studentId: s.supDeck.id, yearId: y, date: '2026-10-05', hour: 1, subjectId: eng.id });
  db.absences.push({ studentId: s.olaDeck.id, yearId: y, date: '2026-10-09', hour: 1, subjectId: '' });
  db.absences.push({ studentId: s.olaDeck.id, yearId: y, date: '2026-10-12', hour: 0, subjectId: ola.id });
  db.absences.push({ studentId: s.olaDeck.id, yearId: y, date: '2026-10-13', hour: 1.5, subjectId: ola.id });
  db.absences.push({ studentId: s.olaDeck.id, yearId: y, date: '2026-10-14', hour: '2', subjectId: ola.id });
  db.absences.push({ studentId: s.olaDeck.id, yearId: y, date: '2026-10-15', subjectId: ola.id });
  db.absences.push({ studentId: s.nowhere.id, yearId: y, date: '2026-10-05', hour: 3, subjectId: nav.id });
  const checks = [];
  Object.values(s).forEach((student) =>
    [nav, eng, ola, olaC, mf, olb].forEach((subject) =>
      [y, y2].forEach((yearId) => {
        const r = C.absenceStatus(db, student, subject.id, yearId);
        // [studentId, subjectId, yearId, count, days, limit (-1 = none), over]
        checks.push([student.id, subject.id, yearId, r.count, r.days, r.limit === null ? -1 : r.limit, r.over]);
      })
    )
  );
  return { registry: db, checks };
}

const out = {
  keys: [
    ['SUP', 'DECK', 'M1', 'OCT'],
    ['SUP', '', null, null],
    ['OLA', 'DECK', 'MO', 'OCT'],
    ['OLA', 'ENGINE', null, 'OCT'],
    ['OLB', '', 'AF', 'MAY'],
    ['MF1', 'DECK', 'AF', null],
    ['MF3', '', null, null],
  ].map((k) => ({ levelId: k[0], spec: k[1], section: k[2], period: k[3], key: C.calendarKey(k[0], k[1], k[2], k[3]) })),
  limits: [undefined, 6, 0, 12, '6', 2.5, -1, null].map((v) => ({ value: v === undefined ? null : v, missing: v === undefined, limit: C.subjectAbsenceLimit(v === undefined ? {} : { absenceLimit: v }) === null ? -1 : C.subjectAbsenceLimit({ absenceLimit: v }) })),
  hpds: [undefined, 4, 5, 1, 12, 0, 13, '4', 3.5, null].map((v) => ({ value: v === undefined ? null : v, missing: v === undefined, hpd: C.hoursPerDay({ settings: v === undefined ? {} : { hoursPerDay: v } }) })),
  cases: [registry({ NAV: 6, ENG: 2, OLA1: 3, OLA2: 0, MF: 2 }), registry({ NAV: 10, OLB: 4, OLA1: '3', MF: 1.5 }, 5), registry({})],
};
// stable output: ids by order of appearance, fixed timestamps
const ids = new Map();
const text = JSON.stringify(out)
  .replace(/\b(st|sb|yr|en)_[a-z0-9]+/g, (m, p) => ids.get(m) || (ids.set(m, p + (ids.size + 1)), ids.get(m)))
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '2026-09-25T00:00:00.000Z');
fs.writeFileSync(path.join(__dirname, 'attendance-fixtures.json'), text + '\n');
console.log('fixtures written: ' + out.cases.reduce((n, c) => n + c.checks.length, 0) + ' checks');
