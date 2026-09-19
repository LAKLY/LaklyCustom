// core/plugin-loader.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import unzipper from 'unzipper';
import { PluginHost } from './plugin-host.js';
import { EVENTS } from '../shared/events.js';

const MAX_ZIP_SIZE = 10 * 1024 * 1024;
const MAX_EXTRACTED_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 500;
const SUPPORTED_API_VERSION = 1;
const ALLOWED_EXT = new Set([
  '.js', '.mjs', '.cjs', '.json',
  '.html', '.css',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
  '.txt', '.md',
]);

export class PluginLoader {
  constructor(pluginsDir) {
    this.pluginsDir = pluginsDir;
    this.plugins = new Map();   // id -> record
    this.handlers = new Map();  // eventName -> [{ pluginName }]
    this.io = null;
    this.roomManager = null;
  }

  /** Вызывается после создания RoomManager — тогда есть io */
  attachServer({ io, roomManager }) {
    this.io = io;
    this.roomManager = roomManager;
  }

  async load() {
    // Останавливаем все текущие workers
    for (const [, rec] of this.plugins) {
      try { await rec.host?.unload?.(); } catch {}
    }
    this.plugins.clear();
    this.handlers.clear();

    let entries = [];
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch {
      console.warn('[plugins] Папка plugins/ не найдена');
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_install_')) continue;
      if (entry.name.startsWith('_backup_')) continue;
      await this._loadOne(entry.name);
    }
  }

  async reload() { await this.load(); }

  async unloadAll() {
    for (const [id, rec] of this.plugins) {
      try { await rec.host?.unload?.(); } catch {}
      this.plugins.delete(id);
    }
    this.handlers.clear();
  }

  async unload(pluginName) {
    const rec = this.plugins.get(pluginName);
    if (!rec) return;
    try { await rec.host?.unload?.(); } catch {}
    this.plugins.delete(pluginName);

    for (const [event, list] of this.handlers) {
      const filtered = list.filter(h => h.pluginName !== pluginName);
      if (filtered.length === 0) this.handlers.delete(event);
      else this.handlers.set(event, filtered);
    }
    await this.emit(EVENTS.PLUGIN_UNLOADED, { name: pluginName });
  }

  async _loadOne(dirName) {
    const dir = path.join(this.pluginsDir, dirName);
    const rawManifest = await this._readManifest(dir);
    const manifest = this._validateManifest(rawManifest, dirName);
    if (!manifest) {
      console.warn(`[plugins] ${dirName}: невалидный manifest, пропускаем`);
      return;
    }

    const entryPath = path.join(dir, manifest.entry);
    try {
      await fs.access(entryPath, fs.constants.R_OK);
    } catch {
      console.warn(`[plugins] ${dirName}: не найден ${manifest.entry}`);
      return;
    }

    const entryUrl = pathToFileURL(entryPath).href;

    const host = new PluginHost({
      io: this.io,
      getRoom: (roomId) => this.roomManager?.getRoom(roomId) || null,
      getRoomState: (roomId) => this._buildRoomState(roomId),
    });

    let loaded;
    try {
      loaded = await host.start(entryUrl);
    } catch (err) {
      console.error(`[plugins] ${dirName}: ${err.message}`);
      return;
    }

    const record = {
      id: manifest.id,
      name: loaded.name || manifest.name,
      version: loaded.version || manifest.version,
      description: loaded.description || manifest.description,
      apiVersion: manifest.apiVersion,
      host,
      dir,
      publicDir: path.join(dir, 'public'),
      manifest,
    };

    this.plugins.set(manifest.id, record);
    this._registerHooks(manifest.id, loaded.hookNames || []);

    console.log(`[plugins] Загружен: ${manifest.id} v${record.version} (sandboxed)`);
    await this.emit(EVENTS.PLUGIN_LOADED, { name: manifest.id });
  }

  _registerHooks(pluginName, hookNames) {
    for (const event of hookNames) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push({ pluginName });
    }
  }

  _buildRoomState(roomId) {
    const room = this.roomManager?.getRoom(roomId);
    if (!room) return null;

    const players = [];
    for (const [socketId, p] of room.players) {
      players.push({
        id: p.id,
        _socketId: socketId,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
      });
    }
    return {
      players,
      gameActive: !!room.gameActive,
      activePluginName: room.activePluginName || null,
      hostSocketId: room.hostSocketId || null,
    };
  }

  cleanupRoom(roomId) {
    for (const [, rec] of this.plugins) {
      rec.host?.cleanupRoom?.(roomId);
    }
  }

  async emit(event, payload) {
    const list = this.handlers.get(event) || [];
    for (const { pluginName } of list) {
      const rec = this.plugins.get(pluginName);
      if (!rec?.host) continue;

      // Обновляем состояние комнаты в worker'е до вызова hook
      const roomId = payload?.room?.id || payload?.roomId;
      if (roomId) rec.host.updateRoomState(roomId);

      try {
        await rec.host.invoke(event, payload);
      } catch (err) {
        console.error(`[plugins] ${pluginName} → ${event}:`, err.message);
      }
    }
  }

  get(name) { return this.plugins.get(name) || null; }

  list() {
    return [...this.plugins.values()].map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      apiVersion: p.apiVersion,
    }));
  }

  // --- Установка из ZIP (без изменений) ---

  async installFromZip(zipPath) {
    const stat = await fs.stat(zipPath);
    if (stat.size > MAX_ZIP_SIZE) {
      throw new Error(`Архив слишком большой (макс ${MAX_ZIP_SIZE / 1024 / 1024} MB)`);
    }

    const ts = Date.now();
    const tmpDir = path.join(this.pluginsDir, `_install_${ts}`);
    await fs.mkdir(tmpDir, { recursive: true });

    let backupDir = null;
    let finalDir = null;

    try {
      await this._safeExtract(zipPath, tmpDir);

      const pluginRoot = await this._findPluginRoot(tmpDir);
      if (!pluginRoot) throw new Error('В архиве не найден плагин (manifest.json или index.js)');

      const rawManifest = await this._readManifest(pluginRoot);
      const manifest = this._validateManifest(rawManifest, path.basename(pluginRoot));
      if (!manifest) throw new Error('Невалидный manifest.json');

      const entryPath = path.join(pluginRoot, manifest.entry);
      try {
        await fs.access(entryPath, fs.constants.R_OK);
      } catch {
        throw new Error(`Не найден файл плагина: ${manifest.entry}`);
      }

      finalDir = path.join(this.pluginsDir, manifest.id);

      try {
        await fs.access(finalDir);
        backupDir = path.join(this.pluginsDir, `_backup_${manifest.id}_${ts}`);
        await fs.rename(finalDir, backupDir);
      } catch { /* не было старого */ }

      if (pluginRoot === tmpDir) {
        await fs.rename(tmpDir, finalDir);
      } else {
        await fs.rename(pluginRoot, finalDir);
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }

      if (backupDir) {
        await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      }

      await this.load();
      return manifest.id;
    } catch (err) {
      try {
        if (backupDir && finalDir) {
          await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
          await fs.rename(backupDir, finalDir).catch(() => {});
        }
      } catch {}
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  async _safeExtract(zipPath, destDir) {
    const directory = await unzipper.Open.file(zipPath);
    const root = path.resolve(destDir);
    let totalSize = 0;
    let fileCount = 0;

    for (const entry of directory.files) {
      const name = entry.path;
      if (name.includes('..') || path.isAbsolute(name)) {
        throw new Error(`Подозрительный путь в архиве: ${name}`);
      }
      const resolved = path.resolve(destDir, name);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`Path traversal: ${name}`);
      }
      if (entry.type === 'File') {
        const ext = path.extname(name).toLowerCase();
        if (ext && !ALLOWED_EXT.has(ext)) {
          throw new Error(`Недопустимое расширение: ${name}`);
        }
        fileCount++;
        if (fileCount > MAX_FILES) throw new Error('Слишком много файлов');
        totalSize += entry.uncompressedSize || 0;
        if (totalSize > MAX_EXTRACTED_SIZE) throw new Error('Слишком большой распакованный размер');
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        const content = await entry.buffer();
        await fs.writeFile(resolved, content);
      } else if (entry.type === 'Directory') {
        await fs.mkdir(resolved, { recursive: true });
      }
    }
  }

  async _findPluginRoot(tmpDir) {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    const rootFiles = entries.filter(e => e.isFile()).map(e => e.name);
    if (rootFiles.includes('manifest.json') || rootFiles.includes('index.js')) return tmpDir;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const inner = await fs.readdir(path.join(tmpDir, entry.name));
      if (inner.includes('manifest.json') || inner.includes('index.js')) {
        return path.join(tmpDir, entry.name);
      }
    }
    return null;
  }

  async _readManifest(dir) {
    try {
      const raw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
      return JSON.parse(raw);
    } catch { return null; }
  }

  _validateManifest(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') {
      const id = this._sanitizeId(fallbackId);
      if (!id) return null;
      console.warn(`[plugins] ${fallbackId}: нет manifest.json — legacy режим`);
      return {
        id, name: id, version: '0.0.0',
        description: '', apiVersion: SUPPORTED_API_VERSION, entry: 'index.js',
      };
    }

    const id = this._sanitizeId(raw.id || fallbackId);
    if (!id) return null;

    const apiVersion = Number.isInteger(raw.apiVersion) ? raw.apiVersion : SUPPORTED_API_VERSION;
    if (apiVersion !== SUPPORTED_API_VERSION) return null;

    const version = typeof raw.version === 'string' && /^\d+\.\d+\.\d+/.test(raw.version)
      ? raw.version
      : '0.0.0';

    const name = typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 60)
      : id;

    const description = typeof raw.description === 'string'
      ? raw.description.slice(0, 200)
      : '';

    let entry = 'index.js';
    if (raw.entry !== undefined) {
      entry = this._validateEntry(raw.entry);
      if (!entry) return null;
    }

    return { id, name, version, description, apiVersion, entry };
  }

  _validateEntry(entry) {
    if (typeof entry !== 'string' || !entry) return null;
    if (path.isAbsolute(entry)) return null;
    if (entry.includes('..')) return null;
    if (!/^[a-zA-Z0-9_\-./]+\.(js|mjs)$/.test(entry)) return null;
    return entry;
  }

  _sanitizeId(id) {
    if (typeof id !== 'string') return null;
    const clean = id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(clean)) return null;
    return clean;
  }
}