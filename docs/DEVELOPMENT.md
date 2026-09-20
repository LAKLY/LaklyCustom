# Development

> Setup, build, test, and ship.

---

## 1. Requirements

- **Node.js 20 LTS** or newer (Electron 33 requires ≥ 18, but we test on 20/22)
- **Windows** for building the installer (Linux/macOS can build but not sign)
- **npm** ≥ 10

---

## 2. First-time setup

```bash
git clone https://github.com/LAKLY/LaklyCustom.git
cd LaklyCustom
npm install
```

**On Node 24**, `electron`'s postinstall may fail. If you see `Electron failed to install correctly`:

```powershell
# Windows PowerShell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
```

```bash
# bash / zsh
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

---

## 3. Scripts

| Command | Purpose |
|---|---|
| `npm start` | Launch the app |
| `npm run dev` | Launch with DevTools |
| `npm test` | Run unit tests |
| `npm run test:watch` | Tests in watch mode |
| `npm run pack` | Build for current platform → `release/win-unpacked/` |
| `npm run dist` | Build NSIS installer → `release/*.exe` |
| `npm run dist:portable` | Build single-file portable `.exe` |

---

## 4. Project layout

```
electron/           Main process, preload, IPC
  ├── main.mjs      App lifecycle, tray, window, IPC handlers
  └── preload.cjs   Context-isolated bridge to renderer

core/               Server-side logic (no Electron deps!)
  ├── server.js         Express + Socket.IO bootstrap
  ├── room.js           Single room state and methods
  ├── room-manager.js   Room registry
  ├── plugin-loader.js  Discovers and loads plugins
  ├── plugin-host.js    Main-side proxy for one worker
  ├── plugin-worker.js  Worker thread (one per plugin)
  ├── proxy.js          http-proxy wrapper + port scanner
  ├── tunnel-supervisor.js  Health checks, restart logic
  └── tunnels/          Provider implementations

shared/             Shared constants (used by core AND ui)
  ├── events.js         Event name constants
  ├── validation.js     Input validators
  └── rate-limit.js     In-memory rate limiter

public/             Guest UI (served to browsers)
  ├── index.html
  ├── client.js
  └── style.css

ui/                 Host UI (served to Electron window)
  ├── index.html
  ├── app.js
  └── style.css

plugins/            Bundled plugins
  ├── clicker/          Example plugin
  └── _template/        Starter template

tests/              node:test suites
docs/               This folder
```

**Rule:** `core/` must never `import` from `electron/`. It should be runnable headless.

---

## 5. Running locally

```bash
npm run dev
```

Opens the host UI in a window with DevTools available.

**Debug logs:**

- **Main process:** `console.log` → terminal
- **Renderer:** DevTools → Console
- **Worker:** forwarded to `[worker] ...` in the main log

**Boot log file:**

Every log line is also written to:

```
C:\temp\lakly-boot.log
```

Use this when the app doesn't start and you see no output.

**Environment flags:**

```powershell
$env:LAKLY_DEVTOOLS = "1"   # open DevTools on startup
```

```bash
LAKLY_DEVTOOLS=1 npm start
```

---

## 6. Testing

Tests use Node's built-in `node:test` — no Jest, no Mocha.

```bash
npm test
```

**Test suites:**

| File | Covers |
|---|---|
| `tests/validation.test.js` | Input validators |
| `tests/rate-limit.test.js` | Rate limiter |
| `tests/plugin-loader.test.js` | Plugin load/unload/reload |
| `tests/hardening.test.js` | Room actions, manifest validation |
| `tests/proxy-security.test.js` | Local-only endpoints |

**Write a new test:**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('my feature', async () => {
  const result = await doSomething();
  assert.equal(result, expected);
});
```

**Watch mode:**

```bash
npm run test:watch
```

---

## 7. Adding a plugin

1. Copy the template:

```bash
cp -r plugins/_template plugins/my-game
```

2. Edit `plugins/my-game/manifest.json`:

```json
{
  "id": "my-game",
  "name": "My Game",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "What it does"
}
```

3. Edit `plugins/my-game/index.js` — your server hooks.
4. Edit `plugins/my-game/public/game.html` — your iframe UI.
5. Restart the app (`Ctrl+C`, `npm start`).
6. Open **Games** tab — the plugin appears.

**Full spec:** [`PLUGIN_API.md`](./PLUGIN_API.md).

---

## 8. Adding a room mode

Modes change what guests see and how requests are routed.

### Step 1: server handler

In `core/server.js`, in `host:create-room`:

```js
if (requestedType === 'mymode') {
  if (!payload.someField) {
    socket.emit('error', 'Missing someField');
    return;
  }
  myField = payload.someField;
}
```

### Step 2: middleware

Add a middleware before the default `public/` fallback:

```js
app.use((req, res, next) => {
  const room = roomManager.findActive('mymode');
  if (!room) return next();
  // ... your logic
});
```

### Step 3: host UI

In `ui/app.js`:

- Add the mode to `modeTabs` handling
- Add a panel in `ui/index.html`
- Handle rendering in `applyRoomModeUi(data)`

---

## 9. Adding a tunnel provider

See [`TUNNELS.md`](./TUNNELS.md#7-adding-a-new-provider).

---

## 10. Building

### Dev build (unpacked)

```bash
npm run pack
# → release/win-unpacked/LaklyCustom.exe
```

Run it directly. This is what you test before shipping.

### Full installer

```bash
npm run dist
# → release/LaklyCustom Setup 0.8.0.exe
```

Double-click to install. **Test on a clean machine** — a fresh install often catches issues that `win-unpacked` hides.

### Portable

```bash
npm run dist:portable
# → release/LaklyCustom 0.8.0.exe
```

Single file, no install, no Start Menu entry.

---

## 11. Build configuration

`package.json` → `build` section:

```json
"build": {
  "appId": "com.lakly.custom",
  "productName": "LaklyCustom",
  "compression": "store",
  "files": [ /* included paths */ ],
  "asarUnpack": [
    "core/plugin-worker.js",
    "node_modules/untun/**/*"
  ],
  "extraResources": [
    { "from": "plugins", "to": "plugins" },
    { "from": "shared", "to": "shared" }
  ],
  "win": { "target": ["nsis"] },
  "nsis": {
    "oneClick": true,
    "perMachine": false
  }
}
```

**Why `compression: "store"`?**

`compression: "maximum"` (default) breaks the NSIS installer on some Windows versions — `System.dll` fails with `0xc0000005`. Store is faster and more reliable.

**Why `asarUnpack`?**

`plugin-worker.js` is spawned as a `Worker` — it needs a real file, not an entry inside `app.asar`. Same for `untun`, which spawns `cloudflared.exe`.

**Why `extraResources`?**

`plugins/` and `shared/` are read by Node at runtime. If packed inside `app.asar`, `import()` fails with `ENOTDIR`. `extraResources` copies them as real files next to `app.asar`.

---

## 12. Critical gotchas

### `shared/package.json` must exist

```
shared/
  package.json    ← {"type": "module"}
  events.js
  ...
```

Without it, Node treats `shared/events.js` as **CommonJS** in the installed app (because the project root isn't a package). `import { EVENTS }` fails with:

```
Named export 'EVENTS' not found. The requested module ... is a CommonJS module
```

Create it once with **no BOM**:

```powershell
[System.IO.File]::WriteAllText(
  "$PWD\shared\package.json",
  '{"type":"module"}',
  [System.Text.UTF8Encoding]::new($false)
)
```

Same for `plugins/package.json`, `core/package.json`, `electron/package.json`.

### PowerShell 5 adds BOM

`Out-File -Encoding utf8` writes UTF-8 **with BOM**. Node's JSON parser chokes on the BOM:

```
Error [ERR_INVALID_PACKAGE_CONFIG]: Invalid package config
```

**Always use .NET:**

```powershell
[System.IO.File]::WriteAllText(
  "$PWD\some.json",
  '{"key":"value"}',
  [System.Text.UTF8Encoding]::new($false)   # ← $false = no BOM
)
```

Verify with:

```powershell
Format-Hex .\some.json | Select-Object -First 1
# First bytes must NOT be EF BB BF
```

### VS Code locks `app.asar`

If VS Code has the project open, its file watcher holds `release/win-unpacked/resources/app.asar`, and `npm run dist` fails with:

```
The process cannot access the file because it is being used by another process
```

**Fix:** exclude `release/` from the watcher. Create `.vscode/settings.json`:

```json
{
  "files.watcherExclude": {
    "**/release/**": true,
    "**/release-*/**": true
  },
  "files.exclude": {
    "**/release": true,
    "**/release-*": true
  }
}
```

### Processes don't exit

Electron spawns 5 processes (`main`, `gpu`, `renderer`, `utility`, `crashpad`). Killing the main process doesn't always kill the rest.

`main.mjs` `will-quit` calls:

```js
spawnSync('taskkill', ['/F', '/T', '/PID', String(process.pid)]);
```

If you see zombies anyway:

```powershell
Get-Process LaklyCustom, cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 13. Pre-release checklist

Before shipping a version:

- [ ] `npm test` — all green
- [ ] `npm run pack` — launches and works
- [ ] Test both `folder` and `port` modes
- [ ] Test room creation with a plugin
- [ ] Close room → exit → **no zombie processes**
- [ ] `npm run dist` — build the installer
- [ ] Install on a clean user account → launches
- [ ] Create a GitHub Release with the `.exe`

---

## 14. CI

GitHub Actions runs on push to `main`:

```yaml
# .github/workflows/ci.yml
- Node 20
- Node 22
- npm test
```

Both must pass. If a test fails locally but passes in CI (or vice versa), it's almost always a timing or platform issue — bump the timeout or add a `process.platform` check.

---

## 15. Release process

1. Bump version in `package.json`
2. Update `README.md` if needed
3. Commit:
   ```bash
   git commit -m "chore: release v0.8.1"
   ```
4. Tag:
   ```bash
   git tag -a v0.8.1 -m "Release v0.8.1"
   git push origin v0.8.1
   ```
5. Build:
   ```bash
   npm run dist
   ```
6. Create GitHub Release:
   - Title: `v0.8.1`
   - Tag: `v0.8.1`
   - Attach `LaklyCustom Setup 0.8.1.exe`
   - Attach `win-unpacked.zip` (portable)
   - Paste changelog

---

## 16. Where to get help

- **Issues:** [github.com/LAKLY/LaklyCustom/issues](https://github.com/LAKLY/LaklyCustom/issues)
- **Discussions:** [github.com/LAKLY/LaklyCustom/discussions](https://github.com/LAKLY/LaklyCustom/discussions)
- **Plugin API:** [`PLUGIN_API.md`](./PLUGIN_API.md)
- **Security:** [`SECURITY.md`](./SECURITY.md)