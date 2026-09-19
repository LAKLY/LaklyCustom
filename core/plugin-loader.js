// core/plugin-loader.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import unzipper from 'unzipper';
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
    this.plugins = new Map();
    this.handlers = new Map();
  }

  async load() {
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
    const rawManifest = await this._readManifest(dir);
    const manifest = this._validateManifest(rawManifest, dirName);

    if (!manifest) {
      console.warn(`[plugins] ${dirName}: невалидный manifest, пропускаем`);
      return;
    }

    const entryPath = path.join(dir, manifest.entry);

    try {
      // Проверяем, что entry существует до импорта
      await fs.access(entryPath, fs.constants.R_OK);

      const url = pathToFileURL(entryPath).href;
      const mod = await import(url);
      const plugin = mod.default;
      if (!plugin || typeof plugin !== 'object') {
        console.warn(`[plugins] ${dirName}: нет default export`);
        return;
      }

      const record = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        apiVersion: manifest.apiVersion,
        entry: plugin,
        dir,
        publicDir: path.join(dir, 'public'),
        manifest,
      };

      // Транзакционно: сначала плагин, потом hooks, потом событие
      this._registerHooks(manifest.id, plugin);
      this.plugins.set(manifest.id, record);
      console.log(`[plugins] Загружен: ${manifest.id} v${manifest.version}`);
      await this.emit(EVENTS.PLUGIN_LOADED, { name: manifest.id });
    } catch (err) {
      // Откат регистрации при падении
      this.plugins.delete(manifest.id);
      for (const [event, list] of this.handlers) {
        const filtered = list.filter(h => h.pluginName !== manifest.id);
        if (filtered.length === 0) this.handlers.delete(event);
        else this.handlers.set(event, filtered);
      }
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

  // --- Установка из ZIP (атомарная) ---

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

      // Проверяем, что entry существует
      const entryPath = path.join(pluginRoot, manifest.entry);
      try {
        await fs.access(entryPath, fs.constants.R_OK);
      } catch {
        throw new Error(`Не найден файл плагина: ${manifest.entry}`);
      }

      finalDir = path.join(this.pluginsDir, manifest.id);

      // Бэкап существующего
      try {
        await fs.access(finalDir);
        backupDir = path.join(this.pluginsDir, `_backup_${manifest.id}_${ts}`);
        await fs.rename(finalDir, backupDir);
      } catch { /* не было старого */ }

      // Переносим новый плагин
      if (pluginRoot === tmpDir) {
        // плагин лежал в корне архива — переименовываем сам tmpDir
        await fs.rename(tmpDir, finalDir);
      } else {
        await fs.rename(pluginRoot, finalDir);
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }

      // Успех — удаляем бэкап
      if (backupDir) {
        await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      }

      await this.load();
      return manifest.id;
    } catch (err) {
      // Откат: возвращаем backup на место
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

  /**
   * Валидирует manifest строго. Возвращает объект с полями { id, name, version,
   * description, apiVersion, entry } или null, если manifest невалиден.
   */
  _validateManifest(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') {
      // Legacy fallback: плагины без manifest.json.
      // Работает, но с предупреждением. В 0.9 станет opt-in через флаг,
      // в 1.0 — обязательный manifest.
      const id = this._sanitizeId(fallbackId);
      if (!id) return null;
      console.warn(`[plugins] ${fallbackId}: нет manifest.json — legacy режим. Добавьте manifest для совместимости с будущими версиями.`);
      return {
        id,
        name: id,
        version: '0.0.0',
        description: '',
        apiVersion: SUPPORTED_API_VERSION,
        entry: 'index.js',
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

    // entry: если поле указано — оно должно быть валидным, иначе отклоняем манифест.
    // Если поля нет — используем дефолт 'index.js' (для legacy-плагинов).
    let entry = 'index.js';
    if (raw.entry !== undefined) {
    entry = this._validateEntry(raw.entry);
    if (!entry) return null;
    }

    return { id, name, version, description, apiVersion, entry };
  }

  /**
   * entry должен быть безопасным относительным путём к .js/.mjs файлу.
   */
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