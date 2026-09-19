import { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, Notification, dialog } from 'electron';
import { startServer } from '../core/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import unzipper from 'unzipper';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

let win = null, srv = null, tray = null;
let playerCount = 0, roomActive = false;

const DEFAULT_SETTINGS = { tunnel: 'auto', port: 3000, ngrokToken: '' };

async function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(settingsPath, 'utf8')) }; }
  catch { return DEFAULT_SETTINGS; }
}
async function writeSettings(data) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(data, null, 2));
  return true;
}
ipcMain.handle('settings:get', readSettings);
ipcMain.handle('settings:set', (_e, data) => writeSettings(data));

// --- Drag & Drop установка плагина ---
ipcMain.handle('plugin:install-zip', async (_e, zipPath) => {
  if (!srv) return { ok: false, error: 'Сервер не запущен' };
  try {
    const name = await srv.plugins.installFromZip(zipPath, app);
    return { ok: true, plugin: name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function loadTrayIcon() {
  for (const name of ['tray.png', 'icon.png', 'icon.ico']) {
    try {
      const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', name));
      if (!img.isEmpty()) return img;
    } catch {}
  }
  return nativeImage.createEmpty();
}

function refreshTray() {
  if (!tray) return;
  const status = roomActive
    ? `Комната активна · игроков: ${playerCount}`
    : 'Комната не запущена';
  tray.setToolTip(`LaklyCustom\n${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть окно', click: () => win?.show() },
    { type: 'separator' },
    {
      label: roomActive ? 'Закрыть комнату' : 'Создать комнату',
      click: () => {
        win?.show();
        win?.webContents.send(roomActive ? 'tray:close-room' : 'tray:create-room');
      },
    },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(loadTrayIcon());
  refreshTray();
  tray.on('click', () => win?.isVisible() ? win.hide() : win?.show());
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: loadTrayIcon() });
  n.on('click', () => win?.show());
  n.show();
}

const serverHooks = {
  onPlayerJoin(player) {
    playerCount++;
    refreshTray();
    notify('Новый игрок', `${player.name} подключился к комнате`);
  },
  onPlayerLeave(player) {
    playerCount = Math.max(0, playerCount - 1);
    refreshTray();
    if (player?.name) notify('Игрок вышел', `${player.name} покинул комнату`);
  },
  onRoomCreated() { roomActive = true; playerCount = 0; refreshTray(); },
  onRoomClosed() { roomActive = false; playerCount = 0; refreshTray(); },
};

async function bootstrap() {
  const settings = await readSettings();
  const port = Number(settings.port) || 3000;

  srv = await startServer({ port, hooks: serverHooks });
  console.log('[electron] server on port', srv.port);

  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    title: 'LaklyCustom',
    backgroundColor: '#0A0E27',
    autoHideMenuBar: true,
    icon: loadTrayIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  await win.loadURL(`http://localhost:${srv.port}/host/`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
      if (roomActive) notify('LaklyCustom', 'Комната продолжает работать в трее');
    }
  });

  win.on('closed', () => { win = null; });
  createTray();
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', () => { /* живём в трее */ });

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  app.isQuitting = true;
  try { await srv?.close?.(); } catch {}
  app.quit();
});

app.on('activate', () => {
  if (win) { win.show(); return; }
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});