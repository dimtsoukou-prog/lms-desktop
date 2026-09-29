'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_TITLE = 'GMC Maritime Academy Student Registry';
app.setName(APP_TITLE);
if (process.platform === 'win32') app.setAppUserModelId('gr.gmc.maritime.registry');

// Allow tests to point the app at a throw-away data folder.
const DATA_DIR = process.env.GMC_REGISTRY_DATA_DIR || path.join(app.getPath('userData'), 'data');
const DB_FILE = path.join(DATA_DIR, 'registry.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_AUTO_BACKUPS = 30;
const MAX_MANUAL_BACKUPS = 40;

let win = null;

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  d = d || new Date();
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function pruneBackups(prefix, keep) {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();
  files.slice(keep).forEach((f) => {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    } catch (e) {
      /* ignore */
    }
  });
}

function createBackup(label) {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return null;
  const safe = String(label || 'manual').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'manual';
  const name = safe + '-' + stamp() + '-' + String(Date.now() % 1000).padStart(3, '0') + '.json';
  fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, name));
  pruneBackups(safe + '-', safe === 'auto' ? MAX_AUTO_BACKUPS : MAX_MANUAL_BACKUPS);
  return name;
}

/** One automatic backup per day, taken at start-up. */
function dailyBackup() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return;
  const today = stamp().slice(0, 8);
  const exists = fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith('auto-' + today));
  if (exists) return;
  try {
    JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); // never rotate a damaged file into the backups
  } catch (e) {
    return;
  }
  createBackup('auto');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: APP_TITLE,
    backgroundColor: '#0f2238',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.env.GMC_REGISTRY_TEST) win.maximize();
    win.show();
  });
  // Links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) {
      win.webContents.toggleDevTools();
    }
  });
  win.on('closed', () => (win = null));
}

// ------------------------------------------------------------------ IPC
/** Newest backup that parses as JSON, or null. */
function latestValidBackup() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('corrupt-'))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files) {
      try {
        const text = fs.readFileSync(path.join(BACKUP_DIR, x.f), 'utf8');
        const obj = JSON.parse(text);
        if (obj && Array.isArray(obj.students)) return { name: x.f, text };
      } catch (e) {
        /* try the next one */
      }
    }
  } catch (e) {
    /* no backups */
  }
  return null;
}

ipcMain.handle('db:load', () => {
  ensureDirs();
  const base = { path: DB_FILE, dataDir: DATA_DIR };
  if (!fs.existsSync(DB_FILE)) return Object.assign(base, { text: null });
  let text;
  try {
    text = fs.readFileSync(DB_FILE, 'utf8');
  } catch (e) {
    // locked / no permission: never start empty (that would overwrite the real data)
    return Object.assign(base, { fatal: 'Δεν ήταν δυνατή η ανάγνωση του αρχείου δεδομένων (' + e.code + '): ' + e.message });
  }
  try {
    JSON.parse(text);
    return Object.assign(base, { text });
  } catch (e) {
    const aside = path.join(BACKUP_DIR, 'corrupt-' + stamp() + '.json');
    try {
      fs.copyFileSync(DB_FILE, aside);
    } catch (e2) {
      return Object.assign(base, { fatal: 'Το αρχείο δεδομένων είναι κατεστραμμένο και δεν ήταν δυνατό να διασωθεί: ' + e2.message });
    }
    const rec = latestValidBackup();
    return Object.assign(base, { text: null, corrupt: true, recovered: rec, error: 'Το αρχείο δεδομένων ήταν κατεστραμμένο (' + e.message + ')' });
  }
});

ipcMain.handle('db:save', (_e, text) => {
  ensureDirs();
  atomicWrite(DB_FILE, text);
  return { ok: true, savedAt: new Date().toISOString() };
});

ipcMain.on('db:saveSync', (e, text) => {
  try {
    ensureDirs();
    atomicWrite(DB_FILE, text);
    e.returnValue = { ok: true };
  } catch (err) {
    e.returnValue = { ok: false, error: err.message };
  }
});

ipcMain.handle('file:open', async (_e, opts) => {
  const o = opts || {};
  let filePath = o.path;
  if (!filePath) {
    const r = await dialog.showOpenDialog(win, {
      title: o.title || 'Άνοιγμα αρχείου',
      properties: ['openFile'],
      filters: o.filters || [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm', 'csv', 'ods'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    filePath = r.filePaths[0];
  }
  const data = fs.readFileSync(filePath);
  return { name: path.basename(filePath), path: filePath, data: new Uint8Array(data) };
});

ipcMain.handle('file:save', async (_e, opts) => {
  const o = opts || {};
  let filePath = process.env.GMC_REGISTRY_SAVE_DIR ? path.join(process.env.GMC_REGISTRY_SAVE_DIR, o.defaultName) : null;
  if (!filePath) {
    const r = await dialog.showSaveDialog(win, {
      title: o.title || 'Αποθήκευση αρχείου',
      defaultPath: path.join(app.getPath('documents'), o.defaultName || 'export.xlsx'),
      filters: o.filters || [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    filePath = r.filePath;
  }
  fs.writeFileSync(filePath, Buffer.from(o.data));
  return { path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('files:saveToFolder', async (_e, opts) => {
  const o = opts || {};
  let dir = process.env.GMC_REGISTRY_SAVE_DIR || null;
  if (!dir) {
    const r = await dialog.showOpenDialog(win, {
      title: o.title || 'Επιλογή φακέλου',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    dir = r.filePaths[0];
  }
  if (o.subfolder) {
    dir = path.join(dir, o.subfolder.replace(/[\\/:*?"<>|]+/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
  }
  (o.files || []).forEach((f) => fs.writeFileSync(path.join(dir, path.basename(f.name)), Buffer.from(f.data)));
  return { path: dir, count: (o.files || []).length };
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:openDataDir', () => shell.openPath(DATA_DIR));

ipcMain.handle('backup:create', (_e, label) => ({ name: createBackup(label) }));

ipcMain.handle('backup:list', () => {
  ensureDirs();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
});

ipcMain.handle('backup:read', (_e, name) => {
  const file = path.join(BACKUP_DIR, path.basename(name));
  return fs.readFileSync(file, 'utf8');
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: DATA_DIR,
  dbFile: DB_FILE,
  backupDir: BACKUP_DIR,
  electron: process.versions.electron,
  engine: 'Electron ' + process.versions.electron,
}));

// ------------------------------------------------------------ per-PC preferences (server address)
const PREFS_FILE = path.join(path.dirname(DATA_DIR), 'prefs.json');
function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) || {};
  } catch (e) {
    return {};
  }
}
ipcMain.handle('prefs:get', () => readPrefs());
ipcMain.handle('prefs:set', (_e, patch) => {
  const p = Object.assign(readPrefs(), patch || {});
  fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 1));
  return p;
});
ipcMain.handle('prefs:defaultServer', () => process.env.GMC_REGISTRY_SERVER || '');
ipcMain.handle('local:info', () => {
  try {
    const st = fs.statSync(DB_FILE);
    return { path: DB_FILE, size: st.size };
  } catch (e) {
    return null;
  }
});
ipcMain.handle('local:read', () => fs.readFileSync(DB_FILE, 'utf8'));

// ------------------------------------------------------------ lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    try {
      dailyBackup();
    } catch (e) {
      console.error('backup failed', e);
    }
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
