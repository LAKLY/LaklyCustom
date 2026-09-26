// ui/app.js
const socket = io();
const $ = id => document.getElementById(id);

// ═══════════ i18n helpers ═══════════
const t = (key, vars) => (window.LaklyI18n?.t(key, vars)) || key;

// Серверные сообщения: строка-ключ или {key, vars}
function resolveMsg(msg) {
  if (typeof msg === 'string') return t(msg);
  if (msg && typeof msg === 'object' && msg.key) return t(msg.key, msg.vars);
  return t('error.generic');
}

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
let settings = { hasSeenWelcome: false, language: 'auto' };
let nikaTimer = null;
let pluginsCache = [];
let roomActiveFlag = false;
let editingPluginId = null;
let currentMode = 'default';
let currentRoomInfo = null;
let currentPlayers = [];
let lastTunnelState = null;

// ═══════════ LOADING TIPS ═══════════
const LOADING_TIP_KEYS = [
  'loading.tip.0',
  'loading.tip.1',
  'loading.tip.2',
  'loading.tip.3',
  'loading.tip.4',
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
  nikaMessage.textContent = message;
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
  errorTitle.textContent = title || t('error.title');
  errorMessage.textContent = message || t('error.generic');
  errorModal.hidden = false;
}
errorClose.onclick = () => { errorModal.hidden = true; };

function showLoading(text) {
  loadingText.textContent = text || t('loading.opening');

  clearInterval(loadingTipTimer);
  loadingTipTimer = null;
  loadingTipIndex = 0;
  if (loadingTip) {
    loadingTip.textContent = '';
    loadingTip.classList.remove('show');
  }

  if (loadingTip) {
    loadingTipTimer = setInterval(() => {
      if (loadingTipIndex >= LOADING_TIP_KEYS.length) {
        clearInterval(loadingTipTimer);
        loadingTipTimer = null;
        return;
      }
      loadingTip.textContent = t(LOADING_TIP_KEYS[loadingTipIndex++]);
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
  showNika('idle', t('nika.ready'), 4000);
};

// ═══════════ MODE TABS ═══════════
function setMode(mode) {
  if (!['default', 'static', 'proxy'].includes(mode)) mode = 'default';
  currentMode = mode;

  modeTabs.forEach(t2 => t2.classList.toggle('active', t2.dataset.mode === mode));
  panelDefault.hidden = mode !== 'default';
  panelStatic.hidden  = mode !== 'static';
  panelProxy.hidden   = mode !== 'proxy';
}
modeTabs.forEach(tab => {
  tab.onclick = () => setMode(tab.dataset.mode);
});

// ═══════════ STATIC PICKER ═══════════
btnPickDir.onclick = async () => {
  if (!window.lakly?.pickDirectory) { toast(t('toast.dialog_unavailable')); return; }
  const dir = await window.lakly.pickDirectory();
  if (dir) {
    staticDirInput.value = dir;
    staticDirInput.removeAttribute('data-i18n-placeholder');
    toast(t('toast.folder_selected'));
  }
};

// ═══════════ PROXY CHECK ═══════════
btnCheckPort.onclick = async () => {
  const port = Number(proxyPortInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    proxyStatusEl.textContent = t('proxy.bad_port');
    proxyStatusEl.style.color = 'var(--danger)';
    return;
  }
  proxyStatusEl.textContent = t('proxy.checking');
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
      proxyStatusEl.textContent = info.length
        ? t('proxy.ok_details', { port: j.port, details: info.join(' · ') })
        : t('proxy.ok', { port: j.port });
      proxyStatusEl.style.color = 'var(--success)';
    } else {
      proxyStatusEl.textContent = t('proxy.fail', { error: resolveMsg(j.error) });
      proxyStatusEl.style.color = 'var(--danger)';
    }
  } catch (e) {
    proxyStatusEl.textContent = t('proxy.error_prefix', { err: e.message });
    proxyStatusEl.style.color = 'var(--danger)';
  }
};
btnScanPorts.onclick = async () => {
  proxyStatusEl.textContent = t('proxy.scanning');
  proxyStatusEl.style.color = 'var(--text-3)';
  try {
    const r = await fetch('/api/proxy/scan');
    const j = await r.json();
    if (!j.ports?.length) {
      proxyStatusEl.textContent = t('proxy.none_found');
      proxyStatusEl.style.color = 'var(--text-3)';
      return;
    }
    proxyStatusEl.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = t('proxy.found_prefix');
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
    proxyStatusEl.textContent = t('proxy.error_prefix', { err: e.message });
    proxyStatusEl.style.color = 'var(--danger)';
  }
};

// ═══════════ CREATE ROOM ═══════════
function createRoom() {
  if (roomActiveFlag) return;

  if (currentMode === 'static') {
    const dir = staticDirInput.value;
    if (!dir) { toast(t('toast.folder_first')); return; }
    const name = ($('room-name-static')?.value || '').trim() || t('mode.static');
    const options = {
      spaFallback: $('opt-static-spa').checked,
      dotFiles:    $('opt-static-dotfiles').checked,
      noCache:     $('opt-static-nocache').checked,
    };
    setStartBtns(true);
    showLoading(t('loading.opening'));
    socket.emit('host:create-room', { roomName: name, type: 'static', staticDir: dir, options });
    return;
  }

  if (currentMode === 'proxy') {
    const port = Number(proxyPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast(t('toast.invalid_port')); return;
    }
    const name = ($('room-name-proxy')?.value || '').trim() || t('mode.proxy');
    const options = {
      ws:           $('opt-proxy-ws').checked,
      changeOrigin: $('opt-proxy-origin').checked,
      insecure:     $('opt-proxy-insecure').checked,
      timeoutSec:   Number($('opt-proxy-timeout').value) || 20,
    };
    setStartBtns(true);
    showLoading(t('loading.opening'));
    socket.emit('host:create-room', { roomName: name, type: 'proxy', proxyPort: port, options });
    return;
  }

  const name = ($('room-name-default')?.value || '').trim() || t('room.name_default');
  const options = {
    chatEnabled: $('opt-default-chat')?.checked !== false,
  };
  setStartBtns(true);
  showLoading(t('loading.opening'));
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
  if (confirm(t('toast.close_room_confirm'))) socket.emit('host:close-room');
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
    .then(() => toast(t('toast.link_copied')))
    .catch(() => toast(t('toast.link_copy_fail')));
};

// ═══════════ GAME CONTROLS ═══════════
btnGameStart.onclick = () => {
  const pluginName = pluginSelect.value;
  if (!pluginName) { toast(t('toast.select_game')); return; }
  socket.emit('host:start-game', { pluginName });
};
btnGameStop.onclick = () => socket.emit('host:stop-game');

btnSend.onclick = sendChat;
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const val = chatInput.value.trim();
  if (!val) return;
  socket.emit('chat:message', { text: val });
  chatInput.value = '';
}

// ═══════════ SOCKET ═══════════
socket.on('host:room-created', async (data) => {
  hideLoading();
  statusDot.classList.add('on');
  const isPublic = data.provider !== 'local';
  statusText.textContent = isPublic ? t('status.active') : t('status.local_only');
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
    toast(t('toast.link_copied'));
  }
  showNika('working',
    isPublic ? t('nika.room_open') : t('nika.room_local'),
    5500);

  renderPluginsGrid();
});

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
  statusText.textContent = isPublic ? t('status.active') : t('status.local_only');
  if (isPublic) statusDot.classList.add('on');
  toast(t('toast.link_updated'));
});

socket.on('host:tunnel-state', (state) => {
  lastTunnelState = state;
  if (!roomActiveFlag) return;
  const s = state?.state || state;
  switch (s) {
    case 'offline':
      statusDot.classList.remove('on');
      statusText.textContent = t('status.no_internet');
      showNika('alert', t('nika.internet_lost'), 0);
      break;
    case 'local-down':
      statusDot.classList.remove('on');
      statusText.textContent = t('status.local_down');
      showNika('alert', t('nika.local_down'), 6000);
      break;
    case 'unhealthy':
      statusDot.classList.remove('on');
      statusText.textContent = t('status.tunnel_unstable');
      break;
    case 'restarting':
      statusDot.classList.remove('on');
      statusText.textContent = t('status.tunnel_restarting');
      showNika('working', t('nika.recreating_tunnel'), 0);
      break;
    case 'warming':
      statusDot.classList.remove('on');
      statusText.textContent = t('status.tunnel_warming');
      break;
    case 'healthy':
    case 'up':
      statusDot.classList.add('on');
      statusText.textContent = t('status.active');
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
    roomBadge.textContent = t('room.badge.lobby');
    roomHeroTitle.textContent = t('room.send_link');
    btnSend.disabled = false;
    chatInput.disabled = false;

    const chatOn = data.options?.chatEnabled !== false;
    const chatSec = document.querySelector('#room-content-default .chat-section');
    if (chatSec) chatSec.hidden = !chatOn;
  } else if (type === 'static') {
    roomBadge.textContent = t('room.badge.static');
    roomHeroTitle.textContent = t('room.send_link.static');
    btnSend.disabled = true;
    chatInput.disabled = true;
  } else if (type === 'proxy') {
    roomBadge.textContent = t('room.badge.proxy');
    roomHeroTitle.textContent = t('room.send_link.proxy');
    btnSend.disabled = true;
    chatInput.disabled = true;
  }

  if (type === 'static') {
    const opts = data.options || {};
    $('static-path-display').textContent = data.staticDir || '—';
    $('static-spa-display').textContent = opts.spaFallback ? t('info.enabled') : t('info.disabled');
    $('static-cache-display').textContent = opts.noCache ? t('info.cache_off') : t('info.cache_on');
    $('static-dotfiles-display').textContent = opts.dotFiles ? t('info.dotfiles_served') : t('info.dotfiles_hidden');
  }

  if (type === 'proxy') {
    const opts = data.options || {};
    $('proxy-target-display').textContent = `http://127.0.0.1:${data.proxyPort || '?'}`;
    $('proxy-ws-display').textContent = opts.ws !== false ? t('info.enabled') : t('info.disabled');
    $('proxy-origin-display').textContent = opts.changeOrigin !== false ? t('info.yes') : t('info.no');
    $('proxy-timeout-display').textContent = t('info.sec_value', { n: opts.timeoutSec || 20 });
  }
}

socket.on('room:closed', () => {
  resetUi();
  showNika('idle', t('toast.room_closed'), 4000);
});
socket.on('room:updated', ({ players }) => {
  currentPlayers = players || [];
  const total = currentPlayers.length;
  const guests = Math.max(0, total - 1);

  if (currentRoomInfo?.type === 'static') {
    $('static-visitors').textContent = `${guests} ${pluralizeGuests(guests)}`;
  } else if (currentRoomInfo?.type === 'proxy') {
    $('proxy-visitors').textContent = `${guests} ${pluralizeGuests(guests)}`;
  }
  renderPlayers(currentPlayers);
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
  gameStatus.textContent = t('room.game_active', { name: plugin });
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
  gameStatus.textContent = t('room.game_not_started');
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
  showError(t('error.title'), resolveMsg(msg));
});
socket.on('disconnect', () => {
  statusDot.classList.remove('on');
  statusText.textContent = t('status.offline');
});

socket.on('connect', () => {
  if (roomActiveFlag) {
    statusDot.classList.add('on');
    statusText.textContent = currentRoomInfo?.provider === 'local'
      ? t('status.local_only')
      : t('status.active');
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

// ═══════════ RENDER: игроки ═══════════
async function refreshPlayers() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    currentPlayers = j.players || [];
    renderPlayers(currentPlayers);
  } catch {}
}

function playerDisplayName(p) {
  if (p.name) return p.name;
  if (p.isHost) return t('room.host_name');
  return '?';
}

function renderPlayers(list) {
  $('player-count').textContent = String(list.length);
  if (!list.length) {
    playersEl.innerHTML = `<div class="muted-text">${escapeHtml(t('room.no_players'))}</div>`;
    return;
  }
  playersEl.innerHTML = list.map(p => {
    const name = playerDisplayName(p);
    const initial = name.trim().charAt(0).toUpperCase();
    return `
      <div class="player">
        <span class="avatar" style="background:${p.color}">${escapeHtml(initial)}</span>
        <span class="name">${escapeHtml(name)}</span>
        ${p.isHost
          ? `<span class="tag">${escapeHtml(t('room.host_tag'))}</span>`
          : `<button class="kick" data-id="${p.id}" title="${escapeHtml(t('room.kick_title'))}">✕</button>`}
      </div>
    `;
  }).join('');
  playersEl.querySelectorAll('.kick').forEach(b => {
    b.onclick = () => socket.emit('host:kick-player', { playerId: b.dataset.id });
  });
}
function renderChat() {
  if (!messages.length) {
    chatEl.innerHTML = `<div class="muted-text">${escapeHtml(t('room.no_messages'))}</div>`;
    return;
  }
  chatEl.innerHTML = messages.map(m => {
    const who = (m.sender && typeof m.sender === 'object')
      ? resolveMsg(m.sender)
      : (m.sender || '');
    const what = (m.text && typeof m.text === 'object')
      ? resolveMsg(m.text)
      : (m.text || '');
    return `
    <div class="msg">
      <span class="who" style="color:${m.senderColor}">${escapeHtml(who)}</span>
      <span class="what">${escapeHtml(what)}</span>
    </div>
  `;
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function pluralizeGuests(n) {
  return window.LaklyI18n
    ? window.LaklyI18n.plural(n, ['гость', 'гостя', 'гостей'])
    : String(n);
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
  statusText.textContent = t('status.not_started');
  roomActiveFlag = false;
  currentRoomInfo = null;
  currentPlayers = [];
  setStartBtns(false);
  roomEmpty.hidden = false;
  roomActive.hidden = true;
  roomUrl.value = '—';
  qrEl.innerHTML = `<div class="qr-empty">${escapeHtml(t('room.qr_empty'))}</div>`;
  playersEl.innerHTML = `<div class="muted-text">${escapeHtml(t('room.no_players'))}</div>`;
  chatEl.innerHTML = `<div class="muted-text">${escapeHtml(t('room.no_messages'))}</div>`;
  $('player-count').textContent = '0';
  messages = [];
  activePluginName = null;
  lastGameState = null;
  gameFrameWrap.hidden = true;
  gameFrame.src = 'about:blank';
  gameStatus.textContent = t('room.game_not_started');
  if (btnGameFullscreen) btnGameFullscreen.hidden = true;
  exitGameFullscreen();
  updateGameControls();
  renderPluginsGrid();
}

// ═══════════ FULLSCREEN ═══════════
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
  const label = active ? t('room.game_fullscreen_exit') : t('room.game_fullscreen');
  btnGameFullscreen.title = label;
  btnGameFullscreen.setAttribute('aria-label', label);
  btnGameFullscreen.classList.toggle('is-active', active);
}

if (btnGameFullscreen) {
  btnGameFullscreen.onclick = toggleGameFullscreen;
}
document.addEventListener('fullscreenchange', updateFullscreenButton);

// ═══════════ GAMES GRID ═══════════
const EMOJI = { clicker: '🎯', quiz: '🧠', bunker: '🏚️' };

function renderPluginsGrid() {
  pluginsGrid.querySelectorAll('.plugin-card').forEach(el => el.remove());

  for (const p of pluginsCache) {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    card.dataset.pluginId = p.id;

    let actionLabel = t('games.launch');
    let actionClass = 'btn btn-brand btn-sm';
    let actionDisabled = false;
    let actionTitle = '';

    if (!roomActiveFlag) {
      actionLabel = t('games.create_room');
      actionTitle = t('games.card_hint_create');
    } else if (activePluginName === p.id) {
      actionLabel = t('games.running');
      actionClass = 'btn btn-ghost btn-sm';
      actionDisabled = true;
    } else if (activePluginName) {
      actionLabel = t('games.switch');
      actionTitle = t('games.card_hint_switch', { name: activePluginName });
    }

    const configBtn = p.hasConfig
      ? `<button class="btn btn-ghost btn-sm" data-action="config" title="⚙">⚙</button>`
      : '';
    const deleteBtn = p.isBuiltin
      ? ''
      : `<button class="btn btn-ghost-danger btn-sm" data-action="delete" title="🗑">🗑</button>`;

    const displayName = p.name || p.id;
    card.innerHTML = `
      <div class="plugin-emoji">${EMOJI[p.id] || '🎮'}</div>
      <div class="plugin-name">${escapeHtml(displayName)}</div>
      <div class="plugin-desc">${escapeHtml(p.description || '')}</div>
      <div class="plugin-meta">
        v${escapeHtml(p.version)}
        ${p.isBuiltin ? `<span class="plugin-builtin-tag">${escapeHtml(t('games.builtin'))}</span>` : ''}
      </div>
      <div class="plugin-actions">
        <button class="${actionClass}" data-action="launch"
                ${actionDisabled ? 'disabled' : ''}
                title="${escapeHtml(actionTitle)}">${escapeHtml(actionLabel)}</button>
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

  if (!confirm(t('games.delete_title', { name: displayName }))) return;

  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(resolveMsg(j.error) || `HTTP ${r.status}`);

    toast(t('games.deleted', { name: displayName }));

    if (activePluginName === pluginId) {
      activePluginName = null;
      gameFrameWrap.hidden = true;
      gameFrame.src = 'about:blank';
      gameStatus.textContent = t('room.game_not_started');
      if (btnGameFullscreen) btnGameFullscreen.hidden = true;
      exitGameFullscreen();
      updateGameControls();
    }

    await loadPlugins();
  } catch (e) {
    showError(t('games.delete_failed'), e.message);
  }
}

function launchGameFromCard(pluginId) {
  if (!roomActiveFlag) {
    setMode('default');
    pluginSelect.value = pluginId;
    switchView('room');
    toast(t('toast.create_with_game', { name: pluginId }));
    setTimeout(() => createRoom(), 100);
    return;
  }
  pluginSelect.value = pluginId;
  switchView('room');
  if (activePluginName === pluginId) { toast(t('toast.game_already_running')); return; }
  if (activePluginName) toast(t('toast.switching_game', { name: pluginId }));
  socket.emit('host:start-game', { pluginName: pluginId });
}

// ═══════════ CONFIG MODAL ═══════════
async function openConfigModal(pluginId) {
  editingPluginId = pluginId;
  configTitle.textContent = t('config.title', { id: pluginId });
  configError.textContent = '';
  configTextarea.value = t('config.loading');
  configTextarea.disabled = true;
  configSave.disabled = true;
  configModal.hidden = false;

  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/config`);
    const j = await r.json();
    configTextarea.value = j.config ? JSON.stringify(j.config, null, 2) : '{}';
    configHint.textContent = j.isDefault ? t('config.hint_default') : t('config.hint_custom');
  } catch (e) {
    configTextarea.value = '{}';
    configError.textContent = t('config.load_failed', { err: e.message });
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
  catch (e) { configError.textContent = t('config.invalid_json', { err: e.message }); return; }
  configSave.disabled = true;
  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(editingPluginId)}/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: parsed }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(resolveMsg(j.error) || 'HTTP ' + r.status);
    toast(t('config.saved'));
    configModal.hidden = true;
    editingPluginId = null;
    await loadPlugins();
  } catch (e) { configError.textContent = t('config.error_prefix', { err: e.message }); }
  finally { configSave.disabled = false; }
};
configReset.onclick = async () => {
  if (!editingPluginId) return;
  if (!confirm(t('config.reset_confirm'))) return;
  try {
    const r = await fetch(`/api/plugins/${encodeURIComponent(editingPluginId)}/config`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) throw new Error(resolveMsg(j.error) || 'HTTP ' + r.status);
    toast(t('config.reset_done'));
    configModal.hidden = true;
    editingPluginId = null;
    await loadPlugins();
  } catch (e) { configError.textContent = t('config.error_prefix', { err: e.message }); }
};

// ═══════════ PLUGINS API ═══════════
async function loadPlugins() {
  try {
    const r = await fetch('/api/plugins');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();

    pluginsCache = j.plugins || [];
    pluginSelect.innerHTML = '';
    pluginSelect.append(makeOption('', t('room.game_select')));
    for (const p of pluginsCache) pluginSelect.append(makeOption(p.id, p.name || p.id));

    renderPluginsGrid();
  } catch (err) {
    console.error('[app.js] loadPlugins FAILED:', err.stack || err.message);
  }
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
    const langSel = $('set-language');
    if (langSel) langSel.value = s.language || 'auto';
  } catch (e) { console.error('[loadSettings]', e); }
}

// ═══════════ i18n ═══════════
async function initI18n() {
  if (!window.LaklyI18n) {
    console.warn('[app.js] LaklyI18n not loaded — skipping');
    return;
  }
  const langSetting = settings?.language || 'auto';
  try {
    await window.LaklyI18n.init(langSetting);
  } catch (err) {
    console.error('[app.js] i18n init failed:', err.message);
  }
}

const langSelect = $('set-language');
if (langSelect) {
  langSelect.addEventListener('change', async (e) => {
    const lang = e.target.value;
    settings.language = lang;
    if (window.lakly?.setSettings) {
      try { await window.lakly.setSettings({ ...settings }); } catch {}
    }
    const resolved = lang === 'auto'
      ? ((navigator.language || 'en').split('-')[0].toLowerCase() === 'ru' ? 'ru' : 'en')
      : lang;
    try {
      await window.LaklyI18n.setLanguage(resolved);
    } catch (err) {
      console.error('[app.js] setLanguage failed:', err.message);
    }
  });
}

if (window.LaklyI18n) {
  window.LaklyI18n.onChange(() => {
    try { renderPluginsGrid(); } catch {}
    try { renderChat(); } catch {}
    try { renderPlayers(currentPlayers); } catch {}
    try { updateGameControls(); } catch {}
    try {
      if (currentRoomInfo) applyRoomModeUi(currentRoomInfo);
      if (roomActiveFlag) {
        statusText.textContent = currentRoomInfo?.provider === 'local'
          ? t('status.local_only')
          : t('status.active');
      } else {
        statusText.textContent = t('status.not_started');
      }
      if (activePluginName) {
        gameStatus.textContent = t('room.game_active', { name: activePluginName });
      } else {
        gameStatus.textContent = t('room.game_not_started');
      }
      updateFullscreenButton();
    } catch {}
  });
}

// ═══════════ SAVE SETTINGS ═══════════
$('btn-save-settings').onclick = async () => {
  if (!window.lakly) { toast(t('settings.unavailable')); return; }
  const merged = {
    ...settings,
    tunnel: $('set-tunnel').value,
    ngrokToken: $('set-ngrok-token').value,
    port: Number($('set-port').value) || 3000,
    language: $('set-language')?.value || settings.language || 'auto',
  };
  await window.lakly.setSettings(merged);
  settings = merged;
  toast(t('settings.saved_hint'));
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
  if (!file.name.endsWith('.zip')) { toast(t('drop.need_zip')); return; }
  const p = window.lakly?.getPathForFile?.(file) || file.path;
  if (!p) { toast(t('drop.no_path')); return; }
  try {
    const result = await window.lakly.installPluginZip(p);
    if (result.ok) {
      toast(t('games.installed', { name: result.plugin }));
      await loadPlugins();
    } else {
      showError(t('games.install_failed'), resolveMsg(result.error));
    }
  } catch (err) { showError(t('games.install_failed'), err.message); }
});

function installPluginFromDialog() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const p = window.lakly?.getPathForFile?.(file) || file.path;
    if (!p) { toast(t('drop.no_path')); return; }
    const result = await window.lakly.installPluginZip(p);
    if (result.ok) {
      toast(t('games.installed', { name: result.plugin }));
      await loadPlugins();
    } else {
      showError(t('games.install_failed'), resolveMsg(result.error));
    }
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
          navigator.clipboard.writeText(roomUrl.value).then(() => toast(t('toast.link_copied')));
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
  await loadSettings();
  await initI18n();
  loadPlugins();
  setMode('default');
});