const joinToken = new URLSearchParams(location.search).get('t') || '';
const socket = io({ reconnectionDelayMax: 5000 });
const $ = id => document.getElementById(id);

let me = null;
let lastPlayerName = '';
let messages = [];
let activeGame = null;
let lastGameState = null;

// ─── Игроки (дифференциальный рендер) ────────────────────
const playerNodes = new Map();     // playerId -> HTMLElement
const PLAYER_LEAVE_MS = 320;

// ─── Экран ───────────────────────────────────────────────
function show(screenId) {
  ['join-screen', 'room-screen', 'closed-screen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = (id !== screenId);
  });
}
show('join-screen');

// ─── Статус соединения ───────────────────────────────────
function setSocketStatus(status) {
  const el = $('guest-status');
  const txt = $('guest-status-text');
  if (!el || !txt) return;
  el.dataset.status = status;
  txt.textContent =
    status === 'online'     ? 'Онлайн' :
    status === 'connecting' ? 'Подключение…' :
                              'Нет соединения';

  // На join-экране — управляем доступностью кнопки.
  const btn = $('btn-join');
  if (btn && btn.dataset.state === 'idle') {
    btn.disabled = status === 'offline';
  }
}

// ─── Превью комнаты на join-экране ───────────────────────
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

// ─── Join: машина состояний кнопки ───────────────────────
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
    $('join-error').textContent = 'Введите имя';
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
  setJoinButton('connecting', 'Подключение…');

  // Если сервер не ответит за 15 сек — возвращаем кнопку в idle.
  clearTimeout(joinTimeoutTimer);
  joinTimeoutTimer = setTimeout(() => {
    if (me) return;
    setJoinButton('idle', 'Войти в комнату');
    $('join-error').textContent = 'Сервер не отвечает. Попробуйте ещё раз.';
  }, 15_000);

  socket.emit('player:join', { playerName: name, token: joinToken });
}

$('btn-join').onclick = join;
$('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); join(); }
});

// ─── Чат ─────────────────────────────────────────────────
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

// ═══════════ FULLSCREEN ИГРЫ ═══════════
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
  btnGameFs.title = active ? 'Выйти из полноэкранного режима' : 'На весь экран';
  btnGameFs.classList.toggle('is-active', active);
}

if (btnGameFs) btnGameFs.onclick = toggleGameFullscreen;
document.addEventListener('fullscreenchange', updateFsButton);

// ═══════════ SOCKET ═══════════
socket.on('connect', () => {
  console.log('[guest] socket connected');
  setSocketStatus('online');

  // Автореконнект: если мы уже были в комнате, но связь упала —
  // переподключаемся молча, под тем же именем.
  if (me && lastPlayerName) {
    socket.emit('player:join', { playerName: lastPlayerName, token: joinToken });
    return;
  }
  if (!me) show('join-screen');
});

socket.io.on('reconnect_attempt', () => setSocketStatus('connecting'));
socket.io.on('reconnect_failed', () => setSocketStatus('offline'));

socket.on('disconnect', (reason) => {
  console.log('[guest] socket disconnected:', reason);
  setSocketStatus('offline');
  // socket.io сам переподключится — модалки не показываем.
});

socket.on('player:joined-success', (data) => {
  console.log('[guest] joined successfully', data);
  clearTimeout(joinTimeoutTimer);
  me = data;
  lastPlayerName = data.playerName;

  $('player-self').textContent = data.playerName || '—';
  $('player-self').style.color = data.playerColor || 'inherit';

  // Скрываем чат, если хост отключил его при создании комнаты.
  const chatEl = document.querySelector('.guest-chat');
  if (chatEl) chatEl.hidden = data.chatEnabled === false;

  setJoinButton('joined', 'Войти в комнату');
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
  alert('Вас исключили из комнаты');
  me = null;
  resetRoomUI();
  show('closed-screen');
});

socket.on('error', (msg) => {
  console.log('[guest] server error:', msg);
  clearTimeout(joinTimeoutTimer);
  const text = typeof msg === 'string' ? msg : 'Ошибка';

  // Если мы ещё не в комнате — ошибка про join, показываем на join-экране.
  if (!me) {
    $('join-error').textContent = text;
    setJoinButton('idle', 'Войти в комнату');
    return;
  }
  // Иначе — не рушим UI, просто тост-подобное поведение в шапке.
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

  // Показываем оверлей, пока iframe не пришлёт lakly:ready.
  if (loading) loading.hidden = false;
  block.classList.add('loading');

  frame.src = url || `/plugins/${plugin}/game.html`;
  block.hidden = false;

  // Страховка: если плагин не прислал ready за 12 сек — снимаем оверлей,
  // чтобы гость не смотрел в бесконечный спиннер.
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

  // Сбрасываем fullscreen, если был активен.
  block.classList.remove('pseudo-fullscreen');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

window.addEventListener('message', (e) => {
  const frame = $('game-frame');
  if (!frame?.contentWindow || e.source !== frame.contentWindow) return;
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.type === 'lakly:ready') {
    // Игра готова — убираем оверлей и shimmer.
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

// ═══════════ RENDER: игроки (diff) ═══════════
async function refresh() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    renderPlayers(j.players || []);
  } catch {}
}

function createPlayerNode(p) {
  const initial = (p.name || '?').trim().charAt(0).toUpperCase();
  const node = document.createElement('div');
  node.className = 'guest-player';
  node.dataset.playerId = p.id;
  node.innerHTML = `
    <span class="avatar" style="background:${p.color};color:${p.color}">${esc(initial)}</span>
    <span class="player-name">${esc(p.name)}</span>
  `;
  return node;
}

function renderPlayers(list) {
  const el = $('players');
  if (!el) return;

  // Убираем «Пока никого», если появились игроки.
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
      if (nameEl && nameEl.textContent !== p.name) nameEl.textContent = p.name;
      if (avEl) {
        avEl.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
        avEl.style.background = p.color;
        avEl.style.color = p.color;
      }
    }
  }

  // Ушли — плавно удаляем.
  for (const [id, node] of playerNodes) {
    if (seen.has(id)) continue;
    playerNodes.delete(id);
    node.classList.add('leaving');
    setTimeout(() => node.remove(), PLAYER_LEAVE_MS);
  }

  if (!list.length && !el.children.length) {
    el.innerHTML = '<div class="muted-text" style="padding:8px 0;font-size:12px;">Пока никого</div>';
  }
}

function resetRoomUI() {
  playerNodes.clear();
  const el = $('players');
  if (el) el.innerHTML = '<div class="muted-text" style="padding:8px 0;font-size:12px;">Пока никого</div>';
  messages = [];
  const chat = $('chat');
  if (chat) chat.innerHTML = '<div class="muted-text">Сообщений пока нет</div>';
  hideGame();
}

// ═══════════ RENDER: чат с сохранением позиции скролла ═══════════
function isNearBottom(el, threshold = 60) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function renderChat() {
  const el = $('chat');
  if (!el) return;

  if (!messages.length) {
    el.innerHTML = '<div class="muted-text">Сообщений пока нет</div>';
    return;
  }

  const prevScrollTop = el.scrollTop;
  const wasNearBottom = isNearBottom(el);

  el.innerHTML = messages.map(m => {
    const mine = me && m.sender === me.playerName ? ' mine' : '';
    return `
      <div class="msg${mine}">
        <span class="who" style="color:${m.senderColor}">${esc(m.sender)}</span>
        <span>${esc(m.text)}</span>
      </div>`;
  }).join('');

  // Вниз прыгаем только если пользователь и так был у нижней границы.
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

// ═══════════ СТАРТ ═══════════
window.addEventListener('load', () => {
  show('join-screen');
  setSocketStatus(socket.connected ? 'online' : 'connecting');
  loadRoomPreview();
  setInterval(() => {
    if (me) return;
    loadRoomPreview();
  }, 3000);
});