<div align="center">

# LaklyCustom

### Share localhost in one click.

Turn any folder, port, or dev server into a public link — no deploy, no domain, no signup.

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![Cloudflare](https://img.shields.io/badge/Tunnel-Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

[![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white)](#)
[![Status](https://img.shields.io/badge/Status-v0.8.0%20beta-orange?style=flat-square)](#)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#-contributing)

[**Download**](#-quick-start) · [Features](#-what-it-does) · [Use cases](#-use-cases) · [Plugins](#-plugins-bonus) · [Roadmap](#-roadmap) · [Security](#-security)

</div>

---

<div align="center">

<p>
  <img src="./assets/readme/host.png" alt="Host UI" width="880">
</p>

<sub>Pick what to share · Get a public URL and QR in seconds</sub>

</div>

---

## ⚡ What it does

Three ways to share something from your machine with the world.

<table>
<tr>
<td width="33%" valign="top" align="center">

### 📁 Folder

<img src="https://img.shields.io/badge/1--click-ff6b6b?style=flat-square" alt="1 click">

**Share a folder of HTML.**
Point at `dist/`, `build/`, or any folder with an `index.html`. Get a public URL.

*Perfect for: prototypes, static sites, portfolio previews.*

</td>
<td width="33%" valign="top" align="center">

### 🔌 Port

<img src="https://img.shields.io/badge/1--click-ff6b6b?style=flat-square" alt="1 click">

**Publish `localhost:5173`.**
Vite, Next, Django, Flask — anything with HTTP. WebSocket support included.

*Perfect for: dev servers, APIs, dashboards.*

</td>
<td width="33%" valign="top" align="center">

### 🎮 Room

<img src="https://img.shields.io/badge/bonus-9b8cff?style=flat-square" alt="bonus">

**Or spin up a multiplayer room.**
Chat, players, and games with a tiny plugin API.

*Perfect for: quick multiplayer demos, mini-games.*

</td>
</tr>
</table>

<div align="center">

### 🚀 Public URL in seconds — no signup, no domain, no port forwarding

</div>

---

## 🎯 Use cases

Real things people do with LaklyCustom:

<table>
<tr>
<td width="50%" valign="top">

### 👨‍💻 Show a prototype to a client

```bash
npm run build
# → dist/ is ready
```

Open LaklyCustom → **Share folder** → paste the URL into chat.

No Vercel, no Netlify, no waiting for CI. Your client sees your build **in 5 seconds**.

</td>
<td width="50%" valign="top">

### 📱 Test your dev server on a phone

```bash
npm run dev
# → localhost:5173
```

Share the port → scan the QR with your phone. Test responsive layouts, touch gestures, real device behaviour.

**No ngrok account required.**

</td>
</tr>
<tr>
<td valign="top">

### 🎨 Send a portfolio build to a friend

You built a static portfolio. You don't want to deploy it "for real" yet.

Share the folder → friend opens the link → you get feedback **without touching git**.

</td>
<td valign="top">

### 🧪 Peer-test an API

You're building a local API on `localhost:8080`. A teammate needs to hit it.

Share the port → they curl the public URL → you keep debugging locally.

</td>
</tr>
<tr>
<td valign="top">

### 🎲 Play a quick game together

Want to try a multiplayer idea but don't want to build a server?

Spin up a **Room**, add a plugin, share the link. Everyone's in **under a minute**.

</td>
<td valign="top">

### 🖼️ Share a screenshot folder

Got a folder of generated images? `index.html` with thumbnails?

Share the folder → send one link → everyone sees the gallery.

</td>
</tr>
</table>

---

## 🚀 Quick start

### Option A — Download (recommended)

Grab the latest installer from [**Releases**](https://github.com/LAKLY/LaklyCustom/releases):

| Build | Best for |
|---|---|
| `LaklyCustom-Setup-x.y.z.exe` | Normal install, Start Menu shortcut, auto-launch |
| `win-unpacked.zip` | Portable — unzip and run, no install |

Launch it → pick a mode → **done**.

### Option B — From source

**Requires:** Node.js **20 LTS** or newer.

```bash
git clone https://github.com/LAKLY/LaklyCustom.git
cd LaklyCustom
npm install
npm start
```

> **On Node 24**, Electron's `postinstall` may fail. If you see `Electron failed to install correctly`, use Node 20 or set:
> ```powershell
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> npm install
> ```

### Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Launch the app |
| `npm run dev` | Development mode with DevTools |
| `npm run pack` | Build without installer → `release/win-unpacked/` |
| `npm run dist` | Build NSIS installer → `release/*.exe` |
| `npm run dist:portable` | Build single-file portable `.exe` |
| `npm test` | Unit tests (node:test) |
| `npm run test:watch` | Tests in watch mode |

---

## 🧭 Three sharing modes

<table>
<tr>
<th width="20%">Mode</th>
<th width="40%">What the guest sees</th>
<th width="40%">Best for</th>
</tr>
<tr>
<td>

### 📁 Folder

</td>
<td>

Your HTML site, served straight from disk. SPA fallback included.

</td>
<td>

Frontend devs, designers, anyone with a `dist/` folder.

</td>
</tr>
<tr>
<td>

### 🔌 Port

</td>
<td>

Your running `localhost` app — Vite, Next, Django, anything.

</td>
<td>

Full-stack devs testing APIs, dashboards, live-reload apps.

</td>
</tr>
<tr>
<td>

### 🎮 Room

</td>
<td>

A lobby: player list, chat, and multiplayer games.

</td>
<td>

Playing together, plugin experiments, learning Socket.IO.

</td>
</tr>
</table>

**Folder** and **Port** don't need anyone to "join". They just open the link and see your app.

**Room** is a real lobby with players, chat, and a plugin runtime.

---

## 🌐 How the tunnel works

```
Your machine
   │
   ├── Express + Socket.IO on localhost
   │
   └──► Cloudflare Quick Tunnel ──► https://xxx.trycloudflare.com
                                        │
                                        ▼
                                  Friend's browser
```

LaklyCustom boots a **local server**, opens a **Cloudflare Quick Tunnel**, and hands the public URL to a single-room registry. Guests only need the link.

A **supervisor** watches the tunnel end-to-end every 45 seconds:

- 🌍 Internet reachable?
- 🖥 Local server answering?
- 🔗 Public URL returning valid JSON?

On sustained failure → tunnel is recreated with exponential backoff. When the URL changes, **host UI and every guest are updated automatically.**

### Provider priority

```
Cloudflare Quick Tunnel  →  ngrok (if NGROK_TOKEN set)  →  localhost fallback
```

Every provider implements the same interface:

```js
isAvailable()  →  boolean
start(port)    →  Promise<url>
stop()         →  Promise<void>
```

Adding a new provider = one file in `core/tunnels/`.

---

## 🧩 Plugins (bonus)

Games are plugins. A plugin is a folder with a manifest, server hooks, and an iframe UI.

```
plugins/clicker/
├── manifest.json       ← id, version, entry
├── index.js            ← server hooks
└── public/
    └── game.html       ← iframe UI
```

### Minimal manifest

```json
{
  "id": "clicker",
  "name": "Clicker",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "Shared click counter"
}
```

### Server side

Subscribe to room events, broadcast state:

```js
import { EVENTS } from '../../shared/events.js';

export default {
  name: 'clicker',
  version: '1.0.0',
  hooks: {
    [EVENTS.GAME_START]: ({ room }) => {
      room.broadcast(EVENTS.GAME_STATE, { count: 0 });
    },
    [EVENTS.GAME_ACTION]: ({ room, action }) => {
      if (action === 'click') {
        room.broadcast(EVENTS.GAME_STATE, { count: Date.now() });
      }
    },
  },
};
```

### Client side

```js
window.parent.postMessage({ type: 'lakly:ready' }, '*');

window.addEventListener('message', (e) => {
  if (e.data.type === 'lakly:init') { /* player info */ }
  if (e.data.type === 'lakly:state') { /* game state */ }
});

function sendAction(action, data) {
  window.parent.postMessage({ type: 'lakly:action', action, data }, '*');
}
```

### Install a plugin

1. Zip the folder (`manifest.json` + `index.js` + `public/`).
2. Open the **Games** tab in LaklyCustom.
3. Drag the ZIP into the window.

The server validates **size, file count, extensions, and path traversal** before unpacking. User configs are stored outside the plugin folder — reinstalling a plugin doesn't wipe them.

📖 **Full spec:** [`docs/PLUGIN_API.md`](./docs/PLUGIN_API.md)
🎨 **Starter template:** [`plugins/_template/`](./plugins/_template/)

---

## 🔐 Security

LaklyCustom treats every guest as **untrusted**.

<table>
<tr>
<td width="50%" valign="top">

### ✅ What we do

- **Validation** — player names, chat messages, plugin IDs, game actions
- **Rate limiting** — room creation, joins, chat, actions, kicks
- **Join token** in URL (`?t=…`) — no token, no entry
- **ZIP checks** — size, extension whitelist, no `..`, no absolute paths
- **Electron hardened** — `contextIsolation: true`, `nodeIntegration: false`
- **Isolated worker** — hooks run in `worker_threads` with memory limits

</td>
<td width="50%" valign="top">

### ⚠️ What we don't pretend

- `worker_threads` is **not** a real security sandbox.
- Plugins run with real **Node.js privileges** inside their worker.
- Only install plugins you **trust**.

Read [SECURITY.md](./docs/SECURITY.md) for the full threat model.

</td>
</tr>
</table>

---

## 🖥 Interfaces

<table>
<tr>
<td width="50%" valign="top">

### Host UI (Electron)

- Pick a mode: folder, port, or room
- Copy public URL / scan QR
- Watch tunnel status live
- Launch games and plugins
- Kick players
- Install plugin ZIPs

</td>
<td width="50%" valign="top">

### Guest UI (browser)

- Enter a name
- See the player list
- Join the active game
- Chat
- Fullscreen mode
- Connection status

</td>
</tr>
</table>

---

## ⌨️ Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl + Alt + L` | Show / hide the window |
| `Ctrl + Alt + C` | Create a room (even when hidden) |
| `Ctrl + Shift + I` | DevTools (in dev mode) |

---

## 🐛 Troubleshooting

<details>
<summary><b>❌ Tunnel stays "Local only"</b></summary>

Check your internet connection. Cloudflare Quick Tunnel is sometimes blocked by ISPs — try mobile tethering.

Look at the terminal output from `npm start`. Look for `[tunnel-sup]` lines.

</details>

<details>
<summary><b>❌ Error 1033 in the guest browser</b></summary>

Cloudflare edge doesn't see your `cloudflared` yet. Usually heals itself in 5–10 seconds.

HTTP/2 is forced by default (`TUNNEL_TRANSPORT_PROTOCOL=http2`) to minimize this.

</details>

<details>
<summary><b>❌ Guest link doesn't open</b></summary>

Make sure the **whole link** is copied — it ends with `?t=<token>`.

The token is what identifies the room.

</details>

<details>
<summary><b>❌ Port already in use</b></summary>

Change it in **Settings → Local port**. Applies after restart.

Or kill whatever is listening on `3000`:
```powershell
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

</details>

<details>
<summary><b>❌ Plugin doesn't appear after install</b></summary>

Open **Games** — the plugin should be listed. If not, check the terminal for:

```
[plugins] <id>: <reason>
```

Common reasons:

- `невалидный manifest` — check `apiVersion: 1` and `id` matches folder name
- `import failed` — `index.js` uses `module.exports` instead of `export default`
- `worker timeout` — plugin hangs on load

</details>

<details>
<summary><b>❌ Processes stay alive after exit</b></summary>

Fixed in v0.8.0. If you see this, you're on an older build.

Update to the latest release or run:
```powershell
Get-Process LaklyCustom, cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```

</details>

<details>
<summary><b>🔍 Where are the logs?</b></summary>

Boot log:
```
C:\temp\lakly-boot.log
```

Contains: main-process logs, renderer console output, worker debug messages, plugin load traces.

Useful when filing an issue.

</details>

---

## 🗺 Roadmap

<table>
<tr>
<td width="50%" valign="top">

### 🟢 v0.8 — Foundation *(current)*

- [x] Room system with chat
- [x] Plugin API v1 + worker isolation
- [x] Folder sharing
- [x] Port proxy (HTTP + WebSocket)
- [x] Cloudflare Quick Tunnel
- [x] Tunnel supervisor with health checks
- [x] Rate limiting + validation
- [x] Unit tests (25)
- [x] NSIS installer

</td>
<td width="50%" valign="top">

### 🟡 v0.9 — Polish

- [ ] Demo GIF
- [ ] In-app diagnostics page
- [ ] Password-protected shares
- [ ] Basic auth
- [ ] Tunnel state UI (latency, uptime)
- [ ] Integration tests
- [ ] GitHub Actions release pipeline
- [ ] Portable build on Releases

</td>
</tr>
<tr>
<td valign="top">

### 🟠 v1.0 — Public launch

- [ ] Stable Plugin API
- [ ] 5+ official plugins
- [ ] Plugin gallery
- [ ] Auto-update
- [ ] macOS + Linux builds
- [ ] Documentation site
- [ ] E2E tests

</td>
<td valign="top">

### 🔵 Future

- [ ] Share single file
- [ ] Custom subdomains
- [ ] Plugin marketplace
- [ ] Room discovery
- [ ] More tunnel providers
- [ ] Mobile host app

</td>
</tr>
</table>

---

## 🛠 Development

```bash
git clone https://github.com/LAKLY/LaklyCustom.git
cd LaklyCustom
npm install
npm run dev
```

Always run tests before touching `core/` or `plugins/`:

```bash
npm test
```

### Project structure

```
electron/           ← main process, preload, IPC
core/               ← server, rooms, plugins, tunnels, proxy
  ├── tunnels/      ← Cloudflare, ngrok, local
  ├── plugin-*      ← loader, host, worker
  ├── room*         ← room, room-manager
  └── proxy.js      ← http-proxy wrapper
shared/             ← events, validation, rate limiting
public/             ← guest UI (served to browsers)
ui/                 ← host UI (served to Electron window)
plugins/            ← builtin plugins + template
tests/              ← node:test suites
docs/               ← PLUGIN_API, ARCHITECTURE, SECURITY
```

### Extension points

<table>
<tr>
<td width="33%" valign="top">

**🧩 Plugin**

Add a folder in `plugins/` with `manifest.json` + `index.js`.

See [`docs/PLUGIN_API.md`](./docs/PLUGIN_API.md).

</td>
<td width="33%" valign="top">

**🌐 Tunnel provider**

Implement `isAvailable()` / `start(port)` / `stop()` in `core/tunnels/`.

Register it in `core/tunnels/index.js`.

</td>
<td width="33%" valign="top">

**🚪 Room mode**

Add a type in `server.js` (`host:create-room`), runtime middleware, and fields in `applyRoomModeUi`.

</td>
</tr>
</table>

---

## 🤝 Contributing

Found a bug or have an idea? PRs welcome.

1. **Open an Issue** with a clear description.
2. **Fork** the repo, create a branch.
3. **Test** locally with `npm test`.
4. **Open a PR.**

For fixes, include:

- Reproduction steps
- Expected behaviour
- Actual behaviour
- Logs from `C:\temp\lakly-boot.log` if it touches server, tunnel, or plugin runtime

### Good first issues

Looking for a starting point? Look for labels:

- `good first issue`
- `help wanted`
- `plugin`
- `documentation`

---

## 💬 FAQ

<details>
<summary><b>Is this a ngrok replacement?</b></summary>

Partly. ngrok is a CLI for developers. LaklyCustom is a **desktop app** with a GUI, QR codes, and folder sharing.

If you need a tunnel for a script → use ngrok.

If you want a **one-click "share this with someone"** experience → use LaklyCustom.

</details>

<details>
<summary><b>Is it free?</b></summary>

Yes. MIT license. Cloudflare Quick Tunnel is free.

</details>

<details>
<summary><b>Can I use it for production?</b></summary>

Cloudflare Quick Tunnel is not meant for production — URLs are random and short-lived.

For real production, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) with a custom domain, or ngrok with a paid plan.

LaklyCustom supports ngrok if you set `NGROK_TOKEN`.

</details>

<details>
<summary><b>Does it work without internet?</b></summary>

Yes. It falls back to `localhost` mode. Guests on the same machine can still connect — useful for testing.

For LAN access, use your local IP directly.

</details>

<details>
<summary><b>Where is my data stored?</b></summary>

- **Settings** → `%APPDATA%\LaklyCustom\settings.json`
- **Plugin configs** → `%APPDATA%\LaklyCustom\plugin-data\`
- **Logs** → `C:\temp\lakly-boot.log`

Nothing leaves your machine except through the tunnel.

</details>

<details>
<summary><b>Can I self-host the tunnel?</b></summary>

Yes. Implement a provider in `core/tunnels/` and register it. See [How the tunnel works](#-how-the-tunnel-works).

</details>

---

## 📄 License

MIT — use it, fork it, break it, fix it.

---

<div align="center">

<img src="./assets/nika/nika-idle.png" alt="" width="96">

### LaklyCustom

**Share localhost. Keep it local.**

<sub>Built with Electron · Powered by Cloudflare · Wrapped in a warm dark UI</sub>

---

[⬆ Back to top](#laklycustom)

</div>
