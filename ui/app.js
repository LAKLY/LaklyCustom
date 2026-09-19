const socket = io();
const $ = id => document.getElementById(id);

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.view[data-view="${btn.dataset.view}"]`).classList.add('active');
  };
});

const statusDot = $('status-dot');
const statusText = $('status-text');
const btnStart = $('btn-start');
const btnStop = $('btn-stop');
const btnJoinGuest = $('btn-join-guest');
const btnCopy = $('btn-copy');
const btnSend = $('btn-send');
const roomUrl = $('room-url');
const chatInput = $('chat-input');
const playersEl = $('players');
const chatEl = $('chat');
const qrEl = $('qr');
const pluginSelect = $('plugin-select');
const gameFrame = $('game-frame');
const gameFrameWrap = $('game-frame-wrap');
const gameStatus = $('game-status');
const btnGameStart = $('btn-game-start');
const btnGameStop = $('btn-game-stop');
const dropZone = $('drop-zone');
const btnInstallPlugin = $('btn-install-plugin');

let messages = [];
let activePluginName = null;
let progressTimer = null;
let lastGameState = null;
let meAsHost = { playerId: 'host', playerName: 'Хост', playerColor: '#00F5FF' };

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function startProgressHints() {
  const hints = ['Готовим сервер…', 'Открываем туннель…', 'Получаем адрес…', 'Почти готово…'];
  let i = 0;
  statusText.textContent = hints[0];
  progressTimer = setInterval(() => {
    i = (i + 1) % hints.length;
    statusText.textContent = hints[i];
  }, 2200);
}
function stopProgressHints() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

async function loadPlugins() {
  try {
    const r = await fetch('/api/plugins');
    const j = await r.json();
    pluginSelect.innerHTML = '<option value="">— Без плагина (только чат) —</option>' +
      j.plugins.map(p => `<option value="${p.name}">${p.name} — ${p.description || ''}</option>`).join('');

    $('plugins-list').innerHTML = j.plugins.length
      ? j.plugins.map(p => `
          <div class="plugin-item">
            <div class="plugin-name">${p.name}</div>
            <div class="plugin-version">v${p.version}</div>
            <div class="plugin-desc">${p.description || ''}</div>
          </div>`).join('')
      : '<div class="empty">Плагины не найдены. Перетащите ZIP-архив в окно.</div>';
  } catch (e) { console.error(e); }
}

btnStart.onclick = () => {
  btnStart.disabled = true;
  startProgressHints();
  const pluginName = pluginSelect.value || null;
  socket.emit('host:create-room', { roomName: 'Lakly Room', pluginName });
};

btnStop.onclick = () => {
  if (confirm('Закрыть комнату? Гости будут отключены.')) {
    socket.emit('host:close-room');
  }
};

btnJoinGuest.onclick = () => {
  const url = roomUrl.value;
  if (url && url !== '—') window.open(url, '_blank');
};

btnCopy.onclick = () => {
  navigator.clipboard.writeText(roomUrl.value)
    .then(() => toast('Ссылка скопирована'))
    .catch(() => toast('Не удалось скопировать'));
};

btnGameStart.onclick = () => {
  if (!activePluginName) { toast('Плагин не выбран'); return; }
  socket.emit('host:start-game', { pluginName: activePluginName });
};
btnGameStop.onclick = () => socket.emit('host:stop-game');

btnSend.onclick = sendChat;
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const t = chatInput.value.trim();
  if (!t) return;
  socket.emit('chat:message', { text: t });
  chatInput.value = '';
}

socket.on('host:room-created', async (data) => {
  stopProgressHints();
  statusDot.classList.add('on');
  const isPublic = data.provider !== 'local';
  statusText.textContent = isPublic ? `Комната активна (${data.provider})` : 'Только локальная сеть';

  roomUrl.value = data.publicUrl;
  btnCopy.disabled = false;
  btnStop.disabled = false;
  btnJoinGuest.disabled = false;
  btnSend.disabled = false;
  chatInput.disabled = false;
  btnGameStart.disabled = false;

  activePluginName = data.activePlugin || null;
  updateGameControls();

  try {
    const r = await fetch('/api/qr');
    const j = await r.json();
    if (j.qr) qrEl.innerHTML = `<img src="${j.qr}" alt="QR">`;
  } catch {}

  if (isPublic) {
    navigator.clipboard.writeText(data.publicUrl).catch(() => {});
    toast('Ссылка скопирована — отправьте её друзьям');
  } else {
    toast('Публичный туннель недоступен — работает только локальная сеть');
  }
});

socket.on('room:closed', () => { resetUi(); toast('Комната закрыта'); });
socket.on('room:updated', ({ players }) => renderPlayers(players));
socket.on('room:player-joined', refreshPlayers);
socket.on('room:player-left', refreshPlayers);

socket.on('chat:new-message', (msg) => {
  messages.push(msg);
  if (messages.length > 200) messages.shift();
  renderChat();
});

socket.on('game:started', ({ plugin, url }) => {
  activePluginName = plugin;
  gameStatus.textContent = `Игра: ${plugin}`;
  gameFrame.src = url;
  gameFrameWrap.style.display = 'block';
  lastGameState = null;
  updateGameControls();
});

socket.on('game:stopped', () => {
  gameFrameWrap.style.display = 'none';
  gameFrame.src = 'about:blank';
  gameStatus.textContent = 'Игра не запущена';
  lastGameState = null;
  updateGameControls();
});

// Пересылаем состояние игры в iframe
socket.on('game:state', (data) => {
  lastGameState = data;
  if (gameFrame?.contentWindow) {
    gameFrame.contentWindow.postMessage({ type: 'lakly:state', data }, '*');
  }
});

// Мост iframe ↔ родитель
window.addEventListener('message', (e) => {
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.type === 'lakly:ready') {
    if (gameFrame?.contentWindow) {
      gameFrame.contentWindow.postMessage({
        type: 'lakly:init',
        player: meAsHost,
      }, '*');
      if (lastGameState) {
        gameFrame.contentWindow.postMessage({ type: 'lakly:state', data: lastGameState }, '*');
      }
    }
  }

  if (e.data.type === 'lakly:action') {
    socket.emit('game:action', { action: e.data.action, data: e.data.data });
  }
});

socket.on('disconnect', () => {
  statusDot.classList.remove('on');
  statusText.textContent = 'Нет связи с сервером';
});

async function refreshPlayers() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    renderPlayers(j.players || []);
  } catch {}
}

function renderPlayers(list) {
  $('player-count').textContent = String(list.length);
  if (!list.length) {
    playersEl.innerHTML = '<div class="empty">Пока никого. Отправьте друзьям ссылку или QR.</div>';
    return;
  }
  playersEl.innerHTML = list.map(p => `
    <div class="player">
      <span class="dot" style="background:${p.color}"></span>
      <span class="name">${escapeHtml(p.name)}</span>
      ${p.isHost ? '<span class="tag">HOST</span>'
                 : `<button class="kick" data-id="${p.id}" title="Исключить">✕</button>`}
    </div>
  `).join('');
  playersEl.querySelectorAll('.kick').forEach(b => {
    b.onclick = () => socket.emit('host:kick-player', { playerId: b.dataset.id });
  });
}

function renderChat() {
  chatEl.innerHTML = messages.map(m => `
    <div class="msg">
      <span class="msg-name" style="color:${m.senderColor}">${escapeHtml(m.sender)}:</span>
      <span class="msg-text">${escapeHtml(m.text)}</span>
    </div>
  `).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function updateGameControls() {
  btnGameStart.disabled = !activePluginName || gameFrameWrap.style.display === 'block';
  btnGameStop.disabled = gameFrameWrap.style.display !== 'block';
}

function resetUi() {
  stopProgressHints();
  statusDot.classList.remove('on');
  statusText.textContent = 'Не запущено';
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnJoinGuest.disabled = true;
  btnCopy.disabled = true;
  btnSend.disabled = true;
  chatInput.disabled = true;
  roomUrl.value = '—';
  qrEl.innerHTML = '<div class="qr-empty">Нажмите «Создать комнату»</div>';
  playersEl.innerHTML = '<div class="empty">Пока никого</div>';
  chatEl.innerHTML = '';
  $('player-count').textContent = '0';
  messages = [];
  activePluginName = null;
  lastGameState = null;
  gameFrameWrap.style.display = 'none';
  gameFrame.src = 'about:blank';
  gameStatus.textContent = 'Игра не запущена';
  updateGameControls();
}

async function loadSettings() {
  if (!window.lakly) return;
  const s = await window.lakly.getSettings();
  $('set-tunnel').value = s.tunnel || 'auto';
  $('set-ngrok-token').value = s.ngrokToken || '';
  $('set-port').value = s.port || 3000;
}

$('btn-save-settings').onclick = async () => {
  if (!window.lakly) { toast('Настройки недоступны'); return; }
  await window.lakly.setSettings({
    tunnel: $('set-tunnel').value,
    ngrokToken: $('set-ngrok-token').value,
    port: Number($('set-port').value) || 3000,
  });
  toast('Сохранено. Перезапустите приложение.');
};

window.addEventListener('load', () => {
  loadSettings();
  loadPlugins();
});

// Drag & Drop установка плагинов
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropZone.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove('active'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropZone.classList.remove('active');

  const files = e.dataTransfer.files;
  if (!files.length) return;
  const file = files[0];
  if (!file.name.endsWith('.zip')) { toast('Нужен ZIP-архив с плагином'); return; }

  const path = window.lakly?.getPathForFile?.(file) || file.path;
  if (!path) { toast('Не удалось получить путь к файлу'); return; }

  try {
    const result = await window.lakly.installPluginZip(path);
    if (result.ok) { toast(`Плагин «${result.plugin}» установлен!`); await loadPlugins(); }
    else { toast('Ошибка: ' + result.error); }
  } catch (err) {
    toast('Ошибка установки: ' + err.message);
  }
});

btnInstallPlugin.onclick = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const path = window.lakly?.getPathForFile?.(file) || file.path;
    if (!path) { toast('Не удалось получить путь'); return; }
    const result = await window.lakly.installPluginZip(path);
    if (result.ok) { toast(`Плагин «${result.plugin}» установлен!`); await loadPlugins(); }
    else { toast('Ошибка: ' + result.error); }
  };
  input.click();
};

if (window.lakly?.onTrayCloseRoom) {
  window.lakly.onTrayCloseRoom(() => {
    if (!btnStop.disabled) socket.emit('host:close-room');
  });
}
if (window.lakly?.onTrayCreateRoom) {
  window.lakly.onTrayCreateRoom(() => {
    if (!btnStart.disabled) btnStart.click();
  });
}