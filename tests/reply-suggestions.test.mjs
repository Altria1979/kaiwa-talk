import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';
import { parseReplySuggestions, replySuggestionPrompt } from '../server/reply-suggestions.ts';

const suggestions = [
  { text: '本を読みます。', reading: 'ほんを よみます。', meaning: '読書をします。', romaji: 'Hon o yomimasu.' },
  { text: '音楽を聴きます。', reading: 'おんがくを ききます。', meaning: '音楽を楽しみます。', romaji: 'Ongaku o kikimasu.' },
  { text: 'まだ決めていません。', reading: 'まだ きめていません。', meaning: 'まだ予定はありません。', romaji: 'Mada kimete imasen.' },
];
const parse = items => parseReplySuggestions(JSON.stringify({ suggestions: items }));

test('accepts new romaji and legacy suggestions without adding an absent field', () => {
  assert.deepEqual(parse(suggestions), suggestions);
  const legacy = suggestions.map(({ text, reading, meaning }) => ({ text, reading, meaning }));
  assert.deepEqual(parse(legacy), legacy);
  assert.deepEqual(parse([suggestions[0], legacy[1], suggestions[2]]), [suggestions[0], legacy[1], suggestions[2]]);
});

test('preserves bounded Hepburn macrons, apostrophes and digits while trimming surrounding spaces', () => {
  const romaji = "  Tōkyō e, shin'yū to 3-ji ni.  ";
  assert.equal(parse([{ ...suggestions[0], romaji }, ...suggestions.slice(1)])[0].romaji, romaji.trim());
  assert.equal(parse([{ ...suggestions[0], romaji: 'a'.repeat(480) }, ...suggestions.slice(1)])[0].romaji.length, 480);
});

test('rejects invalid optional romaji rather than silently dropping a malformed field', () => {
  for (const romaji of [null, 123, [], {}, '', ' ', 'はい', 'Hon を yomimasu.', '123', 'A\nB', '\nA', 'A\t', 'A\tB', 'a'.repeat(481)]) {
    assert.throws(() => parse([{ ...suggestions[0], romaji }, ...suggestions.slice(1)]), /reply suggestion/i);
  }
});

test('keeps strict schema, required fields, count and distinct text validation', () => {
  assert.throws(() => parse([{ ...suggestions[0], translation: 'extra' }, ...suggestions.slice(1)]), /fields/);
  assert.throws(() => parse([{ ...suggestions[0], meaning: undefined }, ...suggestions.slice(1)]), /field/);
  assert.throws(() => parse(suggestions.slice(1)), /three/);
  assert.throws(() => parse([suggestions[0], { ...suggestions[1], text: '本を 読みます!' }, suggestions[2]]), /distinct/);
  assert.throws(() => parseReplySuggestions(JSON.stringify({ suggestions, extra: true })), /three/);
  assert.throws(() => parseReplySuggestions(' '.repeat(4097)), /response limit/);
});

test('asks Japanese suggestions for contextual Hepburn with particles and four fields', () => {
  for (const learningLanguage of ['日本語', '日语', 'Japanese', 'ja']) {
    const [system, user] = replySuggestionPrompt({ ...DEFAULT_SETTINGS, learningLanguage }, [], '次は何をしますか？');
    assert.match(system.content, /Hepburn/);
    assert.match(system.content, /は→wa、へ→e、を→o/);
    assert.match(system.content, /按词加空格/);
    assert.match(system.content, /这四个非空字符串字段/);
    assert.equal(JSON.parse(user.content).latestCompanionReply, '次は何をしますか？');
  }
});

test('keeps non-Japanese suggestions on the original schema without romaji', () => {
  const [system] = replySuggestionPrompt({ ...DEFAULT_SETTINGS, learningLanguage: '英語' }, [], 'What are you doing?');
  assert.match(system.content, /非日语学习不要输出 romaji 字段/);
  assert.match(system.content, /这三个非空字符串字段/);
  assert.doesNotMatch(system.content, /"romaji":/);
});
