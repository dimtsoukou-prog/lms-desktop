package main

// Attendance: the teaching calendar of each class (one subject per day) and the students' absences,
// both kept in the registry — calendar: [{yearId, cls, date, subjectId}], absences: [{studentId, yearId,
// date, subjectId, by, at, src}]. This is the server twin of the calendar/absence part of src/core.js
// (calendarKey, absenceLimit, absenceStatus); test/attendance-fixtures.json keeps both in agreement.
//
// Limit of a subject = settings.absenceLimitPct (default 30) % of its days in the student's class calendar,
// rounded down (20 days → 6). A student with more absences than that may not start the exams of the subject,
// unless the admin allowed it for that exam (exam.absenceAllowed[am]). Teachers record the absences of their
// subjects/classes (POST /api/teacher/absences); the secretariat records them in the app (registry save).

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"
)

const defaultAbsencePct = 30

type regCalDay struct {
	YearID    string `json:"yearId"`
	Cls       string `json:"cls"`
	Date      string `json:"date"`
	SubjectID string `json:"subjectId"`
}

type regAbsence struct {
	StudentID string `json:"studentId"`
	YearID    string `json:"yearId"`
	Date      string `json:"date"`
	SubjectID string `json:"subjectId"`
}

// AbsenceAllow: the admin let a student over the absence limit take an exam.
type AbsenceAllow struct {
	By string `json:"by"`
	At int64  `json:"at"`
}

// absencePct: settings.absenceLimitPct when it is an integer 0–100, else 30 (as core.js absenceLimitPct).
func absencePct(settings map[string]any) int {
	v, ok := settings["absenceLimitPct"].(float64)
	if !ok || v != math.Trunc(v) || v < 0 || v > 100 {
		return defaultAbsencePct
	}
	return int(v)
}

// absenceLimit: absences allowed with `days` days in the calendar (⌊days × pct / 100⌋); -1 without days.
func absenceLimit(days, pct int) int {
	if days <= 0 {
		return -1
	}
	return days * pct / 100
}

// calendarKey: "levelId|spec|section|period" of a class (Support: no specialty · Management: no section).
func calendarKey(levelID, spec string, section, period *string) string {
	sp := ""
	if levelID != "SUP" && hasSpec(spec) {
		sp = spec
	}
	sec := ""
	if !isShiftLevel(levelID) && section != nil {
		sec = *section
	}
	per := ""
	if period != nil {
		per = *period
	}
	return levelID + "|" + sp + "|" + sec + "|" + per
}

func validDate(s string) bool {
	if len(s) != 10 {
		return false
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// "2026-11-12" → "12/11/2026"
func dateText(s string) string {
	if !validDate(s) {
		return s
	}
	return s[8:10] + "/" + s[5:7] + "/" + s[0:4]
}

// ------------------------------------------------------------ lookups (built once per registry revision)
type absStatus struct {
	Count int  `json:"count"`
	Days  int  `json:"days"`
	Limit int  `json:"limit"` // -1 = the subject has no days in the class calendar (no limit)
	Over  bool `json:"over"`
}

type attIndex struct {
	rev      int64
	pct      int
	students map[string]*regStudent
	byAM     map[string]string         // normAm → student id
	enroll   map[string]*regEnrollment // studentId|yearId → enrollment (the first one, as core.js getEnrollment)
	days     map[string]int            // yearId|cls|subjectId → days (the first record of a day counts)
	absences map[string]int            // studentId|yearId|subjectId → absences (one per day)
}

func buildAttendance(rev int64, data []byte) *attIndex {
	var doc struct {
		Students    []regStudent    `json:"students"`
		Enrollments []regEnrollment `json:"enrollments"`
		Calendar    []regCalDay     `json:"calendar"`
		Absences    []regAbsence    `json:"absences"`
		Settings    map[string]any  `json:"settings"`
	}
	json.Unmarshal(data, &doc) // a field of an unexpected type is skipped, the rest is still read
	x := &attIndex{rev: rev, pct: absencePct(doc.Settings), students: map[string]*regStudent{}, byAM: map[string]string{},
		enroll: map[string]*regEnrollment{}, days: map[string]int{}, absences: map[string]int{}}
	for i := range doc.Students {
		s := &doc.Students[i]
		if _, ok := x.students[s.ID]; !ok {
			x.students[s.ID] = s
		}
		if am := normAm(s.AM); am != "" {
			if _, ok := x.byAM[am]; !ok {
				x.byAM[am] = s.ID
			}
		}
	}
	for i := range doc.Enrollments {
		e := &doc.Enrollments[i]
		k := e.StudentID + "|" + e.YearID
		if _, ok := x.enroll[k]; !ok {
			x.enroll[k] = e
		}
	}
	seen := map[string]bool{}
	for _, c := range doc.Calendar {
		if c.SubjectID == "" {
			continue
		}
		k := c.YearID + "|" + c.Cls + "|" + c.Date
		if seen[k] {
			continue
		}
		seen[k] = true
		x.days[c.YearID+"|"+c.Cls+"|"+c.SubjectID]++
	}
	seen = map[string]bool{}
	for _, a := range doc.Absences {
		k := a.StudentID + "|" + a.YearID + "|" + a.Date
		if seen[k] {
			continue
		}
		seen[k] = true
		if a.SubjectID != "" {
			x.absences[a.StudentID+"|"+a.YearID+"|"+a.SubjectID]++
		}
	}
	return x
}

// status: a student's absences in a subject (year) against the limit of his class calendar.
func (x *attIndex) status(studentID, subjectID, yearID string) absStatus {
	out := absStatus{Count: x.absences[studentID+"|"+yearID+"|"+subjectID], Limit: -1}
	st := x.students[studentID]
	en := x.enroll[studentID+"|"+yearID]
	if st == nil || en == nil {
		return out
	}
	out.Days = x.days[yearID+"|"+calendarKey(en.LevelID, st.Specialty, en.Section, en.Period)+"|"+subjectID]
	out.Limit = absenceLimit(out.Days, x.pct)
	out.Over = out.Limit >= 0 && out.Count > out.Limit
	return out
}

// attendance: the lookups of the current registry revision (mu held).
func (s *Server) attendance() *attIndex {
	r := s.st.registry
	if r == nil {
		return nil
	}
	if s.att == nil || s.att.rev != r.Rev {
		s.att = buildAttendance(r.Rev, r.Data)
	}
	return s.att
}

// examAbsences: the absences of an exam's student (by Α.Μ.) in the exam's subject and year;
// ok = false when the exam has no subject/year or the student is not in the registry (mu held).
func (s *Server) examAbsences(e *Exam, am string) (absStatus, bool) {
	if e.SubjectID == nil || *e.SubjectID == "" || e.YearID == nil || *e.YearID == "" {
		return absStatus{}, false
	}
	x := s.attendance()
	if x == nil {
		return absStatus{}, false
	}
	sid := x.byAM[am]
	if sid == "" {
		for _, a := range e.Assignments {
			if a.AM == am && a.StudentID != nil && x.students[*a.StudentID] != nil {
				sid = *a.StudentID
			}
		}
	}
	if sid == "" {
		return absStatus{}, false
	}
	return x.status(sid, *e.SubjectID, *e.YearID), true
}

// examBarred: over the absence limit of the exam's subject and not allowed by the admin (mu held).
func (s *Server) examBarred(e *Exam, am string) (absStatus, bool) {
	st, ok := s.examAbsences(e, am)
	if !ok || !st.Over {
		return st, false
	}
	if _, allowed := e.AbsenceAllowed[am]; allowed {
		return st, false
	}
	return st, true
}

func errBarred(st absStatus) error {
	return &apiError{status: 403,
		msg:   fmt.Sprintf("Δεν έχετε δικαίωμα συμμετοχής στην εξέταση λόγω απουσιών (%d απουσίες, όριο %d). Απευθυνθείτε στη γραμματεία.", st.Count, st.Limit),
		en:    fmt.Sprintf("You are not allowed to take this exam because of your absences (%d absences, limit %d). Please contact the Registrar’s office.", st.Count, st.Limit),
		extra: map[string]any{"state": "barred", "code": "absences", "absences": st.Count, "absenceLimit": st.Limit}}
}

func allowedMap(e *Exam) map[string]AbsenceAllow {
	if e.AbsenceAllowed == nil {
		return map[string]AbsenceAllow{}
	}
	return e.AbsenceAllowed
}

// ------------------------------------------------------------ the registry side (teacher view + teacher writes)
// studentCalKeys: the calendar key of every enrolled student of a year (first enrollment, as core.js).
func (d *regDoc) studentCalKeys(yearID string) map[string]string {
	spec := map[string]string{}
	for _, s := range d.students {
		if _, ok := spec[s.ID]; !ok {
			spec[s.ID] = s.Specialty
		}
	}
	out := map[string]string{}
	for _, e := range d.enrollments {
		sp, ok := spec[e.StudentID]
		if e.YearID != yearID || !ok {
			continue
		}
		if _, done := out[e.StudentID]; !done {
			out[e.StudentID] = calendarKey(e.LevelID, sp, e.Section, e.Period)
		}
	}
	return out
}

type absenceChange struct {
	StudentID string `json:"studentId"`
	Absent    bool   `json:"absent"`
}

// applyTeacherAbsences writes one day's absences of a teacher's subject: each student must be in his
// classes and have that subject on that day in his class calendar. → stats {added, removed, same}.
func (d *regDoc) applyTeacherAbsences(user *User, yearID, subjectID, date string, changes []absenceChange, now time.Time) (map[string]int, error) {
	var mine []TeachAssignment
	for _, a := range user.Assignments {
		if a.YearID == yearID && a.SubjectID == subjectID {
			mine = append(mine, a)
		}
	}
	sj := d.subject(subjectID)
	if len(mine) == 0 || sj == nil {
		return nil, &apiError{status: 403, msg: "Το μάθημα αυτό δεν σας έχει ανατεθεί."}
	}
	if !validDate(date) {
		return nil, bad("Μη έγκυρη ημερομηνία.")
	}
	if date > now.AddDate(0, 0, 1).Format("2006-01-02") {
		return nil, bad("Οι απουσίες καταχωρίζονται μόνο για ημέρες που έχουν περάσει ή για σήμερα.")
	}
	allowed := map[string]bool{}
	for _, a := range mine {
		for id := range d.members(a) {
			allowed[id] = true
		}
	}
	// the subject of each class that day (the first record counts, as core.js)
	dayOf := map[string]string{}
	for _, c := range d.calendar {
		if c.YearID != yearID || c.Date != date || c.SubjectID == "" {
			continue
		}
		if _, ok := dayOf[c.Cls]; !ok {
			dayOf[c.Cls] = c.SubjectID
		}
	}
	keys := d.studentCalKeys(yearID)
	for _, c := range changes {
		if !allowed[c.StudentID] {
			return nil, bad("Ο σπουδαστής δεν ανήκει στα τμήματά σας για αυτό το μάθημα.")
		}
		if k, ok := keys[c.StudentID]; !ok || dayOf[k] != subjectID {
			return nil, bad(fmt.Sprintf("Στις %s το τμήμα του σπουδαστή δεν έχει %s στο ημερολόγιο.", dateText(date), subjectLabel(sj, subjectID)))
		}
	}
	var list []map[string]any
	if raw, ok := d.top["absences"]; ok {
		json.Unmarshal(raw, &list)
	}
	same := func(a map[string]any, sid string) bool {
		return a["studentId"] == sid && a["yearId"] == yearID && a["date"] == date
	}
	stats := map[string]int{"added": 0, "removed": 0, "same": 0}
	at := isoNow()
	for _, c := range changes {
		var cur map[string]any
		for _, a := range list {
			if same(a, c.StudentID) {
				cur = a
				break
			}
		}
		switch {
		case c.Absent && cur == nil:
			list = append(list, map[string]any{"studentId": c.StudentID, "yearId": yearID, "date": date, "subjectId": subjectID, "by": user.Username, "at": at, "src": "teacher"})
			stats["added"]++
		case c.Absent:
			if s, _ := cur["subjectId"].(string); s != subjectID {
				cur["subjectId"], cur["at"] = subjectID, at
				stats["added"]++
			} else {
				stats["same"]++
			}
		case cur != nil:
			kept := list[:0]
			for _, a := range list {
				if !same(a, c.StudentID) {
					kept = append(kept, a)
				}
			}
			list = kept
			stats["removed"]++
		default:
			stats["same"]++
		}
	}
	if list == nil {
		list = []map[string]any{}
	}
	b, _ := json.Marshal(list)
	d.top["absences"] = b
	return stats, nil
}

// ------------------------------------------------------------ routes
func (s *Server) attendanceRoutes(mux *http.ServeMux) {
	st := s.st

	// a teacher records the absences of one day of his subject (only his classes, only days of his subject)
	s.route(mux, "POST /api/teacher/absences", "teacher", 1<<20, func(c *reqCtx) (any, error) {
		var body struct {
			YearID    string          `json:"yearId"`
			SubjectID string          `json:"subjectId"`
			Date      string          `json:"date"`
			Changes   []absenceChange `json:"changes"`
		}
		if err := json.Unmarshal(c.body, &body); err != nil {
			return nil, bad("Μη έγκυρο αίτημα.")
		}
		if st.registry == nil {
			return nil, bad("Το μητρώο είναι κενό.")
		}
		if len(body.Changes) == 0 {
			return nil, bad("Δεν υπάρχουν απουσίες για καταχώριση.")
		}
		d, err := parseRegistry(st.registry.Data)
		if err != nil {
			return nil, err
		}
		stats, err := d.applyTeacherAbsences(c.user, body.YearID, body.SubjectID, body.Date, body.Changes, time.Now())
		if err != nil {
			return nil, err
		}
		if stats["added"]+stats["removed"] == 0 {
			return map[string]any{"rev": st.registry.Rev, "stats": stats}, nil
		}
		st.dailyRegistryBackup(c.user.Username)
		r, err := st.commitRegistryData(d.bytes(), c.user.Username)
		if err != nil {
			return nil, err
		}
		st.addAudit(c.user.Username, "teacher-absences", fmt.Sprintf("%s/%s %s: %v", body.YearID, body.SubjectID, body.Date, stats))
		return map[string]any{"rev": r.Rev, "stats": stats}, nil
	})

	// the admin lets a student over the absence limit take one exam (or takes it back)
	s.route(mux, "POST /api/exams/{id}/absence-allow", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		b := c.obj()
		am := normAm(jsString(b["am"]))
		assigned := false
		for _, x := range e.Assignments {
			if x.AM == am {
				assigned = true
			}
		}
		if am == "" || !assigned {
			return nil, bad("Ο σπουδαστής δεν έχει ανατεθεί σε αυτή την εξέταση.")
		}
		action := "exam-absence-revoke"
		if truthy(b["allowed"]) {
			if e.AbsenceAllowed == nil {
				e.AbsenceAllowed = map[string]AbsenceAllow{}
			}
			e.AbsenceAllowed[am] = AbsenceAllow{By: c.user.Username, At: nowMs()}
			action = "exam-absence-allow"
		} else {
			delete(e.AbsenceAllowed, am)
		}
		if err := st.saveExam(e); err != nil {
			return nil, err
		}
		st.addAudit(c.user.Username, action, e.Title+" / "+am)
		return map[string]any{"absenceAllowed": allowedMap(e)}, nil
	})
}

// pruneAllowed keeps the admin's permissions only for students still assigned to the exam.
func pruneAllowed(e *Exam) {
	if len(e.AbsenceAllowed) == 0 {
		return
	}
	in := map[string]bool{}
	for _, a := range e.Assignments {
		in[a.AM] = true
	}
	for am := range e.AbsenceAllowed {
		if !in[am] {
			delete(e.AbsenceAllowed, am)
		}
	}
}
