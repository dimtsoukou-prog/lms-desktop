package main

import (
	"bytes"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Port         int
	DataDir      string
	Allow        string
	SessionHours float64
	GraceMs      int64
	TestMode     bool
}

type Server struct {
	cfg      Config
	st       *Store
	netOK    func(ip string) bool
	logf     func(string, ...any)
	failMu   sync.Mutex
	failures map[string]*failure
	att      *attIndex // calendar/absence lookups of the current registry revision (mu held)
}

type failure struct {
	n     int
	until int64
}

// apiError: an error sent to the client as JSON {error, ...extra}. en is the English text,
// used instead of msg when the request carries "X-Lang: en" (the student portal).
type apiError struct {
	status int
	msg    string
	en     string
	extra  map[string]any
}

func (e *apiError) Error() string { return e.msg }
func bad(msg string) error        { return &apiError{status: 400, msg: msg} }
func notFound(msg string) error {
	if msg == "" {
		msg = "Δεν βρέθηκε."
	}
	return &apiError{status: 404, msg: msg}
}
func conflict(msg string, extra map[string]any) error {
	return &apiError{status: 409, msg: msg, extra: extra}
}

// bilingual variants (Greek + English)
func errEn(status int, msg, en string) error { return &apiError{status: status, msg: msg, en: en} }
func badEn(msg, en string) error             { return errEn(400, msg, en) }
func notFoundEn(msg, en string) error        { return errEn(404, msg, en) }
func conflictEn(msg, en string, extra map[string]any) error {
	return &apiError{status: 409, msg: msg, en: en, extra: extra}
}

// wantsEnglish: the client asked for English messages (header X-Lang: en).
func wantsEnglish(r *http.Request) bool {
	l := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Lang")))
	return l == "en" || strings.HasPrefix(l, "en-")
}

// sendError writes {error, ...extra} in the language of the request.
func sendError(w http.ResponseWriter, r *http.Request, status int, msg, en string, extra map[string]any) {
	if en != "" && wantsEnglish(r) {
		msg = en
	}
	resp := map[string]any{"error": msg}
	for k, v := range extra {
		resp[k] = v
	}
	sendJSON(w, status, resp)
}

type rawJSON []byte

type reqCtx struct {
	w     http.ResponseWriter
	r     *http.Request
	user  *User
	ip    string
	body  []byte
	token string
	// raw routes only: the request body (size-limited), read by the handler itself
	rawBody io.Reader
}

// fileReply: a handler result streamed as a file (after the store mutex is released).
type fileReply struct {
	f     *os.File
	name  string
	ctype string
}

func (c *reqCtx) param(name string) string { return c.r.PathValue(name) }

func (c *reqCtx) obj() map[string]any {
	m := map[string]any{}
	if len(c.body) > 0 {
		_ = json.Unmarshal(c.body, &m)
	}
	return m
}

// ------------------------------------------------------------ passwords & tokens
const pbkdfIter = 100000

func hashPassword(pw string) (hash, salt string) {
	b := make([]byte, 16)
	rand.Read(b)
	salt = hex.EncodeToString(b)
	k, _ := pbkdf2.Key(sha256.New, pw, b, pbkdfIter, 32)
	return hex.EncodeToString(k), salt
}

func checkPassword(pw, hash, salt string) bool {
	sb, err1 := hex.DecodeString(salt)
	hb, err2 := hex.DecodeString(hash)
	if err1 != nil || err2 != nil {
		return false
	}
	k, _ := pbkdf2.Key(sha256.New, pw, sb, pbkdfIter, 32)
	return subtle.ConstantTimeCompare(k, hb) == 1
}

const passAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

func randomPassword(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	out := make([]byte, n)
	for i := range b {
		out[i] = passAlphabet[int(b[i])%len(passAlphabet)]
	}
	return string(out)
}

func newToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func sha(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func normAm(am string) string {
	return strings.ToUpper(strings.Join(strings.Fields(strings.TrimSpace(am)), ""))
}

func publicUser(u *User) map[string]any {
	var am any
	if u.AM != "" {
		am = u.AM
	}
	var last any
	if u.LastLogin > 0 {
		last = u.LastLogin
	}
	name := u.DisplayName
	if name == "" {
		name = u.Username
	}
	out := map[string]any{"id": u.ID, "username": u.Username, "role": u.Role, "am": am, "name": name, "active": u.Active, "mustChange": u.MustChange, "createdAt": u.CreatedAt, "lastLogin": last}
	if u.Role == "teacher" {
		as := u.Assignments
		if as == nil {
			as = []TeachAssignment{}
		}
		out["assignments"] = as
	}
	return out
}

var adminNameRe = regexp.MustCompile(`^[A-Za-z0-9._\-]{3,40}$`)
var digitsRe = regexp.MustCompile(`^\d+$`)

func validAdminName(username string) error {
	if !adminNameRe.MatchString(username) {
		return bad("Όνομα χρήστη: 3–40 λατινικοί χαρακτήρες, αριθμοί, . _ -")
	}
	if digitsRe.MatchString(username) {
		return bad("Το όνομα διαχειριστή δεν μπορεί να είναι μόνο αριθμοί (μοιάζει με Α.Μ.).")
	}
	return nil
}

// ------------------------------------------------------------ network restriction (academy LAN only)
func makeNetCheck(spec string) func(string) bool {
	s := strings.ToLower(strings.TrimSpace(spec))
	if s == "any" || s == "*" {
		return func(string) bool { return true }
	}
	_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
	var nets []*net.IPNet
	if s != "" && s != "private" {
		for _, c := range strings.Split(s, ",") {
			c = strings.TrimSpace(c)
			if !strings.Contains(c, "/") {
				if strings.Contains(c, ":") {
					c += "/128"
				} else {
					c += "/32"
				}
			}
			if _, n, err := net.ParseCIDR(c); err == nil {
				nets = append(nets, n)
			}
		}
	}
	return func(addr string) bool {
		ip := net.ParseIP(strings.TrimPrefix(addr, "::ffff:"))
		if ip == nil {
			return false
		}
		if ip.IsLoopback() {
			return true
		}
		if nets == nil {
			return ip.IsPrivate() || ip.IsLinkLocalUnicast() || cgnat.Contains(ip)
		}
		for _, n := range nets {
			if n.Contains(ip) {
				return true
			}
		}
		return false
	}
}

// ------------------------------------------------------------ http plumbing
func setCORS(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Lang, X-File-Name")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	h.Set("Access-Control-Expose-Headers", "Content-Disposition")
}

func sendJSON(w http.ResponseWriter, status int, v any) {
	var b []byte
	if r, ok := v.(rawJSON); ok {
		b = r
	} else {
		var err error
		b, err = json.Marshal(v)
		if err != nil {
			status = 500
			b = []byte(`{"error":"Σφάλμα διακομιστή."}`)
		}
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	setCORS(h)
	w.WriteHeader(status)
	w.Write(b)
}

func (s *Server) sessionMs(role string) int64 {
	h := s.cfg.SessionHours
	if role == "student" && h > 6 {
		h = 6
	}
	return int64(h * 3600000)
}

var bearerRe = regexp.MustCompile(`^Bearer\s+([A-Za-z0-9_\-]{20,})$`)

// authenticate: call with st.mu held.
func (s *Server) authenticate(r *http.Request) (*User, string) {
	m := bearerRe.FindStringSubmatch(r.Header.Get("Authorization"))
	if m == nil {
		return nil, ""
	}
	key := sha(m[1])
	sess := s.st.sessions[key]
	if sess == nil {
		return nil, ""
	}
	u := s.st.userByID(sess.UserID)
	t := nowMs()
	if u == nil || sess.ExpiresAt < t || !u.Active {
		delete(s.st.sessions, key)
		s.st.sessDirty = true
		return nil, ""
	}
	if t-sess.LastSeen > 60000 {
		sess.LastSeen = t
		sess.ExpiresAt = t + s.sessionMs(u.Role)
		s.st.sessDirty = true
	}
	return u, key
}

type handlerFunc func(c *reqCtx) (any, error)

// routeOpts: who may call a route and how its body is read.
type routeOpts struct {
	role  string // "" = public, "any" = any signed-in user, else one role or a comma-separated list
	limit int64  // body limit (default 1 MB)
	raw   bool   // the wrapper does not read the body: the handler streams c.rawBody
}

func roleAllowed(spec, role string) bool {
	if spec == "any" {
		return true
	}
	for _, r := range strings.Split(spec, ",") {
		if strings.TrimSpace(r) == role {
			return true
		}
	}
	return false
}

// route wraps a handler: network check, auth/role, body limit, JSON errors.
// Every handler runs with the store mutex held (except where it unlocks itself for slow work).
func (s *Server) route(mux *http.ServeMux, pattern, role string, limit int64, h handlerFunc) {
	s.handle(mux, pattern, routeOpts{role: role, limit: limit}, h)
}

func (s *Server) handle(mux *http.ServeMux, pattern string, o routeOpts, h handlerFunc) {
	role, limit := o.role, o.limit
	if limit <= 0 {
		limit = 1 << 20
	}
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !s.netOK(ip) {
			sendError(w, r, 403, "Πρόσβαση μόνο από το δίκτυο της ακαδημίας.", "Access is allowed only from the academy network.", nil)
			return
		}
		c := &reqCtx{w: w, r: r, ip: ip}
		// drain reads the rest of a refused upload, so that the client gets the answer rather than a reset connection
		drain := func() {
			if c.rawBody != nil {
				io.Copy(io.Discard, c.rawBody)
			}
		}
		if o.raw {
			if r.ContentLength > limit {
				ae := tooLarge(limit).(*apiError)
				sendError(w, r, ae.status, ae.msg, ae.en, nil)
				return
			}
			c.rawBody = http.MaxBytesReader(w, r.Body, limit)
		} else if r.Method != http.MethodGet && r.Method != http.MethodDelete {
			c.body, err = io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
			if err != nil {
				sendError(w, r, 413, "Πολύ μεγάλο αίτημα.", "The request is too large.", nil)
				return
			}
			if len(bytes.TrimSpace(c.body)) > 0 && !json.Valid(c.body) {
				sendError(w, r, 400, "Μη έγκυρο αίτημα (JSON).", "Invalid request (JSON).", nil)
				return
			}
		}
		s.st.mu.Lock()
		locked := true
		unlock := func() {
			if locked {
				s.st.mu.Unlock()
				locked = false
			}
		}
		defer unlock()
		if role != "" {
			u, key := s.authenticate(r)
			if u == nil {
				unlock()
				drain()
				sendError(w, r, 401, "Η σύνδεση έληξε — συνδεθείτε ξανά.", "Your session has expired — please sign in again.", map[string]any{"code": "auth"})
				return
			}
			if !roleAllowed(role, u.Role) {
				unlock()
				drain()
				sendError(w, r, 403, "Δεν έχετε δικαίωμα πρόσβασης.", "You do not have permission to access this.", nil)
				return
			}
			c.user = u
			c.token = key
		}
		defer func() {
			if p := recover(); p != nil {
				s.logf("[error] %s %s: %v", r.Method, r.URL.Path, p)
				sendError(w, r, 500, fmt.Sprint("Σφάλμα διακομιστή: ", p), fmt.Sprint("Server error: ", p), nil)
			}
		}()
		out, err := h(c)
		unlock()
		if err != nil {
			drain()
			var ae *apiError
			if errors.As(err, &ae) {
				sendError(w, r, ae.status, ae.msg, ae.en, ae.extra)
				return
			}
			s.logf("[error] %s %s: %v", r.Method, r.URL.Path, err)
			sendError(w, r, 500, "Σφάλμα διακομιστή: "+err.Error(), "Server error: "+err.Error(), nil)
			return
		}
		if fr, ok := out.(*fileReply); ok {
			serveFile(w, r, fr)
			return
		}
		if out == nil {
			out = map[string]any{"ok": true}
		}
		sendJSON(w, 200, out)
	})
}

// serveFile streams a file opened by a handler (Range requests supported) and closes it.
func serveFile(w http.ResponseWriter, r *http.Request, fr *fileReply) {
	defer fr.f.Close()
	h := w.Header()
	h.Set("Content-Type", fr.ctype)
	h.Set("Content-Disposition", contentDisposition("inline", fr.name))
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	setCORS(h)
	http.ServeContent(w, r, "", time.Time{}, fr.f)
}

// unlockDuring runs fn without holding the store mutex (slow password hashing).
func (s *Server) unlockDuring(fn func()) {
	s.st.mu.Unlock()
	defer s.st.mu.Lock()
	fn()
}

const landing = `<!doctype html><meta charset="utf-8"><title>GMC Registry Server</title><body style="font-family:Segoe UI,Arial;margin:40px;color:#12304f"><h2>GMC Maritime Academy — Student Registry Server</h2><p>Ο διακομιστής λειτουργεί (έκδοση %s).</p><p>Η πρόσβαση γίνεται μόνο από το πρόγραμμα <b>GMC-Student-Registry.exe</b> μέσα από το δίκτυο της ακαδημίας.</p></body>`

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	s.routes(mux)
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, landing, Version)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		sendError(w, r, 404, "Άγνωστη διαδρομή.", "Unknown route.", nil)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			h := w.Header()
			setCORS(h)
			h.Set("Access-Control-Allow-Private-Network", "true")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(204)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// ------------------------------------------------------------ exams helpers (mu held)
func (s *Server) exam(idStr string) (*Exam, error) {
	id, err := strconv.ParseInt(idStr, 10, 64)
	e := s.st.exams[id]
	if err != nil || e == nil {
		return nil, notFound("Η εξέταση δεν βρέθηκε.")
	}
	return e, nil
}

func examMetaJSON(e *Exam) map[string]any {
	return map[string]any{
		"id": e.ID, "title": e.Title, "description": e.Description, "subjectId": e.SubjectID, "subjectName": e.SubjectName,
		"levelId": e.LevelID, "yearId": e.YearID, "startsAt": e.StartsAt, "entryMinutes": e.EntryMinutes, "durationMinutes": e.DurationMinutes,
		"countsFinal": e.CountsFinal, "shuffleQuestions": e.ShuffleQuestions, "shuffleOptions": e.ShuffleOptions, "status": e.Status,
		"createdAt": e.CreatedAt, "updatedAt": e.UpdatedAt, "createdBy": e.CreatedBy,
	}
}

func (s *Server) attemptsOf(examID int64) map[string]*Attempt {
	m := s.st.attempts[examID]
	if m == nil {
		m = map[string]*Attempt{}
		s.st.attempts[examID] = m
	}
	return m
}

func (s *Server) finalize(a *Attempt, e *Exam, auto bool) {
	g := gradeAnswers(e.Questions, a.Answers)
	t := nowMs()
	if auto && a.Deadline < t {
		t = a.Deadline
	}
	a.Status = "submitted"
	a.SubmittedAt = t
	a.AutoSubmitted = auto
	a.Score, a.Max, a.Percent, a.Grade = g.Score, g.Max, g.Percent, g.Grade
	s.st.saveAttempt(a)
}

func (s *Server) sweepExpired() int {
	n := 0
	limit := nowMs() - s.cfg.GraceMs
	for id, m := range s.st.attempts {
		e := s.st.exams[id]
		if e == nil {
			continue
		}
		for _, a := range m {
			if a.Status == "in_progress" && a.Deadline < limit {
				s.finalize(a, e, true)
				n++
			}
		}
	}
	return n
}

func (s *Server) regrade(e *Exam) {
	for _, a := range s.attemptsOf(e.ID) {
		if a.Status != "submitted" {
			continue
		}
		g := gradeAnswers(e.Questions, a.Answers)
		a.Score, a.Max, a.Percent, a.Grade = g.Score, g.Max, g.Percent, g.Grade
		s.st.saveAttempt(a)
	}
}

func phaseOf(e *Exam, t int64) Phase {
	return examPhase(e.StartsAt, e.EntryMinutes, e.DurationMinutes, t)
}

func perQuestionFlags(g Grade) []any {
	out := make([]any, len(g.PerQuestion))
	for i, x := range g.PerQuestion {
		if x.Answered {
			if x.Correct {
				out[i] = 1
			} else {
				out[i] = 0
			}
		}
	}
	return out
}

func (s *Server) studentExamView(e *Exam, a *Attempt, t int64) map[string]any {
	ph := phaseOf(e, t)
	state := "missed"
	switch ph.Phase {
	case "upcoming":
		state = "upcoming"
	case "open":
		state = "open"
	}
	var startedAt, deadline, submittedAt any
	if a != nil {
		state = "submitted"
		if a.Status == "in_progress" && a.Deadline+s.cfg.GraceMs >= t {
			state = "in_progress"
		}
		startedAt, deadline = a.StartedAt, a.Deadline
		if a.Status == "submitted" {
			submittedAt = a.SubmittedAt
		}
	}
	subject := ""
	if e.SubjectName != nil {
		subject = *e.SubjectName
	}
	// never any score here: students do not see grades
	return map[string]any{
		"id": e.ID, "title": e.Title, "description": e.Description, "subjectName": subject, "startsAt": e.StartsAt,
		"entryMinutes": e.EntryMinutes, "durationMinutes": e.DurationMinutes, "entryClosesAt": ph.EntryCloses,
		"questionCount": len(e.Questions), "state": state, "startedAt": startedAt, "deadline": deadline, "submittedAt": submittedAt,
	}
}

func attemptPayload(e *Exam, a *Attempt) map[string]any {
	subject := ""
	if e.SubjectName != nil {
		subject = *e.SubjectName
	}
	return map[string]any{
		"exam":      map[string]any{"id": e.ID, "title": e.Title, "description": e.Description, "subjectName": subject, "durationMinutes": e.DurationMinutes},
		"questions": questionsForStudent(e.Questions, a.Order),
		"answers":   a.Answers,
		"startedAt": a.StartedAt,
		"deadline":  a.Deadline,
		"serverNow": nowMs(),
	}
}

func (s *Server) myExam(u *User, idStr string) (*Exam, error) {
	e, err := s.exam(idStr)
	if err != nil || e.Status != "published" {
		return nil, errMyExamNotFound()
	}
	am := normAm(u.AM)
	for _, x := range e.Assignments {
		if x.AM == am {
			return e, nil
		}
	}
	return nil, errMyExamNotFound()
}

// errors of the student's exam pages (Greek + English)
func errMyExamNotFound() error {
	return notFoundEn("Η εξέταση δεν βρέθηκε.", "Exam not found.")
}
func errNotStarted() error {
	return notFoundEn("Η εξέταση δεν έχει ξεκινήσει.", "You have not started this exam.")
}
func errSubmitted() error {
	return conflictEn("Η εξέταση έχει ήδη υποβληθεί.", "The exam has already been submitted.", map[string]any{"state": "submitted"})
}

func questionsFromBody(m map[string]any) ([]Question, error) {
	list, _ := m["questions"].([]any)
	qs := normalizeQuestions(list)
	if len(qs) > 500 {
		return nil, bad("Μέγιστο 500 ερωτήσεις.")
	}
	return qs, nil
}

func questionsJSON(qs []Question) string {
	b, _ := json.Marshal(qs)
	return string(b)
}

// ------------------------------------------------------------ routes
func (s *Server) routes(mux *http.ServeMux) {
	st := s.st

	s.route(mux, "GET /api/health", "", 0, func(c *reqCtx) (any, error) {
		return map[string]any{"ok": true, "name": "GMC Maritime Academy Student Registry Server", "version": Version, "serverNow": nowMs(), "needsSetup": st.adminCount(false) == 0}, nil
	})

	newSession := func(u *User, ip string) map[string]any {
		token := newToken()
		t := nowMs()
		st.sessions[sha(token)] = &Session{UserID: u.ID, CreatedAt: t, ExpiresAt: t + s.sessionMs(u.Role), LastSeen: t, IP: ip}
		for k, v := range st.sessions {
			if v.ExpiresAt < t {
				delete(st.sessions, k)
			}
		}
		u.LastLogin = t
		st.saveUsers()
		st.saveSessions()
		return map[string]any{"token": token, "user": publicUser(u), "serverNow": t}
	}

	// first start: the administrator account is created from the app (username + password)
	s.route(mux, "POST /api/setup", "", 0, func(c *reqCtx) (any, error) {
		b := c.obj()
		if st.adminCount(false) > 0 {
			return nil, conflict("Ο διακομιστής έχει ήδη διαχειριστή — συνδεθείτε.", nil)
		}
		username := strings.TrimSpace(jsString(b["username"]))
		pw := jsString(b["password"])
		if err := validAdminName(username); err != nil {
			return nil, err
		}
		if len([]rune(pw)) < 8 {
			return nil, bad("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.")
		}
		var hash, salt string
		s.unlockDuring(func() { hash, salt = hashPassword(pw) })
		if st.adminCount(false) > 0 || st.userByName(username) != nil {
			return nil, conflict("Ο διακομιστής έχει ήδη διαχειριστή — συνδεθείτε.", nil)
		}
		name := strings.TrimSpace(jsString(b["name"]))
		if name == "" {
			name = username
		}
		u := &User{ID: st.counters.NextUserID, Username: username, Role: "admin", DisplayName: runeSlice(name, 120), PassHash: hash, PassSalt: salt, Active: true, CreatedAt: nowMs()}
		st.counters.NextUserID++
		st.users = append(st.users, u)
		st.saveCounters()
		st.saveUsers()
		st.addAudit(username, "setup", c.ip)
		s.logf("[setup] Δημιουργήθηκε ο διαχειριστής «%s».", username)
		return newSession(u, c.ip), nil
	})

	s.route(mux, "POST /api/login", "", 0, func(c *reqCtx) (any, error) {
		b := c.obj()
		username := strings.TrimSpace(jsString(b["username"]))
		password := jsString(b["password"])
		if username == "" || password == "" {
			return nil, badEn("Συμπληρώστε όνομα χρήστη (ή Α.Μ.) και κωδικό.", "Enter your username (or student number) and password.")
		}
		key := c.ip + "|" + strings.ToLower(username)
		s.failMu.Lock()
		f := s.failures[key]
		s.failMu.Unlock()
		if f != nil && f.until > nowMs() {
			secs := (f.until - nowMs() + 999) / 1000
			return nil, errEn(429, fmt.Sprintf("Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε ξανά σε %d δευτερόλεπτα.", secs), fmt.Sprintf("Too many failed attempts. Please try again in %d seconds.", secs))
		}
		u := st.userByName(username)
		if u == nil {
			u = st.studentByAM(normAm(username))
		}
		ok := false
		if u != nil && u.Active {
			hash, salt := u.PassHash, u.PassSalt
			s.unlockDuring(func() { ok = checkPassword(password, hash, salt) })
		}
		if !ok {
			s.failMu.Lock()
			n := 1
			if f != nil {
				n = f.n + 1
			}
			var until int64
			if n >= 10 {
				until = nowMs() + 300000
			} else if n >= 5 {
				until = nowMs() + 60000
			}
			s.failures[key] = &failure{n: n, until: until}
			s.failMu.Unlock()
			st.addAudit(username, "login-failed", c.ip)
			if u != nil && !u.Active {
				return nil, errEn(401, "Ο λογαριασμός είναι απενεργοποιημένος. Απευθυνθείτε στη γραμματεία.", "Your account is disabled. Please contact the secretariat.")
			}
			return nil, errEn(401, "Λάθος όνομα χρήστη ή κωδικός.", "Wrong username or password.")
		}
		s.failMu.Lock()
		delete(s.failures, key)
		s.failMu.Unlock()
		st.addAudit(u.Username, "login", c.ip)
		return newSession(u, c.ip), nil
	})

	s.route(mux, "POST /api/logout", "any", 0, func(c *reqCtx) (any, error) {
		delete(st.sessions, c.token)
		st.saveSessions()
		return map[string]any{"ok": true}, nil
	})

	s.route(mux, "GET /api/me", "any", 0, func(c *reqCtx) (any, error) {
		return map[string]any{"user": publicUser(c.user), "serverNow": nowMs()}, nil
	})

	s.route(mux, "POST /api/me/password", "any", 0, func(c *reqCtx) (any, error) {
		b := c.obj()
		cur, next := jsString(b["current"]), jsString(b["next"])
		u := c.user
		ok := false
		hash, salt := u.PassHash, u.PassSalt
		s.unlockDuring(func() { ok = checkPassword(cur, hash, salt) })
		if !ok {
			return nil, badEn("Ο τρέχων κωδικός δεν είναι σωστός.", "The current password is not correct.")
		}
		min := 6
		if u.Role == "admin" {
			min = 8
		}
		if len([]rune(next)) < min {
			return nil, badEn(fmt.Sprintf("Ο νέος κωδικός πρέπει να έχει τουλάχιστον %d χαρακτήρες.", min), fmt.Sprintf("The new password must be at least %d characters long.", min))
		}
		var nh, ns string
		s.unlockDuring(func() { nh, ns = hashPassword(next) })
		u.PassHash, u.PassSalt, u.MustChange = nh, ns, false
		st.saveUsers()
		st.addAudit(u.Username, "password-change", "")
		return map[string]any{"ok": true}, nil
	})

	// ---- registry (admin)
	s.route(mux, "GET /api/registry/rev", "admin", 0, func(c *reqCtx) (any, error) {
		if st.registry == nil {
			return map[string]any{"rev": 0}, nil
		}
		return map[string]any{"rev": st.registry.Rev, "updatedAt": st.registry.UpdatedAt, "updatedBy": st.registry.UpdatedBy}, nil
	})
	s.route(mux, "GET /api/registry", "admin", 0, func(c *reqCtx) (any, error) {
		if st.registry == nil {
			return map[string]any{"rev": 0, "data": nil}, nil
		}
		return rawJSON(st.regBytes), nil // stored exactly in the response format
	})
	s.route(mux, "PUT /api/registry", "admin", 80<<20, func(c *reqCtx) (any, error) {
		var body struct {
			BaseRev json.Number     `json:"baseRev"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(c.body, &body); err != nil {
			return nil, bad("Μη έγκυρα δεδομένα μητρώου.")
		}
		var shape map[string]json.RawMessage
		if json.Unmarshal(body.Data, &shape) != nil || shape == nil {
			return nil, bad("Μη έγκυρα δεδομένα μητρώου.")
		}
		for _, k := range []string{"students", "subjects", "grades", "enrollments", "years"} {
			v := bytes.TrimSpace(shape[k])
			if len(v) == 0 || v[0] != '[' {
				return nil, bad("Λείπει η ενότητα «" + k + "».")
			}
		}
		base, _ := strconv.ParseInt(body.BaseRev.String(), 10, 64)
		var rev int64
		if st.registry != nil {
			rev = st.registry.Rev
		}
		if base != rev || body.BaseRev.String() == "" {
			var at, by any
			who := ""
			if st.registry != nil {
				at, by, who = st.registry.UpdatedAt, st.registry.UpdatedBy, st.registry.UpdatedBy
			}
			return nil, conflict("Τα δεδομένα άλλαξαν από άλλον υπολογιστή ("+who+").", map[string]any{"rev": rev, "updatedAt": at, "updatedBy": by})
		}
		if st.registry != nil {
			st.dailyRegistryBackup(c.user.Username)
			// a save that drops most of the registry gets its own safety copy
			var before, after struct {
				Students []json.RawMessage `json:"students"`
			}
			if json.Unmarshal(st.registry.Data, &before) == nil && json.Unmarshal(body.Data, &after) == nil {
				if len(before.Students) >= 10 && len(after.Students)*2 < len(before.Students) {
					st.backupRegistry("pre-bigchange", c.user.Username)
				}
			}
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, body.Data); err != nil {
			return nil, bad("Μη έγκυρα δεδομένα μητρώου.")
		}
		t := nowMs()
		r := &Registry{Rev: rev + 1, UpdatedAt: t, UpdatedBy: c.user.Username, Data: compact.Bytes()}
		if err := st.setRegistry(r); err != nil {
			return nil, err
		}
		return map[string]any{"rev": r.Rev, "updatedAt": t}, nil
	})
	s.route(mux, "GET /api/registry/backups", "admin", 0, func(c *reqCtx) (any, error) {
		out := []map[string]any{}
		for i := len(st.backups) - 1; i >= 0 && len(out) < 100; i-- {
			b := st.backups[i]
			out = append(out, map[string]any{"id": b.ID, "name": strconv.FormatInt(b.ID, 10), "rev": b.Rev, "reason": b.Reason, "createdAt": b.CreatedAt, "mtime": b.CreatedAt, "byUser": b.ByUser, "size": b.Size})
		}
		return out, nil
	})
	s.route(mux, "POST /api/registry/backups", "admin", 0, func(c *reqCtx) (any, error) {
		reason := runeSlice(jsString(c.obj()["reason"]), 40)
		if reason == "" {
			reason = "manual"
		}
		id, err := st.backupRegistry(reason, c.user.Username)
		if err != nil {
			return nil, err
		}
		if id == 0 {
			return map[string]any{"id": nil, "name": nil}, nil
		}
		return map[string]any{"id": id, "name": strconv.FormatInt(id, 10)}, nil
	})
	s.route(mux, "GET /api/registry/backups/{id}", "admin", 0, func(c *reqCtx) (any, error) {
		id, _ := strconv.ParseInt(c.param("id"), 10, 64)
		for _, b := range st.backups {
			if b.ID == id && id > 0 {
				data, err := readFile(st.path("registry-backups", strconv.FormatInt(id, 10)+".json"))
				if err != nil {
					return nil, notFound("Το αντίγραφο δεν βρέθηκε.")
				}
				return rawJSON(append(append([]byte(`{"data":`), data...), '}')), nil
			}
		}
		return nil, notFound("Το αντίγραφο δεν βρέθηκε.")
	})

	// ---- accounts (admin)
	s.route(mux, "GET /api/users", "admin", 0, func(c *reqCtx) (any, error) {
		list := append([]*User(nil), st.users...)
		sort.Slice(list, func(i, j int) bool {
			if list[i].Role != list[j].Role {
				return list[i].Role < list[j].Role
			}
			return strings.ToLower(list[i].Username) < strings.ToLower(list[j].Username)
		})
		out := []map[string]any{}
		for _, u := range list {
			out = append(out, publicUser(u))
		}
		return out, nil
	})

	s.route(mux, "POST /api/users/students", "admin", 0, func(c *reqCtx) (any, error) {
		var body struct {
			Students []struct {
				AM   any `json:"am"`
				Name any `json:"name"`
			} `json:"students"`
			ResetExisting bool `json:"resetExisting"`
		}
		json.Unmarshal(c.body, &body)
		if len(body.Students) == 0 {
			return nil, bad("Δεν επιλέχθηκαν σπουδαστές.")
		}
		if len(body.Students) > 2000 {
			return nil, bad("Πολλοί σπουδαστές σε μία κίνηση (μέγιστο 2000).")
		}
		type item struct {
			am, name, pw, hash, salt string
		}
		var todo []*item
		var order []*item
		for _, x := range body.Students {
			am := normAm(jsString(x.AM))
			if am == "" {
				continue
			}
			it := &item{am: am, name: runeSlice(strings.TrimSpace(jsString(x.Name)), 120)}
			order = append(order, it)
			ex := st.userByName(am)
			if ex == nil || (ex.Role == "student" && body.ResetExisting) {
				it.pw = randomPassword(8)
				todo = append(todo, it)
			}
		}
		// hashing is slow on purpose → in parallel, without blocking the rest of the server
		s.unlockDuring(func() {
			var wg sync.WaitGroup
			sem := make(chan struct{}, runtime.NumCPU())
			for _, it := range todo {
				wg.Add(1)
				sem <- struct{}{}
				go func(it *item) {
					defer wg.Done()
					it.hash, it.salt = hashPassword(it.pw)
					<-sem
				}(it)
			}
			wg.Wait()
		})
		out := []map[string]any{}
		created := 0
		for _, it := range order {
			ex := st.userByName(it.am)
			switch {
			case ex != nil && ex.Role != "student":
				out = append(out, map[string]any{"am": it.am, "name": it.name, "status": "conflict"})
			case ex != nil && (!body.ResetExisting || it.hash == ""):
				if it.name != "" && it.name != ex.DisplayName {
					ex.DisplayName = it.name
				}
				name := it.name
				if name == "" {
					name = ex.DisplayName
				}
				out = append(out, map[string]any{"am": it.am, "name": name, "status": "exists", "id": ex.ID})
			case ex != nil:
				ex.PassHash, ex.PassSalt, ex.Active = it.hash, it.salt, true
				if it.name != "" {
					ex.DisplayName = it.name
				}
				for k, v := range st.sessions {
					if v.UserID == ex.ID {
						delete(st.sessions, k)
					}
				}
				out = append(out, map[string]any{"am": it.am, "name": ex.DisplayName, "username": it.am, "password": it.pw, "status": "reset", "id": ex.ID})
				created++
			default:
				if it.hash == "" {
					continue
				}
				u := &User{ID: st.counters.NextUserID, Username: it.am, Role: "student", AM: it.am, DisplayName: it.name, PassHash: it.hash, PassSalt: it.salt, Active: true, CreatedAt: nowMs()}
				st.counters.NextUserID++
				st.users = append(st.users, u)
				out = append(out, map[string]any{"am": it.am, "name": it.name, "username": it.am, "password": it.pw, "status": "created", "id": u.ID})
				created++
			}
		}
		st.saveCounters()
		st.saveUsers()
		st.saveSessions()
		st.addAudit(c.user.Username, "accounts", fmt.Sprintf("%d κωδικοί", created))
		return map[string]any{"results": out}, nil
	})

	s.route(mux, "POST /api/users/admins", "admin", 0, func(c *reqCtx) (any, error) {
		b := c.obj()
		username := strings.TrimSpace(jsString(b["username"]))
		pw := jsString(b["password"])
		if err := validAdminName(username); err != nil {
			return nil, err
		}
		if len([]rune(pw)) < 8 {
			return nil, bad("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.")
		}
		if st.userByName(username) != nil {
			return nil, bad("Το όνομα χρήστη υπάρχει ήδη.")
		}
		var hash, salt string
		s.unlockDuring(func() { hash, salt = hashPassword(pw) })
		if st.userByName(username) != nil {
			return nil, bad("Το όνομα χρήστη υπάρχει ήδη.")
		}
		name := strings.TrimSpace(jsString(b["name"]))
		if name == "" {
			name = username
		}
		u := &User{ID: st.counters.NextUserID, Username: username, Role: "admin", DisplayName: runeSlice(name, 120), PassHash: hash, PassSalt: salt, Active: true, CreatedAt: nowMs()}
		st.counters.NextUserID++
		st.users = append(st.users, u)
		st.saveCounters()
		st.saveUsers()
		st.addAudit(c.user.Username, "admin-create", username)
		return publicUser(u), nil
	})

	userParam := func(c *reqCtx) (*User, error) {
		id, _ := strconv.ParseInt(c.param("id"), 10, 64)
		u := st.userByID(id)
		if u == nil {
			return nil, notFound("Ο χρήστης δεν βρέθηκε.")
		}
		return u, nil
	}

	s.route(mux, "POST /api/users/{id}/password", "admin", 0, func(c *reqCtx) (any, error) {
		u, err := userParam(c)
		if err != nil {
			return nil, err
		}
		pw := jsString(c.obj()["password"])
		if u.Role == "admin" {
			if len([]rune(pw)) < 8 {
				return nil, bad("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.")
			}
		} else if pw == "" {
			pw = randomPassword(8)
		} else if len([]rune(pw)) < 6 {
			return nil, bad("Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.")
		}
		var hash, salt string
		s.unlockDuring(func() { hash, salt = hashPassword(pw) })
		u.PassHash, u.PassSalt, u.MustChange = hash, salt, false
		st.saveUsers()
		if u.ID != c.user.ID {
			st.dropSessionsOf(u.ID)
		}
		st.addAudit(c.user.Username, "password-reset", u.Username)
		out := map[string]any{"username": u.Username}
		if u.Role != "admin" {
			out["password"] = pw
		}
		return out, nil
	})

	s.route(mux, "PATCH /api/users/{id}", "admin", 0, func(c *reqCtx) (any, error) {
		u, err := userParam(c)
		if err != nil {
			return nil, err
		}
		b := c.obj()
		if v, ok := b["active"]; ok {
			on := truthy(v)
			if !on && u.ID == c.user.ID {
				return nil, bad("Δεν μπορείτε να απενεργοποιήσετε τον δικό σας λογαριασμό.")
			}
			if !on && u.Role == "admin" && u.Active && st.adminCount(true) <= 1 {
				return nil, bad("Πρέπει να υπάρχει τουλάχιστον ένας ενεργός διαχειριστής.")
			}
			u.Active = on
			if !on {
				st.dropSessionsOf(u.ID)
			}
		}
		if v, ok := b["name"]; ok {
			u.DisplayName = runeSlice(jsString(v), 120)
		}
		st.saveUsers()
		st.addAudit(c.user.Username, "user-update", u.Username)
		return publicUser(u), nil
	})

	s.route(mux, "DELETE /api/users/{id}", "admin", 0, func(c *reqCtx) (any, error) {
		u, err := userParam(c)
		if err != nil {
			return nil, err
		}
		if u.ID == c.user.ID {
			return nil, bad("Δεν μπορείτε να διαγράψετε τον δικό σας λογαριασμό.")
		}
		if u.Role == "admin" && st.adminCount(false) <= 1 {
			return nil, bad("Πρέπει να υπάρχει τουλάχιστον ένας διαχειριστής.")
		}
		list := st.users[:0]
		for _, x := range st.users {
			if x.ID != u.ID {
				list = append(list, x)
			}
		}
		st.users = list
		st.dropSessionsOf(u.ID)
		st.saveUsers()
		st.addAudit(c.user.Username, "user-delete", u.Username)
		return map[string]any{"ok": true}, nil
	})

	// ---- teachers (admin)
	s.route(mux, "POST /api/users/teachers", "admin", 0, func(c *reqCtx) (any, error) {
		b := c.obj()
		username := strings.TrimSpace(jsString(b["username"]))
		pw := jsString(b["password"])
		if err := validAdminName(username); err != nil {
			return nil, err
		}
		if len([]rune(pw)) < 6 {
			return nil, bad("Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.")
		}
		if st.userByName(username) != nil {
			return nil, bad("Το όνομα χρήστη υπάρχει ήδη.")
		}
		var hash, salt string
		s.unlockDuring(func() { hash, salt = hashPassword(pw) })
		if st.userByName(username) != nil {
			return nil, bad("Το όνομα χρήστη υπάρχει ήδη.")
		}
		name := strings.TrimSpace(jsString(b["name"]))
		if name == "" {
			name = username
		}
		u := &User{ID: st.counters.NextUserID, Username: username, Role: "teacher", DisplayName: runeSlice(name, 120), PassHash: hash, PassSalt: salt, Active: true, CreatedAt: nowMs(), Assignments: []TeachAssignment{}}
		st.counters.NextUserID++
		st.users = append(st.users, u)
		st.saveCounters()
		st.saveUsers()
		st.addAudit(c.user.Username, "teacher-create", username)
		return publicUser(u), nil
	})

	s.route(mux, "PUT /api/users/{id}/assignments", "admin", 1<<20, func(c *reqCtx) (any, error) {
		u, err := userParam(c)
		if err != nil {
			return nil, err
		}
		if u.Role != "teacher" {
			return nil, bad("Αναθέσεις μαθημάτων γίνονται μόνο σε καθηγητές.")
		}
		var body struct {
			Assignments []TeachAssignment `json:"assignments"`
		}
		json.Unmarshal(c.body, &body)
		u.Assignments = sanitizeAssignments(body.Assignments)
		st.saveUsers()
		st.addAudit(c.user.Username, "teacher-assign", fmt.Sprintf("%s: %d", u.Username, len(u.Assignments)))
		return publicUser(u), nil
	})

	// ---- the teacher's own subjects (only his classes, only his subjects)
	s.route(mux, "GET /api/teacher/rev", "teacher", 0, func(c *reqCtx) (any, error) {
		var rev int64
		if st.registry != nil {
			rev = st.registry.Rev
		}
		return map[string]any{"rev": rev, "assign": assignHash(c.user.Assignments), "serverNow": nowMs()}, nil
	})

	s.route(mux, "GET /api/teacher/data", "teacher", 0, func(c *reqCtx) (any, error) {
		if st.registry == nil {
			return map[string]any{"rev": 0, "data": nil, "assignments": c.user.Assignments, "assign": assignHash(c.user.Assignments), "user": publicUser(c.user), "serverNow": nowMs()}, nil
		}
		d, err := parseRegistry(st.registry.Data)
		if err != nil {
			return nil, err
		}
		as := c.user.Assignments
		if as == nil {
			as = []TeachAssignment{}
		}
		return map[string]any{"rev": st.registry.Rev, "data": d.teacherView(as), "assignments": as, "assign": assignHash(as), "user": publicUser(c.user), "serverNow": nowMs()}, nil
	})

	s.route(mux, "POST /api/teacher/grades", "teacher", 2<<20, func(c *reqCtx) (any, error) {
		var body struct {
			YearID    string        `json:"yearId"`
			SubjectID string        `json:"subjectId"`
			Source    string        `json:"source"`
			FileName  string        `json:"fileName"`
			Changes   []gradeChange `json:"changes"`
		}
		if err := json.Unmarshal(c.body, &body); err != nil {
			return nil, bad("Μη έγκυρο αίτημα.")
		}
		if st.registry == nil {
			return nil, bad("Το μητρώο είναι κενό.")
		}
		if len(body.Changes) == 0 {
			return nil, bad("Δεν υπάρχουν βαθμοί για καταχώριση.")
		}
		if body.Source != "import" {
			body.Source = "manual"
		}
		d, err := parseRegistry(st.registry.Data)
		if err != nil {
			return nil, err
		}
		stats, importID, err := d.applyTeacherGrades(c.user, body.YearID, body.SubjectID, body.Source, body.FileName, body.Changes)
		if err != nil {
			return nil, err
		}
		st.dailyRegistryBackup(c.user.Username)
		r, err := st.commitRegistryData(d.bytes(), c.user.Username)
		if err != nil {
			return nil, err
		}
		detail := fmt.Sprintf("%s/%s: %v", body.YearID, body.SubjectID, stats)
		if body.FileName != "" {
			detail += " (" + body.FileName + ")"
		}
		st.addAudit(c.user.Username, "teacher-grades", detail)
		return map[string]any{"rev": r.Rev, "stats": stats, "importId": importID}, nil
	})

	// ---- exams (admin)
	s.route(mux, "GET /api/exams", "admin", 0, func(c *reqCtx) (any, error) {
		list := []*Exam{}
		for _, e := range st.exams {
			list = append(list, e)
		}
		sort.Slice(list, func(i, j int) bool {
			if list[i].StartsAt != list[j].StartsAt {
				return list[i].StartsAt > list[j].StartsAt
			}
			return list[i].ID > list[j].ID
		})
		out := []map[string]any{}
		for _, e := range list {
			m := examMetaJSON(e)
			started, submitted := 0, 0
			for _, a := range st.attempts[e.ID] {
				started++
				if a.Status == "submitted" {
					submitted++
				}
			}
			m["questionCount"] = len(e.Questions)
			m["assigned"] = len(e.Assignments)
			m["started"] = started
			m["submitted"] = submitted
			out = append(out, m)
		}
		return out, nil
	})

	s.route(mux, "GET /api/exams/{id}", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		m := examMetaJSON(e)
		m["questions"] = e.Questions
		as := append([]Assignment{}, e.Assignments...)
		sort.SliceStable(as, func(i, j int) bool {
			if as[i].ClassName != as[j].ClassName {
				return as[i].ClassName < as[j].ClassName
			}
			return as[i].Name < as[j].Name
		})
		m["assignments"] = as
		m["attempts"] = len(st.attempts[e.ID])
		m["absenceAllowed"] = allowedMap(e)
		return m, nil
	})

	saveExam := func(c *reqCtx, existing *Exam) (int64, error) {
		b := c.obj()
		meta, err := normalizeExamMeta(b)
		if err != nil {
			return 0, bad(err.Error())
		}
		qs, err := questionsFromBody(b)
		if err != nil {
			return 0, err
		}
		t := nowMs()
		if existing == nil {
			e := &Exam{ID: st.counters.NextExamID, ExamMeta: meta, Status: "draft", CreatedAt: t, UpdatedAt: t, CreatedBy: c.user.Username, Questions: qs, Assignments: []Assignment{}}
			st.counters.NextExamID++
			st.saveCounters()
			if err := st.saveExam(e); err != nil {
				return 0, err
			}
			st.exams[e.ID] = e
			st.addAudit(c.user.Username, "exam-create", meta.Title)
			return e.ID, nil
		}
		attempts := len(st.attempts[existing.ID])
		changed := questionsJSON(existing.Questions) != questionsJSON(qs)
		if attempts > 0 && changed && !sameStructure(existing.Questions, qs) {
			return 0, conflict("Υπάρχουν ήδη απαντήσεις σπουδαστών: επιτρέπονται μόνο διορθώσεις (κείμενο, σωστή απάντηση, μονάδες), όχι προσθήκη/αφαίρεση ερωτήσεων ή επιλογών.", nil)
		}
		if existing.Status == "published" {
			if errs := validateQuestions(qs); len(errs) > 0 {
				return 0, bad(errs[0])
			}
		}
		existing.ExamMeta = meta
		existing.Questions = qs
		existing.UpdatedAt = t
		if err := st.saveExam(existing); err != nil {
			return 0, err
		}
		if attempts > 0 && changed {
			s.regrade(existing)
		}
		st.addAudit(c.user.Username, "exam-update", meta.Title)
		return existing.ID, nil
	}

	s.route(mux, "POST /api/exams", "admin", 8<<20, func(c *reqCtx) (any, error) {
		id, err := saveExam(c, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id}, nil
	})

	s.route(mux, "PUT /api/exams/{id}", "admin", 8<<20, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		id, err := saveExam(c, e)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id}, nil
	})

	s.route(mux, "POST /api/exams/{id}/publish", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		on := truthy(c.obj()["published"])
		if on {
			if errs := validateQuestions(e.Questions); len(errs) > 0 {
				return nil, bad(strings.Join(errs, " "))
			}
			if len(e.Assignments) == 0 {
				return nil, bad("Αναθέστε πρώτα την εξέταση σε σπουδαστές.")
			}
		} else if len(st.attempts[e.ID]) > 0 {
			return nil, bad("Η εξέταση έχει ήδη ξεκινήσει από σπουδαστές και δεν μπορεί να αποσυρθεί.")
		}
		e.Status = "draft"
		if on {
			e.Status = "published"
		}
		e.UpdatedAt = nowMs()
		st.saveExam(e)
		action := "exam-unpublish"
		if on {
			action = "exam-publish"
		}
		st.addAudit(c.user.Username, action, e.Title)
		return map[string]any{"status": e.Status}, nil
	})

	s.route(mux, "PUT /api/exams/{id}/assignments", "admin", 4<<20, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		var body struct {
			Students []map[string]any `json:"students"`
		}
		json.Unmarshal(c.body, &body)
		seen := map[string]bool{}
		list := []Assignment{}
		for _, x := range body.Students {
			am := normAm(jsString(x["am"]))
			if am == "" || seen[am] {
				continue
			}
			seen[am] = true
			list = append(list, Assignment{AM: am, StudentID: optString(x["studentId"], 80), Name: runeSlice(jsString(x["name"]), 120), ClassName: runeSlice(jsString(x["className"]), 120)})
		}
		e.Assignments = list
		pruneAllowed(e)
		st.saveExam(e)
		st.addAudit(c.user.Username, "exam-assign", fmt.Sprintf("%s: %d", e.Title, len(list)))
		return map[string]any{"assigned": len(list)}, nil
	})

	s.route(mux, "DELETE /api/exams/{id}", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		n := len(st.attempts[e.ID])
		if n > 0 && c.r.URL.Query().Get("force") != "1" {
			return nil, conflict(fmt.Sprintf("Η εξέταση έχει %d απαντήσεις σπουδαστών.", n), map[string]any{"attempts": n})
		}
		st.deleteExam(e.ID)
		st.addAudit(c.user.Username, "exam-delete", e.Title)
		return map[string]any{"ok": true}, nil
	})

	s.route(mux, "POST /api/exams/{id}/duplicate", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		t := nowMs()
		cp := *e
		cp.ID = st.counters.NextExamID
		st.counters.NextExamID++
		cp.Title = e.Title + " (αντίγραφο)"
		cp.Status = "draft"
		cp.CreatedAt, cp.UpdatedAt, cp.CreatedBy = t, t, c.user.Username
		cp.Questions = append([]Question{}, e.Questions...)
		cp.Assignments = append([]Assignment{}, e.Assignments...)
		cp.AbsenceAllowed = nil // permissions are given per exam
		st.saveCounters()
		st.saveExam(&cp)
		st.exams[cp.ID] = &cp
		return map[string]any{"id": cp.ID}, nil
	})

	s.route(mux, "GET /api/exams/{id}/results", "admin", 0, func(c *reqCtx) (any, error) {
		s.sweepExpired()
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		t := nowMs()
		ph := phaseOf(e, t)
		accounts := map[string]*User{}
		for _, u := range st.users {
			if u.Role == "student" {
				accounts[u.AM] = u
			}
		}
		atts := map[string]*Attempt{}
		for k, v := range st.attempts[e.ID] {
			atts[k] = v
		}
		row := func(am string, a *Attempt) map[string]any {
			m := map[string]any{"am": am, "startedAt": nil, "submittedAt": nil, "autoSubmitted": false, "score": nil, "max": nil, "percent": nil, "grade": nil, "answered": 0, "perQuestion": nil}
			if u := accounts[am]; u != nil {
				if u.Active {
					m["account"] = "active"
				} else {
					m["account"] = "inactive"
				}
			} else {
				m["account"] = "none"
			}
			if a == nil {
				if ph.Phase == "closed" {
					m["status"] = "missed"
				} else {
					m["status"] = "not_started"
				}
				return m
			}
			g := gradeAnswers(e.Questions, a.Answers)
			m["status"] = a.Status
			m["startedAt"] = a.StartedAt
			if a.SubmittedAt > 0 {
				m["submittedAt"] = a.SubmittedAt
			}
			m["autoSubmitted"] = a.AutoSubmitted
			if a.Status == "submitted" {
				m["score"], m["max"], m["percent"], m["grade"] = a.Score, a.Max, a.Percent, a.Grade
			} else {
				m["score"], m["max"], m["percent"], m["grade"] = g.Score, g.Max, g.Percent, g.Grade
			}
			m["answered"] = g.Answered
			m["perQuestion"] = perQuestionFlags(g)
			return m
		}
		rows := []map[string]any{}
		for _, as := range e.Assignments {
			m := row(as.AM, atts[as.AM])
			delete(atts, as.AM)
			m["studentId"], m["name"], m["className"] = as.StudentID, as.Name, as.ClassName
			// absences in the exam's subject: over the limit → cannot start unless the admin allows it
			if ab, ok := s.examAbsences(e, as.AM); ok {
				m["absences"], m["absenceDays"], m["overLimit"] = ab.Count, ab.Days, ab.Over
				if ab.Limit >= 0 {
					m["absenceLimit"] = ab.Limit
				} else {
					m["absenceLimit"] = nil
				}
			}
			_, allowed := e.AbsenceAllowed[as.AM]
			m["absenceAllowed"] = allowed
			rows = append(rows, m)
		}
		// attempts of students no longer assigned are still reported
		for am, a := range atts {
			m := row(am, a)
			m["name"], m["className"], m["unassigned"] = "", "", true
			rows = append(rows, m)
		}
		meta := examMetaJSON(e)
		meta["questionCount"] = len(e.Questions)
		meta["phase"] = ph.Phase
		meta["absenceCheck"] = e.SubjectID != nil && *e.SubjectID != "" && e.YearID != nil && *e.YearID != ""
		return map[string]any{"exam": meta, "questions": e.Questions, "rows": rows, "serverNow": t}, nil
	})

	s.route(mux, "GET /api/exams/{id}/results/{am}", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		a := st.attempts[e.ID][normAm(c.param("am"))]
		if a == nil {
			return nil, notFound("Ο σπουδαστής δεν έχει ξεκινήσει την εξέταση.")
		}
		g := gradeAnswers(e.Questions, a.Answers)
		items := []map[string]any{}
		for i, q := range e.Questions {
			items = append(items, map[string]any{"n": i + 1, "id": q.ID, "type": q.Type, "text": q.Text, "answer": answerText(q, a.Answers[q.ID]), "correctAnswer": correctText(q), "correct": g.PerQuestion[i].Correct, "points": g.PerQuestion[i].Points, "max": q.Points})
		}
		var sub any
		if a.SubmittedAt > 0 {
			sub = a.SubmittedAt
		}
		return map[string]any{"am": a.AM, "status": a.Status, "startedAt": a.StartedAt, "submittedAt": sub, "score": g.Score, "max": g.Max, "percent": g.Percent, "grade": g.Grade, "items": items}, nil
	})

	s.route(mux, "POST /api/exams/{id}/attempts/{am}/reset", "admin", 0, func(c *reqCtx) (any, error) {
		e, err := s.exam(c.param("id"))
		if err != nil {
			return nil, err
		}
		am := normAm(c.param("am"))
		_, had := st.attempts[e.ID][am]
		st.deleteAttempt(e.ID, am)
		st.addAudit(c.user.Username, "attempt-reset", e.Title+" / "+am)
		return map[string]any{"ok": had}, nil
	})

	s.route(mux, "GET /api/audit", "admin", 0, func(c *reqCtx) (any, error) {
		out := []AuditEntry{}
		for i := len(st.audit) - 1; i >= 0; i-- {
			out = append(out, st.audit[i])
		}
		return out, nil
	})

	// ---- the student's own exams (NO grades, NO registry)
	s.route(mux, "GET /api/my/exams", "student", 0, func(c *reqCtx) (any, error) {
		s.sweepExpired()
		t := nowMs()
		am := normAm(c.user.AM)
		list := []*Exam{}
		for _, e := range st.exams {
			if e.Status != "published" {
				continue
			}
			for _, x := range e.Assignments {
				if x.AM == am {
					list = append(list, e)
					break
				}
			}
		}
		sort.Slice(list, func(i, j int) bool { return list[i].StartsAt < list[j].StartsAt })
		out := []map[string]any{}
		for _, e := range list {
			a := st.attempts[e.ID][am]
			v := s.studentExamView(e, a, t)
			if a == nil {
				if ab, barred := s.examBarred(e, am); barred {
					v["barred"], v["absences"], v["absenceLimit"] = true, ab.Count, ab.Limit
				}
			}
			out = append(out, v)
		}
		return map[string]any{"exams": out, "serverNow": t, "user": publicUser(c.user)}, nil
	})

	s.route(mux, "POST /api/my/exams/{id}/start", "student", 0, func(c *reqCtx) (any, error) {
		e, err := s.myExam(c.user, c.param("id"))
		if err != nil {
			return nil, err
		}
		t := nowMs()
		am := normAm(c.user.AM)
		if a := st.attempts[e.ID][am]; a != nil {
			if a.Status == "in_progress" && a.Deadline+s.cfg.GraceMs >= t {
				return attemptPayload(e, a), nil
			}
			if a.Status == "in_progress" {
				s.finalize(a, e, true)
			}
			return nil, errSubmitted()
		}
		ph := phaseOf(e, t)
		if ph.Phase == "upcoming" {
			return nil, conflictEn("Η εξέταση δεν έχει ξεκινήσει ακόμη.", "The exam has not started yet.", map[string]any{"state": "upcoming"})
		}
		if ph.Phase == "closed" {
			return nil, conflictEn("Έληξε ο χρόνος εισόδου στην εξέταση.", "The entry time for this exam has passed.", map[string]any{"state": "missed"})
		}
		if ab, barred := s.examBarred(e, am); barred {
			st.addAudit(c.user.Username, "exam-barred", e.Title)
			return nil, errBarred(ab)
		}
		order := makeOrder(e.Questions, e.ShuffleQuestions, e.ShuffleOptions)
		a := &Attempt{ExamID: e.ID, AM: am, UserID: c.user.ID, StartedAt: t, Deadline: t + int64(e.DurationMinutes)*60000, Answers: map[string]any{}, Order: &order, Status: "in_progress", IP: c.ip}
		if err := st.saveAttempt(a); err != nil {
			return nil, err
		}
		s.attemptsOf(e.ID)[am] = a
		st.addAudit(c.user.Username, "exam-start", e.Title)
		return attemptPayload(e, a), nil
	})

	s.route(mux, "GET /api/my/exams/{id}/attempt", "student", 0, func(c *reqCtx) (any, error) {
		e, err := s.myExam(c.user, c.param("id"))
		if err != nil {
			return nil, err
		}
		a := st.attempts[e.ID][normAm(c.user.AM)]
		if a == nil {
			return nil, errNotStarted()
		}
		if a.Status != "in_progress" || a.Deadline+s.cfg.GraceMs < nowMs() {
			if a.Status == "in_progress" {
				s.finalize(a, e, true)
			}
			return nil, conflictEn("Η εξέταση έχει υποβληθεί.", "The exam has been submitted.", map[string]any{"state": "submitted"})
		}
		return attemptPayload(e, a), nil
	})

	answersOf := func(c *reqCtx) map[string]any {
		m, _ := c.obj()["answers"].(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		return m
	}

	s.route(mux, "PUT /api/my/exams/{id}/answers", "student", 1<<20, func(c *reqCtx) (any, error) {
		e, err := s.myExam(c.user, c.param("id"))
		if err != nil {
			return nil, err
		}
		a := st.attempts[e.ID][normAm(c.user.AM)]
		if a == nil {
			return nil, errNotStarted()
		}
		t := nowMs()
		if a.Status != "in_progress" {
			return nil, errSubmitted()
		}
		if a.Deadline+s.cfg.GraceMs < t {
			s.finalize(a, e, true)
			return nil, conflictEn("Ο χρόνος έληξε — οι απαντήσεις που είχαν αποθηκευτεί υποβλήθηκαν.", "Time is up — the answers that had been saved were submitted.", map[string]any{"state": "submitted"})
		}
		a.Answers = cleanAnswers(e.Questions, answersOf(c))
		if err := st.saveAttempt(a); err != nil {
			return nil, err
		}
		return map[string]any{"saved": len(a.Answers), "serverNow": t, "deadline": a.Deadline}, nil
	})

	s.route(mux, "POST /api/my/exams/{id}/submit", "student", 1<<20, func(c *reqCtx) (any, error) {
		e, err := s.myExam(c.user, c.param("id"))
		if err != nil {
			return nil, err
		}
		a := st.attempts[e.ID][normAm(c.user.AM)]
		if a == nil {
			return nil, errNotStarted()
		}
		if a.Status != "in_progress" {
			return map[string]any{"ok": true, "state": "submitted", "submittedAt": a.SubmittedAt}, nil
		}
		late := a.Deadline+s.cfg.GraceMs < nowMs()
		if _, has := c.obj()["answers"]; has && !late {
			a.Answers = cleanAnswers(e.Questions, answersOf(c))
		}
		s.finalize(a, e, late)
		st.addAudit(c.user.Username, "exam-submit", e.Title)
		// the response deliberately contains no score
		return map[string]any{"ok": true, "state": "submitted", "submittedAt": a.SubmittedAt, "late": late}, nil
	})

	s.syllabusRoutes(mux)
	s.attendanceRoutes(mux)

	if s.cfg.TestMode {
		// only for the automatic tests: make running attempts of an exam run out of time
		s.route(mux, "POST /api/_test/expire/{id}", "admin", 0, func(c *reqCtx) (any, error) {
			e, err := s.exam(c.param("id"))
			if err != nil {
				return nil, err
			}
			for _, a := range st.attempts[e.ID] {
				a.Deadline = nowMs() - 120000
				st.saveAttempt(a)
			}
			return map[string]any{"ok": true}, nil
		})
	}
}

func readFile(p string) ([]byte, error) {
	return osReadFile(p)
}
