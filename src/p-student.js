/*
 * Student portal (always in English): the student sees ONLY his exams (schedule, taking, "submitted")
 * and the syllabus (PDF files) of his subjects.
 * No grades, no scores, no registry data ever reach this screen — the server does not send them.
 */
(function () {
  'use strict';
  const App = window.App;
  const { esc, icon, toast, openModal } = App.ui;
  const Remote = window.Remote;
  const EC = window.ExamCore;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  // view: 'list' (exams) | 'exam' (taking one) | 'done' (just submitted) | 'syllabus'
  const P = {
    view: 'list', list: [], x: null, answers: {}, cur: 0, dirty: false, saving: null, saveState: 'saved', timers: [], done: null, wired: false, loading: false,
    sy: null, syError: '', syLoading: false, opening: null,
  };

  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  /** "Mon 12 Oct 2026" */
  const dateLong = (t) => {
    const d = new Date(t);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };
  /** "12 Oct 2026" */
  const dateShort = (t) => {
    const d = new Date(t);
    return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };
  function until(ms) {
    const m = Math.ceil(ms / 60000);
    if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    const d = Math.round(h / 24);
    return d + (d === 1 ? ' day' : ' days');
  }
  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s % 60);
  }
  function fmtSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
    return (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0) + ' MB';
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function root() {
    return document.getElementById('student-root');
  }

  /** English confirmation dialog → true when confirmed. */
  function ask(title, message, okText) {
    return new Promise((resolve) => {
      let yes = false;
      openModal({
        title,
        size: 'sm',
        body: '<div style="font-size:13.5px;line-height:1.55">' + message + '</div>',
        buttons: [
          { label: 'Cancel' },
          {
            label: okText,
            cls: 'btn-primary',
            onClick: () => {
              yes = true;
            },
          },
        ],
        onMount: (ctx) => {
          const x = ctx.q('[data-mclose]');
          if (x) x.title = 'Close';
        },
        onClose: () => resolve(yes),
      });
    });
  }

  // ------------------------------------------------------------ top bar + tabs
  function tabsHtml() {
    if (P.view === 'exam') return ''; // no syllabus while taking an exam
    const on = P.view === 'syllabus' ? 'syllabus' : 'exams';
    const nOpen = P.list.filter((e) => (e.state === 'open' || e.state === 'in_progress') && !e.barred).length;
    return '<nav class="sp-tabs" id="sp-tabs">' +
      '<button class="sp-tab' + (on === 'exams' ? ' on' : '') + '" id="sp-tab-exams" data-sx="tab" data-tab="exams">' + icon('clipboard', 'width="16" height="16"') + 'Exams' + (nOpen ? '<span class="count" title="Available now">' + nOpen + '</span>' : '') + '</button>' +
      '<button class="sp-tab' + (on === 'syllabus' ? ' on' : '') + '" id="sp-tab-syllabus" data-sx="tab" data-tab="syllabus">' + icon('book', 'width="16" height="16"') + 'Syllabus</button></nav>';
  }

  function topBar() {
    const u = Remote.user || {};
    return '<div class="sp-top"><div class="sp-brand">' + icon('anchor', 'width="22" height="22"') + '<div>GMC Maritime Academy<small>Student portal</small></div></div>' + tabsHtml() + '<div class="spacer"></div>' +
      '<div class="sp-user"><b>' + esc(u.name || '') + '</b><br>Student ID ' + esc(u.am || u.username || '') + '</div>' +
      '<button class="btn btn-sm" data-sx="password" title="Change password">' + icon('key') + '</button>' +
      '<button class="btn btn-sm" data-sx="logout">' + icon('logout') + 'Sign out</button></div>';
  }

  function paintTabs() {
    const n = root().querySelector('#sp-tabs');
    if (n) n.outerHTML = tabsHtml();
  }

  // ------------------------------------------------------------ list of exams
  /** Too many absences in the exam's subject (and no permission from the Registrar's office): the exam cannot be started. */
  function barredHtml(e) {
    const n = Number(e.absences) || 0;
    return '<div class="ec-barred">' + icon('alert') + '<div><b>You are not allowed to take this exam because of your absences.</b><br>You have ' + plural(n, 'absence', 'absences') + ' in this subject' +
      (e.absenceLimit !== null && e.absenceLimit !== undefined ? ' and the limit is ' + e.absenceLimit : '') + '. Please contact the Registrar’s office.</div></div>';
  }

  function card(e) {
    const t = Remote.now();
    const d = new Date(e.startsAt);
    let side = '';
    let cls = '';
    if (e.barred) {
      cls = ' barred';
      side = '<span class="pill-state bad">' + icon('alert', 'width="13" height="13"') + 'Not eligible</span>' + (e.state === 'missed' ? '<div class="small muted" style="margin-top:6px">Ended</div>' : e.state === 'upcoming' ? '<div class="small muted" style="margin-top:6px">' + dateLong(e.startsAt) + ', ' + hm(e.startsAt) + '</div>' : '');
    } else if (e.state === 'open') {
      cls = ' open';
      side = '<button class="btn btn-primary btn-lg" data-sx="start" data-id="' + e.id + '">' + icon('play') + 'Start</button><div class="small muted" style="margin-top:6px">Entry until ' + hm(e.entryClosesAt) + '</div>';
    } else if (e.state === 'in_progress') {
      cls = ' open';
      const left = e.deadline - t;
      side = '<button class="btn btn-primary btn-lg" data-sx="resume" data-id="' + e.id + '">' + icon('play') + 'Continue</button><div class="small warning-text" style="margin-top:6px">' + (left > 0 ? until(left) + ' left' : 'Time is up') + '</div>';
    } else if (e.state === 'upcoming') {
      const wait = e.startsAt - t;
      side = '<span class="pill-state live">' + icon('clock', 'width="13" height="13"') + (wait > 0 ? 'Starts in ' + until(wait) : 'Starting…') + '</span>';
    } else if (e.state === 'submitted') {
      side = '<span class="pill-state ok">' + icon('check', 'width="13" height="13"') + 'Submitted</span>' + (e.submittedAt ? '<div class="small muted" style="margin-top:6px">' + dateLong(e.submittedAt) + ', ' + hm(e.submittedAt) + '</div>' : '');
    } else side = '<span class="pill-state bad">Ended — you did not take part</span>';
    return '<div class="exam-card' + cls + '" data-exam="' + e.id + '"><div class="ec-date"><div class="d">' + d.getDate() + '</div><div class="m">' + MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2) + '</div></div>' +
      '<div class="ec-main"><div class="ec-title">' + esc(e.title) + '</div>' +
      '<div class="ec-meta">' + (e.subjectName ? '<span>' + icon('book', 'width="13" height="13"') + esc(e.subjectName) + '</span>' : '') +
      '<span>' + icon('calendar', 'width="13" height="13"') + esc(dateLong(e.startsAt)) + ', ' + hm(e.startsAt) + '</span>' +
      '<span>' + icon('clock', 'width="13" height="13"') + plural(e.durationMinutes, 'minute', 'minutes') + '</span>' +
      '<span>' + icon('list', 'width="13" height="13"') + plural(e.questionCount, 'question', 'questions') + '</span></div>' +
      (e.description && !e.barred && (e.state === 'open' || e.state === 'upcoming') ? '<div class="small muted" style="margin-top:6px;white-space:pre-wrap">' + esc(e.description) + '</div>' : '') +
      (e.barred ? barredHtml(e) : '') +
      '</div><div class="ec-side">' + side + '</div></div>';
  }

  function listHtml() {
    const now = P.list.filter((e) => e.state === 'open' || e.state === 'in_progress');
    const next = P.list.filter((e) => e.state === 'upcoming');
    const past = P.list.filter((e) => e.state === 'submitted' || e.state === 'missed').sort((a, b) => b.startsAt - a.startsAt);
    let h = topBar() + '<div class="sp-body"><h2>My exams</h2><div class="muted">The exams assigned to you, with their date and time.</div>';
    if (!P.list.length) h += '<div class="exam-cards"><div class="card card-pad center muted" style="padding:40px">' + icon('calendar', 'width="28" height="28"') + '<p>There are no exams for you at the moment.</p></div></div>';
    if (now.length) h += '<div class="section-title" style="margin-top:22px">Available now</div><div class="exam-cards">' + now.map(card).join('') + '</div>';
    if (next.length) h += '<div class="section-title" style="margin-top:22px">Upcoming</div><div class="exam-cards">' + next.map(card).join('') + '</div>';
    if (past.length) h += '<div class="section-title" style="margin-top:22px">Completed</div><div class="exam-cards">' + past.map(card).join('') + '</div>';
    return h + '</div>';
  }

  async function loadList(silent) {
    if (P.loading) return;
    P.loading = true;
    try {
      const r = await Remote.myExams();
      P.list = r.exams || [];
      if (P.view === 'list') root().innerHTML = listHtml();
      else if (P.view === 'syllabus' || P.view === 'done') paintTabs();
    } catch (e) {
      if (!silent) toast(esc(e.message), 'error');
    } finally {
      P.loading = false;
    }
  }

  // ------------------------------------------------------------ syllabus (PDF files of the student's subjects)
  function fileHtml(s, f) {
    const busy = P.opening !== null && String(P.opening) === String(f.id);
    const meta = [fmtSize(f.size), dateShort(f.uploadedAt)].filter(Boolean).join(' · ');
    return '<button class="sy-file' + (busy ? ' busy' : '') + '" data-sx="pdf" data-id="' + esc(f.id) + '" data-subject="' + esc(s.id) + '" title="Open ' + esc(f.name) + '"' + (P.opening !== null ? ' disabled' : '') + '>' +
      '<span class="sy-pdf" aria-hidden="true">PDF</span><span class="sy-fname">' + esc(f.name) + '</span><span class="sy-fmeta">' + esc(meta) + '</span>' +
      '<span class="sy-open">' + (busy ? '<span class="sy-spin"></span>Opening…' : icon('eye') + 'Open') + '</span></button>';
  }

  function subjectHtml(s) {
    const files = s.files || [];
    return '<div class="sy-subj' + (files.length ? ' has-files' : '') + '" data-subject="' + esc(s.id) + '"><div class="sy-head"><span class="sy-ic">' + icon('book') + '</span>' +
      '<div class="sy-name">' + esc(s.name) + (s.code ? '<span class="sy-code">' + esc(s.code) + '</span>' : '') + '</div>' +
      '<span class="sy-n">' + (files.length ? plural(files.length, 'file', 'files') : 'No files yet') + '</span></div>' +
      (files.length ? '<div class="sy-files">' + files.map((f) => fileHtml(s, f)).join('') + '</div>' : '') + '</div>';
  }

  function syllabusHtml() {
    const d = P.sy;
    const total = d ? (d.subjects || []).reduce((n, s) => n + (s.files || []).length, 0) : 0;
    let h = topBar() + '<div class="sp-body"><h2>Syllabus</h2><div class="muted">Course material (PDF) for the subjects of your level' +
      (d && d.level && d.level.name ? ': <b>' + esc(d.level.name) + '</b>' : '') + '.' + (total ? ' Click a file to open it.' : '') + '</div>';
    if (!d) {
      if (P.syError)
        h += '<div class="exam-cards"><div class="card card-pad center" style="padding:36px">' + icon('alert', 'width="28" height="28" class="danger-text"') +
          '<p>The syllabus could not be loaded.<br><span class="small muted">' + esc(P.syError) + '</span></p><button class="btn" data-sx="syreload">' + icon('refresh') + 'Try again</button></div></div>';
      else h += '<div class="exam-cards"><div class="card card-pad center muted" style="padding:40px">Loading…</div></div>';
      return h + '</div>';
    }
    const subs = d.subjects || [];
    if (!subs.length) {
      h += '<div class="exam-cards"><div class="card card-pad center muted" style="padding:40px">' + icon('book', 'width="28" height="28"') +
        '<p>No subjects were found for your current enrollment.<br>If you think this is wrong, please contact the Registrar’s office.</p></div></div>';
      return h + '</div>';
    }
    if (!total) h += '<div class="callout sy-none">' + icon('info') + '<p>No syllabus files have been uploaded for your subjects yet. Please check again later.</p></div>';
    return h + '<div class="sy-list">' + subs.map(subjectHtml).join('') + '</div></div>';
  }

  function paintSyllabus() {
    if (P.view === 'syllabus') root().innerHTML = syllabusHtml();
  }

  async function loadSyllabus(silent) {
    if (P.syLoading) return;
    P.syLoading = true;
    try {
      P.sy = await Remote.mySyllabus();
      P.syError = '';
    } catch (e) {
      if (!P.sy) P.syError = e.message;
      else if (!silent) toast(esc(e.message), 'error');
    } finally {
      P.syLoading = false;
    }
    paintSyllabus();
  }

  function showSyllabus() {
    P.view = 'syllabus';
    P.syError = '';
    paintSyllabus();
    root().scrollTop = 0;
    return loadSyllabus(true);
  }

  async function openPdf(id, subjectId) {
    if (P.opening !== null || !P.sy) return;
    const s = (P.sy.subjects || []).find((x) => String(x.id) === String(subjectId));
    const f = s && (s.files || []).find((x) => String(x.id) === String(id));
    if (!f) return;
    P.opening = f.id;
    paintSyllabus();
    try {
      const bytes = await Remote.mySyllabusFile(f.id);
      if (P.view !== 'syllabus') return; // left the syllabus (or signed out) meanwhile
      App.pdfViewer.open({ title: String(f.name || '').replace(/\.pdf$/i, '') || 'Syllabus', sub: (s.code ? s.code + ' · ' : '') + s.name, bytes, fileName: f.name, lang: 'en' });
    } catch (e) {
      toast(esc(e.message), 'error');
      if (e.status === 404) loadSyllabus(true); // the file was removed meanwhile
    } finally {
      P.opening = null;
      paintSyllabus();
    }
  }

  // ------------------------------------------------------------ taking an exam
  function answered(q) {
    return EC.isAnswered(q, P.answers[q.id]);
  }

  function questionHtml() {
    const qs = P.x.questions;
    const q = qs[P.cur];
    const v = P.answers[q.id];
    let body = '';
    if (q.type === 'single' || q.type === 'multi') {
      const sel = q.type === 'multi' ? (Array.isArray(v) ? v : []) : [v];
      body = '<div class="xm-opts">' + q.options.map((o, i) =>
        '<div class="xm-opt' + (q.type === 'multi' ? ' multi' : '') + (sel.includes(o.id) ? ' on' : '') + '" data-sx="opt" data-o="' + esc(o.id) + '" role="button" tabindex="0"><span class="xm-letter">' + (LETTERS[i] || i + 1) + '</span><span>' + esc(o.text) + '</span></div>'
      ).join('') + '</div>';
      if (q.type === 'multi') body = '<div class="small muted" style="margin:-8px 0 12px">Select <b>all</b> the correct answers.</div>' + body;
    } else if (q.type === 'tf') {
      body = '<div class="xm-opts">' + [[true, 'True'], [false, 'False']].map((x, i) =>
        '<div class="xm-opt' + (v === x[0] ? ' on' : '') + '" data-sx="tf" data-v="' + x[0] + '" role="button" tabindex="0"><span class="xm-letter">' + (i ? 'F' : 'T') + '</span><span>' + x[1] + '</span></div>'
      ).join('') + '</div>';
    } else {
      body = '<input class="input input-lg" id="xm-short" placeholder="Type your answer…" value="' + esc(v || '') + '" autocomplete="off" />';
    }
    return '<div class="xm-q"><div class="xm-qnum">Question ' + (P.cur + 1) + ' of ' + qs.length + (q.points !== 1 ? ' · ' + plural(q.points, 'point', 'points') : '') + '</div>' +
      '<div class="xm-qtext">' + esc(q.text) + '</div>' + body +
      '<div class="xm-nav-q"><button class="btn" data-sx="prev"' + (P.cur ? '' : ' disabled') + '>' + icon('left') + 'Previous</button>' +
      (P.cur < qs.length - 1 ? '<button class="btn btn-primary" data-sx="next">Next' + icon('right') + '</button>' : '<button class="btn btn-primary" data-sx="submit">' + icon('send') + 'Submit</button>') + '</div></div>';
  }

  function sideHtml() {
    const qs = P.x.questions;
    const n = qs.filter(answered).length;
    return '<div class="small strong">Answered ' + n + ' / ' + qs.length + '</div><div class="xm-grid">' +
      qs.map((q, i) => '<button class="' + (answered(q) ? 'done' : '') + (i === P.cur ? ' cur' : '') + '" data-sx="go" data-i="' + i + '">' + (i + 1) + '</button>').join('') +
      '</div><button class="btn btn-primary" style="width:100%;justify-content:center" data-sx="submit">' + icon('send') + 'Submit exam</button>' +
      '<p class="small muted" style="margin:10px 0 0">Your answers are saved automatically. You can change an answer until you submit.</p>';
  }

  function saveLabel() {
    return P.saveState === 'saving' ? 'Saving…' : P.saveState === 'error' ? 'No connection — retrying…' : 'Saved';
  }

  function examHtml() {
    return topBar() +
      '<div class="xm-bar"><div style="flex:1;min-width:0"><div class="xm-title">' + esc(P.x.exam.title) + '</div><div class="xm-sub">' + esc(P.x.exam.subjectName || '') + '</div></div>' +
      '<div class="xm-save" id="xm-save">' + saveLabel() + '</div><div class="xm-timer" id="xm-timer" title="Time remaining">' + icon('clock', 'width="18" height="18"') + '<span>' + clock(P.x.deadline - Remote.now()) + '</span></div></div>' +
      '<div class="xm-layout"><div id="xm-main">' + questionHtml() + '</div><div class="xm-side" id="xm-side">' + sideHtml() + '</div></div>';
  }

  function paintExam(full) {
    if (full || !root().querySelector('#xm-main')) root().innerHTML = examHtml();
    else {
      root().querySelector('#xm-main').innerHTML = questionHtml();
      root().querySelector('#xm-side').innerHTML = sideHtml();
    }
    const inp = root().querySelector('#xm-short');
    if (inp) setTimeout(() => inp.focus(), 10);
  }

  function paintSave() {
    const el = root().querySelector('#xm-save');
    if (el) {
      el.textContent = saveLabel();
      el.className = 'xm-save' + (P.saveState === 'error' ? ' err' : '');
    }
  }

  function tick() {
    if (P.view !== 'exam' || !P.x) return;
    const left = P.x.deadline - Remote.now();
    const el = root().querySelector('#xm-timer');
    if (el) {
      el.querySelector('span').textContent = clock(left);
      el.className = 'xm-timer' + (left < 60000 ? ' crit' : left < 300000 ? ' low' : '');
    }
    if (left <= 0 && !P.finishing) finish(true);
  }

  function scheduleSave() {
    P.dirty = true;
    P.saveState = 'saving';
    paintSave();
    clearTimeout(P.saveTimer);
    P.saveTimer = setTimeout(save, 600);
  }

  async function save() {
    if (!P.x || !P.dirty) return;
    if (P.saving) {
      await P.saving;
      if (!P.dirty) return;
    }
    P.dirty = false;
    const id = P.x.exam.id;
    const snapshot = JSON.parse(JSON.stringify(P.answers));
    P.saving = Remote.saveAnswers(id, snapshot)
      .then(() => {
        P.saveState = P.dirty ? 'saving' : 'saved';
        paintSave();
      })
      .catch((e) => {
        if (e.status === 409) return showDone(true, e.message);
        P.dirty = true;
        P.saveState = 'error';
        paintSave();
        clearTimeout(P.saveTimer);
        P.saveTimer = setTimeout(save, 3000);
      })
      .finally(() => (P.saving = null));
    return P.saving;
  }

  async function open(id, resume) {
    let x;
    try {
      x = resume ? await Remote.resumeExam(id) : await Remote.startExam(id);
    } catch (e) {
      toast(esc(e.message), 'error');
      return loadList();
    }
    P.x = x;
    P.answers = x.answers || {};
    P.cur = Math.max(0, x.questions.findIndex((q) => !EC.isAnswered(q, P.answers[q.id])));
    P.view = 'exam';
    P.saveState = 'saved';
    P.finishing = false;
    paintExam(true);
  }

  async function finish(timeUp) {
    if (P.finishing || !P.x) return;
    P.finishing = true;
    clearTimeout(P.saveTimer);
    const id = P.x.exam.id;
    let msg = '';
    for (let i = 0; i < 4; i++) {
      try {
        if (P.saving) await P.saving;
        await Remote.submitExam(id, P.answers);
        msg = '';
        break;
      } catch (e) {
        if (e.status === 409 || e.status === 404) break;
        msg = e.message;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (msg) {
      // the server closes the attempt by itself at the deadline with the answers it already has
      P.finishing = false;
      if (!timeUp) return toast('The exam was not submitted: ' + esc(msg) + ' — please try again.', 'error');
    }
    showDone(timeUp);
  }

  function showDone(timeUp, note) {
    const title = P.x ? P.x.exam.title : '';
    P.view = 'done';
    P.x = null;
    P.answers = {};
    P.dirty = false;
    root().innerHTML = topBar() + '<div class="xm-done"><div class="big">' + icon('check', 'width="30" height="30"') + '</div>' +
      '<h2 style="margin:16px 0 6px">' + (timeUp ? 'Time is up' : 'Exam submitted') + '</h2>' +
      '<p class="muted" style="margin:0 0 6px">' + esc(title) + '</p>' +
      '<p style="margin:0 0 22px">' + (timeUp ? 'Your answers were submitted automatically.' : 'Your answers have been recorded. Thank you!') + (note && !timeUp ? '<br><span class="small muted">' + esc(note) + '</span>' : '') + '</p>' +
      '<button class="btn btn-primary" data-sx="back">' + icon('left') + 'Back to my exams</button></div>';
  }

  // ------------------------------------------------------------ events
  function setAnswer(q, v) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) delete P.answers[q.id];
    else P.answers[q.id] = v;
    scheduleSave();
  }

  function wire() {
    if (P.wired) return;
    P.wired = true;
    const el = root();
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sx]');
      if (!b || b.disabled) return;
      const a = b.dataset.sx;
      if (a === 'logout') {
        if (P.view === 'exam' && !(await ask('Sign out', 'The exam has <b>not</b> been submitted and the clock keeps running. Your answers are saved — you can continue by signing in again before the time runs out.', 'Sign out'))) return;
        await App.student.flush();
        return App.logout();
      }
      if (a === 'password') return App.auth.changePassword(false);
      if (a === 'tab') {
        if (P.view === 'exam') return;
        if (b.dataset.tab === 'syllabus') return showSyllabus();
        P.view = 'list';
        root().innerHTML = listHtml();
        root().scrollTop = 0;
        return loadList();
      }
      if (a === 'syreload') {
        P.syError = '';
        paintSyllabus();
        return loadSyllabus();
      }
      if (a === 'pdf') return openPdf(b.dataset.id, b.dataset.subject);
      if (a === 'back') {
        P.view = 'list';
        return loadList();
      }
      if (a === 'start') {
        const ex = P.list.find((x) => String(x.id) === b.dataset.id);
        const ok = await ask('Start exam', '<b>' + esc(ex ? ex.title : '') + '</b><br><br>Duration: <b>' + (ex ? plural(ex.durationMinutes, 'minute', 'minutes') : '') + '</b>. The clock starts as soon as you press “Start” and does not stop.<br>Your answers are saved automatically. The exam can be submitted only once.', 'Start');
        if (ok) await open(b.dataset.id, false);
        return;
      }
      if (a === 'resume') return open(b.dataset.id, true);
      if (P.view !== 'exam' || !P.x) return;
      const q = P.x.questions[P.cur];
      if (a === 'opt') {
        const o = b.dataset.o;
        if (q.type === 'single') setAnswer(q, o);
        else {
          const cur = Array.isArray(P.answers[q.id]) ? P.answers[q.id].slice() : [];
          const i = cur.indexOf(o);
          if (i >= 0) cur.splice(i, 1);
          else cur.push(o);
          setAnswer(q, cur);
        }
        paintExam(false);
      } else if (a === 'tf') {
        setAnswer(q, b.dataset.v === 'true');
        paintExam(false);
      } else if (a === 'prev' || a === 'next' || a === 'go') {
        P.cur = a === 'go' ? Number(b.dataset.i) : Math.min(P.x.questions.length - 1, Math.max(0, P.cur + (a === 'next' ? 1 : -1)));
        paintExam(false);
      } else if (a === 'submit') {
        const left = P.x.questions.filter((x) => !answered(x)).length;
        const ok = await ask('Submit exam', (left ? '<span class="warning-text"><b>' + (left === 1 ? '1 question has' : left + ' questions have') + ' not been answered.</b></span><br><br>' : 'You have answered all the questions.<br><br>') + 'After submitting you cannot change your answers.', 'Submit');
        if (ok) await finish(false);
      }
    });
    el.addEventListener('input', (e) => {
      if (e.target.id !== 'xm-short' || !P.x) return;
      const q = P.x.questions[P.cur];
      setAnswer(q, e.target.value);
      const side = root().querySelector('#xm-side');
      if (side) side.innerHTML = sideHtml();
    });
    el.addEventListener('keydown', (e) => {
      if (P.view !== 'exam' || !P.x) return;
      if (e.target.id === 'xm-short') {
        if (e.key === 'Enter' && P.cur < P.x.questions.length - 1) {
          P.cur++;
          paintExam(false);
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const t = e.target.closest('[data-sx="opt"], [data-sx="tf"]');
        if (t) {
          e.preventDefault();
          t.click();
        }
      }
    });
  }

  App.startStudent = async function () {
    Remote.lang = 'en'; // the student portal is always English (server texts too, via X-Lang)
    document.documentElement.lang = 'en';
    App.setMode('student');
    wire();
    P.view = 'list';
    P.list = [];
    P.sy = null;
    P.syError = '';
    P.opening = null;
    root().innerHTML = topBar() + '<div class="sp-body"><div class="muted">Loading…</div></div>';
    await loadList();
    P.timers.forEach(clearInterval);
    P.timers = [
      setInterval(tick, 250),
      setInterval(() => {
        if (P.view === 'list' || P.view === 'syllabus') loadList(true);
      }, 20000),
    ];
  };

  App.student = {
    stop() {
      P.timers.forEach(clearInterval);
      P.timers = [];
      clearTimeout(P.saveTimer);
      P.view = 'list';
      P.x = null;
      P.answers = {};
      P.list = [];
      P.sy = null; // nothing of this student stays for the next one on a shared PC
      P.syError = '';
      P.opening = null;
      const r = root();
      if (r) r.innerHTML = '';
    },
    async flush() {
      if (P.x && P.dirty) {
        clearTimeout(P.saveTimer);
        await save();
      }
      if (P.saving) await P.saving;
    },
  };
})();
