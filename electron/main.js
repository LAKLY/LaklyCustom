// electron/main.js
import {
  app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, Notification, dialog, globalShortcut,
} from 'electron';
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
const pluginDataDir = path.join(app.getPath('userData'), 'plugin-data');

let win = null, srv = null, tray = null;
let playerCount = 0, roomActive = false;

// Папки, которые пользователь явно выбрал через нативный диалог.
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
  const current = await readSettings();
  const merged = { ...current, ...data };
  if (!Array.isArray(data.allowedStaticDirs) && Array.isArray(current.allowedStaticDirs)) {
    merged.allowedStaticDirs = current.allowedStaticDirs;
  }
  return writeSettings(merged);
});

// ─── Установка плагина из ZIP ─────────────────────────────────
ipcMain.handle('plugin:install-zip', async (_e, zipPath) => {
  if (!srv) return { ok: false, error: 'Сервер не запущен' };
  try {
    const name = await srv.plugins.installFromZip(zipPath);
    return { ok: true, plugin: name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── Выбор папки для static-комнаты ───────────────────────────
ipcMain.handle('dialog:pick-directory', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите папку с HTML',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const dir = result.filePaths[0];
  allowedStaticDirs.add(dir);

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
  try { await shell.openPath(p); return true; } catch { return false; }
});

// ─── Иконки ───────────────────────────────────────────────────
function loadIcon(relativePath) {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', relativePath));
    if (!img.isEmpty()) return img;
  } catch {}
  return nativeImage.createEmpty();
}

// Кэш tray-иконок: три состояния → nativeImage.
// Загружаются один раз, дальше переиспользуются.
const TRAY_ICON_FILES = {
  idle:   'tray/tray-idle.png',
  active: 'tray/tray-active.png',
  busy:   'tray/tray-busy.png',
};
const trayIconCache = new Map();

function loadTrayIcon(state = 'idle') {
  if (trayIconCache.has(state)) return trayIconCache.get(state);

  const file = TRAY_ICON_FILES[state] || TRAY_ICON_FILES.idle;
  let icon = loadIcon(file);
  if (icon.isEmpty()) {
    // Fallback: если конкретной tray-иконки нет — берём общую.
    icon = loadIcon('icon/icon-64.png');
  }
  trayIconCache.set(state, icon);
  return icon;
}

function loadWindowIcon() {
  return loadIcon('icon/icon-64.png');
}

// ─── Трей ─────────────────────────────────────────────────────
// Мемоизация: не дёргаем setImage/setToolTip без реальной смены состояния.
const trayMemo = { image: null, tooltip: null };

// Правило: idle → комнаты нет, active → комната есть, но пусто,
//         busy → в комнате есть хотя бы один гость.
function computeTrayState() {
  if (!roomActive) return 'idle';
  return playerCount > 0 ? 'busy' : 'active';
}

function refreshTray() {
  if (!tray) return;

  // Иконка
  const state = computeTrayState();
  if (state !== trayMemo.image) {
    const icon = loadTrayIcon(state);
    if (!icon.isEmpty()) tray.setImage(icon);
    trayMemo.image = state;
  }

  // Tooltip
  const tooltip = roomActive
    ? `LaklyCustom\nКомната активна · игроков: ${playerCount}`
    : 'LaklyCustom\nКомната не запущена';
  if (tooltip !== trayMemo.tooltip) {
    tray.setToolTip(tooltip);
    trayMemo.tooltip = tooltip;
  }

  // Меню — пересобираем всегда, оно зависит от roomActive.
  const items = [
    { label: 'Открыть окно', click: () => win?.show() },
    { type: 'separator' },
  ];

  if (roomActive) {
    items.push(
      { label: 'Копировать ссылку', click: () => win?.webContents.send('tray:action', 'copy-link') },
      { label: 'Открыть как гость', click: () => win?.webContents.send('tray:action', 'open-guest') },
      { label: 'Закрыть комнату', click: () => win?.webContents.send('tray:action', 'close-room') },
    );
  } else {
    items.push(
      { label: 'Создать комнату', click: () => win?.webContents.send('tray:action', 'create-room') },
    );
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Горячие клавиши',
      enabled: false,
    },
    { label: '  Ctrl+Alt+L — показать окно', enabled: false },
    { label: '  Ctrl+Alt+C — создать комнату', enabled: false },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  // Прогреваем кэш всех трёх состояний, чтобы первое переключение
  // не мигало и не подгружало файл с диска в момент события.
  loadTrayIcon('idle');
  loadTrayIcon('active');
  loadTrayIcon('busy');

  tray = new Tray(loadTrayIcon('idle'));
  trayMemo.image = 'idle';
  refreshTray();
  tray.on('click', () => win?.isVisible() ? win.hide() : win?.show());
}

// ─── Уведомления ──────────────────────────────────────────────
function notify(title, body) {
  if (!Notification.isSupported()) return;
  const icon = loadWindowIcon();
  const n = new Notification({ title, body, icon: icon.isEmpty() ? undefined : icon });
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
  onRoomCreated() { roomActive = true; playerCount = 0; refreshTray(); },
  onRoomClosed() { roomActive = false; playerCount = 0; refreshTray(); },
};

// ─── Bootstrap ────────────────────────────────────────────────
async function bootstrap() {
  Menu.setApplicationMenu(null);

  const settings = await readSettings();
  for (const dir of (settings.allowedStaticDirs || [])) {
    if (typeof dir === 'string') allowedStaticDirs.add(dir);
  }

  const port = Number(settings.port) || 3000;

  srv = await startServer({
    port,
    hooks: serverHooks,
    isAllowedStaticDir: (dir) => allowedStaticDirs.has(dir),
    pluginDataDir,
  });
  console.log('[electron] server on port', srv.port);

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'LaklyCustom',
    backgroundColor: '#0D0C12',
    autoHideMenuBar: true,
    icon: loadWindowIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.setMenuBarVisibility(false);

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

  // ─── Глобальные горячие клавиши ─────────────────────────────
  globalShortcut.register('CommandOrControl+Alt+L', () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });

  globalShortcut.register('CommandOrControl+Alt+C', () => {
    win?.show();
    win?.webContents.send('tray:action', 'create-room');
  });
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (win) { win.show(); return; }
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});