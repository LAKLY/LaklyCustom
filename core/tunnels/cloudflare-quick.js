// core/tunnels/cloudflare-quick.js
import { startTunnel } from 'untun';

// Cloudflare edge видит туннель обычно за 3–5 секунд.
const SETTLE_MS = 5000;

export class CloudflareQuickProvider {
  name = 'cloudflare-quick';
  #tunnel = null;

  async isAvailable() {
    return true;
  }

  async start(port) {
    // Форсируем HTTP/2 как протокол до EDGE Cloudflare.
    //
    // Читается самим cloudflared при старте. НЕ путать с опцией
    // `protocol` в startTunnel() — та меняет схему для origin
    // (http2://localhost:3000), а Express умеет только HTTP/1.1,
    // поэтому cloudflared падал и туннель умирал через 5 секунд.
    const prev = process.env.TUNNEL_TRANSPORT_PROTOCOL;
    process.env.TUNNEL_TRANSPORT_PROTOCOL = 'http2';

    try {
      this.#tunnel = await startTunnel({
        port,
        acceptCloudflareNotice: true,
        // никаких `protocol:` тут быть не должно
      });

      const url = await this.#tunnel.getURL();
      console.log(`[tunnel] URL получен: ${url}, ждём ${SETTLE_MS / 1000}с`);
      await new Promise(r => setTimeout(r, SETTLE_MS));
      console.log(`[tunnel] Туннель готов: ${url}`);
      return url;
    } catch (err) {
      await this.stop();
      throw err;
    } finally {
      // Возвращаем env в исходное состояние, чтобы не влиять
      // на другие провайдеры (ngrok и т.п.) в том же процессе.
      if (prev === undefined) delete process.env.TUNNEL_TRANSPORT_PROTOCOL;
      else process.env.TUNNEL_TRANSPORT_PROTOCOL = prev;
    }
  }

  async stop() {
    try { await this.#tunnel?.close(); } catch {}
    this.#tunnel = null;
  }
}