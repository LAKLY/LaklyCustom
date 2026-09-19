// core/tunnels/index.js
import { CloudflareQuickProvider } from './cloudflare-quick.js';
import { NgrokProvider } from './ngrok.js';

const providers = [
  new CloudflareQuickProvider(),
  new NgrokProvider(),
];

export async function openTunnel(port) {
  for (const provider of providers) {
    if (!(await provider.isAvailable())) continue;
    try {
      const url = await provider.start(port);
      console.log(`[tunnel] ${provider.name} → ${url}`);
      return { url, provider: provider.name, instance: provider };
    } catch (err) {
      console.warn(`[tunnel] ${provider.name} failed:`, err.message);
    }
  }
  console.log('[tunnel] no provider available, using localhost');
  return { url: `http://localhost:${port}`, provider: 'local', instance: null };
}

export async function closeTunnel(instance) {
  if (!instance) return;
  try { await instance.stop(); } catch {}
}