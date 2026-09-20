// core/plugin-worker.js
import { parentPort } from 'node:worker_threads';

let plugin = null;
const roomEntries = new Map();

function send(msg) {
  try { parentPort.postMessage(msg); } catch {}
}
function debug(step, extra) {
  send({ type: 'debug', step, extra: extra || null });
}

process.on('uncaughtException', (e) => {
  debug('uncaught', e?.stack || String(e));
});
process.on('unhandledRejection', (e) => {
  debug('unhandled', e?.stack || String(e));
});

function applyRoomState(roomId, roomState) {
  if (!roomState) return;
  const entry = ensureRoomEntry(roomId);
  const s = entry.state;
  s.players = Array.isArray(roomState.players) ? roomState.players : [];
  s.gameActive = !!roomState.gameActive;
  s.isActive = !!roomState.isActive;
  s.activePluginName = roomState.activePluginName || null;
  s.hostSocketId = roomState.hostSocketId || null;
}

function ensureRoomEntry(roomId) {
  let entry = roomEntries.get(roomId);
  if (entry) return entry;

  const state = {
    id: roomId, players: [], gameActive: false, isActive: true,
    activePluginName: null, hostSocketId: null,
  };

  const proxy = {
    get id() { return state.id; },
    get gameActive() { return state.gameActive; },
    get isActive() { return state.isActive; },
    get activePluginName() { return state.activePluginName; },
    get hostSocketId() { return state.hostSocketId; },
    get players() {
      const m = new Map();
      for (const p of state.players) m.set(p._socketId || p.id, p);
      return m;
    },
    get playerCount() { return state.players.length; },
    broadcast(event, data) { send({ type: 'broadcast', roomId, event, data }); },
    emitTo(socketId, event, data) { send({ type: 'emitTo', roomId, socketId, event, data }); },
    addMessage(sender, color, text) { send({ type: 'addMessage', roomId, sender, color, text }); },
  };

  entry = { proxy, state };
  roomEntries.set(roomId, entry);
  return entry;
}

function buildHookArgs(rawArgs, roomId) {
  const out = {};
  for (const [key, value] of Object.entries(rawArgs || {})) {
    if (key === 'room') out.room = ensureRoomEntry(roomId).proxy;
    else if (key === 'socket') {
      const sid = value?.id;
      out.socket = {
        id: sid,
        emit(event, data) {
          if (!sid) return;
          send({ type: 'emitTo', roomId, socketId: sid, event, data });
        },
      };
    } else if (key === 'io' || key === 'pluginLoader') {
      continue;
    } else {
      out[key] = value;
    }
  }
  return out;
}

parentPort.on('message', async (msg) => {
  debug('msg-received', msg?.type);
  try {
    switch (msg.type) {
      case 'load': {
        debug('load-start', msg.entryUrl);
        try {
          const mod = await import(msg.entryUrl);
          plugin = mod.default;
          debug('load-imported', { hasDefault: !!plugin });
        } catch (err) {
          debug('load-import-failed', err?.stack || err?.message || String(err));
          send({ type: 'loaded', ok: false, error: `import failed: ${err.message}` });
          return;
        }

        if (!plugin || typeof plugin !== 'object') {
          debug('load-no-default');
          send({ type: 'loaded', ok: false, error: 'нет default export' });
          return;
        }

        if (typeof plugin.onConfig === 'function') {
          try { await plugin.onConfig(msg.config || null); debug('load-onconfig-ok'); }
          catch (err) { debug('load-onconfig-error', err.message); }
        }

        const hookNames = Object.keys(plugin.hooks || {}).filter(
          k => typeof plugin.hooks[k] === 'function'
        );
        debug('load-hooks', hookNames.join(',') || '(none)');

        send({
          type: 'loaded', ok: true,
          name: plugin.name, version: plugin.version,
          description: plugin.description, hookNames,
        });
        debug('load-done');
        break;
      }

      case 'hook': {
        const { hookName, roomId, args, requestId, roomState } = msg;
        if (!plugin) {
          send({ type: 'hookResult', requestId, ok: false, error: 'плагин не загружен' });
          return;
        }
        applyRoomState(roomId, roomState);
        const hook = plugin.hooks?.[hookName];
        if (typeof hook !== 'function') {
          send({ type: 'hookResult', requestId, ok: true, result: undefined });
          return;
        }
        const prepared = buildHookArgs(args, roomId);
        const result = await hook(prepared);
        send({ type: 'hookResult', requestId, ok: true, result });
        break;
      }

      case 'updateRoomState': applyRoomState(msg.roomId, msg.roomState); break;
      case 'cleanupRoom': roomEntries.delete(msg.roomId); break;

      case 'unload': {
        try { await plugin?.onUnload?.(); } catch {}
        plugin = null;
        roomEntries.clear();
        send({ type: 'unloaded', ok: true });
        break;
      }

      case 'shutdown': process.exit(0); break;
    }
  } catch (err) {
    debug('handler-error', err?.stack || err?.message || String(err));
    send({
      type: 'hookResult', requestId: msg?.requestId,
      ok: false, error: err?.message || String(err),
    });
  }
});

debug('ready-sending');
send({ type: 'ready' });