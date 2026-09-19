```markdown
# LaklyCustom

Desktop-утилита для запуска локальных комнат с доступом через браузер.

Хост запускает приложение → нажимает «Создать комнату» → получает публичную ссылку (Cloudflare Quick Tunnel) → друзья открывают её в браузере без установки.

---

## Возможности

- 🎮 **Плагины**: игры, викторины, голосования — устанавливаются как ZIP.
- 🌐 **Публичный доступ** без токенов и регистраций (Cloudflare Quick Tunnel).
- 📱 **Гости по ссылке или QR-коду** — ничего не устанавливают.
- 💬 **Чат и лобби** в реальном времени.
- 📁 **Раздача папки** — показать друзьям HTML-сайт с диска.
- 🔌 **Прокси локального порта** — пробросить `localhost:5173` наружу (Vite, Next, Angular…).
- 📦 **Установка плагинов drag & drop** — ZIP прямо в окно.
- 🖥 **Трей-иконка**, уведомления, работа в фоне, горячие клавиши.
- 🔁 **Автовосстановление туннеля** — при падении сети или edge пересоздаётся автоматически.

---

## Быстрый старт

```bash
git clone https://github.com/LAKLY/LaklyCustom
cd LaklyCustom
npm install
npm start
```

**Требования:** Node.js **20 LTS** или новее, Windows / macOS / Linux.

> На Node 24 возможны капризы `postinstall` у Electron. Если падает с `Electron failed to install correctly` — используйте Node 20 или добавьте зеркало:
> ```powershell
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> npm install
> ```

---

## Скрипты

| Команда | Что делает |
|---------|-----------|
| `npm start` | Запуск Electron-приложения |
| `npm run dev` | Режим разработки |
| `npm test` | Unit-тесты (node:test) |
| `npm run test:watch` | Тесты в watch-режиме |

---

## Как это работает

```
┌─────────────────────────────────────────┐
│  Electron main process                  │
│  окно хоста · трей · IPC · уведомления  │
├─────────────────────────────────────────┤
│  Core (Node.js)                         │
│  Express · Socket.IO · RoomManager      │
│  PluginLoader · TunnelSupervisor        │
├─────────────────────────────────────────┤
│  Plugins (server + client)              │
│  hooks реагируют на события ядра        │
│  game.html живёт в <iframe>             │
├─────────────────────────────────────────┤
│  UI                                     │
│  /host — панель в Electron              │
│  /     — гостевая страница в браузере   │
│  /plugins/<id>/ — статика плагина       │
└─────────────────────────────────────────┘
```

**Три режима комнаты:**

| Режим | Что даёт гостям |
|-------|-----------------|
| `default` | Лобби, чат, плагины (игры) |
| `static` | HTML-сайт из выбранной папки |
| `proxy` | Проброс локального порта (dev-preview) |

**Провайдеры туннелей** перебираются по приоритету:
1. Cloudflare Quick Tunnel — работает всегда, без токена.
2. ngrok — если задан `NGROK_TOKEN`.
3. localhost — fallback, только локальная сеть.

`TunnelSupervisor` проверяет туннель каждые 45 секунд (интернет → локальный сервер → публичный URL) и пересоздаёт при устойчивых сбоях. При смене URL ссылка и QR обновляются автоматически, гостям приходит системное сообщение в чат.

---

## Структура проекта

```
LaklyCustom/
├── core/                    # Ядро
│   ├── server.js            # Express + Socket.IO
│   ├── room-manager.js      # Реестр комнат
│   ├── room.js              # Одна комната
│   ├── plugin-loader.js     # Загрузка плагинов из plugins/
│   ├── plugin-host.js       # Sandbox плагина (worker_threads)
│   ├── plugin-worker.js     # Изолированный воркер
│   ├── proxy.js             # http-proxy + WS upgrade
│   ├── tunnel-supervisor.js # Health-check и авто-пересоздание туннеля
│   └── tunnels/             # Провайдеры: cloudflare / ngrok / local
├── electron/                # Electron main + preload
├── ui/                      # Хост-панель (/host)
├── public/                  # Гостевая страница (/)
├── plugins/                 # Установленные плагины
│   ├── clicker/
│   └── quiz/
├── shared/                  # Общие модули (events, validation, rate-limit)
├── assets/                  # Иконки, маскот Ника, tray-иконки
└── tests/                   # node:test
```

---

## Плагины

### Структура

```
plugins/my-plugin/
├── manifest.json        ← метаданные
├── index.js             ← серверная логика (hooks)
├── config.json          ← (опционально) дефолтный конфиг
└── public/
    └── game.html        ← UI игры в <iframe>
```

### manifest.json

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

Обязательные: `id` (совпадает с именем папки), `version`, `apiVersion`.  
`id` — только `[a-z0-9_-]`, начинается с буквы или цифры, до 40 символов.

### Хуки

Плагин экспортирует `default` с полем `hooks`:

```js
import { EVENTS } from '../../shared/events.js';

const state = new Map();

export default {
  name: 'my-plugin',
  version: '1.0.0',

  // Опционально: получение конфига
  onConfig(config) { /* ... */ },

  hooks: {
    [EVENTS.ROOM_CREATED]:   ({ room }) => { state.set(room.id, {}); },
    [EVENTS.ROOM_DESTROYED]: ({ roomId }) => { state.delete(roomId); },
    [EVENTS.PLAYER_JOINED]:  ({ room, socket, player }) => {},
    [EVENTS.PLAYER_LEFT]:    ({ room, player }) => {},
    [EVENTS.PLAYER_KICKED]:  ({ room, player }) => {},
    [EVENTS.GAME_START]:     ({ room, plugin }) => {},
    [EVENTS.GAME_STOP]:      ({ room, plugin }) => {},
    [EVENTS.GAME_ACTION]:    ({ room, player, action, data }) => {},
  },
};
```

| Хук | Когда | Payload |
|-----|-------|---------|
| `ROOM_CREATED` | Комната создана | `{ room }` |
| `ROOM_CLOSING` | Хост закрывает, клиенты ещё онлайн | `{ room, reason }` |
| `ROOM_CLOSED` | Клиенты оповещены | `{ room, reason }` |
| `ROOM_DESTROYED` | Финальный сигнал — чистите state | `{ roomId }` |
| `PLAYER_JOINED` | Игрок вошёл | `{ room, socket, player }` |
| `PLAYER_LEFT` | Игрок вышел сам | `{ room, player }` |
| `PLAYER_KICKED` | Игрок кикнут | `{ room, player }` |
| `GAME_START` | Хост запустил игру | `{ room, plugin }` |
| `GAME_STOP` | Хост остановил | `{ room, plugin }` |
| `GAME_ACTION` | Игрок сделал действие | `{ room, socket, player, action, data }` |

### Объект `room`

- `room.id` — id комнаты
- `room.broadcast(event, data)` — отправить событие всем в комнате
- `room.players` — `Map<socketId, player>`
- `room.gameActive` — игра запущена?
- `room.activePluginName` — какой плагин активен

### Клиент ↔ iframe

Плагин рассылает `game:state` через `room.broadcast`. Родительское окно (хост-панель или гостевая страница) принимает событие и через `postMessage` передаёт в `<iframe>`.

В `game.html`:

```js
window.parent.postMessage({ type: 'lakly:ready' }, '*');

window.addEventListener('message', (e) => {
  if (e.data?.type === 'lakly:state') render(e.data.data);
});

btn.onclick = () => {
  window.parent.postMessage({ type: 'lakly:action', action: 'click' }, '*');
};
```

| Тип | Направление | Payload |
|-----|-------------|---------|
| `lakly:ready` | iframe → parent | — |
| `lakly:init` | parent → iframe | `{ player }` |
| `lakly:state` | parent → iframe | `{ data }` |
| `lakly:action` | iframe → parent | `{ action, data }` |

### Установка плагина

1. Соберите папку с `manifest.json`, `index.js`, `public/`.
2. Заархивируйте в ZIP (плагин может быть в корне или в подпапке).
3. В приложении откройте вкладку «Игры» → перетащите ZIP в окно.
4. Сервер проверит: размер ≤ 10 MB, файлов ≤ 500, распакованный размер ≤ 50 MB, никаких `../` и абсолютных путей, whitelist расширений.

### Конфиг плагина

Если в корне есть `config.json`, в карточке плагина появится кнопка ⚙. Дефолтный конфиг копируется в пользовательский при первом сохранении и не теряется при обновлении плагина (хранится в `userData/plugin-data/<id>.json`).

---

## Безопасность

### Модель доверия

- **Хост** — полностью доверенный, работает в собственном Electron-процессе.
- **Гость** — недоверенный, общается только через Socket.IO.
- **Плагины** — изолированы в `worker_threads` с лимитами памяти. Устанавливайте только плагины из проверенных источников.

### Что защищено

**Валидация** (`shared/validation.js`):
- имя игрока ≤ 24 символов
- сообщение чата ≤ 500 символов
- id плагина соответствует `^[a-z0-9][a-z0-9_-]{0,39}$`
- action игры — `^[a-z0-9_:-]{1,40}$`

**Rate limiting** (`shared/rate-limit.js`):
- создание комнат: 3/мин/IP
- входы: 5/мин/IP
- чат: 5/сек/сокет
- действия игр: 60/сек/сокет
- кики: 20/мин/сокет

**Установка ZIP:**
- размер архива ≤ 10 MB, распакованный ≤ 50 MB
- количество файлов ≤ 500
- защита от path traversal (`..`, абсолютные пути)
- whitelist расширений

**CORS:** Socket.IO принимает только `localhost`, `127.0.0.1`, `*.trycloudflare.com`, `*.ngrok-free.app`, `*.ngrok.io`.

**postMessage:** сообщения от iframe принимаются только если `e.source === iframe.contentWindow`.

**Electron:** `contextIsolation: true`, `nodeIntegration: false`, весь доступ из UI — через `contextBridge`.

**Изоляция плагинов:** hooks выполняются в отдельном `worker_threads`, основной процесс не блокируется, утечка памяти в плагине не роняет ядро.

### Токен комнаты

Ссылка содержит `?t=<joinToken>`. Без него `player:join` отклонится. Это защищает от подключения «наугад» к случайной комнате.

---

## Горячие клавиши

| Комбинация | Действие |
|-----------|----------|
| `Ctrl+Alt+L` | Показать / скрыть окно |
| `Ctrl+Alt+C` | Создать комнату (даже если окно скрыто) |

---

## Диагностика

**Туннель не поднимается, статус «Только локально».**  
Проверьте, что есть интернет. Cloudflare Quick Tunnel иногда блокируется провайдером — попробуйте мобильный интернет. Смотрите логи в терминале `npm start`.

**`Error 1033` в браузере гостя.**  
Это edge Cloudflare не видит ваш `cloudflared`. Обычно само лечится за 5–10 секунд. Если повторяется — переключитесь на HTTP/2 (`TUNNEL_TRANSPORT_PROTOCOL=http2`, уже включено по умолчанию).

**Гость не заходит по ссылке.**  
Проверьте, что ссылка скопирована целиком — она содержит `?t=<token>` в конце.

**Порт занят.**  
Смените в Настройках → Локальный порт. Применяется после перезапуска.

**Плагин не запускается после установки.**  
Откройте «Игры» — плагин должен быть в списке. Если нет, посмотрите логи в терминале: `[plugins] <id>: <причина>`.

---

## Разработка

```bash
# Установка
npm install

# Тесты
npm test

# Запуск с открытыми DevTools
npm run dev
```

Тесты покрывают: валидацию, rate-limit, plugin-loader (валидация манифестов, reload, unload), proxy-security (403 для не-локальных запросов), hardening (жизненный цикл комнаты, события).

**Точки расширения:**

- **Плагин** — папка в `plugins/` с `manifest.json` + `index.js`. Хуки см. выше.
- **Провайдер туннеля** — добавить класс с `isAvailable()` / `start(port)` / `stop()` в `core/tunnels/` и зарегистрировать в `core/tunnels/index.js`.
- **Режим комнаты** — добавить тип в `server.js` (обработка `host:create-room`), рантайм-middleware, поля в `applyRoomModeUi` на UI.

---

## Лицензия

MIT — используйте, форкайте, ломайте, чините.
```
