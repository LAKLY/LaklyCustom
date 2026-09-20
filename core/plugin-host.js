// core/plugin-host.js
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'plugin-worker.js');

const HOOK_TIMEOUT_MS = 5000;
const READY_TIMEOUT_MS = 10_000;

const WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
};

export class PluginHost {
  constructor({ io, getRoom, getRoomState }) {
    this.io = io;
    this.getRoom = getRoom;
    this.getRoomState = getRoomState;

    this.worker = null;
    this.loaded = false;
    this.pending = new Map();
    this.nextRequestId = 1;

    this._readyResolve = null;
    this._readyError = null;
    this._loadResolve = null;
    this._unloadResolve = null;
  }

  async start(entryUrl, config = null) {
    console.log(`[plugin-host] start: entryUrl=${entryUrl}`);
    console.log(`[plugin-host] WORKER_PATH=${WORKER_PATH}`);

    this._readyError = null;

    try {
      this.worker = new Worker(WORKER_PATH, {
        resourceLimits: WORKER_RESOURCE_LIMITS,
      });
      console.log('[plugin-host] worker constructed');
    } catch (err) {
      console.error(`[plugin-host] worker construction failed: ${err.stack || err}`);
      throw err;
    }

    this.worker.on('online', () => console.log('[plugin-host] worker online'));
    this.worker.on('message', (msg) => {
      console.log(`[plugin-host] <- ${msg?.type}`);
      this._onMessage(msg);
    });
    this.worker.on('error', (err) => {
      console.error(`[plugin-host] worker error: ${err.stack || err}`);
      if (this._readyResolve) {
        this._readyError = err;
        const r = this._readyResolve;
        this._readyResolve = null;
        r();
      }
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });
    this.worker.on('exit', (code) => {
      console.log(`[plugin-host] worker exited code=${code}`);
      if (this._readyResolve) {
        this._readyError = new Error(`worker exited code=${code}`);
        const r = this._readyResolve;
        this._readyResolve = null;
        r();
      }
    });

    // ─── Ждём ready с таймаутом ─────────────────────────────
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[plugin-host] worker ready timeout (${READY_TIMEOUT_MS}ms)`);
      if (this._readyResolve) {
        const r = this._readyResolve;
        this._readyResolve = null;
        r();
      }
    }, READY_TIMEOUT_MS);
    timer.unref?.();

    await new Promise((resolve) => { this._readyResolve = resolve; });
    clearTimeout(timer);

    if (timedOut) {
      try { await this.worker.terminate(); } catch {}
      this.worker = null;
      this.loaded = false;
      throw new Error('worker failed to start (timeout)');
    }
    if (this._readyError) {
      try { await this.worker.terminate(); } catch {}
      this.worker = null;
      this.loaded = false;
      throw this._readyError;
    }

    console.log('[plugin-host] ready received, sending load command');

    let loadTimedOut = false;
    const loadTimer = setTimeout(() => {
      loadTimedOut = true;
      console.error(`[plugin-host] load timeout (${READY_TIMEOUT_MS}ms)`);
      if (this._loadResolve) {
        const r = this._loadResolve;
        this._loadResolve = null;
        r({ ok: false, error: 'load timeout' });
      }
    }, READY_TIMEOUT_MS);
    loadTimer.unref?.();

    const loaded = await new Promise((resolve) => {
      this._loadResolve = resolve;
      this.worker.postMessage({ type: 'load', entryUrl, config });
    });
    clearTimeout(loadTimer);

    if (loadTimedOut) {
      try { await this.worker.terminate(); } catch {}
      this.worker = null;
      throw new Error('load timeout');
    }

    if (!loaded.ok) {
      console.error(`[plugin-host] plugin load failed: ${loaded.error}`);
      throw new Error(loaded.error || 'plugin load failed');
    }
    this.loaded = true;

    console.log(`[plugin-host] plugin loaded: ${loaded.name} v${loaded.version}`);

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
      await Promise.race([
        new Promise((resolve) => {
          this._unloadResolve = resolve;
          w.postMessage({ type: 'unload' });
        }),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    } catch { }

    try { w.postMessage({ type: 'shutdown' }); } catch {}

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try { w.terminate(); } catch {}
        finish();
      }, 500);
      w.once('exit', finish);
    });

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
      if (k === 'room') out.room = { id: v?.id || null };
      else if (k === 'socket') out.socket = { id: v?.id || null };
      else out[k] = v;
    }
    return out;
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        console.log('[plugin-host] ready signal received');
        if (this._readyResolve) {
          const r = this._readyResolve;
          this._readyResolve = null;
          r();
        }
        break;

      case 'loaded':
        if (this._loadResolve) {
          const r = this._loadResolve;
          this._loadResolve = null;
          r(msg);
        }
        break;

      case 'unloaded':
        if (this._unloadResolve) {
          const r = this._unloadResolve;
          this._unloadResolve = null;
          r();
        }
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

      default:
        console.warn(`[plugin-host] unknown message type: ${msg?.type}`);
    }
  }
}