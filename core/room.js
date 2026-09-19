// core/room.js
import { v4 as uuidv4 } from 'uuid';
import { EVENTS } from '../shared/events.js';

const COLORS = ['#E5384F', '#F05068', '#FBBF24', '#4ADE80', '#9B8CFF', '#F97316', '#EC4899', '#14B8A6'];

export class Room {
  constructor({ id, name, hostSocket, io, pluginLoader, pluginName = null }) {
    this.id = id || uuidv4();
    this.name = name || 'Lakly Room';
    this.io = io;
    this.pluginLoader = pluginLoader;
    this.hostSocketId = hostSocket.id;

    // joinToken проверяется в player:join из URL-параметра ?t=.
    // hostToken не используется: host-команды защищены socket.id + WSS.
    this.joinToken = uuidv4();

    this.players = new Map();
    this.messages = [];
    this.isActive = true;
    this.startedAt = Date.now();
    this.publicUrl = null;
    this.activePluginName = pluginName;
    this.gameActive = false;

    // Тип комнаты: 'default' | 'plugin' | 'static' | 'proxy'
    this.type = pluginName ? 'plugin' : 'default';
    this.staticDir = null;
    this.proxyPort = null;
  }

  channel() { return `room:${this.id}`; }
  broadcast(event, data) { this.io.to(this.channel()).emit(event, data); }

  publicPlayers() {
    const list = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, isHost: p.isHost,
    }));
    list.unshift({ id: 'host', name: 'Хост', color: '#E5384F', isHost: true });
    return { players: list };
  }

  async addPlayer(socket, playerName) {
    const player = {
      id: uuidv4(),
      name: playerName,
      color: COLORS[this.players.size % COLORS.length],
      isHost: false,
    };
    this.players.set(socket.id, player);
    socket.join(this.channel());

    socket.emit('player:joined-success', {
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color,
      roomId: this.id,
      roomName: this.name,
      activePlugin: this.activePluginName,
      gameActive: this.gameActive,
      type: this.type,
    });

    this.broadcast(EVENTS.ROOM_UPDATED, this.publicPlayers());
    this.broadcast('room:player-joined', { player });

    await this.pluginLoader.emit(EVENTS.PLAYER_JOINED, { room: this, socket, player });
    return player;
  }

  async removePlayer(socketId, reason = 'leave') {
    const player = this.players.get(socketId);
    if (!player) return null;
    this.players.delete(socketId);

    this.broadcast('room:player-left', { player });
    this.broadcast(EVENTS.ROOM_UPDATED, this.publicPlayers());

    if (reason === 'kick') {
      await this.pluginLoader.emit(EVENTS.PLAYER_KICKED, { room: this, player });
    } else {
      await this.pluginLoader.emit(EVENTS.PLAYER_LEFT, { room: this, player });
    }
    return player;
  }

  findSocketIdByPlayerId(playerId) {
    for (const [sid, p] of this.players) if (p.id === playerId) return sid;
    return null;
  }

  addMessage(sender, color, text) {
    const msg = {
      id: uuidv4(), sender, senderColor: color,
      text, ts: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > 200) this.messages.shift();
    this.broadcast(EVENTS.CHAT_NEW, msg);
    return msg;
  }

  async startGame(pluginName) {
    // Игры разрешены только в default/plugin-комнатах.
    if (this.type !== 'default' && this.type !== 'plugin') return false;

    const plugin = this.pluginLoader.get(pluginName);
    if (!plugin) return false;

    // Mutex: пока идёт смена игры — игнорируем повторные вызовы.
    if (this._switchingGame) return false;
    this._switchingGame = true;

    try {
      // Если игра уже активна и это ДРУГОЙ плагин — сначала корректно
      // останавливаем старую (шлём GAME_STOP, чтобы она убрала за собой).
      if (this.gameActive && this.activePluginName && this.activePluginName !== pluginName) {
        await this.stopGame();
      }

      this.activePluginName = pluginName;
      this.gameActive = true;

      this.broadcast(EVENTS.GAME_STARTED, {
        plugin: pluginName,
        url: `/plugins/${pluginName}/game.html`,
      });

      await this.pluginLoader.emit(EVENTS.GAME_START, { room: this, plugin: pluginName });
      return true;
    } finally {
      this._switchingGame = false;
    }
  }

  async stopGame() {
    const name = this.activePluginName;
    this.gameActive = false;
    this.broadcast(EVENTS.GAME_STOPPED, { plugin: name });
    if (name) await this.pluginLoader.emit(EVENTS.GAME_STOP, { room: this, plugin: name });
  }

  async handleGameAction(socket, action, data) {
    if (!this.gameActive || !this.activePluginName) return;
    if (!this.pluginLoader.get(this.activePluginName)) return;

    const player = this.players.get(socket.id);
    const isHost = socket.id === this.hostSocketId;
    if (!player && !isHost) return;

    await this.pluginLoader.emit(EVENTS.GAME_ACTION, {
      room: this,
      plugin: this.activePluginName,
      socket,
      player: player || { id: 'host', name: 'Хост', color: '#00F5FF', isHost: true },
      action,
      data,
    });
  }

  async close(reason = 'host') {
    if (!this.isActive) return;
    this.isActive = false;

    await this.pluginLoader.emit(EVENTS.ROOM_CLOSING, { room: this, reason });
    this.broadcast(EVENTS.ROOM_CLOSED_NOTIFY, { reason });

    this.players.clear();
    this.messages = [];

    await this.pluginLoader.emit(EVENTS.ROOM_CLOSED, { room: this, reason });
    await this.pluginLoader.emit(EVENTS.ROOM_DESTROYED, { roomId: this.id });

    // Все plugin-worker'ы забывают состояние этой комнаты.
    // `?.` — для тестовых моков без метода cleanupRoom.
    this.pluginLoader.cleanupRoom?.(this.id);
  }
}