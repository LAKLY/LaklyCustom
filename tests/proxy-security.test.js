// tests/proxy-security.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { startServer } from '../core/server.js';

let srv = null;
let pluginDataDir = null;

before(async () => {
  pluginDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lakly-test-'));
  srv = await startServer({ port: 0, pluginDataDir });
});

after(async () => {
  try { await srv?.close?.(); } catch {}
  if (pluginDataDir) {
    await fs.rm(pluginDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

const base = () => `http://127.0.0.1:${srv.port}`;

test('proxy/scan: локальный запрос проходит', async () => {
  const r = await fetch(`${base()}/api/proxy/scan`);
  assert.equal(r.status, 200);
});

test('proxy/scan: запрос из Cloudflare-туннеля → 403', async () => {
  const r = await fetch(`${base()}/api/proxy/scan`, {
    headers: { 'cf-connecting-ip': '203.0.113.42' },
  });
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.error, 'forbidden');
});

test('proxy/scan: запрос через upstream-прокси → 403', async () => {
  const r = await fetch(`${base()}/api/proxy/scan`, {
    headers: { 'x-forwarded-for': '203.0.113.42' },
  });
  assert.equal(r.status, 403);
});

test('proxy/check: запрос из Cloudflare-туннеля → 403', async () => {
  const r = await fetch(`${base()}/api/proxy/check`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.42',
    },
    body: JSON.stringify({ port: 3000 }),
  });
  assert.equal(r.status, 403);
});

test('proxy/check: локальный запрос не блокируется', async () => {
  const r = await fetch(`${base()}/api/proxy/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ port: 1 }),  // заведомо закрытый порт
  });
  // 200 — норм (ok:false, "Порт закрыт"), главное не 403
  assert.notEqual(r.status, 403);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, false);
});

test('proxy/check: пустой CF-заголовок не считается внешним', async () => {
  // Пустой заголовок не должен ломать проверку (это edge case)
  const r = await fetch(`${base()}/api/proxy/check`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '',
    },
    body: JSON.stringify({ port: 1 }),
  });
  // Пустой XFF → не блокируем
  assert.notEqual(r.status, 403);
});