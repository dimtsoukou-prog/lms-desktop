// Generates realistic sample Excel files used by the E2E test and shipped as examples.
const ExcelJS = require('exceljs');
const path = require('path');
const out = (f) => path.join(__dirname, 'samples', f);

const last = ['ΠΑΠΑΔΟΠΟΥΛΟΣ','ΓΕΩΡΓΙΟΥ','ΝΙΚΟΛΑΟΥ','ΔΗΜΗΤΡΙΟΥ','ΙΩΑΝΝΙΔΗΣ','ΚΩΝΣΤΑΝΤΙΝΟΥ','ΑΛΕΞΙΟΥ','ΒΛΑΧΟΣ','ΜΑΥΡΟΜΑΤΗΣ','ΣΤΑΥΡΟΥ','ΚΑΡΑΓΙΑΝΝΗΣ','ΜΙΧΑΗΛΙΔΗΣ','ΘΕΟΔΩΡΟΥ','ΑΝΤΩΝΙΟΥ','ΧΡΙΣΤΟΔΟΥΛΟΥ','ΠΕΤΡΟΠΟΥΛΟΣ','ΣΑΡΑΝΤΗΣ','ΛΑΜΠΡΟΥ','ΖΑΧΑΡΙΟΥ','ΤΣΙΡΟΣ','ΜΑΝΩΛΑΚΗΣ','ΚΟΥΤΣΟΣ','ΡΗΓΑΣ','ΦΩΤΙΟΥ'];
const first = ['ΓΕΩΡΓΙΟΣ','ΙΩΑΝΝΗΣ','ΝΙΚΟΛΑΟΣ','ΔΗΜΗΤΡΙΟΣ','ΚΩΝΣΤΑΝΤΙΝΟΣ','ΑΘΑΝΑΣΙΟΣ','ΜΙΧΑΗΛ','ΕΥΑΓΓΕΛΟΣ','ΠΑΝΑΓΙΩΤΗΣ','ΧΡΗΣΤΟΣ','ΣΤΥΛΙΑΝΟΣ','ΑΝΤΩΝΙΟΣ','ΜΑΡΙΑ','ΕΛΕΝΗ','ΑΙΚΑΤΕΡΙΝΗ','ΣΠΥΡΙΔΩΝ','ΑΝΔΡΕΑΣ','ΘΕΟΔΩΡΟΣ','ΒΑΣΙΛΕΙΟΣ','ΕΜΜΑΝΟΥΗΛ','ΣΟΦΙΑ','ΠΕΤΡΟΣ','ΑΛΕΞΑΝΔΡΟΣ','ΦΩΤΙΟΣ'];
const fathers = ['ΝΙΚΟΛΑΟΣ','ΓΕΩΡΓΙΟΣ','ΙΩΑΝΝΗΣ','ΔΗΜΗΤΡΙΟΣ','ΠΕΤΡΟΣ','ΜΙΧΑΗΛ'];

const students = [];
// class names written the way the office writes them (typos included)
const OLA_DECK = ['OPERATIONAL LEVEL A DECK MORNING', 'OPERATIONAL LEVEL A DECK AFTERNOON'];
const OLA_ENG = ['OPERATIONAL LEVEL A ENGINE MORGNIN', 'OPERATIONAL LEVEL A ENGINE AFTERNOON'];
const SUP = ['SUPPORT MORNING 1', 'SUPPORT MORNING 2', 'SUPPORT AFTERNOON'];
for (let i = 0; i < 24; i++) {
  let spec, cls;
  if (i < 8) { spec = 'Deck'; cls = OLA_DECK[i < 4 ? 0 : 1]; }
  else if (i < 14) { spec = 'Engine'; cls = OLA_ENG[i < 11 ? 0 : 1]; }
  else if (i < 20) { spec = i % 2 ? 'Engine' : ''; cls = SUP[(i - 14) % 3]; }
  else { spec = i % 2 ? 'Engine' : 'Deck'; cls = 'Management ' + spec + ' Function 1'; }
  students.push({ am: String(26001 + i), ln: last[i], fn: first[i], fa: fathers[i % 6], spec, cls });
}

async function studentsFile() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Σπουδαστές 2026-27');
  ws.addRow(['GMC MARITIME ACADEMY']);
  ws.addRow(['Κατάσταση εγγεγραμμένων σπουδαστών 2026-2027']);
  ws.addRow([]);
  ws.addRow(['Α/Α', 'Α.Μ.', 'Ονοματεπώνυμο', 'Πατρώνυμο', 'Ειδικότητα', 'Τμήμα']);
  students.forEach((s, i) => ws.addRow([i + 1, Number(s.am), s.ln + ' ' + s.fn, s.fa, s.spec, s.cls]));
  await wb.xlsx.writeFile(out('1_Σπουδαστές_2026-2027.xlsx'));
}

async function navFile() {
  // Teacher's file: only AM + grade (0-5), Deck OLA subject NAV101
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Α.Μ.', 'Βαθμός']);
  const grades = [4, 3, 5, 2, 0, 1, 'ΑΠ', 3];
  students.slice(0, 8).forEach((s, i) => ws.addRow([Number(s.am), grades[i]]));
  ws.addRow([99999, 4]); // unknown AM
  await wb.xlsx.writeFile(out('2_NAV101_Ναυσιπλοΐα_OLA.xlsx'));
}

async function englishCommon() {
  // Common subject — Deck+Engine OLA, AM stored as text, one decimal (rejected)
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Grades');
  ws.addRow(['ID number', 'English (Real)']);
  const g = [4, 3, 5, 1, 2, 0, 3, 5, 1, 4, 2, 5, '3.5', 1];
  students.slice(0, 14).forEach((s, i) => ws.addRow([s.am, g[i]]));
  await wb.xlsx.writeFile(out('3_Αγγλικά.xlsx'));
}

async function engineMulti() {
  // Engine OLA: two subjects in one file, headers = subject codes
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Βαθμολογία');
  ws.addRow(['Α.Μ.', 'ENG101', 'ENG102']);
  const a = [3, 4, 2, 5, 1, 3];
  const b = [2, 5, '3,5', 4, 0, 2];
  students.slice(8, 14).forEach((s, i) => ws.addRow([Number(s.am), a[i], b[i]]));
  await wb.xlsx.writeFile(out('4_Engine_ENG101_ENG102.xlsx'));
}

(async () => {
  await studentsFile();
  await navFile();
  await englishCommon();
  await engineMulti();
  console.log('samples written');
})();
