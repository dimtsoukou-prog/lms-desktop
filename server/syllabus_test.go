package main

import (
	"archive/zip"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

// encodeURIComponent as the client does it
func encURI(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }

func TestCleanFileName(t *testing.T) {
	long := strings.Repeat("α", 300) + ".pdf"
	cases := [][2]string{
		{encURI("Ύλη Ναυσιπλοΐας 2026.pdf"), "Ύλη Ναυσιπλοΐας 2026.pdf"},
		{encURI(`C:\fakepath\Notes.PDF`), "Notes.pdf"},
		{encURI("../../etc/passwd"), "passwd.pdf"},
		{"..%2F..%2Fsecret.pdf", "secret.pdf"},
		{encURI("report.docx"), "report.docx.pdf"},
		{"100%.pdf", "100%.pdf"}, // not encoded: kept as is
		{encURI("a\x00b\nc\u200b.pdf"), "abc.pdf"},
		{encURI(`what<is>:"this"?.pdf`), "what_is___this__.pdf"},
		{"", "syllabus.pdf"},
		{encURI(" .pdf"), "syllabus.pdf"},
		{encURI("  spaced name .  .pdf"), "spaced name.pdf"},
	}
	for _, c := range cases {
		if got := cleanFileName(c[0]); got != c[1] {
			t.Errorf("cleanFileName(%q) = %q, want %q", c[0], got, c[1])
		}
	}
	got := cleanFileName(encURI(long))
	if utf8.RuneCountInString(got) != 150 || !strings.HasSuffix(got, ".pdf") {
		t.Errorf("long name: %d runes %q", utf8.RuneCountInString(got), got)
	}
}

func TestContentDisposition(t *testing.T) {
	name := `Ύλη "NAV" 1;2.pdf`
	cd := contentDisposition("inline", name)
	const marker = `filename*=UTF-8''`
	i := strings.Index(cd, marker)
	if !strings.HasPrefix(cd, `inline; filename="`) || i < 0 {
		t.Fatal(cd)
	}
	enc := cd[i+len(marker):]
	if strings.ContainsAny(enc, ` ";'`) {
		t.Fatalf("not RFC 5987 encoded: %s", enc)
	}
	if dec, err := url.PathUnescape(enc); err != nil || dec != name {
		t.Fatalf("round trip %q %v", dec, err)
	}
	for _, r := range cd[:i] {
		if r > 0x7e {
			t.Fatalf("fallback not ASCII: %s", cd)
		}
	}
}

func TestReceivePDF(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := receivePDF(dir, strings.NewReader("PK\x03\x04 not a pdf")); apiStatus(err) != 400 {
		t.Fatalf("zip: %v", err)
	}
	if _, _, err := receivePDF(dir, strings.NewReader("")); apiStatus(err) != 400 {
		t.Fatalf("empty: %v", err)
	}
	big := http.MaxBytesReader(httptest.NewRecorder(), ioNopCloser(strings.NewReader("%PDF-"+strings.Repeat("x", 100))), 50)
	if _, _, err := receivePDF(dir, big); apiStatus(err) != 413 {
		t.Fatalf("too large: %v", err)
	}
	pdf := "%PDF-1.4\n" + strings.Repeat("0123456789", 1000)
	tmp, size, err := receivePDF(dir, strings.NewReader(pdf))
	if err != nil || size != int64(len(pdf)) {
		t.Fatal(size, err)
	}
	if b, _ := os.ReadFile(tmp); string(b) != pdf {
		t.Fatal("content differs")
	}
	// only the finished upload is left in the folder
	if left, _ := os.ReadDir(dir); len(left) != 1 {
		t.Fatalf("files left: %v", left)
	}
}

type nopCloser struct{ *strings.Reader }

func (nopCloser) Close() error { return nil }

func ioNopCloser(r *strings.Reader) nopCloser { return nopCloser{r} }

func TestYearStart(t *testing.T) {
	for label, want := range map[string]int{"2026-2027": 2026, "2026-27": 2026, " 2019 / 2020 ": 2019, "2026–2027": 2026, "2026-2028": 0, "x": 0, "": 0} {
		if got := yearStart(label); got != want {
			t.Errorf("yearStart(%q) = %d, want %d", label, got, want)
		}
	}
}

const syllabusRegistry = `{
 "settings": {"currentYearId": "y26", "levelNames": {"MF1:DECK": "Chief Mate Class"}},
 "years": [{"id": "y26", "label": "2026-2027"}, {"id": "y24", "label": "2024-2025"}, {"id": "y25", "label": "2025-2026"}],
 "students": [
  {"id": "a", "am": "26 001", "specialty": "DECK"},
  {"id": "b", "am": "26002", "specialty": "ENGINE"},
  {"id": "c", "am": "26003", "specialty": ""},
  {"id": "d", "am": "26004", "specialty": "DECK"},
  {"id": "e", "am": "26005", "specialty": "ENGINE"}
 ],
 "enrollments": [
  {"studentId": "a", "yearId": "y25", "levelId": "SUP"},
  {"studentId": "a", "yearId": "y26", "levelId": "OLA"},
  {"studentId": "b", "yearId": "y26", "levelId": "OLA"},
  {"studentId": "c", "yearId": "y26", "levelId": "OLA"},
  {"studentId": "d", "yearId": "y25", "levelId": "MF1"},
  {"studentId": "d", "yearId": "y24", "levelId": "OLB"},
  {"studentId": "e", "yearId": "y24", "levelId": "MF2"}
 ],
 "subjects": [
  {"id": "o3", "levelId": "OLA", "specialty": "COMMON", "code": "ENG", "name": "English", "order": 3},
  {"id": "o1", "levelId": "OLA", "specialty": "DECK", "code": "NAV", "name": "Navigation", "order": 1},
  {"id": "o2", "levelId": "OLA", "specialty": "ENGINE", "code": "ME", "name": "Marine Engines", "order": 2},
  {"id": "o4", "levelId": "OLA", "specialty": "COMMON", "code": "OLD", "name": "Retired", "order": 0, "active": false},
  {"id": "s1", "levelId": "SUP", "specialty": "COMMON", "code": "SUP1", "name": "Support 1", "order": 0}
 ],
 "grades": []
}`

func subjectIDs(list []regSubject) []string {
	out := []string{}
	for _, s := range list {
		out = append(out, s.ID)
	}
	return out
}

func TestStudentSyllabusClass(t *testing.T) {
	d := mustParse(t, syllabusRegistry)
	cases := []struct {
		am, level, name string
		subjects        []string
	}{
		{"26001", "OLA", "Operational Level A", []string{"o1", "o3"}},       // current year wins over the older SUP
		{"26002", "OLA", "Operational Level A", []string{"o2", "o3"}},       // engine
		{"26003", "OLA", "Operational Level A", []string{"o1", "o2", "o3"}}, // no specialty: all
		{"26004", "MF1", "Chief Mate Class", []string{}},                    // no current enrollment: latest (2025-2026)
		{"26005", "MF2", "Management Engine Function 2", []string{}},        // default Management name
	}
	for _, c := range cases {
		level, spec, ok := d.syllabusClass(normAm(c.am))
		if !ok || level != c.level {
			t.Errorf("%s: level %q ok=%v, want %q", c.am, level, ok, c.level)
			continue
		}
		if n := d.levelName(level, spec); n != c.name {
			t.Errorf("%s: name %q, want %q", c.am, n, c.name)
		}
		if got := subjectIDs(d.syllabusSubjects(level, spec)); !reflect.DeepEqual(got, c.subjects) {
			t.Errorf("%s: subjects %v, want %v", c.am, got, c.subjects)
		}
	}
	if _, _, ok := d.syllabusClass("99999"); ok {
		t.Error("unknown student")
	}
	if got := subjectIDs(d.syllabusSubjects("SUP", "DECK")); !reflect.DeepEqual(got, []string{"s1"}) {
		t.Errorf("SUP: %v", got)
	}
	for _, c := range [][3]string{{"SUP", "", "Support Level"}, {"OLB", "DECK", "Operational Level B"}, {"MF3", "", "Management Function 3"}, {"MF1", "ENGINE", "Management Engine Function 1"}} {
		if got := d.levelName(c[0], c[1]); got != c[2] {
			t.Errorf("levelName(%s,%s) = %q, want %q", c[0], c[1], got, c[2])
		}
	}
}

func TestRoleAllowed(t *testing.T) {
	if !roleAllowed("admin,teacher", "teacher") || roleAllowed("admin,teacher", "student") || !roleAllowed("any", "student") || roleAllowed("admin", "teacher") {
		t.Fatal("roleAllowed")
	}
}

func TestDailyZipSkipsSyllabus(t *testing.T) {
	dir := t.TempDir()
	st, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(st.path("registry.json"), []byte(`{"rev":1}`), 0o644)
	os.MkdirAll(st.path("syllabus"), 0o755)
	os.WriteFile(st.path("syllabus", "sy_1.pdf"), []byte("%PDF-1.4"), 0o644)
	st.syllabus = []SyllabusFile{{ID: "sy_1", SubjectID: "sb", Name: "a.pdf"}}
	if err := st.saveSyllabus(); err != nil {
		t.Fatal(err)
	}
	st.dailyBackup(t.Logf)
	zips, _ := filepath.Glob(filepath.Join(dir, "backups", "*.zip"))
	if len(zips) != 1 {
		t.Fatalf("zips %v", zips)
	}
	zr, err := zip.OpenReader(zips[0])
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if !reflect.DeepEqual(names, []string{"registry.json"}) {
		t.Fatalf("zip entries %v", names)
	}
	// the index survives a restart
	st2, err := openStore(dir)
	if err != nil || len(st2.syllabus) != 1 || st2.syllabus[0].Name != "a.pdf" {
		t.Fatalf("reload %v %v", st2, err)
	}
}
