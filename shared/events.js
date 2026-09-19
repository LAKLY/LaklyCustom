// shared/events.js
export const EVENTS = {
  // Room lifecycle (core → plugins)
  ROOM_CREATED: 'core:room-created',
  ROOM_CLOSING: 'core:room-closing',
  ROOM_CLOSED: 'core:room-closed',
  ROOM_DESTROYED: 'core:room-destroyed',

  // Player lifecycle
  PLAYER_JOINED: 'core:player-joined',
  PLAYER_LEFT: 'core:player-left',
  PLAYER_KICKED: 'core:player-kicked',

  // Game lifecycle
  GAME_START: 'core:game-start',
  GAME_STOP: 'core:game-stop',
  GAME_ACTION: 'core:game-action',

  // Plugin loader
  PLUGIN_LOADED: 'plugin:loaded',
  PLUGIN_UNLOADED: 'plugin:unloaded',

  // Server → client
  ROOM_UPDATED: 'room:updated',
  ROOM_CLOSED_NOTIFY: 'room:closed',
  CHAT_NEW: 'chat:new-message',
  PLAYER_KICKED_NOTIFY: 'player:kicked',
  GAME_STARTED: 'game:started',
  GAME_STOPPED: 'game:stopped',
  GAME_STATE: 'game:state',

  // Tunnel / public URL lifecycle (host UI)
  ROOM_URL_CHANGED: 'host:room-url-changed',
  TUNNEL_STATE: 'host:tunnel-state',
};