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
  onTrayCloseRoom: (cb) => ipcRenderer.on('tray:close-room', cb),
  onTrayCreateRoom: (cb) => ipcRenderer.on('tray:create-room', cb),
});