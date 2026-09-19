import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginLoader } from '../core/plugin-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('PluginLoader: загружает clicker', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  await pl.load();
  const clicker = pl.get('clicker');
  assert.ok(clicker, 'clicker должен быть загружен');
  assert.equal(clicker.version, '1.0.0');
  assert.equal(clicker.apiVersion, 1);
});

test('PluginLoader: reload не дублирует handlers', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  await pl.load();
  const before = (pl.handlers.get('core:game-action') || []).length;
  await pl.load();
  const after = (pl.handlers.get('core:game-action') || []).length;
  assert.equal(after, before, 'количество handlers не должно расти');
});

test('PluginLoader: unload удаляет handlers только этого плагина', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  await pl.load();

  const before = pl.handlers.get('core:game-action') || [];
  const clickerBefore = before.filter(h => h.pluginName === 'clicker').length;
  assert.ok(clickerBefore > 0, 'у clicker должны быть handlers до unload');

  await pl.unload('clicker');

  assert.equal(pl.get('clicker'), null, 'clicker удалён из plugins');

  const after = pl.handlers.get('core:game-action') || [];
  const clickerAfter = after.filter(h => h.pluginName === 'clicker').length;
  assert.equal(clickerAfter, 0, 'handlers clicker удалены');
});