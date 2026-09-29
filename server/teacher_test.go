package main

import (
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
)

const periodRegistry = `{
 "settings": {"currentYearId": "y1"},
 "years": [{"id": "y1", "label": "2026-2027", "mgmtShift": {}}],
 "students": [
  {"id": "s1", "am": "100", "specialty": "DECK"},
  {"id": "s2", "am": "101", "specialty": "DECK"},
  {"id": "s3", "am": "102", "specialty": "ENGINE"},
  {"id": "s4", "am": "103", "specialty": ""}
 ],
 "enrollments": [
  {"studentId": "s1", "yearId": "y1", "levelId": "SUP", "section": "M1", "period": "OCT"},
  {"studentId": "s2", "yearId": "y1", "levelId": "SUP", "section": "M1", "period": "JAN"},
  {"studentId": "s3", "yearId": "y1", "levelId": "SUP", "section": "AF", "period": "JAN"},
  {"studentId": "s4", "yearId": "y1", "levelId": "SUP", "section": "M1", "period": null}
 ],
 "subjects": [{"id": "sup1", "levelId": "SUP", "specialty": "COMMON"}],
 "grades": [],
 "imports": []
}`

func mustParse(t *testing.T, data string) *regDoc {
	t.Helper()
	d, err := parseRegistry([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func memberIDs(m map[string]bool) []string {
	out := []string{}
	for id := range m {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func TestMembersWithPeriods(t *testing.T) {
	d := mustParse(t, periodRegistry)
	cases := []struct {
		a    TeachAssignment
		want []string
	}{
		{TeachAssignment{YearID: "y1", SubjectID: "sup1"}, []string{"s1", "s2", "s3", "s4"}},
		{TeachAssignment{YearID: "y1", SubjectID: "sup1", Period: "OCT"}, []string{"s1"}},
		{TeachAssignment{YearID: "y1", SubjectID: "sup1", Period: "JAN"}, []string{"s2", "s3"}},
		{TeachAssignment{YearID: "y1", SubjectID: "sup1", Period: "JAN", Section: "M1"}, []string{"s2"}},
		{TeachAssignment{YearID: "y1", SubjectID: "sup1", Period: "MAY"}, []string{}},
	}
	for _, c := range cases {
		if got := memberIDs(d.members(c.a)); !reflect.DeepEqual(got, c.want) {
			t.Errorf("members(%+v) = %v, want %v", c.a, got, c.want)
		}
	}
}

func TestSanitizeAssignmentsKeepsPeriod(t *testing.T) {
	out := sanitizeAssignments([]TeachAssignment{
		{YearID: "y1", SubjectID: "sup1", Period: " JAN "},
		{YearID: "y1", SubjectID: "sup1", Period: "OCT"},
		{YearID: "y1", SubjectID: "sup1", Period: "JAN"}, // duplicate
		{YearID: "y1", SubjectID: "sup1"},
		{YearID: "y1", SubjectID: "sup1", Period: strings.Repeat("P", 40)},
	})
	var got []string
	for _, a := range out {
		got = append(got, a.Period)
	}
	want := []string{"JAN", "OCT", "", strings.Repeat("P", 20)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("periods %q, want %q", got, want)
	}
	b, _ := json.Marshal(out[0])
	if !strings.Contains(string(b), `"period":"JAN"`) {
		t.Fatalf("json: %s", b)
	}
}

func teacherOf(subjectID string) *User {
	return &User{Username: "t", DisplayName: "T", Role: "teacher", Assignments: []TeachAssignment{{YearID: "y1", SubjectID: subjectID}}}
}

func apiStatus(err error) int {
	var ae *apiError
	if errors.As(err, &ae) {
		return ae.status
	}
	return 0
}

func gradeOf(d *regDoc, sid string) map[string]any {
	for _, g := range d.grades {
		if g["studentId"] == sid {
			return g
		}
	}
	return nil
}

func TestGradeAbsenceCodes(t *testing.T) {
	d := mustParse(t, periodRegistry)
	u := teacherOf("sup1")
	apply := func(source string, ch ...gradeChange) (map[string]int, error) {
		st, _, err := d.applyTeacherGrades(u, "y1", "sup1", source, "x.xlsx", ch)
		return st, err
	}
	// refused: code with a grade other than 0, with ΑΠ, unknown code
	for _, c := range []gradeChange{
		{StudentID: "s1", Value: 3.0, Att: "J"},
		{StudentID: "s1", Absent: true, Att: "U"},
		{StudentID: "s1", Value: 0.0, Att: "X"},
	} {
		if _, err := apply("manual", c); apiStatus(err) != 400 {
			t.Fatalf("%+v: want 400, got %v", c, err)
		}
	}
	if _, err := apply("manual", gradeChange{StudentID: "s1", Value: 0.0, Att: "j"}); err != nil {
		t.Fatal(err)
	}
	if g := gradeOf(d, "s1"); g["att"] != "J" || g["value"] != 0.0 || g["absent"] != false {
		t.Fatalf("stored %v", g)
	}
	if st, _ := apply("manual", gradeChange{StudentID: "s1", Value: 0.0, Att: "J"}); st["same"] != 1 {
		t.Fatalf("same code: %v", st)
	}
	if st, _ := apply("manual", gradeChange{StudentID: "s1", Value: 0.0, Att: "U"}); st["updated"] != 1 {
		t.Fatalf("other code: %v", st)
	}
	if st, _ := apply("manual", gradeChange{StudentID: "s1", Value: 0.0}); st["updated"] != 1 {
		t.Fatalf("plain 0: %v", st)
	}
	if _, has := gradeOf(d, "s1")["att"]; has {
		t.Fatal("att must be removed for a plain 0")
	}
	// import snapshots carry the code
	if _, err := apply("import", gradeChange{StudentID: "s1", Value: 0.0, Att: "U"}); err != nil {
		t.Fatal(err)
	}
	var imports []map[string]any
	json.Unmarshal(d.top["imports"], &imports)
	ch := imports[0]["changes"].([]any)[0].(map[string]any)
	before, after := ch["before"].(map[string]any), ch["after"].(map[string]any)
	if v, ok := before["att"]; !ok || v != nil || after["att"] != "U" {
		t.Fatalf("snapshots: before %v after %v", before, after)
	}
}

func TestReexamIsNeverChangedByTeachers(t *testing.T) {
	withRe := strings.Replace(periodRegistry, `"grades": []`, `"grades": [{"id": "g1", "studentId": "s1", "subjectId": "sup1", "yearId": "y1", "value": 0, "absent": false, "att": "U", "re": {"value": 3, "absent": false, "att": null, "at": "2026-09-01T10:00:00.000Z", "by": "admin"}}]`, 1)
	u := teacherOf("sup1")

	for _, c := range []gradeChange{{StudentID: "s1", Value: 4.0}, {StudentID: "s1", Clear: true}} {
		d := mustParse(t, withRe)
		_, _, err := d.applyTeacherGrades(u, "y1", "sup1", "manual", "", []gradeChange{{StudentID: "s2", Value: 2.0}, c})
		var ae *apiError
		if !errors.As(err, &ae) || ae.status != 409 || ae.extra["reexam"] != true {
			t.Fatalf("%+v: want 409 reexam, got %v", c, err)
		}
	}

	d := mustParse(t, withRe)
	stats, _, err := d.applyTeacherGrades(u, "y1", "sup1", "import", "f.xlsx", []gradeChange{{StudentID: "s1", Value: 5.0}, {StudentID: "s2", Value: 2.0}})
	if err != nil {
		t.Fatal(err)
	}
	if stats["reexam"] != 1 || stats["added"] != 1 || stats["updated"] != 0 {
		t.Fatalf("stats %v", stats)
	}
	g := gradeOf(d, "s1")
	re, _ := g["re"].(map[string]any)
	if g["value"] != 0.0 || g["att"] != "U" || re == nil || re["value"] != 3.0 || re["by"] != "admin" {
		t.Fatalf("grade with re-exam changed: %v", g)
	}
	var imports []map[string]any
	json.Unmarshal(d.top["imports"], &imports)
	rs := imports[0]["stats"].(map[string]any)
	if rs["reexam"] != 1.0 || len(imports[0]["changes"].([]any)) != 1 {
		t.Fatalf("import record %v", imports[0])
	}
	// a normal change of another student keeps the re-exam grade as it is
	d2 := mustParse(t, withRe)
	if _, _, err := d2.applyTeacherGrades(u, "y1", "sup1", "manual", "", []gradeChange{{StudentID: "s2", Value: 1.0}}); err != nil {
		t.Fatal(err)
	}
	if gradeOf(d2, "s1")["re"] == nil {
		t.Fatal("re lost")
	}
}

func TestTeacherViewPassesPeriods(t *testing.T) {
	data := strings.Replace(periodRegistry, `"settings": {"currentYearId": "y1"}`, `"settings": {"currentYearId": "y1", "periods": [{"id": "OCT"}], "levelPeriods": {"SUP": ["OCT"]}, "secret": 1}`, 1)
	d := mustParse(t, data)
	v := d.teacherView([]TeachAssignment{{YearID: "y1", SubjectID: "sup1", Period: "JAN"}})
	set := v["settings"].(map[string]any)
	if set["periods"] == nil || set["levelPeriods"] == nil || set["secret"] != nil {
		t.Fatalf("settings %v", set)
	}
	ens := v["enrollments"].([]map[string]any)
	if len(ens) != 2 || ens[0]["period"] != "JAN" {
		t.Fatalf("enrollments %v", ens)
	}
}
