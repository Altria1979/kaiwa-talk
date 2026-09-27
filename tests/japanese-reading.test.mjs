import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSuggestionRomaji } from '../shared/japanese-reading.ts';

const romanize = reading => getSuggestionRomaji({ reading });

test('prefers contextual romaji for new suggestions and does not invent kanji readings', () => {
  assert.equal(getSuggestionRomaji({ reading: 'わたしは がくせいです。', romaji: ' Watashi wa gakusei desu. ' }), 'Watashi wa gakusei desu.');
  assert.equal(romanize('私は 学生です。'), '');
  assert.equal(romanize('日本語'), '');
  assert.equal(romanize('Hello there.'), '');
  assert.equal(romanize(''), '');
});

test('transliterates legacy hiragana while preserving readable word boundaries and punctuation', () => {
  assert.equal(romanize('おんがくを きいて います。'), 'ongakuo kiite imasu.');
  assert.equal(romanize('まだ、 なにもして いません。'), 'mada, nanimoshite imasen.');
  assert.equal(romanize('  ほんを　 よみます！  '), "hon'o yomimasu!");
  assert.equal(romanize('はい。 いいえ？'), 'hai. iie?');
});

test('recognizes explicitly separated particles without rewriting syllables inside words', () => {
  assert.equal(romanize('わたし は えき へ いきます。'), 'watashi wa eki e ikimasu.');
  assert.equal(romanize('ほん を よみます。'), 'hon o yomimasu.');
  assert.equal(romanize('はな と へや'), 'hana to heya');
  assert.equal(romanize('こんにちは、こんばんは。'), 'konnichiwa,konbanwa.');
  // Kana alone does not tell us whether an unseparated は is a particle.
  assert.equal(romanize('わたしは'), 'watashiha');
});

test('handles yoon, loanword digraphs, sokuon and syllabic n disambiguation', () => {
  assert.equal(romanize('きょう ぎゅうにゅう しゃしん ちょっと'), 'kyou gyuunyuu shashin chotto');
  assert.equal(romanize('がっこう まっちゃ ざっし ベッド'), 'gakkou matcha zasshi beddo');
  assert.equal(romanize('しんよう ほんや かんい こんにゃく'), "shin'you hon'ya kan'i konnyaku");
  assert.equal(romanize('ティー シェフ ファイル ヴァイオリン'), 'tii shefu fairu vaiorin');
});

test('normalizes katakana, half-width kana and combining marks before handling long vowels', () => {
  assert.equal(romanize('コーヒーと ケーキ'), 'koohiito keeki');
  assert.equal(romanize('ｺｰﾋｰ と ﾁｮｺﾚｰﾄ'), 'koohii to chokoreeto');
  assert.equal(romanize('ｶﾞｯﾂﾎﾟｰｽﾞ'), 'gattsupoozu');
  assert.equal(romanize('か\u3099っこう'), 'gakkou');
  assert.equal(romanize('スーパー・マーケット'), 'suupaa maaketto');
});

test('omits unsupported readings rather than returning a partly fabricated pronunciation', () => {
  assert.equal(romanize('これは本です。'), '');
  assert.equal(romanize('ーあ'), '');
  assert.equal(romanize('いろゝ'), '');
});
