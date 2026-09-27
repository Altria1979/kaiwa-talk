import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { registerHooks } from 'node:module';
import * as React from 'react';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';
import { companionMessages } from '../src/i18n/messages/companion.ts';
import { controlsMessages } from '../src/i18n/messages/controls.ts';

let locale = 'ja';
let rendering;
const effects = [];
// Exercise component handlers with persistent hook slots, without a new renderer dependency.
mock.module('react', { exports: {
  ...React,
  useCallback: callback => callback,
  useId: () => 'test-dialog-title',
  useState(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.slots[index], value => { owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value; }];
  },
  useRef(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useEffect(effect, dependencies) { effects.push(dependencies); rendering.effects.push(effect); },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
} });
const t = (key, params = {}) => (companionMessages[locale][key] ?? controlsMessages[locale][key]).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
const formattedErrors = [];
mock.module('../src/i18n/provider.tsx', { exports: { useI18n: () => ({
  locale, t,
  formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
  formatDate: (value, options) => new Intl.DateTimeFormat(locale, options).format(new Date(value)),
  formatError: (cause, details) => { formattedErrors.push({ cause, details }); return `${locale}: ${details?.errorCode ?? cause.errorCode ?? cause.message ?? cause}`; },
}) } });
const session = { id: 'session', createdAt: '2026-09-27T04:00:00.000Z', endedAt: null, review: null };
let sent = [];
const conversation = {
  active: true, state: 'listening', messages: [], voiceEnabled: true, muted: false,
  session, replySuggestions: null, pendingTranscript: '', error: null, errorDetails: null,
  sendText: async text => { sent.push(text); }, clearError() {},
};
mock.module('../src/hooks/use-conversation.ts', { exports: { useConversation: () => conversation } });
mock.module('../src/hooks/use-reading-preferences.ts', { exports: { useReadingPreferences: () => ({ showKana: true, showRomaji: true }) } });
let credentialsSnapshot = null;
const credentialsListeners = new Set();
mock.module('../src/lib/bailian-credentials.ts', { exports: {
  subscribeBrowserCredentials(listener) { credentialsListeners.add(listener); return () => credentialsListeners.delete(listener); },
  getBrowserCredentialsSnapshot: () => credentialsSnapshot,
  parseBrowserCredentials: value => value ? JSON.parse(value) : undefined,
  saveBrowserCredentials(value) { credentialsSnapshot = JSON.stringify(value); for (const listener of credentialsListeners) listener(); },
  clearBrowserCredentials() { credentialsSnapshot = null; for (const listener of credentialsListeners) listener(); },
} });
let savedSettings;
let memories = [];
mock.module('../src/lib/api.ts', { exports: { api: {
  status: async () => ({ ready: credentialsSnapshot !== null, credentialSource: credentialsSnapshot ? 'browser' : 'none', missing: credentialsSnapshot ? [] : ['BAILIAN_API_KEY'], region: null, models: { chat: 'chat-model', asr: 'asr-model', tts: 'tts-model' } }),
  settings: async () => DEFAULT_SETTINGS,
  sessions: async () => [],
  memories: async () => [],
  saveSettings: async value => { savedSettings = value; return value; },
  addMemory: async content => ({ id: 'saved', content, updatedAt: session.createdAt }),
} } });
for (const [path, names] of [
  ['reading-aids', ['ReadingControls', 'ReplyReading']],
  ['avatar-stage', ['AvatarStage', 'validateAvatarFile']],
  ['avatar-controls', ['AvatarControls']],
  ['icon', ['Icon']],
  ['reply-suggestions', ['ReplySuggestions']],
  ['paper-navigation', ['PaperNavigation']],
  ['language-switcher', ['LanguageSwitcher']],
]) mock.module(`../src/components/${path}.tsx`, { exports: Object.fromEntries(names.map(name => [name, () => null])) });
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/companion.module.css')) return { format: 'module', source: 'export default { shell: "shell" };', shortCircuit: true };
  return nextLoad(url, context);
} });
const { Companion } = await import('../src/components/companion.tsx');

const children = node => React.isValidElement(node) ? React.Children.toArray(node.props.children) : [];
function find(node, predicate) {
  if (React.isValidElement(node) && predicate(node)) return node;
  for (const child of children(node)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function text(node) {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : children(node).map(text).join('');
}
function harness(component, initialProps = {}) {
  const state = { cursor: 0, slots: [], effects: [] };
  let props = initialProps;
  const render = nextProps => { props = nextProps ?? props; state.cursor = 0; state.effects = []; rendering = state; return component(props); };
  render.runEffects = () => {
    const cleanups = state.effects.map(effect => effect()).filter(cleanup => typeof cleanup === 'function');
    return () => cleanups.forEach(cleanup => cleanup());
  };
  return render;
}
const nodeType = name => node => typeof node.type === 'function' && node.type.name === name;
const buttonText = expected => node => node.type === 'button' && text(node) === expected;
const submitEvent = { preventDefault() {} };

test('missing API keys show translated setup instructions with an action while preserving the draft', async () => {
  conversation.active = false;
  credentialsSnapshot = null;
  const render = harness(Companion);
  render();
  const cleanup = render.runEffects();
  try {
    await new Promise(resolve => setImmediate(resolve));
    find(render(), node => node.type === 'textarea' && node.props.id === 'message-input').props.onChange({ target: { value: 'A conversation draft' } });
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const tree = render();
      const banner = find(tree, node => node.props.className === 'config-banner');
      assert.ok(text(banner).includes(t('companion.apiKeyRequired')));
      assert.equal(find(tree, buttonText(t('companion.startConversation'))).props.disabled, true);
      assert.equal(find(tree, buttonText(t('companion.starterGreeting'))).props.disabled, true);
      assert.equal(find(tree, node => node.props['aria-label'] === t('companion.sendMessage')).props.disabled, true);
      find(banner, buttonText(t('companion.openSettings'))).props.onClick();
      const afterOpen = render();
      assert.ok(find(afterOpen, nodeType('SettingsPanel')));
      assert.equal(find(afterOpen, node => node.props.id === 'message-input').props.value, 'A conversation draft');
    }
  } finally {
    cleanup();
    conversation.active = true;
  }
});

test('deleting a saved API key requires configuration again and retains the translated deletion notice', async () => {
  conversation.active = false;
  credentialsSnapshot = JSON.stringify({ apiKey: 'test-browser-key' });
  locale = 'ja';
  const render = harness(Companion);
  render();
  const cleanup = render.runEffects();
  try {
    await new Promise(resolve => setImmediate(resolve));
    const tree = render();
    assert.equal(find(tree, buttonText(t('companion.startConversation'))).props.disabled, false);
    find(tree, node => node.props.onChange && node.props.panel === null).props.onChange('settings');
    const settings = find(render(), nodeType('SettingsPanel'));
    const settingsView = harness(settings.type, settings.props);
    const bailian = find(settingsView(), nodeType('BailianSettings'));
    const renderBailian = harness(bailian.type, bailian.props);
    find(renderBailian(), buttonText(t('controls.deleteApiKey'))).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(credentialsSnapshot, null);
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const updated = render();
      assert.equal(find(updated, buttonText(t('companion.startConversation'))).props.disabled, true);
      assert.ok(text(find(updated, node => node.props.className === 'config-banner')).includes(t('companion.apiKeyRequired')));
      const nextSettings = find(updated, nodeType('SettingsPanel'));
      const nextBailian = find(settingsView(nextSettings.props), nodeType('BailianSettings'));
      const nextTree = renderBailian(nextBailian.props);
      assert.equal(text(find(nextTree, node => node.props.className === 'bailian-feedback')), t('controls.keyDeleted'));
      assert.equal(text(find(nextTree, node => node.type === 'strong')), t('controls.enterApiKey'));
      assert.equal(text(nextTree).includes('BAILIAN_API_KEY'), false);
    }
  } finally {
    cleanup();
    credentialsSnapshot = null;
    conversation.active = true;
  }
});

function panel(name) {
  const render = harness(Companion);
  const tree = render();
  const navigation = find(tree, node => node.props.onChange && node.props.panel === null);
  navigation.props.onChange(name);
  const panelElement = find(render(), nodeType(name === 'settings' ? 'SettingsPanel' : 'MemoryPanel'));
  return { root: render, element: panelElement, render: harness(panelElement.type, panelElement.props) };
}

test('starter labels change while their sent Japanese text and stable keys remain unchanged', async () => {
  const render = harness(Companion);
  sent = [];
  for (const next of ['ja', 'zh-CN', 'en']) {
    locale = next;
    const tree = render();
    const button = find(tree, buttonText(t('companion.starterGreeting')));
    assert.ok(button);
    assert.match(button.key, /greeting/);
    button.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(sent, ['こんにちは！', 'こんにちは！', 'こんにちは！']);
});

test('settings drafts survive every UI locale and submit original language values', async () => {
  locale = 'ja';
  const view = panel('settings');
  let tree = view.render();
  const nameInput = find(tree, node => node.type === 'input' && node.props.value === DEFAULT_SETTINGS.characterName);
  nameInput.props.onChange({ target: { value: 'Draft partner' } });
  for (const next of ['en', 'zh-CN', 'ja']) {
    locale = next;
    tree = view.render();
    assert.ok(find(tree, node => node.type === 'input' && node.props.value === 'Draft partner'));
    const language = find(tree, node => node.type === 'select' && node.props.value === DEFAULT_SETTINGS.learningLanguage);
    assert.deepEqual(children(language).map(option => option.props.value), ['日本語', '英語', '韓国語', 'フランス語', 'ドイツ語', 'スペイン語']);
    assert.equal(text(children(language)[0]), t('companion.language.japanese'));
  }
  const language = find(tree, node => node.type === 'select' && node.props.value === DEFAULT_SETTINGS.learningLanguage);
  language.props.onChange({ target: { value: '英語' } });
  find(view.render(), node => node.type === 'form').props.onSubmit(submitEvent);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(savedSettings.characterName, 'Draft partner');
  assert.equal(savedSettings.learningLanguage, '英語');
  assert.equal(savedSettings.supportLanguage, '日本語');
  // The already-visible notice translates from its key after the async save.
  locale = 'en';
  assert.equal(text(find(view.root(), node => node.props.className === 'toast')), t('companion.settingsSavedNotice'));
  locale = 'zh-CN';
  assert.equal(text(find(view.root(), node => node.props.className === 'toast')), t('companion.settingsSavedNotice'));
});

test('new and edited memory drafts remain intact while labels change', () => {
  locale = 'ja';
  const view = panel('memories');
  const memory = { id: 'memory', content: 'An existing user memory', updatedAt: session.createdAt };
  const render = harness(view.element.type, { memories: [memory], onChange: value => { memories = value; } });
  let tree = render();
  find(tree, node => node.type === 'textarea' && node.props.id === 'new-memory').props.onChange({ target: { value: 'A new draft' } });
  find(tree, node => node.type === 'button' && node.props['aria-label'] === t('companion.editMemoryLabel', { content: memory.content })).props.onClick();
  tree = render();
  find(tree, node => node.type === 'textarea' && node.props['aria-label']).props.onChange({ target: { value: 'An edited draft' } });
  for (const next of ['en', 'zh-CN']) {
    locale = next;
    tree = render();
    assert.equal(find(tree, node => node.type === 'textarea' && node.props.id === 'new-memory').props.value, 'A new draft');
    assert.equal(find(tree, node => node.type === 'textarea' && node.props['aria-label'] === t('companion.editMemory')).props.value, 'An edited draft');
  }
  assert.deepEqual(memories, []);
});

test('existing conversation errors retain codes and parameters across UI language changes', () => {
  conversation.error = 'Original safe error';
  conversation.errorDetails = { errorCode: 'audio.problem', errorParams: { limit: 30 } };
  const render = harness(Companion);
  for (const next of ['ja', 'en', 'zh-CN']) {
    locale = next;
    assert.match(text(find(render(), node => node.props.role === 'alert')), new RegExp(`${next}: audio.problem`));
    assert.deepEqual(formattedErrors.at(-1), { cause: conversation.error, details: conversation.errorDetails });
  }
  conversation.error = null;
  conversation.errorDetails = null;
});

test('Japanese explanation metadata does not mislabel English learning content', () => {
  locale = 'en';
  const suggestion = { text: 'I like cats.', reading: 'I like cats.', meaning: '猫が好きです。' };
  conversation.messages = [{ id: 'reply', role: 'assistant', content: 'What do you like?', translation: '何が好きですか？', translationLanguage: 'ja', replySuggestions: [suggestion], replySuggestionsLanguage: 'ja' }];
  conversation.canReplay = () => false;
  const tree = harness(Companion)();
  const message = find(tree, nodeType('Message'));
  const rendered = harness(message.type, message.props)();
  assert.equal(find(rendered, node => node.type === 'p' && text(node) === suggestion.text).props.lang, undefined);
  assert.equal(find(rendered, node => node.type === 'small' && text(node) === suggestion.meaning).props.lang, 'ja');
  assert.equal(find(rendered, node => node.type === 'span' && text(node) === '何が好きですか？').props.lang, 'ja');
  conversation.messages = [];
});
