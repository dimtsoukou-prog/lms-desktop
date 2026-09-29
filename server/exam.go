package main

// Exams: question model, validation, automatic grading and schedule windows.
// This is the server twin of src/exam-core.js (the desktop app uses the JS version for the editor);
// test/grading-fixtures.json keeps both implementations in agreement.

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var questionTypes = map[string]string{
	"single": "Πολλαπλής επιλογής — μία σωστή",
	"multi":  "Πολλαπλής επιλογής — πολλές σωστές",
	"tf":     "Σωστό / Λάθος",
	"short":  "Σύντομη απάντηση",
}

var optionLetters = []string{"Α", "Β", "Γ", "Δ", "Ε", "ΣΤ", "Ζ", "Η"}
var optIDs = []string{"a", "b", "c", "d", "e", "f", "g", "h"}

const maxOptions = 8

type Option struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// Question is always normalized (see normalizeQuestion).
type Question struct {
	ID      string
	Type    string
	Text    string
	Points  float64
	Options []Option // single / multi
	Correct []string // single / multi
	Answer  *bool    // tf (nil = not set)
	Accept  []string // short
}

func (q Question) MarshalJSON() ([]byte, error) {
	m := map[string]any{"id": q.ID, "type": q.Type, "text": q.Text, "points": q.Points}
	switch q.Type {
	case "single", "multi":
		m["options"] = nonNilOptions(q.Options)
		m["correct"] = nonNilStrings(q.Correct)
	case "tf":
		if q.Answer == nil {
			m["answer"] = nil
		} else {
			m["answer"] = *q.Answer
		}
	default:
		m["accept"] = nonNilStrings(q.Accept)
	}
	return json.Marshal(m)
}

func (q *Question) UnmarshalJSON(b []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*q = normalizeQuestion(raw, 0)
	return nil
}

func nonNilOptions(o []Option) []Option {
	if o == nil {
		return []Option{}
	}
	return o
}
func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// ------------------------------------------------------------ JS-like conversions
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return jsNumberString(x)
	case json.Number:
		return x.String()
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

func jsNumberString(f float64) string {
	if math.IsNaN(f) {
		return "NaN"
	}
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

// jsNumber mirrors JavaScript Number(v).
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case string:
		t := strings.TrimSpace(x)
		if t == "" {
			return 0
		}
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	default:
		return math.NaN()
	}
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	default:
		return true
	}
}

func runeSlice(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// jsRound mirrors Math.round (half up).
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }
func round2(x float64) float64  { return jsRound(x*100) / 100 }

// ------------------------------------------------------------ text normalisation
var accentMap = map[rune]rune{}

func init() {
	pairs := map[string]string{
		"ά": "α", "έ": "ε", "ή": "η", "ί": "ι", "ό": "ο", "ύ": "υ", "ώ": "ω", "ϊ": "ι", "ϋ": "υ", "ΐ": "ι", "ΰ": "υ",
		"Ά": "Α", "Έ": "Ε", "Ή": "Η", "Ί": "Ι", "Ό": "Ο", "Ύ": "Υ", "Ώ": "Ω", "Ϊ": "Ι", "Ϋ": "Υ",
		"à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "ç": "c", "è": "e", "é": "e", "ê": "e", "ë": "e",
		"ì": "i", "í": "i", "î": "i", "ï": "i", "ñ": "n", "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o",
		"ù": "u", "ú": "u", "û": "u", "ü": "u", "ý": "y", "ÿ": "y",
		"À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A", "Ç": "C", "È": "E", "É": "E", "Ê": "E", "Ë": "E",
		"Ì": "I", "Í": "I", "Î": "I", "Ï": "I", "Ñ": "N", "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O",
		"Ù": "U", "Ú": "U", "Û": "U", "Ü": "U", "Ý": "Y",
	}
	for k, v := range pairs {
		accentMap[[]rune(k)[0]] = []rune(v)[0]
	}
}

// stripAccents: like String.normalize('NFD') + removing combining marks, for Greek and Latin text.
func stripAccents(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= 0x0300 && r <= 0x036F {
			continue
		}
		if m, ok := accentMap[r]; ok {
			r = m
		}
		b.WriteRune(r)
	}
	return b.String()
}

var spaceRun = regexp.MustCompile(`\s+`)
var trailingDots = regexp.MustCompile(`[.。!]+$`)

// normAnswer: case, accents, final sigma, extra spaces and a trailing dot are ignored.
func normAnswer(s string) string {
	t := strings.ToLower(stripAccents(s))
	t = strings.ReplaceAll(t, "ς", "σ")
	t = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, t)
	t = spaceRun.ReplaceAllString(t, " ")
	t = strings.TrimSpace(t)
	t = trailingDots.ReplaceAllString(t, "")
	return strings.TrimSpace(t)
}

var numRe = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

func asNumber(s string) (float64, bool) {
	t := strings.TrimSpace(s)
	t = strings.Join(strings.Fields(t), "")
	t = strings.Replace(t, ",", ".", 1)
	if !numRe.MatchString(t) {
		return 0, false
	}
	f, err := strconv.ParseFloat(t, 64)
	return f, err == nil
}

// percentToGrade: 0–5 scale, 1 = 50%, 2 = 60% … 5 = 90%+.
func percentToGrade(p float64) int {
	p = jsRound(p*1e6) / 1e6
	if !(p >= 50) {
		return 0
	}
	g := int(math.Floor((p-50)/10)) + 1
	if g > 5 {
		g = 5
	}
	return g
}

// ------------------------------------------------------------ questions
func normalizeQuestion(raw map[string]any, index int) Question {
	if raw == nil {
		raw = map[string]any{}
	}
	typ, _ := raw["type"].(string)
	if _, ok := questionTypes[typ]; !ok {
		typ = "single"
	}
	id := jsString(raw["id"])
	if !truthy(raw["id"]) {
		id = "q" + strconv.Itoa(index+1)
	}
	q := Question{ID: runeSlice(id, 40), Type: typ, Text: strings.TrimSpace(jsString(raw["text"]))}
	if !truthy(raw["text"]) {
		q.Text = ""
	}
	p := jsNumber(raw["points"])
	if p > 0 {
		q.Points = math.Min(100, round2(p))
	} else {
		q.Points = 1
	}
	switch typ {
	case "single", "multi":
		opts, _ := raw["options"].([]any)
		q.Options = []Option{}
		for i, o := range opts {
			var oid, otext string
			if om, ok := o.(map[string]any); ok {
				if truthy(om["id"]) {
					oid = jsString(om["id"])
				}
				if om["text"] != nil {
					otext = jsString(om["text"])
				}
			} else if truthy(o) {
				otext = jsString(o)
			}
			if oid == "" {
				if i < len(optIDs) {
					oid = optIDs[i]
				} else {
					oid = "o" + strconv.Itoa(i)
				}
			}
			otext = strings.TrimSpace(otext)
			if otext == "" {
				continue
			}
			q.Options = append(q.Options, Option{ID: runeSlice(oid, 12), Text: otext})
		}
		if len(q.Options) > maxOptions {
			q.Options = q.Options[:maxOptions]
		}
		ids := map[string]bool{}
		for _, o := range q.Options {
			ids[o.ID] = true
		}
		var corr []any
		switch c := raw["correct"].(type) {
		case []any:
			corr = c
		case nil:
		default:
			corr = []any{c}
		}
		q.Correct = []string{}
		for _, c := range corr {
			s := jsString(c)
			if ids[s] {
				q.Correct = append(q.Correct, s)
			}
		}
		if typ == "single" && len(q.Correct) > 1 {
			q.Correct = q.Correct[:1]
		}
	case "tf":
		switch a := raw["answer"].(type) {
		case bool:
			v := a
			q.Answer = &v
		case string:
			if a == "true" {
				v := true
				q.Answer = &v
			} else if a == "false" {
				v := false
				q.Answer = &v
			}
		}
	default:
		var acc []string
		if list, ok := raw["accept"].([]any); ok {
			for _, x := range list {
				acc = append(acc, jsString(x))
			}
		} else {
			s := ""
			if truthy(raw["accept"]) {
				s = jsString(raw["accept"])
			}
			acc = regexp.MustCompile(`[|\n;]`).Split(s, -1)
		}
		q.Accept = []string{}
		for _, x := range acc {
			x = strings.TrimSpace(x)
			if x != "" && len(q.Accept) < 20 {
				q.Accept = append(q.Accept, x)
			}
		}
	}
	return q
}

func normalizeQuestions(list []any) []Question {
	out := make([]Question, 0, len(list))
	for i, x := range list {
		m, _ := x.(map[string]any)
		out = append(out, normalizeQuestion(m, i))
	}
	return out
}

// validateQuestions lists the problems that stop an exam from being published.
func validateQuestions(qs []Question) []string {
	var errs []string
	if len(qs) == 0 {
		errs = append(errs, "Η εξέταση δεν έχει ερωτήσεις.")
	}
	seen := map[string]bool{}
	for i, q := range qs {
		n := "Ερώτηση " + strconv.Itoa(i+1) + ": "
		if seen[q.ID] {
			errs = append(errs, n+"διπλό αναγνωριστικό.")
		}
		seen[q.ID] = true
		if q.Text == "" {
			errs = append(errs, n+"λείπει το κείμενο.")
		}
		switch q.Type {
		case "single", "multi":
			if len(q.Options) < 2 {
				errs = append(errs, n+"χρειάζονται τουλάχιστον 2 επιλογές.")
			}
			if len(q.Correct) == 0 {
				errs = append(errs, n+"δεν έχει οριστεί η σωστή απάντηση.")
			}
		case "tf":
			if q.Answer == nil {
				errs = append(errs, n+"ορίστε αν η πρόταση είναι Σωστή ή Λάθος.")
			}
		default:
			if len(q.Accept) == 0 {
				errs = append(errs, n+"γράψτε τουλάχιστον μία αποδεκτή απάντηση.")
			}
		}
	}
	return errs
}

// ------------------------------------------------------------ exam fields
type ExamMeta struct {
	Title            string  `json:"title"`
	Description      string  `json:"description"`
	SubjectID        *string `json:"subjectId"`
	SubjectName      *string `json:"subjectName"`
	LevelID          *string `json:"levelId"`
	YearID           *string `json:"yearId"`
	StartsAt         int64   `json:"startsAt"`
	DurationMinutes  int     `json:"durationMinutes"`
	EntryMinutes     int     `json:"entryMinutes"`
	CountsFinal      bool    `json:"countsFinal"`
	ShuffleQuestions bool    `json:"shuffleQuestions"`
	ShuffleOptions   bool    `json:"shuffleOptions"`
}

func optString(v any, max int) *string {
	if !truthy(v) {
		return nil
	}
	s := runeSlice(jsString(v), max)
	return &s
}

func normalizeExamMeta(raw map[string]any) (ExamMeta, error) {
	var m ExamMeta
	title := strings.TrimSpace(jsString(raw["title"]))
	if !truthy(raw["title"]) || title == "" {
		return m, errors.New("Ο τίτλος της εξέτασης είναι υποχρεωτικός.")
	}
	starts := jsNumber(raw["startsAt"])
	if math.IsNaN(starts) || math.IsInf(starts, 0) || starts <= 0 {
		return m, errors.New("Ορίστε ημερομηνία και ώρα έναρξης.")
	}
	dur := jsRound(jsNumber(raw["durationMinutes"]))
	if !(dur >= 1 && dur <= 600) {
		return m, errors.New("Η διάρκεια πρέπει να είναι από 1 έως 600 λεπτά.")
	}
	var entryRaw any = raw["entryMinutes"]
	if entryRaw == nil {
		entryRaw = float64(15)
	}
	entry := jsRound(jsNumber(entryRaw))
	if !(entry >= 1 && entry <= 600) {
		return m, errors.New("Το περιθώριο εισόδου πρέπει να είναι από 1 έως 600 λεπτά.")
	}
	m.Title = runeSlice(title, 200)
	if truthy(raw["description"]) {
		m.Description = runeSlice(jsString(raw["description"]), 4000)
	}
	m.SubjectID = optString(raw["subjectId"], 200)
	m.SubjectName = optString(raw["subjectName"], 200)
	m.LevelID = optString(raw["levelId"], 40)
	m.YearID = optString(raw["yearId"], 80)
	m.StartsAt = int64(starts)
	m.DurationMinutes = int(dur)
	m.EntryMinutes = int(entry)
	m.CountsFinal = truthy(raw["countsFinal"])
	m.ShuffleQuestions = raw["shuffleQuestions"] != false
	m.ShuffleOptions = raw["shuffleOptions"] != false
	return m, nil
}

type Phase struct {
	Phase       string
	Opens       int64
	EntryCloses int64
	Ends        int64
}

// examPhase: upcoming → before startsAt; open → students may start (at least one minute);
// closed → no new starts (running attempts continue until their own deadline).
func examPhase(startsAt int64, entryMinutes, durationMinutes int, now int64) Phase {
	entry := entryMinutes
	if entry < 1 {
		entry = 1
	}
	p := Phase{Phase: "upcoming", Opens: startsAt, EntryCloses: startsAt + int64(entry)*60000}
	p.Ends = p.EntryCloses + int64(durationMinutes)*60000
	if now >= p.Opens && now <= p.EntryCloses {
		p.Phase = "open"
	} else if now > p.EntryCloses {
		p.Phase = "closed"
	}
	return p
}

// ------------------------------------------------------------ attempt order
type Order struct {
	Q []string            `json:"q"`
	O map[string][]string `json:"o"`
}

func randInt(n int) int {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return int(binary.LittleEndian.Uint64(b[:]) % uint64(n))
}

func shuffled(in []string) []string {
	a := append([]string(nil), in...)
	for i := len(a) - 1; i > 0; i-- {
		j := randInt(i + 1)
		a[i], a[j] = a[j], a[i]
	}
	return a
}

func makeOrder(qs []Question, shuffleQ, shuffleO bool) Order {
	o := Order{Q: []string{}, O: map[string][]string{}}
	for _, q := range qs {
		o.Q = append(o.Q, q.ID)
		if q.Type == "single" || q.Type == "multi" {
			ids := []string{}
			for _, x := range q.Options {
				ids = append(ids, x.ID)
			}
			if shuffleO {
				ids = shuffled(ids)
			}
			o.O[q.ID] = ids
		}
	}
	if shuffleQ {
		o.Q = shuffled(o.Q)
	}
	return o
}

// StudentQuestion is what a student receives: never the correct answers.
type StudentQuestion struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`
	Text    string   `json:"text"`
	Points  float64  `json:"points"`
	Options []Option `json:"options,omitempty"`
}

func questionsForStudent(qs []Question, order *Order) []StudentQuestion {
	byID := map[string]Question{}
	for _, q := range qs {
		byID[q.ID] = q
	}
	var ids []string
	seen := map[string]bool{}
	if order != nil {
		for _, id := range order.Q {
			if _, ok := byID[id]; ok && !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
	}
	for _, q := range qs {
		if !seen[q.ID] {
			ids = append(ids, q.ID)
			seen[q.ID] = true
		}
	}
	out := []StudentQuestion{}
	for _, id := range ids {
		q := byID[id]
		sq := StudentQuestion{ID: q.ID, Type: q.Type, Text: q.Text, Points: q.Points}
		if q.Type == "single" || q.Type == "multi" {
			om := map[string]Option{}
			for _, x := range q.Options {
				om[x.ID] = x
			}
			var oid []string
			if order != nil && order.O[q.ID] != nil {
				oid = order.O[q.ID]
			}
			used := map[string]bool{}
			sq.Options = []Option{}
			for _, x := range oid {
				if o, ok := om[x]; ok && !used[x] {
					sq.Options = append(sq.Options, o)
					used[x] = true
				}
			}
			for _, x := range q.Options {
				if !used[x.ID] {
					sq.Options = append(sq.Options, x)
					used[x.ID] = true
				}
			}
		}
		out = append(out, sq)
	}
	return out
}

// ------------------------------------------------------------ answers & grading
func hasOption(q Question, id string) bool {
	for _, o := range q.Options {
		if o.ID == id {
			return true
		}
	}
	return false
}

// cleanAnswers keeps only well-formed answers for known questions.
func cleanAnswers(qs []Question, answers map[string]any) map[string]any {
	out := map[string]any{}
	for _, q := range qs {
		v, ok := answers[q.ID]
		if !ok || v == nil {
			continue
		}
		if s, isStr := v.(string); isStr && s == "" {
			continue
		}
		switch q.Type {
		case "single":
			s := jsString(v)
			if hasOption(q, s) {
				out[q.ID] = s
			}
		case "multi":
			var items []any
			if l, isList := v.([]any); isList {
				items = l
			} else {
				items = []any{v}
			}
			seen := map[string]bool{}
			list := []any{}
			for _, x := range items {
				s := jsString(x)
				if x == nil {
					s = "null"
				}
				if hasOption(q, s) && !seen[s] {
					seen[s] = true
					list = append(list, s)
				}
			}
			if len(list) > 0 {
				out[q.ID] = list
			}
		case "tf":
			if b, isBool := v.(bool); isBool {
				out[q.ID] = b
			}
		default:
			s := runeSlice(jsString(v), 500)
			if strings.TrimSpace(s) != "" {
				out[q.ID] = s
			}
		}
	}
	return out
}

type QuestionResult struct {
	ID       string  `json:"id"`
	Answered bool    `json:"answered"`
	Correct  bool    `json:"correct"`
	Points   float64 `json:"points"`
	Max      float64 `json:"max"`
}

type Grade struct {
	Score       float64          `json:"score"`
	Max         float64          `json:"max"`
	Percent     float64          `json:"percent"`
	Grade       int              `json:"grade"`
	PerQuestion []QuestionResult `json:"perQuestion"`
	Answered    int              `json:"answered"`
}

// gradeAnswers: automatic grading. multi = all-or-nothing (exactly the correct set).
func gradeAnswers(qs []Question, answers map[string]any) Grade {
	a := cleanAnswers(qs, answers)
	var score, max float64
	g := Grade{PerQuestion: []QuestionResult{}}
	for _, q := range qs {
		max += q.Points
		v, answered := a[q.ID]
		ok := false
		if answered {
			switch q.Type {
			case "single":
				ok = len(q.Correct) == 1 && v.(string) == q.Correct[0]
			case "multi":
				list := v.([]any)
				ok = len(list) == len(q.Correct)
				if ok {
					for _, x := range list {
						found := false
						for _, c := range q.Correct {
							if c == x.(string) {
								found = true
							}
						}
						if !found {
							ok = false
						}
					}
				}
			case "tf":
				ok = q.Answer != nil && v.(bool) == *q.Answer
			default:
				s := v.(string)
				n := normAnswer(s)
				num, isNum := asNumber(s)
				for _, acc := range q.Accept {
					if normAnswer(acc) == n {
						ok = true
						break
					}
					if an, accNum := asNumber(acc); isNum && accNum && math.Abs(an-num) < 1e-9 {
						ok = true
						break
					}
				}
			}
		}
		pts := 0.0
		if ok {
			score += q.Points
			pts = q.Points
		}
		if answered {
			g.Answered++
		}
		g.PerQuestion = append(g.PerQuestion, QuestionResult{ID: q.ID, Answered: answered, Correct: ok, Points: pts, Max: q.Points})
	}
	g.Score = round2(score)
	g.Max = round2(max)
	if max > 0 {
		g.Percent = round2(score / max * 100)
	}
	g.Grade = percentToGrade(g.Percent)
	return g
}

func optionLetter(q Question, id string) string {
	for i, o := range q.Options {
		if o.ID == id {
			if i < len(optionLetters) {
				return optionLetters[i]
			}
			return strconv.Itoa(i + 1)
		}
	}
	return ""
}

// answerText: human-readable answer (for the admin's view).
func answerText(q Question, v any) string {
	if v == nil {
		return ""
	}
	switch q.Type {
	case "single":
		return optionLetter(q, jsString(v))
	case "multi":
		var items []any
		if l, ok := v.([]any); ok {
			items = l
		} else {
			items = []any{v}
		}
		parts := []string{}
		for _, x := range items {
			parts = append(parts, optionLetter(q, jsString(x)))
		}
		return strings.Join(parts, ", ")
	case "tf":
		if b, ok := v.(bool); ok {
			if b {
				return "Σωστό"
			}
			return "Λάθος"
		}
		return ""
	default:
		return jsString(v)
	}
}

func correctText(q Question) string {
	switch q.Type {
	case "single", "multi":
		parts := []string{}
		for _, c := range q.Correct {
			parts = append(parts, optionLetter(q, c))
		}
		return strings.Join(parts, ", ")
	case "tf":
		if q.Answer == nil {
			return ""
		}
		if *q.Answer {
			return "Σωστό"
		}
		return "Λάθος"
	default:
		return strings.Join(q.Accept, " | ")
	}
}

// sameStructure: same question ids, types and options → only wording / keys / points changed.
func sameStructure(a, b []Question) bool {
	if len(a) != len(b) {
		return false
	}
	for _, q := range a {
		var r *Question
		for i := range b {
			if b[i].ID == q.ID {
				r = &b[i]
				break
			}
		}
		if r == nil || r.Type != q.Type {
			return false
		}
		if optionKey(q) != optionKey(*r) {
			return false
		}
	}
	return true
}

func optionKey(q Question) string {
	ids := []string{}
	for _, o := range q.Options {
		ids = append(ids, o.ID)
	}
	sortStrings(ids)
	return fmt.Sprint(ids)
}
