# Security Model

> How LaklyCustom handles untrusted guests, untrusted plugins, and untrusted content.

LaklyCustom exposes a **local server** to the public internet. This document describes what is validated, what is isolated, and what is **not** — so you can decide what to trust.

---

## 1. Trust boundaries

| Component | Trust level | Notes |
|---|---|---|
| **Host** (Electron app) | Trusted | Owns the room, its own machine |
| **Guest** (browser) | Untrusted | Anyone with the link |
| **Plugin** (ZIP install) | Semi-trusted | Runs with Node.js privileges |
| **Cloudflare Tunnel** | Third party | Sees traffic; cannot decrypt beyond TLS |
| **Files on disk** | Trusted | Served via `express.static` |

**Rule of thumb:** treat every guest as hostile, every plugin as third-party code.

---

## 2. Guest input — what is validated

Every guest message crosses a validation layer before it touches core logic.

### Player names

```js
validatePlayerName(value)
// trim, collapse whitespace, max 24 chars, non-empty
```

### Chat messages

```js
validateChatMessage(value)
// trim, max 500 chars, non-empty
```

### Room names

```js
validateRoomName(value)
// trim, max 40 chars, fallback to "Lakly Room"
```

### Plugin IDs

```js
validatePluginId(value)
// ^[a-z0-9][a-z0-9_-]{0,39}$  (lowercase, no path chars)
```

### Game actions

```js
validateGameAction(value)
// ^[a-z0-9_:-]{1,40}$  (no spaces, no unicode, no HTML)
```

**Invalid input is silently dropped.** The guest never learns why — that's intentional, it prevents fuzzing.

---

## 3. Rate limiting

Every action is bucketed by IP or socket ID.

| Action | Limit | Window |
|---|---|---|
| `host:create-room` | 3 | 60 s |
| `player:join` | 5 | 60 s |
| `chat:message` | 5 | 1 s |
| `game:action` | 60 | 1 s |
| `host:kick-player` | 20 | 60 s |
| `POST /api/proxy/check` | 30 | 60 s |

Buckets live in memory, pruned every 5 minutes. Restarting the app resets them.

**When a limit is hit, the action is dropped silently.** No 429 response, no error message.

---

## 4. Join token

Every room has a random UUID `joinToken`. The public URL ends with `?t=<token>`.

```js
socket.on('player:join', ({ playerName, token }) => {
  if (room.joinToken && token !== room.joinToken) {
    socket.emit('error', 'Ссылка недействительна');
    return;
  }
  ...
});
```

**Without the token, `player:join` is rejected.** Guessing is infeasible (UUIDv4 = 122 bits).

⚠️ **The token is not a password.** Anyone with the link has it. If you leak the link, you leak the room.

---

## 5. Local-only endpoints

Some endpoints are only meaningful to the host machine. They reject any request that looks like it came through a tunnel.

```js
function isLocalRequest(req) {
  if (req.headers['cf-connecting-ip']) return false;  // Cloudflare
  if (req.headers['x-forwarded-for'])   return false;  // ngrok / proxy
  const ip = req.ip || req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
```

**Protected endpoints:**

- `POST /api/proxy/check` — probe a local port
- `GET  /api/proxy/scan`  — scan known dev ports
- `DELETE /api/plugins/:id` — uninstall a plugin

Guests hitting these get **403 Forbidden**.

---

## 6. Plugin installation (ZIP)

Plugins are unpacked with strict rules. Every check runs **before** extraction.

| Check | Limit | Why |
|---|---|---|
| ZIP file size | ≤ 10 MB | Prevent zip bombs |
| Total extracted | ≤ 50 MB | Prevent disk fill |
| File count | ≤ 500 | Prevent inode exhaustion |
| Extension whitelist | `.js .mjs .cjs .json .html .css .svg .png .jpg .jpeg .gif .webp .ico .woff .woff2 .ttf .otf .txt .md` | No `.exe`, `.sh`, `.so`, `node_modules` |
| Path traversal | reject `..`, absolute paths, symlinks | Prevent escape from plugin dir |

**Path traversal example — rejected:**

```
../../../../etc/passwd
C:\Windows\System32\config\SAM
file:///etc/shadow
```

**Absolute paths, `..` segments, and anything outside `plugins/<id>/` fail the extract.**

---

## 7. Plugin isolation

Each plugin runs inside a **`worker_threads`** worker.

```js
new Worker(WORKER_PATH, {
  resourceLimits: {
    maxOldGenerationSizeMb: 128,
    maxYoungGenerationSizeMb: 32,
  },
});
```

**What this gives you:**

- ✅ Memory cap (128 MB heap)
- ✅ Timeout on every hook (5 s)
- ✅ Crash isolation (a bad plugin doesn't kill the server)
- ✅ No direct access to `roomManager`, `io`, or the host process

**What this does NOT give you:**

- ❌ A security boundary. `fs`, `net`, `child_process` are all available to plugins.
- ❌ Code signing. A plugin can be anything.
- ❌ Network restrictions. Plugins can call out.

**A `worker_threads` worker is not a sandbox.** It shares the Node.js process and its privileges.

---

## 8. Plugin threat model

Consider what happens if a plugin is malicious:

| Attack | Possible? | Notes |
|---|---|---|
| Read/write any file the user can | ✅ Yes | `fs` is available |
| Spawn processes | ✅ Yes | `child_process` is available |
| Open outbound connections | ✅ Yes | `net`, `http` are available |
| Bind a local port | ✅ Yes | `net.createServer` |
| Access other users' data | ❌ No | Workers don't share memory |
| Kill the host process | ❌ No | Worker crash is contained |
| Steal the join token | ⚠️ Partially | Only tokens for rooms it handles |

**Conclusion: only install plugins you trust, the same way you'd trust an `npm install` script.**

---

## 9. Electron hardening

The host window runs with strict settings.

```js
webPreferences: {
  contextIsolation: true,     // separate JS contexts
  nodeIntegration: false,     // no `require` in renderer
  preload: 'preload.cjs',     // only whitelisted IPC
}
```

The preload exposes a **narrow surface**:

```js
contextBridge.exposeInMainWorld('lakly', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (data) => ipcRenderer.invoke('settings:set', data),
  installPluginZip: (zipPath) => ipcRenderer.invoke('plugin:install-zip', zipPath),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  openPath: (p) => ipcRenderer.invoke('shell:open-path', p),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onTrayAction: (cb) => ipcRenderer.on('tray:action', (_e, a) => cb(a)),
});
```

**No filesystem, no process spawn, no shell from the renderer.** Only those six functions.

External URLs open in the system browser:

```js
win.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url);
  return { action: 'deny' };
});
```

---

## 10. Folder and port sharing

When you share a folder or a port, guests reach **whatever you exposed**.

| Mode | What guests can do |
|---|---|
| Folder | `GET` any file inside the chosen directory |
| Port | Anything the local server would allow |

**LaklyCustom does not add auth on top.** If your dev server has no auth, guests have no auth.

For extra protection:

- Don't share folders with secrets (`.env`, `.git`, `node_modules`)
- Enable `dotFiles: false` in share options (default)
- Close the room when done — the tunnel dies with it

---

## 11. What we log

| Where | What |
|---|---|
| `C:\temp\lakly-boot.log` | Main process, renderer console, worker debug |
| `%APPDATA%\LaklyCustom\settings.json` | Tunnel provider, port, ngrok token, allowed dirs |
| `%APPDATA%\LaklyCustom\plugin-data\` | Per-plugin user config |

**No telemetry. Nothing leaves your machine except through the tunnel.**

Logs are **local only** and not rotated — delete manually if they grow.

---

## 12. Reporting a vulnerability

Found something? Please **do not** open a public issue for security bugs.

Open a private security advisory:

```
https://github.com/LAKLY/LaklyCustom/security/advisories/new
```

Include:

- Affected version (`Settings → About` or `package.json`)
- Reproduction steps
- Impact assessment (what can an attacker do?)
- Proof-of-concept if possible

We'll respond within 72 hours.

---

## 13. Known limitations

- **No authentication layer.** Anyone with the link is in.
- **Plugins are not sandboxed** at the OS level.
- **Cloudflare Quick Tunnel URLs are public.** The token is the only gate.
- **No content security policy** on guest HTML — plugins can load external resources.
- **Rate limits reset on restart.** A determined attacker can wait.

These are deliberate trade-offs for a **local-first tool**. If you need real security, use Cloudflare Access, Tailscale, or a VPN.

---

## 14. Hardening checklist

Before sharing a room publicly:

- [ ] Do not share folders containing `.env`, `.git`, credentials, keys
- [ ] Do not share ports that expose admin panels or databases
- [ ] Only install plugins from sources you trust
- [ ] Close the room when you're done (`Закрыть комнату`)
- [ ] Kill the app from the tray when you're done for the day
- [ ] Review `C:\temp\lakly-boot.log` if something looks off