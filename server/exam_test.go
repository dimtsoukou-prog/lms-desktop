package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type fixtures struct {
	RawQuestions []map[string]any `json:"rawQuestions"`
	Questions    json.RawMessage  `json:"questions"`
	Validate     []string         `json:"validate"`
	Cases        []struct {
		Answers map[string]any  `json:"answers"`
		Clean   json.RawMessage `json:"clean"`
		Grade   json.RawMessage `json:"grade"`
	} `json:"cases"`
	Norm    [][2]string         `json:"norm"`
	Percent [][2]float64        `json:"percent"`
	Phase   [][2]any            `json:"phase"`
	Student json.RawMessage     `json:"student"`
	Texts   []map[string]string `json:"texts"`
}

func sameJSON(t *testing.T, what string, got any, want json.RawMessage) {
	t.Helper()
	g, _ := json.Marshal(got)
	var a, b any
	json.Unmarshal(g, &a)
	json.Unmarshal(want, &b)
	if !reflect.DeepEqual(a, b) {
		t.Errorf("%s differs from JS\n go: %s\n js: %s", what, g, want)
	}
}

// The Go server must grade exactly like src/exam-core.js (test/make-grading-fixtures.js).
func TestGradingMatchesJavaScript(t *testing.T) {
	b, err := os.ReadFile("../test/grading-fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	qs := make([]Question, len(f.RawQuestions))
	for i, r := range f.RawQuestions {
		qs[i] = normalizeQuestion(r, i)
	}
	sameJSON(t, "normalizeQuestion", qs, f.Questions)
	v := validateQuestions(qs)
	if !reflect.DeepEqual(v, f.Validate) && !(len(v) == 0 && len(f.Validate) == 0) {
		t.Errorf("validate: %v vs %v", v, f.Validate)
	}
	for i, c := range f.Cases {
		sameJSON(t, "cleanAnswers case "+string(rune('0'+i)), cleanAnswers(qs, c.Answers), c.Clean)
		sameJSON(t, "gradeAnswers case "+string(rune('0'+i)), gradeAnswers(qs, c.Answers), c.Grade)
	}
	for _, n := range f.Norm {
		if got := normAnswer(n[0]); got != n[1] {
			t.Errorf("normAnswer(%q) = %q, js %q", n[0], got, n[1])
		}
	}
	for _, p := range f.Percent {
		if got := percentToGrade(p[0]); float64(got) != p[1] {
			t.Errorf("percentToGrade(%v) = %v, js %v", p[0], got, p[1])
		}
	}
	for _, p := range f.Phase {
		dt := int64(p[0].(float64))
		if got := examPhase(1000000, 15, 30, 1000000+dt).Phase; got != p[1].(string) {
			t.Errorf("examPhase(+%d) = %s, js %s", dt, got, p[1])
		}
	}
	order := &Order{Q: []string{"q3", "q1", "missing"}, O: map[string][]string{"q1": {"b", "a"}}}
	sameJSON(t, "questionsForStudent", questionsForStudent(qs, order), f.Student)
	for i, q := range qs {
		if got := correctText(q); got != f.Texts[i]["correct"] {
			t.Errorf("correctText %s = %q, js %q", q.ID, got, f.Texts[i]["correct"])
		}
		if got := answerText(q, f.Cases[1].Answers[q.ID]); got != f.Texts[i]["answer"] {
			t.Errorf("answerText %s = %q, js %q", q.ID, got, f.Texts[i]["answer"])
		}
	}
}

func TestLanOnly(t *testing.T) {
	ok := makeNetCheck("private")
	for _, ip := range []string{"192.168.1.20", "10.0.0.5", "172.20.3.4", "127.0.0.1", "::1", "::ffff:192.168.0.9", "fe80::1", "100.64.1.1"} {
		if !ok(ip) {
			t.Errorf("%s should be allowed", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "::ffff:85.10.2.1", "2a00:1450::1", "garbage"} {
		if ok(ip) {
			t.Errorf("%s should be refused", ip)
		}
	}
	only := makeNetCheck("192.168.5.0/24")
	if !only("192.168.5.77") || only("192.168.6.1") || !only("127.0.0.1") {
		t.Error("custom network list")
	}
}

func TestPasswords(t *testing.T) {
	h, s := hashPassword("Σωστός-κωδικός1")
	if !checkPassword("Σωστός-κωδικός1", h, s) || checkPassword("λάθος", h, s) {
		t.Fatal("password check")
	}
	if p := randomPassword(8); len(p) != 8 {
		t.Fatal(p)
	}
}
