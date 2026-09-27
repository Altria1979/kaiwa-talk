import type { ReplySuggestion } from './protocol.js';

const KANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゕ: 'ka', ゖ: 'ke',
};

const DIGRAPHS: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', きぇ: 'kye',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', にぇ: 'nye',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', ひぇ: 'hye',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', みぇ: 'mye',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', りぇ: 'rye',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo', ぎぇ: 'gye',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', びぇ: 'bye',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo', ぴぇ: 'pye',
  いぇ: 'ye', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  くぁ: 'kwa', くぃ: 'kwi', くぇ: 'kwe', くぉ: 'kwo', くゎ: 'kwa',
  ぐぁ: 'gwa', ぐぃ: 'gwi', ぐぇ: 'gwe', ぐぉ: 'gwo', ぐゎ: 'gwa',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  てぃ: 'ti', てゅ: 'tyu', とぅ: 'tu',
  でぃ: 'di', でゅ: 'dyu', どぅ: 'du',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  ふゃ: 'fya', ふゅ: 'fyu', ふょ: 'fyo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  ゔゃ: 'vya', ゔゅ: 'vyu', ゔょ: 'vyo',
};

const PUNCTUATION: Record<string, string> = { '、': ',', '。': '.', '・': ' ' };

/**
 * Prefer the contextual reading generated with a suggestion. Older suggestions
 * only have kana, so transliterate those without guessing kanji pronunciations.
 * That fallback preserves existing word boundaries and doubles prolonged vowels.
 * Without a dictionary, unspaced は/へ cannot reliably be identified as particles;
 * only separate particle tokens and the two conventional greetings are adjusted.
 */
export function getSuggestionRomaji(suggestion: Pick<ReplySuggestion, 'reading' | 'romaji'>): string {
  if (typeof suggestion.romaji === 'string' && suggestion.romaji.trim()) return suggestion.romaji.trim();
  const reading = suggestion.reading.normalize('NFKC')
    .replace(/[ァ-ヶ]/gu, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60))
    .replace(/ヷ/gu, 'ゔぁ').replace(/ヸ/gu, 'ゔぃ').replace(/ヹ/gu, 'ゔぇ').replace(/ヺ/gu, 'ゔぉ');
  if (!/[ぁ-ゖ]/u.test(reading)) return '';

  const words = reading.split(/(\s+|[、。,.!?;:()「」『』])/u);
  const converted: string[] = [];
  for (const word of words) {
    if (word === 'は') { converted.push('wa'); continue; }
    if (word === 'へ') { converted.push('e'); continue; }
    if (word === 'こんにちは') { converted.push('konnichiwa'); continue; }
    if (word === 'こんばんは') { converted.push('konbanwa'); continue; }

    let result = '';
    for (let index = 0; index < word.length; index++) {
      const kana = word[index];
      const pair = DIGRAPHS[word.slice(index, index + 2)];
      if (pair) { result += pair; index++; continue; }
      if (kana === 'っ') {
        const next = DIGRAPHS[word.slice(index + 1, index + 3)] ?? KANA[word[index + 1]];
        // Hepburn uses "tch" rather than "cch" for a doubled "ch" sound.
        result += next?.startsWith('ch') ? 't' : next && /^[bcdfghjkmprstvwz]/u.test(next) ? next[0] : "'";
      } else if (kana === 'ん') {
        const next = DIGRAPHS[word.slice(index + 1, index + 3)] ?? KANA[word[index + 1]];
        result += next && /^[aeiouy]/u.test(next) ? "n'" : 'n';
      } else if (kana === 'ー') {
        const vowel = result.match(/[aeiou]$/u)?.[0];
        if (!vowel) return '';
        result += vowel;
      } else if (KANA[kana]) {
        result += KANA[kana];
      } else if (PUNCTUATION[kana]) {
        result += PUNCTUATION[kana];
      } else if (/^[\p{Script=Latin}\p{N}\s'’".,!?;:()\-「」『』]$/u.test(kana)) {
        result += kana;
      } else {
        return '';
      }
    }
    converted.push(result);
  }
  return converted.join('').replace(/\s+/gu, ' ').trim();
}
