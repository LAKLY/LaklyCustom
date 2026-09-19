// tests/hardening.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from '../core/room.js';
import { EVENTS } from '../shared/events.js';
import { PluginLoader } from '../core/plugin-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function makeMockSocket(id) {
  return {
    id,
    join: () => {},
    leave: () => {},
    emit: () => {},
  };
}

function makeMockIo() {
  return { to: () => ({ emit: () => {} }) };
}

function makeMockPluginLoader() {
  const emitted = [];
  const plugins = new Map([['clicker', { id: 'clicker' }]]);
  return {
    plugins,
    get(name) { return plugins.get(name); },
    emit: async (ev, payload) => { emitted.push({ ev, payload }); },
    _emitted: emitted,
  };
}

function makeRoom() {
  const hostSocket = makeMockSocket('host-1');
  const pluginLoader = makeMockPluginLoader();
  const room = new Room({
    name: 'test',
    hostSocket,
    io: makeMockIo(),
    pluginLoader,
    pluginName: 'clicker',
  });
  return { room, pluginLoader };
}

test('Room: game:action игнорируется, если игра не запущена', async () => {
  const { room, pluginLoader } = makeRoom();
  const guestSocket = makeMockSocket('g-1');
  room.players.set('g-1', { id: 'p1', name: 'A', color: '#000' });

  await room.handleGameAction(guestSocket, 'click', {});
  let actions = pluginLoader._emitted.filter(e => e.ev === EVENTS.GAME_ACTION);
  assert.equal(actions.length, 0, 'действия без игры должны отбрасываться');

  await room.startGame('clicker');
  await room.handleGameAction(guestSocket, 'click', {});
  actions = pluginLoader._emitted.filter(e => e.ev === EVENTS.GAME_ACTION);
  assert.equal(actions.length, 1, 'после старта игры — один эмит');
});

test('Room: GAME_ACTION содержит имя активного плагина', async () => {
  const { room, pluginLoader } = makeRoom();
  await room.startGame('clicker');
  const guestSocket = makeMockSocket('g-1');
  room.players.set('g-1', { id: 'p1', name: 'A', color: '#000' });

  await room.handleGameAction(guestSocket, 'click', {});
  const payload = pluginLoader._emitted.find(e => e.ev === EVENTS.GAME_ACTION)?.payload;
  assert.equal(payload.plugin, 'clicker');
});

test('Room: ROOM_CLOSED эмитится после очистки игроков', async () => {
  const { room, pluginLoader } = makeRoom();
  room.players.set('g-1', { id: 'p1', name: 'A', color: '#000' });

  await room.close('test');

  const closedEvent = pluginLoader._emitted.find(e => e.ev === EVENTS.ROOM_CLOSED);
  assert.ok(closedEvent, 'ROOM_CLOSED должен быть эмитнут');
  assert.equal(closedEvent.payload.room.players.size, 0, 'к ROOM_CLOSED игроки уже очищены');

  const destroyedEvent = pluginLoader._emitted.find(e => e.ev === EVENTS.ROOM_DESTROYED);
  assert.ok(destroyedEvent);
  assert.equal(destroyedEvent.payload.roomId, room.id);
});

test('PluginLoader: манифест с невалидным id не загружается', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  const result = pl._validateManifest({ id: '../evil', version: '1.0.0', apiVersion: 1 }, 'evil');
  assert.equal(result, null);
});

test('PluginLoader: манифест с небезопасным entry отклоняется', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  const result = pl._validateManifest({
    id: 'good',
    version: '1.0.0',
    apiVersion: 1,
    entry: '../../../../etc/passwd.js',
  }, 'good');
  assert.equal(result, null);
});

test('PluginLoader: apiVersion > supported отклоняется', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  const result = pl._validateManifest({
    id: 'good',
    version: '1.0.0',
    apiVersion: 99,
  }, 'good');
  assert.equal(result, null);
});

test('PluginLoader: валидный манифест проходит', async () => {
  const pl = new PluginLoader(path.join(ROOT, 'plugins'));
  const result = pl._validateManifest({
    id: 'valid-plugin',
    name: 'Valid',
    version: '2.3.1',
    apiVersion: 1,
    entry: 'src/main.js',
    description: 'desc',
  }, 'valid-plugin');
  assert.ok(result);
  assert.equal(result.id, 'valid-plugin');
  assert.equal(result.version, '2.3.1');
  assert.equal(result.entry, 'src/main.js');
});