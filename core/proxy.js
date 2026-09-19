// core/proxy.js
import net from 'node:net';
import httpProxy from 'http-proxy';

const KNOWN_PORTS = {
  3000: 'Node/Next',
  3001: 'Next (alt)',
  4200: 'Angular',
  5000: 'Flask/Node',
  5173: 'Vite',
  5174: 'Vite (alt)',
  5500: 'Live Server',
  8000: 'Django/Python',
  8080: 'Webpack/Tomcat',
  8888: 'Jupyter',
  9000: 'PHP-FPM/Node',
};

export function describePort(port) {
  return KNOWN_PORTS[port] || null;
}

const TCP_TIMEOUT_MS = 1200;
const PROBE_TIMEOUT_MS = 2500;
const HTTP_TIMEOUT_MS = 20_000;

export function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try { sock.connect(port, host); } catch { finish(false); }
  });
}

export async function probePort(port, host = '127.0.0.1') {
  const url = `http://${host}:${port}/`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'user-agent': 'LaklyCustom-probe/1.0' },
    });
    let title = '';
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        const buf = await res.text();
        const m = buf.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (m) title = m[1].trim().slice(0, 120);
      }
    } catch { /* ignore */ }
    return {
      ok: true,
      status: res.status,
      server: res.headers.get('server') || '',
      contentType: res.headers.get('content-type') || '',
      title,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function scanPorts(ports = Object.keys(KNOWN_PORTS).map(Number)) {
  const results = await Promise.all(
    ports.map(async (port) => ({ port, open: await isPortOpen(port) }))
  );
  return results.filter(r => r.open).map(r => ({
    port: r.port,
    hint: describePort(r.port),
  }));
}

export function createProxyServer() {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    timeout: HTTP_TIMEOUT_MS,
    proxyTimeout: HTTP_TIMEOUT_MS,
  });

  proxy.on('error', (err, req, res) => {
    const code = err?.code || err?.message || 'proxy error';
    console.error(`[proxy] ${code} ${req?.url || ''}`);

    // WebSocket / raw socket — просто закрываем соединение без HTTP-ответа
    if (!res || typeof res.writeHead !== 'function') {
      try { res?.destroy?.(); } catch {}
      return;
    }

    // Соединение уже закрыто или ответ уже отправлен
    if (res.headersSent || res.writableEnded || res.destroyed) {
      try { res.end?.(); } catch {}
      return;
    }

    // 500, а не 502: Cloudflare Quick Tunnel перехватывает 502/503/504
    // и подменяет их своей страницей. 500 проходит как есть.
    res.writeHead(500, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(buildErrorHtml(code));
  });

  return proxy;
}

function buildErrorHtml(code) {
  const hint =
    code === 'ECONNREFUSED' ? 'Порт закрыт — приложение, скорее всего, не запущено или остановилось.'
    : code === 'ECONNRESET' ? 'Соединение сброшено. Dev-сервер закрыл связь до ответа.'
    : code === 'ETIMEDOUT'  ? 'Локальный сервер не ответил за отведённое время.'
    : 'LaklyCustom не смог установить соединение с локальным портом.';

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Локальный сервер не отвечает</title>
<style>
  html,body{height:100%;margin:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#0A0E27;color:#E6EAF5;display:flex;align-items:center;
       justify-content:center;padding:24px;text-align:center}
  .card{max-width:560px;padding:32px;background:#0F1430;border:1px solid rgba(0,245,255,.14);border-radius:14px}
  h1{color:#FF006E;font-size:26px;margin:0 0 14px;font-weight:500;letter-spacing:.3px}
  p{color:#8A93B5;line-height:1.6;margin:10px 0;font-size:15px}
  code{background:#141A3A;color:#00F5FF;padding:2px 7px;border-radius:4px;
       font-family:ui-monospace,Consolas,monospace;font-size:13px}
  button{margin-top:20px;padding:10px 22px;background:transparent;color:#00F5FF;
         border:1px solid #00F5FF;border-radius:8px;font-size:14px;font-weight:500;
         cursor:pointer;transition:background .15s,color .15s}
  button:hover{background:#00F5FF;color:#0A0E27}
  .code{margin-top:14px;font-size:12px;color:#8A93B5}
</style></head><body>
<div class="card">
  <h1>Локальный сервер не отвечает</h1>
  <p>${hint}</p>
  <p>Проверьте, что dev-сервер запущен и слушает <code>127.0.0.1</code>.</p>
  <p>Если порт открыт, попробуйте запустить сервер с флагом <code>--host 0.0.0.0</code>.</p>
  <button onclick="location.reload()">Обновить страницу</button>
  <div class="code">Код: ${code}</div>
</div></body></html>`;
}