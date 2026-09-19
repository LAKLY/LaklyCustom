import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../shared/rate-limit.js';

test('RateLimiter: счётчик в пределах лимита', () => {
  const rl = new RateLimiter();
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check('k', { max: 5, windowMs: 1000 }), true);
  }
  assert.equal(rl.check('k', { max: 5, windowMs: 1000 }), false);
});

test('RateLimiter: разные ключи независимы', () => {
  const rl = new RateLimiter();
  rl.check('a', { max: 1, windowMs: 1000 });
  assert.equal(rl.check('a', { max: 1, windowMs: 1000 }), false);
  assert.equal(rl.check('b', { max: 1, windowMs: 1000 }), true);
});

test('RateLimiter: reset очищает ключ', () => {
  const rl = new RateLimiter();
  rl.check('a', { max: 1, windowMs: 1000 });
  rl.reset('a');
  assert.equal(rl.check('a', { max: 1, windowMs: 1000 }), true);
});