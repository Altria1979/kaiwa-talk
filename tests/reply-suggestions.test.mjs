import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';
import { parseReplySuggestions, replySuggestionPrompt } from '../server/reply-suggestions.ts';

const suggestions = [
  { text: '本を読みます。', reading: 'ほんを よみます。', meaning: '我会看书。' },
  { text: '音楽を聴きます。', reading: 'おんがくを ききます。', meaning: '我会听音乐。' },
];
const legacySuggestions = suggestions.map((suggestion, index) => ({ ...suggestion, romaji: ['Hon o yomimasu.', 'Ongaku o kikimasu.'][index] }));
const parse = items => parseReplySuggestions(JSON.stringify({ suggestions: items }));

test('accepts three-field suggestions and optional romaji from legacy responses', () => {
  assert.deepEqual(parse(suggestions), suggestions);
  assert.deepEqual(parse(legacySuggestions), legacySuggestions);
  assert.deepEqual(parse([suggestions[0], legacySuggestions[1]]), [suggestions[0], legacySuggestions[1]]);
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
  for (const items of [[], suggestions.slice(1), [...suggestions, { text: 'まだ決めていません。', reading: 'まだ きめていません。', meaning: '我还没有决定。' }]]) {
    assert.throws(() => parse(items), /exactly two/);
  }
  assert.throws(() => parse([suggestions[0], { ...suggestions[1], text: '本を 読みます!' }]), /distinct/);
  assert.throws(() => parseReplySuggestions(JSON.stringify({ suggestions, extra: true })), /exactly two/);
  assert.throws(() => parseReplySuggestions(' '.repeat(4097)), /response limit/);
});

test('requests exactly two distinct replies with Chinese translations regardless of auxiliary language settings', () => {
  for (const supportLanguage of ['日本語', '中文', 'English']) {
    const [system] = replySuggestionPrompt({ ...DEFAULT_SETTINGS, supportLanguage }, [], '次は何をしますか？');
    assert.match(system.content, /恰好两个/);
    assert.match(system.content, /suggestions 必须恰好两项/);
    assert.match(system.content, /两个选项应表达不同/);
    assert.match(system.content, /meaning 始终使用简体中文/);
    assert.match(system.content, /自然、准确的简体中文翻译/);
    assert.match(system.content, /不要用日语改写原句/);
    assert.doesNotMatch(system.content, /meaning 始终用日语|辅助语言始终是日本語|恰好三项/);
  }
});

test('asks Japanese suggestions for kana and a three-field schema without romaji', () => {
  for (const learningLanguage of ['日本語', '日语', 'Japanese', 'ja']) {
    const [system, user] = replySuggestionPrompt({ ...DEFAULT_SETTINGS, learningLanguage }, [], '次は何をしますか？');
    assert.match(system.content, /完整假名读音/);
    assert.match(system.content, /平假名或片假名/);
    assert.match(system.content, /这三个非空字符串字段/);
    assert.doesNotMatch(system.content, /romaji|Hepburn|罗马音|这四个非空字符串字段/);
    assert.equal(JSON.parse(user.content).latestCompanionReply, '次は何をしますか？');
  }
});

test('keeps non-Japanese suggestions on the same three-field schema', () => {
  const [system] = replySuggestionPrompt({ ...DEFAULT_SETTINGS, learningLanguage: '英語' }, [], 'What are you doing?');
  assert.match(system.content, /常见发音辅助/);
  assert.match(system.content, /这三个非空字符串字段/);
  assert.match(system.content, /自然、准确的简体中文翻译/);
  assert.doesNotMatch(system.content, /romaji|Hepburn|这四个非空字符串字段/);
});
