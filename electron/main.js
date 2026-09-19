// electron/main.js
import { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, Notification, dialog } from 'electron';
import { startServer } from '../core/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import unzipper from 'unzipper';

// ─── Подавляем шум от untun при закрытии cloudflared ──────────
const _origUnhandled = process.listeners('unhandledRejection').slice();
process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message || reason || '');
  if (msg.includes('cloudflared exited') || msg.includes('before URL was ready')) {
    console.log('[tunnel] cloudflared завершился (норма при закрытии)');
    return;
  }
  console.error('[unhandled]', reason);
  for (const l of _origUnhandled) {
    try { l(reason); } catch {}
  }
});
// ──────────────────────────────────────────────────────────────

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

// --- Установка плагина из ZIP ---
ipcMain.handle('plugin:install-zip', async (_e, zipPath) => {
  if (!srv) return { ok: false, error: 'Сервер не запущен' };
  try {
    const name = await srv.plugins.installFromZip(zipPath, app);
    return { ok: true, plugin: name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Выбор папки для static-комнаты ---
ipcMain.handle('dialog:pick-directory', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите папку с HTML',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:open-path', async (_e, p) => {
  if (typeof p !== 'string') return false;
  try { await shell.openPath(p); return true; } catch { return false; }
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
      preload: path.join(__dirname, 'preload.cjs'),
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