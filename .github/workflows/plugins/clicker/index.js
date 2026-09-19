import { EVENTS } from '../../shared/events.js';

const state = new Map();

function getState(roomId) {
  if (!state.has(roomId)) {
    state.set(roomId, { count: 0, scores: new Map() });
  }
  return state.get(roomId);
}

function leaderboard(s) {
  return [...s.scores.entries()]
    .map(([name, clicks]) => ({ name, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
}

export default {
  name: 'clicker',
  version: '1.0.0',
  description: 'Общий счётчик кликов: все игроки наращивают счёт вместе.',

  hooks: {
    [EVENTS.ROOM_CREATED]: ({ room }) => {
      state.set(room.id, { count: 0, scores: new Map() });
    },

    [EVENTS.ROOM_CLOSED]: ({ room }) => {
      state.delete(room.id);
    },

    [EVENTS.GAME_START]: ({ room }) => {
      const s = getState(room.id);
      s.count = 0;
      s.scores = new Map();
      room.broadcast(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
      });
    },

    [EVENTS.PLAYER_JOINED]: ({ room, socket }) => {
      if (!room.gameActive) return;
      const s = getState(room.id);
      socket.emit(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
      });
    },

    [EVENTS.PLAYER_LEFT]: ({ room, player }) => {
      if (!room.gameActive) return;
      const s = getState(room.id);
      room.broadcast(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
      });
    },

    [EVENTS.GAME_ACTION]: ({ room, player, action }) => {
      if (action !== 'click') return;
      const s = getState(room.id);
      s.count++;
      const prev = s.scores.get(player.name) || 0;
      s.scores.set(player.name, prev + 1);

      room.broadcast(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
        lastClick: { name: player.name, color: player.color },
      });
    },
  },
};