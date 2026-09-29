/* JS exam-core results used by the Go server tests (server-go/exam_test.go) so both grade identically. */
const fs = require('fs');
const path = require('path');
const EC = require('../src/exam-core.js');

const rawQuestions = [
  { id: 'q1', type: 'single', text: ' Μονάδα ταχύτητας; ', options: [{ id: 'a', text: 'km/h' }, { id: 'b', text: 'knots' }, { text: '' }], correct: 'b', points: '2' },
  { type: 'multi', text: 'Φανοί', options: ['Κόκκινο', 'Πράσινο', { text: 'Μπλε' }], correct: ['a', 'c', 'zz'], points: 1.555 },
  { id: 'q3', type: 'tf', text: 'Πυξίδα', answer: 'false' },
  { id: 'q4', type: 'short', text: 'Λιμάνι', accept: 'Πειραιάς | Piraeus;  ' },
  { id: 'q5', type: 'short', text: 'Αριθμός', accept: ['3,5', '  '] , points: 0 },
  { id: 'q6', type: 'weird', text: 'Άγνωστος τύπος', options: [{ text: 'x' }, { text: 'y' }], correct: ['b'], points: 500 },
  { id: 'q7', type: 'single', text: 'Πολλές σωστές σε single', options: [{ text: '1' }, { text: '2' }], correct: ['a', 'b'] },
  { id: 'q8', type: 'tf', text: 'Χωρίς απάντηση' },
];
const questions = rawQuestions.map((q, i) => EC.normalizeQuestion(q, i));
const answerSets = [
  {},
  { q1: 'b', q2: ['c', 'a'], q3: false, q4: ' ΠΕΙΡΑΙΑΣ. ', q5: '3.5', q6: 'b', q7: 'a', q8: true },
  { q1: 'a', q2: ['a'], q3: 'false', q4: 'piraeus', q5: ' 3,50 ', q6: 'c', q7: ['a'], bogus: 1 },
  { q1: ['b'], q2: 'a', q3: true, q4: 'Πειραιας!', q5: 'τρία', q6: null, q7: '' },
  { q2: ['a', 'c', 'a'], q4: 'ΠΕΙΡΑΙΆΣ', q5: '-3.5', q1: 2 },
];
const out = {
  rawQuestions,
  questions,
  validate: EC.validateQuestions(questions),
  cases: answerSets.map((a) => ({ answers: a, clean: EC.cleanAnswers(questions, a), grade: EC.gradeAnswers(questions, a) })),
  norm: ['  Ναυσιπλοΐα  ', 'ΟΔΟΣ', 'Café.', 'άέήίόύώ ΐΰ', 'a\tb\n c', 'Αγγλικά!!'].map((x) => [x, EC.normAnswer(x)]),
  percent: [0, 49.99, 49.9999999, 50, 59.99, 60, 75, 89.99, 90, 100].map((p) => [p, EC.percentToGrade(p)]),
  phase: [0, 59999, 60000, 60001, 600000, 900000, 900001].map((dt) => [dt, EC.examPhase({ startsAt: 1000000, entryMinutes: 15, durationMinutes: 30 }, 1000000 + dt).phase]),
  student: EC.questionsForStudent(questions, { q: ['q3', 'q1', 'missing'], o: { q1: ['b', 'a'] } }),
  texts: questions.map((q) => ({ correct: EC.correctText(q), answer: EC.answerText(q, answerSets[1][q.id]) })),
};
fs.writeFileSync(path.join(__dirname, 'grading-fixtures.json'), JSON.stringify(out, null, 1));
console.log('fixtures written');
