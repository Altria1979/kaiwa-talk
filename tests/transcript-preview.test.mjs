import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/provider.tsx';
import { TranscriptPreview } from '../src/components/transcript-preview.tsx';

const render = (text, recognizing, locale = 'zh-CN') => renderToStaticMarkup(createElement(
  I18nProvider, { initialLocale: locale }, createElement(TranscriptPreview, { text, recognizing }),
));

test('interim Chinese or Japanese guesses never appear as spoken words', () => {
  for (const text of ['我还是', 'おや', 'おやすみ', '']) {
    const markup = render(text, true);
    assert.match(markup, /正在识别语音/);
    assert.match(markup, /role="status"/);
    if (text) assert.ok(!markup.includes(text));
  }
});

test('final Japanese appears once recognition completes and empty results remove the preview', () => {
  const markup = render('おやすみ。', false);
  assert.match(markup, /おやすみ。/);
  assert.doesNotMatch(markup, /正在识别语音|listening-dot/);
  assert.equal(render('', false), '');
});

test('recognition status follows the interface locale', () => {
  assert.match(render('我还是', true, 'ja'), /音声を認識中/);
  assert.match(render('我还是', true, 'en'), /Recognizing speech/);
});
