// core/server.js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './room-manager.js';
import { PluginLoader } from './plugin-loader.js';
import { openTunnel, closeTunnel } from './tunnels/index.js';
import { EVENTS } from '../shared/events.js';
import {
  validatePlayerName,
  validateChatMessage,
  validateRoomName,
  validatePluginId,
  validateGameAction,
} from '../shared/validation.js';
import { RateLimiter, RATE_LIMITS } from '../shared/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function buildCorsOrigin() {
  return (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / SSR
    try {
      const u = new URL(origin);
      const host = u.hostname;
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.endsWith('.trycloudflare.com') ||
        host.endsWith('.ngrok-free.app') ||
        host.endsWith('.ngrok.io') ||
        host.endsWith('.ngrok-free.dev')
      ) return cb(null, true);
    } catch {}
    cb(new Error('Origin not allowed'));
  };
}

export async function startServer({ port = 3000, hooks = {} } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: buildCorsOrigin() } });

  const pluginLoader = new PluginLoader(path.join(ROOT, 'plugins'));
  await pluginLoader.load();

  const roomManager = new RoomManager(io, pluginLoader);
  const limiter = new RateLimiter();
  let tunnelInstance = null;
  let publicUrl = null;

  // Периодическая очистка rate-limit bucket'ов
  const pruneTimer = setInterval(() => limiter.prune(), 5 * 60 * 1000);
  pruneTimer.unref?.();

  app.use('/host', express.static(path.join(ROOT, 'ui')));
  for (const plugin of pluginLoader.plugins.values()) {
    app.use(`/plugins/${plugin.id}`, express.static(plugin.publicDir));
  }
  app.use(express.static(path.join(ROOT, 'public')));

  app.get('/api/room', (_req, res) => {
    const first = [...roomManager.rooms.values()].find(r => r.isActive);
    if (!first) return res.json({ isActive: false, players: [] });
    res.json({
      isActive: true,
      roomName: first.name,
      publicUrl: first.publicUrl,
      gameActive: first.gameActive,
      activePlugin: first.activePluginName,
      ...first.publicPlayers(),
      messages: first.messages.slice(-50),
    });
  });

  app.get('/api/plugins', (_req, res) => {
    res.json({ plugins: pluginLoader.list() });
  });

    app.get('/api/qr', async (_req, res) => {
      const first = [...roomManager.rooms.values()].find(r => r.isActive);
      if (!first || !first.publicUrl) return res.status(400).json({ error: 'no room' });
      try {
        const qr = await QRCode.toDataURL(first.publicUrl, { margin: 1, width: 260 });
        res.json({ qr });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

  io.on('connection', (socket) => {
    console.log('[io] connected', socket.id);
    const ip = socket.handshake.address || 'unknown';

    socket.on('host:create-room', async (payload = {}) => {
      if (!limiter.check(`create:${ip}`, RATE_LIMITS.CREATE_ROOM)) {
        socket.emit('error', 'Слишком часто. Подождите минуту.');
        return;
      }

      const name = validateRoomName(payload.roomName);
      const pluginName = payload.pluginName ? validatePluginId(payload.pluginName) : null;
      if (pluginName && !pluginLoader.get(pluginName)) {
        socket.emit('error', 'Такого плагина нет');
        return;
      }

      const room = await roomManager.createRoom({
        name, hostSocket: socket, pluginName,
      });

      if (!publicUrl) {
        const t = await openTunnel(httpServer.address().port);
        tunnelInstance = t.instance;
        publicUrl = t.url;
      }
      // URL с токеном — секретная ссылка для приглашения
      room.publicUrl = `${publicUrl}?t=${room.joinToken}`;

      socket.emit('host:room-created', {
        roomId: room.id,
        roomName: room.name,
        publicUrl: room.publicUrl,
        provider: tunnelInstance?.name || 'local',
        activePlugin: room.activePluginName,
      });
      socket.emit(EVENTS.ROOM_UPDATED, room.publicPlayers());
      hooks.onRoomCreated?.();
    });

    socket.on('host:close-room', async () => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      await roomManager.destroyRoom(room.id);
      if (tunnelInstance) {
        await closeTunnel(tunnelInstance);
        tunnelInstance = null;
        publicUrl = null;
      }
      hooks.onRoomClosed?.();
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
        socket.emit('error', 'Слишком много попыток входа');
        return;
      }
      const name = validatePlayerName(payload.playerName);
      if (!name) { socket.emit('error', 'Имя должно быть от 1 до 24 символов'); return; }

      const roomId = typeof payload.roomId === 'string' ? payload.roomId : null;
      const room = roomId
        ? roomManager.getRoom(roomId)
        : [...roomManager.rooms.values()].find(r => r.isActive);
      if (!room || !room.isActive) { socket.emit('error', 'Комната не активна'); return; }

      // Проверка секретного токена из ссылки
      const token = typeof payload.token === 'string' ? payload.token : '';
      if (room.joinToken && token !== room.joinToken) {
        socket.emit('error', 'Ссылка недействительна');
        return;
      }

      roomManager.bind(socket.id, room.id);
      const player = await room.addPlayer(socket, name);
      hooks.onPlayerJoin?.(player);
    });

    socket.on('chat:message', (payload = {}) => {
      if (!limiter.check(`chat:${socket.id}`, RATE_LIMITS.CHAT)) return;
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return;
      const text = validateChatMessage(payload.text);
      if (!text) return;
      const p = room.players.get(socket.id);
      const isHost = socket.id === room.hostSocketId;
      if (!p && !isHost) return;
      room.addMessage(p?.name || 'Хост', p?.color || '#00F5FF', text);
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
        if (tunnelInstance) {
          await closeTunnel(tunnelInstance);
          tunnelInstance = null;
          publicUrl = null;
        }
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
      if (tunnelInstance) await closeTunnel(tunnelInstance);
      for (const room of roomManager.rooms.values()) await room.close('shutdown');
      await new Promise(res => httpServer.close(() => res()));
    },
  };
}