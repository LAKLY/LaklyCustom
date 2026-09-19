// electron/preload.cjs
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lakly', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (data) => ipcRenderer.invoke('settings:set', data),
  installPluginZip: (zipPath) => ipcRenderer.invoke('plugin:install-zip', zipPath),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  openPath: (p) => ipcRenderer.invoke('shell:open-path', p),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  // Единый канал трея: 'create-room' | 'close-room' | 'copy-link' | 'open-guest'
  onTrayAction: (cb) => ipcRenderer.on('tray:action', (_e, action) => cb(action)),
});