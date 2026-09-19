<div align="center">

# LaklyCustom

### 🎮 Локальные комнаты. Игры. Ссылка — и вы вместе.

**LaklyCustom** — desktop-приложение для создания локальных multiplayer-комнат и публикации их в интернет.

Хост запускает комнату → получает ссылку и QR-код → друзья открывают ссылку в браузере.

<br>

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square\&logo=electron\&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-339933?style=flat-square\&logo=node.js\&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square\&logo=socket.io\&logoColor=white)](https://socket.io/)
[![Cloudflare](https://img.shields.io/badge/Tunnel-Cloudflare-F38020?style=flat-square\&logo=cloudflare\&logoColor=white)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

</div>

---

## ✨ Что это

LaklyCustom создан вокруг простой идеи:

> **локальное приложение должно уметь превращаться в общую комнату одним кликом.**

Не нужно поднимать отдельный сервер для друзей, покупать домен или вручную настраивать reverse proxy.

LaklyCustom запускает локальный сервер, создаёт комнату и предоставляет гостям веб-интерфейс.

### Сейчас доступны три режима

| Режим                | Назначение                                      |
| -------------------- | ----------------------------------------------- |
| 🎮 **Плагин / чат**  | Multiplayer-комнаты с играми и чатом            |
| 📁 **Раздать папку** | Публикация локальной HTML-папки                 |
| 🔌 **Прокси порт**   | Публикация уже запущенного localhost-приложения |

---

## 🎮 Multiplayer

В режиме комнаты с плагином гости получают обычный веб-интерфейс:

* имя игрока;
* список игроков;
* realtime-чат;
* multiplayer-игру;
* состояние комнаты;
* подключение с телефона или компьютера.

Гостю не требуется устанавливать LaklyCustom.

Достаточно открыть ссылку комнаты.

---

## 🧩 Плагины

Игры в LaklyCustom сделаны как плагины.

Пример существующего плагина:

```text
plugins/
└── clicker/
    ├── manifest.json
    ├── index.js
    └── public/
        └── game.html
```

Минимальный `manifest.json`:

```json
{
  "id": "clicker",
  "name": "Clicker",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "Общий счётчик кликов"
}
```

Плагин может содержать:

* серверную multiplayer-логику;
* собственное состояние игры;
* клиентский интерфейс;
* обработчики действий игроков;
* конфигурацию.

Игровой интерфейс запускается внутри `iframe`, а обмен событиями между игрой и LaklyCustom происходит через `postMessage`.

---

## 🌐 Как появляется публичная ссылка

LaklyCustom поднимает локальный HTTP-сервер и подключает tunnel provider.

По умолчанию используется:

```text
Cloudflare Quick Tunnel
        ↓
локальный LaklyCustom
        ↓
http://localhost:<port>
```

Если основной провайдер недоступен, система пытается использовать следующий вариант.

Текущий порядок:

```text
Cloudflare Quick Tunnel
        ↓
ngrok
        ↓
localhost
```

Для Cloudflare Quick Tunnel не требуется заранее настраивать домен.

> Quick Tunnel создаёт временный публичный адрес. Это удобно для игровых комнат и демонстраций, но такой URL не является постоянным адресом приложения.

---

## 📁 Раздача локальной папки

LaklyCustom может использоваться не только для игр.

В режиме **«Раздать папку»** можно выбрать директорию с HTML/CSS/JS-файлами и опубликовать её через комнату.

Доступны дополнительные настройки:

* SPA fallback;
* кэширование;
* доступ к скрытым файлам.

Это удобно, например, чтобы быстро показать кому-то локальный frontend без отдельного deployment.

---

## 🔌 Прокси локального приложения

Если приложение уже запущено локально, LaklyCustom может опубликовать его порт.

Например:

```text
Vite
localhost:5173
        ↓
LaklyCustom
        ↓
public URL
```

Поддерживается WebSocket-проксирование, поэтому такой режим подходит и для development-сценариев с live reload / HMR.

Можно указать:

* локальный порт;
* WebSocket;
* `changeOrigin`;
* SSL;
* timeout.

---

# 🚀 Быстрый старт

## Требования

* Node.js
* npm
* desktop-система с поддержкой Electron

## Установка

```bash
git clone https://github.com/LAKLY/LaklyCustom.git
cd LaklyCustom
npm install
```

## Запуск

```bash
npm start
```

Для разработки:

```bash
npm run dev
```

После запуска откроется desktop-приложение LaklyCustom.

---

## 🧪 Тесты

Запустить тесты:

```bash
npm test
```

Watch-режим:

```bash
npm run test:watch
```

---

# 🏗 Архитектура

Упрощённо приложение выглядит так:

```text
┌─────────────────────────────────────┐
│             Electron                │
│        desktop / tray / IPC         │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│             Core Server             │
│                                     │
│  Express                            │
│  Socket.IO                          │
│  RoomManager                        │
│  PluginLoader                       │
│  TunnelSupervisor                   │
│  Proxy                              │
└──────────────┬──────────────┬───────┘
               │              │
               ▼              ▼
          ┌─────────┐    ┌───────────┐
          │ Plugins │    │  Tunnel   │
          │         │    │ Cloudflare│
          │ Games   │    │ / ngrok   │
          └────┬────┘    └───────────┘
               │
               ▼
          ┌─────────┐
          │ Browser │
          │  Guest  │
          └─────────┘
```

### Основные части

```text
core/
├── server.js
├── room.js
├── room-manager.js
├── plugin-loader.js
├── plugin-host.js
├── plugin-worker.js
├── proxy.js
├── tunnel-supervisor.js
└── tunnels/

electron/
├── main
└── preload

public/
└── guest interface

ui/
└── host interface

plugins/
└── installed games

shared/
└── events / validation / rate limiting
```

---

# 🔄 Жизненный цикл комнаты

Упрощённый сценарий:

```text
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
│
```
