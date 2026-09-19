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

// Папки, которые пользователь явно выбрал через нативный диалог.
// Только эти пути сервер имеет право использовать для static-комнат.
const allowedStaticDirs = new Set();

const DEFAULT_SETTINGS = {
  tunnel: 'auto',
  port: 3000,
  ngrokToken: '',
  hasSeenWelcome: false,
  allowedStaticDirs: [],
};

// ─── Настройки ────────────────────────────────────────────────
async function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(settingsPath, 'utf8')) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function writeSettings(data) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(data, null, 2));
  return true;
}

ipcMain.handle('settings:get', readSettings);
ipcMain.handle('settings:set', async (_e, data) => {
  // merged: сохраняем и то, что передано с фронта, и локальные поля main-процесса
  const current = await readSettings();
  const merged = { ...current, ...data };

  // if renderer не знает про allowedStaticDirs — не теряем его
  if (!Array.isArray(data.allowedStaticDirs) && Array.isArray(current.allowedStaticDirs)) {
    merged.allowedStaticDirs = current.allowedStaticDirs;
  }

  return writeSettings(merged);
});

// ─── Установка плагина из ZIP ─────────────────────────────────
ipcMain.handle('plugin:install-zip', async (_e, zipPath) => {
  if (!srv) return { ok: false, error: 'Сервер не запущен' };
  try {
    const name = await srv.plugins.installFromZip(zipPath, app);
    return { ok: true, plugin: name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── Выбор папки для static-комнаты (с занесением в whitelist) ─
ipcMain.handle('dialog:pick-directory', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите папку с HTML',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const dir = result.filePaths[0];
  allowedStaticDirs.add(dir);

  // persist — чтобы whitelist сохранился после перезапуска
  try {
    const s = await readSettings();
    s.allowedStaticDirs = [...allowedStaticDirs];
    await writeSettings(s);
  } catch (e) {
    console.warn('[static-dirs] не удалось сохранить whitelist:', e.message);
  }

  return dir;
});

ipcMain.handle('shell:open-path', async (_e, p) => {
  if (typeof p !== 'string') return false;
  try {
    await shell.openPath(p);
    return true;
  } catch {
    return false;
  }
});

// ─── Иконки ───────────────────────────────────────────────────
function loadIcon(relativePath) {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', relativePath));
    if (!img.isEmpty()) return img;
  } catch {}
  return nativeImage.createEmpty();
}

function loadTrayIcon(state = 'idle') {
  const map = {
    idle:   'tray/tray-idle.png',
    active: 'tray/tray-active.png',
    busy:   'tray/tray-busy.png',
  };
  const icon = loadIcon(map[state] || map.idle);
  // Fallback: если ассета нет — используем иконку приложения
  if (icon.isEmpty()) return loadIcon('icon/icon-64.png');
  return icon;
}

function loadWindowIcon() {
  return loadIcon('icon/icon-64.png');
}

// ─── Трей ─────────────────────────────────────────────────────
function refreshTray() {
  if (!tray) return;

  // Состояние иконки:
  // idle   — комната не запущена
  // active — комната активна, но 0 игроков
  // busy   — есть игроки
  const trayState = !roomActive ? 'idle'
    : playerCount > 0 ? 'busy'
    : 'active';

  const icon = loadTrayIcon(trayState);
  if (!icon.isEmpty()) tray.setImage(icon);

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
  tray = new Tray(loadTrayIcon('idle'));
  refreshTray();
  tray.on('click', () => win?.isVisible() ? win.hide() : win?.show());
}

// ─── Уведомления ──────────────────────────────────────────────
function notify(title, body) {
  if (!Notification.isSupported()) return;
  const icon = loadWindowIcon();
  const n = new Notification({
    title,
    body,
    icon: icon.isEmpty() ? undefined : icon,
  });
  n.on('click', () => win?.show());
  n.show();
}

// ─── Хуки сервера ─────────────────────────────────────────────
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
  onRoomCreated() {
    roomActive = true;
    playerCount = 0;
    refreshTray();
  },
  onRoomClosed() {
    roomActive = false;
    playerCount = 0;
    refreshTray();
  },
};

// ─── Bootstrap ────────────────────────────────────────────────
async function bootstrap() {
  const settings = await readSettings();

  // Загружаем сохранённый whitelist static-папок
  for (const dir of (settings.allowedStaticDirs || [])) {
    if (typeof dir === 'string') allowedStaticDirs.add(dir);
  }

  const port = Number(settings.port) || 3000;

  srv = await startServer({
    port,
    hooks: serverHooks,
    // Сервер проверяет каждый staticDir против этого whitelist
    isAllowedStaticDir: (dir) => allowedStaticDirs.has(dir),
  });
  console.log('[electron] server on port', srv.port);

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'LaklyCustom',
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    icon: loadWindowIcon(),
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
      if (roomActive) {
        notify('LaklyCustom', 'Комната продолжает работать в трее');
      }
    }
  });

  win.on('closed', () => { win = null; });

  createTray();
}

// ─── Жизненный цикл приложения ────────────────────────────────
app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // Живём в трее — не выходим
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  app.isQuitting = true;
  try {
    await srv?.close?.();
  } catch {}
  app.quit();
});

app.on('activate', () => {
  if (win) {
    win.show();
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});