import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as React from 'react';
import { translate } from '../src/i18n/messages.ts';

let rendering;
let locale = 'zh-CN';
let nextId = 0;

mock.module('react', { exports: {
  ...React,
  useState(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.slots[index], value => {
      owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value;
    }];
  },
  useId: () => rendering.id,
} });
mock.module('../src/i18n/provider.tsx', { exports: { useI18n: () => ({
  locale, t: (key, params) => translate(locale, key, params), formatNumber: String,
}) } });
const { ReplySuggestions } = await import('../src/components/reply-suggestions.tsx');

const suggestions = [
  { text: '本を読みます。', reading: 'ほんを よみます。', meaning: '我会看书。' },
  { text: '音楽を聴きます。', reading: 'おんがくを ききます。', meaning: '我会听音乐。' },
];
const ready = { status: 'ready', messageId: 'reply', suggestions, meaningLanguage: 'zh-CN' };
const children = node => React.isValidElement(node) ? React.Children.toArray(node.props.children) : [];
function find(node, predicate) {
  if (React.isValidElement(node) && predicate(node)) return node;
  for (const child of children(node)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : children(node).map(text).join('');
const byClass = className => node => node.props.className === className;

function harness(initialProps = {}) {
  const owner = { cursor: 0, slots: [], id: `reply-options-${nextId++}` };
  let props = {
    value: ready, learningLanguage: '日本語', readingPreferences: { showKana: true, setShowKana() {} },
    busy: false, speech: null, onListen: async () => {}, onSend: async () => {}, ...initialProps,
  };
  return (patch = {}) => {
    props = { ...props, ...patch };
    owner.cursor = 0;
    rendering = owner;
    return ReplySuggestions(props);
  };
}

beforeEach(() => { locale = 'zh-CN'; });

test('reply help starts collapsed with one accessible toggle and opens only on request', () => {
  const render = harness();
  let tree = render();
  const help = find(tree, byClass('reply-help-toggle'));
  const content = find(tree, byClass('reply-suggestions-content'));
  const contentId = content.props.id;
  assert.equal(tree.props['aria-label'], translate(locale, 'controls.replyHelp'));
  assert.equal(content.props.hidden, true);
  assert.equal(help.props['aria-expanded'], false);
  assert.equal(help.props['aria-controls'], contentId);
  assert.equal(find(tree, byClass('reply-suggestions-header')), undefined);
  assert.equal(find(tree, byClass('mobile-reply-help')), undefined);
  help.props.onClick();
  tree = render();
  assert.equal(find(tree, byClass('reply-help-toggle')).props['aria-expanded'], true);
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, false);
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.id, contentId);
  assert.ok(text(find(tree, byClass('reply-suggestions-content'))).includes(suggestions[0].text));
  assert.ok(find(find(tree, byClass('reply-suggestions-content')), byClass('reply-suggestions-tools')));
  find(tree, byClass('reply-help-toggle')).props.onClick();
  tree = render();
  assert.equal(find(tree, byClass('reply-help-toggle')).props['aria-expanded'], false);
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, true);
  assert.notEqual(find(harness()(), byClass('reply-suggestions-content')).props.id, contentId);
});

test('loading and unavailable updates never open reply help automatically', () => {
  const render = harness({ value: { status: 'loading', messageId: 'reply', suggestions: [] } });
  let tree = render();
  const contentId = find(tree, byClass('reply-suggestions-content')).props.id;
  assert.equal(text(find(tree, node => node.props.role === 'status')), translate(locale, 'controls.repliesLoading'));
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, true);
  tree = render({ value: { status: 'unavailable', messageId: 'reply', suggestions: [] } });
  assert.equal(text(find(tree, node => node.props.role === 'status')), translate(locale, 'controls.repliesEmpty'));
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, true);
  tree = render({ value: ready });
  assert.equal(find(tree, byClass('reply-help-toggle')).props['aria-expanded'], false);
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, true);
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.id, contentId);
  assert.equal(find(tree, byClass('reply-help-toggle')).props['aria-controls'], contentId);
  assert.ok(find(tree, byClass('reply-options')));
});

test('requested help stays open while replies arrive and become read-only', () => {
  const render = harness({ value: { status: 'loading', messageId: 'reply', suggestions: [] } });
  find(render(), byClass('reply-help-toggle')).props.onClick();
  for (const patch of [{ value: ready }, { readOnly: true }]) {
    const tree = render(patch);
    assert.equal(find(tree, byClass('reply-help-toggle')).props['aria-expanded'], true);
    assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, false);
  }
  const tree = render();
  assert.equal(find(tree, byClass('reply-option-actions')), undefined);
  assert.equal(find(tree, byClass('reply-suggestions-tools')), undefined);
  assert.equal(find(tree, byClass('reply-sample-hint')), undefined);
});

test('reply help is localized and saved references are opt-in without current-turn actions', () => {
  for (const language of ['zh-CN', 'ja', 'en']) {
    locale = language;
    const current = harness()();
    assert.equal(text(find(current, byClass('reply-help-toggle'))), translate(language, 'controls.replyHelp'));
    assert.equal(current.props['aria-label'], translate(language, 'controls.replyHelp'));
    const render = harness({ readOnly: true, speech: { messageId: 'reply', index: 0, status: 'playing' } });
    let saved = render();
    assert.equal(find(saved, byClass('reply-suggestions-content')).props.hidden, true);
    const toggle = find(saved, byClass('reply-help-toggle'));
    assert.equal(toggle.props['aria-expanded'], false);
    assert.equal(text(toggle), translate(language, 'controls.replyHelp'));
    toggle.props.onClick();
    saved = render();
    assert.equal(find(saved, byClass('reply-suggestions-content')).props.hidden, false);
    assert.equal(find(saved, byClass('reply-option-actions')), undefined);
    assert.equal(find(saved, byClass('reply-suggestions-tools')), undefined);
    assert.equal(find(saved, byClass('reply-sample-hint')), undefined);
    assert.ok(text(saved).includes(suggestions[0].text));
  }
});

test('opened help preserves listen and send callbacks, busy actions, and playback state', () => {
  const listened = [];
  const sent = [];
  const render = harness({ onListen: async index => { listened.push(index); }, onSend: async index => { sent.push(index); } });
  const initial = render();
  assert.deepEqual(listened, []);
  assert.deepEqual(sent, []);
  find(initial, byClass('reply-help-toggle')).props.onClick();
  let tree = render();
  const optionActions = children(find(tree, byClass('reply-options'))).map(option => children(find(option, byClass('reply-option-actions'))));
  optionActions[0][0].props.onClick();
  optionActions[1][1].props.onClick();
  assert.deepEqual(listened, [0]);
  assert.deepEqual(sent, [1]);
  tree = render({ busy: true, speech: { messageId: 'reply', index: 0, status: 'loading' } });
  const firstActions = children(find(tree, byClass('reply-option-actions')));
  assert.equal(firstActions[0].props.disabled, true);
  assert.equal(firstActions[1].props.disabled, true);
  assert.equal(firstActions[0].props['aria-pressed'], true);
  assert.equal(firstActions[0].props['aria-label'], translate(locale, 'controls.cancelSample', { text: suggestions[0].text }));
  assert.equal(find(tree, byClass('reply-help-toggle')).props.disabled, undefined);
  assert.equal(find(tree, byClass('reply-suggestions-content')).props.hidden, false);
});
