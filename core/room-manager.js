import { Room } from './room.js';

export class RoomManager {
  constructor(io, pluginLoader) {
    this.io = io;
    this.pluginLoader = pluginLoader;
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  async createRoom({ name, hostSocket, pluginName = null }) {
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
    this.rooms.set(room.id, room);
    this.socketRoom.set(hostSocket.id, room.id);
    hostSocket.join(room.channel());
    return room;
  }

  getRoom(roomId) { return this.rooms.get(roomId) || null; }

  getRoomBySocket(socketId) {
    const roomId = this.socketRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  bind(socketId, roomId) { this.socketRoom.set(socketId, roomId); }
  unbind(socketId) { this.socketRoom.delete(socketId); }

  async destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    await room.close('closed');
    this.rooms.delete(roomId);
  }
}