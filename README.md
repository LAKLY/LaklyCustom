# LaklyCustom

Desktop-утилита для запуска локальных комнат с доступом через браузер.

Хост запускает приложение → нажимает «Создать комнату» → получает публичную ссылку (Cloudflare Quick Tunnel) → друзья открывают её в браузере без установки.

## Возможности

- 🎮 Плагины: игры, квизы, голосования.
- 🌐 Публичный доступ без токенов и регистраций (Cloudflare Quick Tunnel).
- 📱 Гости подключаются по ссылке или QR-коду.
- 💬 Текстовый чат и лобби.
- 📦 Установка плагинов через ZIP (drag & drop).
- 🖥 Трей-иконка, уведомления, работа в фоне.

## Установка (для разработки)

```bash
npm install
npm start
Требуется Node.js 20+.

Скрипты
Команда	Что делает
npm start	Запуск Electron-приложения
npm run dev	Режим разработки
npm test	Запуск unit-тестов
npm run test:watch	Тесты в watch-режиме
Документация
Архитектура

Plugin API

Безопасность

Лицензия
MIT

text

---

## 18. `docs/plugin-api.md` — **новый файл**

```markdown
# Plugin API

## Структура плагина
plugins/my-plugin/
├── manifest.json ← метаданные
├── index.js ← серверная логика (hooks)
└── public/
└── game.html ← UI игры в <iframe>

text

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "Короткое описание"
}
Обязательные: id (совпадает с именем папки), version, apiVersion. id — только [a-z0-9_-], начинается с буквы или цифры, до 40 символов.

Хуки
Плагин экспортирует default с полем hooks:

js
import { EVENTS } from '../../shared/events.js';

const state = new Map();

export default {
  name: 'my-plugin',
  version: '1.0.0',

  hooks: {
    [EVENTS.ROOM_CREATED]:  ({ room }) => { state.set(room.id, {}); },
    [EVENTS.ROOM_DESTROYED]:({ roomId }) => { state.delete(roomId); },
    [EVENTS.PLAYER_JOINED]: ({ room, socket, player }) => {},
    [EVENTS.PLAYER_LEFT]:   ({ room, player }) => {},
    [EVENTS.PLAYER_KICKED]: ({ room, player }) => {},
    [EVENTS.GAME_START]:    ({ room, plugin }) => {},
    [EVENTS.GAME_STOP]:     ({ room, plugin }) => {},
    [EVENTS.GAME_ACTION]:   ({ room, player, action, data }) => {},
  },
};
Хук	Когда вызывается	Payload
ROOM_CREATED	Комната создана	{ room }
ROOM_CLOSING	Хост закрывает комнату, клиенты ещё онлайн	{ room, reason }
ROOM_CLOSED	Клиенты оповещены, можно слать финальные сообщения	{ room, reason }
ROOM_DESTROYED	Финальный сигнал — очищайте state	{ roomId }
PLAYER_JOINED	Игрок вошёл	{ room, socket, player }
PLAYER_LEFT	Игрок вышел сам	{ room, player }
PLAYER_KICKED	Игрок кикнут хостом	{ room, player }
GAME_START	Хост запустил игру	{ room, plugin }
GAME_STOP	Хост остановил игру	{ room, plugin }
GAME_ACTION	Игрок сделал действие	{ room, socket, player, action, data }
Объект room
room.id — id комнаты

room.broadcast(event, data) — отправить событие всем в комнате

room.players — Map<socketId, player>

room.gameActive — игра запущена?

room.activePluginName — какой плагин активен

Клиент ↔ iframe
Плагин рассылает game:state через room.broadcast. Родительское окно (хост-панель или гостевая страница) принимает это событие и через postMessage передаёт в iframe.

В game.html:

js
window.parent.postMessage({ type: 'lakly:ready' }, '*');

window.addEventListener('message', (e) => {
  if (e.data?.type === 'lakly:state') render(e.data.data);
});

btn.onclick = () => {
  window.parent.postMessage({ type: 'lakly:action', action: 'click' }, '*');
};
Сообщения:

Тип	Направление	Payload
lakly:ready	iframe → parent	—
lakly:init	parent → iframe	{ player }
lakly:state	parent → iframe	{ data }
lakly:action	iframe → parent	{ action, data }
Установка плагина
Соберите папку с manifest.json, index.js, public/.

Заархивируйте в ZIP (плагин может быть в корне или в подпапке).

В приложении откройте вкладку «Плагины», перетащите ZIP в окно.

Сервер проверит: размер ≤ 10 MB, файлов ≤ 500, распакованный размер ≤ 50 MB, никаких ../ и абсолютных путей, допустимые расширения.

text

---

## 19. `docs/security.md` — **новый файл**

```markdown
# Безопасность

## Модель доверия

- **Хост** — полностью доверенный. Работает в собственном Electron-процессе.
- **Гость** — недоверенный. Общается только через Socket.IO.
- **Плагины** — доверенные, но с ограничениями. Работают в том же Node-процессе, что и ядро, поэтому **устанавливайте только плагины из проверенных источников**.

## Что уже защищено

### Валидация входных данных
Все Socket.IO payload'ы проходят валидацию в `shared/validation.js`:
- имена игроков ≤ 24 символов
- сообщения чата ≤ 500 символов
- id плагинов соответствуют `^[a-z0-9][a-z0-9_-]{0,39}$`
- action'ы игр — `^[a-z0-9_:-]{1,40}$`

### Rate limiting
`shared/rate-limit.js` ограничивает:
- создание комнат: 3/мин/IP
- входы: 5/мин/IP
- чат: 5/сек/сокет
- действия игр: 60/сек/сокет
- кики: 20/мин/сокет

### Безопасная установка ZIP
При установке плагина проверяются:
- размер архива ≤ 10 MB
- количество файлов ≤ 500
- распакованный размер ≤ 50 MB
- никаких `..` и абсолютных путей (защита от path traversal)
- whitelist расширений

### CORS
Socket.IO принимает соединения только от:
- `localhost`, `127.0.0.1`
- `*.trycloudflare.com`, `*.ngrok-free.app`, `*.ngrok.io`

### postMessage
Сообщения от iframe принимаются только если `e.source === iframe.contentWindow`. Незнакомые сообщения игнорируются.

### Electron
- `contextIsolation: true`
- `nodeIntegration: false`
- весь доступ из UI — через `preload.js` и `contextBridge`

## Известные ограничения

### Плагины имеют доступ к Node.js API
Плагин — это ES-модуль, выполняемый в том же процессе. Он может вызывать `fs`, `child_process`, `net` и т.д.

**Решение на будущее (v0.7+):** sandboxed plugin host через `worker_threads` + ограниченный API, либо `isolated-vm`.

### Токены комнат не используются для входа
Сейчас любой, кто знает `roomId`, может присоединиться. Планируется:
- `joinToken` в URL — обязательный параметр
- `hostToken` — для критичных операций (закрытие комнаты, кик)

### Нет шифрования чата
Socket.IO передаёт данные по WSS (через HTTPS туннеля), но без дополнительного end-to-end шифрования. Для приватных комнат — используйте пароль (в разработке).

## Сообщить об уязвимости

Если нашли проблему — создайте Issue с меткой `security`.
20. docs/architecture.md — новый файл
markdown
# Архитектура

## Слои
┌────────────────────────────────────────┐
│ Electron main process │
│ • окно хоста, трей, IPC │
├────────────────────────────────────────┤
│ Core (Node.js) │
│ • Express (HTTP) │
│ • Socket.IO (realtime) │
│ • RoomManager (Map<roomId, Room>) │
│ • PluginLoader (hooks + load) │
│ • TunnelManager (Cloudflare/ngrok) │
├────────────────────────────────────────┤
│ Plugins (server + client) │
│ • hooks, реагируют на события ядра │
│ • game.html живёт в iframe │
├────────────────────────────────────────┤
│ UI │
│ • /host — панель в Electron │
│ • / — гостевая страница в браузере │
│ • /plugins/<id>/ — статика плагина │
└────────────────────────────────────────┘

text

## Поток данных
Гость Ядро Плагин
│ │ │
│ socket.emit('player:join') │ │
│─────────────────────────────►│ │
│ │ room.addPlayer() │
│ │ emit PLAYER_JOINED ────────►│
│ │ │
│ │◄──── socket.emit(GAME_STATE) │
│◄─ room:updated, chat │ │
│ │ │
│ socket.emit('game:action') │ │
│─────────────────────────────►│ │
│ │ validate, rate-limit │
│ │ emit GAME_ACTION ──────────►│
│ │ │
│ │◄──── room.broadcast(...) ────│
│◄─ game:state │ │
│ postMessage в iframe │ │

text

## Жизненный цикл комнаты

1. `host:create-room` → `RoomManager.createRoom()` → `Room` создаётся, `ROOM_CREATED`.
2. `player:join` → `room.addPlayer()` → `PLAYER_JOINED`.
3. `host:start-game` → `room.startGame()` → `GAME_START`.
4. `game:action` → `room.handleGameAction()` → `GAME_ACTION`.
5. `host:close-room` или disconnect хоста:
   - `ROOM_CLOSING` (клиенты ещё онлайн)
   - broadcast `room:closed` клиентам
   - `ROOM_CLOSED` (поздние операции)
   - `ROOM_DESTROYED` (плагины чистят state)

## Провайдеры туннелей

`core/tunnels/index.js` перебирает провайдеров в порядке приоритета:
1. **Cloudflare Quick Tunnel** — работает всегда, без токена.
2. **ngrok** — если задан `NGROK_TOKEN`.
3. **localhost** — fallback.

Каждый провайдер реализует `isAvailable()` + `start(port)` + `stop()`.

## Хранилище

Всё в памяти. При перезапуске приложения — комнаты теряются. Это осознанное решение: local-first, privacy-focused, никаких утечек на диск.
🚀 Что сделать
powershell
# 1. Установить (появился unzipper в явном виде)
npm.cmd install

# 2. Прогнать тесты
npm.cmd test

# 3. Запустить приложение
npm.cmd start
Ожидаемый результат npm test:

text
✔ validatePlayerName: принимает корректные имена
✔ validatePlayerName: отклоняет мусор
✔ validateChatMessage: длинные сообщения отклоняются
✔ validateRoomName: fallback на дефолт
✔ validatePluginId: только безопасные id
✔ validateGameAction: безопасные имена действий
✔ RateLimiter: счётчик в пределах лимита
✔ RateLimiter: разные ключи независимы
✔ RateLimiter: reset очищает ключ
✔ PluginLoader: загружает clicker
✔ PluginLoader: reload не дублирует handlers
✔ PluginLoader: unload удаляет handlers
