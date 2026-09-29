/*
 * Client of the central GMC Registry server (window.Remote).
 * Every PC of the academy runs the same .exe; the data lives only on the server.
 * The session token is kept in memory only (never written to disk on shared PCs).
 */
(function () {
  'use strict';

  class RemoteError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status || 0;
      this.data = data || null;
    }
  }

  const R = {
    url: '',
    token: null,
    user: null,
    rev: 0,
    offset: 0, // serverNow - Date.now()
    lang: 'el', // 'el' | 'en' — sent as X-Lang on every request (server error texts follow it)
    onAuthLost: null, // async () → true when the user logged in again
    _noLang: null, // url of an older server whose CORS rules do not allow X-Lang (the header is then left out)
  };

  /** Texts produced by the client itself (the server's own error texts already follow X-Lang). */
  const MSG = {
    el: {
      noServer: 'Δεν έχει οριστεί διακομιστής.',
      timeout: (u) => 'Ο διακομιστής δεν απάντησε εγκαίρως (' + u + ').',
      offline: (u) => 'Δεν υπάρχει σύνδεση με τον διακομιστή ' + u + '. Ελέγξτε το δίκτυο της ακαδημίας.',
      status: (s) => 'Σφάλμα διακομιστή (' + s + ').',
      notServer: 'Η διεύθυνση δεν είναι διακομιστής του GMC Registry.',
    },
    en: {
      noServer: 'No server address has been set.',
      timeout: (u) => 'The server did not respond in time (' + u + ').',
      offline: (u) => 'Cannot connect to the server ' + u + '. Please check the academy network.',
      status: (s) => 'Server error (' + s + ').',
      notServer: 'This address is not a GMC Registry server.',
    },
  };
  const msg = () => MSG[R.lang === 'en' ? 'en' : 'el'];

  /** "192.168.1.10" → "http://192.168.1.10:8080"; an explicit scheme or port is kept as typed. */
  function normalizeUrl(u) {
    let s = String(u || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    const hasScheme = /^https?:\/\//i.test(s);
    if (!hasScheme) s = 'http://' + s;
    try {
      const x = new URL(s);
      const typedPort = /^(https?:\/\/)?(\[[^\]]+\]|[^/:]+):\d+/i.test(String(u).trim());
      if (!hasScheme && !typedPort) x.port = '8080';
      return x.origin;
    } catch (e) {
      return s;
    }
  }

  /**
   * A request failed at the network level although X-Lang was sent. True when the server answers a plain
   * request but not one carrying X-Lang, i.e. an older server whose CORS rules do not list that header
   * (the browser then blocks the preflight, so the original request never reached the server).
   */
  async function langHeaderBlocked(url) {
    const probe = async (headers) => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
      try {
        await fetch(url + '/api/health', { headers, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        return true;
      } catch (e) {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    return (await probe({})) && !(await probe({ 'X-Lang': R.lang }));
  }

  /**
   * One HTTP call with the session token, X-Lang, timeout, 401 → re-login → retry, and JSON errors.
   * o.raw: body is bytes (Uint8Array) sent as o.contentType. o.binary: the answer is returned as a Uint8Array.
   * o.headers: extra headers. o.url: another server than R.url (health check). o.noAuth / o.noRetry / o.timeout as before.
   */
  async function call(method, path, body, o) {
    const url = o.url || R.url;
    if (!url) throw new RemoteError(msg().noServer);
    const sendLang = !!R.lang && R._noLang !== url;
    const headers = {};
    if (o.raw) headers['Content-Type'] = o.contentType || 'application/octet-stream';
    else if (!o.binary || body !== undefined) headers['Content-Type'] = 'application/json';
    if (R.token && !o.noAuth) headers.Authorization = 'Bearer ' + R.token;
    if (sendLang) headers['X-Lang'] = R.lang;
    Object.assign(headers, o.headers || {});
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), o.timeout || 30000) : null;
    let res;
    try {
      res = await fetch(url + path, {
        method,
        headers,
        body: body === undefined ? undefined : o.raw || typeof body === 'string' ? body : JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      const aborted = !!(e && e.name === 'AbortError');
      if (timer) clearTimeout(timer);
      if (!aborted && sendLang && !o.langRetry && (await langHeaderBlocked(url))) {
        R._noLang = url;
        return call(method, path, body, Object.assign({}, o, { langRetry: true, url }));
      }
      throw new RemoteError(aborted ? msg().timeout(url) : msg().offline(url), 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (o.binary && res.ok) return new Uint8Array(await res.arrayBuffer());
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }
    if (data && typeof data.serverNow === 'number') R.offset = data.serverNow - Date.now();
    if (res.status === 401 && !o.noAuth && !o.noRetry && data && data.code === 'auth' && R.onAuthLost) {
      const again = await R.onAuthLost();
      if (again) return call(method, path, body, Object.assign({}, o, { noRetry: true }));
    }
    if (!res.ok) throw new RemoteError((data && data.error) || msg().status(res.status), res.status, data);
    return data;
  }

  /** JSON request → parsed JSON answer. */
  function request(method, path, body, opts) {
    return call(method, path, body, Object.assign({}, opts || {}, { raw: false, binary: false }));
  }

  /**
   * Binary request (same auth / re-login / JSON error handling as request()).
   * opts.body: Uint8Array sent raw with opts.contentType; opts.headers: extra headers.
   * Returns a Uint8Array when opts.binary !== false, else the parsed JSON answer.
   */
  function requestBinary(method, path, opts) {
    const o = Object.assign({}, opts || {});
    const body = o.body;
    delete o.body;
    return call(method, path, body, Object.assign(o, { raw: body !== undefined, binary: o.binary !== false }));
  }

  Object.assign(R, {
    RemoteError,
    normalizeUrl,
    request,
    requestBinary,
    now: () => Date.now() + R.offset,

    async health(url) {
      const u = normalizeUrl(url);
      if (!u) throw new RemoteError(msg().noServer);
      if (R._noLang === u) R._noLang = null; // look again: the server may have been updated since
      const h = await request('GET', '/api/health', undefined, { noAuth: true, timeout: 6000, url: u });
      if (!h || !h.ok) throw new RemoteError(msg().notServer);
      return h;
    },

    async login(url, username, password) {
      R.url = normalizeUrl(url);
      const r = await request('POST', '/api/login', { username, password }, { noAuth: true });
      R.token = r.token;
      R.user = r.user;
      return r.user;
    },

    /** New server: create the first administrator (and log in as him). */
    async setup(url, username, password) {
      R.url = normalizeUrl(url);
      const r = await request('POST', '/api/setup', { username, password }, { noAuth: true });
      R.token = r.token;
      R.user = r.user;
      return r.user;
    },

    async logout() {
      try {
        if (R.token) await request('POST', '/api/logout', {}, { noRetry: true, timeout: 5000 });
      } catch (e) {
        /* offline: the token expires on its own */
      }
      R.token = null;
      R.user = null;
      R.rev = 0;
    },

    changeOwnPassword: (current, next) => request('POST', '/api/me/password', { current, next }),

    // ---------------------------------------------------------------- registry (admin)
    /** The caller sets Remote.rev = r.rev only when it actually uses the downloaded copy. */
    async loadRegistry() {
      return request('GET', '/api/registry', undefined, { timeout: 120000 });
    },
    async registryRev() {
      return request('GET', '/api/registry/rev', undefined, { timeout: 8000 });
    },
    /** text: the whole registry JSON. Throws RemoteError(status 409) when someone else saved first. */
    async saveRegistry(text) {
      const r = await request('PUT', '/api/registry', '{"baseRev":' + Number(R.rev) + ',"data":' + text + '}', { timeout: 120000 });
      R.rev = r.rev;
      return r;
    },
    createBackup: (reason) => request('POST', '/api/registry/backups', { reason }),
    listBackups: () => request('GET', '/api/registry/backups'),
    async readBackup(id) {
      const r = await request('GET', '/api/registry/backups/' + encodeURIComponent(id), undefined, { timeout: 120000 });
      return JSON.stringify(r.data);
    },

    // ---------------------------------------------------------------- accounts (admin)
    users: () => request('GET', '/api/users'),
    createStudentAccounts: (students, resetExisting) => request('POST', '/api/users/students', { students, resetExisting: !!resetExisting }, { timeout: 180000 }),
    createAdmin: (data) => request('POST', '/api/users/admins', data),
    resetPassword: (id, password) => request('POST', '/api/users/' + id + '/password', password ? { password } : {}),
    updateUser: (id, patch) => request('PATCH', '/api/users/' + id, patch),
    deleteUser: (id) => request('DELETE', '/api/users/' + id),
    audit: () => request('GET', '/api/audit'),
    createTeacher: (data) => request('POST', '/api/users/teachers', data),
    setTeacherAssignments: (id, assignments) => request('PUT', '/api/users/' + id + '/assignments', { assignments }),

    // ---------------------------------------------------------------- the teacher's own subjects
    teacherData: () => request('GET', '/api/teacher/data', undefined, { timeout: 60000 }),
    teacherRev: () => request('GET', '/api/teacher/rev', undefined, { timeout: 8000 }),
    teacherGrades: (payload) => request('POST', '/api/teacher/grades', payload, { timeout: 30000 }),
    /** {yearId, subjectId, date: "YYYY-MM-DD", changes:[{studentId, absent}]} → {rev, stats:{added, removed, same}} */
    teacherAbsences: (payload) => request('POST', '/api/teacher/absences', payload, { timeout: 30000 }),

    // ---------------------------------------------------------------- exams (admin)
    exams: () => request('GET', '/api/exams'),
    exam: (id) => request('GET', '/api/exams/' + id),
    createExam: (data) => request('POST', '/api/exams', data),
    updateExam: (id, data) => request('PUT', '/api/exams/' + id, data),
    publishExam: (id, published) => request('POST', '/api/exams/' + id + '/publish', { published: !!published }),
    assignExam: (id, students) => request('PUT', '/api/exams/' + id + '/assignments', { students }),
    deleteExam: (id, force) => request('DELETE', '/api/exams/' + id + (force ? '?force=1' : '')),
    duplicateExam: (id) => request('POST', '/api/exams/' + id + '/duplicate', {}),
    examResults: (id) => request('GET', '/api/exams/' + id + '/results'),
    examResult: (id, am) => request('GET', '/api/exams/' + id + '/results/' + encodeURIComponent(am)),
    resetAttempt: (id, am) => request('POST', '/api/exams/' + id + '/attempts/' + encodeURIComponent(am) + '/reset', {}),
    /** The admin lets a student over the absence limit take this exam (allowed = false takes it back) → {absenceAllowed} */
    allowAbsence: (id, am, allowed) => request('POST', '/api/exams/' + id + '/absence-allow', { am, allowed: !!allowed }),

    // ---------------------------------------------------------------- the student's own exams
    myExams: () => request('GET', '/api/my/exams'),
    startExam: (id) => request('POST', '/api/my/exams/' + id + '/start', {}),
    resumeExam: (id) => request('GET', '/api/my/exams/' + id + '/attempt'),
    saveAnswers: (id, answers) => request('PUT', '/api/my/exams/' + id + '/answers', { answers }, { timeout: 15000 }),
    submitExam: (id, answers) => request('POST', '/api/my/exams/' + id + '/submit', { answers }, { timeout: 30000 }),

    // ---------------------------------------------------------------- syllabus (Ύλη): PDF files per subject
    /** admin: all files (or one subject's); teacher: his subjects' → {files:[{id, subjectId, name, size, uploadedAt, by, byName, byRole}]} */
    syllabus: (subjectId) => request('GET', '/api/syllabus' + (subjectId ? '?subjectId=' + encodeURIComponent(subjectId) : '')),
    /** bytes: Uint8Array of the PDF → {file: entry} */
    uploadSyllabus: (subjectId, name, bytes) =>
      requestBinary('POST', '/api/syllabus/' + encodeURIComponent(subjectId), {
        body: bytes,
        contentType: 'application/pdf',
        headers: { 'X-File-Name': encodeURIComponent(name) },
        binary: false,
        timeout: 300000,
      }),
    /** → Uint8Array (the PDF) */
    syllabusFile: (id) => requestBinary('GET', '/api/syllabus/files/' + encodeURIComponent(id), { timeout: 300000 }),
    deleteSyllabus: (id) => request('DELETE', '/api/syllabus/files/' + encodeURIComponent(id)),
    /** student: → {level:{id, name}, subjects:[{id, code, name, files:[{id, name, size, uploadedAt}]}]} */
    mySyllabus: () => request('GET', '/api/my/syllabus'),
    /** student: → Uint8Array (the PDF) */
    mySyllabusFile: (id) => requestBinary('GET', '/api/my/syllabus/files/' + encodeURIComponent(id), { timeout: 300000 }),
  });

  window.Remote = R;
})();
