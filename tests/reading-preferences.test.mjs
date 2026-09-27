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

test('reading aids default to visible when stored data is absent or malformed', () => {
  for (const value of [null, '', 'broken', 'null', 'true', '42', '[]', '"hidden"', '{}']) {
    assert.deepEqual(parseReadingPreferences(value), DEFAULT_READING_PREFERENCES);
  }
});

test('each aid preserves explicit false and defaults invalid fields independently', () => {
  assert.deepEqual(parseReadingPreferences('{"showKana":false}'), { showKana: false, showRomaji: true });
  assert.deepEqual(parseReadingPreferences('{"showKana":"false","showRomaji":false}'), { showKana: true, showRomaji: false });
  assert.deepEqual(parseReadingPreferences('{"showKana":false,"showRomaji":0}'), { showKana: false, showRomaji: true });
});

test('all four independent choices survive a storage round trip', t => {
  const saved = new Map();
  installStorage(t, {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });
  assert.deepEqual(loadReadingPreferences(), DEFAULT_READING_PREFERENCES);
  for (const showKana of [true, false]) {
    for (const showRomaji of [true, false]) {
      const preferences = { showKana, showRomaji };
      saveReadingPreferences(preferences);
      assert.deepEqual(JSON.parse(saved.get(READING_PREFERENCES_STORAGE_KEY)), preferences);
      assert.deepEqual(loadReadingPreferences(), preferences);
    }
  }
});

test('blocked storage falls back to defaults and does not reject changes', t => {
  installStorage(t, {
    getItem: () => { throw new Error('Storage is blocked'); },
    setItem: () => { throw new Error('Storage is blocked'); },
  });
  assert.deepEqual(loadReadingPreferences(), DEFAULT_READING_PREFERENCES);
  assert.doesNotThrow(() => saveReadingPreferences({ showKana: false, showRomaji: false }));
});
