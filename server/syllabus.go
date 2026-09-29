package main

// Syllabus (Ύλη): PDF files per subject, kept in <data>/syllabus (index.json + <id>.pdf).
// The admin and the teachers of a subject upload/delete them; a student downloads those of the
// subjects of his current class. Uploads (up to 50 MB) are streamed to a temporary file without
// holding the store mutex; only the index update runs under it.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxSyllabusBytes = 50 << 20

type SyllabusFile struct {
	ID         string `json:"id"`
	SubjectID  string `json:"subjectId"`
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	UploadedAt string `json:"uploadedAt"`
	By         string `json:"by"`
	ByName     string `json:"byName"`
	ByRole     string `json:"byRole"`
}

// ------------------------------------------------------------ file names
// cleanFileName turns the X-File-Name header (encodeURIComponent of the original name) into a
// safe display name: no path, no control characters, at most 150 characters, always ".pdf".
func cleanFileName(raw string) string {
	name := raw
	if u, err := url.PathUnescape(raw); err == nil {
		name = u
	} else if u, err := url.QueryUnescape(raw); err == nil {
		name = u
	}
	name = strings.ToValidUTF8(name, "")
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsControl(r), r == utf8.RuneError, r == 0x200b, r == 0xfeff:
			return -1
		case strings.ContainsRune(`<>:"|?*`, r):
			return '_'
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if strings.EqualFold(filepath.Ext(name), ".pdf") {
		name = name[:len(name)-4]
	}
	name = strings.Trim(runeSlice(strings.Trim(name, " ."), 146), " .")
	if name == "" {
		name = "syllabus"
	}
	return name + ".pdf"
}

func isAttrChar(b byte) bool {
	return 'a' <= b && b <= 'z' || 'A' <= b && b <= 'Z' || '0' <= b && b <= '9' || strings.IndexByte("!#$&+-.^_`|~", b) >= 0
}

// contentDisposition: an ASCII fallback plus the exact UTF-8 name (RFC 5987 / RFC 6266).
func contentDisposition(kind, name string) string {
	var ascii, enc strings.Builder
	for _, r := range name {
		if r < 0x20 || r >= 0x7f || r == '"' || r == '\\' || r == '%' {
			ascii.WriteByte('_')
		} else {
			ascii.WriteRune(r)
		}
	}
	for i := 0; i < len(name); i++ {
		if b := name[i]; isAttrChar(b) {
			enc.WriteByte(b)
		} else {
			fmt.Fprintf(&enc, "%%%02X", b)
		}
	}
	return kind + `; filename="` + ascii.String() + `"; filename*=UTF-8''` + enc.String()
}

// ------------------------------------------------------------ upload
func tooLarge(limit int64) error {
	mb := limit >> 20
	return errEn(413, fmt.Sprintf("Το αρχείο είναι πολύ μεγάλο (μέγιστο %d MB).", mb), fmt.Sprintf("The file is too large (maximum %d MB).", mb))
}

func uploadErr(err error) error {
	var mb *http.MaxBytesError
	if errors.As(err, &mb) {
		return tooLarge(mb.Limit)
	}
	return err
}

// receivePDF streams an upload into a temporary file of dir (call WITHOUT the store mutex).
func receivePDF(dir string, body io.Reader) (string, int64, error) {
	head := make([]byte, 5)
	n, err := io.ReadFull(body, head)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return "", 0, uploadErr(err)
	}
	if n == 0 {
		return "", 0, bad("Το αρχείο είναι κενό.")
	}
	if !bytes.Equal(head[:n], []byte("%PDF-")) {
		return "", 0, bad("Το αρχείο δεν είναι PDF.")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	f, err := os.CreateTemp(dir, "upload-*.tmp")
	if err != nil {
		return "", 0, err
	}
	var m int64
	_, err = f.Write(head)
	if err == nil {
		m, err = io.Copy(f, body)
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(f.Name())
		return "", 0, uploadErr(err)
	}
	return f.Name(), int64(n) + m, nil
}

// ------------------------------------------------------------ permissions (mu held)
// teacherHasSubject: "assigned teacher" = any assignment (any year) with that subject.
func teacherHasSubject(u *User, subjectID string) bool {
	for _, a := range u.Assignments {
		if a.SubjectID == subjectID {
			return true
		}
	}
	return false
}

func canManageSyllabus(u *User, subjectID string) error {
	if u.Role == "admin" || (u.Role == "teacher" && teacherHasSubject(u, subjectID)) {
		return nil
	}
	return &apiError{status: 403, msg: "Το μάθημα αυτό δεν σας έχει ανατεθεί."}
}

func (st *Store) syllabusFile(id string) (int, *SyllabusFile) {
	for i := range st.syllabus {
		if st.syllabus[i].ID == id && id != "" {
			return i, &st.syllabus[i]
		}
	}
	return -1, nil
}

func (st *Store) openSyllabus(f *SyllabusFile, notFoundErr error) (any, error) {
	fh, err := os.Open(st.path("syllabus", f.ID+".pdf"))
	if err != nil {
		return nil, notFoundErr
	}
	return &fileReply{f: fh, name: f.Name, ctype: "application/pdf"}, nil
}

// registrySubject: a subject of the stored registry (nil when missing).
func (st *Store) registrySubject(id string) (*regSubject, error) {
	if st.registry == nil || id == "" {
		return nil, nil
	}
	var doc struct {
		Subjects []regSubject `json:"subjects"`
	}
	if err := json.Unmarshal(st.registry.Data, &doc); err != nil {
		return nil, err
	}
	for i := range doc.Subjects {
		if doc.Subjects[i].ID == id {
			return &doc.Subjects[i], nil
		}
	}
	return nil, nil
}

func subjectLabel(sj *regSubject, id string) string {
	if sj == nil {
		return id
	}
	return strings.TrimSpace(sj.Code + " " + sj.Name)
}

// ------------------------------------------------------------ the student's subjects
var yearLabelRe = regexp.MustCompile(`^\s*(\d{4})\s*[-–/]\s*(\d{2,4})\s*$`)

// yearStart: 2026 for "2026-2027" (0 when the label is not a valid academic year), as core.js parseYearLabel.
func yearStart(label string) int {
	m := yearLabelRe.FindStringSubmatch(label)
	if m == nil {
		return 0
	}
	a, _ := strconv.Atoi(m[1])
	b, _ := strconv.Atoi(m[2])
	if len(m[2]) == 2 {
		b = a/100*100 + b
	}
	if b != a+1 {
		return 0
	}
	return a
}

// syllabusClass: level and specialty of a student (by Α.Μ.) — his enrollment in the current
// academic year, else his latest one (greatest start year).
func (d *regDoc) syllabusClass(am string) (levelID, spec string, ok bool) {
	if am == "" {
		return "", "", false
	}
	var stu *regStudent
	for i := range d.students {
		if normAm(d.students[i].AM) == am {
			stu = &d.students[i]
			break
		}
	}
	if stu == nil {
		return "", "", false
	}
	cur, _ := d.settings["currentYearId"].(string)
	var best *regEnrollment
	bestStart := -1
	for i := range d.enrollments {
		e := &d.enrollments[i]
		if e.StudentID != stu.ID {
			continue
		}
		if cur != "" && e.YearID == cur {
			best = e
			break
		}
		start := 0
		if y := d.year(e.YearID); y != nil {
			start = yearStart(y.Label)
		}
		if start >= bestStart {
			best, bestStart = e, start
		}
	}
	if best == nil {
		return "", "", false
	}
	return best.LevelID, stu.Specialty, true
}

// syllabusSubjects: active subjects of the level that apply to the specialty, in subject order.
func (d *regDoc) syllabusSubjects(levelID, spec string) []regSubject {
	out := []regSubject{}
	for _, sj := range d.subjects {
		if sj.LevelID != levelID || (sj.Active != nil && !*sj.Active) {
			continue
		}
		sp := sj.Specialty
		if levelID == "SUP" || sp == "" || sp == "COMMON" || !hasSpec(spec) || sp == spec {
			out = append(out, sj)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

func defaultLevelName(levelID, spec string) string {
	switch levelID {
	case "SUP":
		return "Support Level"
	case "OLA":
		return "Operational Level A"
	case "OLB":
		return "Operational Level B"
	case "MF1", "MF2", "MF3":
		n := levelID[2:]
		switch spec {
		case "DECK":
			return "Management Deck Function " + n
		case "ENGINE":
			return "Management Engine Function " + n
		}
		return "Management Function " + n
	}
	return levelID
}

// levelName: settings.levelNames["SUP" | "OLA" | "MF1:DECK" …] or the built-in name (as core.js levelName).
func (d *regDoc) levelName(levelID, spec string) string {
	key := levelID
	if isShiftLevel(levelID) && hasSpec(spec) {
		key += ":" + spec
	}
	if names, ok := d.settings["levelNames"].(map[string]any); ok {
		if n, _ := names[key].(string); strings.TrimSpace(n) != "" {
			return n
		}
	}
	return defaultLevelName(levelID, spec)
}

// mySyllabus: the student's level ({id, name} or nil) and subjects (mu held).
func (s *Server) mySyllabus(u *User) (any, []regSubject, error) {
	if s.st.registry == nil {
		return nil, []regSubject{}, nil
	}
	d, err := parseRegistry(s.st.registry.Data)
	if err != nil {
		return nil, nil, err
	}
	levelID, spec, ok := d.syllabusClass(normAm(u.AM))
	if !ok {
		return nil, []regSubject{}, nil
	}
	return map[string]any{"id": levelID, "name": d.levelName(levelID, spec)}, d.syllabusSubjects(levelID, spec), nil
}

// ------------------------------------------------------------ routes
func (s *Server) syllabusRoutes(mux *http.ServeMux) {
	st := s.st

	s.route(mux, "GET /api/syllabus", "admin,teacher", 0, func(c *reqCtx) (any, error) {
		sid := strings.TrimSpace(c.r.URL.Query().Get("subjectId"))
		files := []SyllabusFile{}
		for _, f := range st.syllabus {
			if (sid != "" && f.SubjectID != sid) || canManageSyllabus(c.user, f.SubjectID) != nil {
				continue
			}
			files = append(files, f)
		}
		return map[string]any{"files": files}, nil
	})

	s.handle(mux, "POST /api/syllabus/{subjectId}", routeOpts{role: "admin,teacher", limit: maxSyllabusBytes, raw: true}, func(c *reqCtx) (any, error) {
		sid := strings.TrimSpace(c.param("subjectId"))
		check := func() (*regSubject, error) {
			u := st.userByID(c.user.ID)
			if u == nil || !u.Active {
				return nil, &apiError{status: 403, msg: "Δεν έχετε δικαίωμα πρόσβασης."}
			}
			if err := canManageSyllabus(u, sid); err != nil {
				return nil, err
			}
			sj, err := st.registrySubject(sid)
			if err != nil {
				return nil, err
			}
			if sj == nil {
				return nil, notFound("Το μάθημα δεν βρέθηκε.")
			}
			return sj, nil
		}
		if _, err := check(); err != nil {
			return nil, err
		}
		name := cleanFileName(c.r.Header.Get("X-File-Name"))
		var tmp string
		var size int64
		var err error
		s.unlockDuring(func() { tmp, size, err = receivePDF(st.path("syllabus"), c.rawBody) })
		if err != nil {
			return nil, err
		}
		// the subject or the teacher's assignments may have changed while the file was arriving
		sj, err := check()
		if err != nil {
			os.Remove(tmp)
			return nil, err
		}
		id := jsID("sy")
		file := st.path("syllabus", id+".pdf")
		if err := renameRetry(tmp, file); err != nil {
			os.Remove(tmp)
			return nil, err
		}
		byName := c.user.DisplayName
		if byName == "" {
			byName = c.user.Username
		}
		entry := SyllabusFile{ID: id, SubjectID: sid, Name: name, Size: size, UploadedAt: isoNow(), By: c.user.Username, ByName: byName, ByRole: c.user.Role}
		st.syllabus = append(st.syllabus, entry)
		if err := st.saveSyllabus(); err != nil {
			st.syllabus = st.syllabus[:len(st.syllabus)-1]
			os.Remove(file)
			return nil, err
		}
		st.addAudit(c.user.Username, "syllabus-upload", subjectLabel(sj, sid)+": "+name)
		return map[string]any{"file": entry}, nil
	})

	s.route(mux, "GET /api/syllabus/files/{id}", "admin,teacher", 0, func(c *reqCtx) (any, error) {
		_, f := st.syllabusFile(c.param("id"))
		if f == nil {
			return nil, notFound("Το αρχείο δεν βρέθηκε.")
		}
		if err := canManageSyllabus(c.user, f.SubjectID); err != nil {
			return nil, err
		}
		return st.openSyllabus(f, notFound("Το αρχείο δεν βρέθηκε."))
	})

	s.route(mux, "DELETE /api/syllabus/files/{id}", "admin,teacher", 0, func(c *reqCtx) (any, error) {
		i, f := st.syllabusFile(c.param("id"))
		if f == nil {
			return nil, notFound("Το αρχείο δεν βρέθηκε.")
		}
		if err := canManageSyllabus(c.user, f.SubjectID); err != nil {
			return nil, err
		}
		entry := *f
		prev := st.syllabus
		st.syllabus = append(append([]SyllabusFile{}, prev[:i]...), prev[i+1:]...)
		if err := st.saveSyllabus(); err != nil {
			st.syllabus = prev
			return nil, err
		}
		if err := os.Remove(st.path("syllabus", entry.ID+".pdf")); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.logf("[syllabus] %s.pdf: %v", entry.ID, err)
		}
		sj, _ := st.registrySubject(entry.SubjectID)
		st.addAudit(c.user.Username, "syllabus-delete", subjectLabel(sj, entry.SubjectID)+": "+entry.Name)
		return map[string]any{"ok": true}, nil
	})

	// ---- the student's syllabus (English portal)
	s.route(mux, "GET /api/my/syllabus", "student", 0, func(c *reqCtx) (any, error) {
		level, subjects, err := s.mySyllabus(c.user)
		if err != nil {
			return nil, err
		}
		out := []map[string]any{}
		for _, sj := range subjects {
			files := []map[string]any{}
			for _, f := range st.syllabus {
				if f.SubjectID == sj.ID {
					files = append(files, map[string]any{"id": f.ID, "name": f.Name, "size": f.Size, "uploadedAt": f.UploadedAt})
				}
			}
			out = append(out, map[string]any{"id": sj.ID, "code": sj.Code, "name": sj.Name, "files": files})
		}
		return map[string]any{"level": level, "subjects": out}, nil
	})

	s.route(mux, "GET /api/my/syllabus/files/{id}", "student", 0, func(c *reqCtx) (any, error) {
		nf := notFoundEn("Το αρχείο δεν βρέθηκε.", "File not found.")
		_, f := st.syllabusFile(c.param("id"))
		if f == nil {
			return nil, nf
		}
		_, subjects, err := s.mySyllabus(c.user)
		if err != nil {
			return nil, err
		}
		for _, sj := range subjects {
			if sj.ID == f.SubjectID {
				return st.openSyllabus(f, nf)
			}
		}
		return nil, nf
	})
}
