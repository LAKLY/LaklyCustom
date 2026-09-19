<div align="center">

# LaklyCustom

### 🎮 Локальные комнаты. Игры. Ссылка — и вы вместе.

**LaklyCustom** — desktop-приложение для создания локальных multiplayer-комнат и публикации их в интернет.

Хост запускает комнату → получает ссылку и QR-код → друзья открывают ссылку в браузере.

<br>

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io/)
[![Cloudflare](https://img.shields.io/badge/Tunnel-Cloudflare-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

[Идея](#-идея-проекта) · [Возможности](#-возможности) · [Быстрый старт](#-быстрый-старт) · [Архитектура](#-архитектура) · [Плагины](#-плагины) · [Безопасность](#-безопасность) · [Диагностика](#-диагностика)

</div>

---

## 💡 Идея проекта

LaklyCustom не пытается быть большим облачным сервисом.

Идея проще:

> **запустить локально → создать комнату → отправить ссылку → играть.**

Без аккаунтов. Без отдельного backend deployment. Без обязательного домена.

Просто локальное приложение, которое умеет становиться multiplayer-комнатой за один клик.

---

## ✨ Возможности

| | Что умеет |
|---|---|
| 🌐 | **Публичный доступ** — Cloudflare Quick Tunnel, без токенов и регистраций |
| 🎮 | **Плагины-игры** — multiplayer-логика, состояние, клиентский UI |
| 📱 | **Гости по ссылке или QR** — ничего не ставят, просто открывают браузер |
| 💬 | **Чат и лобби** — общение в реальном времени |
| 📁 | **Раздача папки** — публикация HTML-сайта прямо с диска |
| 🔌 | **Прокси локального порта** — проброс `localhost:5173` наружу (Vite, Next, Angular…) |
| 📦 | **Drag & drop плагинов** — ZIP прямо в окно |
| 🖥 | **Трей, уведомления, горячие клавиши** — работа в фоне |
| 🔁 | **Автовосстановление туннеля** — при падении сети или edge туннель пересоздаётся сам |

---

## 🚀 Быстрый старт

### Требования

- **Node.js 20 LTS** или новее
- Windows / macOS / Linux

> На Node 24 возможны капризы `postinstall` у Electron. Если падает с `Electron failed to install correctly` — используйте Node 20 или добавьте зеркало:
> ```powershell
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> npm install
> ```

### Установка

```bash
git clone https://github.com/LAKLY/LaklyCustom.git
cd LaklyCustom
npm install
npm start
```

После запуска откроется desktop-приложение. Нажмите **«Создать комнату»** — через несколько секунд получите ссылку и QR-код.

### Команды

| Команда | Назначение |
|---------|-----------|
| `npm start` | Запуск приложения |
| `npm run dev` | Разработка (с DevTools) |
| `npm test` | Запуск unit-тестов |
| `npm run test:watch` | Тесты в watch-режиме |

---

## 🧭 Режимы комнаты

| Режим | Назначение | Кому полезно |
|-------|-----------|--------------|
| 🎮 **Плагин / чат** | Multiplayer-комнаты с играми и чатом | Друзьям, которые хотят поиграть вместе |
| 📁 **Раздать папку** | Публикация локальной HTML-папки | Фронтенд-разработчикам |
| 🔌 **Прокси порт** | Публикация уже запущенного localhost-приложения | Тому, кто хочет показать dev-сервер |

---

## 🎮 Multiplayer

В режиме комнаты с плагином гости получают обычный веб-интерфейс:

- имя игрока;
- список игроков;
- realtime-чат;
- multiplayer-игру;
- состояние комнаты (онлайн / подключение / нет связи);
- подключение с телефона или компьютера.

**Гостю не требуется устанавливать LaklyCustom.** Достаточно открыть ссылку.

---

## 🌐 Как появляется публичная ссылка

LaklyCustom поднимает локальный HTTP-сервер и подключает tunnel provider.

По умолчанию:

```
Cloudflare Quick Tunnel
        ↓
локальный LaklyCustom
        ↓
http://localhost:<port>
```

Если основной провайдер недоступен, система переключается на следующий:

```
Cloudflare Quick Tunnel
        ↓
ngrok  (если задан NGROK_TOKEN)
        ↓
localhost  (fallback)
```

Для Cloudflare Quick Tunnel не требуется заранее настраивать домен.

> Quick Tunnel создаёт **временный** публичный адрес. Это удобно для игровых комнат и демонстраций, но такой URL не является постоянным адресом приложения.

`TunnelSupervisor` проверяет туннель каждые 45 секунд по цепочке **интернет → локальный сервер → публичный URL** и пересоздаёт его при устойчивых сбоях. При смене URL ссылка и QR обновляются автоматически, гостям приходит системное сообщение в чат.

---

## 📁 Раздача локальной папки

В режиме **«Раздать папку»** можно выбрать директорию с HTML/CSS/JS и опубликовать её через комнату.

Доступны настройки:

- **SPA fallback** — на 404 отдавать `index.html`;
- **Кэширование** — можно отключить для разработки;
- **Скрытые файлы** — отдавать или игнорировать dotfiles.

Удобно, чтобы быстро показать кому-то локальный frontend без отдельного deployment.

---

## 🔌 Прокси локального приложения

Если приложение уже запущено локально, LaklyCustom может опубликовать его порт:

```
Vite
localhost:5173
        ↓
LaklyCustom
        ↓
public URL
```

Поддерживается WebSocket-проксирование — режим подходит и для development-сценариев с live reload / HMR.

Настраивается: локальный порт, WebSocket, `changeOrigin`, SSL, timeout.

---

## 🏗 Архитектура

Упрощённо приложение выглядит так:

```
┌─────────────────────────────────────┐
│             Electron                │
│        desktop / tray / IPC         │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│             Core Server             │
│                                     │
│  Express · Socket.IO                │
│  RoomManager · PluginLoader         │
│  TunnelSupervisor · Proxy           │
└──────────────┬──────────────┬───────┘
               │              │
               ▼              ▼
          ┌─────────┐    ┌───────────┐
          │ Plugins │    │  Tunnel   │
          │  Games  │    │ Cloudflare│
          └────┬────┘    │  / ngrok  │
               │         └───────────┘
               ▼
          ┌─────────┐
          │ Browser │
          │  Guest  │
          └─────────┘
```

### Структура проекта

```
LaklyCustom/
│
├── core/                  # серверное ядро
│   ├── server.js          # Express + Socket.IO
│   ├── room.js            # одна комната
│   ├── room-manager.js    # реестр комнат
│   ├── plugin-loader.js   # загрузка плагинов
│   ├── plugin-host.js     # sandbox (worker_threads)
│   ├── plugin-worker.js   # изолированный воркер
│   ├── proxy.js           # http-proxy + WS upgrade
│   ├── tunnel-supervisor.js
│   └── tunnels/           # cloudflare / ngrok / local
│
├── electron/              # main + preload
├── ui/                    # интерфейс хоста
├── public/                # интерфейс гостя
├── plugins/               # установленные игры
├── shared/                # events / validation / rate-limit
├── assets/                # иконки, Ника, tray
└── tests/                 # node:test
```

---

## 🔄 Жизненный цикл комнаты

```
Создание комнаты
       │
       ▼
Запуск локального сервера
       │
       ▼
Запуск tunnel
       │
       ▼
Получение публичного URL
       │
       ▼
Создание join token
       │
       ▼
┌───────────────────┐
│     Комната       │
│  👤 👤 👤         │
│  💬 Чат           │
│  🎮 Игра          │
└───────────────────┘
       │
       ▼
Хост закрывает комнату
       │
       ▼
Очистка ресурсов
```

---

## 🧩 Плагины

Игры в LaklyCustom сделаны как плагины.

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
3. В приложении откройте вкладку **«Игры»** → перетащите ZIP в окно.
4. Сервер проверит: размер ≤ 10 MB, файлов ≤ 500, распакованный размер ≤ 50 MB, никаких `../` и абсолютных путей, whitelist расширений.

### Конфиг плагина

Если в корне есть `config.json`, в карточке плагина появится кнопка ⚙. Дефолтный конфиг копируется в пользовательский при первом сохранении и не теряется при обновлении плагина (хранится в `userData/plugin-data/<id>.json`).

---

## 🖥 Интерфейс

LaklyCustom состоит из двух интерфейсов.

### Host UI

Используется владельцем комнаты:

- создание комнаты;
- выбор режима (чат / раздача папки / прокси);
- выбор игры;
- управление игроками (кик);
- QR-код;
- копирование ссылки;
- статус туннеля в сайдбаре;
- настройки (провайдер, порт);
- установка плагинов drag & drop.

### Guest UI

Открывается обычным браузером:

- вход по имени (с индикатором подключения);
- список игроков;
- статус соединения (онлайн / подключение / нет связи);
- игра;
- чат с автоскроллом;
- состояние комнаты.

---

## 🔐 Безопасность

LaklyCustom предполагает, что гости комнаты являются недоверенными клиентами. Поэтому сервер выполняет валидацию входных данных и ограничивает частоту действий.

### Модель доверия

- **Хост** — полностью доверенный, работает в собственном Electron-процессе.
- **Гость** — недоверенный, общается только через Socket.IO.
- **Плагины** — изолированы в `worker_threads` с лимитами памяти. Устанавливайте только плагины из проверенных источников.

### Что защищено

**Валидация** (`shared/validation.js`):

- имя игрока ≤ 24 символов;
- сообщение чата ≤ 500 символов;
- id плагина соответствует `^[a-z0-9][a-z0-9_-]{0,39}$`;
- action игры — `^[a-z0-9_:-]{1,40}$`.

**Rate limiting** (`shared/rate-limit.js`):

- создание комнат: 3/мин/IP;
- входы: 5/мин/IP;
- чат: 5/сек/сокет;
- действия игр: 60/сек/сокет;
- кики: 20/мин/сокет.

**Установка ZIP:**

- размер архива ≤ 10 MB, распакованный ≤ 50 MB;
- количество файлов ≤ 500;
- защита от path traversal (`..`, абсолютные пути);
- whitelist расширений.

**CORS:** Socket.IO принимает только `localhost`, `127.0.0.1`, `*.trycloudflare.com`, `*.ngrok-free.app`, `*.ngrok.io`.

**postMessage:** сообщения от iframe принимаются только если `e.source === iframe.contentWindow`.

**Electron:** `contextIsolation: true`, `nodeIntegration: false`, весь доступ из UI — через `contextBridge`.

**Изоляция плагинов:** hooks выполняются в отдельном `worker_threads`, основной процесс не блокируется, утечка памяти в плагине не роняет ядро.

### Токен комнаты

Ссылка содержит `?t=<joinToken>`. Без него `player:join` отклонится. Это защищает от подключения «наугад» к случайной комнате.

---

## ⌨️ Горячие клавиши

| Комбинация | Действие |
|-----------|----------|
| `Ctrl+Alt+L` | Показать / скрыть окно |
| `Ctrl+Alt+C` | Создать комнату (даже если окно скрыто) |

---

## 🔧 Диагностика

<details>
<summary><b>Туннель не поднимается, статус «Только локально»</b></summary>

Проверьте, что есть интернет. Cloudflare Quick Tunnel иногда блокируется провайдером — попробуйте мобильный интернет. Смотрите логи в терминале `npm start`.
</details>

<details>
<summary><b>Error 1033 в браузере гостя</b></summary>

Это edge Cloudflare не видит ваш `cloudflared`. Обычно само лечится за 5–10 секунд. Если повторяется — убедитесь, что установлен `TUNNEL_TRANSPORT_PROTOCOL=http2` (включено по умолчанию).
</details>

<details>
<summary><b>Гость не заходит по ссылке</b></summary>

Проверьте, что ссылка скопирована целиком — она содержит `?t=<token>` в конце.
</details>

<details>
<summary><b>Порт занят</b></summary>

Смените в **Настройках → Локальный порт**. Применяется после перезапуска.
</details>

<details>
<summary><b>Плагин не запускается после установки</b></summary>

Откройте «Игры» — плагин должен быть в списке. Если нет, посмотрите логи в терминале: `[plugins] <id>: <причина>`.
</details>

<details>
<summary><b>Electron падает с «failed to install correctly»</b></summary>

Используйте Node 20 LTS или добавьте зеркало:
```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
```
</details>

---

## 🧪 Тесты

```bash
npm test
```

Покрыто: валидация, rate-limit, plugin-loader (валидация манифестов, reload, unload), proxy-security (403 для не-локальных запросов), hardening (жизненный цикл комнаты, события).

---

## 🛠 Точки расширения

- **Плагин** — папка в `plugins/` с `manifest.json` + `index.js`. Хуки см. выше.
- **Провайдер туннеля** — добавить класс с `isAvailable()` / `start(port)` / `stop()` в `core/tunnels/` и зарегистрировать в `core/tunnels/index.js`.
- **Режим комнаты** — добавить тип в `server.js` (обработка `host:create-room`), рантайм-middleware, поля в `applyRoomModeUi` на UI.

---

## 🤝 Contributing

Если нашли баг или хотите предложить улучшение:

1. Создайте Issue с описанием проблемы.
2. Для изменений — отдельная ветка.
3. Проверьте изменения локально.
4. Запустите `npm test`.
5. Создайте Pull Request.

Для небольших изменений особенно полезно приложить:

- шаги воспроизведения;
- ожидаемое поведение;
- фактическое поведение;
- логи, если проблема связана с server / tunnel / plugin runtime.

---

## 📄 Лицензия

MIT — используйте, форкайте, ломайте, чините.

---

<div align="center">

**LaklyCustom**

*Play together. Keep it local.*

</div>
