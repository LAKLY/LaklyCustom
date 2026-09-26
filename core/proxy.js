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
    res.end(buildErrorHtml(code, pickLang(req)));
  });

  return proxy;
}

// ─── Мини-словарь для HTML страницы ошибки ──────────────────
// Специально не тянем shared/locales — HTML живёт вне клиента,
// а перевод нужен только 8 строк. Хардкодом тут дешевле.
const PROXY_ERROR_STRINGS = {
  ru: {
    title: 'Локальный сервер не отвечает',
    econnrefused: 'Порт закрыт — приложение, скорее всего, не запущено.',
    econnreset: 'Соединение сброшено. Dev-сервер закрыл связь.',
    etimedout: 'Локальный сервер не ответил за отведённое время.',
    other: 'LaklyCustom не смог подключиться к локальному порту.',
    check_running: 'Проверьте, что dev-сервер запущен и слушает <code>127.0.0.1</code>.',
    host_flag: 'Если порт открыт, попробуйте запустить его с флагом <code>--host 0.0.0.0</code>.',
    reload: 'Обновить',
    code: 'Код',
  },
  en: {
    title: 'Local server is not responding',
    econnrefused: 'Port is closed — the app is probably not running.',
    econnreset: 'Connection reset. The dev server closed the connection.',
    etimedout: 'Local server did not respond in time.',
    other: 'LaklyCustom could not connect to the local port.',
    check_running: 'Check that the dev server is running and listening on <code>127.0.0.1</code>.',
    host_flag: 'If the port is open, try starting it with <code>--host 0.0.0.0</code>.',
    reload: 'Reload',
    code: 'Code',
  },
};

function pickLang(req) {
  try {
    const url = new URL(req?.url || '/', 'http://localhost');
    const qp = url.searchParams.get('lang');
    if (qp === 'en' || qp === 'ru') return qp;
  } catch {}
  const al = String(req?.headers?.['accept-language'] || '').toLowerCase();
  if (al.startsWith('ru')) return 'ru';
  return 'en';
}

function buildErrorHtml(code, lang = 'en') {
  const s = PROXY_ERROR_STRINGS[lang] || PROXY_ERROR_STRINGS.en;

  const hint =
    code === 'ECONNREFUSED' ? s.econnrefused
    : code === 'ECONNRESET' ? s.econnreset
    : code === 'ETIMEDOUT'  ? s.etimedout
    : s.other;

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${s.title}</title>
<style>
  html,body{height:100%;margin:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#0D0C12;color:#F4F1F7;
    display:flex;align-items:center;justify-content:center;
    padding:24px;text-align:center;
    background-image:radial-gradient(ellipse 700px 500px at 50% 0%,rgba(229,56,79,.12),transparent 60%);
  }
  .card{max-width:520px;padding:40px 32px;background:#1A1724;border:1px solid #2B2635;border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
  h1{color:#F05068;font-size:24px;margin:0 0 14px;font-weight:500;letter-spacing:-.2px}
  p{color:#B0A8BE;line-height:1.65;margin:12px 0;font-size:15px}
  code{background:#0D0C12;color:#63D8FF;padding:3px 8px;border-radius:5px;font-family:ui-monospace,Consolas,monospace;font-size:13px}
  button{margin-top:22px;padding:12px 26px;background:#E5384F;color:#fff;border:1px solid #E5384F;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;box-shadow:0 8px 28px rgba(229,56,79,.35)}
  button:hover{background:#F05068;transform:translateY(-1px);box-shadow:0 12px 36px rgba(229,56,79,.5)}
  .code{margin-top:16px;font-size:11.5px;color:#6F687D;font-family:ui-monospace,Consolas,monospace}
</style></head><body>
<div class="card">
  <h1>${s.title}</h1>
  <p>${hint}</p>
  <p>${s.check_running}</p>
  <p>${s.host_flag}</p>
  <button onclick="location.reload()">${s.reload}</button>
  <div class="code">${s.code}: ${code}</div>
</div></body></html>`;
}