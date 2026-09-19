// core/tunnels/cloudflare-quick.js
import { startTunnel } from 'untun';

export class CloudflareQuickProvider {
  name = 'cloudflare-quick';
  #tunnel = null;

  async isAvailable() {
    // untun работает всегда, токен и аккаунт не нужны
    return true;
  }

  async start(port) {
    try {
        this.#tunnel = await startTunnel({
        port,
        acceptCloudflareNotice: true,
        });
        return await this.#tunnel.getURL();
    } catch (err) {
        await this.stop(); // убиваем созданный туннель
        throw err;
    }
  }

  async stop() {
    try {
      await this.#tunnel?.close();
    } catch {}
    this.#tunnel = null;
  }
}