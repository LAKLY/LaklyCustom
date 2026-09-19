// core/room-manager.js
import { Room } from './room.js';
import { EVENTS } from '../shared/events.js';

export class RoomManager {
  constructor(io, pluginLoader) {
    this.io = io;
    this.pluginLoader = pluginLoader;
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  async createRoom({ name, hostSocket, pluginName = null, type = 'default',
                     staticDir = null, proxyPort = null, options = {} }) {
    for (const room of this.rooms.values()) {
      if (room.hostSocketId === hostSocket.id && room.isActive) {
        await room.close('replaced');
        this.rooms.delete(room.id);
      }
    }

    const room = new Room({
      name,
      hostSocket,
      io: this.io,
      pluginLoader: this.pluginLoader,
      pluginName,
    });
    room.type = type;
    room.staticDir = staticDir;
    room.proxyPort = proxyPort;
    room.options = options || {};

    this.rooms.set(room.id, room);
    this.socketRoom.set(hostSocket.id, room.id);
    hostSocket.join(room.channel());

    await this.pluginLoader.emit(EVENTS.ROOM_CREATED, { room });
    return room;
  }

  getRoom(roomId) { return this.rooms.get(roomId) || null; }

  getRoomBySocket(socketId) {
    const roomId = this.socketRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  findActive(type) {
    for (const room of this.rooms.values()) {
      if (!room.isActive) continue;
      if (type !== undefined && room.type !== type) continue;
      return room;
    }
    return null;
  }

  bind(socketId, roomId) { this.socketRoom.set(socketId, roomId); }
  unbind(socketId) { this.socketRoom.delete(socketId); }

  async destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    await room.close('closed');
    this.rooms.delete(roomId);
    for (const [sid, id] of this.socketRoom) {
      if (id === roomId) this.socketRoom.delete(sid);
    }
  }
}