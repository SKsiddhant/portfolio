import test from 'node:test';
import assert from 'node:assert/strict';
import { t, reply, upcoming, typeKey, STRINGS } from '../src/logic.js';

test('translations exist for every key in every language', () => {
  for (const lang of ['hi', 'gu']) assert.deepEqual(Object.keys(STRINGS[lang]), Object.keys(STRINGS.en));
  assert.equal(t('xx', 'send'), 'Send');
});
test('chatbot matches topics in all languages and falls back', () => {
  assert.equal(reply('When are fees due?').topic, 'fees');
  assert.equal(reply('फीस कब?', 'hi').topic, 'fees');
  assert.equal(reply('પુસ્તકાલય', 'gu').topic, 'library');
  assert.equal(reply('xyzzy').topic, null);
  assert.match(reply('exam', 'hi').text, /परीक्षा/);
});
test('upcoming hides past notices and flags soon ones', () => {
  const now = new Date('2026-10-05');
  const r = upcoming([{ title: 'a', date: '2026-10-01' }, { title: 'b', date: '2026-10-20' }, { title: 'c', date: '2026-10-08' }], now);
  assert.deepEqual(r.map((n) => n.title), ['c', 'b']);
  assert.equal(r[0].soon, true); assert.equal(r[1].soon, false);
});
test('on-screen keyboard handles combining characters', () => {
  assert.equal(typeKey('ab', 'BACK'), 'a');
  assert.equal(typeKey('a', 'SPACE'), 'a ');
  assert.equal(typeKey('', 'क'), 'क');
});
