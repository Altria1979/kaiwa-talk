import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATAR_EMOTIONS, isAvatarEmotion } from '../shared/avatar-emotion.ts';
import { AvatarEmotionDecoder } from '../server/avatar-emotion.ts';

function decode(chunks) {
  const decoder = new AvatarEmotionDecoder();
  const body = chunks.map(chunk => decoder.push(chunk)).join('');
  decoder.finish();
  return { body, emotion: decoder.emotion };
}

test('only the shared emotion whitelist passes runtime validation', () => {
  for (const emotion of AVATAR_EMOTIONS) assert.equal(isAvatarEmotion(emotion), true);
  for (const value of ['', 'Happy', 'unknown', null, undefined, {}, 1, ['happy']]) assert.equal(isAvatarEmotion(value), false);
});

test('emotion headers decode at every split including CRLF, then preserve the body exactly', () => {
  for (const emotion of AVATAR_EMOTIONS) {
    for (const newline of ['\n', '\r\n']) {
      const body = 'こんにちは。\n今日もよろしく！';
      const response = `[[emotion:${emotion}]]${newline}${body}`;
      const expected = { body, emotion };
      for (let index = 0; index <= response.length; index++) {
        assert.deepEqual(decode([response.slice(0, index), response.slice(index)]), expected, `${emotion}, split ${index}`);
      }
      assert.deepEqual(decode([...response]), expected);
    }
  }
});

test('ordinary replies stream as soon as the reserved prefix is ruled out', () => {
  for (const body of ['こんにちは。', '[メモ] こんにちは。', '[[emote:happy]]\nこんにちは。', '\nこんにちは。', '\uFEFF \n\tこんにちは。', `${' '.repeat(128)}こんにちは。`, '大丈夫です。\n[[emotion:happy]]']) {
    for (let index = 0; index <= body.length; index++) {
      assert.deepEqual(decode([body.slice(0, index), body.slice(index)]), { body, emotion: 'neutral' });
    }
  }
  const decoder = new AvatarEmotionDecoder();
  assert.equal(decoder.push('こ'), 'こ');
  assert.equal(decoder.push('んにちは'), 'んにちは');
});

test('bounded whitespace and BOM padding cannot leak a first control line at any split', () => {
  for (const padding of [' ', '\n', '\uFEFF', '\uFEFF \r\n\t', ' '.repeat(128)]) {
    for (const header of ['[[emotion:happy]]', '[[emotion:unknown]]', '[[emotion happy]]']) {
      const response = `${padding}${header}\r\nこんにちは。`;
      const expected = { body: 'こんにちは。', emotion: header === '[[emotion:happy]]' ? 'happy' : 'neutral' };
      for (let index = 0; index <= response.length; index++) {
        assert.deepEqual(decode([response.slice(0, index), response.slice(index)]), expected);
      }
      assert.deepEqual(decode([...response]), expected);
    }
  }
});

test('excessive initial padding fails before exposing any control text or buffering beyond the bound', () => {
  for (const padding of [' '.repeat(129), '\n'.repeat(129), '\uFEFF'.repeat(129)]) {
    const response = `${padding}[[emotion:happy]]\nこんにちは。`;
    for (let index = 0; index <= response.length; index++) {
      assert.throws(() => decode([response.slice(0, index), response.slice(index)]), /excessive leading whitespace/);
    }
    assert.throws(() => decode([...response]), /excessive leading whitespace/);
  }
});

test('unknown and malformed reserved control lines are stripped with neutral fallback', () => {
  const headers = ['[[emotion:joy]]', '[[emotion:Happy]]', '[[emotion:]]', '[[emotion happy]]', '[[emotions:happy]]', '[[emotion:happy]', '[[emotion:happy]] unwanted text', `[[emotion:${'x'.repeat(200)}]]`];
  for (const header of headers) {
    const response = `${header}\r\nこんにちは。`;
    for (let index = 0; index <= response.length; index++) {
      assert.deepEqual(decode([response.slice(0, index), response.slice(index)]), { body: 'こんにちは。', emotion: 'neutral' });
    }
    assert.deepEqual(decode([...response]), { body: 'こんにちは。', emotion: 'neutral' });
  }
});

test('partial prefixes and control-only responses never become display or speech text', () => {
  for (const response of ['', '[', '[[', '[[emot', '[[emotion', '[[emotion:happy', '[[emotion:happy]]', '[[emotion:happy]]\r', '[[emotion:happy]]\r\n', `[[emotion:${'x'.repeat(10_000)}`]) {
    assert.equal(decode([...response]).body, '');
  }
});

test('overlong control lines discard each chunk until newline without accumulating the line', () => {
  const decoder = new AvatarEmotionDecoder();
  assert.equal(decoder.push('[[emotion:'), '');
  for (let index = 0; index < 100; index++) assert.equal(decoder.push('x'.repeat(1000)), '');
  assert.equal(decoder.push(']]\nこんにちは。'), 'こんにちは。');
  assert.equal(decoder.emotion, 'neutral');
});
