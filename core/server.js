// core/server.js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './room-manager.js';
import { PluginLoader } from './plugin-loader.js';
import { TunnelSupervisor } from './tunnel-supervisor.js';
import { EVENTS } from '../shared/events.js';
import {
  validatePlayerName, validateChatMessage, validateRoomName,
  validatePluginId, validateGameAction,
} from '../shared/validation.js';
import { RateLimiter, RATE_LIMITS } from '../shared/rate-limit.js';
import {
  isPortOpen, probePort, scanPorts, describePort, createProxyServer,
} from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROXY_CHECK_RATE = { max: 30, windowMs: 60_000 };

// ─── Мини-i18n для сервера (HTTP ошибки) ───────────────────
// Серверные ошибки в socket.io шлём ключами — клиент переведёт сам.
// HTTP-ответы JSON тоже ключами — UI/guest переведёт сам.
// Единственное где нужен переведённый текст на сервере —
// это HTML страница ошибки прокси (см. core/proxy.js).
function buildCorsOrigin() {
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    try {
      const u = new URL(origin);
      const host = u.hostname;
      if (
        host === 'localhost' || host === '127.0.0.1' ||
        host.endsWith('.trycloudflare.com') ||
        host.endsWith('.ngrok-free.app') ||
        host.endsWith('.ngrok.io') ||
        host.endsWith('.ngrok-free.dev')
      ) return cb(null, true);
    } catch {}
    cb(new Error('Origin not allowed'));
  };
}

function isLocalRequest(req) {
  if (req.headers['cf-connecting-ip']) return false;
  const xff = req.headers['x-forwarded-for'];
  if (xff && String(xff).trim() !== '') return false;

  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1'
      || ip === '::1'
      || ip === '::ffff:127.0.0.1';
}

export async function startServer({
  port = 3000,
  hooks = {},
  isAllowedStaticDir = () => false,
  pluginDataDir = path.join(ROOT, 'plugin-data'),
} = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: buildCorsOrigin() } });

  app.use(express.json({ limit: '128kb' }));

  const pluginsDir = process.env.LAKLY_RESOURCES
    ? path.join(process.env.LAKLY_RESOURCES, 'plugins')
    : path.join(ROOT, 'plugins');

  const pluginLoader = new PluginLoader(pluginsDir, { pluginDataDir });
  const roomManager = new RoomManager(io, pluginLoader);
  pluginLoader.attachServer({ io, roomManager });
  await pluginLoader.load();

  const limiter = new RateLimiter();
  let tunnelSupervisor = null;

  const pruneTimer = setInterval(() => limiter.prune(), 5 * 60 * 1000);
  pruneTimer.unref?.();

  const noCache = { etag: false, lastModified: false, cacheControl: false };
  const proxyServer = createProxyServer();

  httpServer.on('upgrade', (req, socket, head) => {
    if (typeof req.url !== 'string') return;
    if (req.url.startsWith('/socket.io/')) return;

    const proxyRoom = roomManager.findActive('proxy');
    if (!proxyRoom || !proxyRoom.proxyPort) return;

    const opts = proxyRoom.options || {};
    if (opts.ws === false) return;

    const target = `http://127.0.0.1:${proxyRoom.proxyPort}`;
    proxyServer.ws(req, socket, head, {
      target,
      changeOrigin: opts.changeOrigin !== false,
      secure: !opts.insecure,
    });
  });

  // ─── API ────────────────────────────────────────────────────
  app.get('/api/room', (_req, res) => {
    const first = roomManager.findActive();
    if (!first) return res.json({ isActive: false, players: [] });
    res.json({
      isActive: true,
      roomName: first.name,
      publicUrl: first.publicUrl,
      gameActive: first.gameActive,
      activePlugin: first.activePluginName,
      type: first.type,
      proxyPort: first.proxyPort,
      ...first.publicPlayers(),
      messages: first.messages.slice(-50),
    });
  });

  app.get('/api/plugins', (_req, res) => {
    res.json({ plugins: pluginLoader.list() });
  });

  // ─── i18n ───────────────────────────────────────────────────
  const localesDir = process.env.LAKLY_RESOURCES
    ? path.join(process.env.LAKLY_RESOURCES, 'shared', 'locales')
    : path.join(ROOT, 'shared', 'locales');
  app.use('/locales', express.static(localesDir, {
    etag: true,
    lastModified: true,
    maxAge: '1h',
  }));

  app.get('/api/language', (_req, res) => {
    res.json({ language: process.env.LAKLY_LANG || 'ru' });
  });

  // ─── Конфиг плагина ────────────────────────────────────────
  app.get('/api/plugins/:id/config', async (req, res) => {
    try {
      const { id } = req.params;
      if (!pluginLoader.get(id)) return res.status(404).json({ error: 'error.plugin_not_found' });
      const { config, isDefault } = await pluginLoader.readConfig(id);
      res.json({ config, isDefault });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/plugins/:id/config', async (req, res) => {
    try {
      const { id } = req.params;
      if (!pluginLoader.get(id)) return res.status(404).json({ error: 'error.plugin_not_found' });
      const body = req.body?.config;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'error.config_must_be_object' });
      }
      await pluginLoader.saveConfig(id, body);
      await pluginLoader.reloadOne(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/plugins/:id', async (req, res) => {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'error.forbidden' });
    }
    try {
      const { id } = req.params;
      if (!pluginLoader.get(id)) {
        return res.status(404).json({ error: 'error.plugin_not_found' });
      }
      if (pluginLoader.isBuiltin(id)) {
        return res.status(400).json({ error: 'error.plugin_builtin_protected' });
      }

      const room = roomManager.findActive();
      if (room && room.activePluginName === id && room.gameActive) {
        try { await room.stopGame(); } catch (e) {
          console.warn('[plugins] stopGame перед удалением:', e.message);
        }
      }

      await pluginLoader.uninstall(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/qr', async (_req, res) => {
    const first = roomManager.findActive();
    if (!first || !first.publicUrl) return res.status(400).json({ error: 'error.no_room' });
    try {
      const qr = await QRCode.toDataURL(first.publicUrl, { margin: 1, width: 260 });
      res.json({ qr });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Proxy probe ───────────────────────────────────────────
  app.post('/api/proxy/check', async (req, res) => {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ ok: false, error: 'error.forbidden' });
    }
    const ip = req.ip || 'unknown';
    if (!limiter.check(`proxy-check:${ip}`, PROXY_CHECK_RATE)) {
      return res.status(429).json({ ok: false, error: 'error.too_fast' });
    }
    const p = Number(req.body?.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return res.status(400).json({ ok: false, error: 'error.invalid_port' });
    }
    if (p === httpServer.address()?.port) {
      return res.json({ ok: false, error: 'error.own_port' });
    }
    const open = await isPortOpen(p);
    if (!open) return res.json({ ok: false, error: 'error.port_closed', vars: { port: p } });
    const probe = await probePort(p);
    return res.json({ ok: true, port: p, hint: describePort(p), probe });
  });

  app.get('/api/proxy/scan', async (req, res) => {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'error.forbidden' });
    }
    const ip = req.ip || 'unknown';
    if (!limiter.check(`proxy-scan:${ip}`, PROXY_CHECK_RATE)) {
      return res.status(429).json({ error: 'error.too_fast' });
    }
    try {
      const list = await scanPorts();
      res.json({ ports: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Статика ────────────────────────────────────────────────
  app.use('/host', express.static(path.join(ROOT, 'ui'), noCache));
  app.use('/assets', express.static(path.join(ROOT, 'assets'), noCache));
  app.use('/plugins/:pluginId', (req, res, next) => {
    const plugin = pluginLoader.get(req.params.pluginId);
    if (!plugin) return next();
    express.static(plugin.publicDir, noCache)(req, res, next);
  });

  // ─── Proxy runtime ─────────────────────────────────────────
  app.use((req, res, next) => {
    if (req.path.startsWith('/socket.io/')) return next();
    const proxyRoom = roomManager.findActive('proxy');
    if (!proxyRoom || !proxyRoom.proxyPort) return next();

    const opts = proxyRoom.options || {};
    const timeoutMs = (Number(opts.timeoutSec) || 20) * 1000;
    const target = `http://127.0.0.1:${proxyRoom.proxyPort}`;

    return proxyServer.web(req, res, {
      target,
      changeOrigin: opts.changeOrigin !== false,
      secure: !opts.insecure,
      timeout: timeoutMs,
      proxyTimeout: timeoutMs,
    });
  });

  // ─── Static runtime ────────────────────────────────────────
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const staticRoom = roomManager.findActive('static');
    if (!staticRoom || !staticRoom.staticDir) return next();

    const opts = staticRoom.options || {};
    const staticOpts = {
      etag: !opts.noCache,
      lastModified: !opts.noCache,
      cacheControl: !opts.noCache,
      dotfiles: opts.dotFiles ? 'allow' : 'ignore',
    };

    const mw = express.static(staticRoom.staticDir, staticOpts);
    mw(req, res, (err) => {
      if (err) return next(err);
      if (opts.spaFallback) {
        return res.sendFile(path.join(staticRoom.staticDir, 'index.html'), (e) => {
          if (e) next();
        });
      }
      next();
    });
  });

  // ─── Default статика ───────────────────────────────────────
  app.use(express.static(path.join(ROOT, 'public'), noCache));

  // ─── Socket.IO ──────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log('[io] connected', socket.id);
    const ip = socket.handshake.address || 'unknown';

    socket.on('host:create-room', async (payload = {}) => {
      if (!limiter.check(`create:${ip}`, RATE_LIMITS.CREATE_ROOM)) {
        socket.emit('error', 'error.too_fast');
        return;
      }
      const name = validateRoomName(payload.roomName);
      const requestedType = (payload.type === 'static' || payload.type === 'proxy')
        ? payload.type : 'default';
      const options = (payload.options && typeof payload.options === 'object')
        ? payload.options : {};

      let staticDir = null, pluginName = null, proxyPort = null;

      if (requestedType === 'static') {
        if (typeof payload.staticDir !== 'string' || !payload.staticDir) {
          socket.emit('error', 'error.folder_not_selected'); return;
        }
        if (!isAllowedStaticDir(payload.staticDir)) {
          console.warn('[static] отклонён незарегистрированный путь:', payload.staticDir);
          socket.emit('error', 'error.folder_not_allowed'); return;
        }
        try {
          const st = await fs.stat(payload.staticDir);
          if (!st.isDirectory()) throw new Error('not a directory');
        } catch { socket.emit('error', 'error.folder_not_found'); return; }
        staticDir = payload.staticDir;
      } else if (requestedType === 'proxy') {
        const p = Number(payload.proxyPort);
        if (!Number.isInteger(p) || p < 1 || p > 65535) {
          socket.emit('error', 'error.invalid_port'); return;
        }
        if (p === httpServer.address()?.port) {
          socket.emit('error', 'error.own_port'); return;
        }
        if (!(await isPortOpen(p))) {
          socket.emit('error', { key: 'error.port_closed', vars: { port: p } }); return;
        }
        proxyPort = p;
      } else {
        pluginName = payload.pluginName ? validatePluginId(payload.pluginName) : null;
        if (pluginName && !pluginLoader.get(pluginName)) {
          socket.emit('error', 'error.plugin_not_found'); return;
        }
      }

      if (!tunnelSupervisor) {
        tunnelSupervisor = new TunnelSupervisor({
          port: httpServer.address().port,
          onUrlChange: ({ newUrl, provider }) => {
            const activeRoom = roomManager.findActive();
            if (!activeRoom) return;
            activeRoom.publicUrl = `${newUrl}?t=${activeRoom.joinToken}`;

            io.to(activeRoom.hostSocketId).emit('host:room-url-changed', {
              publicUrl: activeRoom.publicUrl,
              provider,
            });
            activeRoom.broadcast('room:url-changed', { provider });

            // Системное сообщение в чат — ключи + null-имя, клиент переведёт.
            activeRoom.addMessage(
              { key: 'chat.system_name' },
              '#63D8FF',
              { key: 'chat.link_updated' }
            );
          },
          onStateChange: (state) => {
            const activeRoom = roomManager.findActive();
            if (!activeRoom) return;
            io.to(activeRoom.hostSocketId).emit('host:tunnel-state', state);
          },
        });
        await tunnelSupervisor.start();
      }

      let tunnelUrl = tunnelSupervisor.url;
      if (!tunnelUrl) tunnelUrl = await tunnelSupervisor.waitForReady(15_000);

      const room = await roomManager.createRoom({
        name, hostSocket: socket, pluginName,
        type: requestedType, staticDir, proxyPort, options,
      });

      const currentUrl = tunnelSupervisor.url || `http://localhost:${httpServer.address().port}`;
      room.publicUrl = `${currentUrl}?t=${room.joinToken}`;

      socket.emit('host:room-created', {
        roomId: room.id, roomName: room.name,
        publicUrl: room.publicUrl,
        provider: tunnelSupervisor.provider || 'local',
        activePlugin: room.activePluginName,
        type: room.type, proxyPort: room.proxyPort,
        staticDir: room.staticDir,
        options: room.options,
      });
      socket.emit(EVENTS.ROOM_UPDATED, room.publicPlayers());
      hooks.onRoomCreated?.();
    });

    socket.on('host:close-room', async () => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      await roomManager.destroyRoom(room.id);
      hooks.onRoomClosed?.();
    });

    socket.on('host:restart-tunnel', async () => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      if (!tunnelSupervisor) return;
      await tunnelSupervisor.forceRestart();
    });

    socket.on('host:kick-player', async (payload = {}) => {
      if (!limiter.check(`kick:${socket.id}`, RATE_LIMITS.KICK)) return;
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      const { playerId } = payload;
      if (typeof playerId !== 'string') return;
      const sid = room.findSocketIdByPlayerId(playerId);
      if (!sid) return;
      io.to(sid).emit(EVENTS.PLAYER_KICKED_NOTIFY);
      await room.removePlayer(sid, 'kick');
      hooks.onPlayerLeave?.({ name: 'игрок' });
    });

    socket.on('player:join', async (payload = {}) => {
      if (!limiter.check(`join:${ip}`, RATE_LIMITS.JOIN)) {
        socket.emit('error', 'error.too_many_joins'); return;
      }
      const name = validatePlayerName(payload.playerName);
      if (!name) { socket.emit('error', 'error.invalid_name'); return; }

      const roomId = typeof payload.roomId === 'string' ? payload.roomId : null;
      const room = roomId ? roomManager.getRoom(roomId) : roomManager.findActive();
      if (!room || !room.isActive) { socket.emit('error', 'error.room_closed'); return; }

      const token = typeof payload.token === 'string' ? payload.token : '';
      if (room.joinToken && token !== room.joinToken) {
        socket.emit('error', 'error.invalid_link'); return;
      }

      roomManager.bind(socket.id, room.id);
      const player = await room.addPlayer(socket, name);
      hooks.onPlayerJoin?.(player);
    });

    socket.on('chat:message', (payload = {}) => {
      if (!limiter.check(`chat:${socket.id}`, RATE_LIMITS.CHAT)) return;
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return;
      if (room.options?.chatEnabled === false) return;
      const text = validateChatMessage(payload.text);
      if (!text) return;
      const p = room.players.get(socket.id);
      const isHost = socket.id === room.hostSocketId;
      if (!p && !isHost) return;
      // Имя хоста — тоже ключ (клиент подставит перевод)
      const senderName = p?.name || { key: 'room.host_name' };
      room.addMessage(senderName, p?.color || '#E5384F', text);
    });

    socket.on('host:start-game', async (payload = {}) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      const pluginName = validatePluginId(payload.pluginName);
      if (!pluginName) return;
      await room.startGame(pluginName);
    });

    socket.on('host:stop-game', async () => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      await room.stopGame();
    });

    socket.on('game:action', (payload = {}) => {
      if (!limiter.check(`action:${socket.id}`, RATE_LIMITS.ACTION)) return;
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return;
      const action = validateGameAction(payload.action);
      if (!action) return;
      const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
      room.handleGameAction(socket, action, data);
    });

    socket.on('disconnect', async () => {
      limiter.reset(`chat:${socket.id}`);
      limiter.reset(`action:${socket.id}`);
      limiter.reset(`kick:${socket.id}`);
      const room = roomManager.getRoomBySocket(socket.id);
      roomManager.unbind(socket.id);
      if (!room) return;

      if (room.hostSocketId === socket.id) {
        await roomManager.destroyRoom(room.id);
        hooks.onRoomClosed?.();
      } else if (room.players.has(socket.id)) {
        const p = await room.removePlayer(socket.id);
        hooks.onPlayerLeave?.(p);
      }
    });
  });

  await new Promise(res => httpServer.listen(port, res));
  const actualPort = httpServer.address().port;

  return {
    port: actualPort,
    io,
    plugins: pluginLoader,
    close: async () => {
      clearInterval(pruneTimer);
      await tunnelSupervisor?.stop?.();
      for (const room of roomManager.rooms.values()) await room.close('shutdown');
      await pluginLoader.unloadAll();
      await new Promise(res => httpServer.close(() => res()));
    },
  };
}