// public/client.js
const joinToken = new URLSearchParams(location.search).get('t') || '';
const socket = io({ reconnectionDelayMax: 5000 });
const $ = id => document.getElementById(id);

// ─── i18n helpers ───────────────────────────────────────────
const t = (key, vars) => (window.LaklyI18n?.t(key, vars)) || key;

// Серверные сообщения: строка-ключ или {key, vars}
function resolveMsg(msg) {
  if (typeof msg === 'string') return t(msg);
  if (msg && typeof msg === 'object' && msg.key) return t(msg.key, msg.vars);
  return t('error.generic');
}

let me = null;
let lastPlayerName = '';
let messages = [];
let activeGame = null;
let lastGameState = null;

// ─── Игроки (дифференциальный рендер) ──────────────────────
const playerNodes = new Map();
const PLAYER_LEAVE_MS = 320;

// ─── Экран ──────────────────────────────────────────────────
function show(screenId) {
  ['join-screen', 'room-screen', 'closed-screen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = (id !== screenId);
  });
}
show('join-screen');

// ─── Статус соединения ──────────────────────────────────────
function setSocketStatus(status) {
  const el = $('guest-status');
  const txt = $('guest-status-text');
  if (!el || !txt) return;
  el.dataset.status = status;
  txt.textContent =
    status === 'online'     ? t('status.online') :
    status === 'connecting' ? t('status.connecting') :
                              t('status.offline');

  const btn = $('btn-join');
  if (btn && btn.dataset.state === 'idle') {
    btn.disabled = status === 'offline';
  }
}

// ─── Превью комнаты на join-экране ─────────────────────────
async function loadRoomPreview() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    if (j.isActive && j.roomName) {
      const el = $('join-room-title');
      if (el) el.textContent = j.roomName;
    }
  } catch {}
}

// ─── Join: машина состояний кнопки ─────────────────────────
function setJoinButton(state, text) {
  const btn = $('btn-join');
  const label = $('btn-join-text');
  if (!btn || !label) return;
  btn.dataset.state = state;
  btn.classList.toggle('connecting', state === 'connecting');
  if (text) label.textContent = text;
  btn.disabled = state === 'connecting' ||
                 state === 'joined' ||
                 (state === 'idle' && $('guest-status')?.dataset.status === 'offline');
}

let joinTimeoutTimer = null;

function join() {
  const input = $('player-name');
  const name = (input?.value || '').trim();

  if (!name) {
    $('join-error').textContent = t('guest.enter_name_err');
    const form = $('join-form');
    if (form) {
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    }
    input?.focus();
    return;
  }

  $('join-error').textContent = '';
  lastPlayerName = name;
  setJoinButton('connecting', t('guest.joining'));

  clearTimeout(joinTimeoutTimer);
  joinTimeoutTimer = setTimeout(() => {
    if (me) return;
    setJoinButton('idle', t('guest.join'));
    $('join-error').textContent = t('guest.server_timeout');
  }, 15_000);

  socket.emit('player:join', { playerName: name, token: joinToken });
}

$('btn-join').onclick = join;
$('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); join(); }
});

// ─── Чат ────────────────────────────────────────────────────
$('btn-send').onclick = send;
$('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); send(); }
});

function send() {
  const val = ($('chat-input').value || '').trim();
  if (!val) return;
  socket.emit('chat:message', { text: val });
  $('chat-input').value = '';
}

// ═══════════ FULLSCREEN ═══════════
const btnGameFs = $('btn-game-fullscreen');

async function toggleGameFullscreen() {
  const target = $('game-block');
  if (!target) return;

  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch {}
    return;
  }
  try {
    await target.requestFullscreen();
  } catch {
    target.classList.toggle('pseudo-fullscreen');
  }
  updateFsButton();
}

function updateFsButton() {
  if (!btnGameFs) return;
  const target = $('game-block');
  const active = !!document.fullscreenElement ||
                 target?.classList.contains('pseudo-fullscreen');
  const label = active ? t('room.game_fullscreen_exit') : t('room.game_fullscreen');
  btnGameFs.title = label;
  btnGameFs.setAttribute('aria-label', label);
  btnGameFs.classList.toggle('is-active', active);
}

if (btnGameFs) btnGameFs.onclick = toggleGameFullscreen;
document.addEventListener('fullscreenchange', updateFsButton);

// ═══════════ SOCKET ═══════════
socket.on('connect', () => {
  setSocketStatus('online');

  if (me && lastPlayerName) {
    socket.emit('player:join', { playerName: lastPlayerName, token: joinToken });
    return;
  }
  if (!me) show('join-screen');
});

socket.io.on('reconnect_attempt', () => setSocketStatus('connecting'));
socket.io.on('reconnect_failed', () => setSocketStatus('offline'));

socket.on('disconnect', () => {
  setSocketStatus('offline');
});

socket.on('player:joined-success', (data) => {
  clearTimeout(joinTimeoutTimer);
  me = data;
  lastPlayerName = data.playerName;

  $('player-self').textContent = data.playerName || '—';
  $('player-self').style.color = data.playerColor || 'inherit';

  const chatEl = document.querySelector('.guest-chat');
  if (chatEl) chatEl.hidden = data.chatEnabled === false;

  setJoinButton('joined', t('guest.join'));
  show('room-screen');

  if (data.gameActive && data.activePlugin) showGame(data.activePlugin);
});

socket.on('room:updated', ({ players }) => renderPlayers(players || []));
socket.on('room:player-joined', refresh);
socket.on('room:player-left', refresh);

socket.on('chat:new-message', (msg) => {
  messages.push(msg);
  if (messages.length > 200) messages.shift();
  renderChat();
});

socket.on('room:closed', () => {
  me = null;
  resetRoomUI();
  show('closed-screen');
});
socket.on('player:kicked', () => {
  alert(t('guest.kicked'));
  me = null;
  resetRoomUI();
  show('closed-screen');
});

socket.on('error', (msg) => {
  clearTimeout(joinTimeoutTimer);
  const text = resolveMsg(msg);

  if (!me) {
    $('join-error').textContent = text;
    setJoinButton('idle', t('guest.join'));
    return;
  }
  setSocketStatus('offline');
});

// ═══════════ GAME ═══════════
socket.on('game:started', ({ plugin, url }) => showGame(plugin, url));
socket.on('game:stopped', () => hideGame());

socket.on('game:state', (data) => {
  lastGameState = data;
  const frame = $('game-frame');
  if (frame?.contentWindow) {
    frame.contentWindow.postMessage({ type: 'lakly:state', data }, '*');
  }
});

let gameLoadingTimer = null;

function showGame(plugin, url) {
  activeGame = plugin;
  const block = $('game-block');
  const frame = $('game-frame');
  const loading = $('game-loading');

  if (loading) loading.hidden = false;
  block.classList.add('loading');

  frame.src = url || `/plugins/${plugin}/game.html`;
  block.hidden = false;

  clearTimeout(gameLoadingTimer);
  gameLoadingTimer = setTimeout(() => {
    if (!loading) return;
    loading.hidden = true;
    block.classList.remove('loading');
  }, 12_000);
}

function hideGame() {
  activeGame = null;
  lastGameState = null;
  clearTimeout(gameLoadingTimer);
  const block = $('game-block');
  const loading = $('game-loading');
  if (loading) loading.hidden = true;
  block.classList.remove('loading');
  block.hidden = true;
  $('game-frame').src = 'about:blank';

  block.classList.remove('pseudo-fullscreen');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

window.addEventListener('message', (e) => {
  const frame = $('game-frame');
  if (!frame?.contentWindow || e.source !== frame.contentWindow) return;
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.type === 'lakly:ready') {
    clearTimeout(gameLoadingTimer);
    const loading = $('game-loading');
    const block = $('game-block');
    if (loading) loading.hidden = true;
    block.classList.remove('loading');

    frame.contentWindow.postMessage({ type: 'lakly:init', player: me }, '*');
    if (lastGameState) {
      frame.contentWindow.postMessage({ type: 'lakly:state', data: lastGameState }, '*');
    }
    return;
  }

  if (e.data.type === 'lakly:action') {
    if (typeof e.data.action !== 'string') return;
    socket.emit('game:action', { action: e.data.action, data: e.data.data });
  }
});

// ═══════════ RENDER: игроки ═══════════
async function refresh() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    renderPlayers(j.players || []);
  } catch {}
}

function playerDisplayName(p) {
  if (p.name) return p.name;
  if (p.isHost) return t('room.host_name');
  return '?';
}

function createPlayerNode(p) {
  const name = playerDisplayName(p);
  const initial = name.trim().charAt(0).toUpperCase();
  const node = document.createElement('div');
  node.className = 'guest-player';
  node.dataset.playerId = p.id;
  node.innerHTML = `
    <span class="avatar" style="background:${p.color};color:${p.color}">${esc(initial)}</span>
    <span class="player-name">${esc(name)}</span>
  `;
  return node;
}

function renderPlayers(list) {
  const el = $('players');
  if (!el) return;

  if (list.length) {
    const empty = el.querySelector('.muted-text');
    if (empty) empty.remove();
  }

  const seen = new Set();

  for (const p of list) {
    seen.add(p.id);
    let node = playerNodes.get(p.id);
    if (!node) {
      node = createPlayerNode(p);
      playerNodes.set(p.id, node);
      el.appendChild(node);
    } else {
      const nameEl = node.querySelector('.player-name');
      const avEl = node.querySelector('.avatar');
      const name = playerDisplayName(p);
      if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
      if (avEl) {
        avEl.textContent = name.trim().charAt(0).toUpperCase();
        avEl.style.background = p.color;
        avEl.style.color = p.color;
      }
    }
  }

  for (const [id, node] of playerNodes) {
    if (seen.has(id)) continue;
    playerNodes.delete(id);
    node.classList.add('leaving');
    setTimeout(() => node.remove(), PLAYER_LEAVE_MS);
  }

  if (!list.length && !el.children.length) {
    el.innerHTML = `<div class="muted-text" style="padding:8px 0;font-size:12px;">${esc(t('room.no_players'))}</div>`;
  }
}

function resetRoomUI() {
  playerNodes.clear();
  const el = $('players');
  if (el) el.innerHTML = `<div class="muted-text" style="padding:8px 0;font-size:12px;">${esc(t('room.no_players'))}</div>`;
  messages = [];
  const chat = $('chat');
  if (chat) chat.innerHTML = `<div class="muted-text">${esc(t('room.no_messages'))}</div>`;
  hideGame();
}

// ═══════════ RENDER: чат ═══════════
function isNearBottom(el, threshold = 60) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function renderChat() {
  const el = $('chat');
  if (!el) return;

  if (!messages.length) {
    el.innerHTML = `<div class="muted-text">${esc(t('room.no_messages'))}</div>`;
    return;
  }

  const prevScrollTop = el.scrollTop;
  const wasNearBottom = isNearBottom(el);

  el.innerHTML = messages.map(m => {
    const mine = me && typeof m.sender === 'string' && m.sender === me.playerName ? ' mine' : '';
    const who = (m.sender && typeof m.sender === 'object')
      ? resolveMsg(m.sender)
      : (m.sender || '');
    const what = (m.text && typeof m.text === 'object')
      ? resolveMsg(m.text)
      : (m.text || '');
    return `
      <div class="msg${mine}">
        <span class="who" style="color:${m.senderColor}">${esc(who)}</span>
        <span>${esc(what)}</span>
      </div>`;
  }).join('');

  if (wasNearBottom) {
    el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTop = prevScrollTop;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Перерисовать после смены языка
if (window.LaklyI18n) {
  window.LaklyI18n.onChange(() => {
    try { setSocketStatus(socket.connected ? 'online' : 'connecting'); } catch {}
    try { renderChat(); } catch {}
    try {
      const btn = $('btn-join');
      if (btn) {
        const state = btn.dataset.state || 'idle';
        if (state === 'idle') setJoinButton('idle', t('guest.join'));
        else if (state === 'connecting') setJoinButton('connecting', t('guest.joining'));
        else if (state === 'joined') setJoinButton('joined', t('guest.join'));
      }
    } catch {}
    try { updateFsButton(); } catch {}
  });
}

// ═══════════ СТАРТ ═══════════
window.addEventListener('load', async () => {
  try {
    if (window.LaklyI18n) await window.LaklyI18n.init();
  } catch (err) {
    console.error('[guest] i18n init failed:', err);
  }

  show('join-screen');
  setSocketStatus(socket.connected ? 'online' : 'connecting');
  loadRoomPreview();
  setInterval(() => {
    if (me) return;
    loadRoomPreview();
  }, 3000);
});