// core/plugin-host.js
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'plugin-worker.js');

const HOOK_TIMEOUT_MS = 5000;

// Лимиты ресурсов worker'а. 128+32 МБ — с запасом для игровой логики.
const WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
};

export class PluginHost {
  /**
   * @param {object} deps
   * @param {import('socket.io').Server} deps.io
   * @param {(roomId: string) => object | null} deps.getRoom
   * @param {(roomId: string) => object | null} deps.getRoomState
   */
  constructor({ io, getRoom, getRoomState }) {
    this.io = io;
    this.getRoom = getRoom;
    this.getRoomState = getRoomState;

    this.worker = null;
    this.loaded = false;
    this.pending = new Map(); // requestId -> { resolve, reject, timer }
    this.nextRequestId = 1;

    this._readyResolve = null;
    this._loadResolve = null;
    this._unloadResolve = null;
  }

  async start(entryUrl) {
    this.worker = new Worker(WORKER_PATH, { resourceLimits: WORKER_RESOURCE_LIMITS });
    // Не держим event loop живым только из-за воркера — важно для тестов.
    this.worker.unref();

    this.worker.on('message', (msg) => this._onMessage(msg));
    this.worker.on('error', (err) => {
      console.error('[plugin-host] worker error:', err.message);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });
    this.worker.on('exit', (code) => {
      if (code !== 0) console.warn(`[plugin-host] worker exited code=${code}`);
    });

    await new Promise((resolve) => { this._readyResolve = resolve; });

    const loaded = await new Promise((resolve) => {
      this._loadResolve = resolve;
      this.worker.postMessage({ type: 'load', entryUrl });
    });

    if (!loaded.ok) throw new Error(loaded.error || 'plugin load failed');
    this.loaded = true;

    // Гарантированно отпускаем event loop main-процесса.
    // Первый unref() был сразу после new Worker(), но .on('message')
    // мог его случайно снова задёрнуть — важно для тестового раннера.
    try { this.worker.unref(); } catch {}

    return {
      name: loaded.name,
      version: loaded.version,
      description: loaded.description,
      hookNames: loaded.hookNames || [],
    };
  }

  async unload() {
    if (!this.worker) return;
    const w = this.worker;

    try {
      await new Promise((resolve) => {
        this._unloadResolve = resolve;
        w.postMessage({ type: 'unload' });
      });
    } catch { /* ignore */ }

    try { w.postMessage({ type: 'shutdown' }); } catch {}

    // Форсированно убиваем worker, если он не завершится за 500 мс.
    // unref() — чтобы этот таймер не держал event loop.
    setTimeout(() => {
      try { w.terminate(); } catch {}
    }, 500).unref();

    this.worker = null;
    this.loaded = false;
  }

  cleanupRoom(roomId) {
    if (!this.worker || !this.loaded) return;
    this.worker.postMessage({ type: 'cleanupRoom', roomId });
  }

  updateRoomState(roomId) {
    if (!this.worker || !this.loaded) return;
    const roomState = this.getRoomState?.(roomId);
    if (!roomState) return;
    this.worker.postMessage({ type: 'updateRoomState', roomId, roomState });
  }

  async invoke(hookName, payload) {
    if (!this.worker || !this.loaded) return undefined;

    const roomId = payload?.room?.id || payload?.roomId || '_';
    const roomState = this.getRoomState?.(roomId) || null;

    const requestId = this.nextRequestId++;
    const args = this._sanitizePayload(payload);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        console.warn(`[plugin-host] hook ${hookName} timeout (${HOOK_TIMEOUT_MS}ms)`);
        resolve(undefined);
      }, HOOK_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: () => { clearTimeout(timer); resolve(undefined); },
      });

      this.worker.postMessage({
        type: 'hook',
        hookName,
        roomId,
        roomState,
        args,
        requestId,
      });
    });
  }

  _sanitizePayload(payload) {
    const out = {};
    for (const [k, v] of Object.entries(payload || {})) {
      if (k === 'io' || k === 'pluginLoader') continue;
      if (k === 'room') {
        out.room = { id: v?.id || null };
      } else if (k === 'socket') {
        out.socket = { id: v?.id || null };
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this._readyResolve?.();
        this._readyResolve = null;
        break;

      case 'loaded':
        this._loadResolve?.(msg);
        this._loadResolve = null;
        break;

      case 'unloaded':
        this._unloadResolve?.();
        this._unloadResolve = null;
        break;

      case 'hookResult': {
        const p = this.pending.get(msg.requestId);
        if (!p) break;
        this.pending.delete(msg.requestId);
        if (msg.ok) p.resolve(msg.result);
        else {
          console.warn(`[plugin-host] hook error: ${msg.error}`);
          p.reject(new Error(msg.error));
        }
        break;
      }

      case 'broadcast': {
        const room = this.getRoom(msg.roomId);
        if (room) room.broadcast(msg.event, msg.data);
        break;
      }

      case 'emitTo': {
        if (msg.socketId) this.io.to(msg.socketId).emit(msg.event, msg.data);
        break;
      }

      case 'addMessage': {
        const room = this.getRoom(msg.roomId);
        if (room) room.addMessage(msg.sender, msg.color, msg.text);
        break;
      }
    }
  }
}