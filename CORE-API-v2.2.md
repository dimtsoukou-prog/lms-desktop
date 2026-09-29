# v2.2 — what already exists (wave 1 done) — read together with CONTRACT-v2.2.md

## src/core.js (window.Core, `C` in the pages) — new / changed

Periods
- `DEFAULT_PERIODS`, `DEFAULT_LEVEL_PERIODS`, `usePeriods(settings)` (normalizeDb/createEmptyDb call it)
- `periodList()` → active periods `[{id,name,short}]`
- `levelPeriods(db, levelId)` → that level's period objects (settings order), `[]` if none
- `levelHasPeriods(db, levelId)`, `singlePeriod(db, levelId)` → id|null, `validPeriodFor(db, levelId, id)`
- `periodName(id)`, `periodShort(id)` ('' for null, the id itself if unknown), `periodIndex(id)` (sort; none last)
- `classPeriod(db, levelId, period)` → the period, or null when it is the level's ONLY period
  (so Operational A classes keep their old names). Use it before building class names/keys.
- `parsePeriod(value)` → id|null (ids, names, Greek/English months, numbers, dates, Excel cells)
- `addPeriod(db, name, short)` → period · `renamePeriod(db, id, name, short)` · `removePeriod(db, id)` (throws if used) ·
  `periodUsage(db, id)` → count · `setLevelPeriods(db, levelId, ids)`
- `studentClass(db, student, yearId, en?)` → `{levelId, spec, section, period, key, name}` | null  ← use this for class keys/names
- `teachingPeriodOptions(db, subject)` → `[]` or `[{period:'', label:'Όλες οι περίοδοι'}, {period:id,label:name}…]`
  (hide the select when the level has ≤ 1 period, i.e. options.length ≤ 2)
- `assignmentLabel(db, a)` → class label + ' – ' + period name
- New optional trailing args (old calls unchanged): `setEnrollment(db, sid, yid, levelId, section, period)`
  (period undefined → keep/auto), `enrolledStudents(db, yid, levelId, spec, section, period)` (period undefined/'ALL' | 'NONE' | id),
  `classFullName(db, lv, spec, sec, period)`, `classShortName(lv, spec, sec, period)`, `transcriptClassKey(lv, spec, sec, period)`,
  `identityCheck(…, section, period)`, `buildGradeSheet(db, yid, lv, spec, section, period)` (rows get `period`, cells get `final`),
  `subjectRoster(db, subject, yid, filter?)` / `subjectRosterByClass(db, subject, yid, filter?)` (filter = period id or {period, section, spec}; groups get `period`),
  `levelSummary(db, yid, lv, spec, period?)`
- `planTransfer(db, opts)`: `opts.period` filters the source; `opts.toPeriod` = 'same' (default) | '' | id; items get fromPeriod/toPeriod
- `planStudentImport(db, opts)`: column mapping `map.period`, `opts.defaultPeriod`; items get `period`; warnings in `issues`
- `guessColumnRole(header)` has the new role `'period'`; `parseClassText` also returns `period`
- `assignmentStudents(db, a)` filters by `a.period`

Grade codes (0 due to absences)
- grade `att`: 'J' → text **0Δ** (δικαιολογημένες), 'U' → **0Α** (αδικαιολόγητες); only with value 0
- `ATT_TEXT`, `ATT_LABEL`, `GRADE_RULE`, `parseAttCode(text)`
- `parseGradeCell` / `parseManualGrade` return `att`; **pass `att` on to `setGrade(db, sid, subj, yid, {value, absent, att, source})`**
- `gradeText(g)` → original grade text incl. 0Δ/0Α · `gradeReason(g)` → 'Απών' | 'Γραπτό 0' | ATT_LABEL | ''

Re-exam (admin only, by hand in the gradebook)
- `needsReexam(g)` (original fails) · `finalGrade(g)` (g, or a copy with the re values + `isRe:true, first:g`) ·
  `finalText(g)` · `reText(g)` · `isPassing(g)` uses the final grade
- `setReexam(db, sid, subjectId, yearId, {value, absent, att} | {clear:true}, by)` — throws (Greek) if no grade / original passes
- `reexamCandidates(db, subject, yearId, filter?)` → `[{student, grade, reason, final, period, section}]`
- `computeResult` / `studentResult` / `carriedGrade` use the final grade; `setGrade` removes `re` if the new original passes
- `planGradeImport` items get `reexam: true` when the grade already has a re-exam

Merge
- `deepEqual(a, b)` · `mergeRegistry(base, mine, theirs)` → `{merged, conflicts:[{collection, key}]}` (inputs untouched)

## src/remote.js (window.Remote)
`Remote.lang` ('el'|'en', header X-Lang) · `syllabus(subjectId?)` → {files} · `uploadSyllabus(subjectId, name, bytes)` → {file} ·
`syllabusFile(id)` → Uint8Array · `deleteSyllabus(id)` · `mySyllabus()` · `mySyllabusFile(id)` · plus the existing
`users()`, `setTeacherAssignments(id, assignments)`, `teacherData()`, `teacherRev()`, `teacherGrades({yearId, subjectId, source, fileName?, changes:[{studentId, value, absent, att} | {studentId, clear:true}]})`
(409 with `e.data.reexam` / `e.data.locked`; import stats may include `reexam`)
Syllabus entry: `{id, subjectId, name, size, uploadedAt, by, byName, byRole}`.

## src/pdf-view.js
`App.pdfViewer.open({title, bytes, fileName, lang:'el'|'en', sub?, onClose?})` — in-app PDF viewer + "save a copy".

## Pickers
`api.openFile({title, filters:[{name:'PDF', extensions:['pdf']}]})` → {name, path, data: Uint8Array} | null (tests: window.__testOpenQueue).

## Calendar & absences (see CONTRACT-v2.2.md §7)

- Dates: `validIsoDate(s)`, `isoDate(date?)` (local → "YYYY-MM-DD"), `addDays(s, n)`, `isoWeekday(s)` (0 = Sunday), `dateText(s)` ("dd/mm/yyyy"),
  `yearDateRange(db, yearId)` → `{from: "YYYY-09-01", to: "YYYY+1-08-31"}` | null
- Hours & limits: `DEFAULT_HOURS_PER_DAY` (4), `hoursPerDay(db)`, `setHoursPerDay(db, value)` (throws Greek),
  `subjectAbsenceLimit(subject)` → hours | null, `parseAbsenceLimit(value)` → hours | null ('' = no limit; throws Greek);
  `createSubject` / `updateSubject` take `absenceLimit`
- Classes: `calendarKey(levelId, spec, section, period)`, `parseCalendarKey(key)`, `studentCalendarKey(db, student, yearId, enrollment?)`,
  `calendarClassName(db, yearId, key)`, `calendarClasses(db, yearId)` → `[{key, levelId, spec, section, period, name, students}]`,
  `classStudents(db, yearId, key)`, `calendarSubjects(db, yearId, key)`
- Lookups: `attendance(db, yearId)` → `{hpd, cal:{day: "cls|date"→subjectId, days: "cls|subjectId"→n}, abs:{byDay: "studentId|date"→[hours], bySubject: "studentId|subjectId"→[{date, hour}]}}`,
  `calendarDay(db, yearId, key, date)`, `subjectDays(db, yearId, key, subjectId)`, `absenceHours(db, studentId, yearId, date)`, `getAbsence(db, studentId, yearId, date, hour)`
- Edits: `setCalendarDay(db, yearId, key, date, subjectId|null)` → `{changed, moved, removed}` (the day's absences follow),
  `planFill(db, yearId, key, {from, to, subjectId, weekdays, overwrite})` → `{dates, change, keep}`, `fillCalendar(…)` → `{set, kept, moved, removed}`,
  `copyCalendar(db, yearId, fromKey, toKey, overwrite)`, `setAbsence(db, studentId, yearId, date, hour, on, {by, src})` (throws when the class has no subject that day),
  `setDayAbsences(db, studentId, yearId, date, hours, meta)` (exactly those hours)
- Status: `absenceStatus(db, student, subjectId, yearId, att?)` → `{count (hours), limit, over, left, days, hours, entries:[{date, hour}], dates}`,
  `absenceEntriesText(entries)` → `["12/11/2026 (1η, 3η ώρα)", …]`,
  `absenceSummary(db, yearId, key)` → `{hpd, subjects:[{subject, days, limit}], rows:[{student, withdrawn, cells:[{count, over, entries}], total, over}]}`,
  `subjectDates(db, yearId, subjectId, students)` → `[{date, students}]`, `subjectAttendanceUsage(db, subjectId)` → `{days, absences}`

## Pages
- `p-calendar.js` — «Ημερολόγιο & απουσίες» (admin): month grid per class, day dialog (subject + hour toggles per student), «Συμπλήρωση ημερών»,
  «Αντιγραφή από τμήμα», «Απουσίες» summary in hours (click a number: the days and hours, delete one; «Όλοι | Μόνο εκτός ορίου» filter,
  opened already filtered from «εκτός ορίου» in the legend). The month grid shows only each day's subject. Settings: «Απουσίες» card (hours per day).
- `p-subjects.js` — «Όριο απουσιών (ώρες)» in the subject form and table.
- `p-exams.js` — «Απουσίες» column + «Να γράψει» / «Ανάκληση άδειας» in the results and in the assignment list (`Remote.allowAbsence(id, am, on)`).
- `p-teacher.js` — «Βαθμοί | Απουσίες»: one day at a time, hour toggles per student (+ «όλες»), saved at once (`Remote.teacherAbsences(payload)`), hours / limit per student.
- `p-student.js` — a barred exam: "Not eligible" card with the absences and the limit, no Start button; **Absences** tab
  (`Remote.myAbsences()` → per subject the dates and hours, and the total; no limits).
- `p-students.js` — student card tab «Απουσίες» (per year and subject).
