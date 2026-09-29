/*
 * Platform layer for the lightweight Windows build (Neutralinojs + WebView2).
 * Provides the same window.api surface as the Electron preload. Under Electron
 * (window.api already defined) this file does nothing.
 */
(function () {
  'use strict';
  if (window.api || typeof Neutralino === 'undefined' || typeof NL_OS === 'undefined') return;

  const N = Neutralino;
  N.init();

  const APP_DIR_NAME = 'GMC Maritime Academy Student Registry';
  const isWin = NL_OS === 'Windows';
  const SEP = isWin ? '\\' : '/';
  const args = Array.isArray(window.NL_ARGS) ? window.NL_ARGS : [];
  const argVal = (name) => {
    const a = args.find((x) => String(x).startsWith('--' + name + '='));
    return a ? String(a).slice(name.length + 3) : null;
  };

  function join() {
    const parts = Array.prototype.slice.call(arguments).filter((p) => p !== '' && p != null);
    let out = parts.join(SEP);
    const lead = out.startsWith('\\\\') ? '\\\\' : ''; // keep UNC prefix
    out = lead + out.slice(lead.length).replace(/[\\/]+/g, SEP);
    return out;
  }

  function baseName(p) {
    return String(p).split(/[\\/]/).pop();
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + String(d.getMilliseconds()).padStart(3, '0');
  }

  async function exists(p) {
    try {
      await N.filesystem.getStats(p);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function mkdirp(p) {
    if (await exists(p)) return;
    const parent = p.replace(/[\\/][^\\/]+[\\/]?$/, '');
    if (parent && parent !== p && !(await exists(parent))) await mkdirp(parent);
    try {
      await N.filesystem.createDirectory(p);
    } catch (e) {
      if (!(await exists(p))) throw e;
    }
  }

  // ------------------------------------------------------------ where the data lives
  // A small pointer file on this PC says which folder holds the registry. It can be a local folder
  // (default), a shared folder on a server (\\server\share\…) or a synced cloud folder
  // (e.g. Google Drive: G:\My Drive\…). Only this JSON (a few MB) is stored there.
  const DATA_SUBFOLDER = 'GMC Student Registry Data';
  let configDirCache = null;
  async function configDir() {
    if (!configDirCache) configDirCache = argVal('config-dir') || join(await N.os.getPath('data'), APP_DIR_NAME);
    return configDirCache;
  }
  async function readConfig() {
    try {
      return JSON.parse(await N.filesystem.readFile(join(await configDir(), 'config.json'))) || {};
    } catch (e) {
      return {};
    }
  }
  async function writeConfig(cfg) {
    const dir = await configDir();
    await mkdirp(dir);
    await N.filesystem.writeFile(join(dir, 'config.json'), JSON.stringify(cfg, null, 1));
  }
  function dirSet(base) {
    return { data: base, db: join(base, 'registry.json'), backups: join(base, 'backups'), lock: join(base, 'instance.lock') };
  }
  async function defaultDataDir() {
    return join(await configDir(), 'data');
  }

  let dirsPromise = null;
  function dirs() {
    if (!dirsPromise) {
      dirsPromise = (async () => {
        const override = argVal('data-dir');
        const cfg = override ? {} : await readConfig();
        const custom = !override && cfg.dataDir ? cfg.dataDir : null;
        const base = override || custom || (await defaultDataDir());
        const d = dirSet(base);
        d.custom = !!custom;
        // never create a missing shared folder: an empty registry there would hide the real one
        if (custom && !(await exists(d.data))) d.unreachable = 'ο φάκελος δεν βρέθηκε';
        else {
          try {
            await mkdirp(d.backups);
          } catch (e) {
            d.unreachable = e.message || String(e);
          }
        }
        return d;
      })();
    }
    return dirsPromise;
  }

  /** Copy every file of the current data folder (registry + backups) into another folder. */
  async function copyData(from, to) {
    await mkdirp(to.backups);
    if (await exists(from.db)) await N.filesystem.writeFile(to.db, await N.filesystem.readFile(from.db));
    let entries = [];
    try {
      entries = await N.filesystem.readDirectory(from.backups);
    } catch (e) {
      entries = [];
    }
    for (const f of entries) {
      if (f.type !== 'FILE') continue;
      try {
        await N.filesystem.writeFile(join(to.backups, f.entry), await N.filesystem.readFile(join(from.backups, f.entry)));
      } catch (e) {
        /* skip unreadable backup */
      }
    }
  }

  // ------------------------------------------------------------ atomic save (serialised)
  let chain = Promise.resolve();
  function atomicWrite(file, text) {
    const job = chain.then(async () => {
      const tmp = file + '.tmp';
      await N.filesystem.writeFile(tmp, text);
      try {
        await N.filesystem.move(tmp, file);
      } catch (e) {
        // some platforms refuse to replace: keep the old copy aside, then retry
        const old = file + '.old';
        try {
          await N.filesystem.remove(old);
        } catch (e2) {
          /* none */
        }
        if (await exists(file)) await N.filesystem.move(file, old);
        await N.filesystem.move(tmp, file);
        try {
          await N.filesystem.remove(old);
        } catch (e3) {
          /* ignore */
        }
      }
    });
    chain = job.catch(() => {});
    return job;
  }

  // ------------------------------------------------------------ backups
  async function listBackupEntries() {
    const d = await dirs();
    let entries = [];
    try {
      entries = await N.filesystem.readDirectory(d.backups);
    } catch (e) {
      return [];
    }
    const files = entries.filter((e) => e.type === 'FILE' && /\.json$/i.test(e.entry));
    const out = [];
    for (const f of files) {
      const full = join(d.backups, f.entry);
      let st = null;
      try {
        st = await N.filesystem.getStats(full);
      } catch (e) {
        continue;
      }
      out.push({ name: f.entry, path: full, size: st.size, mtime: new Date(st.modifiedAt || st.createdAt || Date.now()).toISOString(), t: st.modifiedAt || 0 });
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  async function prune(prefix, keep) {
    const list = (await listBackupEntries()).filter((b) => b.name.startsWith(prefix + '-')).sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const b of list.slice(keep)) {
      try {
        await N.filesystem.remove(b.path);
      } catch (e) {
        /* ignore */
      }
    }
  }

  async function createBackup(label) {
    const d = await dirs();
    if (!(await exists(d.db))) return { name: null };
    const safe = String(label || 'manual').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'manual';
    const name = safe + '-' + stamp() + '.json';
    const text = await N.filesystem.readFile(d.db);
    await N.filesystem.writeFile(join(d.backups, name), text);
    await prune(safe, safe === 'auto' ? 30 : 40);
    return { name };
  }

  async function dailyBackup() {
    const d = await dirs();
    if (!(await exists(d.db))) return;
    const today = stamp().slice(0, 8);
    const list = await listBackupEntries();
    if (list.some((b) => b.name.startsWith('auto-' + today))) return;
    try {
      JSON.parse(await N.filesystem.readFile(d.db));
    } catch (e) {
      return; // never rotate a damaged file into the backups
    }
    await createBackup('auto');
  }

  async function latestValidBackup() {
    const list = (await listBackupEntries()).filter((b) => !b.name.startsWith('corrupt-')).sort((a, b) => b.t - a.t || (a.name < b.name ? 1 : -1));
    for (const b of list) {
      try {
        const text = await N.filesystem.readFile(b.path);
        const obj = JSON.parse(text);
        if (obj && Array.isArray(obj.students)) return { name: b.name, text };
      } catch (e) {
        /* next */
      }
    }
    return null;
  }

  // ------------------------------------------------------------ single instance guard
  let myPid = null;
  let heartbeat = null;
  async function checkInstance() {
    const d = await dirs();
    try {
      myPid = await N.app.getProcessId();
    } catch (e) {
      myPid = Math.random();
    }
    let other = false;
    try {
      const info = JSON.parse(await N.filesystem.readFile(d.lock));
      other = info && info.pid !== myPid && Date.now() - info.ts < 12000;
    } catch (e) {
      other = false;
    }
    if (!other) await startHeartbeat();
    return { other, start: () => startHeartbeat() };
  }

  async function startHeartbeat() {
    clearInterval(heartbeat);
    const d = await dirs();
    const beat = () => N.filesystem.writeFile(d.lock, JSON.stringify({ pid: myPid, ts: Date.now() })).catch(() => {});
    await beat();
    heartbeat = setInterval(beat, 4000);
  }

  async function lockedByOther(d) {
    try {
      const info = JSON.parse(await N.filesystem.readFile(d.lock));
      return info && info.pid !== myPid && Date.now() - info.ts < 12000;
    } catch (e) {
      return false;
    }
  }

  async function releaseLock() {
    clearInterval(heartbeat);
    try {
      const d = await dirs();
      await N.filesystem.remove(d.lock);
    } catch (e) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ close handling
  let closeHandler = null;
  N.events.on('windowClose', async () => {
    try {
      if (closeHandler) await closeHandler();
    } catch (e) {
      /* exit anyway */
    }
    try {
      clearInterval(heartbeat);
      const d = await dirs();
      await N.filesystem.remove(d.lock);
    } catch (e) {
      /* ignore */
    }
    N.app.exit();
  });

  // prevent WebView2 from navigating away when a file is dropped outside a drop zone
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  function filtersFor(f) {
    return (f || [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm', 'csv', 'ods'] }]).map((x) => ({ name: x.name, extensions: x.extensions }));
  }

  window.api = {
    platform: 'neutralino',
    async loadDb() {
      const d = await dirs();
      const base = { path: d.db, dataDir: d.data };
      if (d.unreachable)
        return Object.assign(base, {
          fatal: 'Ο φάκελος δεδομένων δεν είναι διαθέσιμος (' + d.unreachable + '). Ελέγξτε ότι ο server / το Google Drive είναι συνδεδεμένο.',
          fatalKind: 'datadir',
        });
      await dailyBackup().catch(() => {});
      if (!(await exists(d.db))) return Object.assign(base, { text: null });
      let text;
      try {
        text = await N.filesystem.readFile(d.db);
      } catch (e) {
        return Object.assign(base, { fatal: 'Δεν ήταν δυνατή η ανάγνωση του αρχείου δεδομένων: ' + (e.message || e.code || e) });
      }
      try {
        JSON.parse(text);
        return Object.assign(base, { text });
      } catch (e) {
        try {
          await N.filesystem.writeFile(join(d.backups, 'corrupt-' + stamp() + '.json'), text);
        } catch (e2) {
          return Object.assign(base, { fatal: 'Το αρχείο δεδομένων είναι κατεστραμμένο και δεν ήταν δυνατό να διασωθεί.' });
        }
        return Object.assign(base, { text: null, corrupt: true, recovered: await latestValidBackup(), error: 'Το αρχείο δεδομένων ήταν κατεστραμμένο (' + e.message + ')' });
      }
    },
    async saveDb(text) {
      const d = await dirs();
      await atomicWrite(d.db, text);
      return { ok: true };
    },
    saveDbSync() {
      return { ok: false }; // not needed: the window waits for onCloseRequest
    },
    onCloseRequest(fn) {
      closeHandler = fn;
    },
    async openFile(opts) {
      const o = opts || {};
      let p = null;
      if (Array.isArray(window.__testOpenQueue) && window.__testOpenQueue.length) p = window.__testOpenQueue.shift();
      else {
        const r = await N.os.showOpenDialog(o.title || 'Άνοιγμα αρχείου', { filters: filtersFor(o.filters), multiSelections: false });
        if (!r || !r.length) return null;
        p = r[0];
      }
      const buf = await N.filesystem.readBinaryFile(p);
      return { name: baseName(p), path: p, data: new Uint8Array(buf) };
    },
    async saveFile(opts) {
      const o = opts || {};
      const ext = ((o.filters && o.filters[0] && o.filters[0].extensions[0]) || 'xlsx').toLowerCase();
      let p;
      const testDir = argVal('save-dir');
      if (testDir) p = join(testDir, o.defaultName);
      else {
        let docs = '';
        try {
          docs = await N.os.getPath('documents');
        } catch (e) {
          docs = '';
        }
        p = await N.os.showSaveDialog(o.title || 'Αποθήκευση αρχείου', { defaultPath: docs ? join(docs, o.defaultName) : o.defaultName, filters: filtersFor(o.filters) });
        if (!p) return null;
        if (!new RegExp('\\.' + ext + '$', 'i').test(p)) p += '.' + ext;
      }
      const data = o.data instanceof Uint8Array ? o.data : new Uint8Array(o.data);
      await N.filesystem.writeBinaryFile(p, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      return { path: p, name: baseName(p) };
    },
    /** files: [{ name, data: Uint8Array }] → written into a folder the user picks. */
    async saveFilesToFolder(opts) {
      const o = opts || {};
      let dir = argVal('save-dir');
      if (!dir) {
        let docs = '';
        try {
          docs = await N.os.getPath('documents');
        } catch (e) {
          docs = '';
        }
        dir = await N.os.showFolderDialog(o.title || 'Επιλογή φακέλου', docs ? { defaultPath: docs } : {});
        if (!dir) return null;
      }
      if (o.subfolder) {
        dir = join(dir, o.subfolder);
        await mkdirp(dir);
      }
      for (const f of o.files) {
        const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
        await N.filesystem.writeBinaryFile(join(dir, f.name), data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
      return { path: dir, count: o.files.length };
    },
    async openPath(p) {
      return N.os.open(p);
    },
    async showItem(p) {
      if (isWin) return N.os.execCommand('explorer /select,"' + p + '"', { background: true });
      return N.os.open(p.replace(/[\\/][^\\/]+$/, ''));
    },
    async openDataDir() {
      const d = await dirs();
      return N.os.open(d.data);
    },
    createBackup,
    async listBackups() {
      return (await listBackupEntries()).map((b) => ({ name: b.name, size: b.size, mtime: b.mtime }));
    },
    async readBackup(name) {
      const d = await dirs();
      return N.filesystem.readFile(join(d.backups, baseName(name)));
    },
    async appInfo() {
      const d = await dirs();
      return {
        version: window.NL_APPVERSION || '',
        dataDir: d.data,
        dbFile: d.db,
        backupDir: d.backups,
        customDataDir: !!d.custom,
        dataDirConfigurable: !argVal('data-dir'),
        engine: 'Neutralino ' + (window.NL_VERSION || ''),
      };
    },
    /** Folder picker (for the data location). */
    async chooseFolder(title) {
      if (Array.isArray(window.__testFolderQueue) && window.__testFolderQueue.length) return window.__testFolderQueue.shift();
      return (await N.os.showFolderDialog(title || 'Επιλογή φακέλου')) || null;
    },
    /** What is inside a candidate data folder. */
    async inspectDataFolder(dir) {
      const direct = dirSet(dir);
      const target = (await exists(direct.db)) ? direct : dirSet(join(dir, DATA_SUBFOLDER));
      let students = null;
      let hasData = false;
      if (await exists(target.db)) {
        hasData = true;
        try {
          students = (JSON.parse(await N.filesystem.readFile(target.db)).students || []).length;
        } catch (e) {
          students = null;
        }
      }
      return { target: target.data, hasData, students, busy: hasData ? await lockedByOther(target) : false };
    },
    /**
     * Switch the data folder. mode: 'move' (copy the current data there), 'use' (use the data already
     * there), 'default' (back to the local folder on this PC). The old copy is left untouched.
     */
    async setDataDir(target, mode) {
      const cur = await dirs();
      let dest = mode === 'default' ? dirSet(await defaultDataDir()) : dirSet(target);
      if (mode !== 'default' && (await lockedByOther(dest))) throw new Error('Ο φάκελος χρησιμοποιείται αυτή τη στιγμή από την εφαρμογή σε άλλον υπολογιστή.');
      if (mode === 'move') await copyData(cur, dest);
      else await mkdirp(dest.backups);
      await N.filesystem.writeFile(join(dest.data, '.write-test'), 'ok');
      await N.filesystem.remove(join(dest.data, '.write-test'));
      const cfg = await readConfig();
      if (mode === 'default') delete cfg.dataDir;
      else cfg.dataDir = dest.data;
      await writeConfig(cfg);
      await releaseLock();
      dirsPromise = null;
      await startHeartbeat();
      return { dataDir: dest.data };
    },
    checkInstance,
    /** Small per-PC preferences (server address, last user name). */
    async getPrefs() {
      const c = await readConfig();
      return c.prefs || {};
    },
    async setPrefs(patch) {
      const c = await readConfig();
      c.prefs = Object.assign({}, c.prefs || {}, patch || {});
      await writeConfig(c);
      return c.prefs;
    },
    /** Server address given by --server=… or by a "server.txt" file next to the .exe (for mass installs). */
    async defaultServer() {
      const a = argVal('server');
      if (a) return a;
      try {
        const t = await N.filesystem.readFile(join(window.NL_PATH || '.', 'server.txt'));
        return String(t).trim().split(/\r?\n/)[0].trim();
      } catch (e) {
        return '';
      }
    },
    /** Does this PC still hold registry data of the previous (local/shared-folder) version? */
    async localDataInfo() {
      try {
        const d = await dirs();
        if (d.unreachable || !(await exists(d.db))) return null;
        const st = await N.filesystem.getStats(d.db);
        return { path: d.db, size: st.size };
      } catch (e) {
        return null;
      }
    },
    async readLocalData() {
      const d = await dirs();
      return N.filesystem.readFile(d.db);
    },
  };
})();
