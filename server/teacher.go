package main

// Teachers: each teacher is assigned subjects + classes (per academic year). He sees only those
// students and only those subjects' grades, and writes grades straight into the registry — the
// admin's screens pick the change up by themselves. An import by a teacher appears in the admin's
// import history (with his name) and can be undone there. Once the admin locks a subject's grading
// for a year, the teacher can no longer change it.
//
// The class rules mirror src/core.js (enrolledStudents / studentSection / subjectApplies).

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// TeachAssignment: subject + class of one academic year. Spec/Section/Period empty = all of them.
type TeachAssignment struct {
	YearID    string `json:"yearId"`
	SubjectID string `json:"subjectId"`
	Spec      string `json:"spec"`
	Section   string `json:"section"`
	Period    string `json:"period"`
	Label     string `json:"label"`
}

// ------------------------------------------------------------ registry document
type regStudent struct {
	ID        string `json:"id"`
	AM        string `json:"am"`
	Specialty string `json:"specialty"`
}
type regEnrollment struct {
	StudentID string  `json:"studentId"`
	YearID    string  `json:"yearId"`
	LevelID   string  `json:"levelId"`
	Section   *string `json:"section"`
	Period    *string `json:"period"`
}
type regSubject struct {
	ID        string  `json:"id"`
	LevelID   string  `json:"levelId"`
	Specialty string  `json:"specialty"`
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	Active    *bool   `json:"active"`
	Order     float64 `json:"order"`
}
type regYear struct {
	ID        string            `json:"id"`
	Label     string            `json:"label"`
	MgmtShift map[string]string `json:"mgmtShift"`
}

// regDoc keeps the registry as raw JSON (every field preserved) plus typed views of what we need.
type regDoc struct {
	top         map[string]json.RawMessage
	students    []regStudent
	enrollments []regEnrollment
	subjects    []regSubject
	years       []regYear
	grades      []map[string]any
	settings    map[string]any
}

func parseRegistry(data []byte) (*regDoc, error) {
	d := &regDoc{}
	if err := json.Unmarshal(data, &d.top); err != nil {
		return nil, err
	}
	dec := func(k string, v any) {
		if raw, ok := d.top[k]; ok {
			json.Unmarshal(raw, v)
		}
	}
	dec("students", &d.students)
	dec("enrollments", &d.enrollments)
	dec("subjects", &d.subjects)
	dec("years", &d.years)
	dec("grades", &d.grades)
	dec("settings", &d.settings)
	if d.settings == nil {
		d.settings = map[string]any{}
	}
	if d.grades == nil {
		d.grades = []map[string]any{}
	}
	return d, nil
}

func (d *regDoc) subject(id string) *regSubject {
	for i := range d.subjects {
		if d.subjects[i].ID == id {
			return &d.subjects[i]
		}
	}
	return nil
}

func (d *regDoc) year(id string) *regYear {
	for i := range d.years {
		if d.years[i].ID == id {
			return &d.years[i]
		}
	}
	return nil
}

func isShiftLevel(levelID string) bool {
	return levelID == "MF1" || levelID == "MF2" || levelID == "MF3"
}
func hasSpec(s string) bool { return s == "DECK" || s == "ENGINE" }

// members: the students of an assignment's class who take its subject.
func (d *regDoc) members(a TeachAssignment) map[string]bool {
	out := map[string]bool{}
	sj := d.subject(a.SubjectID)
	y := d.year(a.YearID)
	if sj == nil || y == nil {
		return out
	}
	spec := map[string]string{}
	for _, s := range d.students {
		spec[s.ID] = s.Specialty
	}
	for _, e := range d.enrollments {
		if e.YearID != a.YearID || e.LevelID != sj.LevelID {
			continue
		}
		sp, ok := spec[e.StudentID]
		if !ok {
			continue
		}
		unified := sj.LevelID == "SUP"
		// the subject is for his specialty (students without a specialty see every subject)
		if !unified && hasSpec(sp) && sj.Specialty != "COMMON" && sj.Specialty != sp {
			continue
		}
		if a.Spec != "" && !unified && sp != a.Spec {
			continue
		}
		if a.Section != "" {
			sec := ""
			if isShiftLevel(e.LevelID) {
				if hasSpec(sp) && y.MgmtShift != nil {
					sec = y.MgmtShift[e.LevelID+":"+sp]
				}
			} else if e.Section != nil {
				sec = *e.Section
			}
			if sec != a.Section {
				continue
			}
		}
		// an assignment for one intake (period) only covers the students enrolled in it
		if a.Period != "" && (e.Period == nil || *e.Period != a.Period) {
			continue
		}
		out[e.StudentID] = true
	}
	return out
}

func lockKey(yearID, subjectID string) string { return yearID + "|" + subjectID }

func (d *regDoc) locked(yearID, subjectID string) bool {
	locks, _ := d.settings["gradeLocks"].(map[string]any)
	if locks == nil {
		return false
	}
	return truthy(locks[lockKey(yearID, subjectID)])
}

// teacherView: only the teacher's subjects, students and their grades (plus what the app needs to show them).
func (d *regDoc) teacherView(assignments []TeachAssignment) map[string]any {
	students := map[string]bool{}
	subjects := map[string]bool{}
	years := map[string]bool{}
	for _, a := range assignments {
		for id := range d.members(a) {
			students[id] = true
		}
		subjects[a.SubjectID] = true
		years[a.YearID] = true
	}
	filterRaw := func(key string, keep func(map[string]any) bool) []map[string]any {
		out := []map[string]any{}
		var list []map[string]any
		if raw, ok := d.top[key]; ok {
			json.Unmarshal(raw, &list)
		}
		for _, x := range list {
			if keep(x) {
				out = append(out, x)
			}
		}
		return out
	}
	str := func(x map[string]any, k string) string { s, _ := x[k].(string); return s }
	view := map[string]any{
		"schema": json.RawMessage(orNull(d.top["schema"])),
		"years":  filterRaw("years", func(x map[string]any) bool { return true }),
		"students": filterRaw("students", func(x map[string]any) bool {
			if !students[str(x, "id")] {
				return false
			}
			// only what a teacher needs to recognise a student
			for k := range x {
				switch k {
				case "id", "am", "lastName", "firstName", "fatherName", "specialty":
				default:
					delete(x, k)
				}
			}
			return true
		}),
		"enrollments": filterRaw("enrollments", func(x map[string]any) bool { return students[str(x, "studentId")] }),
		"subjects":    filterRaw("subjects", func(x map[string]any) bool { return subjects[str(x, "id")] }),
		"grades": filterRaw("grades", func(x map[string]any) bool {
			return students[str(x, "studentId")] && subjects[str(x, "subjectId")]
		}),
		"imports": []any{},
	}
	settings := map[string]any{}
	for _, k := range []string{"sections", "levelNames", "currentYearId", "gradeLocks", "periods", "levelPeriods"} {
		if v, ok := d.settings[k]; ok {
			settings[k] = v
		}
	}
	view["settings"] = settings
	_ = years
	return view
}

func orNull(b json.RawMessage) []byte {
	if len(b) == 0 {
		return []byte("null")
	}
	return b
}

// ------------------------------------------------------------ writing grades
type gradeChange struct {
	StudentID string `json:"studentId"`
	Value     any    `json:"value"`
	Absent    bool   `json:"absent"`
	Att       string `json:"att"` // "J" = 0 due to justified absences, "U" = unjustified; only with value 0
	Clear     bool   `json:"clear"`
}

func jsID(prefix string) string {
	b := make([]byte, 4)
	rand.Read(b)
	return prefix + "_" + strconv.FormatInt(time.Now().UnixMilli(), 36) + hex.EncodeToString(b)
}

func isoNow() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// gradeAtt: the grade's absence code ("J", "U") or "".
func gradeAtt(g map[string]any) string {
	s, _ := g["att"].(string)
	return s
}

// hasReexam: the admin has entered a re-exam grade (teachers can no longer change the grade).
func hasReexam(g map[string]any) bool { return g != nil && g["re"] != nil }

func snapshot(g map[string]any) any {
	if g == nil {
		return nil
	}
	pct := g["percent"]
	var att any
	if a := gradeAtt(g); a != "" {
		att = a
	}
	return map[string]any{"value": g["value"], "absent": truthy(g["absent"]), "att": att, "percent": pct, "source": g["source"], "importId": g["importId"], "updatedAt": g["updatedAt"]}
}

func sameGradeValue(g map[string]any, value any, absent bool, att string) bool {
	if g == nil {
		return false
	}
	if truthy(g["absent"]) || absent {
		return truthy(g["absent"]) && absent
	}
	gv, ok1 := g["value"].(float64)
	v, ok2 := value.(float64)
	return ok1 && ok2 && gv == v && gradeAtt(g) == att
}

// validAtt normalises an absence code; ok=false for an unknown one.
func validAtt(s string) (string, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	return s, s == "" || s == "J" || s == "U"
}

// applyTeacherGrades validates and writes; returns the new registry data and stats.
func (d *regDoc) applyTeacherGrades(user *User, yearID, subjectID, source, fileName string, changes []gradeChange) (map[string]int, string, error) {
	var mine []TeachAssignment
	for _, a := range user.Assignments {
		if a.YearID == yearID && a.SubjectID == subjectID {
			mine = append(mine, a)
		}
	}
	if len(mine) == 0 || d.subject(subjectID) == nil {
		return nil, "", &apiError{status: 403, msg: "Το μάθημα αυτό δεν σας έχει ανατεθεί."}
	}
	if d.locked(yearID, subjectID) {
		return nil, "", conflict("Η βαθμολογία του μαθήματος έχει κλειδώσει από τη γραμματεία — δεν γίνονται αλλαγές.", map[string]any{"locked": true})
	}
	allowed := map[string]bool{}
	for _, a := range mine {
		for id := range d.members(a) {
			allowed[id] = true
		}
	}
	find := func(sid string) int {
		for i, g := range d.grades {
			if g["studentId"] == sid && g["subjectId"] == subjectID && g["yearId"] == yearID {
				return i
			}
		}
		return -1
	}
	for i := range changes {
		c := &changes[i]
		if !allowed[c.StudentID] {
			return nil, "", bad("Ο σπουδαστής δεν ανήκει στα τμήματά σας για αυτό το μάθημα.")
		}
		att, ok := validAtt(c.Att)
		if !ok {
			return nil, "", bad(fmt.Sprintf("Μη έγκυρος κωδικός απουσιών «%s». Δεκτές τιμές: J (0Δ) ή U (0Α).", c.Att))
		}
		c.Att = att
		// a re-exam grade exists: only the secretariat can change this grade (an import skips the student)
		if source != "import" {
			if j := find(c.StudentID); j >= 0 && hasReexam(d.grades[j]) {
				return nil, "", conflict("Ο σπουδαστής έχει ήδη βαθμό re-exam — αλλαγές μόνο από τη γραμματεία.", map[string]any{"reexam": true})
			}
		}
		if c.Clear {
			c.Att = ""
			continue
		}
		if c.Absent {
			if c.Att != "" {
				return nil, "", bad("Ο κωδικός 0Δ / 0Α δεν συνδυάζεται με ΑΠ (απών).")
			}
			continue
		}
		v, ok := c.Value.(float64)
		if !ok || v != float64(int(v)) || v < 0 || v > 5 {
			return nil, "", bad(fmt.Sprintf("Μη έγκυρος βαθμός «%v». Δεκτές τιμές: ακέραιοι 0–5 ή ΑΠ.", c.Value))
		}
		if c.Att != "" && v != 0 {
			return nil, "", bad("Οι κωδικοί 0Δ / 0Α (μηδέν λόγω απουσιών) επιτρέπονται μόνο με βαθμό 0.")
		}
	}
	stats := map[string]int{"added": 0, "updated": 0, "same": 0, "cleared": 0}
	now := isoNow()
	importID := ""
	var rec map[string]any
	var recChanges []any
	if source == "import" {
		importID = jsID("im")
		rec = map[string]any{"id": importID, "type": "grades", "date": now, "fileName": runeSlice(fileName, 200), "yearId": yearID, "subjectIds": []string{subjectID}, "undone": false, "by": user.Username, "byName": user.DisplayName, "byRole": "teacher"}
	}
	for _, c := range changes {
		i := find(c.StudentID)
		var cur map[string]any
		if i >= 0 {
			cur = d.grades[i]
		}
		if hasReexam(cur) {
			// only an import gets here (a manual change was refused above); "re" is never touched
			if !c.Clear {
				stats["reexam"]++
			}
			continue
		}
		if c.Clear {
			if i >= 0 && source != "import" {
				d.grades = append(d.grades[:i], d.grades[i+1:]...)
				stats["cleared"]++
			}
			continue
		}
		var value any = c.Value
		if c.Absent {
			value = nil
		}
		before := snapshot(cur)
		same := sameGradeValue(cur, value, c.Absent, c.Att)
		if same && source != "import" {
			stats["same"]++
			continue
		}
		if cur == nil {
			cur = map[string]any{"id": jsID("gr"), "studentId": c.StudentID, "subjectId": subjectID, "yearId": yearID, "createdAt": now}
			d.grades = append(d.grades, cur)
		}
		cur["value"] = value
		cur["absent"] = c.Absent
		if c.Att != "" {
			cur["att"] = c.Att
		} else {
			delete(cur, "att")
		}
		cur["percent"] = nil
		cur["updatedAt"] = now
		cur["by"] = user.Username
		if source == "import" {
			cur["source"] = "import"
			cur["importId"] = importID
			recChanges = append(recChanges, map[string]any{"studentId": c.StudentID, "subjectId": subjectID, "yearId": yearID, "before": before, "after": snapshot(cur)})
		} else {
			cur["source"] = "teacher"
			cur["importId"] = nil
		}
		switch {
		case same:
			stats["same"]++
		case before != nil:
			stats["updated"]++
		default:
			stats["added"]++
		}
	}
	gb, _ := json.Marshal(d.grades)
	d.top["grades"] = gb
	if rec != nil {
		if recChanges == nil {
			recChanges = []any{}
		}
		rec["changes"] = recChanges
		rec["stats"] = map[string]int{"added": stats["added"], "updated": stats["updated"], "same": stats["same"], "skipped": 0, "reexam": stats["reexam"]}
		var imports []json.RawMessage
		if raw, ok := d.top["imports"]; ok {
			json.Unmarshal(raw, &imports)
		}
		rb, _ := json.Marshal(rec)
		imports = append([]json.RawMessage{rb}, imports...)
		ib, _ := json.Marshal(imports)
		d.top["imports"] = ib
	}
	return stats, importID, nil
}

// assignHash: a short fingerprint of a teacher's assignments, so his portal notices a new assignment at once.
func assignHash(list []TeachAssignment) string {
	if len(list) == 0 {
		return "0"
	}
	b, _ := json.Marshal(list)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:6])
}

func (d *regDoc) bytes() []byte {
	b, _ := json.Marshal(d.top)
	return b
}

func sanitizeAssignments(list []TeachAssignment) []TeachAssignment {
	seen := map[string]bool{}
	out := []TeachAssignment{}
	for _, a := range list {
		a.YearID = strings.TrimSpace(a.YearID)
		a.SubjectID = strings.TrimSpace(a.SubjectID)
		if a.Spec != "DECK" && a.Spec != "ENGINE" {
			a.Spec = ""
		}
		a.Section = runeSlice(strings.TrimSpace(a.Section), 40)
		a.Period = runeSlice(strings.TrimSpace(a.Period), 20)
		a.Label = runeSlice(a.Label, 300)
		k := a.YearID + "|" + a.SubjectID + "|" + a.Spec + "|" + a.Section + "|" + a.Period
		if a.YearID == "" || a.SubjectID == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, a)
	}
	return out
}
