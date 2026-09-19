// core/tunnel-supervisor.js
import { openTunnel, closeTunnel } from './tunnels/index.js';

// ─── Настройки мониторинга ──────────────────────────────────
const HEALTH_INTERVAL_MS       = 45_000;   // период проверки
const INTERNET_TIMEOUT_MS      = 4_000;
const LOCAL_TIMEOUT_MS         = 4_000;
const PUBLIC_TIMEOUT_MS        = 8_000;
const FAILURES_BEFORE_RESTART  = 4;        // ~3 минуты подряд
const RESTART_BACKOFF_MS       = [10_000, 20_000, 40_000, 60_000, 120_000];

// ─── Публичные адреса для проверки интернета ────────────────
const INTERNET_PROBES = [
  'https://1.1.1.1/cdn-cgi/trace',
  'https://cloudflare.com/cdn-cgi/trace',
];

export class TunnelSupervisor {
  #port;
  #instance = null;
  #url = null;
  #provider = null;

  #healthTimer = null;
  #restartTimer = null;
  #failures = 0;
  #restartAttempt = 0;
  #restarting = false;
  #stopped = false;

  constructor({ port, onUrlChange, onStateChange } = {}) {
    this.#port = port;
    this.onUrlChange = typeof onUrlChange === 'function' ? onUrlChange : () => {};
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
  }

  get url() { return this.#url; }
  get provider() { return this.#provider; }
  get isHealthy() { return !!this.#url && this.#failures === 0; }

  // Возвращает URL или null, если за отведённое время не удалось получить.
  async waitForReady(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#url) return this.#url;
      await new Promise(r => setTimeout(r, 500));
    }
    return this.#url;
  }

  async start() {
    this.#stopped = false;
    try {
      const result = await openTunnel(this.#port);
      this.#instance = result.instance;
      this.#url = result.url;
      this.#provider = result.provider;
      this.#failures = 0;
      this.#restartAttempt = 0;

      console.log(`[tunnel-sup] Поднят: ${this.#provider} → ${this.#url}`);
      this.onStateChange({ state: 'up', url: this.#url, provider: this.#provider });

      if (this.#provider !== 'local' && this.#url?.startsWith('http')) {
        this.#scheduleHealthCheck();
      }
    } catch (err) {
      console.error('[tunnel-sup] Старт провалился:', err.message);
      // Даже если туннель не поднялся — возвращаем localhost как fallback.
      this.#url = `http://localhost:${this.#port}`;
      this.#provider = 'local';
      this.onStateChange({ state: 'degraded', url: this.#url });
    }
    return this.#url;
  }

  async stop() {
    this.#stopped = true;
    clearTimeout(this.#healthTimer);
    clearTimeout(this.#restartTimer);
    this.#healthTimer = null;
    this.#restartTimer = null;
    try { await closeTunnel(this.#instance); } catch {}
    this.#instance = null;
    this.#url = null;
    this.#provider = null;
  }

  // Ручной форс-рестарт (например, из трея или из UI).
  async forceRestart() {
    if (this.#restarting) return;
    this.#failures = FAILURES_BEFORE_RESTART;
    await this.#restart();
  }

  // ─── Health check ────────────────────────────────────────
  #scheduleHealthCheck() {
    clearTimeout(this.#healthTimer);
    this.#healthTimer = setTimeout(() => this.#checkHealth(), HEALTH_INTERVAL_MS);
    this.#healthTimer.unref?.();
  }

  async #checkHealth() {
    if (this.#stopped) return;
    if (this.#restarting) return;
    if (!this.#url || this.#provider === 'local') return;

    // 1. Есть ли вообще интернет?
    const hasInternet = await this.#checkInternet();
    if (!hasInternet) {
      console.warn('[tunnel-sup] Интернета нет — туннель проверить нельзя');
      this.onStateChange({ state: 'offline' });
      this.#scheduleHealthCheck();
      return;
    }

    // 2. Жив ли локальный сервер?
    const localOk = await probeUrl(`http://127.0.0.1:${this.#port}/api/room`, LOCAL_TIMEOUT_MS, 'json');
    if (!localOk) {
      console.warn('[tunnel-sup] Локальный сервер не отвечает');
      this.onStateChange({ state: 'local-down' });
      this.#scheduleHealthCheck();
      return;
    }

    // 3. Отвечает ли публичный URL?
    const publicOk = await probeUrl(this.#url, PUBLIC_TIMEOUT_MS, 'json');

    if (publicOk) {
      if (this.#failures > 0) {
        console.log(`[tunnel-sup] Восстановлен после ${this.#failures} неудач`);
      }
      this.#failures = 0;
      this.#restartAttempt = 0;
      this.onStateChange({ state: 'healthy', url: this.#url, provider: this.#provider });
    } else {
      this.#failures++;
      console.warn(`[tunnel-sup] Fail ${this.#failures}/${FAILURES_BEFORE_RESTART}`);
      this.onStateChange({
        state: 'unhealthy',
        failures: this.#failures,
        threshold: FAILURES_BEFORE_RESTART,
      });

      if (this.#failures >= FAILURES_BEFORE_RESTART) {
        this.#scheduleRestart();
        return;
      }
    }

    this.#scheduleHealthCheck();
  }

  async #checkInternet() {
    for (const url of INTERNET_PROBES) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), INTERNET_TIMEOUT_MS);
        const res = await fetch(url, { signal: ctl.signal });
        clearTimeout(t);
        if (res.ok) return true;
      } catch { /* пробуем следующий */ }
    }
    return false;
  }

  // ─── Пересоздание туннеля ────────────────────────────────
  #scheduleRestart() {
    if (this.#restarting || this.#stopped) return;
    this.#restarting = true;

    const idx = Math.min(this.#restartAttempt, RESTART_BACKOFF_MS.length - 1);
    const delay = RESTART_BACKOFF_MS[idx];
    this.#restartAttempt++;

    console.warn(`[tunnel-sup] Пересоздание через ${delay / 1000}с (попытка ${this.#restartAttempt})`);
    this.onStateChange({
      state: 'restarting',
      attempt: this.#restartAttempt,
      delay,
    });

    clearTimeout(this.#restartTimer);
    this.#restartTimer = setTimeout(() => this.#restart(), delay);
    this.#restartTimer.unref?.();
  }

  async #restart() {
    if (this.#stopped) return;
    const oldUrl = this.#url;

    try { await closeTunnel(this.#instance); } catch {}
    this.#instance = null;
    this.#url = null;

    try {
      const result = await openTunnel(this.#port);
      this.#instance = result.instance;
      this.#url = result.url;
      this.#provider = result.provider;
      this.#failures = 0;
      this.#restarting = false;
      this.#restartAttempt = 0;

      console.log(`[tunnel-sup] Пересоздан: ${this.#url}`);
      this.onStateChange({ state: 'up', url: this.#url, provider: this.#provider });

      if (oldUrl && this.#url && oldUrl !== this.#url) {
        this.onUrlChange({ oldUrl, newUrl: this.#url, provider: this.#provider });
      }

      if (this.#provider !== 'local') {
        this.#scheduleHealthCheck();
      }
    } catch (err) {
      console.error('[tunnel-sup] Пересоздание провалилось:', err.message);
      this.#restarting = false;
      this.#scheduleRestart();
    }
  }
}

// ─── Утилита: проверка URL ──────────────────────────────────
// expect = 'json' → требуем Content-Type: application/json
// expect = null   → достаточно успешного ответа
async function probeUrl(url, timeoutMs, expect = null) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'GET',
      signal: ctl.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'LaklyCustom-health/1.0' },
    });
    clearTimeout(t);
    if (!res.ok) return false;
    if (expect === 'json') {
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return false;
    }
    return true;
  } catch {
    return false;
  }
}