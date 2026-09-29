/* Login screen (admin & students), server address, password changes, re-login when a session expires. */
(function () {
  'use strict';
  const App = window.App;
  const { esc, icon, openModal, toast } = App.ui;
  const api = window.api;
  const Remote = window.Remote;

  // lang: language of the login screen (ΕΛ / EN switch, remembered per PC with api.setPrefs({lang}))
  const L = { server: '', editServer: false, status: null, busy: false, error: '', errKey: null, setup: false, lang: 'el', prefsLoaded: false };

  /** Texts of the login screen (the first-run administrator setup stays Greek). */
  const TX = {
    el: {
      serverLabel: 'Διεύθυνση διακομιστή',
      serverPh: 'π.χ. 192.168.1.10:8080',
      test: 'Έλεγχος',
      testTitle: 'Έλεγχος σύνδεσης με τον διακομιστή',
      serverHint: 'Η διεύθυνση του κεντρικού διακομιστή της ακαδημίας (τη δίνει ο διαχειριστής).',
      connected: 'συνδεδεμένος',
      offline: 'χωρίς σύνδεση',
      checking: 'έλεγχος…',
      change: 'Αλλαγή',
      user: 'Όνομα χρήστη ή Α.Μ.',
      pass: 'Κωδικός',
      signIn: 'Σύνδεση',
      signingIn: 'Σύνδεση…',
      foot: 'Οι σπουδαστές συνδέονται με τον <b>Α.Μ.</b> τους και τον κωδικό που τους έδωσε η γραμματεία.',
      needServer: 'Γράψτε τη διεύθυνση του διακομιστή.',
      needCreds: 'Συμπληρώστε όνομα χρήστη (ή Α.Μ.) και κωδικό.',
    },
    en: {
      serverLabel: 'Server address',
      serverPh: 'e.g. 192.168.1.10:8080',
      test: 'Test connection',
      testTitle: 'Test the connection to the server',
      serverHint: "The address of the academy's central server (given by the administrator).",
      connected: 'connected',
      offline: 'not connected',
      checking: 'checking…',
      change: 'Change',
      user: 'Username or Student ID',
      pass: 'Password',
      signIn: 'Sign in',
      signingIn: 'Signing in…',
      foot: 'Students sign in with their <b>Student ID</b> and the password given to them by the Registrar’s office.',
      needServer: 'Enter the server address.',
      needCreds: 'Enter your username (or Student ID) and password.',
    },
  };
  const tx = () => TX[L.lang === 'en' ? 'en' : 'el'];

  /** Password change dialog (English for students). */
  const PW = {
    el: {
      title: 'Αλλαγή κωδικού',
      titleForced: 'Ορίστε νέο κωδικό',
      subForced: 'Για λόγους ασφαλείας ο αρχικός κωδικός πρέπει να αλλάξει',
      user: 'Χρήστης',
      cur: 'Τρέχων κωδικός',
      next: 'Νέος κωδικός',
      again: 'Επανάληψη νέου κωδικού',
      atLeast: (n) => 'Τουλάχιστον ' + n + ' χαρακτήρες.',
      cancel: 'Άκυρο',
      save: 'Αποθήκευση',
      close: 'Κλείσιμο',
      tooShort: (n) => 'Ο νέος κωδικός πρέπει να έχει τουλάχιστον ' + n + ' χαρακτήρες.',
      mismatch: 'Οι δύο νέοι κωδικοί δεν ταιριάζουν.',
      changed: 'Ο κωδικός άλλαξε',
    },
    en: {
      title: 'Change password',
      titleForced: 'Set a new password',
      subForced: 'For security reasons the initial password must be changed',
      user: 'User',
      cur: 'Current password',
      next: 'New password',
      again: 'Repeat the new password',
      atLeast: (n) => 'At least ' + n + ' characters.',
      cancel: 'Cancel',
      save: 'Save',
      close: 'Close',
      tooShort: (n) => 'The new password must be at least ' + n + ' characters long.',
      mismatch: 'The two new passwords do not match.',
      changed: 'Your password has been changed',
    },
  };

  /** "Session expired" dialog (English for students). */
  const RL = {
    el: {
      title: 'Η σύνδεση έληξε',
      sub: 'Συνδεθείτε ξανά για να συνεχίσετε — οι αλλαγές σας δεν χάνονται',
      user: 'Χρήστης',
      pass: 'Κωδικός',
      exit: 'Έξοδος',
      signIn: 'Σύνδεση',
      close: 'Κλείσιμο',
      wrong: 'Λάθος λογαριασμός.',
    },
    en: {
      title: 'Your session has expired',
      sub: 'Sign in again to continue — your work is not lost',
      user: 'User',
      pass: 'Password',
      exit: 'Sign out',
      signIn: 'Sign in',
      close: 'Close',
      wrong: 'Wrong account.',
    },
  };

  function setError(key) {
    L.errKey = key || null;
    L.error = key ? tx()[key] : '';
  }

  const BRAND =
    '<svg viewBox="0 0 48 48" width="64" height="64" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="#13365c" stroke="#c9a54a" stroke-width="2" />' +
    '<g fill="none" stroke="#f3e2b3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="12.5" r="3.2" /><path d="M24 15.7 V36.5" /><path d="M17.5 20.5 H30.5" />' +
    '<path d="M12.5 27.5 C13.5 33.5 18.5 36.8 24 36.8 C29.5 36.8 34.5 33.5 35.5 27.5" /><path d="M10.3 29.6 L12.5 27.2 L15.1 29.2" /><path d="M37.7 29.6 L35.5 27.2 L32.9 29.2" /></g></svg>';

  function serverLine(t) {
    if (L.editServer || !L.server) {
      return '<div class="field"><label>' + t.serverLabel + '</label><div class="row"><input class="input" id="lg-server" placeholder="' + esc(t.serverPh) + '" value="' + esc(L.server) + '" />' +
        '<button class="btn" type="button" id="lg-test" title="' + esc(t.testTitle) + '">' + t.test + '</button></div><div class="hint">' + esc(t.serverHint) + '</div></div>';
    }
    const st = L.status;
    const dot = st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : 'wait';
    const txt = st === 'ok' ? t.connected : st === 'bad' ? t.offline : t.checking;
    return '<div class="login-server"><span class="srv-dot ' + dot + '"></span>' + icon('server', 'width="14" height="14"') + '<span class="mono">' + esc(L.server.replace(/^https?:\/\//, '')) + '</span><span class="muted">· ' + txt + '</span>' +
      '<button class="link" type="button" id="lg-change">' + t.change + '</button></div>';
  }

  function langSwitch() {
    const b = (code, label) => '<button type="button" id="lg-lang-' + code + '" data-lang="' + code + '"' + (L.lang === code ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + label + '</button>';
    return '<div class="seg seg-sm login-lang" role="group" title="Γλώσσα / Language">' + b('el', 'ΕΛ') + b('en', 'EN') + '</div>';
  }

  function setupHtml() {
    return '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-brand">' + BRAND + '<div><div class="login-title">GMC Maritime Academy</div><div class="login-sub">Πρώτη ρύθμιση</div></div></div>' +
      '<form id="lg-form" autocomplete="off">' +
      serverLine(TX.el) +
      '<div class="callout" style="margin:0">' + icon('shield') + '<p>Ο διακομιστής είναι καινούργιος. Ορίστε το <b>όνομα χρήστη</b> και τον <b>κωδικό</b> του διαχειριστή — με αυτά θα συνδέεστε στο εξής. Τους σπουδαστές τους ρυθμίζετε μετά, από το πρόγραμμα.</p></div>' +
      '<div class="field"><label>Όνομα χρήστη διαχειριστή</label><input class="input input-lg" id="su-user" placeholder="π.χ. jim" autocomplete="off" autofocus /><div class="hint">Λατινικοί χαρακτήρες ή αριθμοί (τουλάχιστον 3).</div></div>' +
      '<div class="field"><label>Κωδικός</label><input class="input input-lg" id="su-pass" type="password" autocomplete="new-password" /><div class="hint">Τουλάχιστον 8 χαρακτήρες.</div></div>' +
      '<div class="field"><label>Επανάληψη κωδικού</label><input class="input input-lg" id="su-pass2" type="password" autocomplete="new-password" /></div>' +
      '<div class="error-box' + (L.error ? '' : ' hidden') + '" id="lg-error">' + esc(L.error) + '</div>' +
      '<button class="btn btn-primary btn-lg login-btn" type="submit" id="su-go"' + (L.busy ? ' disabled' : '') + '>' + icon('check') + (L.busy ? 'Δημιουργία…' : 'Δημιουργία διαχειριστή') + '</button>' +
      '</form></div><div class="login-copy">GMC Maritime Academy · Student Registry ' + esc((App.S.info && App.S.info.version) || '') + '</div></div>';
  }

  function html() {
    if (L.setup && L.status === 'ok' && !L.editServer) return setupHtml();
    const t = tx();
    return '<div class="login-wrap"><div class="login-card" lang="' + L.lang + '">' +
      '<div class="login-brand">' + BRAND + '<div><div class="login-title">GMC Maritime Academy</div><div class="login-sub">Student Registry</div></div>' + langSwitch() + '</div>' +
      '<form id="lg-form" autocomplete="off">' +
      serverLine(t) +
      '<div class="field"><label for="lg-user">' + t.user + '</label><input class="input input-lg" id="lg-user" autocomplete="off" autofocus /></div>' +
      '<div class="field"><label for="lg-pass">' + t.pass + '</label><input class="input input-lg" id="lg-pass" type="password" autocomplete="off" /></div>' +
      '<div class="error-box' + (L.error ? '' : ' hidden') + '" id="lg-error">' + esc(L.error) + '</div>' +
      '<button class="btn btn-primary btn-lg login-btn" type="submit" id="lg-go"' + (L.busy ? ' disabled' : '') + '>' + icon('lock') + (L.busy ? t.signingIn : t.signIn) + '</button>' +
      '</form>' +
      '<p class="login-foot">' + t.foot + '</p>' +
      '</div><div class="login-copy">GMC Maritime Academy · Student Registry ' + esc((App.S.info && App.S.info.version) || '') + '</div></div>';
  }

  async function check() {
    if (!L.server) return;
    L.status = 'wait';
    paintServer();
    try {
      const h = await Remote.health(L.server);
      L.status = 'ok';
      L.setup = !!h.needsSetup;
      setError(null);
    } catch (e) {
      L.status = 'bad';
      L.setup = false;
      L.errKey = null;
      L.error = e.message;
    }
    paintServer();
  }

  /** ΕΛ / EN on the login screen: remembered on this PC; the server answers in the same language (X-Lang). */
  async function setLang(lang) {
    lang = lang === 'en' ? 'en' : 'el';
    if (lang === L.lang) return;
    L.lang = lang;
    Remote.lang = lang;
    document.documentElement.lang = lang;
    if (L.errKey) setError(L.errKey);
    else if (L.error && !(L.status === 'bad' && L.server && !L.editServer)) L.error = ''; // a server text in the other language
    paintServer();
    try {
      await api.setPrefs({ lang });
    } catch (e) {
      /* not critical */
    }
    if (L.error && L.status === 'bad' && L.server && !L.editServer) check(); // the connection message again, in the new language
  }

  function paintServer() {
    const root = document.getElementById('login-root');
    if (!root || !root.querySelector('#lg-form')) return;
    const keep = {};
    root.querySelectorAll('input[id]').forEach((i) => i.id !== 'lg-server' && (keep[i.id] = i.value));
    const focus = document.activeElement && document.activeElement.id;
    root.innerHTML = html();
    wire(root);
    Object.keys(keep).forEach((id) => {
      const i = root.querySelector('#' + id);
      if (i) i.value = keep[id];
    });
    const f = (focus && root.querySelector('#' + focus)) || root.querySelector(L.setup ? '#su-user' : '#lg-user');
    if (f) f.focus();
  }

  function wire(root) {
    root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
    const form = root.querySelector('#lg-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    const ch = root.querySelector('#lg-change');
    if (ch)
      ch.addEventListener('click', () => {
        L.editServer = true;
        paintServer();
        root.querySelector('#lg-server').focus();
      });
    const tb = root.querySelector('#lg-test');
    if (tb)
      tb.addEventListener('click', async () => {
        const v = root.querySelector('#lg-server').value;
        L.server = Remote.normalizeUrl(v);
        setError(null);
        L.setup = false;
        if (!L.server) return;
        L.editServer = false;
        await check();
        if (L.status === 'ok') {
          try {
            await api.setPrefs({ serverUrl: L.server });
          } catch (e) {
            /* not critical */
          }
        } else L.editServer = true;
        paintServer();
      });
  }

  /** First administrator of a new server: username + password, then straight into the app. */
  async function submitSetup(root) {
    const username = root.querySelector('#su-user').value.trim();
    const p1 = root.querySelector('#su-pass').value;
    const p2 = root.querySelector('#su-pass2').value;
    setError(null);
    if (!/^[A-Za-z0-9._\-]{3,40}$/.test(username)) L.error = 'Όνομα χρήστη: τουλάχιστον 3 λατινικοί χαρακτήρες ή αριθμοί (και . _ -).';
    else if (/^\d+$/.test(username)) L.error = 'Το όνομα διαχειριστή δεν μπορεί να είναι μόνο αριθμοί (μοιάζει με Α.Μ. σπουδαστή).';
    else if (p1.length < 8) L.error = 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.';
    else if (p1 !== p2) L.error = 'Οι δύο κωδικοί δεν ταιριάζουν.';
    if (L.error) return paintServer();
    L.busy = true;
    paintServer();
    Remote.lang = 'el'; // the setup screen and the administrator's application are Greek
    try {
      await Remote.setup(L.server, username, p1);
      document.documentElement.lang = 'el';
      L.setup = false;
      try {
        await api.setPrefs({ serverUrl: L.server });
      } catch (e) {
        /* not critical */
      }
      root.innerHTML = '';
      toast('Ο διαχειριστής <b>' + esc(username) + '</b> δημιουργήθηκε', 'success');
      await App.startAdmin();
    } catch (e) {
      Remote.lang = L.lang;
      L.errKey = null;
      L.error = e.message;
      if (e.status === 409) L.setup = false; // somebody finished the setup already → normal login
      App.setMode('login');
      if (!root.querySelector('#lg-form')) {
        root.innerHTML = html();
        wire(root);
      }
    } finally {
      L.busy = false;
      if (document.body.classList.contains('mode-login')) paintServer();
    }
  }

  async function submit() {
    const root = document.getElementById('login-root');
    const srvInput = root.querySelector('#lg-server');
    if (srvInput) L.server = Remote.normalizeUrl(srvInput.value);
    if (L.setup && root.querySelector('#su-user')) return submitSetup(root);
    const username = root.querySelector('#lg-user').value.trim();
    const password = root.querySelector('#lg-pass').value;
    setError(!L.server ? 'needServer' : !username || !password ? 'needCreds' : null);
    if (L.error) return paintServer();
    L.busy = true;
    paintServer();
    try {
      const user = await Remote.login(L.server, username, password);
      // the student portal is always English; the administrator's and the teacher's screens are Greek
      Remote.lang = user.role === 'student' ? 'en' : 'el';
      document.documentElement.lang = Remote.lang;
      L.status = 'ok';
      L.editServer = false;
      try {
        await api.setPrefs({ serverUrl: L.server });
      } catch (e) {
        /* not critical */
      }
      root.innerHTML = '';
      if (user.mustChange) await App.auth.changePassword(true);
      if (user.role === 'admin') await App.startAdmin();
      else if (user.role === 'teacher') await App.startTeacher();
      else await App.startStudent();
    } catch (e) {
      Remote.lang = L.lang;
      document.documentElement.lang = L.lang;
      L.errKey = null;
      L.error = e.message;
      if (e.status === 0) L.status = 'bad';
      App.setMode('login');
      if (!root.querySelector('#lg-form')) {
        root.innerHTML = html();
        wire(root);
        root.querySelector('#lg-user').value = username;
      }
    } finally {
      L.busy = false;
      if (document.body.classList.contains('mode-login')) paintServer();
    }
  }

  App.auth = {
    async showLogin() {
      App.setMode('login');
      setError(null);
      L.busy = false;
      let p = null;
      if (!L.prefsLoaded || !L.server) {
        try {
          p = (await api.getPrefs()) || {};
        } catch (e) {
          p = {};
        }
        if (!L.prefsLoaded) L.lang = p.lang === 'en' ? 'en' : 'el';
        L.prefsLoaded = true;
      }
      Remote.lang = L.lang;
      document.documentElement.lang = L.lang;
      if (!L.server) {
        L.server = p.serverUrl || '';
        if (!L.server && api.defaultServer) {
          try {
            L.server = Remote.normalizeUrl(await api.defaultServer());
          } catch (e) {
            L.server = '';
          }
        }
        if (!L.server) {
          // a server running on this same PC (GMC-Registry-Server.exe) is found without typing anything
          try {
            await Remote.health('127.0.0.1:8080');
            L.server = 'http://127.0.0.1:8080';
          } catch (e) {
            /* none here */
          }
        }
        L.editServer = !L.server;
      }
      const root = document.getElementById('login-root');
      root.innerHTML = html();
      wire(root);
      setTimeout(() => {
        const f = root.querySelector(L.editServer ? '#lg-server' : '#lg-user');
        if (f) f.focus();
      }, 30);
      if (L.server && !L.editServer) check();
    },

    /** Change own password. forced: after the first login with a password given by the admin/server. English for students. */
    changePassword(forced) {
      return new Promise((resolve) => {
        let done = false;
        const role = Remote.user && Remote.user.role;
        const min = role === 'admin' ? 8 : 6;
        const W = role === 'student' ? PW.en : PW.el;
        openModal({
          title: forced ? W.titleForced : W.title,
          sub: forced ? W.subForced : Remote.user ? W.user + ': ' + esc(Remote.user.username) : '',
          size: 'sm',
          locked: !!forced,
          body:
            '<div class="stack"><div class="field"><label>' + W.cur + '</label><input class="input" type="password" id="pw-cur" autofocus /></div>' +
            '<div class="field"><label>' + W.next + '</label><input class="input" type="password" id="pw-new" /><div class="hint">' + W.atLeast(min) + '</div></div>' +
            '<div class="field"><label>' + W.again + '</label><input class="input" type="password" id="pw-new2" /></div></div>',
          buttons: [
            forced ? null : { label: W.cancel },
            {
              label: W.save,
              cls: 'btn-primary',
              id: 'pw-save',
              onClick: async (ctx) => {
                const a = ctx.q('#pw-new').value;
                if (a.length < min) throw new Error(W.tooShort(min));
                if (a !== ctx.q('#pw-new2').value) throw new Error(W.mismatch);
                await Remote.changeOwnPassword(ctx.q('#pw-cur').value, a);
                if (Remote.user) Remote.user.mustChange = false;
                done = true;
                toast(W.changed, 'success');
                resolve(true);
              },
            },
          ].filter(Boolean),
          onMount: (ctx) => {
            const x = ctx.q('[data-mclose]');
            if (x) x.title = W.close;
          },
          onClose: () => {
            if (!done) resolve(false);
          },
        });
      });
    },

    /** The session expired while working: ask for the password again, without losing unsaved work. English for students. */
    relogin() {
      if (App.auth._relogin) return App.auth._relogin;
      const u = Remote.user;
      if (!u) return Promise.resolve(false);
      const W = u.role === 'student' ? RL.en : RL.el;
      App.auth._relogin = new Promise((resolve) => {
        let ok = false;
        openModal({
          title: W.title,
          sub: W.sub,
          size: 'sm',
          body: '<div class="stack"><div class="field"><label>' + W.user + '</label><input class="input" value="' + esc(u.username) + '" disabled /></div><div class="field"><label>' + W.pass + '</label><input class="input" type="password" id="rl-pass" autofocus /></div></div>',
          buttons: [
            { label: W.exit, left: true },
            {
              label: W.signIn,
              cls: 'btn-primary',
              id: 'rl-go',
              onClick: async (ctx) => {
                const url = Remote.url;
                const role = u.role;
                const nu = await Remote.login(url, u.username, ctx.q('#rl-pass').value);
                if (nu.role !== role) throw new Error(W.wrong);
                ok = true;
                resolve(true);
              },
            },
          ],
          onMount: (ctx) => {
            const x = ctx.q('[data-mclose]');
            if (x) x.title = W.close;
          },
          onClose: () => {
            App.auth._relogin = null;
            if (!ok) {
              Remote.token = null; // no further requests with the expired session
              resolve(false);
              setTimeout(() => App.logout(), 0);
            }
          },
        });
      });
      return App.auth._relogin;
    },
  };

  Remote.onAuthLost = () => App.auth.relogin();

  App.actions.changeMyPassword = () => App.auth.changePassword(false);
})();
