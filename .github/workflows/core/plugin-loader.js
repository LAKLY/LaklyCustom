import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class PluginLoader {
  constructor(pluginsDir) {
    this.pluginsDir = pluginsDir;
    this.plugins = new Map();
    this.handlers = new Map();
  }

  async load() {
    let entries = [];
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch (err) {
      console.warn('[plugins] Папка plugins/ не найдена');
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginName = entry.name;
      const indexPath = path.join(this.pluginsDir, pluginName, 'index.js');
      try {
        const url = pathToFileURL(indexPath).href;
        const mod = await import(url);
        const plugin = mod.default;
        if (!plugin || typeof plugin !== 'object') {
          console.warn(`[plugins] ${pluginName}: не экспортирует default`);
          continue;
        }
        this.plugins.set(pluginName, {
          name: plugin.name || pluginName,
          version: plugin.version || '0.0.0',
          description: plugin.description || '',
          entry: plugin,
          publicDir: path.join(this.pluginsDir, pluginName, 'public'),
        });
        this._registerHooks(pluginName, plugin);
        console.log(`[plugins] Загружен: ${pluginName} v${plugin.version || '0.0.0'}`);
      } catch (err) {
        console.error(`[plugins] Ошибка ${pluginName}:`, err.message);
      }
    }
  }

  async installFromZip(zipPath, app) {
    const extractDir = path.join(this.pluginsDir, `_install_${Date.now()}`);
    await fs.mkdir(extractDir, { recursive: true });
    
    return new Promise((resolve, reject) => {
      app.getPath('temp'); // placeholder
      const unzipper = require('unzipper');
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', async () => {
          // Ищем папку с манифестом (index.js)
          const files = await fs.readdir(extractDir, { withFileTypes: true });
          let pluginDir = null;
          for (const f of files) {
            if (f.isDirectory()) {
              const inner = await fs.readdir(path.join(extractDir, f.name));
              if (inner.includes('index.js')) {
                pluginDir = path.join(extractDir, f.name);
                break;
              }
            }
          }
          if (!pluginDir) {
            // Плагин может быть в корне
            const rootFiles = await fs.readdir(extractDir);
            if (rootFiles.includes('index.js')) {
              pluginDir = extractDir;
            }
          }
          
          if (!pluginDir) {
            await fs.rm(extractDir, { recursive: true, force: true });
            return reject(new Error('В архиве не найден index.js плагина'));
          }
          
          // Перемещаем в plugins/<name>
          const pluginName = path.basename(pluginDir);
          const finalDir = path.join(this.pluginsDir, pluginName);
          await fs.rm(finalDir, { recursive: true, force: true });
          await fs.rename(pluginDir, finalDir);
          await fs.rm(extractDir, { recursive: true, force: true });
          
          // Перезагружаем плагины
          await this.load();
          resolve(pluginName);
        })
        .on('error', reject);
    });
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
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[plugins] ${pluginName} → ${event}:`, err.message);
      }
    }
  }

  get(name) { return this.plugins.get(name) || null; }
  list() {
    return [...this.plugins.values()].map(p => ({
      name: p.name, version: p.version, description: p.description,
    }));
  }
}