# GMC Registry v2.2 — shared contract (periods, 0-due-to-absences codes, re-exam, syllabus, English student UI)

Everything below is the agreed data/API shape. Client (src/*.js), core (src/core.js) and server (server/*.go)
must all follow it exactly.

## 1. Periods (περίοδοι / intakes) — stored on the enrollment

The academy runs intakes inside each academic year:
Support every October and every January · Operational A only October · Operational B January or May.
Management levels: no periods (by default).

Registry `settings`:

```json
"periods": [
  {"id": "OCT", "name": "Οκτώβριος", "short": "Οκτ"},
  {"id": "JAN", "name": "Ιανουάριος", "short": "Ιαν"},
  {"id": "MAY", "name": "Μάιος",     "short": "Μάι"}
],
"levelPeriods": {"SUP": ["OCT", "JAN"], "OLA": ["OCT"], "OLB": ["JAN", "MAY"]}
```

- A level id missing from `levelPeriods` (or with `[]`) has no periods (MF1/MF2/MF3 by default).
- Both are editable by the admin (Ρυθμίσεις). Period ids are short uppercase strings.

Enrollment: `{studentId, yearId, levelId, section, period, withdrawn?}` — `period` is a period id or `null`.
A level with exactly one period gets it automatically (OLA → OCT).

Teacher assignment: `{yearId, subjectId, spec, section, period, label}` — `period` "" = all periods.

Class rule (server `members()` ≡ client `Core.assignmentStudents`) gains one condition:
if `a.period != ""` the student's enrollment `period` must equal `a.period`.

## 2. Grade codes: 0 due to absences

Grade object (in `registry.grades`):

```json
{"id","studentId","subjectId","yearId","value": 0..5|null,"absent": bool,
 "att": "J"|"U" (optional), "percent": null, "source","importId","updatedAt","by",
 "re": {"value","absent","att","at","by"} (optional)}
```

- `att` exists only when `value === 0 && !absent`:
  - `"J"` = 0 λόγω **δικαιολογημένων** απουσιών — displayed/exported as **`0Δ`**
  - `"U"` = 0 λόγω **αδικαιολόγητων** απουσιών — displayed/exported as **`0Α`**
- `ΑΠ` = absent from the exam (`absent: true, value: null`), `0` = written exam 0.
- Accepted input spellings (Excel cells and typing), case/accents/spaces/dots/dashes ignored, Latin or Greek letters:
  - J: `0Δ`, `0Δικ`, `0 δικαιολογημένες (απουσίες)`, `0D`, `0J`, `0 justified`
  - U: `0Α`, `0Αδ`, `0Αδικ`, `0 αδικαιολόγητες (απουσίες)`, `0A`, `0U`, `0 unjustified`
- Import snapshots (`imports[].changes[].before/after`) include `att`.

## 3. Re-exam

- Failed = original grade is `ΑΠ`, `0`, `0Δ` or `0Α` (i.e. absent or value < 1).
- The **admin only** enters the re-exam grade by hand in the gradebook → stored in `grade.re`
  (`{value, absent, att, at, by}`); the original stays as it is.
- The final grade (results, averages, pass/fail, carry-over, transcripts, overall exports) = `re` when present, else the original.
- Teachers never write `re`. Server: a teacher change for a student whose grade has `re` →
  manual: HTTP 409 `{error, reexam: true}`; Excel import: that row is skipped and counted in `stats.reexam`.
  Any teacher write keeps an existing `re` untouched.
- Every per-subject Excel (admin per-subject export and teacher template/download) gets an extra sheet
  **"Re-exam"** listing the failed students (ΑΠ, 0, 0Δ, 0Α) with a «Αιτία» column
  (Απών / Γραπτό 0 / 0 – δικαιολογημένες απουσίες / 0 – αδικαιολόγητες απουσίες) and the re-exam grade if entered.
  Grade imports ignore a sheet named "Re-exam".

## 4. Syllabus (Ύλη) — PDF files per subject, stored on the server

Server storage: `<data>/syllabus/index.json` (array of entries) + `<data>/syllabus/<id>.pdf`.
Entry: `{id, subjectId, name, size, uploadedAt (ISO), by (username), byName, byRole}`.

| Method & path | Who | What |
|---|---|---|
| `GET /api/syllabus?subjectId=ID` | admin, teacher | `{files:[entry…]}` — admin: all (or one subject); teacher: only subjects he is assigned to (any year) |
| `POST /api/syllabus/{subjectId}` | admin, assigned teacher | raw body = PDF bytes; header `X-File-Name: encodeURIComponent(name)`; max 50 MB; must start with `%PDF-`; subject must exist → `{file: entry}` |
| `GET /api/syllabus/files/{id}` | admin, assigned teacher | the PDF bytes (`application/pdf`) |
| `DELETE /api/syllabus/files/{id}` | admin, assigned teacher | `{ok:true}` |
| `GET /api/my/syllabus` | student | `{level:{id,name}, subjects:[{id, code, name, files:[{id,name,size,uploadedAt}]}]}` — subjects of his enrollment in `settings.currentYearId` (else his latest enrollment): same level, `active !== false`, and (level SUP, or subject specialty COMMON, or student has no specialty, or same specialty); in subject `order` |
| `GET /api/my/syllabus/files/{id}` | student | PDF bytes, only when the file's subject is in his list (else 404) |

"Assigned teacher" = the teacher has any assignment (any year) with that subjectId.
Syllabus files are not put in the daily zip backup (they can be large); the README says to copy the data folder.

## 5. Language (English student interface)

- The student portal is always English.
- The login screen has a ΕΛ / EN switch, remembered per PC (`api.setPrefs({lang})`).
- The client sends header `X-Lang: en` or `X-Lang: el` on every request (`Remote.lang`).
- Server: errors of `/api/login`, `/api/me/password`, `/api/my/*`, the LAN-only check and expired-session
  responses have an English text used when `X-Lang: en`. CORS allows headers `Authorization, Content-Type, X-Lang, X-File-Name`.

## 6. Admin saves: automatic merge instead of a conflict dialog

Teachers write grades straight into the registry while the admin works. When the admin's save gets 409,
the client 3-way-merges (`Core.mergeRegistry(base, mine, theirs)`) and saves again; the conflict dialog
appears only when the same record was changed on both sides.

## 7. Calendar & absences (ημερολόγιο τμήματος, απουσίες ανά ώρα, όριο ανά μάθημα)

Registry collections (both optional in older registries — `normalizeDb` adds them):

```json
"calendar": [{"yearId", "cls", "date": "YYYY-MM-DD", "subjectId"}],
"absences": [{"studentId", "yearId", "date": "YYYY-MM-DD", "hour": 1…, "subjectId", "by", "at", "src": "admin"|"teacher"}]
```

- **One subject per day per class.** `cls` = `levelId|spec|section|period` (`''` for a missing part):
  Support has no specialty (Deck & Engine together), Management has no section (the year's shift is the whole class's),
  `period` is the enrollment's period as stored. A student's class = his enrollment of that year (`Core.studentCalendarKey`).
- **Absences per hour.** A day has `settings.hoursPerDay` hours (integer 1–12, default **4**); one record per student, day and hour,
  for the subject his class has that day. A record without a valid `hour` (integer ≥ 1) is not counted; `normalizeDb` turns an older
  whole-day record (no `hour`) into one record per hour of the day. Changing a day's subject moves that day's records of the class's
  students to the new subject; clearing the day deletes them.
- **Limit per subject, in hours:** `subject.absenceLimit` (integer ≥ 0), set by the admin (Μαθήματα); missing / anything else = no limit.
  More hours of absence in the subject (that year, all classes) than the limit = over the limit.
- Merge keys: calendar `yearId|cls|date`, absences `studentId|yearId|date|hour` (the same hour added on both sides is not a conflict).
- Cascades: deleting a student / subject / year deletes its absences (and a subject's / year's calendar days).

Server (`server/attendance.go`, the twin of the Core functions; `test/attendance-fixtures.json` keeps both identical):

| Method & path | Who | What |
|---|---|---|
| `POST /api/teacher/absences` | teacher | `{yearId, subjectId, date, changes:[{studentId, hour, absent}]}` → `{rev, stats:{added, removed, same}}`. The subject must be his (any assignment of that year), the student in his classes, the student's class must have that subject that day, `hour` 1…hoursPerDay, the date not after tomorrow. No change → no new revision. |
| `POST /api/exams/{id}/absence-allow` | admin | `{am, allowed}` → `{absenceAllowed:{am:{by, at}}}` — the student may take **this** exam although over the limit. |

- Exam file: `absenceAllowed: {am: {by, at}}` (kept only for students still assigned; a duplicated exam starts without it).
- An exam with `subjectId` and `yearId` is checked: `GET /api/my/exams` gives a not-started exam `barred: true, absences (hours), absenceLimit`
  when the student is over the limit and not allowed; `POST /api/my/exams/{id}/start` then answers **403**
  `{error, state: "barred", code: "absences", absences, absenceLimit}` (English text with `X-Lang: en`). A started attempt is never stopped.
- `GET /api/exams/{id}/results`: `exam.absenceCheck`; rows get `absences (hours), absenceDays, absenceLimit (null = no limit), overLimit, absenceAllowed`.
  `GET /api/exams/{id}` includes `absenceAllowed`.
- Teacher view (`GET /api/teacher/data`): `calendar` = the days of his subjects in his students' classes, `absences` = his students'
  absences in his subjects, `settings.hoursPerDay`; his subjects carry `absenceLimit`.
