# Architecture

> How LaklyCustom is put together.

A desktop app that hosts a local HTTP server, tunnels it to the internet, and gives guests a browser UI. Everything runs on the host machine.

---

## 1. Big picture

```
┌─────────────────────────────────────────────────────────────────┐
│                       HOST MACHINE                              │
│                                                                 │
│  ┌──────────────────────┐        ┌──────────────────────────┐   │
│  │  Electron main       │        │  Express + Socket.IO     │   │
│  │  (electron/main.mjs) │───────▶│  (core/server.js)        │   │
│  │                      │        │                          │   │
│  │  • tray              │        │  • API routes            │   │
│  │  • windows           │        │  • socket handlers       │   │
│  │  • IPC               │        │  • static files          │   │
│  │  • lifecycle         │        │  • proxy runtime         │   │
│  └──────────────────────┘        └──────────┬───────────────┘   │
│         │                                   │                   │
│         │ IPC                               │ spawn             │
│         ▼                                   ▼                   │
│  ┌──────────────────────┐        ┌──────────────────────────┐   │
│  │  Host UI (renderer)  │        │  cloudflared             │   │
│  │  ui/*                │        │  (via untun)             │   │
│  └──────────────────────┘        └──────────┬───────────────┘   │
│                                              │                  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │ HTTPS
                                               ▼
                                     ┌────────────────────┐
                                     │  Cloudflare edge   │
                                     │  *.trycloudflare…  │
                                     └─────────┬──────────┘
                                               │
                                               ▼
                                     ┌────────────────────┐
                                     │  Guest browser     │
                                     │  public/*          │
                                     └────────────────────┘
```

---

## 2. Directory layout

```
electron/         Main process, preload, IPC bridge
core/             Server-side logic (no Electron deps)
  ├── tunnels/    Tunnel providers (cloudflare, ngrok, local)
  ├── server.js   Express + Socket.IO bootstrap
  ├── room*.js    Room lifecycle
  ├── plugin-*.js Plugin loader / host / worker
  ├── proxy.js    http-proxy wrapper
  └── tunnel-supervisor.js  Health checks & restart
shared/           Code used by both core and UI
  ├── events.js       Event name constants
  ├── validation.js   Input validators
  └── rate-limit.js   In-memory rate limiter
public/           Guest UI (served to browsers)
ui/               Host UI (served to Electron window)
plugins/          Bundled plugins + _template/
tests/            node:test suites
docs/             This folder
```

**Rule:** `core/` must never import from `electron/`. The server runs headless and could be embedded elsewhere.

---

## 3. Startup sequence

```
1. Electron starts
   └─ app.whenReady()
      └─ bootstrap()
         ├─ read settings.json
         ├─ startServer({ port, hooks, pluginDataDir })
         │  ├─ new PluginLoader(pluginsDir)
         │  ├─ await pluginLoader.load()          ← spawns workers
         │  ├─ new RoomManager(io, pluginLoader)
         │  ├─ register API routes
         │  ├─ register socket handlers
         │  └─ httpServer.listen(port)
         ├─ new BrowserWindow(...)
         ├─ win.loadURL('http://localhost:PORT/host/')
         └─ createTray()
```

**Order matters:** plugins load **before** `listen()`. If `load()` fails, the server never starts, and `bootstrap()` shows an error dialog.

---

## 4. Room lifecycle

A room is created by the host, joined by guests, and destroyed when the host closes it.

```
host:create-room
       │
       ▼
 RoomManager.createRoom()
       │
       ├─ TunnelSupervisor.start()   ← first room only
       │
       ├─ new Room({ ... })
       │      ├─ joinToken = uuidv4()
       │      └─ isActive  = true
       │
       ├─ pluginLoader.emit(ROOM_CREATED, { room })
       │
       └─ socket.emit('host:room-created', { publicUrl, ... })

player:join
       │
       ▼
 Room.addPlayer(socket, name)
       ├─ players.set(socketId, player)
       ├─ socket.join(room:ID)
       ├─ pluginLoader.emit(PLAYER_JOINED, ...)
       └─ broadcast(ROOM_UPDATED, publicPlayers())

host:close-room  /  disconnect
       │
       ▼
 RoomManager.destroyRoom(id)
       └─ Room.close()
            ├─ emit(ROOM_CLOSING)
            ├─ broadcast(ROOM_CLOSED_NOTIFY)
            ├─ clear players/messages
            ├─ emit(ROOM_CLOSED)
            ├─ emit(ROOM_DESTROYED)
            └─ pluginLoader.cleanupRoom(id)
```

**Only one room at a time.** Creating a new one replaces the old one (the old one emits `replaced`).

---

## 5. Plugin runtime

Plugins run **out of process** in a `worker_threads` worker. The main process communicates with them via `postMessage`.

```
┌─────────────────────────┐          ┌─────────────────────────┐
│  PluginLoader (main)    │          │  plugin-worker.js       │
│                         │          │  (worker thread)        │
│  plugins: Map<id, rec>  │          │                         │
│  handlers: Map<ev,[id]> │          │  plugin = default export│
│                         │          │  roomEntries: Map       │
│         │               │          │                         │
│         │  postMessage  │          │                         │
│         ├──────────────▶│  load    │                         │
│         │               │─────────▶│  import(entryUrl)       │
│         │               │          │  call onConfig()        │
│         │◀──────────────┤  loaded  │  return hook names      │
│         │               │          │                         │
│         │  postMessage  │          │                         │
│         ├──────────────▶│  hook    │                         │
│         │               │─────────▶│  call hook({ room, ... })│
│         │◀──────────────┤  result  │                         │
│         │               │          │                         │
│         │◀──────────────┤ broadcast│  room.broadcast(...)    │
│  io.to(room).emit(...)  │          │                         │
└─────────────────────────┘          └─────────────────────────┘
```

**Timeouts:**
- Worker `ready` → 10 s
- Plugin `load` → 10 s
- Hook execution → 5 s

If any of these expire, the worker is terminated and the plugin is unloaded.

---

## 6. Tunnel lifecycle

The tunnel is created lazily — **first time a room is created**.

```
host:create-room
       │
       ▼
if (!tunnelSupervisor) {
  tunnelSupervisor = new TunnelSupervisor({ port, ... })
  await tunnelSupervisor.start()
}
       │
       ▼
 TunnelSupervisor.start()
       ├─ openTunnel(port)                ← provider chain
       │     ├─ CloudflareQuick.isAvailable() → start()
       │     ├─ Ngrok.isAvailable()           → start()
       │     └─ fallback localhost
       │
       ├─ emit('up', { url, provider })
       ├─ waitUntilReachable(url)         ← 1s, 2s, 3s, 5s, 8s
       └─ scheduleHealthCheck()           ← every 45 s
```

**Health check every 45 s** (or 5 s if offline):

1. Is the internet reachable? (DNS lookup)
2. Is the local server answering? (`/api/room`)
3. Is the public URL returning valid JSON?

Three consecutive failures → recreate the tunnel with backoff `[10s, 20s, 40s, 60s, 120s]`.

If the URL changes, `onUrlChange` fires and:
- Updates `room.publicUrl`
- Emits `host:room-url-changed` to the host
- Broadcasts `room:url-changed` to guests
- Adds a system chat message

---

## 7. Socket.IO events

### Host → server

| Event | Payload | Effect |
|---|---|---|
| `host:create-room` | `{ roomName, type, pluginName?, staticDir?, proxyPort?, options }` | Create a room |
| `host:close-room` | — | Destroy the current room |
| `host:start-game` | `{ pluginName }` | Launch a plugin |
| `host:stop-game` | — | Stop the active plugin |
| `host:kick-player` | `{ playerId }` | Remove a guest |
| `host:restart-tunnel` | — | Force tunnel recreation |

### Guest → server

| Event | Payload | Effect |
|---|---|---|
| `player:join` | `{ playerName, token }` | Join the room |
| `chat:message` | `{ text }` | Send a chat message |
| `game:action` | `{ action, data }` | Send a game action |

### Server → all

| Event | Payload |
|---|---|
| `room:updated` | `{ players }` |
| `room:closed` | `{ reason }` |
| `chat:new-message` | `{ id, sender, text, ts }` |
| `game:started` | `{ plugin, url }` |
| `game:stopped` | `{ plugin }` |
| `game:state` | plugin-defined |
| `player:kicked` | — |

Constants live in [`shared/events.js`](../shared/events.js).

---

## 8. Room modes

A room has a `type` that changes what guests see.

| Type | Guests get | Server-side |
|---|---|---|
| `default` | Host UI shows lobby + chat + game | Regular Room + Socket.IO |
| `static` | Files from a chosen folder | `express.static(staticDir)` middleware |
| `proxy` | Response from `localhost:port` | `http-proxy` middleware |

**Static and proxy rooms skip the lobby entirely.** Guests hit the URL and go straight to your content. No join token, no player list.

Middleware order in `server.js`:

```
1. /api/* — JSON endpoints
2. /host  — host UI (Electron only, but no auth)
3. /assets — shared assets
4. /plugins/:id — plugin static files (dynamic)
5. proxy runtime — if room type is 'proxy'
6. static runtime — if room type is 'static'
7. public — fallback guest UI
```

---

## 9. Configuration & state

| File | Purpose |
|---|---|
| `%APPDATA%\LaklyCustom\settings.json` | Port, tunnel provider, ngrok token, welcome flag |
| `%APPDATA%\LaklyCustom\plugin-data\<id>.json` | Per-plugin user config |
| `C:\temp\lakly-boot.log` | All logs (main + renderer + worker) |

**Settings shape:**

```json
{
  "tunnel": "auto",
  "port": 3000,
  "ngrokToken": "",
  "hasSeenWelcome": false,
  "allowedStaticDirs": []
}
```

`allowedStaticDirs` is a whitelist of folders the user picked via the OS dialog. **Paths not in this list are rejected** by `host:create-room` for security.

---

## 10. Shutdown

```
app.quit()
   │
   ▼
before-quit
   ├─ destroyTray()
   ├─ await srv.close()  (with 3s timeout)
   │      ├─ tunnelSupervisor.stop()
   │      ├─ roomManager.close all rooms
   │      ├─ pluginLoader.unloadAll()
   │      └─ httpServer.close()
   └─ app.exit(0)
        │
        ▼
     will-quit
        ├─ globalShortcut.unregisterAll()
        ├─ destroyTray()
        └─ taskkill /F /T /PID <current-pid>   ← kill process tree
```

**The `taskkill` is intentional.** Electron spawns 4-5 child processes (GPU, renderer, utility, crashpad). If `srv.close()` hangs, `app.exit(0)` alone doesn't kill them. `taskkill /T` guarantees a clean exit.

---

## 11. Extension points

| What | Where | Effort |
|---|---|---|
| **Plugin** | `plugins/<id>/` with manifest + index.js | Small |
| **Tunnel provider** | `core/tunnels/<name>.js` + register in `index.js` | Small |
| **Room mode** | `core/server.js` — `host:create-room` handler + middleware | Medium |
| **API route** | `core/server.js` — `app.get/post/...` | Small |
| **Event hook** | `shared/events.js` + `plugin-worker.js` | Medium |

---

## 12. What we don't do (yet)

- **Horizontal scaling.** One process, one room, one tunnel.
- **Persistence.** Rooms live in memory. Restart = everything gone.
- **Multi-room per host.** Only one room at a time.
- **Per-room auth.** The join token is the only gate.
- **Plugin signature verification.** Trust-by-installation.

These are deliberate. LaklyCustom is a **local-first tool**, not a SaaS.