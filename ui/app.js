// ui/app.js
const socket = io();
const $ = id => document.getElementById(id);

// ═══════════ НАВИГАЦИЯ ═══════════
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.view[data-view="${btn.dataset.view}"]`).classList.add('active');
  };
});

// ═══════════ ССЫЛКИ НА DOM ═══════════
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
const pluginsGrid   = $('plugins-grid');
const btnInstallPlugin = $('btn-install-plugin');
const pluginAddTile = $('plugin-add-tile');
const dropOverlay   = $('drop-overlay');

const roomEmpty     = $('room-empty');
const roomActive    = $('room-active');
const welcomeScreen = $('welcome-screen');
const loadingOverlay = $('loading-overlay');
const loadingText   = $('loading-text');
const errorModal    = $('error-modal');
const errorTitle    = $('error-title');
const errorMessage  = $('error-message');
const errorClose    = $('error-close');

const advancedToggle = $('btn-advanced-toggle');
const advancedPanel  = $('advanced-panel');
const modeRadios     = document.querySelectorAll('input[name="room-mode"]');
const staticPicker   = $('static-picker');
const staticDirInput = $('static-dir');
const btnPickDir     = $('btn-pick-dir');
const proxyPicker    = $('proxy-picker');
const proxyPortInput = $('proxy-port');
const btnCheckPort   = $('btn-check-port');
const btnScanPorts   = $('btn-scan-ports');
const proxyStatusEl  = $('proxy-status');

const nikaNotify     = $('nika-notify');
const nikaMessage    = $('nika-message');
const nikaImg        = $('nika-img');

// ═══════════ СОСТОЯНИЕ ═══════════
let messages = [];
let activePluginName = null;
let lastGameState = null;
let settings = { hasSeenWelcome: false };
let nikaTimer = null;

// ═══════════ NIKA ASSISTANT ═══════════
const NIKA_IMAGES = {
  welcome: 'nika-welcome.png',
  idle:    'nika-idle.png',
  working: 'nika-working.png',
  alert:   'nika-alert.png',
  sleep:   'nika-sleep.png',
};

function showNika(state, message, durationMs = 5000) {
  const file = NIKA_IMAGES[state] || NIKA_IMAGES.idle;
  nikaImg.src = `/assets/nika/${file}`;
  nikaMessage.innerHTML = message;
  nikaNotify.classList.add('show');
  clearTimeout(nikaTimer);
  if (durationMs > 0) {
    nikaTimer = setTimeout(() => nikaNotify.classList.remove('show'), durationMs);
  }
}

function hideNika() {
  clearTimeout(nikaTimer);
  nikaNotify.classList.remove('show');
}

// ═══════════ TOAST ═══════════
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ═══════════ MODAL ═══════════
function showError(title, message) {
  errorTitle.textContent = title || 'Не получилось';
  errorMessage.textContent = message || 'Что-то пошло не так.';
  errorModal.hidden = false;
}
errorClose.onclick = () => { errorModal.hidden = true; };

// ═══════════ LOADING ═══════════
function showLoading(text) {
  loadingText.textContent = text || 'Открываем комнату…';
  loadingOverlay.hidden = false;
}
function hideLoading() {
  loadingOverlay.hidden = true;
}

// ═══════════ WELCOME ═══════════
async function checkFirstRun() {
  if (!window.lakly?.getSettings) {
    const seen = localStorage.getItem('hasSeenWelcome') === '1';
    if (!seen) welcomeScreen.hidden = false;
    return;
  }
  try {
    settings = await window.lakly.getSettings();
    if (!settings.hasSeenWelcome) welcomeScreen.hidden = false;
  } catch (err) { console.error('[welcome]', err); }
}

async function markWelcomeSeen() {
  settings.hasSeenWelcome = true;
  if (window.lakly?.setSettings) {
    try { await window.lakly.setSettings({ ...settings }); }
    catch (err) { console.error('[welcome:set]', err); }
  } else {
    localStorage.setItem('hasSeenWelcome', '1');
  }
}

$('btn-welcome-create').onclick = async () => {
  welcomeScreen.hidden = true;
  await markWelcomeSeen();
  createRoom();
};

$('btn-welcome-skip').onclick = async () => {
  welcomeScreen.hidden = true;
  await markWelcomeSeen();
  showNika('idle', 'Готов, когда ты готов', 4000);
};

// ═══════════ ADVANCED PANEL ═══════════
advancedToggle.onclick = () => {
  const isOpen = !advancedPanel.hidden;
  advancedPanel.hidden = isOpen;
  advancedToggle.textContent = isOpen ? 'Расширенные режимы' : 'Свернуть';
};

modeRadios.forEach(r => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="room-mode"]:checked')?.value;
    staticPicker.hidden = mode !== 'static';
    proxyPicker.hidden = mode !== 'proxy';
  });
});

btnPickDir.onclick = async () => {
  if (!window.lakly?.pickDirectory) { toast('Диалог недоступен'); return; }
  const dir = await window.lakly.pickDirectory();
  if (dir) { staticDirInput.value = dir; toast('Папка выбрана'); }
};

// ═══════════ PROXY CHECK ═══════════
btnCheckPort.onclick = async () => {
  const port = Number(proxyPortInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    proxyStatusEl.textContent = 'Некорректный порт';
    proxyStatusEl.style.color = 'var(--danger)';
    return;
  }
  proxyStatusEl.textContent = 'Проверяем…';
  proxyStatusEl.style.color = 'var(--text-3)';
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
      proxyStatusEl.style.color = 'var(--success)';
    } else {
      proxyStatusEl.textContent = `✗ ${j.error || 'Не отвечает'}`;
      proxyStatusEl.style.color = 'var(--danger)';
    }
  } catch (e) {
    proxyStatusEl.textContent = 'Ошибка: ' + e.message;
    proxyStatusEl.style.color = 'var(--danger)';
  }
};

btnScanPorts.onclick = async () => {
  proxyStatusEl.textContent = 'Сканируем…';
  proxyStatusEl.style.color = 'var(--text-3)';
  try {
    const r = await fetch('/api/proxy/scan');
    const j = await r.json();
    if (!j.ports?.length) {
      proxyStatusEl.textContent = 'Ничего не найдено';
      proxyStatusEl.style.color = 'var(--text-3)';
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
      a.style.color = 'var(--live)';
      a.style.textDecoration = 'underline';
      a.style.cursor = 'pointer';
      a.textContent = `:${p.port}${p.hint ? ' (' + p.hint + ')' : ''}`;
      a.onclick = (ev) => {
        ev.preventDefault();
        proxyPortInput.value = p.port;
        btnCheckPort.click();
      };
      proxyStatusEl.append(a);
    });
    proxyStatusEl.style.color = 'var(--success)';
  } catch (e) {
    proxyStatusEl.textContent = 'Ошибка: ' + e.message;
    proxyStatusEl.style.color = 'var(--danger)';
  }
};

// ═══════════ CREATE ROOM ═══════════
function createRoom() {
  const mode = document.querySelector('input[name="room-mode"]:checked')?.value || 'default';

  if (mode === 'static') {
    const dir = staticDirInput.value;
    if (!dir || dir === 'Папка не выбрана') { toast('Сначала выберите папку'); return; }
    btnStart.disabled = true;
    showLoading('Открываем комнату…');
    socket.emit('host:create-room', { roomName: 'Lakly Room', type: 'static', staticDir: dir });
    return;
  }

  if (mode === 'proxy') {
    const port = Number(proxyPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast('Введите порт от 1 до 65535'); return;
    }
    btnStart.disabled = true;
    showLoading('Открываем комнату…');
    socket.emit('host:create-room', { roomName: 'Lakly Room', type: 'proxy', proxyPort: port });
    return;
  }

  btnStart.disabled = true;
  showLoading('Открываем комнату…');
  const pluginName = pluginSelect.value || null;
  socket.emit('host:create-room', { roomName: 'Lakly Room', type: 'default', pluginName });
}

btnStart.onclick = createRoom;

btnStop.onclick = () => {
  if (confirm('Закрыть комнату? Гости отключатся.')) {
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
  // Берём выбор из селекта, а не из activePluginName.
  // activePluginName = null, когда комната создана без плагина,
  // но пользователь уже выбрал игру в селекте — её и надо запускать.
  const pluginName = pluginSelect.value;
  if (!pluginName) { toast('Выберите игру'); return; }
  socket.emit('host:start-game', { pluginName });
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

// ═══════════ SOCKET ═══════════
socket.on('host:room-created', async (data) => {
  hideLoading();
  statusDot.classList.add('on');
  const isPublic = data.provider !== 'local';
  statusText.textContent = isPublic ? 'Комната активна' : 'Только локально';

  roomUrl.value = data.publicUrl;
  roomEmpty.hidden = true;
  roomActive.hidden = false;

  btnCopy.disabled = false;
  btnStop.disabled = false;
  btnJoinGuest.disabled = false;
  btnSend.disabled = false;
  chatInput.disabled = false;

  gameFrameWrap.hidden = true;
  gameFrame.src = 'about:blank';

  if (data.type === 'static') {
    gameStatus.textContent = 'Static-режим';
    pluginSelect.disabled = true;
    btnGameStart.disabled = true;
    btnGameStop.hidden = true;
  } else if (data.type === 'proxy') {
    gameStatus.textContent = `Прокси → :${data.proxyPort || '?'}`;
    pluginSelect.disabled = true;
    btnGameStart.disabled = true;
    btnGameStop.hidden = true;
  } else {
    gameStatus.textContent = 'Не запущена';
    pluginSelect.disabled = false;

    // Если при создании был выбран плагин — отразим это в селекте,
    // чтобы пользователь видел какую игру запускать.
    if (data.activePlugin) {
      activePluginName = data.activePlugin;
      pluginSelect.value = data.activePlugin;
    } else {
      activePluginName = null;
    }
    updateGameControls();
  }

  try {
    const r = await fetch('/api/qr');
    const j = await r.json();
    if (j.qr) qrEl.innerHTML = `<img src="${j.qr}" alt="QR">`;
  } catch {}

  if (isPublic) {
    navigator.clipboard.writeText(data.publicUrl).catch(() => {});
    toast('Ссылка скопирована');
  }

  showNika('working', isPublic
    ? 'Комната открыта! Отправь друзьям ссылку'
    : 'Комната работает только локально', 5500);
});
socket.on('room:closed', () => {
  resetUi();
  showNika('idle', 'Комната закрыта', 4000);
});

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
  gameFrameWrap.hidden = false;
  lastGameState = null;

  // Синхронизируем селект — на случай, если игра запущена программно
  // или хост выбрал её в другом окне.
  if (pluginSelect.value !== plugin) {
    pluginSelect.value = plugin;
  }

  updateGameControls();
});

socket.on('game:stopped', () => {
  gameFrameWrap.hidden = true;
  gameFrame.src = 'about:blank';
  gameStatus.textContent = 'Не запущена';
  lastGameState = null;
  activePluginName = null;
  // Не сбрасываем pluginSelect.value — пусть пользователь видит,
  // какую игру он может перезапустить одним кликом.
  updateGameControls();
});

socket.on('game:state', (data) => {
  lastGameState = data;
  if (gameFrame?.contentWindow) {
    gameFrame.contentWindow.postMessage({ type: 'lakly:state', data }, '*');
  }
});

socket.on('error', (msg) => {
  hideLoading();
  btnStart.disabled = false;
  showError('Не получилось', typeof msg === 'string' ? msg : 'Что-то пошло не так.');
});

socket.on('disconnect', () => {
  statusDot.classList.remove('on');
  statusText.textContent = 'Нет связи';
  showError('Потеряна связь', 'Не удаётся подключиться к серверу комнаты.');
});

// ═══════════ IFRAME MESSAGE ═══════════
window.addEventListener('message', (e) => {
  if (!gameFrame?.contentWindow || e.source !== gameFrame.contentWindow) return;
  if (!e.data || typeof e.data !== 'object') return;

  if (e.data.type === 'lakly:ready') {
    gameFrame.contentWindow.postMessage({ type: 'lakly:init', player: { playerId: 'host', playerName: 'Хост', playerColor: '#E5384F' } }, '*');
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

// ═══════════ RENDER ═══════════
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
    playersEl.innerHTML = '<div class="muted-text">Пока никого</div>';
    return;
  }
  playersEl.innerHTML = list.map(p => {
    const initial = (p.name || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="player">
        <span class="avatar" style="background:${p.color}">${escapeHtml(initial)}</span>
        <span class="name">${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="tag">ХОСТ</span>'
                   : `<button class="kick" data-id="${p.id}" title="Исключить">✕</button>`}
      </div>
    `;
  }).join('');
  playersEl.querySelectorAll('.kick').forEach(b => {
    b.onclick = () => socket.emit('host:kick-player', { playerId: b.dataset.id });
  });
}

function renderChat() {
  if (!messages.length) {
    chatEl.innerHTML = '<div class="muted-text">Сообщений пока нет</div>';
    return;
  }
  chatEl.innerHTML = messages.map(m => `
    <div class="msg">
      <span class="who" style="color:${m.senderColor}">${escapeHtml(m.sender)}</span>
      <span class="what">${escapeHtml(m.text)}</span>
    </div>
  `).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function updateGameControls() {
  const visible = !gameFrameWrap.hidden;         // игра сейчас запущена
  const hasSelection = !!pluginSelect.value;     // выбран хоть какой-то плагин
  const sameAsActive = pluginSelect.value === activePluginName;

  // Кнопка «Запустить»:
  // — disabled, если ничего не выбрано
  // — disabled, если игра уже активна и выбран ровно тот же плагин
  // — enabled во всех остальных случаях (запуск или смена игры)
  btnGameStart.disabled = !hasSelection || (visible && sameAsActive);

  // Кнопка «Остановить» показывается только когда игра активна
  btnGameStop.hidden = !visible;
}

function resetUi() {
  hideLoading();
  statusDot.classList.remove('on');
  statusText.textContent = 'Не запущено';
  btnStart.disabled = false;
  roomEmpty.hidden = false;
  roomActive.hidden = true;
  roomUrl.value = '—';
  qrEl.innerHTML = '<div class="qr-empty">QR появится здесь</div>';
  playersEl.innerHTML = '<div class="muted-text">Пока никого</div>';
  chatEl.innerHTML = '<div class="muted-text">Сообщений пока нет</div>';
  $('player-count').textContent = '0';
  messages = [];
  activePluginName = null;
  lastGameState = null;
  gameFrameWrap.hidden = true;
  gameFrame.src = 'about:blank';
  gameStatus.textContent = 'Не запущена';
  updateGameControls();
}

// ═══════════ PLUGINS GRID ═══════════
async function loadPlugins() {
  try {
    const r = await fetch('/api/plugins');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();

    pluginSelect.innerHTML = '';
    pluginSelect.append(makeOption('', '— Выбрать игру —'));
    for (const p of j.plugins) {
      pluginSelect.append(makeOption(p.id, p.name));
    }

    // Grid
    const tiles = pluginsGrid.querySelectorAll('.plugin-card');
    tiles.forEach(t => t.remove());

    const EMOJI = { clicker: '🎯', quiz: '🧠' };

    for (const p of j.plugins) {
      const card = document.createElement('div');
      card.className = 'plugin-card';
      card.innerHTML = `
        <div class="plugin-emoji">${EMOJI[p.id] || '🎮'}</div>
        <div class="plugin-name">${escapeHtml(p.name)}</div>
        <div class="plugin-desc">${escapeHtml(p.description || '')}</div>
        <div class="plugin-meta">v${escapeHtml(p.version)}</div>
      `;
      pluginsGrid.insertBefore(card, pluginAddTile);
    }
  } catch (err) {
    console.error('[loadPlugins]', err);
  }
}

function makeOption(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

// ═══════════ SETTINGS ═══════════
async function loadSettings() {
  if (!window.lakly) return;
  try {
    const s = await window.lakly.getSettings();
    settings = s;
    $('set-tunnel').value = s.tunnel || 'auto';
    $('set-ngrok-token').value = s.ngrokToken || '';
    $('set-port').value = s.port || 3000;
  } catch (e) { console.error('[loadSettings]', e); }
}

$('btn-save-settings').onclick = async () => {
  if (!window.lakly) { toast('Настройки недоступны'); return; }
  const merged = {
    ...settings,
    tunnel: $('set-tunnel').value,
    ngrokToken: $('set-ngrok-token').value,
    port: Number($('set-port').value) || 3000,
  };
  await window.lakly.setSettings(merged);
  settings = merged;
  toast('Сохранено. Перезапустите приложение.');
};

// ═══════════ DRAG & DROP ═══════════
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove('active');
  }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');

  const files = e.dataTransfer.files;
  if (!files.length) return;
  const file = files[0];
  if (!file.name.endsWith('.zip')) { toast('Нужен ZIP-архив'); return; }

  const path = window.lakly?.getPathForFile?.(file) || file.path;
  if (!path) { toast('Не удалось получить путь'); return; }

  try {
    const result = await window.lakly.installPluginZip(path);
    if (result.ok) { toast(`Плагин «${result.plugin}» установлен`); await loadPlugins(); }
    else { showError('Ошибка установки', result.error); }
  } catch (err) {
    showError('Ошибка установки', err.message);
  }
});

function installPluginFromDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const path = window.lakly?.getPathForFile?.(file) || file.path;
    if (!path) { toast('Не удалось получить путь'); return; }
    const result = await window.lakly.installPluginZip(path);
    if (result.ok) { toast(`Плагин «${result.plugin}» установлен`); await loadPlugins(); }
    else { showError('Ошибка установки', result.error); }
  };
  input.click();
}

btnInstallPlugin.onclick = installPluginFromDialog;
pluginAddTile.onclick = installPluginFromDialog;

// ═══════════ СМЕНА ИГРЫ ВО ВРЕМЯ АКТИВНОЙ КОМНАТЫ ═══════════
pluginSelect.addEventListener('change', () => {
  const newPlugin = pluginSelect.value;

  // Если игра не запущена — просто обновляем кнопку
  if (gameFrameWrap.hidden) {
    updateGameControls();
    return;
  }

  // Если выбрали «— Выбрать игру —» при активной игре — останавливаем
  if (!newPlugin) {
    socket.emit('host:stop-game');
    return;
  }

  // Если выбрали тот же плагин, что сейчас активен — ничего не делаем
  if (newPlugin === activePluginName) return;

  // Смена игры: сервер сам остановит старую и запустит новую.
  // (На сервере это делает Room.startGame — см. core/room.js)
  const newName = getPluginNameFromSelect(newPlugin);
  toast(`Смена игры: ${newName}`);
  socket.emit('host:start-game', { pluginName: newPlugin });
});

function getPluginNameFromSelect(id) {
  const opt = pluginSelect.querySelector(`option[value="${CSS.escape(id)}"]`);
  if (!opt) return id;
  // Формат опции: "Quiz — 5 вопросов с ответами" → берём до тире
  return opt.textContent.split(' — ')[0].trim() || id;
}

// ═══════════ TRAY ═══════════
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

// ═══════════ СТАРТ ═══════════
window.addEventListener('load', async () => {
  await checkFirstRun();
  loadSettings();
  loadPlugins();
});