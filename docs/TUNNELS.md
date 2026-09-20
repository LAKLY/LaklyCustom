# Tunnel Providers

> How LaklyCustom exposes a local port to the internet.

The tunnel is the bridge between your machine and the guest's browser. This document covers the provider abstraction, the supervisor, and how to add a new provider.

---

## 1. Why a provider abstraction

Cloudflare Quick Tunnel works 90% of the time. The other 10%:

- ISP blocks Cloudflare
- Cloudflare rate-limits your IP
- You want a custom domain (ngrok paid)
- You want to self-host

**Solution:** a small interface that any tunnel can implement.

```js
class TunnelProvider {
  name = 'provider-name';
  async isAvailable() { /* boolean */ }
  async start(port)   { /* returns public URL */ }
  async stop()        { /* cleanup */ }
}
```

Register providers in `core/tunnels/index.js`. The first available one wins.

---

## 2. Built-in providers

| Provider | Requires | Free? | Custom domain? |
|---|---|---|---|
| **Cloudflare Quick** | nothing | ✅ | ❌ (random `*.trycloudflare.com`) |
| **ngrok** | `NGROK_TOKEN` env | ⚠️ limited | ✅ (paid) |
| **Local** | nothing | ✅ | ❌ (`localhost` only) |

### Cloudflare Quick Tunnel

Default. Uses the bundled `cloudflared` binary via [`untun`](https://www.npmjs.com/package/untun).

```js
// core/tunnels/cloudflare-quick.js
import { startTunnel } from 'untun';

export class CloudflareQuickProvider {
  name = 'cloudflare-quick';
  #tunnel = null;

  async isAvailable() { return true; }

  async start(port) {
    process.env.TUNNEL_TRANSPORT_PROTOCOL = 'http2';
    this.#tunnel = await startTunnel({
      port,
      acceptCloudflareNotice: true,
    });
    const url = await this.#tunnel.getURL();
    await new Promise(r => setTimeout(r, 5000));  // settle
    return url;
  }

  async stop() {
    try { await this.#tunnel?.close(); } catch {}
    this.#tunnel = null;
  }
}
```

**Why `TUNNEL_TRANSPORT_PROTOCOL=http2`?**

By default, `cloudflared` talks HTTP/2 to the origin server. Express only speaks HTTP/1.1. Without this env var, the tunnel dies after ~5 s. The var forces `cloudflared` to use HTTP/2 to the **Cloudflare edge**, and HTTP/1.1 to the **origin**. Yes, this is confusing.

### ngrok

Only activates if `NGROK_TOKEN` is set. Otherwise `isAvailable()` returns false and it's skipped.

```js
export class NgrokProvider {
  name = 'ngrok';

  async isAvailable() {
    return !!ngrok && !!process.env.NGROK_TOKEN;
  }

  async start(port) {
    await ngrok.authtoken(process.env.NGROK_TOKEN);
    return await ngrok.connect(port);
  }

  async stop() {
    try { await ngrok?.disconnect?.(); } catch {}
  }
}
```

### Local fallback

If every provider fails, `openTunnel()` returns `http://localhost:PORT` and marks the state as `local`. Guests on the same machine can still connect — useful for testing without internet.

---

## 3. Supervisor

`TunnelSupervisor` wraps the active provider and keeps it healthy.

### State machine

```
    ┌──────────┐
    │ starting │
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ warming  │   (URL returned but not yet reachable)
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ healthy  │◀───────────────┐
    └────┬─────┘                │
         │                      │
         │ 3 failures           │ 1 success
         ▼                      │
    ┌──────────┐                │
    │ restarting│──────────────▶│
    └────┬─────┘
         │
         │ no internet
         ▼
    ┌──────────┐
    │ offline  │
    └────┬─────┘
         │
         │ internet back
         ▼
    ┌──────────┐
    │ healthy  │
    └──────────┘
```

### Health check (every 45 s)

```js
async #checkHealth() {
  // 1. Internet reachable? (DNS lookup)
  if (!await this.#checkInternet()) {
    this.#emitState({ state: 'offline' });
    return;
  }

  // 2. Local server answering? (GET localhost:PORT/api/room)
  if (!await probeJson(`http://127.0.0.1:${this.#port}/api/room`)) {
    this.#emitState({ state: 'local-down' });
    return;
  }

  // 3. Public URL returning valid JSON?
  if (await probeJson(`${this.#url}/api/room`)) {
    this.#failures = 0;
    this.#emitState({ state: 'healthy' });
    return;
  }

  // Fail
  this.#failures++;
  if (this.#failures >= 3) this.#scheduleRestart();
}
```

**Why 3 checks?**

Separating "internet down" from "tunnel broken" from "local server crashed" lets the UI show precise messages. A naive `fetch(url)` would report all three as "unreachable".

**Why `/api/room`, not `/`?**

`/` returns guest HTML (`text/html`). `probeJson` expects `application/json`. Using `/` produces false negatives.

### Restart with backoff

```
failures >= 3
       │
       ▼
scheduleRestart()
       │
       ├─ delay: 10 s    (attempt 1)
       ├─ delay: 20 s    (attempt 2)
       ├─ delay: 40 s    (attempt 3)
       ├─ delay: 60 s    (attempt 4)
       └─ delay: 120 s   (attempt 5+)
       │
       ▼
#restart()
       ├─ closeWithTimeout(oldInstance, 3s)
       ├─ openTunnel(port)
       ├─ waitUntilReachable(newUrl)
       └─ onUrlChange({ oldUrl, newUrl })
```

**`closeWithTimeout` is essential.** If `cloudflared` is dead, `close()` can hang forever and block the restart. We cap it at 3 seconds.

---

## 4. Timeouts and constants

```js
const HEALTH_INTERVAL_MS       = 45_000;   // normal
const HEALTH_INTERVAL_OFFLINE  =  5_000;   // when offline
const INTERNET_TIMEOUT_MS      =  3_000;   // DNS lookup
const LOCAL_TIMEOUT_MS         =  4_000;   // GET localhost
const PUBLIC_TIMEOUT_MS        =  8_000;   // GET public URL
const CLOSE_TIMEOUT_MS         =  3_000;   // close() cap
const FAILURES_BEFORE_RESTART  =  3;
const RESTART_BACKOFF_MS       = [10_000, 20_000, 40_000, 60_000, 120_000];
const READY_DELAYS_MS          = [1000, 2000, 3000, 5000, 8000];
```

---

## 5. URL change handling

When the tunnel is recreated, the public URL changes. The host UI and every guest need to know.

```js
// core/server.js
onUrlChange: ({ newUrl, provider }) => {
  const room = roomManager.findActive();
  if (!room) return;

  room.publicUrl = `${newUrl}?t=${room.joinToken}`;

  io.to(room.hostSocketId).emit('host:room-url-changed', {
    publicUrl: room.publicUrl,
    provider,
  });

  room.broadcast('room:url-changed', { provider });
  room.addMessage('Система', '#63D8FF', 'Ссылка комнаты обновлена');
}
```

**Guests don't need to reconnect.** Socket.IO keeps them on the old URL — the connection survives the tunnel swap. They just get a notification that the link changed (for sharing).

---

## 6. Cleanup

### On room close

`TunnelSupervisor.stop()`:

1. Clear timers
2. `closeWithTimeout(instance, 3s)`
3. **Force-kill `cloudflared.exe`**

```js
async function killCloudflaredProcesses() {
  if (process.platform !== 'win32') return;
  try {
    const res = spawnSync('taskkill',
      ['/F', '/IM', 'cloudflared.exe'],
      { stdio: 'ignore', windowsHide: true });
  } catch {}
}
```

**Why force-kill?**

`untun.close()` sends SIGTERM. Sometimes `cloudflared` ignores it. The zombie process holds port 3000's outbound connection and prevents restart.

### On app exit

`main.mjs` `will-quit`:

```js
taskkill /F /T /PID <current-pid>
```

This kills the entire process tree: Electron main + renderer + GPU + cloudflared.

---

## 7. Adding a new provider

### Step 1: create the file

`core/tunnels/my-provider.js`:

```js
export class MyProvider {
  name = 'my-provider';
  #instance = null;

  async isAvailable() {
    // Return false to skip this provider
    return !!process.env.MY_PROVIDER_KEY;
  }

  async start(port) {
    // Start the tunnel. Return the public URL as a string.
    this.#instance = await myTunnelLib.open({ port });
    return await this.#instance.getUrl();
  }

  async stop() {
    try { await this.#instance?.close(); } catch {}
    this.#instance = null;
  }
}
```

### Step 2: register it

`core/tunnels/index.js`:

```js
import { CloudflareQuickProvider } from './cloudflare-quick.js';
import { NgrokProvider } from './ngrok.js';
import { MyProvider } from './my-provider.js';         // ← add

const providers = [
  new MyProvider(),                                     // ← first = highest priority
  new CloudflareQuickProvider(),
  new NgrokProvider(),
];

export async function openTunnel(port) {
  for (const provider of providers) {
    if (!(await provider.isAvailable())) continue;
    try {
      const url = await provider.start(port);
      return { url, provider: provider.name, instance: provider };
    } catch (err) {
      console.warn(`[tunnel] ${provider.name} failed:`, err.message);
    }
  }
  return { url: `http://localhost:${port}`, provider: 'local', instance: null };
}
```

### Step 3: handle cleanup

If your provider spawns external processes (like `cloudflared`), add a force-kill in `tunnel-supervisor.js`:

```js
async function killMyProviderProcesses() {
  if (process.platform !== 'win32') return;
  spawnSync('taskkill', ['/F', '/IM', 'my-tunnel-binary.exe'],
    { stdio: 'ignore', windowsHide: true });
}
```

Call it from `TunnelSupervisor.stop()`.

---

## 8. Testing a provider

**Without internet:**

```bash
# Force local fallback
set NGROK_TOKEN=
npm start
# Should show "local" provider
```

**With internet:**

```bash
npm start
# Wait for the URL to appear in the host UI
# Open it in a browser — should show guest UI
```

**Simulate a tunnel failure:**

```powershell
# Kill cloudflared mid-session
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```

Within 45 s, the supervisor should detect 3 failures and recreate the tunnel. Watch the log:

```
[tunnel-sup] Fail 1/3 (https://xxx.trycloudflare.com)
[tunnel-sup] Fail 2/3
[tunnel-sup] Fail 3/3
[tunnel-sup] Пересоздание через 10с (попытка 1)
[tunnel-sup] Пересоздан: https://yyy.trycloudflare.com
```

---

## 9. Known issues

| Symptom | Cause | Fix |
|---|---|---|
| Tunnel dies after ~5 s | `TUNNEL_TRANSPORT_PROTOCOL` not set | Set env var to `http2` |
| `cloudflared exited before URL was ready` | Fast failure | Retry (backoff handles it) |
| Zombie `cloudflared.exe` | SIGTERM ignored | `taskkill /F` (already done) |
| `1033` in browser | Edge not ready | Wait 5–10 s |
| `fetch` returns `ECONNREFUSED` | Local server crashed | Restart app |
| Every request `403` | Cloudflare blocking | Check provider status |

---

## 10. What we don't support (yet)

- **Custom subdomains** (needs a paid Cloudflare account)
- **Named tunnels** (persistent URLs)
- **Multiple simultaneous tunnels** (one active tunnel per process)
- **Tunnel for non-HTTP protocols** (WebSocket works, raw TCP does not)