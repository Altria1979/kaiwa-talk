import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadingControls, ReplyReading } from '../src/components/reading-aids.tsx';
import { ReplySuggestions } from '../src/components/reply-suggestions.tsx';
import { I18nProvider } from '../src/i18n/provider.tsx';
import { controlsMessages } from '../src/i18n/messages/controls.ts';

const suggestion = { text: '本を読みます。', reading: 'ほんを よみます。', romaji: 'Hon o yomimasu.', meaning: '読書をします。' };
const render = (props, locale = 'ja') => renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(ReplyReading, { suggestion, ...props })));

test('Japanese reading aids independently support every visibility combination', () => {
  for (const showKana of [true, false]) {
    for (const showRomaji of [true, false]) {
      const markup = render({ japanese: true, showKana, showRomaji });
      assert.equal(markup.includes(suggestion.reading), showKana);
      assert.equal(markup.includes(suggestion.romaji), showRomaji);
      if (showKana && showRomaji) assert.ok(markup.indexOf(suggestion.romaji) < markup.indexOf(suggestion.reading));
      if (!showKana && !showRomaji) assert.equal(markup, '');
    }
  }
});

test('legacy Japanese history receives romaji while non-Japanese history retains its own reading', () => {
  const legacy = { ...suggestion, romaji: undefined };
  const markup = render({ suggestion: legacy, showKana: false, showRomaji: true });
  assert.match(markup, /hon&#x27;o yomimasu/);
  assert.doesNotMatch(markup, /ほんを/);
  const english = { text: 'I read books.', reading: 'ai reed buks', meaning: '読書をします。' };
  for (const japanese of [undefined, false]) {
    const result = render({ suggestion: english, japanese, showKana: false, showRomaji: false });
    assert.match(result, /ai reed buks/);
    assert.match(result, /読み方/);
    assert.doesNotMatch(result, /かな|ローマ字/);
  }
  const chinese = { text: '我喜欢音乐。', reading: 'wǒ xǐhuān yīnyuè', meaning: '音楽が好きです。' };
  assert.match(render({ suggestion: chinese, showKana: false, showRomaji: false }), /wǒ xǐhuān yīnyuè/);
  const kanjiOnly = { text: '大丈夫。', reading: 'だいじょうぶ。', meaning: '心配はいりません。' };
  assert.match(render({ suggestion: kanjiOnly, showKana: false, showRomaji: true }), /daijoubu/);
});

test('unconvertible legacy readings do not create a misleading romaji row', () => {
  const markup = render({ suggestion: { ...suggestion, reading: '本を よみます。', romaji: undefined }, showKana: true, showRomaji: true });
  assert.match(markup, /本を よみます。/);
  assert.doesNotMatch(markup, /reply-option-romaji/);
});

test('reading labels follow the interface language while Japanese learning content retains its language', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) {
    const markup = render({ japanese: true, showKana: true, showRomaji: true }, locale);
    const messages = controlsMessages[locale];
    assert.ok(markup.includes(`<p class="reply-option-romaji" lang="ja-Latn"><span lang="${locale}">${messages['controls.romaji']}</span>${suggestion.romaji}</p>`));
    assert.ok(markup.includes(`<p class="reply-option-reading" lang="ja"><span lang="${locale}">${messages['controls.kana']}</span>${suggestion.reading}</p>`));
    const controls = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(ReadingControls, {
      showKana: true, showRomaji: false, setShowKana() {}, setShowRomaji() {},
    })));
    for (const key of ['readingDisplay', 'showKana', 'showRomaji']) {
      assert.ok(controls.includes(`aria-label="${messages[`controls.${key}`]}"`));
    }
  }
});

test('reply meanings retain Japanese semantics across interface and learning languages', () => {
  for (const locale of ['ja', 'zh-CN', 'en']) {
    for (const learningLanguage of ['日本語', '英語']) {
      const option = learningLanguage === '日本語' ? suggestion : { ...suggestion, text: 'I read books.', reading: 'ai reed buks', romaji: undefined };
      const markup = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(ReplySuggestions, {
        value: { status: 'ready', messageId: 'message', suggestions: [option] },
        learningLanguage, characterName: 'Koharu',
        readingPreferences: { showKana: true, showRomaji: true, setShowKana() {}, setShowRomaji() {} },
        voiceEnabled: false, muted: false, userSpeaking: false, vadStatus: 'idle', busy: false, speech: null,
        onListen: async () => {}, onPractice: async () => {}, onSend: async () => {},
      })));
      assert.ok(markup.includes(`<p class="reply-option-meaning" lang="ja">${suggestion.meaning}</p>`));
      assert.ok(markup.includes(controlsMessages[locale]['controls.aiReplies']));
      assert.ok(markup.includes(option.text));
    }
  }
});
