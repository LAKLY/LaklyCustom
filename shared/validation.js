// shared/validation.js
export const LIMITS = {
  PLAYER_NAME_MAX: 24,
  MESSAGE_MAX: 500,
  ROOM_NAME_MAX: 40,
  PLUGIN_ID_MAX: 40,
};

export function validatePlayerName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > LIMITS.PLAYER_NAME_MAX) return null;
  return name;
}

export function validateChatMessage(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > LIMITS.MESSAGE_MAX) return null;
  return text;
}

export function validateRoomName(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    if (name.length > 0 && name.length <= LIMITS.ROOM_NAME_MAX) return name;
  }
  return 'Lakly Room';
}

export function validatePluginId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) return null;
  return id;
}

export function validateGameAction(value) {
  if (typeof value !== 'string') return null;
  if (!/^[a-z0-9_:-]{1,40}$/i.test(value)) return null;
  return value;
}