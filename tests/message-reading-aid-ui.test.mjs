import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as React from 'react';
import { companionMessages } from '../src/i18n/messages/companion.ts';
import { controlsMessages } from '../src/i18n/messages/controls.ts';

let rendering;
let locale = 'zh-CN';
let requests = [];
const source = '今年もよろしくお願いします。';
const readingAid = { translation: '今年也请多多关照。', reading: 'ことしも よろしく おねがいします。' };
const message = { id: 'assistant-reply', role: 'assistant', content: source };
const translated = key => companionMessages[locale][key] ?? controlsMessages[locale][key];

// Keep the existing renderer-free harness, including dependency changes and effect cleanup.
mock.module('react', { exports: {
  ...React,
  useState(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.slots[index], value => {
      if (!owner.mounted) owner.updatesAfterUnmount++;
      owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value;
    }];
  },
  useEffect(effect, dependencies) {
    const owner = rendering;
    const index = owner.cursor++;
    const previous = owner.slots[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      owner.effects.push(() => {
        previous?.cleanup?.();
        owner.slots[index] = { dependencies, cleanup: effect() };
      });
    }
  },
} });
mock.module('../src/i18n/provider.tsx', { exports: { useI18n: () => ({ locale, t: translated }) } });
mock.module('../src/lib/api.ts', { exports: { api: {
  readingAid(id, signal) {
    return new Promise((resolve, reject) => { requests.push({ id, signal, resolve, reject }); });
  },
} } });
const { MessageReadingAid } = await import('../src/components/message-reading-aid.tsx');

const children = node => React.isValidElement(node) ? React.Children.toArray(node.props.children) : [];
function find(node, predicate) {
  if (React.isValidElement(node) && predicate(node)) return node;
  for (const child of children(node)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : children(node).map(text).join('');
const className = name => node => node.props.className === name;
const button = key => node => node.type === 'button' && text(node) === translated(key);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, initialProps = {}) {
  const owner = { cursor: 0, slots: [], effects: [], mounted: true, updatesAfterUnmount: 0 };
  let props = { message, autoLoad: true, streaming: false, showKana: true, ...initialProps };
  function render(patch = {}) {
    props = { ...props, ...patch };
    owner.cursor = 0;
    owner.effects = [];
    rendering = owner;
    const tree = MessageReadingAid(props);
    owner.effects.forEach(effect => effect());
    return tree;
  }
  function unmount() {
    if (!owner.mounted) return;
    owner.mounted = false;
    owner.slots.forEach(slot => slot?.cleanup?.());
  }
  t.after(unmount);
  return { render, unmount, owner };
}

beforeEach(() => { requests = []; locale = 'zh-CN'; });

test('automatic reading aids wait until streaming finishes and never request empty content', async t => {
  const { render } = harness(t, { streaming: true });
  assert.equal(render(), null);
  await tick();
  assert.equal(requests.length, 0);
  assert.equal(render({ streaming: false, message: { ...message, content: ' \n ' } }), null);
  assert.equal(requests.length, 0);
  const tree = render({ message });
  assert.equal(text(find(tree, node => node.props.role === 'status')), translated('companion.readingAidLoading'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, message.id);
  await tick();
  render();
  render();
  assert.equal(requests.length, 1);
});

test('saved Chinese and kana appear immediately, and hiding kana preserves Chinese in every UI language', t => {
  const { render } = harness(t, { message: { ...message, readingAid } });
  for (const language of ['zh-CN', 'ja', 'en']) {
    locale = language;
    const tree = render({ showKana: true });
    const chinese = find(tree, className('message-chinese'));
    const kana = find(tree, className('message-kana'));
    assert.equal(text(chinese), translated('companion.chineseTranslation') + readingAid.translation);
    assert.equal(chinese.props.lang, 'zh-CN');
    assert.equal(text(kana), translated('controls.kana') + readingAid.reading);
    assert.equal(kana.props.lang, 'ja');
    assert.equal(children(chinese)[0].props.lang, language);
    const hidden = render({ showKana: false });
    assert.ok(text(find(hidden, className('message-chinese'))).includes(readingAid.translation));
    assert.equal(find(hidden, className('message-kana')), undefined);
  }
  assert.equal(requests.length, 0);
});

test('successful automatic loading displays the aid and does not refetch on display preference changes', async t => {
  const { render } = harness(t);
  render();
  requests[0].resolve({ readingAid });
  await tick();
  const tree = render();
  assert.ok(text(find(tree, className('message-chinese'))).includes(readingAid.translation));
  assert.ok(text(find(tree, className('message-kana'))).includes(readingAid.reading));
  render({ showKana: false });
  render({ showKana: true });
  assert.equal(requests.length, 1);
});

test('failed loading stays failed until an explicit retry and then can recover', async t => {
  const { render } = harness(t);
  render();
  requests[0].reject(new Error('provider unavailable'));
  await tick();
  let tree = render();
  assert.equal(text(find(tree, node => node.props.role === 'status')), translated('companion.readingAidFailed'));
  for (let i = 0; i < 3; i++) { render(); await tick(); }
  assert.equal(requests.length, 1, 'a failure must not cause an automatic request loop');
  find(tree, button('companion.retry')).props.onClick();
  render();
  await tick();
  tree = render();
  assert.equal(text(find(tree, node => node.props.role === 'status')), translated('companion.readingAidLoading'));
  assert.equal(requests.length, 2);
  requests[1].resolve({ readingAid });
  await tick();
  assert.ok(text(render()).includes(readingAid.translation));
  assert.equal(requests.length, 2);
});

test('a request already started remains usable after a new turn disables automatic loading', async t => {
  const { render } = harness(t);
  render();
  await tick();
  const pending = requests[0];
  render({ autoLoad: false });
  assert.equal(pending.signal.aborted, false);
  assert.equal(requests.length, 1);
  pending.resolve({ readingAid });
  await tick();
  assert.ok(text(render()).includes(readingAid.translation));
  assert.ok(text(render()).includes(readingAid.reading));
});

test('older messages load only after the learner requests Chinese and kana', async t => {
  const { render } = harness(t, { autoLoad: false });
  const initial = render();
  await tick();
  render();
  assert.equal(requests.length, 0);
  find(initial, button('companion.showReadingAid')).props.onClick();
  render();
  assert.equal(requests.length, 1);
  requests[0].resolve({ readingAid });
  await tick();
  assert.ok(text(render()).includes(readingAid.translation));
});

test('source changes discard an old result and abort an old pending request', async t => {
  const { render } = harness(t);
  render();
  await tick();
  const pending = requests[0];
  const changedMessage = { ...message, content: '新年おめでとうございます。' };
  const changedAid = { translation: '祝你新年快乐。', reading: 'しんねん おめでとうございます。' };
  render({ message: changedMessage });
  assert.equal(pending.signal.aborted, true);
  assert.equal(requests.length, 2);
  pending.resolve({ readingAid });
  await tick();
  assert.equal(text(render()).includes(readingAid.translation), false);
  requests[1].resolve({ readingAid: changedAid });
  await tick();
  assert.ok(text(render()).includes(changedAid.translation));
  assert.equal(text(render({ message: { ...changedMessage, content: 'こんにちは。' } })).includes(changedAid.translation), false);
});

test('unmount aborts a pending request and its late response cannot update state', async t => {
  const view = harness(t);
  view.render();
  await tick();
  view.unmount();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ readingAid });
  await tick();
  assert.equal(view.owner.updatesAfterUnmount, 0);
});

test('non-Japanese replies keep their Chinese translation without an empty kana row', t => {
  const { render } = harness(t, { message: { ...message, content: 'Happy new year!', readingAid: { translation: '新年快乐！', reading: '' } } });
  const tree = render();
  assert.ok(text(tree).includes('新年快乐！'));
  assert.equal(find(tree, className('message-kana')), undefined);
  assert.equal(requests.length, 0);
});
