// core/tunnels/ngrok.js
let ngrok = null;
try { ngrok = (await import('ngrok')).default; } catch {}

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