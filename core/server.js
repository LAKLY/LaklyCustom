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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export async function startServer({ port = 3000, hooks = {} } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const pluginLoader = new PluginLoader(path.join(ROOT, 'plugins'));
  await pluginLoader.load();

  const roomManager = new RoomManager(io, pluginLoader);
  let tunnelInstance = null;
  let publicUrl = null;

  app.use('/host', express.static(path.join(ROOT, 'ui')));
  for (const plugin of pluginLoader.plugins.values()) {
    app.use(`/plugins/${plugin.name}`, express.static(plugin.publicDir));
  }
  app.use(express.static(path.join(ROOT, 'public')));

  app.get('/api/room', (_req, res) => {
    const first = [...roomManager.rooms.values()].find(r => r.isActive);
    if (!first) return res.json({ isActive: false, players: [] });
    res.json({
      isActive: true,
      roomName: first.name,
      publicUrl,
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
    if (!publicUrl) return res.status(400).json({ error: 'no room' });
    try {
      const qr = await QRCode.toDataURL(publicUrl, { margin: 1, width: 260 });
      res.json({ qr });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- IPC через сокет для drag&drop установки ---
  io.on('connection', (socket) => {
    socket.on('host:create-room', async ({ roomName, pluginName } = {}) => {
      const room = await roomManager.createRoom({
        name: roomName, hostSocket: socket, pluginName,
      });

      if (!publicUrl) {
        const t = await openTunnel(httpServer.address().port);
        tunnelInstance = t.instance;
        publicUrl = t.url;
      }
      room.publicUrl = publicUrl;

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

    socket.on('host:kick-player', async ({ playerId } = {}) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      const sid = room.findSocketIdByPlayerId(playerId);
      if (!sid) return;
      io.to(sid).emit(EVENTS.PLAYER_KICKED_NOTIFY);
      await room.removePlayer(sid, 'kick');
      hooks.onPlayerLeave?.({ name: 'игрок' });
    });

    socket.on('player:join', async ({ playerName, roomId } = {}) => {
      const room = roomId
        ? roomManager.getRoom(roomId)
        : [...roomManager.rooms.values()].find(r => r.isActive);
      if (!room || !room.isActive) {
        socket.emit('error', 'Комната не активна');
        return;
      }
      roomManager.bind(socket.id, room.id);
      const player = await room.addPlayer(socket, playerName);
      hooks.onPlayerJoin?.(player);
    });

    socket.on('chat:message', ({ text } = {}) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !text) return;
      const p = room.players.get(socket.id);
      const isHost = socket.id === room.hostSocketId;
      if (!p && !isHost) return;
      room.addMessage(p?.name || 'Хост', p?.color || '#00F5FF', text);
    });

    socket.on('host:start-game', async ({ pluginName } = {}) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      await room.startGame(pluginName);
    });

    socket.on('host:stop-game', async () => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || room.hostSocketId !== socket.id) return;
      await room.stopGame();
    });

    socket.on('game:action', ({ action, data } = {}) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return;
      room.handleGameAction(socket, action, data);
    });

    socket.on('disconnect', async () => {
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
      if (tunnelInstance) await closeTunnel(tunnelInstance);
      for (const room of roomManager.rooms.values()) await room.close('shutdown');
      await new Promise(res => httpServer.close(() => res()));
    },
  };
}