// core/tunnel-supervisor.js
import { openTunnel, closeTunnel } from './tunnels/index.js';
import dns from 'node:dns/promises';

// ─── Настройки мониторинга ──────────────────────────────────
const HEALTH_INTERVAL_MS       = 45_000;
const HEALTH_INTERVAL_OFFLINE  = 5_000;    // быстро ловим возврат сети
const INTERNET_TIMEOUT_MS      = 3_000;
const LOCAL_TIMEOUT_MS         = 4_000;
const PUBLIC_TIMEOUT_MS        = 8_000;
const CLOSE_TIMEOUT_MS         = 3_000;    // чтобы рестарт не висел на мёртвом cloudflared
const FAILURES_BEFORE_RESTART  = 3;
const RESTART_BACKOFF_MS       = [10_000, 20_000, 40_000, 60_000, 120_000];

// Readiness-чек: бьём в /api/room с нарастающими паузами.
const READY_DELAYS_MS = [1000, 2000, 3000, 5000, 8000];

// ВАЖНО: проверяем именно /api/room, а не /. Корень отдаёт HTML гостевого UI,
// probeJson ждёт application/json → ловили ложные false.
const PUBLIC_PROBE_PATH = '/api/room';

// Проверка интернета через DNS, а не через fetch к 1.1.1.1:
// IP-literal легко кэшируется ОС и не отваливается при потере сети,
// из-за чего туннель считался «сломанным» вместо «оффлайн».
const INTERNET_DNS_HOSTS = ['one.one.one.one', 'dns.google', 'cloudflare.com'];

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
  #lastState = 'unknown';

  constructor({ port, onUrlChange, onStateChange } = {}) {
    this.#port = port;
    this.onUrlChange = typeof onUrlChange === 'function' ? onUrlChange : () => {};
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
  }

  get url() { return this.#url; }
  get provider() { return this.#provider; }
  get isHealthy() { return !!this.#url && this.#failures === 0; }

  #emitState(state) {
    this.#lastState = state?.state || state;
    this.onStateChange(state);
  }

  async waitForReady(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#url) return this.#url;
      await sleep(500);
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

      if (this.#provider === 'local') {
        this.#emitState({ state: 'up', url: this.#url, provider: this.#provider });
        return this.#url;
      }

      const ready = await this.#waitUntilReachable(this.#url);
      if (ready) {
        console.log('[tunnel-sup] Публичный URL отвечает — туннель готов');
        this.#emitState({ state: 'up', url: this.#url, provider: this.#provider });
      } else {
        console.warn('[tunnel-sup] URL пока не отвечает — доводим health-чекой');
        this.#emitState({ state: 'warming', url: this.#url, provider: this.#provider });
      }

      this.#scheduleHealthCheck();
    } catch (err) {
      console.error('[tunnel-sup] Старт провалился:', err.message);
      this.#url = `http://localhost:${this.#port}`;
      this.#provider = 'local';
      this.#emitState({ state: 'degraded', url: this.#url });
    }
    return this.#url;
  }

  async stop() {
    this.#stopped = true;
    clearTimeout(this.#healthTimer);
    clearTimeout(this.#restartTimer);
    this.#healthTimer = null;
    this.#restartTimer = null;
    await closeWithTimeout(this.#instance, CLOSE_TIMEOUT_MS);
    this.#instance = null;
    this.#url = null;
    this.#provider = null;
  }

  async forceRestart() {
    if (this.#restarting) return;
    this.#failures = FAILURES_BEFORE_RESTART;
    await this.#restart();
  }

  async #waitUntilReachable(baseUrl) {
    for (const delay of READY_DELAYS_MS) {
      if (this.#stopped) return false;
      await sleep(delay);
      const ok = await probeJson(`${baseUrl}${PUBLIC_PROBE_PATH}`, PUBLIC_TIMEOUT_MS);
      if (ok) return true;
    }
    return false;
  }

  #scheduleHealthCheck(intervalOverride) {
    clearTimeout(this.#healthTimer);
    const interval = Number.isFinite(intervalOverride) ? intervalOverride : HEALTH_INTERVAL_MS;
    this.#healthTimer = setTimeout(() => this.#checkHealth(), interval);
    this.#healthTimer.unref?.();
  }

  async #checkHealth() {
    if (this.#stopped) return;
    if (this.#restarting) return;
    if (!this.#url || this.#provider === 'local') return;

    // 1. Интернет вообще есть?
    const hasInternet = await this.#checkInternet();
    if (!hasInternet) {
      if (this.#lastState !== 'offline') {
        console.warn('[tunnel-sup] Интернет пропал — ждём');
        this.#emitState({ state: 'offline' });
      }
      // Оффлайн — это НЕ провал туннеля. Сбрасываем счётчик,
      // чтобы при возврате сети не улететь в рестарт с накопленными фейлами.
      this.#failures = 0;
      this.#scheduleHealthCheck(HEALTH_INTERVAL_OFFLINE);
      return;
    }

    if (this.#lastState === 'offline') {
      console.log('[tunnel-sup] Интернет вернулся — перепроверяем туннель');
    }

    // 2. Локальный сервер жив?
    const localOk = await probeJson(
      `http://127.0.0.1:${this.#port}${PUBLIC_PROBE_PATH}`,
      LOCAL_TIMEOUT_MS,
    );
    if (!localOk) {
      if (this.#lastState !== 'local-down') {
        console.warn('[tunnel-sup] Локальный сервер не отвечает');
        this.#emitState({ state: 'local-down' });
      }
      this.#scheduleHealthCheck();
      return;
    }

    // 3. Публичный URL отвечает валидным JSON?
    const publicOk = await probeJson(
      `${this.#url}${PUBLIC_PROBE_PATH}`,
      PUBLIC_TIMEOUT_MS,
    );

    if (publicOk) {
      if (this.#failures > 0) {
        console.log(`[tunnel-sup] Восстановлен после ${this.#failures} неудач`);
      }
      this.#failures = 0;
      this.#restartAttempt = 0;
      this.#emitState({ state: 'healthy', url: this.#url, provider: this.#provider });
      this.#scheduleHealthCheck();
      return;
    }

    // Публичный URL молчит, а интернет есть — это реальный провал.
    this.#failures++;
    console.warn(`[tunnel-sup] Fail ${this.#failures}/${FAILURES_BEFORE_RESTART} (${this.#url})`);
    this.#emitState({
      state: 'unhealthy',
      failures: this.#failures,
      threshold: FAILURES_BEFORE_RESTART,
      url: this.#url,
    });

    if (this.#failures >= FAILURES_BEFORE_RESTART) {
      this.#scheduleRestart();
      return;
    }
    this.#scheduleHealthCheck();
  }

  async #checkInternet() {
    // DNS-резолв публичных имён. Быстро, не подменяется провайдером-заглушкой,
    // не живёт в DNS-кэше Windows так агрессивно, как HTTP-кэш IP-литералов.
    for (const host of INTERNET_DNS_HOSTS) {
      try {
        const result = await withTimeout(dns.lookup(host), INTERNET_TIMEOUT_MS);
        if (result?.address) return true;
      } catch { /* пробуем следующий */ }
    }
    return false;
  }

  #scheduleRestart() {
    if (this.#restarting || this.#stopped) return;
    this.#restarting = true;

    const idx = Math.min(this.#restartAttempt, RESTART_BACKOFF_MS.length - 1);
    const delay = RESTART_BACKOFF_MS[idx];
    this.#restartAttempt++;

    console.warn(`[tunnel-sup] Пересоздание через ${delay / 1000}с (попытка ${this.#restartAttempt})`);
    this.#emitState({
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

    // Закрываем старый с таймаутом: если cloudflared уже умер,
    // close() может висеть и блокировать рестарт навсегда.
    await closeWithTimeout(this.#instance, CLOSE_TIMEOUT_MS);
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

      if (this.#provider !== 'local') {
        const ready = await this.#waitUntilReachable(this.#url);
        if (ready) {
          console.log('[tunnel-sup] Новый URL отвечает');
          this.#emitState({ state: 'up', url: this.#url, provider: this.#provider });
        } else {
          console.warn('[tunnel-sup] Новый URL пока не отвечает');
          this.#emitState({ state: 'warming', url: this.#url, provider: this.#provider });
        }
      } else {
        this.#emitState({ state: 'up', url: this.#url, provider: this.#provider });
      }

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

// ─── Утилиты ────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function closeWithTimeout(instance, ms) {
  if (!instance) return;
  try { await withTimeout(closeTunnel(instance), ms); }
  catch { /* не даём close() заблокировать рестарт */ }
}

async function probeJson(url, timeoutMs) {
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
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return false;
    return true;
  } catch {
    return false;
  }
}