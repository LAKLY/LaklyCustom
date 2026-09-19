// core/tunnels/cloudflare-quick.js
import { startTunnel } from 'untun';

// Cloudflare edge видит туннель обычно за 3–5 секунд.
// Фиксированная пауза надёжнее, чем fetch-чек из той же машины:
// локальный round-trip часто блокируется NAT-loopback / firewall,
// из-за чего рабочий туннель ошибочно считается «не готов».
const SETTLE_MS = 5000;

export class CloudflareQuickProvider {
  name = 'cloudflare-quick';
  #tunnel = null;

  async isAvailable() {
    return true;
  }

  async start(port) {
    try {
      this.#tunnel = await startTunnel({
        port,
        acceptCloudflareNotice: true,
      });

      const url = await this.#tunnel.getURL();
      console.log(`[tunnel] URL получен: ${url}, ждём ${SETTLE_MS / 1000}с`);
      await new Promise(r => setTimeout(r, SETTLE_MS));
      console.log(`[tunnel] Туннель готов: ${url}`);
      return url;
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async stop() {
    try { await this.#tunnel?.close(); } catch {}
    this.#tunnel = null;
  }
}