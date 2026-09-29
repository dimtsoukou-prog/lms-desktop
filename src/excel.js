/* Excel reading (SheetJS) and styled writing (ExcelJS). Loaded as window.XL. */
(function (root) {
  'use strict';
  const C = root.Core;

  const NAVY = 'FF12304F';
  const NAVY_TEXT = 'FFFFFFFF';
  const BRASS = 'FFC9A54A';
  const LIGHT = 'FFF3F5F8';
  const RED = 'FFC13B3B';
  const GREEN = 'FF1B7F4B';
  const GRAY = 'FF8A94A3';
  const CARRY = 'FF2F6DB3';

  // ------------------------------------------------------------ reading
  function decodeCsv(bytes) {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('�')) {
      try {
        text = new TextDecoder('windows-1253').decode(bytes);
      } catch (e) {
        /* keep utf-8 */
      }
    }
    return text.replace(/^﻿/, '');
  }

  /** Returns {sheets:[{name, grid}]} where grid[r][c] = {v, w} | null */
  function readWorkbook(bytes, fileName) {
    const isCsv = /\.(csv|txt)$/i.test(fileName || '');
    const wb = isCsv
      ? XLSX.read(decodeCsv(bytes), { type: 'string', raw: true, cellDates: false }) // keep "4,5" as text
      : XLSX.read(bytes, { type: 'array', cellDates: true, cellText: true });
    const sheets = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const grid = [];
      let truncated = false;
      if (ws && ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        const maxR = Math.min(range.e.r, range.s.r + 20000);
        const maxC = Math.min(range.e.c, range.s.c + 200);
        truncated = range.e.r > maxR || range.e.c > maxC;
        for (let r = 0; r <= maxR; r++) {
          const row = [];
          for (let c = 0; c <= maxC; c++) {
            if (r < range.s.r || c < range.s.c) {
              row.push(null);
              continue;
            }
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (!cell || cell.v === undefined || cell.v === null || cell.t === 'z') row.push(null);
            else if (cell.t === 'e') {
              const txt = String(cell.w || '#ERROR');
              row.push({ v: txt, w: txt }); // Excel error (#N/A, #DIV/0!…) → text, never a number
            } else {
              let v = cell.v;
              if (typeof v === 'string') v = v.trim();
              row.push({ v, w: cell.w !== undefined ? String(cell.w).trim() : null });
            }
          }
          grid.push(row);
        }
      }
      // trim trailing empty rows
      while (grid.length && !grid[grid.length - 1].some((c) => c && C.cellText(c) !== '')) grid.pop();
      return { name, grid, truncated };
    });
    return { sheets };
  }

  // ------------------------------------------------------------ writing helpers
  function safeSheetName(name, used) {
    let n = String(name).replace(/[\[\]\*\?\/\\:]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let base = n;
    let i = 2;
    while (used.has(n.toLowerCase())) {
      const suffix = ' (' + i++ + ')';
      n = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(n.toLowerCase());
    return n;
  }

  function thinBorder(color) {
    const s = { style: 'thin', color: { argb: color || 'FFD5DCE5' } };
    return { top: s, left: s, bottom: s, right: s };
  }

  function styleHeaderRow(row, from, to) {
    for (let c = from; c <= to; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: NAVY_TEXT }, size: 10.5, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder('FF0C2238');
    }
  }

  function titleBlock(ws, lastCol, lines) {
    // line 0 = big title, others = subtitle lines
    lines.forEach((text, i) => {
      const r = ws.getRow(i + 1);
      r.getCell(1).value = text;
      ws.mergeCells(i + 1, 1, i + 1, Math.max(lastCol, 1));
      if (i === 0) {
        r.getCell(1).font = { bold: true, size: 15, color: { argb: NAVY }, name: 'Calibri' };
        r.height = 24;
      } else if (i === 1) {
        r.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF24507F' }, name: 'Calibri' };
        r.height = 19;
      } else {
        r.getCell(1).font = { size: 10, color: { argb: 'FF5A6678' }, name: 'Calibri' };
      }
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    });
    // brass rule under the title block
    const ruleRow = ws.getRow(lines.length + 1);
    for (let c = 1; c <= Math.max(lastCol, 1); c++) {
      ruleRow.getCell(c).border = { top: { style: 'medium', color: { argb: BRASS } } };
    }
    return lines.length + 2; // first free row (one blank line after rule)
  }

  /** Write a registry number as a number only when that is lossless (no zeros, signs, exponents). */
  function amValue(am) {
    const s = String(am == null ? '' : am).trim();
    return /^[1-9]\d{0,14}$/.test(s) ? Number(s) : s;
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function fileSafe(s) {
    return String(s)
      .replace(/[\\\/:\*\?"<>\|]+/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  /** Every font gets an explicit face/size (otherwise some viewers fall back to a serif font). */
  function normalizeFonts(wb) {
    wb.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const f = cell.font || {};
          if (!f.name || !f.size) cell.font = Object.assign({}, f, { name: f.name || 'Calibri', size: f.size || 11 });
        });
      });
    });
  }

  async function toBytes(wb) {
    normalizeFonts(wb);
    const buf = await wb.xlsx.writeBuffer();
    return new Uint8Array(buf);
  }

  function newWorkbook() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GMC Maritime Academy Student Registry';
    wb.created = new Date();
    return wb;
  }

  // ------------------------------------------------------------ grades in cells
  const REEXAM_SHEET = 'Re-exam';
  const CODES_LINE = 'ΑΠ = απών   ·   0Δ = 0 λόγω δικαιολογημένων απουσιών   ·   0Α = 0 λόγω αδικαιολόγητων απουσιών';
  const REEXAM_FOOT = 'Βαθμός re-exam (επαναληπτική εξέταση): ο αρχικός βαθμός φαίνεται στη σημείωση του κελιού.';

  /** Excel value of a grade (or of g.re): codes as text (ΑΠ, 0Δ, 0Α), 0–5 as numbers; null without a grade. */
  function gradeValue(g) {
    if (!g) return null;
    if (g.absent) return 'ΑΠ';
    const t = C.gradeText(g);
    if (t === C.ATT_TEXT.J || t === C.ATT_TEXT.U) return t;
    const n = Number(g.value);
    return g.value !== null && g.value !== undefined && g.value !== '' && isFinite(n) ? n : t || null;
  }

  function isFailing(g) {
    return !!g && (!!g.absent || !(Number(g.value) >= C.PASS_GRADE));
  }

  function isCodeValue(v) {
    return typeof v === 'string' && v !== '';
  }

  /** Cell note of a re-exam grade. */
  function reNote(g) {
    return 'Re-exam — αρχικός βαθμός: ' + C.gradeText(g);
  }

  /**
   * Write a grade value into a cell (value + number format). Returns the value written.
   * Codes stay text, 0–5 are numbers with format "0".
   */
  function putGradeValue(cell, g) {
    const v = gradeValue(g);
    cell.value = v;
    if (typeof v === 'number') cell.numFmt = Number.isInteger(v) ? '0' : '0.0#';
    return v;
  }

  /**
   * Write the grade that COUNTS (the re-exam grade when there is one) of a stored grade g.
   * Returns {final, value, re: bool, code: bool}. A re-exam grade gets the note «Re-exam — αρχικός βαθμός: …»
   * (extra: more note lines, e.g. the academic year of a carried grade).
   */
  function putFinalGrade(cell, g, extra) {
    const f = C.finalGrade(g);
    const v = putGradeValue(cell, f);
    const notes = (extra || []).slice();
    const re = !!(f && f.isRe);
    if (re) notes.push(reNote(g));
    if (notes.length) cell.note = notes.join('\n');
    return { final: f, value: v, re, code: isCodeValue(v) };
  }

  /** A small italic footnote row. */
  function footNote(ws, rowIdx, text, color) {
    const fr = ws.getRow(rowIdx);
    fr.getCell(1).value = text;
    fr.getCell(1).font = { italic: true, size: 9.5, color: { argb: color || 'FF5A6678' } };
    return fr;
  }

  /**
   * The «Re-exam» sheet: the students who failed the subject (ΑΠ, 0, 0Δ, 0Α) with the reason and the
   * re-exam grade if entered. rows: [{student, grade, className}]. opts: {subject, yearId, includeNames, className}.
   * Grade imports ignore a sheet with this name.
   */
  function writeReexamSheet(wb, db, rows, opts) {
    const o = opts || {};
    const ws = wb.addWorksheet(REEXAM_SHEET, {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    const heads = ['Α/Α', 'Τμήμα', 'Α.Μ.'];
    if (o.includeNames) heads.push('Επώνυμο', 'Όνομα');
    heads.push('Βαθμός', 'Αιτία', 'Re-exam');
    const n = heads.length;
    const r = titleBlock(ws, n, [
      'GMC Maritime Academy',
      'Re-exam — ' + C.subjectLabel(o.subject),
      'Ακαδημαϊκό Έτος ' + C.yearLabel(db, o.yearId) + (o.className ? '   ·   Τμήμα: ' + o.className : '') + '   ·   Ημερομηνία: ' + todayStr(),
      'Σπουδαστές που δεν πέρασαν το μάθημα (ΑΠ, 0, 0Δ, 0Α) και δίνουν επαναληπτική εξέταση   ·   ' + CODES_LINE,
    ]);
    if (!rows.length) {
      const nr = ws.getRow(r);
      nr.getCell(1).value = 'Κανένας σπουδαστής δεν χρειάζεται re-exam σε αυτό το μάθημα (δεν υπάρχει ΑΠ, 0, 0Δ ή 0Α).';
      nr.getCell(1).font = { italic: true, color: { argb: GRAY } };
    } else {
      const hr = ws.getRow(r);
      heads.forEach((h, i) => (hr.getCell(i + 1).value = h));
      styleHeaderRow(hr, 1, n);
      hr.height = 22;
      rows.forEach((x, i) => {
        const row = ws.getRow(r + 1 + i);
        const vals = [i + 1, x.className || '', amValue(x.student.am)];
        if (o.includeNames) vals.push(x.student.lastName || '', x.student.firstName || '');
        vals.forEach((v, j) => (row.getCell(j + 1).value = v));
        let c = vals.length + 1;
        const gc = row.getCell(c++);
        putGradeValue(gc, x.grade);
        gc.font = { bold: true, color: { argb: RED } };
        row.getCell(c++).value = C.gradeReason(x.grade);
        const rc = row.getCell(c++);
        if (x.grade.re) {
          putGradeValue(rc, x.grade.re);
          rc.font = { bold: true, color: { argb: C.isPassing(x.grade) ? GREEN : RED } };
        }
        const left = new Set(['Τμήμα', 'Επώνυμο', 'Όνομα', 'Αιτία']);
        for (let k = 1; k <= n; k++) {
          const cell = row.getCell(k);
          cell.border = thinBorder();
          cell.alignment = { vertical: 'middle', horizontal: left.has(heads[k - 1]) ? 'left' : 'center' };
          if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
      const done = rows.filter((x) => x.grade.re).length;
      footNote(ws, r + rows.length + 2, 'Σύνολο: ' + rows.length + '   ·   με βαθμό re-exam: ' + done + '   ·   Ο βαθμός re-exam καταχωρίζεται από τη γραμματεία· ο αρχικός βαθμός μένει ως έχει.');
      ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
      ws.pageSetup.printTitlesRow = r + ':' + r;
    }
    const widths = [6, 34, 12];
    if (o.includeNames) widths.push(20, 16);
    widths.push(10, 30, 10);
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    if (!o.includeNames) {
      const maxCls = rows.reduce((m, x) => Math.max(m, String(x.className || '').length), 0);
      ws.getColumn(2).width = Math.min(48, Math.max(20, maxCls + 2));
    }
    return ws;
  }

  // ------------------------------------------------------------ grade export
  /**
   * The sheets of the overall grade export → [{levelId, spec, section, period}]
   * (section: 'ALL' | id | 'NONE'; period: 'ALL' | id | 'NONE'). Levels with ≥ 2 periods: opts.period
   * filters, and «one sheet per class» also splits by period. Also used by the export page to count.
   */
  function gradeExportGroups(db, opts) {
    const oneSection = opts.section && opts.section !== 'ALL' ? opts.section : null;
    const onePeriod = opts.period && opts.period !== 'ALL' ? opts.period : null;
    const groups = [];
    opts.levelIds.forEach((levelId) => {
      const unified = C.isUnifiedLevel(levelId);
      const onlySpecs = opts.specialties.every((sp) => sp === 'DECK' || sp === 'ENGINE');
      if (unified && onlySpecs && opts.levelIds.length > 1) return; // "only Deck/Engine" across all levels
      const specs = unified ? ['ALL'] : opts.specialties;
      const multi = C.levelPeriods(db, levelId).length >= 2;
      let periods = ['ALL'];
      if (multi && onePeriod) periods = [onePeriod];
      else if (multi && opts.splitSections && !oneSection) periods = C.levelPeriods(db, levelId).map((p) => p.id).concat(['NONE']);
      specs.forEach((spec) => {
        periods.forEach((period) => {
          if (oneSection) groups.push({ levelId, spec, section: oneSection, period });
          else if (opts.splitSections) {
            C.levelSections(levelId).forEach((s) => groups.push({ levelId, spec, section: s.id, period }));
            groups.push({ levelId, spec, section: 'NONE', period });
          } else groups.push({ levelId, spec, section: 'ALL', period });
        });
      });
    });
    return groups;
  }

  /**
   * Overall grades (names + all subjects).
   * opts: { yearId, levelIds, specialties: ['DECK','ENGINE','NONE'] | ['DECK'] | …,
   *         section: 'ALL' | section id | 'NONE'  (one class only),
   *         period: 'ALL' | period id | 'NONE' (levels with ≥ 2 periods),
   *         splitSections: bool (one sheet per class — and per period), includePercent, includeStats, includeFather }
   * Support is always one sheet (Deck & Engine together) unless split by class.
   * Grades: the final grade (re-exam when present, with a cell note), codes as text.
   */
  function buildGradeExport(db, opts) {
    const wb = newWorkbook();
    const used = new Set();
    const year = C.yearLabel(db, opts.yearId);
    let sheetsWritten = 0;
    let studentsWritten = 0;

    // Summary sheet first (filled at the end)
    const summaryWs = wb.addWorksheet(safeSheetName('Σύνοψη', used), {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    const summaryRows = [];

    gradeExportGroups(db, opts).forEach(({ levelId, spec, section, period }) => {
      const sheet = C.buildGradeSheet(db, opts.yearId, levelId, spec, section, period);
      if (!sheet.rows.length) return;
      sheetsWritten++;
      studentsWritten += sheet.rows.length;
      const unified = C.isUnifiedLevel(levelId);
      const specOn = spec === 'DECK' || spec === 'ENGINE';
      const specLabel = unified ? 'Όλοι' : spec === 'NONE' ? 'Χωρίς ειδικότητα' : specOn ? C.specialtyName(spec) : 'Deck & Engine';
      const split = C.isSplitLevel(levelId) && specOn; // "Management Deck F1" already names the specialty
      const lvlTitle = C.levelName(db, levelId, specOn ? spec : null);
      const byClass = section !== 'ALL';
      const clsSpec = unified ? null : specOn ? spec : null;
      const multi = C.levelPeriods(db, levelId).length >= 2;
      const per = period !== 'ALL' && period !== 'NONE' ? C.classPeriod(db, levelId, period) : null; // shown in names
      const noPer = period === 'NONE';
      let sheetName;
      let classTitle = null;
      if (byClass) {
        const sec = section === 'NONE' ? null : section;
        sheetName = C.classShortName(levelId, clsSpec, sec, per) + (sec ? '' : ' - χωρίς τμήμα') + (noPer ? ' - χωρίς περ.' : '');
        classTitle = C.classFullName(db, levelId, clsSpec, sec, per) + (sec ? '' : ' (χωρίς τμήμα)') + (noPer ? ' (χωρίς περίοδο)' : '');
      } else {
        sheetName = (unified ? C.levelShort(levelId) : split ? C.levelShort(levelId, spec) : C.levelShort(levelId) + ' - ' + specLabel) + (per ? ' ' + C.periodShort(per) : noPer ? ' - χωρίς περ.' : '');
      }
      const ws = wb.addWorksheet(safeSheetName(sheetName, used), {
        views: [{ showGridLines: false }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      });
      const fixed = ['Α/Α', 'Α.Μ.', 'Επώνυμο', 'Όνομα'];
      if (opts.includeFather) fixed.push('Πατρώνυμο');
      const withSpecCol = spec === 'ALL' && !unified;
      if (withSpecCol) fixed.push('Ειδικότητα');
      const withSecCol = !byClass;
      if (withSecCol) fixed.push('Τμήμα');
      const withPerCol = multi && period === 'ALL'; // every period on one sheet
      if (withPerCol) fixed.push('Περίοδος');
      const nFixed = fixed.length;
      const nSubj = sheet.subjects.length;
      const tail = ['Μ.Ο.'];
      if (opts.includePercent) tail.push('Ποσοστό');
      tail.push('Αποτέλεσμα');
      const lastCol = nFixed + nSubj + tail.length;

      let anyCarried = false;
      let anyRe = false;
      let anyCode = false;
      const perText = byClass ? '' : per ? '   ·   Περίοδος: ' + C.periodName(per) : noPer ? '   ·   Χωρίς περίοδο' : '';
      let r = titleBlock(ws, lastCol, [
        'GMC Maritime Academy',
        'Συνολική Βαθμολογία — Ακαδημαϊκό Έτος ' + year,
        (classTitle ? 'Τμήμα: ' + classTitle : split || unified ? 'Επίπεδο: ' + lvlTitle : 'Επίπεδο: ' + lvlTitle + '   ·   Ειδικότητα: ' + specLabel) + perText,
        'Κλίμακα 0–5 (βάση 1 = 50%, 2 = 60%, 3 = 70%, 4 = 80%, 5 = 90%+)   ·   Ημερομηνία εξαγωγής: ' + todayStr(),
      ]);

      const headerRowIdx = r;
      const header = ws.getRow(headerRowIdx);
      fixed.forEach((h, i) => (header.getCell(i + 1).value = h));
      sheet.subjects.forEach((s, i) => {
        header.getCell(nFixed + i + 1).value = s.code ? s.code + '\n' + s.name : s.name;
      });
      tail.forEach((h, i) => (header.getCell(nFixed + nSubj + i + 1).value = h));
      styleHeaderRow(header, 1, lastCol);
      header.height = nSubj ? 48 : 22;

      sheet.rows.forEach((row, idx) => {
        const xr = ws.getRow(headerRowIdx + 1 + idx);
        const st = row.student;
        const vals = [idx + 1, amValue(st.am), st.lastName, st.firstName];
        if (opts.includeFather) vals.push(st.fatherName || '');
        if (withSpecCol) vals.push(C.specialtyName(st.specialty));
        if (withSecCol) vals.push(C.sectionName(levelId, row.section) || '—');
        if (withPerCol) vals.push(row.period ? C.periodName(row.period) : '—');
        vals.forEach((v, i) => (xr.getCell(i + 1).value = v));
        row.cells.forEach((c, i) => {
          const cell = xr.getCell(nFixed + i + 1);
          if (!c.applies) {
            cell.value = '—';
            cell.font = { color: { argb: GRAY } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F6' } };
          } else if (c.grade) {
            const w = putFinalGrade(cell, c.grade);
            if (isFailing(w.final)) cell.font = { color: { argb: RED }, bold: true };
            else if (w.re) cell.font = { bold: true, color: { argb: GREEN } };
            anyRe = anyRe || w.re;
            anyCode = anyCode || w.code;
          } else if (c.carried) {
            // passed in an earlier academic year (the student left and came back)
            const w = putFinalGrade(cell, c.carried, ['Βαθμός από το ακαδημαϊκό έτος ' + C.yearLabel(db, c.carried.yearId)]);
            cell.font = { italic: true, bold: true, color: { argb: CARRY } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF6FF' } };
            anyCarried = true;
            anyRe = anyRe || w.re;
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        let col = nFixed + nSubj + 1;
        const avgCell = xr.getCell(col++);
        if (row.result.avg !== null) {
          avgCell.value = row.result.avg;
          avgCell.numFmt = '0.00';
        }
        avgCell.font = { bold: true };
        avgCell.alignment = { horizontal: 'center' };
        if (opts.includePercent) {
          const pc = xr.getCell(col++);
          const p = row.result.avg !== null ? C.gradeToPercent(row.result.avg) : null;
          if (p !== null) {
            pc.value = p / 100;
            pc.numFmt = '0%';
          } else if (row.result.avg !== null) pc.value = '<50%';
          pc.alignment = { horizontal: 'center' };
        }
        const rc = xr.getCell(col++);
        rc.value = row.withdrawn ? 'Διέκοψε τη φοίτηση' : C.resultLabel(row.result);
        rc.font = row.withdrawn
          ? { italic: true, color: { argb: 'FF7A5B12' } }
          : {
              bold: row.result.status === 'pass',
              color: { argb: row.result.status === 'pass' ? GREEN : row.result.status === 'fail' ? RED : 'FF8A5A10' },
            };
        for (let c = 1; c <= lastCol; c++) {
          const cell = xr.getCell(c);
          cell.border = thinBorder();
          if (idx % 2 === 1 && !cell.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          if (!cell.alignment) cell.alignment = { vertical: 'middle' };
        }
        xr.getCell(1).alignment = { horizontal: 'center' };
        xr.getCell(2).alignment = { horizontal: 'left' };
      });

      const lastDataRow = headerRowIdx + sheet.rows.length;
      let fnRow = lastDataRow + (opts.includeStats && nSubj ? 5 : 2);
      if (anyCarried) footNote(ws, fnRow++, 'Με μπλε πλάγια γραφή: βαθμός από προηγούμενο ακαδημαϊκό έτος (ο σπουδαστής είχε περάσει το μάθημα πριν διακόψει). Η χρονιά φαίνεται στη σημείωση του κελιού.', CARRY);
      if (anyRe) footNote(ws, fnRow++, REEXAM_FOOT);
      if (anyCode) footNote(ws, fnRow++, CODES_LINE);
      if (opts.includeStats && nSubj) {
        const s1 = ws.getRow(lastDataRow + 2);
        const s2 = ws.getRow(lastDataRow + 3);
        s1.getCell(nFixed).value = 'Μ.Ο. μαθήματος';
        s2.getCell(nFixed).value = 'Επιτυχόντες / βαθμολογημένοι';
        [s1, s2].forEach((r2) => {
          r2.getCell(nFixed).font = { bold: true, color: { argb: 'FF3D4A5C' } };
          r2.getCell(nFixed).alignment = { horizontal: 'right' };
        });
        sheet.stats.forEach((st, i) => {
          const c1 = s1.getCell(nFixed + i + 1);
          if (st.avg !== null) {
            c1.value = st.avg;
            c1.numFmt = '0.00';
          }
          const c2 = s2.getCell(nFixed + i + 1);
          const graded = sheet.rows.filter((r2) => r2.cells[i].applies && (r2.cells[i].grade || r2.cells[i].carried)).length;
          c2.value = st.passed + ' / ' + graded;
          [c1, c2].forEach((c) => {
            c.alignment = { horizontal: 'center' };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
            c.border = thinBorder();
          });
        });
      }

      // widths
      const widths = [6, 12, 20, 16];
      if (opts.includeFather) widths.push(14);
      if (withSpecCol) widths.push(11);
      if (withSecCol) widths.push(12);
      if (withPerCol) widths.push(12);
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      for (let i = 0; i < nSubj; i++) ws.getColumn(nFixed + i + 1).width = 13;
      let col = nFixed + nSubj + 1;
      ws.getColumn(col++).width = 8;
      if (opts.includePercent) ws.getColumn(col++).width = 10;
      ws.getColumn(col++).width = 26;
      ['lastName', 'firstName'].forEach((k, i) => {
        const max = sheet.rows.reduce((m, r2) => Math.max(m, String(r2.student[k] || '').length), 0);
        ws.getColumn(3 + i).width = Math.min(34, Math.max(widths[2 + i], max + 3));
      });
      ws.views = [{ state: 'frozen', xSplit: 4, ySplit: headerRowIdx, showGridLines: false }];
      ws.pageSetup.printTitlesRow = headerRowIdx + ':' + headerRowIdx;

      const counts = { pass: 0, fail: 0, incomplete: 0, none: 0 };
      sheet.rows.forEach((r2) => counts[r2.result.status]++);
      const avgs = sheet.rows.map((r2) => r2.result.avg).filter((v) => v !== null);
      summaryRows.push([
        classTitle || lvlTitle + (per ? ' – ' + C.periodName(per) : noPer ? ' (χωρίς περίοδο)' : ''),
        specLabel,
        sheet.rows.length,
        nSubj,
        counts.pass,
        counts.fail,
        counts.incomplete,
        avgs.length ? C.round(avgs.reduce((a, b) => a + b, 0) / avgs.length, 2) : null,
      ]);
    });

    // summary sheet
    const sh = ['Επίπεδο / Τμήμα', 'Ειδικότητα', 'Σπουδαστές', 'Μαθήματα', 'Επιτυχία', 'Υπολείπονται', 'Εκκρεμούν βαθμοί', 'Μ.Ο.'];
    let r = titleBlock(summaryWs, sh.length, [
      'GMC Maritime Academy',
      'Συνολική Βαθμολογία — Ακαδημαϊκό Έτος ' + year,
      'Σύνοψη   ·   Ημερομηνία εξαγωγής: ' + todayStr(),
    ]);
    const hr = summaryWs.getRow(r);
    sh.forEach((h, i) => (hr.getCell(i + 1).value = h));
    styleHeaderRow(hr, 1, sh.length);
    hr.height = 22;
    summaryRows.forEach((vals, i) => {
      const xr = summaryWs.getRow(r + 1 + i);
      vals.forEach((v, j) => {
        const c = xr.getCell(j + 1);
        c.value = v;
        c.border = thinBorder();
        if (j >= 2) c.alignment = { horizontal: 'center' };
        if (j === 7 && v !== null) c.numFmt = '0.00';
      });
    });
    if (!summaryRows.length) {
      summaryWs.getRow(r + 1).getCell(1).value = 'Δεν βρέθηκαν εγγεγραμμένοι σπουδαστές για την επιλογή.';
    }
    [46, 16, 12, 11, 11, 13, 17, 9].forEach((w, i) => (summaryWs.getColumn(i + 1).width = w));

    return { wb, sheetsWritten, studentsWritten };
  }

  // ------------------------------------------------------------ per-subject export (Α.Μ. + βαθμός only)
  /**
   * One sheet per class (τμήμα + period); only registry number and grade (the final grade: re-exam when
   * present, with a cell note) — no names unless opts.includeNames — plus the sheet «Re-exam» with the
   * students who failed (reason, original grade, re-exam grade).
   * opts: { subject, yearId, section?: 'ALL' | class key (from subjectRosterByClass) | section id, includeNames? }
   */
  function buildSubjectExport(db, opts) {
    const subject = opts.subject;
    const yearId = opts.yearId;
    const names = !!opts.includeNames;
    let groups = C.subjectRosterByClass(db, subject, yearId);
    if (opts.section && opts.section !== 'ALL') groups = groups.filter((g) => g.key === opts.section || g.section === opts.section);
    const wb = newWorkbook();
    const used = new Set([REEXAM_SHEET.toLowerCase()]); // that name is kept for the re-exam sheet
    let count = 0;
    let graded = 0;
    const heads = ['Α/Α', 'Α.Μ.'].concat(names ? ['Επώνυμο', 'Όνομα'] : []).concat(['Βαθμός']);
    const nCol = heads.length;
    groups.forEach((g) => {
      const ws = wb.addWorksheet(safeSheetName(g.short, used), {
        views: [{ showGridLines: false }],
        pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      });
      // title spans 6 columns so long class names are not clipped; the table itself uses A–C
      const r = titleBlock(ws, Math.max(6, nCol), [
        'GMC Maritime Academy',
        'Βαθμολογία μαθήματος: ' + C.subjectLabel(subject),
        'Τμήμα: ' + g.name + '   ·   Ακαδημαϊκό Έτος ' + C.yearLabel(db, yearId),
        'Κλίμακα 0–5 (βάση 1 = 50%)   ·   ' + CODES_LINE + '   ·   Ημερομηνία: ' + todayStr(),
      ]);
      const hr = ws.getRow(r);
      heads.forEach((h, i) => (hr.getCell(i + 1).value = h));
      styleHeaderRow(hr, 1, nCol);
      hr.height = 22;
      let carriedHere = false;
      let reHere = false;
      g.rows.forEach((x, i) => {
        count++;
        const row = ws.getRow(r + 1 + i);
        row.getCell(1).value = i + 1;
        row.getCell(2).value = amValue(x.student.am);
        if (names) {
          row.getCell(3).value = x.student.lastName || '';
          row.getCell(4).value = x.student.firstName || '';
        }
        const c = row.getCell(nCol);
        if (x.grade) {
          graded++;
          const w = putFinalGrade(c, x.grade, x.carried ? ['Βαθμός από το ακαδημαϊκό έτος ' + C.yearLabel(db, x.grade.yearId)] : null);
          c.font = { bold: true, color: { argb: isFailing(w.final) ? RED : 'FF142031' } };
          if (x.carried) {
            c.font = { bold: true, italic: true, color: { argb: CARRY } };
            carriedHere = true;
          }
          reHere = reHere || w.re;
        }
        for (let k = 1; k <= nCol; k++) {
          const cell = row.getCell(k);
          cell.border = thinBorder();
          cell.alignment = { horizontal: names && (k === 3 || k === 4) ? 'left' : 'center', vertical: 'middle' };
          if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
      let fn = r + g.rows.length + 2;
      if (carriedHere) footNote(ws, fn++, 'Με μπλε πλάγια: βαθμός από προηγούμενο ακαδημαϊκό έτος.', CARRY);
      if (reHere) footNote(ws, fn++, 'Βαθμός re-exam: ο αρχικός βαθμός φαίνεται στη σημείωση του κελιού και στο φύλλο «Re-exam».');
      (names ? [8, 14, 22, 18, 12, 16] : [8, 16, 12, 16, 16, 16]).forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
      ws.pageSetup.printTitlesRow = r + ':' + r;
    });
    // «Re-exam»: failed students of the classes above (enrolled in the level), in class order then Α.Μ.
    const groupOf = new Map();
    groups.forEach((g, gi) => g.rows.forEach((x) => groupOf.set(x.student.id, { g, gi })));
    const re = C.reexamCandidates(db, subject, yearId)
      .filter((x) => groupOf.has(x.student.id))
      .map((x, i) => ({ student: x.student, grade: x.grade, className: groupOf.get(x.student.id).g.name, gi: groupOf.get(x.student.id).gi, i }))
      .sort((a, b) => a.gi - b.gi || a.i - b.i);
    writeReexamSheet(wb, db, re, { subject, yearId, includeNames: names, className: groups.length === 1 ? groups[0].name : null });
    return {
      wb,
      count,
      graded,
      missing: count - graded,
      reexam: re.length,
      classes: groups.map((g) => ({ key: g.key, name: g.name, count: g.rows.length, complete: g.complete })),
    };
  }

  function subjectExportFileName(db, subject, yearId) {
    return fileSafe('Βαθμολογία_' + (subject.code || subject.name) + '_' + C.yearLabel(db, yearId)) + '.xlsx';
  }

  // ------------------------------------------------------------ registry export
  function buildRegistryExport(db, opts) {
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Μητρώο', { views: [{ showGridLines: false }] });
    const years = C.sortYears(db.years).reverse();
    const scopeYear = opts.yearId ? C.yearLabel(db, opts.yearId) : null;
    let students = opts.yearId ? C.enrolledStudents(db, opts.yearId, null, 'ALL') : C.sortStudents(db.students);
    const headers = ['Α/Α', 'Α.Μ.', 'Επώνυμο', 'Όνομα', 'Πατρώνυμο', 'Ειδικότητα'];
    years.forEach((y) => headers.push('Τμήμα ' + y.label));
    headers.push('Email', 'Τηλέφωνο', 'Ημ. καταχώρισης');
    let r = titleBlock(ws, headers.length, [
      'GMC Maritime Academy',
      'Μητρώο Σπουδαστών' + (scopeYear ? ' — Ακαδημαϊκό Έτος ' + scopeYear : ' — Πλήρες μητρώο'),
      'Σύνολο σπουδαστών: ' + students.length + '   ·   Ημερομηνία εξαγωγής: ' + todayStr(),
    ]);
    const hr = ws.getRow(r);
    headers.forEach((h, i) => (hr.getCell(i + 1).value = h));
    styleHeaderRow(hr, 1, headers.length);
    hr.height = 30;
    students.forEach((s, i) => {
      const xr = ws.getRow(r + 1 + i);
      const vals = [i + 1, amValue(s.am), s.lastName, s.firstName, s.fatherName || '', C.specialtyName(s.specialty)];
      years.forEach((y) => {
        const e = C.getEnrollment(db, s.id, y.id);
        const cls = e ? C.studentClass(db, s, y.id, e) : null;
        vals.push(cls ? cls.name : '');
      });
      const d = s.createdAt ? new Date(s.createdAt) : null;
      vals.push(s.email || '', s.phone || '', d);
      vals.forEach((v, j) => {
        const c = xr.getCell(j + 1);
        c.value = v;
        c.border = thinBorder();
        if (v instanceof Date) c.numFmt = 'dd/mm/yyyy';
      });
      xr.getCell(1).alignment = { horizontal: 'center' };
      xr.getCell(2).alignment = { horizontal: 'left' };
      xr.getCell(2).font = { bold: true };
    });
    const widths = [6, 12, 22, 18, 16, 11];
    years.forEach(() => widths.push(34));
    widths.push(28, 16, 15);
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', xSplit: 4, ySplit: r, showGridLines: false }];
    ws.autoFilter = { from: { row: r, column: 1 }, to: { row: r + students.length, column: headers.length } };
    return { wb, count: students.length };
  }

  // ------------------------------------------------------------ teacher template
  /** Values accepted in the «Βαθμός» column of a teacher's sheet (list validation). */
  const GRADE_CHOICES = ['0', '1', '2', '3', '4', '5', 'ΑΠ', C.ATT_TEXT.J, C.ATT_TEXT.U];

  /**
   * AM list for a teacher (column «Βαθμός» to fill in: 0–5, ΑΠ, 0Δ, 0Α) + «Οδηγίες» + «Re-exam» (his failed students).
   * opts: { subject, students, yearId, className?, includeNames?, prefill? (the original grades) }
   */
  function buildTeacherTemplate(db, opts) {
    const wb = newWorkbook();
    const subject = opts.subject;
    const ws = wb.addWorksheet('Βαθμολογίες');
    const students = opts.students;
    const cols = [{ header: 'Α.Μ.', key: 'am', width: 14 }];
    if (opts.includeNames) {
      cols.push({ header: 'Επώνυμο', key: 'ln', width: 22 }, { header: 'Όνομα', key: 'fn', width: 18 });
    }
    cols.push({ header: 'Βαθμός', key: 'g', width: 12 });
    ws.columns = cols;
    styleHeaderRow(ws.getRow(1), 1, cols.length);
    ws.getRow(1).height = 22;
    students.forEach((s) => {
      const row = { am: amValue(s.am) };
      if (opts.includeNames) {
        row.ln = s.lastName;
        row.fn = s.firstName;
      }
      if (opts.prefill) {
        // the teacher's (original) grade — the re-exam grade is the secretariat's, see the «Re-exam» sheet
        const g = C.getGrade(db, s.id, subject.id, opts.yearId);
        const v = gradeValue(g);
        if (v !== null) row.g = v;
      }
      ws.addRow(row);
    });
    const gCol = cols.length;
    const letter = C.columnLetter(gCol - 1);
    for (let i = 2; i <= students.length + 1; i++) {
      const cell = ws.getCell(letter + i);
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"' + GRADE_CHOICES.join(',') + '"'],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Μη έγκυρος βαθμός',
        error: 'Δεκτές τιμές: 0, 1, 2, 3, 4, 5 (ακέραιοι), ΑΠ (απών), 0Δ (0 λόγω δικαιολογημένων απουσιών) ή 0Α (0 λόγω αδικαιολόγητων απουσιών).',
        showInputMessage: true,
        promptTitle: 'Βαθμός',
        prompt: '0–5, ΑΠ, 0Δ ή 0Α',
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEA' } };
      cell.alignment = { horizontal: 'center' };
      if (typeof cell.value === 'number') cell.numFmt = '0';
      else if (cell.value) cell.font = { bold: true, color: { argb: RED } };
      for (let c = 1; c <= cols.length; c++) ws.getRow(i).getCell(c).border = thinBorder();
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const info = wb.addWorksheet('Οδηγίες', { views: [{ showGridLines: false }] });
    let r = titleBlock(info, 4, [
      'GMC Maritime Academy',
      'Βαθμολόγιο μαθήματος',
      'Ακαδημαϊκό Έτος ' + C.yearLabel(db, opts.yearId) + '   ·   ' + C.levelName(db, subject.levelId, subject.specialty !== 'COMMON' ? subject.specialty : null),
    ]);
    const lines = [
      ['Μάθημα', C.subjectLabel(subject)],
      ['Τμήμα', opts.className || 'Όλα τα τμήματα'],
      ['Σπουδαστές', String(students.length)],
      ['', ''],
      ['Οδηγίες', 'Συμπληρώστε τη στήλη «Βαθμός» στο φύλλο «Βαθμολογίες» για κάθε αριθμό μητρώου (Α.Μ.).'],
      ['', 'Κλίμακα 0–5, μόνο ακέραιοι (όχι 3,5): 0 = κάτω από 50%, 1 = 50%, 2 = 60%, 3 = 70%, 4 = 80%, 5 = 90% και άνω.'],
      ['Κωδικοί', 'ΑΠ = απών από την εξέταση.'],
      ['', '0Δ = 0 λόγω δικαιολογημένων απουσιών   ·   0Α = 0 λόγω αδικαιολόγητων απουσιών.'],
      ['', 'Μην αλλάζετε τη στήλη Α.Μ.'],
      ['Re-exam', 'Το φύλλο «Re-exam» δείχνει όσους δεν πέρασαν (ΑΠ, 0, 0Δ, 0Α) — είναι μόνο για ενημέρωση και δεν εισάγεται. Τον βαθμό της επαναληπτικής τον καταχωρίζει η γραμματεία.'],
    ];
    lines.forEach((l, i) => {
      const row = info.getRow(r + i);
      row.getCell(1).value = l[0];
      row.getCell(2).value = l[1];
      row.getCell(1).font = { bold: true, color: { argb: 'FF3D4A5C' } };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });
    info.getColumn(1).width = 16;
    info.getColumn(2).width = 90;

    // «Re-exam»: his students whose (original) grade fails
    const re = [];
    students.forEach((s) => {
      const g = C.getGrade(db, s.id, subject.id, opts.yearId);
      if (!C.needsReexam(g)) return;
      const cls = C.studentClass(db, s, opts.yearId);
      re.push({ student: s, grade: g, className: cls ? cls.name : opts.className || '' });
    });
    writeReexamSheet(wb, db, re, { subject, yearId: opts.yearId, includeNames: !!opts.includeNames, className: opts.className || null });
    return { wb, reexam: re.length };
  }

  // ------------------------------------------------------------ student import template
  function buildStudentTemplate(db) {
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Σπουδαστές');
    ws.columns = [
      { header: 'Α.Μ.', key: 'am', width: 14 },
      { header: 'Επώνυμο', key: 'ln', width: 22 },
      { header: 'Όνομα', key: 'fn', width: 18 },
      { header: 'Πατρώνυμο', key: 'fa', width: 16 },
      { header: 'Ειδικότητα', key: 'sp', width: 14 },
      { header: 'Επίπεδο', key: 'lv', width: 40 },
      { header: 'Τμήμα', key: 'tm', width: 14 },
      { header: 'Περίοδος', key: 'pe', width: 14 },
      { header: 'Email', key: 'em', width: 28 },
      { header: 'Τηλέφωνο', key: 'ph', width: 16 },
    ];
    styleHeaderRow(ws.getRow(1), 1, 10);
    ws.getRow(1).height = 22;
    const periods = (db && db.settings && Array.isArray(db.settings.periods) && db.settings.periods.length ? db.settings.periods : C.periodList()).map((p) => p.name);
    const oct = (C.levelPeriods(db, 'SUP')[0] || {}).name || periods[0] || 'Οκτώβριος';
    ws.addRow({ am: '1001', ln: 'ΠΑΠΑΔΟΠΟΥΛΟΣ', fn: 'ΓΕΩΡΓΙΟΣ', fa: 'ΝΙΚΟΛΑΟΣ', sp: 'Deck', lv: C.levelName(db, 'SUP'), tm: 'Morning 1', pe: oct });
    ws.getRow(2).font = { italic: true, color: { argb: GRAY } };
    const levels = C.levelVariants().map((v) => C.levelName(db, v.levelId, v.spec));
    const perList = periods.join(',').replace(/"/g, '');
    for (let i = 2; i <= 400; i++) {
      ws.getCell('E' + i).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Deck,Engine"'] };
      const list = levels.join(',').replace(/"/g, '');
      if (list.length <= 250) ws.getCell('F' + i).dataValidation = { type: 'list', allowBlank: true, formulae: ['"' + list + '"'] };
      ws.getCell('G' + i).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Morning 1,Morning 2,Morning,Afternoon"'] };
      // a month (e.g. «Οκτώβριος», «Ιαν», 10/2026) is also understood on import, so no strict list
      if (perList && perList.length <= 250) ws.getCell('H' + i).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: ['"' + perList + '"'] };
      ws.getCell('A' + i).numFmt = '@';
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return { wb };
  }

  // ------------------------------------------------------------ student transcript (transposed: subjects as columns)
  function yearsText(db, years) {
    return (years.length > 1 ? 'Ακαδημαϊκά έτη ' : 'Ακαδημαϊκό έτος ') + years.map((id) => C.yearLabel(db, id)).join(', ');
  }

  function subjectHeader(sj) {
    return (sj.code ? sj.code + '\n' : '') + sj.name;
  }

  /**
   * One student's detailed grades. For every level he attended: a header row with the subjects
   * as COLUMNS, then his row (Α.Μ., ονοματεπώνυμο, βαθμοί, Μ.Ο., αποτέλεσμα). The academic year(s)
   * come from his own history (e.g. Support in 2023-2024), whatever year is open in the app.
   * opts: { levelIds: ['SUP', …] } (default: every level he attended, chronologically)
   */
  function writeTranscriptSheet(ws, db, student, opts) {
    const o = opts || {};
    const levelIds = (o.levelIds && o.levelIds.length ? o.levelIds : C.studentLevels(db, student)).slice();
    const records = levelIds.map((l) => C.studentLevelRecord(db, student, l)).filter((rec) => rec.years.length);
    records.sort((a, b) => C.yearStart(db, a.years[0]) - C.yearStart(db, b.years[0]) || C.LEVEL_IDS.indexOf(a.levelId) - C.LEVEL_IDS.indexOf(b.levelId));
    const widest = records.reduce((m, rec) => Math.max(m, rec.subjects.length), 0);
    const lastCol = Math.max(6, 2 + widest + 2);
    const one = records.length === 1 ? records[0] : null;
    let r = titleBlock(ws, lastCol, [
      'GMC Maritime Academy',
      'Αναλυτική Βαθμολογία Σπουδαστή' + (one ? ' — ' + (one.years.length > 1 || C.isShiftLevel(one.levelId) ? C.levelName(db, one.levelId, one.spec) : one.className) : ''),
      (one ? yearsText(db, one.years) + '   ·   ' : '') + 'Ημερομηνία εξαγωγής: ' + todayStr(),
    ]);
    const info = [
      ['Α.Μ.', amValue(student.am)],
      ['Ονοματεπώνυμο', C.studentName(student)],
    ];
    if (student.fatherName) info.push(['Πατρώνυμο', student.fatherName]);
    if (C.hasSpec(student.specialty)) info.push(['Ειδικότητα', C.specialtyName(student.specialty)]);
    info.forEach((kv) => {
      const row = ws.getRow(r++);
      row.getCell(1).value = kv[0];
      row.getCell(2).value = kv[1];
      row.getCell(1).font = { bold: true, color: { argb: 'FF5A6678' } };
      row.getCell(2).font = { bold: true, size: kv[0] === 'Ονοματεπώνυμο' ? 12 : 11 };
      row.getCell(2).alignment = { horizontal: 'left' };
      ws.mergeCells(row.number, 2, row.number, Math.min(lastCol, 6));
    });
    r++;
    let carriedAny = false;
    let reAny = false;
    let codeAny = false;
    records.forEach((rec) => {
      const n = rec.subjects.length;
      const multi = rec.years.length > 1;
      // level header: class + academic year(s) taken from the student's own history
      const hdr = ws.getRow(r++);
      const title = multi || C.isShiftLevel(rec.levelId) ? C.levelName(db, rec.levelId, rec.spec) : rec.className;
      hdr.getCell(1).value = title + '   ·   ' + yearsText(db, rec.years);
      ws.mergeCells(hdr.number, 1, hdr.number, lastCol);
      hdr.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY } };
      hdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
      hdr.height = 20;
      const details = rec.perYear
        .map((y) => {
          if (!y.enrolled) return multi ? C.yearLabel(db, y.yearId) + ': βαθμοί χωρίς εγγραφή' : '';
          const cls = multi || C.isShiftLevel(rec.levelId) ? y.className : '';
          const txt = (multi ? C.yearLabel(db, y.yearId) + ': ' : '') + cls;
          return (txt + (y.withdrawn ? (txt ? ' (διέκοψε τη φοίτηση)' : 'Διέκοψε τη φοίτηση') : '')).trim();
        })
        .filter(Boolean);
      if (details.length) {
        const dr = ws.getRow(r++);
        dr.getCell(1).value = details.join('   ·   ');
        dr.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF5A6678' } };
        ws.mergeCells(dr.number, 1, dr.number, lastCol);
      }
      // column headers: Α.Μ. | Ονοματεπώνυμο | subject… | Μ.Ο. | Αποτέλεσμα
      const th = ws.getRow(r++);
      const heads = ['Α.Μ.', 'Ονοματεπώνυμο'].concat(rec.subjects.map((x) => subjectHeader(x.subject))).concat(['Μ.Ο.', 'Αποτέλεσμα']);
      heads.forEach((h, i) => (th.getCell(i + 1).value = h));
      styleHeaderRow(th, 1, heads.length);
      const longest = rec.subjects.reduce((m, x) => Math.max(m, String(x.subject.name).length), 0);
      th.height = Math.min(90, Math.max(32, 15 * Math.ceil(longest / 14) + (rec.subjects.some((x) => x.subject.code) ? 14 : 0)));
      // the student's row
      const row = ws.getRow(r++);
      row.getCell(1).value = amValue(student.am);
      row.getCell(2).value = C.studentName(student);
      row.getCell(2).font = { bold: true };
      rec.subjects.forEach((x, i) => {
        const cell = row.getCell(3 + i);
        const g = x.grade;
        if (g) {
          // the grade that counts: the re-exam grade when there is one (note: the original)
          const w = putFinalGrade(cell, g, x.carried ? ['Βαθμός του ακαδημαϊκού έτους ' + C.yearLabel(db, g.yearId)] : null);
          cell.font = { bold: true, color: { argb: isFailing(w.final) ? RED : x.carried ? CARRY : 'FF142031' }, italic: x.carried };
          if (x.carried) carriedAny = true;
          reAny = reAny || w.re;
          codeAny = codeAny || w.code;
        } else {
          cell.value = '';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F7F9' } };
          if (x.earlier) cell.note = 'Εκκρεμεί — ' + C.yearLabel(db, x.earlier.yearId) + ': ' + C.finalText(x.earlier) + (x.earlier.re ? ' (re-exam · αρχικός ' + C.gradeText(x.earlier) + ')' : '');
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      const avgCell = row.getCell(3 + n);
      const resCell = row.getCell(4 + n);
      if (rec.result) {
        avgCell.value = rec.result.avg;
        avgCell.numFmt = '0.00';
        avgCell.font = { bold: true };
        resCell.value = rec.withdrawn ? 'Διέκοψε τη φοίτηση' : C.resultLabel(rec.result);
        resCell.font = rec.withdrawn ? { italic: true, color: { argb: 'FF7A5B12' } } : { bold: true, color: { argb: rec.result.status === 'pass' ? GREEN : rec.result.status === 'fail' ? RED : 'FF8A5A10' } };
      }
      avgCell.alignment = { horizontal: 'center', vertical: 'middle' };
      resCell.alignment = { vertical: 'middle', wrapText: true };
      row.height = 22;
      for (let c = 1; c <= heads.length; c++) {
        row.getCell(c).border = thinBorder();
        if (!row.getCell(c).alignment) row.getCell(c).alignment = { vertical: 'middle' };
      }
      if (heads.length < lastCol) {
        // narrower block: the «Αποτέλεσμα» column stretches to the right edge
        ws.mergeCells(th.number, heads.length, th.number, lastCol);
        ws.mergeCells(row.number, heads.length, row.number, lastCol);
      }
      // returning student: in which academic year each grade was obtained
      if (multi) {
        const yr = ws.getRow(r++);
        yr.getCell(2).value = 'Ακαδ. έτος βαθμού';
        yr.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF5A6678' } };
        yr.getCell(2).alignment = { horizontal: 'right' };
        rec.subjects.forEach((x, i) => {
          const cell = yr.getCell(3 + i);
          cell.value = x.grade ? C.yearLabel(db, x.grade.yearId) : x.earlier ? 'εκκρεμεί' : '';
          cell.font = { italic: true, size: 9, color: { argb: x.carried ? CARRY : 'FF5A6678' } };
          cell.alignment = { horizontal: 'center' };
        });
      }
      if (!n) {
        const e = ws.getRow(r++);
        e.getCell(2).value = 'Δεν έχουν οριστεί μαθήματα για αυτό το επίπεδο.';
        e.getCell(2).font = { italic: true, color: { argb: GRAY } };
      }
      r++;
    });
    if (!records.length) {
      ws.getRow(r).getCell(1).value = 'Δεν υπάρχουν εγγραφές ή βαθμοί για τον σπουδαστή.';
      ws.getRow(r).getCell(1).font = { italic: true, color: { argb: GRAY } };
      r++;
    }
    if (carriedAny) {
      const nr = ws.getRow(r++);
      nr.getCell(1).value = 'Με μπλε πλάγια: βαθμός που πάρθηκε σε προηγούμενο ακαδημαϊκό έτος και μεταφέρθηκε (δείτε το σχόλιο του κελιού).';
      nr.getCell(1).font = { italic: true, size: 9, color: { argb: CARRY } };
      ws.mergeCells(nr.number, 1, nr.number, lastCol);
    }
    [reAny ? REEXAM_FOOT : null, codeAny ? CODES_LINE : null].filter(Boolean).forEach((t) => {
      const nr = ws.getRow(r++);
      nr.getCell(1).value = t;
      nr.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF5A6678' } };
      ws.mergeCells(nr.number, 1, nr.number, lastCol);
    });
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 30;
    for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 13;
    ws.getColumn(lastCol).width = Math.max(ws.getColumn(lastCol).width || 13, 13);
    // Μ.Ο. / Αποτέλεσμα columns of the widest block
    ws.getColumn(3 + widest).width = 9;
    ws.getColumn(4 + widest).width = 24;
    return { records };
  }

  function transcriptSheetOptions() {
    return {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    };
  }

  /** One student's transcript workbook. opts: { levelIds } */
  function buildTranscript(db, student, opts) {
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Αναλυτική', transcriptSheetOptions());
    const res = writeTranscriptSheet(ws, db, student, opts);
    return { wb, records: res.records };
  }

  /** e.g. Αναλυτική_26003_Παπαδόπουλος_Γιώργος_Support_2023-2024.xlsx (Support Οκτ… when the level has periods) */
  function transcriptFileName(db, student, levelIds) {
    let tail = '';
    if (levelIds && levelIds.length === 1) {
      const rec = C.studentLevelRecord(db, student, levelIds[0]);
      tail = '_' + C.classShortName(levelIds[0], rec.spec, null, C.classPeriod(db, levelIds[0], rec.period)) + (rec.years.length ? '_' + rec.years.map((id) => C.yearLabel(db, id)).join('_') : '');
    }
    return fileSafe('Αναλυτική_' + student.am + '_' + C.studentName(student) + tail) + '.xlsx';
  }

  // ------------------------------------------------------------ accounts & exams
  /** Login details to hand out. rows: [{am, name, className, username, password}] */
  function buildCredentials(rows, opts) {
    const o = opts || {};
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Κωδικοί', { views: [{ showGridLines: false }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    let r = titleBlock(ws, 6, [
      'GMC Maritime Academy',
      'Κωδικοί σύνδεσης σπουδαστών (Εξετάσεις)' + (o.title ? ' — ' + o.title : ''),
      'Διακομιστής: ' + (o.server || '') + '   ·   Ημερομηνία: ' + todayStr() + '   ·   Εμπιστευτικό — να δοθεί προσωπικά σε κάθε σπουδαστή',
    ]);
    const hdr = ws.getRow(r);
    ['Α/Α', 'Α.Μ.', 'Ονοματεπώνυμο', 'Τμήμα', 'Όνομα χρήστη', 'Κωδικός'].forEach((h, i) => (hdr.getCell(i + 1).value = h));
    styleHeaderRow(hdr, 1, 6);
    hdr.height = 22;
    rows.forEach((x, i) => {
      const row = ws.getRow(r + 1 + i);
      [i + 1, amValue(x.am), x.name || '', x.className || '', x.username || x.am, x.password || ''].forEach((v, j) => {
        const c = row.getCell(j + 1);
        c.value = v;
        c.border = thinBorder();
        c.alignment = { vertical: 'middle' };
      });
      row.getCell(6).font = { name: 'Consolas', size: 13, bold: true };
      row.getCell(5).font = { name: 'Consolas', size: 12 };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.height = 24;
    });
    [6, 12, 32, 30, 16, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
    return { wb };
  }

  const STATE_LABEL = { submitted: 'Υποβλήθηκε', in_progress: 'Σε εξέλιξη', not_started: 'Δεν ξεκίνησε', missed: 'Δεν συμμετείχε' };

  /** Results of one exam (intermediate test): names, marks, % and 0–5 grade + per-question analysis. */
  function buildExamResults(res) {
    const EC = root.ExamCore;
    const e = res.exam;
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Αποτελέσματα', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    const d = new Date(e.startsAt);
    const p2 = (n) => String(n).padStart(2, '0');
    let r = titleBlock(ws, 9, [
      'GMC Maritime Academy',
      'Αποτελέσματα εξέτασης: ' + e.title,
      (e.subjectName ? e.subjectName + '   ·   ' : '') + p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + '   ·   ' + e.durationMinutes + ' λεπτά   ·   ' + e.questionCount + ' ερωτήσεις   ·   Μετράει στην τελική βαθμολογία: ' + (e.countsFinal ? 'ΝΑΙ' : 'ΟΧΙ') + ' (απόφαση καθηγητή)',
    ]);
    const hdr = ws.getRow(r);
    ['Α/Α', 'Α.Μ.', 'Ονοματεπώνυμο', 'Τμήμα', 'Κατάσταση', 'Μονάδες', 'Ποσοστό', 'Βαθμός (0–5)', 'Υποβολή'].forEach((h, i) => (hdr.getCell(i + 1).value = h));
    styleHeaderRow(hdr, 1, 9);
    hdr.height = 22;
    const rows = res.rows.slice().sort((a, b) => String(a.className || '').localeCompare(String(b.className || ''), 'el') || String(a.name || '').localeCompare(String(b.name || ''), 'el'));
    rows.forEach((x, i) => {
      const row = ws.getRow(r + 1 + i);
      const done = x.status === 'submitted' || x.status === 'in_progress';
      const sub = x.submittedAt ? new Date(x.submittedAt) : null;
      [
        i + 1,
        amValue(x.am),
        x.name || '',
        x.className || '',
        (STATE_LABEL[x.status] || x.status) + (x.autoSubmitted ? ' (αυτόματα στη λήξη)' : ''),
        done ? x.score + ' / ' + x.max : '',
        done ? x.percent / 100 : null,
        done ? x.grade : null,
        sub ? p2(sub.getDate()) + '/' + p2(sub.getMonth() + 1) + ' ' + p2(sub.getHours()) + ':' + p2(sub.getMinutes()) : '',
      ].forEach((v, j) => {
        const c = row.getCell(j + 1);
        c.value = v;
        c.border = thinBorder();
      });
      row.getCell(7).numFmt = '0%';
      [2, 6, 7, 8].forEach((c) => (row.getCell(c).alignment = { horizontal: 'center' }));
      if (done) row.getCell(8).font = { bold: true, color: { argb: x.grade < 1 ? RED : 'FF142031' } };
      if (!done) row.getCell(5).font = { italic: true, color: { argb: GRAY } };
    });
    const graded = rows.filter((x) => x.status === 'submitted');
    const sr = r + rows.length + 2;
    ws.getRow(sr).getCell(3).value = 'Υποβλήθηκαν ' + graded.length + ' από ' + rows.length;
    if (graded.length) {
      ws.getRow(sr).getCell(6).value = 'Μ.Ο.';
      ws.getRow(sr).getCell(7).value = graded.reduce((a, x) => a + x.percent, 0) / graded.length / 100;
      ws.getRow(sr).getCell(7).numFmt = '0%';
      ws.getRow(sr).getCell(8).value = Math.round((graded.reduce((a, x) => a + x.grade, 0) / graded.length) * 100) / 100;
      ws.getRow(sr).getCell(8).numFmt = '0.00';
    }
    ws.getRow(sr).font = { bold: true };
    const nr = ws.getRow(sr + 2);
    nr.getCell(1).value = 'Ενδιάμεσο τεστ: ο βαθμός δεν περνά αυτόματα στο βαθμολόγιο. Ο τελικός βαθμός του μαθήματος εισάγεται μόνο από τον καθηγητή.';
    nr.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF5A6678' } };
    ws.mergeCells(nr.number, 1, nr.number, 9);
    [6, 12, 30, 28, 26, 11, 10, 12, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];

    // per-question analysis
    const qa = wb.addWorksheet('Ανάλυση ερωτήσεων', { views: [{ showGridLines: false }] });
    let q = titleBlock(qa, 6, ['GMC Maritime Academy', 'Ανάλυση ερωτήσεων: ' + e.title, 'Ποσοστό σωστών απαντήσεων ανά ερώτηση (όσοι υπέβαλαν)']);
    const qh = qa.getRow(q);
    ['Α/Α', 'Ερώτηση', 'Τύπος', 'Σωστή απάντηση', 'Σωστές', 'Ποσοστό'].forEach((h, i) => (qh.getCell(i + 1).value = h));
    styleHeaderRow(qh, 1, 6);
    (res.questions || []).forEach((qq, i) => {
      const row = qa.getRow(q + 1 + i);
      const answered = graded.filter((x) => x.perQuestion);
      const ok = answered.filter((x) => x.perQuestion[i] === 1).length;
      [i + 1, qq.text, EC ? EC.TYPES[qq.type] : qq.type, EC ? EC.correctText(qq) : '', ok + ' / ' + answered.length, answered.length ? ok / answered.length : null].forEach((v, j) => {
        const c = row.getCell(j + 1);
        c.value = v;
        c.border = thinBorder();
        c.alignment = { vertical: 'top', wrapText: j === 1 || j === 3 };
      });
      row.getCell(6).numFmt = '0%';
    });
    [6, 60, 26, 24, 10, 10].forEach((w, i) => (qa.getColumn(i + 1).width = w));
    return { wb };
  }

  /** Empty questions template for Excel import. */
  function buildQuestionTemplate() {
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Ερωτήσεις');
    const heads = ['Ερώτηση', 'Τύπος', 'Α', 'Β', 'Γ', 'Δ', 'Σωστή', 'Μονάδες'];
    const hdr = ws.getRow(1);
    heads.forEach((h, i) => (hdr.getCell(i + 1).value = h));
    styleHeaderRow(hdr, 1, heads.length);
    hdr.height = 22;
    const ex = [
      ['Ποια είναι η μονάδα μέτρησης της ταχύτητας ενός πλοίου;', 'Μία σωστή', 'km/h', 'Κόμβοι (knots)', 'm/s', 'Μίλια', 'Β', 1],
      ['Ποια χρώματα έχουν οι πλευρικοί φανοί;', 'Πολλές σωστές', 'Κόκκινο', 'Πράσινο', 'Μπλε', 'Κίτρινο', 'Α, Β', 2],
      ['Η πυξίδα δείχνει τον μαγνητικό βορρά.', 'Σωστό / Λάθος', '', '', '', '', 'Σωστό', 1],
      ['Σε ποια γλώσσα γίνεται η επικοινωνία γέφυρας (SMCP);', 'Σύντομη απάντηση', '', '', '', '', 'Αγγλικά | English', 1],
    ];
    ex.forEach((v, i) => {
      const row = ws.getRow(2 + i);
      v.forEach((x, j) => (row.getCell(j + 1).value = x));
      row.font = { italic: true, color: { argb: 'FF5A6678' } };
    });
    [60, 18, 20, 20, 20, 20, 18, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const help = wb.addWorksheet('Οδηγίες');
    [
      'Συμπληρώστε μία ερώτηση ανά γραμμή στο φύλλο «Ερωτήσεις» (σβήστε τα παραδείγματα).',
      'Τύπος: «Μία σωστή», «Πολλές σωστές», «Σωστό / Λάθος» ή «Σύντομη απάντηση». Αν μείνει κενό, αναγνωρίζεται αυτόματα.',
      'Α–Δ: οι επιλογές (μπορείτε να προσθέσετε στήλες Ε, ΣΤ, Ζ, Η για περισσότερες).',
      'Σωστή: το γράμμα της σωστής επιλογής (π.χ. Β) ή τα γράμματα χωρισμένα με κόμμα (π.χ. Α, Γ) — ή «Σωστό» / «Λάθος».',
      'Σύντομη απάντηση: γράψτε τις αποδεκτές απαντήσεις χωρισμένες με | (δεν μετράνε κεφαλαία / τόνοι).',
      'Μονάδες: προαιρετικά (προεπιλογή 1). Ο βαθμός του τεστ υπολογίζεται στην κλίμακα 0–5 (50% = 1 … 90% = 5).',
    ].forEach((t, i) => (help.getRow(i + 1).getCell(1).value = (i + 1) + '. ' + t));
    help.getColumn(1).width = 120;
    return { wb };
  }

  root.XL = {
    readWorkbook,
    toBytes,
    fileSafe,
    gradeValue,
    gradeExportGroups,
    buildGradeExport,
    buildSubjectExport,
    subjectExportFileName,
    buildRegistryExport,
    buildTeacherTemplate,
    buildStudentTemplate,
    buildTranscript,
    transcriptFileName,
    buildCredentials,
    buildExamResults,
    buildQuestionTemplate,
  };
})(typeof self !== 'undefined' ? self : this);
