import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_READING_PREFERENCES, READING_PREFERENCES_STORAGE_KEY, loadReadingPreferences, parseReadingPreferences, saveReadingPreferences } from '../src/lib/reading-preferences.ts';

function installStorage(t, storage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
}

test('kana defaults to visible when stored data is absent or malformed', () => {
  for (const value of [null, '', 'broken', 'null', 'true', '42', '[]', '"hidden"', '{}']) {
    assert.deepEqual(parseReadingPreferences(value), DEFAULT_READING_PREFERENCES);
  }
});

test('kana preserves explicit false and ignores retired romaji preferences', () => {
  assert.deepEqual(parseReadingPreferences('{"showKana":false}'), { showKana: false });
  assert.deepEqual(parseReadingPreferences('{"showKana":"false","showRomaji":false}'), { showKana: true });
  for (const showKana of [true, false]) {
    for (const showRomaji of [true, false, 0, 'invalid']) {
      assert.deepEqual(parseReadingPreferences(JSON.stringify({ showKana, showRomaji })), { showKana });
    }
  }
});

test('both kana choices survive a storage round trip under the existing key', t => {
  const saved = new Map();
  installStorage(t, {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });
  assert.deepEqual(loadReadingPreferences(), DEFAULT_READING_PREFERENCES);
  assert.equal(READING_PREFERENCES_STORAGE_KEY, 'avatar-a.reading-preferences.v1');
  for (const showKana of [true, false]) {
    const preferences = { showKana };
    saveReadingPreferences(preferences);
    assert.deepEqual(JSON.parse(saved.get(READING_PREFERENCES_STORAGE_KEY)), preferences);
    assert.deepEqual(loadReadingPreferences(), preferences);
  }
});

test('legacy storage retains the saved kana choice and drops romaji on the next save', t => {
  const saved = new Map([[READING_PREFERENCES_STORAGE_KEY, '{"showKana":false,"showRomaji":true}']]);
  installStorage(t, {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });
  const preferences = loadReadingPreferences();
  assert.deepEqual(preferences, { showKana: false });
  saveReadingPreferences(preferences);
  assert.deepEqual(JSON.parse(saved.get(READING_PREFERENCES_STORAGE_KEY)), { showKana: false });
});

test('blocked storage falls back to defaults and does not reject changes', t => {
  installStorage(t, {
    getItem: () => { throw new Error('Storage is blocked'); },
    setItem: () => { throw new Error('Storage is blocked'); },
  });
  assert.deepEqual(loadReadingPreferences(), DEFAULT_READING_PREFERENCES);
  assert.doesNotThrow(() => saveReadingPreferences({ showKana: false }));
});
