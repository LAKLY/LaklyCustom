import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lakly', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (data) => ipcRenderer.invoke('settings:set', data),
  installPluginZip: (zipPath) => ipcRenderer.invoke('plugin:install-zip', zipPath),
  onTrayCloseRoom: (cb) => ipcRenderer.on('tray:close-room', cb),
  onTrayCreateRoom: (cb) => ipcRenderer.on('tray:create-room', cb),
});