import { v4 as uuidv4 } from 'uuid';
import { EVENTS } from '../shared/events.js';

const COLORS = ['#FF006E', '#00F5FF', '#FFBE0B', '#8338EC', '#FB5607', '#2ED573', '#1E90FF', '#A55EEA'];

export class Room {
  constructor({ id, name, hostSocket, io, pluginLoader, pluginName = null }) {
    this.id = id || uuidv4();
    this.name = name || 'Lakly Room';
    this.io = io;
    this.pluginLoader = pluginLoader;
    this.hostSocketId = hostSocket.id;

    this.players = new Map();
    this.messages = [];
    this.isActive = true;
    this.startedAt = Date.now();
    this.publicUrl = null;

    this.activePluginName = pluginName;
    this.gameActive = false;
  }

  channel() { return `room:${this.id}`; }

  broadcast(event, data) {
    this.io.to(this.channel()).emit(event, data);
  }

  publicPlayers() {
    const list = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, isHost: p.isHost,
    }));
    list.unshift({ id: 'host', name: 'Хост', color: '#00F5FF', isHost: true });
    return { players: list };
  }

  async addPlayer(socket, playerName) {
    const player = {
      id: uuidv4(),
      name: (playerName || 'Гость').slice(0, 20),
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
    });

    this.broadcast(EVENTS.ROOM_UPDATED, this.publicPlayers());
    this.broadcast('room:player-joined', { player });

    await this.pluginLoader.emit(EVENTS.PLAYER_JOINED, {
      room: this, socket, player,
    });

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
      text: String(text).slice(0, 500), ts: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > 200) this.messages.shift();
    this.broadcast(EVENTS.CHAT_NEW, msg);
    return msg;
  }

  async startGame(pluginName) {
    if (!this.pluginLoader.get(pluginName)) return false;
    this.activePluginName = pluginName;
    this.gameActive = true;
    this.broadcast(EVENTS.GAME_STARTED, {
      plugin: pluginName,
      url: `/plugins/${pluginName}/game.html`,
    });
    await this.pluginLoader.emit(EVENTS.GAME_START, {
      room: this, plugin: pluginName,
    });
    return true;
  }

  async stopGame() {
    const name = this.activePluginName;
    this.gameActive = false;
    this.broadcast(EVENTS.GAME_STOPPED, { plugin: name });
    if (name) {
      await this.pluginLoader.emit(EVENTS.GAME_STOP, { room: this, plugin: name });
    }
  }

  async handleGameAction(socket, action, data) {
    const player = this.players.get(socket.id);
    const isHost = socket.id === this.hostSocketId;
    if (!player && !isHost) return;

    await this.pluginLoader.emit(EVENTS.GAME_ACTION, {
      room: this,
      socket,
      player: player || { id: 'host', name: 'Хост', color: '#00F5FF', isHost: true },
      action,
      data,
    });
  }

  async close(reason = 'host') {
    this.isActive = false;
    await this.pluginLoader.emit(EVENTS.ROOM_CLOSED, { room: this, reason });
    this.broadcast(EVENTS.ROOM_CLOSED_NOTIFY, { reason });
    this.players.clear();
  }
}