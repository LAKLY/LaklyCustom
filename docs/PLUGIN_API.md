# LaklyCustom · Plugin API v1

Спецификация для написания плагинов-игр. Документ описывает **фактический** API ядра LaklyCustom. Если что-то не описано здесь — этого в API нет, не выдумывай.

---

## 1. Что такое плагин

Плагин — это папка, которую ядро загружает в изолированный `worker_threads`-воркер. Плагин экспортирует серверные хуки и, опционально, клиентский UI (`game.html`), который показывается в `<iframe>` у хоста и у каждого гостя.

Плагин может:

- Реагировать на события комнаты (создание, вход игрока, старт игры и т.д.).
- Хранить своё состояние в памяти воркера.
- Рассылать `game:state` всем в комнате через `room.broadcast`.
- Слать приватные сообщения конкретному сокету через `room.emitTo`.
- Писать системные сообщения в чат через `room.addMessage`.

Плагин **не может**:

- Обращаться к `socket.emit` из ядра.
- Вызывать `io.*` напрямую.
- Читать чужие комнаты.

---

## 2. Структура папки

```
plugins/my-plugin/
├── manifest.json        ← обязателен
├── index.js             ← обязателен, серверная логика
├── config.json          ← опционально, дефолтный конфиг
└── public/
    ├── game.html        ← опционально, UI в iframe
    ├── style.css
    └── script.js
```

Имя папки должно совпадать с `id` в `manifest.json`.

---

## 3. manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "Короткое описание"
}
```

| Поле | Обязательно | Правила |
|------|-------------|---------|
| `id` | да | `^[a-z0-9][a-z0-9_-]{0,39}$`, совпадает с именем папки |
| `name` | нет | до 60 символов, fallback — `id` |
| `version` | да | `^\d+\.\d+\.\d+` (semver) |
| `apiVersion` | да | ровно `1` |
| `entry` | нет | по умолчанию `index.js`, только `.js` / `.mjs`, без `..` и абсолютных путей |
| `description` | нет | до 200 символов |

Если `apiVersion` не равен 1 или `id` невалиден — плагин **молча пропускается** при загрузке (в консоли будет `[plugins] <id>: невалидный manifest`).

---

## 4. Экспорт из index.js

```js
import { EVENTS } from '../../shared/events.js';

const state = new Map(); // roomId -> любое состояние

export default {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Короткое описание',

  // Опционально — вызывается один раз при загрузке плагина,
  // получает пользовательский или дефолтный конфиг.
  onConfig(config) {
    // config может быть null
  },

  hooks: {
    [EVENTS.ROOM_CREATED]:   ({ room }) => {},
    [EVENTS.ROOM_DESTROYED]: ({ roomId }) => {},
    [EVENTS.PLAYER_JOINED]:  ({ room, socket, player }) => {},
    [EVENTS.PLAYER_LEFT]:    ({ room, player }) => {},
    [EVENTS.PLAYER_KICKED]:  ({ room, player }) => {},
    [EVENTS.GAME_START]:     ({ room, plugin }) => {},
    [EVENTS.GAME_STOP]:      ({ room, plugin }) => {},
    [EVENTS.GAME_ACTION]:    ({ room, socket, player, action, data }) => {},
  },
};
```

**Правила:**

- Никаких `module.exports`. Только ESM: `export default { … }`.
- В `hooks` могут быть любые из перечисленных событий. Отсутствующие — просто не вызываются.
- Всё, что нужно сохранить между вызовами — держи в модульных переменных (`const state = new Map()`).
- Каждый хук может быть `async`, ядро дождётся промиса.
- Таймаут на хук — 5 секунд. Зависший хук логируется и отбрасывается.

---

## 5. События (EVENTS)

Импортируй из `../../shared/events.js`:

```js
import { EVENTS } from '../../shared/events.js';
```

### Полный список

| Константа | Строковое значение | Когда вызывается |
|-----------|-------------------|------------------|
| `ROOM_CREATED` | `core:room-created` | Комната создана |
| `ROOM_CLOSING` | `core:room-closing` | Хост закрывает, клиенты ещё онлайн |
| `ROOM_CLOSED` | `core:room-closed` | Клиенты оповещены, игроки очищены |
| `ROOM_DESTROYED` | `core:room-destroyed` | Финальный сигнал — чисти state |
| `PLAYER_JOINED` | `core:player-joined` | Гость вошёл (не хост) |
| `PLAYER_LEFT` | `core:player-left` | Гость вышел сам |
| `PLAYER_KICKED` | `core:player-kicked` | Гостя кикнул хост |
| `GAME_START` | `core:game-start` | Хост запустил игру |
| `GAME_STOP` | `core:game-stop` | Хост остановил игру |
| `GAME_ACTION` | `core:game-action` | Игрок прислал действие |
| `GAME_STATE` | `game:state` | **Клиентское событие** — для broadcast клиентам |

`GAME_STATE` — не хук, а имя события, которое ты рассылаешь клиентам. Хука для него нет.

---

## 6. Payload хуков

### `ROOM_CREATED`

```js
({ room }) => {}
```

- `room.id` — string
- `room.isActive` — true
- `room.gameActive` — false
- `room.hostSocketId` — socket.id хоста
- `room.playerCount` — 0

Комната уже существует, но игры ещё нет. Идеальное место для `state.set(room.id, initial)`.

### `ROOM_DESTROYED`

```js
({ roomId }) => {}
```

`roomId` — string. **Обязательно** чисти своё состояние: `state.delete(roomId)`. Иначе утечка.

### `PLAYER_JOINED`

```js
({ room, socket, player }) => {}
```

- `socket.id` — Socket.IO id (нужен для `room.emitTo`)
- `socket.emit(event, data)` — отправить конкретно этому игроку
- `player.id` — uuid игрока (используй это как ключ!)
- `player.name` — string
- `player.color` — hex
- `player.isHost` — всегда `false` здесь

**Хост не приходит через `PLAYER_JOINED`.** Хост существует вне списка игроков, но при `GAME_ACTION` от хоста `player = { id: 'host', name: 'Хост', isHost: true }`.

### `PLAYER_LEFT` / `PLAYER_KICKED`

```js
({ room, player }) => {}
```

- `player.id`, `player.name`, `player.color`, `player.isHost`

Отличие только семантическое: `LEFT` — сам вышел, `KICKED` — принудительно. Обработку делай идентичной.

### `GAME_START` / `GAME_STOP`

```js
({ room, plugin }) => {}
```

- `plugin` — id плагина (`'my-plugin'`)

`GAME_START` — инициализируй раунд, сгенерируй начальное состояние, разошли `GAME_STATE`.
`GAME_STOP` — сбрось фазу, очисти временные данные.

### `GAME_ACTION`

```js
({ room, socket, player, action, data }) => {}
```

- `socket` — `{ id, emit }`
- `player` — `{ id, name, color, isHost }` **или** `{ id: 'host', name: 'Хост', color: '#00F5FF', isHost: true }`
- `action` — string, проходит через `validateGameAction` (только `^[a-z0-9_:-]{1,40}$`)
- `data` — объект от клиента, может быть пустым `{}`

**Никогда не используй `player.socketId`** — такого поля нет. Для отправки конкретному игроку используй `socket.emit` (у тебя уже есть `socket` в payload).

---

## 7. Объект `room`

Прокси, доступный во всех хуках.

| Свойство | Тип | Что |
|----------|-----|-----|
| `room.id` | string | id комнаты |
| `room.isActive` | bool | комната жива |
| `room.gameActive` | bool | игра запущена |
| `room.activePluginName` | string \| null | id активного плагина |
| `room.hostSocketId` | string | socket.id хоста |
| `room.playerCount` | number | сколько игроков (без хоста) |
| `room.players` | `Map<socketId, player>` | все гости |

### Методы

```js
room.broadcast(event, data);              // всем в комнате
room.emitTo(socketId, event, data);       // конкретному сокету
room.addMessage(sender, color, text);     // системное сообщение в чат
```

- `broadcast` — основа всего. Клиенты получают событие в `socket.on(event, handler)`.
- `emitTo` — приватные сообщения (например, чей-то персонаж только ему).
- `addMessage` — идёт в общий чат как обычная реплика, но с указанным именем и цветом.

---

## 8. Клиент ↔ iframe

### Протокол postMessage

| Тип | Направление | Payload | Когда |
|-----|-------------|---------|-------|
| `lakly:ready` | iframe → parent | — | Клиент загрузился и готов |
| `lakly:init` | parent → iframe | `{ player }` | Ответ на ready, один раз |
| `lakly:state` | parent → iframe | `{ data }` | Каждый broadcast `game:state` |
| `lakly:action` | iframe → parent | `{ action, data }` | Игрок что-то нажал |

**`player` в `lakly:init`:**

```js
{
  playerId: 'uuid' | 'host',   // ← используй это для «это я»
  playerName: 'Аня',
  playerColor: '#E5384F'
}
```

### Готовая обвязка для game.html

Положи в `public/script.js`:

```js
let me = null;          // { playerId, playerName, playerColor }
let state = null;       // последнее lakly:state.data

// 1. Сообщаем родителю, что мы загрузились
window.parent.postMessage({ type: 'lakly:ready' }, '*');

// 2. Слушаем входящие
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'lakly:init') {
    me = msg.player;
    render();
  }
  if (msg.type === 'lakly:state') {
    state = msg.data;
    render();
  }
});

// 3. Отправка действия на сервер
function sendAction(action, data = {}) {
  window.parent.postMessage({ type: 'lakly:action', action, data }, '*');
}

function render() {
  // твоя отрисовка на основе me и state
}
```

**Ошибки, которых надо избежать:**

- ❌ `type: 'lakly:game-action'` — не существует.
- ❌ `type: 'lakly:player-info'` — не существует. Идентификация игрока идёт через `lakly:init`.
- ❌ `event.data.playerId` в корне — на самом деле `event.data.player.playerId`.
- ❌ `event.data.state` — на самом деле `event.data.data`.

### Клиент должен сопоставлять себя с серверным состоянием

Сервер в `GAME_STATE` отдаёт что-то вроде:

```js
{
  players: [
    { id: 'host', name: 'Хост', ... },
    { id: 'p-abc', name: 'Аня', ... },
  ]
}
```

`id` здесь — это `player.id` (uuid), не socket.id. Клиент читает свой `playerId` из `lakly:init` и ищет:

```js
const meInState = state.players.find(p => p.id === me.playerId);
```

**Важно:** если на сервере ты хранишь игроков по `socket.id` — ты не сможешь сопоставить их на клиенте. Всегда ключуй и отдавай `player.id`.

---

## 9. Пример: минимальный рабочий плагин

### `plugins/counter/manifest.json`

```json
{
  "id": "counter",
  "name": "Counter",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "Общий счётчик кликов"
}
```

### `plugins/counter/index.js`

```js
import { EVENTS } from '../../shared/events.js';

const state = new Map(); // roomId -> { count, scores: Map<playerId, number> }

function getState(roomId) {
  if (!state.has(roomId)) {
    state.set(roomId, { count: 0, scores: new Map() });
  }
  return state.get(roomId);
}

function leaderboard(s) {
  return [...s.scores.entries()]
    .map(([id, clicks]) => ({ id, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
}

export default {
  name: 'counter',
  version: '1.0.0',
  description: 'Общий счётчик кликов',

  hooks: {
    [EVENTS.ROOM_CREATED]: ({ room }) => {
      state.set(room.id, { count: 0, scores: new Map() });
    },

    [EVENTS.ROOM_DESTROYED]: ({ roomId }) => {
      state.delete(roomId);
    },

    [EVENTS.GAME_START]: ({ room }) => {
      const s = getState(room.id);
      s.count = 0;
      s.scores.clear();
      room.broadcast(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
      });
    },

    [EVENTS.PLAYER_JOINED]: ({ room, socket }) => {
      if (!room.gameActive) return;
      const s = getState(room.id);
      socket.emit(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
      });
    },

    [EVENTS.GAME_ACTION]: ({ room, player, action }) => {
      if (action !== 'click') return;
      const s = getState(room.id);
      s.count++;
      s.scores.set(player.id, (s.scores.get(player.id) || 0) + 1);
      room.broadcast(EVENTS.GAME_STATE, {
        count: s.count,
        leaderboard: leaderboard(s),
      });
    },
  },
};
```

### `plugins/counter/public/game.html`

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Counter</title>
  <style>
    body { font: 16px system-ui; text-align: center; padding: 24px; }
    #count { font-size: 64px; font-weight: 700; }
    button { font-size: 20px; padding: 16px 32px; }
  </style>
</head>
<body>
  <div id="count">0</div>
  <button id="btn">Клик!</button>
  <script src="script.js"></script>
</body>
</html>
```

### `plugins/counter/public/script.js`

```js
let me = null;
let state = null;

window.parent.postMessage({ type: 'lakly:ready' }, '*');

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'lakly:init') {
    me = msg.player;
  }
  if (msg.type === 'lakly:state') {
    state = msg.data;
    if (state && typeof state.count === 'number') {
      document.getElementById('count').textContent = state.count;
    }
  }
});

document.getElementById('btn').addEventListener('click', () => {
  window.parent.postMessage({ type: 'lakly:action', action: 'click', data: {} }, '*');
});
```

Этот плагин рабочий. Копируй и меняй под свою игру.

---

## 10. Конфиг плагина

### Дефолтный `config.json` (в корне плагина)

```json
{
  "rounds": 5,
  "timeoutSec": 30
}
```

Показывается в UI как кнопка ⚙ в карточке плагина. Пользователь может отредактировать JSON, изменения сохраняются в `userData/plugin-data/<id>.json` и **не теряются** при обновлении плагина.

### Загрузка конфига в `index.js`

```js
let config = { rounds: 5, timeoutSec: 30 };

export default {
  onConfig(incoming) {
    if (incoming && typeof incoming === 'object') {
      config = { ...config, ...incoming };
    }
  },
  hooks: { /* ... */ },
};
```

`onConfig` вызывается один раз при загрузке плагина. Если пользователь сохранит новый конфиг — ядро перезагрузит плагин, и `onConfig` вызовется заново.

---

## 11. Полная таблица правил и ограничений

### Валидация action

Строка `action` из `lakly:action` проходит через ядро. Разрешены только:

- `[a-z0-9_:-]`
- длина 1–40 символов

Не используй пробелы, русские буквы, `<>`. Название action — латиница в snake_case или kebab-case.

### Rate limits

| Действие | Лимит |
|----------|-------|
| `chat:message` | 5 / сек / сокет |
| `game:action` | 60 / сек / сокет |
| `host:create-room` | 3 / мин / IP |
| `player:join` | 5 / мин / IP |
| `host:kick-player` | 20 / мин / сокет |

Если игрок спамит — ядро молча отбрасывает действия. Плагин об этом не узнает.

### Размеры файлов при установке ZIP

| Ограничение | Значение |
|-------------|----------|
| ZIP | ≤ 10 МБ |
| Распакованный | ≤ 50 МБ |
| Файлов | ≤ 500 |
| Расширения | `.js .mjs .cjs .json .html .css .svg .png .jpg .jpeg .gif .webp .ico .woff .woff2 .ttf .otf .txt .md` |

Всё остальное отклонится. Никаких `.exe`, `.sh`, `.so`, `node_modules`.

### Изоляция

- Каждый плагин — свой `worker_threads`.
- Лимиты памяти: 128 МБ heap, 32 МБ young gen.
- `fs`, `child_process`, `net` **доступны** (это не полноценная песочница).
- Хук, который не ответил за 5 секунд — отменяется.

Устанавливай только плагины, которым доверяешь.

---

## 12. Установка и отладка

### Установка через UI

1. Собери папку плагина.
2. Заархивируй в `.zip` (папка может быть в корне архива или внутри одной вложенной папки).
3. В приложении открой **Игры** → перетащи ZIP в окно.
4. Плагин появится в списке через секунду.

### Что смотреть в логах

Запусти `npm start` и смотри терминал:

```
[plugins] Загружен: counter v1.0.0 (sandboxed)
```

Если плагин не загрузился — увидишь:

```
[plugins] counter: невалидный manifest, пропускаем
[plugins] counter: не найден index.js
[plugins] counter: Worker error: ...
```

### Кнопка «Настройки» (⚙)

Появляется в карточке плагина только если есть `config.json`. Открывает редактор JSON прямо в UI.

### Отладка клиента

В гостевой странице и в UI хоста открой DevTools (`F12`). Ошибки из `game.html` видны во вкладке Console вложенного iframe.

---

## 13. Чек-лист перед публикацией

- [ ] `manifest.json` — валидный `id`, `version`, `apiVersion: 1`, `entry: index.js`
- [ ] `index.js` — `export default { … }`, хуки используют `EVENTS.*`
- [ ] Игроки хранятся по `player.id`, не по `socket.id`
- [ ] Хост учтён как `player.id === 'host'` (например, в `GAME_START`)
- [ ] `PLAYER_KICKED` обрабатывается так же, как `PLAYER_LEFT`
- [ ] `ROOM_DESTROYED` чистит `state` (`state.delete(roomId)`)
- [ ] Клиент использует `lakly:ready` / `lakly:init` / `lakly:state` / `lakly:action` — и никаких других типов
- [ ] Клиент читает `msg.player.playerId` (не `msg.playerId`)
- [ ] Клиент читает `msg.data` (не `msg.state`)
- [ ] Приватные данные шлются через `socket.emit` / `room.emitTo`, публичные — через `room.broadcast`
- [ ] Все действия (`action`) — латиница, `snake_case`, ≤ 40 символов
- [ ] Плагин не блокирует главный поток (не делает тяжёлых синхронных операций)

---

## 14. Частые ошибки

| Ошибка | Что будет | Как исправить |
|--------|-----------|---------------|
| `module.exports = { … }` | Плагин не загрузится: `нет default export` | `export default { … }` |
| Использование `socket.emit` из ядра | Не падает, но не работает | Только `room.broadcast` / `room.emitTo` / `socket.emit` из payload |
| Идентификация игроков по `socket.id` | Клиент не найдёт себя в списке | Ключуй по `player.id`, отдавай `id: player.id` |
| Нет проверки `player.isHost` | Любой гость управляет фазами | `if (!player.isHost) return;` |
| Не обработан `PLAYER_KICKED` | Кикнутый висит в списке | Обработай как `PLAYER_LEFT` |
| Нет `state.delete(roomId)` в `ROOM_DESTROYED` | Утечка памяти | Удали обязательно |
| Хост не добавлен в `state.players` | Хост не видит себя, не может играть | Добавляй в `ROOM_CREATED` или `GAME_START` |
| Персонаж рассылается всем | Все видят всех | Приватные поля — через `socket.emit` каждому |
| Клиент слушает `lakly:game-state` | Ничего не приходит | Правильно: `lakly:state`, данные в `msg.data` |
| Клиент читает `event.data.playerId` | `undefined` | Правильно: `msg.player.playerId` |
| Действие с пробелами/кириллицей | Ядро отбрасывает | Только `[a-z0-9_:-]`, ≤ 40 символов |
| Хук дольше 5 секунд | Таймаут, ядро логирует | Никаких синхронных `while`, тяжёлых `await` без нужды |

---

## 15. Готовый шаблон

Папка `plugins/_template/` содержит пустой рабочий каркас. Копируй и переименовывай:

```
plugins/_template/
├── manifest.json    ← поменяй id, name, description
├── index.js         ← замени заглушки на свою логику
└── public/
    ├── game.html
    └── script.js    ← обвязка postMessage уже готова
```

Всё остальное — только твой игровой код.