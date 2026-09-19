const socket = io();
const $ = id => document.getElementById(id);

// Навигация
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.view[data-view="${btn.dataset.view}"]`).classList.add('active');
  };
});

const statusDot     = $('status-dot');
const statusText    = $('status-text');
const btnStart      = $('btn-start');
const btnStop       = $('btn-stop');
const btnJoinGuest  = $('btn-join-guest');
const btnCopy       = $('btn-copy');
const btnSend       = $('btn-send');
const roomUrl       = $('room-url');
const chatInput     = $('chat-input');
const playersEl     = $('players');
const chatEl        = $('chat');
const qrEl          = $('qr');
const pluginSelect  = $('plugin-select');
const gameFrame     = $('game-frame');
const gameFrameWrap = $('game-frame-wrap');
const gameStatus    = $('game-status');
const btnGameStart  = $('btn-game-start');
const btnGameStop   = $('btn-game-stop');
const dropZone      = $('drop-zone');
const btnInstallPlugin = $('btn-install-plugin');

const modeRadios    = document.querySelectorAll('input[name="room-mode"]');
const staticPicker  = $('static-picker');
const staticDirInput = $('static-dir');
const btnPickDir    = $('btn-pick-dir');

const proxyPicker    = $('proxy-picker');
const proxyPortInput = $('proxy-port');
const btnCheckPort   = $('btn-check-port');
const btnScanPorts   = $('btn-scan-ports');
const proxyStatusEl  = $('proxy-status');

let messages = [];
let activePluginName = null;
let progressTimer = null;
let lastGameState = null;
const meAsHost = { playerId: 'host', playerName: 'Хост', playerColor: '#00F5FF' };

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function startProgressHints() {
  const hints = ['Готовим сервер…', 'Открываем туннель…', 'Получаем адрес…', 'Проверяем связь…'];
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

function makeOption(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

async function loadPlugins() {
  const listEl = $('plugins-list');
  try {
    const r = await fetch('/api/plugins');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();

    pluginSelect.innerHTML = '';
    pluginSelect.append(makeOption('', '— Без плагина (только чат) —'));
    for (const p of j.plugins) {
      pluginSelect.append(makeOption(p.id, `${p.name} — ${p.description || ''}`));
    }

    listEl.innerHTML = '';
    if (!j.plugins.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Плагины не найдены. Перетащите ZIP-архив в окно.';
      listEl.append(empty);
      return;
    }
    for (const p of j.plugins) {
      const item = document.createElement('div');
      item.className = 'plugin-item';
      const nameEl = document.createElement('div');
      nameEl.className = 'plugin-name';
      nameEl.textContent = p.name;
      const verEl = document.createElement('div');
      verEl.className = 'plugin-version';
      verEl.textContent = `v${p.version}`;
      const descEl = document.createElement('div');
      descEl.className = 'plugin-desc';
      descEl.textContent = p.description || '';
      item.append(nameEl, verEl, descEl);
      listEl.append(item);
    }
  } catch (err) {
    console.error('[loadPlugins]', err);
    listEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Не удалось загрузить список плагинов';
    listEl.append(empty);
  }
}

// --- Старт ---
btnStart.onclick = () => {
  const mode = document.querySelector('input[name="room-mode"]:checked')?.value || 'default';

  if (mode === 'static') {
    const dir = staticDirInput.value;
    if (!dir || dir === 'Папка не выбрана') { toast('Сначала выберите папку'); return; }
    btnStart.disabled = true;
    startProgressHints();
    socket.emit('host:create-room', { roomName: 'Lakly Room', type: 'static', staticDir: dir });
    return;
  }

  if (mode === 'proxy') {
    const port = Number(proxyPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast('Введите порт от 1 до 65535');
      return;
    }
    btnStart.disabled = true;
    startProgressHints();
    socket.emit('host:create-room', { roomName: 'Lakly Room', type: 'proxy', proxyPort: port });
    return;
  }

  btnStart.disabled = true;
  startProgressHints();
  const pluginName = pluginSelect.value || null;
  socket.emit('host:create-room', { roomName: 'Lakly Room', type: 'default', pluginName });
};

btnStop.onclick = () => {
  if (confirm('Закрыть комнату? Гости будут отключены.')) {
    socket.emit('host:close-room');
  }
};

btnJoinGuest.onclick = () => {
  const url = roomUrl.value;
  if (!url || url === '—') return;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return;
    window.open(u.toString(), '_blank', 'noopener,noreferrer');
  } catch {}
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

// --- Socket ---
socket.on('host:room-created', async (data) => {
  stopProgressHints();
  statusDot.classList.add('on');
  const isPublic = data.provider !== 'local';
  statusText.textContent = isPublic
    ? `Комната активна (${data.provider})`
    : 'Только локальная сеть';

  roomUrl.value = data.publicUrl;
  btnCopy.disabled = false;
  btnStop.disabled = false;
  btnJoinGuest.disabled = false;
  btnSend.disabled = false;
  chatInput.disabled = false;

  gameFrameWrap.style.display = 'none';
  gameFrame.src = 'about:blank';

  if (data.type === 'static') {
    gameStatus.textContent = 'Static-режим — гости видят вашу папку';
    btnGameStart.disabled = true;
    btnGameStop.disabled = true;
  } else if (data.type === 'proxy') {
    gameStatus.textContent = `Прокси → 127.0.0.1:${data.proxyPort || '?'}`;
    btnGameStart.disabled = true;
    btnGameStop.disabled = true;
  } else {
    gameStatus.textContent = 'Игра не запущена';
    activePluginName = data.activePlugin || null;
    updateGameControls();
  }

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

socket.on('game:state', (data) => {
  lastGameState = data;
  if (gameFrame?.contentWindow) {
    gameFrame.contentWindow.postMessage({ type: 'lakly:state', data }, '*');
  }
});

socket.on('error', (msg) => {
  toast(typeof msg === 'string' ? msg : 'Ошибка');
  stopProgressHints();
  btnStart.disabled = false;
});

socket.on('disconnect', () => {
  statusDot.classList.remove('on');
  statusText.textContent = 'Нет связи с сервером';
});

// --- Единственный обработчик message от iframe ---
window.addEventListener('message', (e) => {
  if (!gameFrame?.contentWindow || e.source !== gameFrame.contentWindow) return;
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.type === 'lakly:ready') {
    gameFrame.contentWindow.postMessage({ type: 'lakly:init', player: meAsHost }, '*');
    if (lastGameState) {
      gameFrame.contentWindow.postMessage({ type: 'lakly:state', data: lastGameState }, '*');
    }
    return;
  }

  if (e.data.type === 'lakly:action') {
    if (typeof e.data.action !== 'string') return;
    socket.emit('game:action', { action: e.data.action, data: e.data.data });
  }
});

// --- Рендер ---
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
  const visible = gameFrameWrap.style.display === 'block';
  btnGameStart.disabled = !activePluginName || visible;
  btnGameStop.disabled = !visible;
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
  if (proxyStatusEl) {
    proxyStatusEl.textContent = '';
    proxyStatusEl.className = 'proxy-status';
  }
}

async function loadSettings() {
  if (!window.lakly) return;
  try {
    const s = await window.lakly.getSettings();
    $('set-tunnel').value = s.tunnel || 'auto';
    $('set-ngrok-token').value = s.ngrokToken || '';
    $('set-port').value = s.port || 3000;
  } catch (e) { console.error('[loadSettings]', e); }
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

// --- Переключатель режимов ---
modeRadios.forEach(r => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="room-mode"]:checked')?.value;
    staticPicker.style.display = mode === 'static' ? 'block' : 'none';
    proxyPicker.style.display = mode === 'proxy' ? 'block' : 'none';
  });
});

btnPickDir.onclick = async () => {
  if (!window.lakly?.pickDirectory) { toast('Диалог недоступен'); return; }
  const dir = await window.lakly.pickDirectory();
  if (dir) {
    staticDirInput.value = dir;
    toast('Папка выбрана');
  }
};

// --- Проверка порта ---
btnCheckPort.onclick = async () => {
  const port = Number(proxyPortInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    proxyStatusEl.textContent = 'Некорректный порт';
    proxyStatusEl.className = 'proxy-status err';
    return;
  }
  proxyStatusEl.textContent = 'Проверяем…';
  proxyStatusEl.className = 'proxy-status';
  try {
    const r = await fetch('/api/proxy/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port }),
    });
    const j = await r.json();
    if (j.ok) {
      const info = [];
      if (j.hint) info.push(j.hint);
      if (j.probe?.status) info.push(`HTTP ${j.probe.status}`);
      if (j.probe?.title) info.push(`«${j.probe.title}»`);
      proxyStatusEl.textContent = `✓ Порт ${j.port} отвечает${info.length ? ' — ' + info.join(' · ') : ''}`;
      proxyStatusEl.className = 'proxy-status ok';
    } else {
      proxyStatusEl.textContent = `✗ ${j.error || 'Не отвечает'}`;
      proxyStatusEl.className = 'proxy-status err';
    }
  } catch (e) {
    proxyStatusEl.textContent = 'Ошибка: ' + e.message;
    proxyStatusEl.className = 'proxy-status err';
  }
};

btnScanPorts.onclick = async () => {
  proxyStatusEl.textContent = 'Сканируем популярные порты…';
  proxyStatusEl.className = 'proxy-status';
  try {
    const r = await fetch('/api/proxy/scan');
    const j = await r.json();
    if (!j.ports?.length) {
      proxyStatusEl.textContent = 'Ничего не найдено. Запустите dev-сервер и попробуйте снова.';
      proxyStatusEl.className = 'proxy-status err';
      return;
    }
    proxyStatusEl.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = 'Найдено: ';
    proxyStatusEl.append(label);
    j.ports.forEach((p, i) => {
      if (i > 0) proxyStatusEl.append(document.createTextNode(', '));
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = `:${p.port}${p.hint ? ' (' + p.hint + ')' : ''}`;
      a.onclick = (ev) => {
        ev.preventDefault();
        proxyPortInput.value = p.port;
        btnCheckPort.click();
      };
      proxyStatusEl.append(a);
    });
    proxyStatusEl.className = 'proxy-status ok';
  } catch (e) {
    proxyStatusEl.textContent = 'Ошибка: ' + e.message;
    proxyStatusEl.className = 'proxy-status err';
  }
};

// --- Drag & Drop установка плагинов ---
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

// --- Трей-события ---
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

// --- Запуск при загрузке окна ---
window.addEventListener('load', () => {
  loadSettings();
  loadPlugins();
});