package main

// Storage: plain JSON files in one data folder, written atomically (temp file + rename).
// Everything is also kept in memory; one mutex serialises all changes.
//
//   registry.json               the registry of the desktop app {rev, updatedAt, updatedBy, data}
//   registry-backups/           automatic / manual copies of the registry (+ index.json)
//   users.json, sessions.json   accounts and logins
//   exams/<id>.json             an exam with its questions and assigned students
//   attempts/<exam>/<am>.json   one student's attempt (answers, times, score)
//   audit.log                   who did what (JSON lines)
//   syllabus/                   syllabus PDFs per subject: index.json + <id>.pdf (not in the daily zip)
//   backups/                    one zip of the whole folder per day (30 days)

import (
	"archive/zip"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type User struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	Role        string `json:"role"` // admin | student
	AM          string `json:"am,omitempty"`
	DisplayName string `json:"displayName"`
	PassHash    string `json:"passHash"`
	PassSalt    string `json:"passSalt"`
	Active      bool   `json:"active"`
	MustChange  bool   `json:"mustChange"`
	CreatedAt   int64  `json:"createdAt"`
	LastLogin   int64  `json:"lastLogin,omitempty"`
	// teachers only: the subjects + classes they grade
	Assignments []TeachAssignment `json:"assignments,omitempty"`
}

type Session struct {
	UserID    int64  `json:"userId"`
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt"`
	LastSeen  int64  `json:"lastSeen"`
	IP        string `json:"ip"`
}

type Assignment struct {
	AM        string  `json:"am"`
	StudentID *string `json:"studentId"`
	Name      string  `json:"name"`
	ClassName string  `json:"className"`
}

type Exam struct {
	ID int64 `json:"id"`
	ExamMeta
	Status      string       `json:"status"` // draft | published
	CreatedAt   int64        `json:"createdAt"`
	UpdatedAt   int64        `json:"updatedAt"`
	CreatedBy   string       `json:"createdBy"`
	Questions   []Question   `json:"questions"`
	Assignments []Assignment `json:"assignments"`
}

type Attempt struct {
	ExamID        int64          `json:"examId"`
	AM            string         `json:"am"`
	UserID        int64          `json:"userId"`
	StartedAt     int64          `json:"startedAt"`
	Deadline      int64          `json:"deadline"`
	SubmittedAt   int64          `json:"submittedAt,omitempty"`
	AutoSubmitted bool           `json:"autoSubmitted"`
	Answers       map[string]any `json:"answers"`
	Order         *Order         `json:"order"`
	Score         float64        `json:"score"`
	Max           float64        `json:"max"`
	Percent       float64        `json:"percent"`
	Grade         int            `json:"grade"`
	Status        string         `json:"status"` // in_progress | submitted
	IP            string         `json:"ip"`
}

type BackupInfo struct {
	ID        int64  `json:"id"`
	Rev       int64  `json:"rev"`
	CreatedAt int64  `json:"createdAt"`
	Reason    string `json:"reason"`
	ByUser    string `json:"byUser"`
	Size      int    `json:"size"`
}

type Registry struct {
	Rev       int64           `json:"rev"`
	UpdatedAt int64           `json:"updatedAt"`
	UpdatedBy string          `json:"updatedBy"`
	Data      json.RawMessage `json:"data"`
}

type AuditEntry struct {
	At       int64  `json:"at"`
	Username string `json:"username"`
	Action   string `json:"action"`
	Detail   string `json:"detail"`
}

type Counters struct {
	NextUserID   int64 `json:"nextUserId"`
	NextExamID   int64 `json:"nextExamId"`
	NextBackupID int64 `json:"nextBackupId"`
}

type Store struct {
	mu        sync.Mutex
	dir       string
	registry  *Registry // nil until the first save
	regBytes  []byte    // registry.json as stored (served as-is)
	backups   []BackupInfo
	users     []*User
	sessions  map[string]*Session
	exams     map[int64]*Exam
	attempts  map[int64]map[string]*Attempt
	counters  Counters
	audit     []AuditEntry
	syllabus  []SyllabusFile
	sessDirty bool
}

func nowMs() int64 { return time.Now().UnixMilli() }

func (s *Store) path(p ...string) string { return filepath.Join(append([]string{s.dir}, p...)...) }

// writeAtomic writes a file so that a crash never leaves it half written.
func writeAtomic(file string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp := file + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return renameRetry(tmp, file)
}

// renameRetry: on Windows an antivirus scan can hold the file for a moment.
func renameRetry(from, to string) error {
	for i := 0; ; i++ {
		err := os.Rename(from, to)
		if err == nil || i >= 20 {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func writeJSON(file string, v any) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	return writeAtomic(file, b)
}

func readJSON(file string, v any) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func amFile(am string) string { return hex.EncodeToString([]byte(am)) + ".json" }

func openStore(dir string) (*Store, error) {
	s := &Store{dir: dir, sessions: map[string]*Session{}, exams: map[int64]*Exam{}, attempts: map[int64]map[string]*Attempt{}}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	// write test: fail early with a clear message
	if err := writeAtomic(s.path(".write-test"), []byte("ok")); err != nil {
		return nil, fmt.Errorf("ο φάκελος δεδομένων %s δεν είναι εγγράψιμος: %w", dir, err)
	}
	os.Remove(s.path(".write-test"))
	s.counters = Counters{NextUserID: 1, NextExamID: 1, NextBackupID: 1}
	if err := readJSON(s.path("counters.json"), &s.counters); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("counters.json: %w", err)
	}
	if b, err := os.ReadFile(s.path("registry.json")); err == nil {
		var r Registry
		if err := json.Unmarshal(b, &r); err != nil {
			return nil, fmt.Errorf("registry.json είναι κατεστραμμένο (%v) — επαναφέρετε το τελευταίο αρχείο από τον φάκελο backups", err)
		}
		s.registry = &r
		s.regBytes = b
	}
	_ = readJSON(s.path("registry-backups", "index.json"), &s.backups)
	if err := readJSON(s.path("users.json"), &s.users); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("users.json: %w", err)
	}
	_ = readJSON(s.path("sessions.json"), &s.sessions)
	if s.sessions == nil {
		s.sessions = map[string]*Session{}
	}
	files, _ := filepath.Glob(s.path("exams", "*.json"))
	for _, f := range files {
		var e Exam
		if err := readJSON(f, &e); err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		if e.Assignments == nil {
			e.Assignments = []Assignment{}
		}
		if e.Questions == nil {
			e.Questions = []Question{}
		}
		s.exams[e.ID] = &e
		if e.ID >= s.counters.NextExamID {
			s.counters.NextExamID = e.ID + 1
		}
	}
	dirs, _ := os.ReadDir(s.path("attempts"))
	for _, d := range dirs {
		id, err := strconv.ParseInt(d.Name(), 10, 64)
		if err != nil || !d.IsDir() {
			continue
		}
		afs, _ := filepath.Glob(s.path("attempts", d.Name(), "*.json"))
		for _, f := range afs {
			var a Attempt
			if err := readJSON(f, &a); err != nil {
				continue
			}
			if a.Answers == nil {
				a.Answers = map[string]any{}
			}
			if s.attempts[id] == nil {
				s.attempts[id] = map[string]*Attempt{}
			}
			s.attempts[id][a.AM] = &a
		}
	}
	for _, u := range s.users {
		if u.ID >= s.counters.NextUserID {
			s.counters.NextUserID = u.ID + 1
		}
	}
	for _, b := range s.backups {
		if b.ID >= s.counters.NextBackupID {
			s.counters.NextBackupID = b.ID + 1
		}
	}
	if err := readJSON(s.path("syllabus", "index.json"), &s.syllabus); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("syllabus/index.json: %w", err)
	}
	// uploads interrupted by a stop of the server
	tmps, _ := filepath.Glob(s.path("syllabus", "upload-*.tmp"))
	for _, f := range tmps {
		os.Remove(f)
	}
	s.loadAudit()
	return s, nil
}

// ------------------------------------------------------------ persistence helpers (call with mu held)
func (s *Store) saveCounters() error { return writeJSON(s.path("counters.json"), s.counters) }
func (s *Store) saveUsers() error    { return writeJSON(s.path("users.json"), s.users) }
func (s *Store) saveSessions() error {
	s.sessDirty = false
	return writeJSON(s.path("sessions.json"), s.sessions)
}
func (s *Store) saveExam(e *Exam) error {
	return writeJSON(s.path("exams", strconv.FormatInt(e.ID, 10)+".json"), e)
}
func (s *Store) saveAttempt(a *Attempt) error {
	return writeJSON(s.path("attempts", strconv.FormatInt(a.ExamID, 10), amFile(a.AM)), a)
}
func (s *Store) deleteAttempt(examID int64, am string) {
	os.Remove(s.path("attempts", strconv.FormatInt(examID, 10), amFile(am)))
	if m := s.attempts[examID]; m != nil {
		delete(m, am)
	}
}
func (s *Store) saveSyllabus() error {
	list := s.syllabus
	if list == nil {
		list = []SyllabusFile{}
	}
	return writeJSON(s.path("syllabus", "index.json"), list)
}
func (s *Store) deleteExam(id int64) {
	delete(s.exams, id)
	delete(s.attempts, id)
	os.Remove(s.path("exams", strconv.FormatInt(id, 10)+".json"))
	os.RemoveAll(s.path("attempts", strconv.FormatInt(id, 10)))
}

func (s *Store) userByID(id int64) *User {
	for _, u := range s.users {
		if u.ID == id {
			return u
		}
	}
	return nil
}
func (s *Store) userByName(name string) *User {
	for _, u := range s.users {
		if strings.EqualFold(u.Username, name) {
			return u
		}
	}
	return nil
}
func (s *Store) studentByAM(am string) *User {
	for _, u := range s.users {
		if u.Role == "student" && u.AM == am {
			return u
		}
	}
	return nil
}
func (s *Store) adminCount(activeOnly bool) int {
	n := 0
	for _, u := range s.users {
		if u.Role == "admin" && (!activeOnly || u.Active) {
			n++
		}
	}
	return n
}
func (s *Store) dropSessionsOf(userID int64) {
	for k, v := range s.sessions {
		if v.UserID == userID {
			delete(s.sessions, k)
		}
	}
	s.saveSessions()
}

// ------------------------------------------------------------ registry
func (s *Store) setRegistry(r *Registry) error {
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if err := writeAtomic(s.path("registry.json"), b); err != nil {
		return err
	}
	s.registry = r
	s.regBytes = b
	return nil
}

func (s *Store) backupRegistry(reason, by string) (int64, error) {
	if s.registry == nil {
		return 0, nil
	}
	id := s.counters.NextBackupID
	s.counters.NextBackupID++
	if err := writeAtomic(s.path("registry-backups", strconv.FormatInt(id, 10)+".json"), s.registry.Data); err != nil {
		return 0, err
	}
	s.backups = append(s.backups, BackupInfo{ID: id, Rev: s.registry.Rev, CreatedAt: nowMs(), Reason: reason, ByUser: by, Size: len(s.registry.Data)})
	// keep the newest 150
	for len(s.backups) > 150 {
		os.Remove(s.path("registry-backups", strconv.FormatInt(s.backups[0].ID, 10)+".json"))
		s.backups = s.backups[1:]
	}
	s.saveCounters()
	return id, writeJSON(s.path("registry-backups", "index.json"), s.backups)
}

// dailyRegistryBackup: the first save of each day keeps a copy of the previous state.
func (s *Store) dailyRegistryBackup(by string) {
	if s.registry == nil {
		return
	}
	today := time.Now().Format("2006-01-02")
	for i := len(s.backups) - 1; i >= 0; i-- {
		if s.backups[i].Reason == "auto" {
			if time.UnixMilli(s.backups[i].CreatedAt).Format("2006-01-02") == today {
				return
			}
			break
		}
	}
	s.backupRegistry("auto", by)
}

// commitRegistryData stores new registry data as the next revision.
func (s *Store) commitRegistryData(data []byte, by string) (*Registry, error) {
	var rev int64
	if s.registry != nil {
		rev = s.registry.Rev
	}
	r := &Registry{Rev: rev + 1, UpdatedAt: nowMs(), UpdatedBy: by, Data: data}
	if err := s.setRegistry(r); err != nil {
		return nil, err
	}
	return r, nil
}

// ------------------------------------------------------------ audit
func (s *Store) loadAudit() {
	b, err := os.ReadFile(s.path("audit.log"))
	if err != nil {
		return
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) > 300 {
		lines = lines[len(lines)-300:]
	}
	for _, l := range lines {
		var a AuditEntry
		if json.Unmarshal([]byte(l), &a) == nil {
			s.audit = append(s.audit, a)
		}
	}
}

func (s *Store) addAudit(user, action, detail string) {
	a := AuditEntry{At: nowMs(), Username: user, Action: action, Detail: runeSlice(detail, 1000)}
	s.audit = append(s.audit, a)
	if len(s.audit) > 300 {
		s.audit = s.audit[len(s.audit)-300:]
	}
	b, _ := json.Marshal(a)
	f, err := os.OpenFile(s.path("audit.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	f.Write(append(b, '\n'))
	f.Close()
	if st, err := os.Stat(s.path("audit.log")); err == nil && st.Size() > 5<<20 {
		os.Rename(s.path("audit.log"), s.path("audit.old.log"))
	}
}

// ------------------------------------------------------------ daily zip of the whole data folder
func (s *Store) dailyBackup(logf func(string, ...any)) {
	dir := s.path("backups")
	os.MkdirAll(dir, 0o755)
	name := "gmc-registry-" + time.Now().Format("2006-01-02") + ".zip"
	target := filepath.Join(dir, name)
	if _, err := os.Stat(target); err == nil {
		return
	}
	s.mu.Lock()
	err := s.zipTo(target + ".tmp")
	s.mu.Unlock()
	if err == nil {
		err = os.Rename(target+".tmp", target)
	}
	if err != nil {
		os.Remove(target + ".tmp")
		logf("[backup] αποτυχία: %v", err)
		return
	}
	logf("[backup] %s", target)
	files, _ := filepath.Glob(filepath.Join(dir, "gmc-registry-*.zip"))
	sort.Strings(files)
	for len(files) > 30 {
		os.Remove(files[0])
		files = files[1:]
	}
}

func (s *Store) zipTo(target string) error {
	f, err := os.Create(target)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	err = filepath.Walk(s.dir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(s.dir, p)
		rel = filepath.ToSlash(rel)
		if info.IsDir() {
			// syllabus PDFs can be large: they are kept by copying the data folder (see README)
			if rel == "backups" || rel == "syllabus" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(rel, ".tmp") || strings.HasSuffix(rel, ".log") || rel == "sessions.json" {
			return nil
		}
		w, err := zw.Create(rel)
		if err != nil {
			return err
		}
		in, err := os.Open(p)
		if err != nil {
			return nil
		}
		defer in.Close()
		_, err = io.Copy(w, in)
		return err
	})
	if cerr := zw.Close(); err == nil {
		err = cerr
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

func sortStrings(a []string) { sort.Strings(a) }
