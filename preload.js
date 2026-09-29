'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (text) => ipcRenderer.invoke('db:save', text),
  saveDbSync: (text) => ipcRenderer.sendSync('db:saveSync', text),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  saveFilesToFolder: (opts) => ipcRenderer.invoke('files:saveToFolder', opts),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openDataDir: () => ipcRenderer.invoke('shell:openDataDir'),
  createBackup: (label) => ipcRenderer.invoke('backup:create', label),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (name) => ipcRenderer.invoke('backup:read', name),
  appInfo: () => ipcRenderer.invoke('app:info'),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  defaultServer: () => ipcRenderer.invoke('prefs:defaultServer'),
  localDataInfo: () => ipcRenderer.invoke('local:info'),
  readLocalData: () => ipcRenderer.invoke('local:read'),
});
