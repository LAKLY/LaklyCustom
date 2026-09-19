const joinToken = new URLSearchParams(location.search).get('t') || '';
const socket = io();
const $ = id => document.getElementById(id);

let me = null;
let messages = [];
let activeGame = null;
let lastGameState = null;

function show(screenId) {
  ['join-screen', 'room-screen', 'closed-screen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = (id !== screenId);
  });
}

show('join-screen');

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

function join() {
  const input = $('player-name');
  const name = (input?.value || '').trim();
  if (!name) {
    $('join-error').textContent = 'Введите имя';
    // Лёгкий shake формы — перезапускаем анимацию через reflow
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
  $('btn-join').disabled = true;
  socket.emit('player:join', { playerName: name, token: joinToken });
}

$('btn-join').onclick = join;
$('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); join(); }
});

$('btn-send').onclick = send;
$('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); send(); }
});

function send() {
  const t = ($('chat-input').value || '').trim();
  if (!t) return;
  socket.emit('chat:message', { text: t });
  $('chat-input').value = '';
}

// ═══════════ SOCKET ═══════════
socket.on('connect', () => {
  console.log('[guest] socket connected');
  if (!me) show('join-screen');
});

socket.on('player:joined-success', (data) => {
  console.log('[guest] joined successfully', data);
  me = data;
  $('player-self').textContent = data.playerName || '—';
  $('player-self').style.color = data.playerColor || 'inherit';
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

socket.on('room:closed', () => { me = null; show('closed-screen'); });
socket.on('player:kicked', () => {
  alert('Вас исключили из комнаты');
  me = null;
  show('closed-screen');
});
socket.on('error', (msg) => {
  console.log('[guest] server error:', msg);
  $('join-error').textContent = typeof msg === 'string' ? msg : 'Ошибка';
  $('btn-join').disabled = false;
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

function showGame(plugin, url) {
  activeGame = plugin;
  const block = $('game-block');
  const frame = $('game-frame');
  frame.src = url || `/plugins/${plugin}/game.html`;
  block.hidden = false;
}

function hideGame() {
  activeGame = null;
  lastGameState = null;
  $('game-block').hidden = true;
  $('game-frame').src = 'about:blank';
}

window.addEventListener('message', (e) => {
  const frame = $('game-frame');
  if (!frame?.contentWindow || e.source !== frame.contentWindow) return;
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.type === 'lakly:ready') {
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

// ═══════════ RENDER ═══════════
async function refresh() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    renderPlayers(j.players || []);
  } catch {}
}

function renderPlayers(list) {
  const el = $('players');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="muted-text" style="padding:8px 0;font-size:12px;">Пока никого</div>';
    return;
  }
  el.innerHTML = list.map(p => {
    const initial = (p.name || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="guest-player">
        <span class="avatar" style="background:${p.color};color:${p.color}">${esc(initial)}</span>
        <span>${esc(p.name)}</span>
      </div>
    `;
  }).join('');
}

function renderChat() {
  const el = $('chat');
  if (!el) return;
  if (!messages.length) {
    el.innerHTML = '<div class="muted-text">Сообщений пока нет</div>';
    return;
  }
  el.innerHTML = messages.map(m => `
    <div class="msg">
      <span class="who" style="color:${m.senderColor}">${esc(m.sender)}</span>
      <span>${esc(m.text)}</span>
    </div>
  `).join('');
  el.scrollTop = el.scrollHeight;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ═══════════ СТАРТ ═══════════
window.addEventListener('load', () => {
  show('join-screen');
  loadRoomPreview();
  setInterval(() => {
    if (me) return;
    loadRoomPreview();
  }, 3000);
});