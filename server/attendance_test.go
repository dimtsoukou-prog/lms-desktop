package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// The server must decide "over the absence limit" exactly like src/core.js (test/make-attendance-fixtures.js).
func TestAttendanceMatchesJavaScript(t *testing.T) {
	b, err := os.ReadFile("../test/attendance-fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Keys []struct {
			LevelID string  `json:"levelId"`
			Spec    string  `json:"spec"`
			Section *string `json:"section"`
			Period  *string `json:"period"`
			Key     string  `json:"key"`
		} `json:"keys"`
		Limits []struct {
			Value   any  `json:"value"`
			Missing bool `json:"missing"`
			Limit   int  `json:"limit"`
		} `json:"limits"`
		Hpds []struct {
			Value   any  `json:"value"`
			Missing bool `json:"missing"`
			Hpd     int  `json:"hpd"`
		} `json:"hpds"`
		Cases []struct {
			Registry json.RawMessage `json:"registry"`
			Checks   [][]any         `json:"checks"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	for _, k := range f.Keys {
		if got := calendarKey(k.LevelID, k.Spec, k.Section, k.Period); got != k.Key {
			t.Errorf("calendarKey(%s, %s, %v, %v) = %q, js %q", k.LevelID, k.Spec, k.Section, k.Period, got, k.Key)
		}
	}
	for _, l := range f.Limits {
		// decoded the way the registry is: {"absenceLimit": value} into regSubject
		raw := `{}`
		if !l.Missing {
			b, _ := json.Marshal(map[string]any{"absenceLimit": l.Value})
			raw = string(b)
		}
		var sj regSubject
		json.Unmarshal([]byte(raw), &sj)
		if got := subjectLimit(sj.AbsenceLimit); got != l.Limit {
			t.Errorf("subjectLimit(%v) = %d, js %d", l.Value, got, l.Limit)
		}
	}
	for _, h := range f.Hpds {
		settings := map[string]any{}
		if !h.Missing {
			settings["hoursPerDay"] = h.Value
		}
		if got := hoursPerDay(settings); got != h.Hpd {
			t.Errorf("hoursPerDay(%v) = %d, js %d", h.Value, got, h.Hpd)
		}
	}
	n := 0
	for ci, c := range f.Cases {
		x := buildAttendance(1, c.Registry)
		for _, ch := range c.Checks {
			sid, sub, yr := ch[0].(string), ch[1].(string), ch[2].(string)
			want := absStatus{Count: int(ch[3].(float64)), Days: int(ch[4].(float64)), Limit: int(ch[5].(float64)), Over: ch[6].(bool)}
			if got := x.status(sid, sub, yr); got != want {
				t.Errorf("case %d status(%s, %s, %s) = %+v, js %+v", ci, sid, sub, yr, got, want)
			}
			if want.Over {
				n++
			}
		}
	}
	if n < 8 {
		t.Errorf("the fixtures should hold students over the limit, got %d", n)
	}
}

const attendanceRegistry = `{
 "settings": {"currentYearId": "y1"},
 "years": [{"id": "y1", "label": "2026-2027", "mgmtShift": {}}],
 "students": [
  {"id": "s1", "am": "100", "specialty": "DECK"},
  {"id": "s2", "am": "101", "specialty": "ENGINE"},
  {"id": "s3", "am": "102", "specialty": "DECK"}
 ],
 "enrollments": [
  {"studentId": "s1", "yearId": "y1", "levelId": "SUP", "section": "M1", "period": "OCT"},
  {"studentId": "s2", "yearId": "y1", "levelId": "SUP", "section": "M1", "period": "OCT"},
  {"studentId": "s3", "yearId": "y1", "levelId": "SUP", "section": "M2", "period": "OCT"}
 ],
 "subjects": [{"id": "nav", "levelId": "SUP", "code": "NAV", "name": "Ναυσιπλοΐα", "specialty": "COMMON", "absenceLimit": 1},
              {"id": "eng", "levelId": "SUP", "code": "ENG", "name": "Αγγλικά", "specialty": "COMMON"}],
 "calendar": [
  {"yearId": "y1", "cls": "SUP||M1|OCT", "date": "2026-10-05", "subjectId": "nav"},
  {"yearId": "y1", "cls": "SUP||M1|OCT", "date": "2026-10-06", "subjectId": "eng"},
  {"yearId": "y1", "cls": "SUP||M2|OCT", "date": "2026-10-05", "subjectId": "nav"}
 ],
 "absences": [{"studentId": "s2", "yearId": "y1", "date": "2026-10-05", "hour": 1, "subjectId": "nav", "by": "admin", "at": "x", "src": "admin", "note": "kept"},
              {"studentId": "s2", "yearId": "y1", "date": "2026-10-05", "hour": 2, "subjectId": "nav", "by": "admin", "at": "x", "src": "admin"}],
 "grades": [],
 "imports": []
}`

func TestTeacherAbsences(t *testing.T) {
	now := time.Date(2026, 10, 20, 10, 0, 0, 0, time.Local)
	teacher := &User{Username: "papas", Role: "teacher", Assignments: []TeachAssignment{{YearID: "y1", SubjectID: "nav", Section: "M1"}}}
	apply := func(d *regDoc, subject, date string, ch ...absenceChange) (map[string]int, error) {
		return d.applyTeacherAbsences(teacher, "y1", subject, date, ch, now)
	}
	absences := func(d *regDoc) []map[string]any {
		var list []map[string]any
		json.Unmarshal(d.top["absences"], &list)
		return list
	}
	d := mustParse(t, attendanceRegistry)
	// s2 already has hours 1 and 2 (the secretariat); the teacher adds hour 3 for s1 and hour 1 for s2 (same)
	stats, err := apply(d, "nav", "2026-10-05", absenceChange{"s1", 3, true}, absenceChange{"s2", 1, true})
	if err != nil {
		t.Fatal(err)
	}
	if stats["added"] != 1 || stats["same"] != 1 {
		t.Errorf("stats %v", stats)
	}
	list := absences(d)
	if len(list) != 3 || list[2]["studentId"] != "s1" || list[2]["hour"] != float64(3) || list[2]["subjectId"] != "nav" || list[2]["by"] != "papas" || list[2]["src"] != "teacher" {
		t.Errorf("absences %v", list)
	}
	if list[0]["note"] != "kept" {
		t.Errorf("other fields of an absence must be kept: %v", list[0])
	}
	// present again → only that hour goes
	if stats, err = apply(d, "nav", "2026-10-05", absenceChange{"s2", 2, false}, absenceChange{"s1", 3, false}, absenceChange{"s1", 3, false}); err != nil || stats["removed"] != 2 || stats["same"] != 1 {
		t.Errorf("remove: %v %v", stats, err)
	}
	if l := absences(d); len(l) != 1 || l[0]["hour"] != float64(1) {
		t.Errorf("absences left: %v", l)
	}
	var ae *apiError
	fails := []struct {
		name, subject, date string
		ch                  absenceChange
		want                string
		status              int
	}{
		{"not his subject", "eng", "2026-10-06", absenceChange{"s1", 1, true}, "δεν σας έχει ανατεθεί", 403},
		{"not his class", "nav", "2026-10-05", absenceChange{"s3", 1, true}, "δεν ανήκει στα τμήματά σας", 400},
		{"not a day of his subject", "nav", "2026-10-06", absenceChange{"s1", 1, true}, "δεν έχει NAV Ναυσιπλοΐα", 400},
		{"no lesson that day", "nav", "2026-10-07", absenceChange{"s1", 1, true}, "07/10/2026", 400},
		{"future", "nav", "2026-10-22", absenceChange{"s1", 1, true}, "έχουν περάσει ή για σήμερα", 400},
		{"bad date", "nav", "2026-13-01", absenceChange{"s1", 1, true}, "Μη έγκυρη ημερομηνία", 400},
		{"hour 5 of 4", "nav", "2026-10-05", absenceChange{"s1", 5, true}, "Μη έγκυρη ώρα «5» (1–4)", 400},
		{"hour 0", "nav", "2026-10-05", absenceChange{"s1", 0, true}, "Μη έγκυρη ώρα", 400},
		{"hour 1.5", "nav", "2026-10-05", absenceChange{"s1", 1.5, true}, "Μη έγκυρη ώρα", 400},
	}
	for _, f := range fails {
		_, err := apply(d, f.subject, f.date, f.ch)
		if err == nil || !strings.Contains(err.Error(), f.want) || !errors.As(err, &ae) || ae.status != f.status {
			t.Errorf("%s: %v", f.name, err)
		}
	}
	// 5 hours a day in the settings → the 5th hour is accepted
	d = mustParse(t, strings.Replace(attendanceRegistry, `"settings": {"currentYearId": "y1"}`, `"settings": {"currentYearId": "y1", "hoursPerDay": 5}`, 1))
	if stats, err = apply(d, "nav", "2026-10-05", absenceChange{"s1", 5, true}); err != nil || stats["added"] != 1 {
		t.Errorf("5th hour: %v %v", stats, err)
	}
	// an absence recorded for another subject that day moves to the day's subject
	d = mustParse(t, strings.Replace(attendanceRegistry, `"hour": 1, "subjectId": "nav", "by"`, `"hour": 1, "subjectId": "eng", "by"`, 1))
	if stats, err = apply(d, "nav", "2026-10-05", absenceChange{"s2", 1, true}); err != nil || stats["added"] != 1 || absences(d)[0]["subjectId"] != "nav" {
		t.Errorf("retag: %v %v %v", stats, err, absences(d))
	}
}

func TestTeacherViewCalendar(t *testing.T) {
	d := mustParse(t, attendanceRegistry)
	v := d.teacherView([]TeachAssignment{{YearID: "y1", SubjectID: "nav", Section: "M1"}})
	b, _ := json.Marshal(v)
	var got struct {
		Calendar []regCalDay      `json:"calendar"`
		Absences []regAbsence     `json:"absences"`
		Settings map[string]any   `json:"settings"`
		Students []map[string]any `json:"students"`
	}
	json.Unmarshal(b, &got)
	// only his subject's days in his class (not Morning 2, not English)
	if len(got.Calendar) != 1 || got.Calendar[0].Cls != "SUP||M1|OCT" || got.Calendar[0].SubjectID != "nav" {
		t.Errorf("calendar %+v", got.Calendar)
	}
	if len(got.Absences) != 2 || got.Absences[0].StudentID != "s2" || got.Absences[1].Hour != 2 {
		t.Errorf("absences %+v", got.Absences)
	}
	if len(got.Students) != 2 {
		t.Errorf("students %v", got.Students)
	}
}

func TestExamAbsenceGate(t *testing.T) {
	st := &Store{registry: &Registry{Rev: 7, Data: []byte(attendanceRegistry)}}
	s := &Server{st: st}
	nav, y1 := "nav", "y1"
	e := &Exam{ExamMeta: ExamMeta{SubjectID: &nav, YearID: &y1}, Assignments: []Assignment{{AM: "100"}, {AM: "101"}}}
	// NAV has a limit of 1 hour; 101 was absent 2 hours (Morning 1 has 1 NAV day)
	if ab, barred := s.examBarred(e, "101"); !barred || ab.Count != 2 || ab.Days != 1 || ab.Limit != 1 {
		t.Errorf("101: %+v %v", ab, barred)
	}
	if _, barred := s.examBarred(e, "100"); barred {
		t.Error("100 has no absences")
	}
	e.AbsenceAllowed = map[string]AbsenceAllow{"101": {By: "admin"}}
	if ab, barred := s.examBarred(e, "101"); barred || !ab.Over {
		t.Errorf("allowed by the admin: %+v %v", ab, barred)
	}
	// no subject → no check; the index follows the registry revision
	e2 := &Exam{Assignments: e.Assignments}
	if _, ok := s.examAbsences(e2, "101"); ok {
		t.Error("an exam without a subject is never checked")
	}
	x := s.attendance()
	st.registry = &Registry{Rev: 8, Data: []byte(strings.Replace(attendanceRegistry, `"absences": [{`, `"settings2": {}, "absences": [{"studentId": "s1", "yearId": "y1", "date": "2026-10-05", "hour": 3, "subjectId": "nav"}, {"studentId": "s1", "yearId": "y1", "date": "2026-10-05", "hour": 4, "subjectId": "nav"}, {`, 1))}
	if s.attendance() == x {
		t.Error("a new revision rebuilds the index")
	}
	if _, barred := s.examBarred(&Exam{ExamMeta: e.ExamMeta, Assignments: e.Assignments}, "100"); !barred {
		t.Error("100 now has 2 hours of absence")
	}
	// no limit on the subject → never barred
	st.registry = &Registry{Rev: 9, Data: []byte(strings.Replace(attendanceRegistry, `"specialty": "COMMON", "absenceLimit": 1}`, `"specialty": "COMMON"}`, 1))}
	if ab, barred := s.examBarred(&Exam{ExamMeta: e.ExamMeta, Assignments: e.Assignments}, "101"); barred || ab.Limit != -1 || ab.Count != 2 {
		t.Errorf("no limit: %+v %v", ab, barred)
	}
	pruneAllowed(&Exam{})
	e.Assignments = e.Assignments[:1]
	pruneAllowed(e)
	if len(e.AbsenceAllowed) != 0 {
		t.Errorf("prune: %v", e.AbsenceAllowed)
	}
}
