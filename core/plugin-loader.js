// core/plugin-loader.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import unzipper from 'unzipper';
import { EVENTS } from '../shared/events.js';

const MAX_ZIP_SIZE = 10 * 1024 * 1024;          // 10 MB
const MAX_EXTRACTED_SIZE = 50 * 1024 * 1024;    // 50 MB
const MAX_FILES = 500;
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
    this.handlers = new Map();  // eventName -> [{ pluginName, handler }]
  }

  async load() {
    // Сброс критичен — иначе при reload обработчики накапливаются
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
      if (entry.name.startsWith('_install_')) continue; // временные
      await this._loadOne(entry.name);
    }
  }

  async reload() { await this.load(); }

  async unload(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;
    try { await plugin.entry.onUnload?.(); }
    catch (err) { console.error(`[plugins] ${pluginName} onUnload:`, err.message); }

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
    const manifest = await this._readManifest(dir);

    const entryFile = manifest?.entry || 'index.js';
    const entryPath = path.join(dir, entryFile);

    try {
      const url = pathToFileURL(entryPath).href;
      const mod = await import(url);
      const plugin = mod.default;
      if (!plugin || typeof plugin !== 'object') {
        console.warn(`[plugins] ${dirName}: нет default export`);
        return;
      }

      const id = this._sanitizeId(manifest?.id || plugin.name || dirName);
      if (!id) {
        console.warn(`[plugins] ${dirName}: некорректный id`);
        return;
      }

      const record = {
        id,
        name: plugin.name || manifest?.name || dirName,
        version: plugin.version || manifest?.version || '0.0.0',
        description: plugin.description || manifest?.description || '',
        apiVersion: manifest?.apiVersion || 1,
        entry: plugin,
        dir,
        publicDir: path.join(dir, 'public'),
        manifest,
      };

      this.plugins.set(id, record);
      this._registerHooks(id, plugin);
      console.log(`[plugins] Загружен: ${id} v${record.version}`);
      await this.emit(EVENTS.PLUGIN_LOADED, { name: id });
    } catch (err) {
      console.error(`[plugins] Ошибка ${dirName}:`, err.message);
    }
  }

  _registerHooks(pluginName, plugin) {
    if (!plugin.hooks || typeof plugin.hooks !== 'object') return;
    for (const [event, handler] of Object.entries(plugin.hooks)) {
      if (typeof handler !== 'function') continue;
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push({ pluginName, handler });
    }
  }

  async emit(event, payload) {
    const list = this.handlers.get(event) || [];
    for (const { pluginName, handler } of list) {
      try { await handler(payload); }
      catch (err) { console.error(`[plugins] ${pluginName} → ${event}:`, err.message); }
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

  // --- Установка из ZIP ---

  async installFromZip(zipPath) {
    const stat = await fs.stat(zipPath);
    if (stat.size > MAX_ZIP_SIZE) {
      throw new Error(`Архив слишком большой (макс ${MAX_ZIP_SIZE / 1024 / 1024} MB)`);
    }

    const tmpDir = path.join(this.pluginsDir, `_install_${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      await this._safeExtract(zipPath, tmpDir);

      const pluginRoot = await this._findPluginRoot(tmpDir);
      if (!pluginRoot) throw new Error('В архиве не найден плагин (manifest.json или index.js)');

      const manifest = await this._readManifest(pluginRoot);
      const rawId = manifest?.id || path.basename(pluginRoot);
      const safeId = this._sanitizeId(rawId);
      if (!safeId) throw new Error(`Некорректный id плагина: ${rawId}`);

      const finalDir = path.join(this.pluginsDir, safeId);
      await fs.rm(finalDir, { recursive: true, force: true });

      if (pluginRoot === tmpDir) {
        await fs.rename(tmpDir, finalDir);
      } else {
        await fs.rename(pluginRoot, finalDir);
        await fs.rm(tmpDir, { recursive: true, force: true });
      }

      await this.load();
      return safeId;
    } catch (err) {
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

  _sanitizeId(id) {
    if (typeof id !== 'string') return null;
    const clean = id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(clean)) return null;
    return clean;
  }
}