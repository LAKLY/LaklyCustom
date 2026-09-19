// core/tunnels/cloudflare-quick.js
import { startTunnel } from 'untun';

const READY_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 700;

export class CloudflareQuickProvider {
  name = 'cloudflare-quick';
  #tunnel = null;

  async isAvailable() { return true; }

  async start(port) {
    try {
      this.#tunnel = await startTunnel({
        port,
        acceptCloudflareNotice: true,
      });

      const url = await this.#tunnel.getURL();
      console.log(`[tunnel] URL получен, проверяем готовность: ${url}`);
      await this.#waitUntilReady(url);
      console.log(`[tunnel] Туннель готов: ${url}`);
      return url;
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async #waitUntilReady(url) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let lastStatus = null;
    let lastErr = null;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(3000),
        });
        lastStatus = res.status;
        // Cloudflare отдаёт 502/503 пока туннель не подключён.
        // Если получили что-то < 500 — туннель работает.
        if (res.status < 500) return;
      } catch (err) {
        lastErr = err;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    const hint = lastStatus ? `последний статус ${lastStatus}` : (lastErr?.message || 'нет ответа');
    throw new Error(`Туннель не готов за ${READY_TIMEOUT_MS / 1000}с (${hint})`);
  }

  async stop() {
    try { await this.#tunnel?.close(); } catch {}
    this.#tunnel = null;
  }
}