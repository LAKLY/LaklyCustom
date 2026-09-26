// electron/main.mjs
import {
  app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, Notification, dialog, globalShortcut,
} from 'electron';
import { startServer } from '../core/server.js';
import { createTranslator, resolveLanguage } from '../shared/i18n.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── Boot-лог ─────────────────────────────────────────────────
let BOOT_LOG;
try {
  fsSync.mkdirSync('C:\\temp', { recursive: true });
  BOOT_LOG = 'C:\\temp\\lakly-boot.log';
} catch {
  BOOT_LOG = path.join(os.tmpdir(), 'lakly-boot.log');
}
function bootLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fsSync.appendFileSync(BOOT_LOG, line); } catch {}
}
bootLog('========================================');
bootLog(`=== main.mjs start, pid=${process.pid} ===`);
bootLog(`boot log: ${BOOT_LOG}`);
process.on('exit', (code) => bootLog(`=== process exit code=${code} ===`));
process.on('uncaughtException', (e) => bootLog(`uncaught: ${e?.stack || e}`));

// ─── Перехват console.* → bootLog ─────────────────────────────
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function fmtArgs(args) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
console.log   = (...a) => { bootLog('[LOG]  ' + fmtArgs(a)); _origLog(...a); };
console.warn  = (...a) => { bootLog('[WARN] ' + fmtArgs(a)); _origWarn(...a); };
console.error = (...a) => { bootLog('[ERR]  ' + fmtArgs(a)); _origError(...a); };

// ─── Подавляем шум от untun ───────────────────────────────────
const _origUnhandled = process.listeners('unhandledRejection').slice();
process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message || reason || '');
  if (msg.includes('cloudflared exited') || msg.includes('before URL was ready')) {
    bootLog('[tunnel] cloudflared завершился (норма при закрытии)');
    return;
  }
  bootLog(`[unhandled] ${reason?.stack || reason}`);
  for (const l of _origUnhandled) {
    try { l(reason); } catch {}
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const pluginDataDir = path.join(app.getPath('userData'), 'plugin-data');

let win = null, srv = null, tray = null;
let playerCount = 0, roomActive = false;

const allowedStaticDirs = new Set();

const DEFAULT_SETTINGS = {
  tunnel: 'auto',
  port: 3000,
  ngrokToken: '',
  hasSeenWelcome: false,
  allowedStaticDirs: [],
  language: 'auto',
};

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

ipcMain.handle('plugin:install-zip', async (_e, zipPath) => {
  if (!srv) return { ok: false, error: 'dialog.server_not_running' };
  try {
    const name = await srv.plugins.installFromZip(zipPath);
    return { ok: true, plugin: name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:pick-directory', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: tMain('dialog.pick_folder_title'),
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

// ─── i18n для main-процесса ───────────────────────────────────
let tMain = (key, vars) => {
  if (!vars) return key;
  let s = key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

function loadMainTranslator(lang) {
  try {
    const localesDir = app.isPackaged
      ? path.join(process.resourcesPath, 'shared', 'locales')
      : path.join(__dirname, '..', 'shared', 'locales');

    const dictPath = path.join(localesDir, `${lang}.json`);
    const fallbackPath = path.join(localesDir, 'en.json');

    const dict = JSON.parse(fsSync.readFileSync(dictPath, 'utf8'));
    const fallback = lang === 'en'
      ? {}
      : JSON.parse(fsSync.readFileSync(fallbackPath, 'utf8'));

    tMain = createTranslator(dict, fallback);
    bootLog(`[i18n] main translator loaded: ${lang}`);
  } catch (err) {
    bootLog(`[i18n] main translator FAILED: ${err.message}`);
  }
}

// ─── Иконки ───────────────────────────────────────────────────
function loadIcon(relativePath) {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', relativePath));
    if (!img.isEmpty()) return img;
  } catch {}
  return nativeImage.createEmpty();
}

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
  if (icon.isEmpty()) icon = loadIcon('icon/icon-64.png');
  trayIconCache.set(state, icon);
  return icon;
}

function loadWindowIcon() {
  return loadIcon('icon/icon-64.png');
}

// ─── Трей ─────────────────────────────────────────────────────
const TRAY_REFRESH_DEBOUNCE_MS = 300;
const trayMemo = { image: null, tooltip: null, menuHash: null };
let trayRefreshTimer = null;

function computeTrayState() {
  if (!roomActive) return 'idle';
  return playerCount > 0 ? 'busy' : 'active';
}
function trayMenuSignature() { return `${roomActive ? 1 : 0}`; }

function refreshTray() {
  clearTimeout(trayRefreshTimer);
  trayRefreshTimer = setTimeout(applyTrayUpdate, TRAY_REFRESH_DEBOUNCE_MS);
  trayRefreshTimer.unref?.();
}

function applyTrayUpdate() {
  trayRefreshTimer = null;
  if (!tray) return;

  const state = computeTrayState();
  const windowVisible = !!win && win.isVisible() && !win.isMinimized();

  if (!windowVisible && state !== trayMemo.image) {
    const icon = loadTrayIcon(state);
    if (!icon.isEmpty()) tray.setImage(icon);
    trayMemo.image = state;
  }

  const tooltip = roomActive
    ? tMain('tray.tooltip_active', { count: playerCount })
    : tMain('tray.tooltip_idle');
  if (tooltip !== trayMemo.tooltip) {
    tray.setToolTip(tooltip);
    trayMemo.tooltip = tooltip;
  }

  const sig = trayMenuSignature();
  if (sig !== trayMemo.menuHash) {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()));
    trayMemo.menuHash = sig;
  }
}

function buildTrayMenu() {
  const items = [
    { label: tMain('tray.show'), click: () => win?.show() },
    { type: 'separator' },
  ];
  if (roomActive) {
    items.push(
      { label: tMain('tray.copy_link'), click: () => win?.webContents.send('tray:action', 'copy-link') },
      { label: tMain('tray.open_guest'), click: () => win?.webContents.send('tray:action', 'open-guest') },
      { label: tMain('tray.close_room'), click: () => win?.webContents.send('tray:action', 'close-room') },
    );
  } else {
    items.push({ label: tMain('tray.create_room'), click: () => win?.webContents.send('tray:action', 'create-room') });
  }
  items.push(
    { type: 'separator' },
    { label: tMain('tray.quit'), click: () => { app.isQuitting = true; app.quit(); } },
  );
  return items;
}

function createTray() {
  loadTrayIcon('idle');
  loadTrayIcon('active');
  loadTrayIcon('busy');

  tray = new Tray(loadTrayIcon('idle'));
  trayMemo.image = 'idle';
  trayMemo.tooltip = null;
  trayMemo.menuHash = null;
  applyTrayUpdate();
  tray.on('click', () => win?.isVisible() ? win.hide() : win?.show());
  bootLog('tray created');
}

function destroyTray() {
  if (trayRefreshTimer) {
    clearTimeout(trayRefreshTimer);
    trayRefreshTimer = null;
  }
  try { tray?.destroy(); } catch {}
  tray = null;
}

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
    notify(
      tMain('notify.player_joined_title'),
      tMain('notify.player_joined_body', { name: player.name })
    );
  },
  onPlayerLeave(player) {
    playerCount = Math.max(0, playerCount - 1);
    refreshTray();
    if (player?.name) {
      notify(
        tMain('notify.player_left_title'),
        tMain('notify.player_left_body', { name: player.name })
      );
    }
  },
  onRoomCreated() { roomActive = true; playerCount = 0; refreshTray(); },
  onRoomClosed() { roomActive = false; playerCount = 0; refreshTray(); },
};

// ─── Принудительное убийство дерева процессов ─────────────────
function killProcessTree() {
  if (process.platform !== 'win32') return;
  try {
    const res = spawnSync(
      'taskkill',
      ['/F', '/T', '/PID', String(process.pid)],
      { stdio: 'ignore', windowsHide: true }
    );
    bootLog(`killProcessTree: taskkill exit=${res.status}`);
  } catch (err) {
    bootLog(`killProcessTree: failed: ${err.message}`);
  }
}

// ─── Bootstrap ────────────────────────────────────────────────
async function bootstrap() {
  bootLog('bootstrap: enter');

  if (app.isPackaged) {
    process.env.LAKLY_RESOURCES = process.resourcesPath;
  }
  bootLog(`bootstrap: isPackaged=${app.isPackaged}, LAKLY_RESOURCES=${process.env.LAKLY_RESOURCES || '(dev)'}`);

  Menu.setApplicationMenu(null);

  const settings = await readSettings();
  bootLog(`bootstrap: settings read, port=${settings.port}`);
  for (const dir of (settings.allowedStaticDirs || [])) {
    if (typeof dir === 'string') allowedStaticDirs.add(dir);
  }

  // ─── Язык ────────────────────────────────────────────────────
  const browserLang = app.getLocale ? app.getLocale() : 'en';
  const resolvedLang = resolveLanguage(settings.language || 'auto', browserLang);
  process.env.LAKLY_LANG = resolvedLang;
  loadMainTranslator(resolvedLang);
  bootLog(`bootstrap: language=${resolvedLang} (setting=${settings.language || 'auto'}, os=${browserLang})`);

  const port = Number(settings.port) || 3000;
  bootLog(`bootstrap: calling startServer port=${port}`);

  try {
    srv = await startServer({
      port,
      hooks: serverHooks,
      isAllowedStaticDir: (dir) => allowedStaticDirs.has(dir),
      pluginDataDir,
    });
    bootLog(`bootstrap: server started on port ${srv.port}`);
  } catch (err) {
    bootLog(`bootstrap: server FAILED: ${err?.stack || err}`);
    dialog.showErrorBox(
      tMain('dialog.server_failed_title'),
      tMain('dialog.server_failed_body', { port, error: err?.stack || err?.message || err })
    );
    app.exit(1);
    return;
  }

  bootLog('bootstrap: creating BrowserWindow');

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'LaklyCustom',
    backgroundColor: '#0D0C12',
    autoHideMenuBar: true,
    show: false,
    icon: loadWindowIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.setMenuBarVisibility(false);
  win.center();

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const lvl = ['DEBUG', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
    bootLog(`[RENDERER:${lvl}] ${message}  (${sourceId}:${line})`);
  });

  if (process.env.LAKLY_DEVTOOLS === '1' || process.argv.includes('--devtools')) {
    win.webContents.openDevTools({ mode: 'detach' });
    bootLog('DevTools opened (detached)');
  }

  win.once('ready-to-show', () => {
    bootLog('bootstrap: ready-to-show fired');
    win.show();
    bootLog(`bootstrap: win.show() isVisible=${win.isVisible()}, bounds=${JSON.stringify(win.getBounds())}`);
  });

  win.webContents.on('did-finish-load', () => bootLog('bootstrap: webContents did-finish-load'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    bootLog(`bootstrap: webContents did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  try {
    await win.loadURL(`http://localhost:${srv.port}/host/`);
    bootLog('bootstrap: URL loaded');
  } catch (err) {
    bootLog(`bootstrap: loadURL failed: ${err?.stack || err}`);
  }

  setTimeout(() => {
    if (win && !win.isVisible()) {
      bootLog('bootstrap: FALLBACK — forcing show()');
      win.show();
      win.focus();
    }
  }, 5000).unref?.();

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
      if (roomActive) notify('LaklyCustom', tMain('notify.room_in_tray'));
    }
  });

  win.on('show', () => { bootLog('win event: show'); refreshTray(); });
  win.on('hide', () => { bootLog('win event: hide'); refreshTray(); });
  win.on('minimize', () => { bootLog('win event: minimize'); refreshTray(); });
  win.on('restore', () => { bootLog('win event: restore'); refreshTray(); });
  win.on('closed', () => { bootLog('win event: closed'); win = null; });

  createTray();

  globalShortcut.register('CommandOrControl+Alt+L', () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
  globalShortcut.register('CommandOrControl+Alt+C', () => {
    win?.show();
    win?.webContents.send('tray:action', 'create-room');
  });

  bootLog('bootstrap: DONE');
}

app.whenReady()
  .then(bootstrap)
  .catch((err) => {
    bootLog(`FATAL: ${err?.stack || err}`);
    try {
      dialog.showErrorBox(
        tMain('dialog.fatal_title'),
        String(err?.stack || err?.message || err)
      );
    } catch {}
    app.exit(1);
  });

app.on('window-all-closed', () => { /* живём в трее */ });

let quitting = false;

app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  app.isQuitting = true;
  bootLog('before-quit: cleanup started');

  destroyTray();

  try {
    await Promise.race([
      srv?.close?.(),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    bootLog('before-quit: srv closed (or timed out)');
  } catch (err) {
    bootLog(`before-quit: srv close error: ${err?.message || err}`);
  }

  bootLog('before-quit: calling app.exit(0)');
  app.exit(0);
});

app.on('will-quit', () => {
  bootLog('will-quit: final cleanup');
  globalShortcut.unregisterAll();
  destroyTray();
  killProcessTree();
});

app.on('activate', () => {
  if (win) { win.show(); return; }
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});