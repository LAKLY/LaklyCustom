import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePlayerName,
  validateChatMessage,
  validateRoomName,
  validatePluginId,
  validateGameAction,
  LIMITS,
} from '../shared/validation.js';

test('validatePlayerName: принимает корректные имена', () => {
  assert.equal(validatePlayerName('Аня'), 'Аня');
  assert.equal(validatePlayerName('  Bob  '), 'Bob');
  assert.equal(validatePlayerName('a'.repeat(LIMITS.PLAYER_NAME_MAX)), 'a'.repeat(LIMITS.PLAYER_NAME_MAX));
});

test('validatePlayerName: отклоняет мусор', () => {
  assert.equal(validatePlayerName(''), null);
  assert.equal(validatePlayerName('   '), null);
  assert.equal(validatePlayerName('a'.repeat(LIMITS.PLAYER_NAME_MAX + 1)), null);
  assert.equal(validatePlayerName(123), null);
  assert.equal(validatePlayerName(null), null);
});

test('validateChatMessage: длинные сообщения отклоняются', () => {
  assert.equal(validateChatMessage('привет'), 'привет');
  assert.equal(validateChatMessage('a'.repeat(LIMITS.MESSAGE_MAX + 1)), null);
});

test('validateRoomName: fallback на дефолт', () => {
  assert.equal(validateRoomName('Моя игра'), 'Моя игра');
  assert.equal(validateRoomName(''), 'Lakly Room');
  assert.equal(validateRoomName('a'.repeat(100)), 'Lakly Room');
});

test('validatePluginId: только безопасные id', () => {
  assert.equal(validatePluginId('clicker'), 'clicker');
  assert.equal(validatePluginId('my-plugin_2'), 'my-plugin_2');
  assert.equal(validatePluginId('../etc/passwd'), null);
  assert.equal(validatePluginId('a b'), null);
  assert.equal(validatePluginId(''), null);
});

test('validateGameAction: безопасные имена действий', () => {
  assert.equal(validateGameAction('click'), 'click');
  assert.equal(validateGameAction('vote:yes'), 'vote:yes');
  assert.equal(validateGameAction('<script>'), null);
});