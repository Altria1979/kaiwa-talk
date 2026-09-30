import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadingControls, ReplyReading } from '../src/components/reading-aids.tsx';
import { ReplySuggestions } from '../src/components/reply-suggestions.tsx';
import { I18nProvider } from '../src/i18n/provider.tsx';
import { controlsMessages } from '../src/i18n/messages/controls.ts';

const suggestion = { text: '本を読みます。', reading: 'ほんを よみます。', romaji: 'Hon o yomimasu.', meaning: '読書をします。' };
const options = [
  { ...suggestion, meaning: '我读书。' },
  { text: '音楽を聴きます。', reading: 'おんがくを ききます。', romaji: 'Ongaku o kikimasu.', meaning: '我听音乐。' },
  { text: 'まだ決めていません。', reading: 'まだ きめていません。', meaning: '我还没决定。' },
];
const renderComponent = (component, props, locale = 'ja') => renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(component, props)));
const renderReading = props => renderComponent(ReplyReading, { suggestion, ...props });
const renderSuggestions = (props = {}, locale = 'ja') => renderComponent(ReplySuggestions, {
  value: { status: 'ready', messageId: 'message', suggestions: options, meaningLanguage: 'zh-CN' },
  learningLanguage: '日本語',
  readingPreferences: { showKana: true, setShowKana() {} },
  busy: false, speech: null, onListen: async () => {}, onSend: async () => {},
  ...props,
}, locale);

test('Japanese replies only show optional kana, including historical suggestions with romaji', () => {
  for (const saved of [suggestion, { ...suggestion, romaji: undefined }, { text: '大丈夫。', reading: 'だいじょうぶ。', meaning: '没关系。' }]) {
    for (const showKana of [true, false]) {
      const markup = renderReading({ suggestion: saved, showKana });
      assert.equal(markup.includes(saved.reading), showKana);
      assert.doesNotMatch(markup, /reply-option-romaji|ja-Latn|Hon o yomimasu/);
      if (!showKana) assert.equal(markup, '');
    }
  }
});

test('non-Japanese suggestions retain pronunciation when kana is hidden', () => {
  const english = { text: 'I read books.', reading: 'ai reed buks', meaning: '我读书。' };
  for (const japanese of [undefined, false]) {
    const markup = renderReading({ suggestion: english, japanese, showKana: false });
    assert.match(markup, /ai reed buks/);
    assert.match(markup, /読み方/);
    assert.doesNotMatch(markup, /かな|ローマ字/);
  }
  const chinese = { text: '我喜欢音乐。', reading: 'wǒ xǐhuān yīnyuè', meaning: '音楽が好きです。' };
  assert.match(renderReading({ suggestion: chinese, showKana: false }), /wǒ xǐhuān yīnyuè/);
});

test('reading labels follow the interface language with only a kana switch', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) {
    const messages = controlsMessages[locale];
    const markup = renderComponent(ReplyReading, { suggestion, japanese: true, showKana: true }, locale);
    assert.ok(markup.includes(`<p class="reply-option-reading" lang="ja"><span lang="${locale}">${messages['controls.kana']}</span>${suggestion.reading}</p>`));
    const controls = renderComponent(ReadingControls, { showKana: true, setShowKana() {} }, locale);
    for (const key of ['readingDisplay', 'showKana']) assert.ok(controls.includes(`aria-label="${messages[`controls.${key}`]}"`));
    assert.equal((controls.match(/role="switch"/g) ?? []).length, 1);
    assert.doesNotMatch(controls, /romaji|ローマ字|罗马音/i);
  }
});

test('reply meanings preserve their saved language across interface and learning languages', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) for (const learningLanguage of ['日本語', '英語']) {
    const option = learningLanguage === '日本語' ? suggestion : { ...suggestion, text: 'I read books.', reading: 'ai reed buks', romaji: undefined };
    const markup = renderSuggestions({ value: { status: 'ready', messageId: 'message', suggestions: [option] }, learningLanguage }, locale);
    assert.ok(markup.includes(`<p class="reply-option-meaning" lang="ja">${suggestion.meaning}</p>`));
    assert.ok(markup.includes(controlsMessages[locale]['controls.aiReplies']));
    assert.ok(markup.includes(option.text));
  }
});

test('two replies keep kana and Chinese meaning together, with translation visible when kana is hidden', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) for (const showKana of [true, false]) {
    const markup = renderSuggestions({ readingPreferences: { showKana, setShowKana() {} } }, locale);
    assert.equal((markup.match(/class="reply-option"/g) ?? []).length, 2);
    const details = [...markup.matchAll(/<div class="reply-option-details">(.*?)<\/div>/g)].map(match => match[1]);
    assert.equal(details.length, 2);
    for (const [index, option] of options.slice(0, 2).entries()) {
      assert.ok(markup.includes(option.text));
      assert.ok(details[index].includes(`<p class="reply-option-meaning" lang="zh-CN">${option.meaning}</p>`));
      assert.equal(details[index].includes(option.reading), showKana);
      assert.ok(!markup.includes(option.romaji));
    }
    assert.ok(!markup.includes(options[2].text));
    assert.ok(!markup.includes(options[2].meaning));
  }
});

test('reply actions only offer sample playback and sending, preserving busy state', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) for (const busy of [false, true]) {
    const markup = renderSuggestions({ busy }, locale);
    const actions = [...markup.matchAll(/<div class="reply-option-actions">(.*?)<\/div>/g)].map(match => match[1]);
    assert.equal(actions.length, 2);
    for (const [index, buttons] of actions.entries()) {
      assert.equal((buttons.match(/<button/g) ?? []).length, 2);
      assert.equal((buttons.match(/disabled=""/g) ?? []).length, busy ? 2 : 0);
      assert.ok(buttons.includes(controlsMessages[locale]['controls.listenSample']));
      assert.ok(buttons.includes(controlsMessages[locale]['controls.sendReplyLabel'].replace('{text}', options[index].text)));
    }
    assert.doesNotMatch(markup, /is-practicing|is-selected|朗读|読み上げ|Read aloud|reply-sample-hint/);
  }
});

test('sample playback still exposes cancellation, stopping and status feedback', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) for (const status of ['loading', 'playing']) {
    const markup = renderSuggestions({ speech: { messageId: 'message', index: 0, status } }, locale);
    const messages = controlsMessages[locale];
    assert.ok(markup.includes(messages[status === 'loading' ? 'controls.cancelSample' : 'controls.stopSample'].replace('{text}', options[0].text)));
    assert.ok(markup.includes(`<p class="reply-sample-hint" role="status">${messages[status === 'loading' ? 'controls.samplePreparingHint' : 'controls.samplePlayingHint']}</p>`));
    assert.equal((markup.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.doesNotMatch(markup, /朗读|読み上げ|Read aloud/);
  }
});

test('past replies remain expanded as references without romaji or current-turn controls', () => {
  const markup = renderSuggestions({ readOnly: true }, 'zh-CN');
  for (const option of options.slice(0, 2)) {
    assert.ok(markup.includes(option.text));
    assert.ok(markup.includes(option.meaning));
    assert.ok(markup.includes(option.reading));
    assert.ok(!markup.includes(option.romaji));
  }
  assert.equal((markup.match(/class="reply-option"/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /<button|<details|reply-sample-hint|reply-suggestions-tools/);
});

test('Japanese history without romaji keeps its spoken language even with kana hidden', () => {
  const saved = [
    { text: 'はい、元気です。', reading: 'はい げんき です', meaning: '是的，我很好。' },
    { text: '大丈夫。', reading: 'だいじょうぶ。', meaning: '没关系。' },
  ];
  for (const locale of ['zh-CN', 'en']) for (const showKana of [true, false]) {
    const markup = renderSuggestions({ readOnly: true, learningLanguage: undefined,
      value: { status: 'ready', messageId: 'past', suggestions: saved, meaningLanguage: 'zh-CN' },
      readingPreferences: { showKana, setShowKana() {} },
    }, locale);
    for (const option of saved) assert.ok(markup.includes(`<p class="reply-option-text" lang="ja">${option.text}</p>`));
  }
});
