const socket = io();
const $ = id => document.getElementById(id);
let me = null;
let messages = [];
let activeGame = null;
let lastGameState = null;

function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(name).classList.add('active');
}

function join() {
  const name = $('player-name').value.trim();
  if (!name) { $('join-error').textContent = 'Введите имя'; return; }
  $('join-error').textContent = '';
  socket.emit('player:join', { playerName: name });
}

$('btn-join').onclick = join;
$('player-name').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
$('btn-send').onclick = send;
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

function send() {
  const t = $('chat-input').value.trim();
  if (!t) return;
  socket.emit('chat:message', { text: t });
  $('chat-input').value = '';
}

socket.on('player:joined-success', (data) => {
  me = data;
  $('player-self').textContent = data.playerName;
  $('player-self').style.color = data.playerColor;
  show('room-screen');
  if (data.gameActive && data.activePlugin) showGame(data.activePlugin);
});

socket.on('room:updated', ({ players }) => renderPlayers(players));
socket.on('room:player-joined', refresh);
socket.on('room:player-left', refresh);

socket.on('chat:new-message', (msg) => {
  messages.push(msg);
  if (messages.length > 200) messages.shift();
  renderChat();
});

socket.on('room:closed', () => show('closed-screen'));
socket.on('player:kicked', () => { alert('Вас исключили из комнаты'); show('closed-screen'); });
socket.on('error', (msg) => { $('join-error').textContent = typeof msg === 'string' ? msg : 'Ошибка'; });

// --- Игра ---
socket.on('game:started', ({ plugin, url }) => showGame(plugin, url));
socket.on('game:stopped', () => hideGame());

// Пересылаем состояние игры в iframe
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
  block.style.display = 'block';
}

function hideGame() {
  activeGame = null;
  lastGameState = null;
  $('game-block').style.display = 'none';
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

// --- Рендер ---
async function refresh() {
  try {
    const r = await fetch('/api/room');
    const j = await r.json();
    renderPlayers(j.players || []);
  } catch {}
}

function renderPlayers(list) {
  $('count').textContent = String(list.length);
  $('players').innerHTML = list.length
    ? list.map(p => `
        <div class="player">
          <span class="dot" style="background:${p.color}"></span>
          <span>${esc(p.name)}</span>
        </div>`).join('')
    : '<div class="empty">Пока никого</div>';
}

function renderChat() {
  $('chat').innerHTML = messages.map(m => `
    <div class="msg">
      <b style="color:${m.senderColor}">${esc(m.sender)}:</b> ${esc(m.text)}
    </div>
  `).join('');
  $('chat').scrollTop = $('chat').scrollHeight;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}