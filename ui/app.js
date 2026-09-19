// ui/app.js
const socket = io();
const $ = id => document.getElementById(id);

// ═══════════ НАВИГАЦИЯ ═══════════
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.dataset.view === name);
  });
}
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => switchView(btn.dataset.view);
});

// ═══════════ ССЫЛКИ ═══════════
const statusDot     = $('status-dot');
const statusText    = $('status-text');
const btnStart      = $('btn-start');
const btnStartStatic = $('btn-start-static');
const btnStartProxy = $('btn-start-proxy');
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
const btnGameFullscreen = $('btn-game-fullscreen');
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
const loadingTip    = $('loading-tip');
const errorModal    = $('error-modal');
const errorTitle    = $('error-title');
const errorMessage  = $('error-message');
const errorClose    = $('error-close');

const configModal   = $('config-modal');
const configTitle   = $('config-title');
const configHint    = $('config-hint');
const configTextarea = $('config-textarea');
const configError   = $('config-error');
const configSave    = $('config-save');
const configCancel  = $('config-cancel');
const configReset   = $('config-reset');

const modeTabs      = document.querySelectorAll('.mode-tab');
const panelDefault  = $('panel-default');
const panelStatic   = $('panel-static');
const panelProxy    = $('panel-proxy');
const staticDirInput = $('static-dir');
const btnPickDir    = $('btn-pick-dir');
const proxyPortInput = $('proxy-port');
const btnCheckPort  = $('btn-check-port');
const btnScanPorts  = $('btn-scan-ports');
const proxyStatusEl = $('proxy-status');

const roomContentDefault = $('room-content-default');
const roomContentStatic  = $('room-content-static');
const roomContentProxy   = $('room-content-proxy');
const roomBadge     = $('room-badge');
const roomHeroTitle = $('room-hero-title');

const nikaNotify     = $('nika-notify');
const nikaMessage    = $('nika-message');
const nikaImg        = $('nika-img');

// ═══════════ СОСТОЯНИЕ ═══════════
let messages = [];
let activePluginName = null;
let lastGameState = null;
let settings = { hasSeenWelcome: false };
let nikaTimer = null;
let pluginsCache = [];
let roomActiveFlag = false;
let editingPluginId = null;
let currentMode = 'default';
let currentRoomInfo = null;

// ═══════════ LOADING TIPS ═══════════
const LOADING_TIPS = [
  'Устанавливаем соединение…',
  'Регистрируем комнату…',
  'Готовим публичную ссылку…',
  'Генерируем QR-код…',
  'Обычно это занимает 5–10 секунд',
];
const LOADING_TIP_INTERVAL_MS = 1800;
let loadingTipTimer = null;
let loadingTipIndex = 0;

// ═══════════ NIKA ═══════════
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
  if (durationMs > 0) nikaTimer = setTimeout(() => nikaNotify.classList.remove('show'), durationMs);
}

// ═══════════ TOAST / MODAL / LOADING ═══════════
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function showError(title, message) {
  errorTitle.textContent = title || 'Не получилось';
  errorMessage.textContent = message || 'Что-то пошло не так.';
  errorModal.hidden = false;
}
errorClose.onclick = () => { errorModal.hidden = true; };

function showLoading(text) {
  loadingText.textContent = text || 'Открываем комнату…';

  clearInterval(loadingTipTimer);
  loadingTipTimer = null;
  loadingTipIndex = 0;
  if (loadingTip) {
    loadingTip.textContent = '';
    loadingTip.classList.remove('show');
  }

  if (loadingTip) {
    loadingTipTimer = setInterval(() => {
      if (loadingTipIndex >= LOADING_TIPS.length) {
        clearInterval(loadingTipTimer);
        loadingTipTimer = null;
        return;
      }
      loadingTip.textContent = LOADING_TIPS[loadingTipIndex++];
      loadingTip.classList.add('show');
    }, LOADING_TIP_INTERVAL_MS);
  }

  loadingOverlay.hidden = false;
}
function hideLoading() {
  loadingOverlay.hidden = true;
  clearInterval(loadingTipTimer);
  loadingTipTimer = null;
  loadingTipIndex = 0;
  if (loadingTip) {
    loadingTip.textContent = '';
    loadingTip.classList.remove('show');
  }
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

// ═══════════ MODE TABS ═══════════
function setMode(mode) {
  if (!['default', 'static', 'proxy'].includes(mode)) mode = 'default';
  currentMode = mode;

  modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  panelDefault.hidden = mode !== 'default';
  panelStatic.hidden  = mode !== 'static';
  panelProxy.hidden   = mode !== 'proxy';
}
modeTabs.forEach(tab => {
  tab.onclick = () => setMode(tab.dataset.mode);
});

// ═══════════ STATIC PICKER ═══════════
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
      method: 'POST', headers: { 'content-type': 'application/json' },
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
      a.href = '#'; a.style.color = 'var(--live)';
      a.style.textDecoration = 'underline'; a.style.cursor = 'pointer';
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
  if (roomActiveFlag) return;

  if (currentMode === 'static') {
    const dir = staticDirInput.value;
    if (!dir || dir === 'Папка не выбрана') { toast('Сначала выберите папку'); return; }
    const name = ($('room-name-static')?.value || 'Мой сайт').trim() || 'Мой сайт';
    const options = {
      spaFallback: $('opt-static-spa').checked,
      dotFiles:    $('opt-static-dotfiles').checked,
      noCache:     $('opt-static-nocache').checked,
    };
    setStartBtns(true);
    showLoading('Открываем комнату…');
    socket.emit('host:create-room', { roomName: name, type: 'static', staticDir: dir, options });
    return;
  }

  if (currentMode === 'proxy') {
    const port = Number(proxyPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast('Введите порт от 1 до 65535'); return;
    }
    const name = ($('room-name-proxy')?.value || 'Dev Preview').trim() || 'Dev Preview';
    const options = {
      ws:           $('opt-proxy-ws').checked,
      changeOrigin: $('opt-proxy-origin').checked,
      insecure:     $('opt-proxy-insecure').checked,
      timeoutSec:   Number($('opt-proxy-timeout').value) || 20,
    };
    setStartBtns(true);
    showLoading('Открываем комнату…');
    socket.emit('host:create-room', { roomName: name, type: 'proxy', proxyPort: port, options });
    return;
  }

  // default
  const name = ($('room-name-default')?.value || 'Lakly Room').trim() || 'Lakly Room';
  const options = {
    chatEnabled: $('opt-default-chat')?.checked !== false,
  };
  setStartBtns(true);
  showLoading('Открываем комнату…');
  const pluginName = pluginSelect.value || null;
  socket.emit('host:create-room', { roomName: name, type: 'default', pluginName, options });
}
function setStartBtns(disabled) {
  btnStart.disabled = disabled;
  btnStartStatic.disabled = disabled;
  btnStartProxy.disabled = disabled;
}
btnStart.onclick = createRoom;
btnStartStatic.onclick = createRoom;
btnStartProxy.onclick = createRoom;

btnStop.onclick = () => {
  if (confirm('Закрыть комнату? Гости отключатся.')) socket.emit('host:close-room');
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

// ═══════════ GAME CONTROLS ═══════════
btnGameStart.onclick = () => {
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
  roomActiveFlag = true;
  currentRoomInfo = data;

  roomUrl.value = data.publicUrl;
  roomEmpty.hidden = true;
  roomActive.hidden = false;

  btnCopy.disabled = false;
  btnStop.disabled = false;
  btnJoinGuest.disabled = false;

  applyRoomModeUi(data);

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

  renderPluginsGrid();
});

// Туннель пересоздался — обновляем ссылку и QR.
socket.on('host:room-url-changed', async ({ publicUrl, provider }) => {
  if (!roomActiveFlag) return;
  if (typeof publicUrl === 'string' && publicUrl !== roomUrl.value) {
    roomUrl.value = publicUrl;
  }
  try {
    const r = await fetch('/api/qr');
    const j = await r.json();
    if (j.qr) qrEl.innerHTML = `<img src="${j.qr}" alt="QR">`;
  } catch {}

  const isPublic = provider && provider !== 'local';
  statusText.textContent = isPublic ? 'Комната активна' : 'Только локально';
  if (isPublic) statusDot.classList.add('on');
  toast('Ссылка комнаты обновлена');
});

socket.on('host:tunnel-state', ({ state }) => {
  if (!roomActiveFlag) return;
  switch (state) {
    case 'offline':
      statusDot.classList.remove('on');
      statusText.textContent = 'Нет интернета';
      showNika('alert', 'Интернет пропал. Ждём восстановления…', 0);
      break;
    case 'local-down':
      statusDot.classList.remove('on');
      statusText.textContent = 'Локальный сервер недоступен';
      showNika('alert', 'Локальный сервер не отвечает', 6000);
      break;
    case 'unhealthy':
      statusDot.classList.remove('on');
      statusText.textContent = 'Туннель нестабилен…';
      break;
    case 'restarting':
      statusDot.classList.remove('on');
      statusText.textContent = 'Пересоздание туннеля…';
      showNika('working', 'Пересоздаём туннель…', 0);
      break;
    case 'warming':
      statusDot.classList.remove('on');
      statusText.textContent = 'Прогреваем туннель…';
      break;
    case 'healthy':
    case 'up':
      statusDot.classList.add('on');
      statusText.textContent = 'Комната активна';
      nikaNotify.classList.remove('show');
      break;
    default:
      break;
  }
});

function applyRoomModeUi(data) {
  const type = data.type || 'default';

  roomContentDefault.hidden = type !== 'default';
  roomContentStatic.hidden  = type !== 'static';
  roomContentProxy.hidden   = type !== 'proxy';

  if (type === 'default') {
    roomBadge.textContent = 'Лобби и чат';
    roomHeroTitle.textContent = 'Отправьте ссылку друзьям';
    btnSend.disabled = false;
    chatInput.disabled = false;

    // Скрываем секцию чата, если хост её отключил при создании.
    const chatOn = data.options?.chatEnabled !== false;
    const chatSec = document.querySelector('#room-content-default .chat-section');
    if (chatSec) chatSec.hidden = !chatOn;
  } else if (type === 'static') {
    roomBadge.textContent = 'Раздача папки';
    roomHeroTitle.textContent = 'Отправьте ссылку друзьям — они увидят ваш сайт';
    btnSend.disabled = true;
    chatInput.disabled = true;
  } else if (type === 'proxy') {
    roomBadge.textContent = 'Прокси';
    roomHeroTitle.textContent = 'Отправьте ссылку — они увидят ваш localhost';
    btnSend.disabled = true;
    chatInput.disabled = true;
  }

  // Детали static
  if (type === 'static') {
    const opts = data.options || {};
    $('static-path-display').textContent = data.staticDir || '—';
    $('static-spa-display').textContent = opts.spaFallback ? 'Включено' : 'Выключено';
    $('static-cache-display').textContent = opts.noCache ? 'Отключено' : 'Включено';
    $('static-dotfiles-display').textContent = opts.dotFiles ? 'Отдаются' : 'Скрыты';
  }

  // Детали proxy
  if (type === 'proxy') {
    const opts = data.options || {};
    $('proxy-target-display').textContent = `http://127.0.0.1:${data.proxyPort || '?'}`;
    $('proxy-ws-display').textContent = opts.ws !== false ? 'Включено' : 'Выключено';
    $('proxy-origin-display').textContent = opts.changeOrigin !== false ? 'Да' : 'Нет';
    $('proxy-timeout-display').textContent = `${opts.timeoutSec || 20} сек`;
  }
}

socket.on('room:closed', () => {
  resetUi();
  showNika('idle', 'Комната закрыта', 4000);
});
socket.on('room:updated', ({ players }) => {
  const total = (players || []).length;
  const guests = Math.max(0, total - 1); // без хоста

  if (currentRoomInfo?.type === 'static') {
    $('static-visitors').textContent = `${guests} ${pluralizeGuests(guests)}`;
  } else if (currentRoomInfo?.type === 'proxy') {
    $('proxy-visitors').textContent = `${guests} ${pluralizeGuests(guests)}`;
  }
  renderPlayers(players);
});
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
  if (pluginSelect.value !== plugin) pluginSelect.value = plugin;
  updateGameControls();
  if (btnGameFullscreen) btnGameFullscreen.hidden = false;
  renderPluginsGrid();
});
socket.on('game:stopped', () => {
  gameFrameWrap.hidden = true;
  gameFrame.src = 'about:blank';
  gameStatus.textContent = 'Не запущена';
  lastGameState = null;
  activePluginName = null;
  updateGameControls();
  if (btnGameFullscreen) btnGameFullscreen.hidden = true;
  exitGameFullscreen();
  renderPluginsGrid();
});
socket.on('game:state', (data) => {
  lastGameState = data;
  if (gameFrame?.contentWindow) {
    gameFrame.contentWindow.postMessage({ type: 'lakly:state', data }, '*');
  }
});
socket.on('error', (msg) => {
  hideLoading();
  setStartBtns(false);
  showError('Не получилось', typeof msg === 'string' ? msg : 'Что-то пошло не так.');
});
socket.on('disconnect', () => {
  statusDot.classList.remove('on');
  statusText.textContent = 'Нет связи';
  // Не пугаем модалкой: socket.io переподключится сам.
});

socket.on('connect', () => {
  if (roomActiveFlag) {
    statusDot.classList.add('on');
    statusText.textContent = currentRoomInfo?.provider === 'local'
      ? 'Только локально'
      : 'Комната активна';
  }
});

// ═══════════ IFRAME MESSAGE ═══════════
window.addEventListener('message', (e) => {
  if (!gameFrame?.contentWindow || e.source !== gameFrame.contentWindow) return;
  if (!e.data || typeof e.data !== 'object') return;
  if (e.data.type === 'lakly:ready') {
    gameFrame.contentWindow.postMessage({
      type: 'lakly:init',
      player: { playerId: 'host', playerName: 'Хост', playerColor: '#E5384F' },
    }, '*');
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
function pluralizeGuests(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'гость';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'гостя';
  return 'гостей';
}
function updateGameControls() {
  const visible = !gameFrameWrap.hidden;
  const hasSelection = !!pluginSelect.value;
  const sameAsActive = pluginSelect.value === activePluginName;
  btnGameStart.disabled = !hasSelection || (visible && sameAsActive);
  btnGameStop.hidden = !visible;
}
function resetUi() {
  hideLoading();
  statusDot.classList.remove('on');
  statusText.textContent = 'Не запущено';
  roomActiveFlag = false;
  currentRoomInfo = null;
  setStartBtns(false);
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
  if (btnGameFullscreen) btnGameFullscreen.hidden = true;
  exitGameFullscreen();
  updateGameControls();
  renderPluginsGrid();
}

// ═══════════ FULLSCREEN ИГРЫ ═══════════
async function toggleGameFullscreen() {
  if (!gameFrameWrap) return;
  const target = gameFrameWrap;

  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch {}
    return;
  }
  try {
    await target.requestFullscreen();
  } catch {
    target.classList.toggle('pseudo-fullscreen');
    updateFullscreenButton();
  }
}

function exitGameFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  gameFrameWrap?.classList.remove('pseudo-fullscreen');
  updateFullscreenButton();
}

function updateFullscreenButton() {
  if (!btnGameFullscreen) return;
  const active = !!document.fullscreenElement ||
                 gameFrameWrap?.classList.contains('pseudo-fullscreen');
  btnGameFullscreen.title = active ? 'Выйти из полноэкранного режима' : 'На весь экран';
  btnGameFullscreen.classList.toggle('is-active', active);
}

if (btnGameFullscreen) {
  btnGameFullscreen.onclick = toggleGameFullscreen;
}
document.addEventListener('fullscreenchange', updateFullscreenButton);

// ═══════════ GAMES GRID ═══════════
const EMOJI = { clicker: '🎯', quiz: '🧠' };

function renderPluginsGrid() {
  pluginsGrid.querySelectorAll('.plugin-card').forEach(t => t.remove());

  for (const p of pluginsCache) {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    card.dataset.pluginId = p.id;

    let actionLabel = 'Запустить в комнате';
    let actionClass = 'btn btn-brand btn-sm';
    let actionDisabled = false;
    let actionTitle = '';

    if (!roomActiveFlag) {
      actionLabel = 'Создать комнату';
      actionTitle = 'Комната не создана — создадим её с этой игрой';
    } else if (activePluginName === p.id) {
      actionLabel = 'Игра идёт';
      actionClass = 'btn btn-ghost btn-sm';
      actionDisabled = true;
    } else if (activePluginName) {
      actionLabel = 'Сменить игру';
      actionTitle = `Сейчас запущено: ${activePluginName}`;
    }

    const configBtn = p.hasConfig
      ? `<button class="btn btn-ghost btn-sm" data-action="config" title="Настройки">⚙</button>`
      : '';
    const deleteBtn = p.isBuiltin
      ? ''
      : `<button class="btn btn-ghost-danger btn-sm" data-action="delete" title="Удалить плагин">🗑</button>`;

    card.innerHTML = `
      <div class="plugin-emoji">${EMOJI[p.id] || '🎮'}</div>
      <div class="plugin-name">${escapeHtml(p.name)}</div>
      <div class="plugin-desc">${escapeHtml(p.description || '')}</div>
      <div class="plugin-meta">
        v${escapeHtml(p.version)}
        ${p.isBuiltin ? '<span class="plugin-builtin-tag">встроенный</span>' : ''}
      </div>
      <div class="plugin-actions">
        <button class="${actionClass}" data-action="launch"
                ${actionDisabled ? 'disabled' : ''}
                title="${escapeHtml(actionTitle)}">${actionLabel}</button>
        ${configBtn}
        ${deleteBtn}
      </div>
    `;
    pluginsGrid.insertBefore(card, pluginAddTile);
  }

  pluginsGrid.querySelectorAll('[data-action="launch"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.closest('.plugin-card').dataset.pluginId;
      launchGameFromCard(id);
    };
  });
  pluginsGrid.querySelectorAll('[data-action="config"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.closest('.plugin-card').dataset.pluginId;
      openConfigModal(id);
    };
  });
  pluginsGrid.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.closest('.plugin-card').dataset.pluginId;
      removePlugin(id);
    };
  });
}

// ─── Удаление плагина ──────────────────────────────────────────
async function removePlugin(pluginId) {
  const card = pluginsGrid.querySelector(`.plugin-card[data-plugin-id="${CSS.escape(pluginId)}"]`);
  const displayName = card?.querySelector('.plugin-name')?.textContent?.trim() || pluginId;

  if (!confirm(`Удалить плагин «${displayName}»?\n\nФайлы будут стёрты с диска, настройки плагина сбросятся.`)) {
    return;
  }

  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
      method: 'DELETE',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

    toast(`Плагин «${displayName}» удалён`);

    if (activePluginName === pluginId) {
      activePluginName = null;
      gameFrameWrap.hidden = true;
      gameFrame.src = 'about:blank';
      gameStatus.textContent = 'Не запущена';
      if (btnGameFullscreen) btnGameFullscreen.hidden = true;
      exitGameFullscreen();
      updateGameControls();
    }

    await loadPlugins();
  } catch (e) {
    showError('Не удалось удалить', e.message);
  }
}

function launchGameFromCard(pluginId) {
  if (!roomActiveFlag) {
    setMode('default');
    pluginSelect.value = pluginId;
    switchView('room');
    toast(`Создаём комнату с «${pluginId}»…`);
    setTimeout(() => createRoom(), 100);
    return;
  }
  pluginSelect.value = pluginId;
  switchView('room');
  if (activePluginName === pluginId) { toast('Эта игра уже запущена'); return; }
  if (activePluginName) toast(`Смена игры: ${pluginId}`);
  socket.emit('host:start-game', { pluginName: pluginId });
}

// ═══════════ CONFIG MODAL ═══════════
async function openConfigModal(pluginId) {
  editingPluginId = pluginId;
  configTitle.textContent = `Настройки: ${pluginId}`;
  configError.textContent = '';
  configTextarea.value = 'Загрузка…';
  configTextarea.disabled = true;
  configSave.disabled = true;
  configModal.hidden = false;

  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/config`);
    const j = await r.json();
    configTextarea.value = j.config ? JSON.stringify(j.config, null, 2) : '{}';
    configHint.textContent = j.isDefault
      ? 'Это дефолтный конфиг. После сохранения он станет пользовательским.'
      : 'Пользовательский конфиг. Изменения применятся сразу после сохранения.';
  } catch (e) {
    configTextarea.value = '{}';
    configError.textContent = 'Не удалось загрузить конфиг: ' + e.message;
  } finally {
    configTextarea.disabled = false;
    configSave.disabled = false;
  }
}
configCancel.onclick = () => { configModal.hidden = true; editingPluginId = null; };
configSave.onclick = async () => {
  if (!editingPluginId) return;
  configError.textContent = '';
  let parsed;
  try { parsed = JSON.parse(configTextarea.value); }
  catch (e) { configError.textContent = 'Некорректный JSON: ' + e.message; return; }
  configSave.disabled = true;
  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(editingPluginId)}/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: parsed }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    toast('Конфиг сохранён');
    configModal.hidden = true;
    editingPluginId = null;
    await loadPlugins();
  } catch (e) { configError.textContent = 'Ошибка: ' + e.message; }
  finally { configSave.disabled = false; }
};
configReset.onclick = async () => {
  if (!editingPluginId) return;
  if (!confirm('Сбросить конфиг к дефолтному?')) return;
  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(editingPluginId)}/config`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    toast('Сброшено к дефолту');
    configModal.hidden = true;
    editingPluginId = null;
    await loadPlugins();
  } catch (e) { configError.textContent = 'Ошибка: ' + e.message; }
};

// ═══════════ PLUGINS API ═══════════
async function loadPlugins() {
  try {
    const r = await fetch('/api/plugins');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    pluginsCache = j.plugins || [];
    pluginSelect.innerHTML = '';
    pluginSelect.append(makeOption('', '— Выбрать игру —'));
    for (const p of pluginsCache) pluginSelect.append(makeOption(p.id, p.name));
    renderPluginsGrid();
  } catch (err) { console.error('[loadPlugins]', err); }
}
function makeOption(value, label) {
  const opt = document.createElement('option');
  opt.value = value; opt.textContent = label;
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

// ═══════════ SELECT CHANGE ═══════════
pluginSelect.addEventListener('change', () => {
  const newPlugin = pluginSelect.value;
  if (gameFrameWrap.hidden) { updateGameControls(); return; }
  if (!newPlugin) { socket.emit('host:stop-game'); return; }
  if (newPlugin === activePluginName) return;
  socket.emit('host:start-game', { pluginName: newPlugin });
});

// ═══════════ DRAG & DROP ═══════════
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault(); dragCounter++; dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault(); dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault(); dragCounter = 0; dropOverlay.classList.remove('active');
  const files = e.dataTransfer.files;
  if (!files.length) return;
  const file = files[0];
  if (!file.name.endsWith('.zip')) { toast('Нужен ZIP-архив'); return; }
  const p = window.lakly?.getPathForFile?.(file) || file.path;
  if (!p) { toast('Не удалось получить путь'); return; }
  try {
    const result = await window.lakly.installPluginZip(p);
    if (result.ok) { toast(`Плагин «${result.plugin}» установлен`); await loadPlugins(); }
    else showError('Ошибка установки', result.error);
  } catch (err) { showError('Ошибка установки', err.message); }
});

function installPluginFromDialog() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const p = window.lakly?.getPathForFile?.(file) || file.path;
    if (!p) { toast('Не удалось получить путь'); return; }
    const result = await window.lakly.installPluginZip(p);
    if (result.ok) { toast(`Плагин «${result.plugin}» установлен`); await loadPlugins(); }
    else showError('Ошибка установки', result.error);
  };
  input.click();
}
btnInstallPlugin.onclick = installPluginFromDialog;
pluginAddTile.onclick = installPluginFromDialog;

// ═══════════ TRAY ACTIONS ═══════════
if (window.lakly?.onTrayAction) {
  window.lakly.onTrayAction((action) => {
    switch (action) {
      case 'create-room':
        if (!roomActiveFlag) createRoom();
        break;
      case 'close-room':
        if (roomActiveFlag) socket.emit('host:close-room');
        break;
      case 'copy-link':
        if (roomUrl.value && roomUrl.value !== '—') {
          navigator.clipboard.writeText(roomUrl.value).then(() => toast('Ссылка скопирована'));
        }
        break;
      case 'open-guest':
        btnJoinGuest.click();
        break;
    }
  });
}

// ═══════════ СТАРТ ═══════════
window.addEventListener('load', async () => {
  await checkFirstRun();
  loadSettings();
  loadPlugins();
  setMode('default');
});