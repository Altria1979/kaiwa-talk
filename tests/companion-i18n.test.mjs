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
  start: async () => {},
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
const { ConversationAudioExport } = await import('../src/components/conversation-audio-export.tsx');

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

test('audio export stays associated with the recorded session and translates every result', () => {
  const original = { ...conversation };
  const recording = { sessionId: session.id, createdAt: session.createdAt, status: 'ready', blob: new Blob(['audio']), extension: 'webm' };
  try {
    conversation.recording = recording;
    assert.equal(find(harness(Companion)(), node => node.type === ConversationAudioExport).props.recording, recording);
    conversation.recording = { ...recording, sessionId: 'another-session' };
    assert.equal(find(harness(Companion)(), node => node.type === ConversationAudioExport), undefined);
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      for (const [status, description] of [['ready', 'audioExportHint'], ['finalizing', 'audioPreparing'], ['unavailable', 'audioUnsupported'], ['empty', 'audioEmpty'], ['failed', 'audioFailed']]) {
        const tree = harness(ConversationAudioExport, { recording: { ...recording, status } })();
        assert.match(text(tree), new RegExp(t(`companion.${description}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        const button = find(tree, node => node.type === 'button');
        assert.equal(button.props.disabled, status !== 'ready');
        assert.equal(text(button), t(status === 'finalizing' ? 'companion.audioPreparingButton' : 'companion.exportAudio'));
      }
    }
  } finally {
    delete conversation.recording;
    Object.assign(conversation, original);
    locale = 'ja';
  }
});
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

test('each topic starts voice before sending once and disables topics until startup completes', async () => {
  const originalConversation = { ...conversation };
  const originalCredentials = credentialsSnapshot;
  credentialsSnapshot = JSON.stringify({ apiKey: 'test-browser-key' });
  locale = 'zh-CN';
  try {
    for (const [label, message, currentSession, expectedSessionId] of [
      ['companion.starterGreeting', 'こんにちは！', null, undefined],
      ['companion.starterIntroduction', '日本語で自己紹介を練習したいです。', session, session.id],
      ['companion.starterCafe', 'カフェで注文する練習をしましょう。', { ...session, endedAt: session.createdAt }, undefined],
    ]) {
      const startup = Promise.withResolvers();
      const started = [];
      sent = [];
      conversation.active = false;
      conversation.voiceEnabled = false;
      conversation.session = currentSession;
      conversation.start = options => { started.push(options); return startup.promise; };
      const render = harness(Companion);
      render();
      const cleanup = render.runEffects();
      try {
        await new Promise(resolve => setImmediate(resolve));
        find(render(), buttonText(t(label))).props.onClick();
        assert.deepEqual(started, [{ voice: true, sessionId: expectedSessionId }]);
        assert.deepEqual(sent, [], 'topic waits for startup rather than racing the connection');
        const busyTree = render();
        for (const topic of children(find(busyTree, node => node.props.className === 'conversation-starters'))) {
          assert.equal(topic.props.disabled, true);
          topic.props.onClick();
        }
        assert.equal(started.length, 1, 'repeated clicks during startup cannot start another session');
        assert.deepEqual(sent, []);
        startup.resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(sent, [message]);
        assert.equal(find(render(), buttonText(t(label))).props.disabled, false);
      } finally {
        startup.resolve();
        await new Promise(resolve => setImmediate(resolve));
        cleanup();
      }
    }
  } finally {
    Object.assign(conversation, originalConversation);
    credentialsSnapshot = originalCredentials;
  }
});

test('a failed topic startup preserves the draft and allows a successful retry without sending early', async () => {
  const originalConversation = { ...conversation };
  const failure = new Error('Voice connection failed');
  let starts = 0;
  sent = [];
  conversation.voiceEnabled = false;
  conversation.start = async () => { if (++starts === 1) throw failure; };
  try {
    const render = harness(Companion);
    find(render(), node => node.props.id === 'message-input').props.onChange({ target: { value: 'My unsent draft' } });
    find(render(), buttonText(t('companion.starterGreeting'))).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, []);
    const failedTree = render();
    assert.match(text(find(failedTree, node => node.props.role === 'alert')), /Voice connection failed/);
    assert.equal(find(failedTree, node => node.props.id === 'message-input').props.value, 'My unsent draft');
    const retry = find(failedTree, buttonText(t('companion.starterGreeting')));
    assert.equal(retry.props.disabled, false);
    retry.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 2);
    assert.deepEqual(sent, ['こんにちは！']);
    assert.equal(find(render(), node => node.props.role === 'alert'), undefined);
  } finally {
    Object.assign(conversation, originalConversation);
  }
});

test('ordinary text and reply suggestions send without enabling voice', async () => {
  const originalConversation = { ...conversation };
  const started = [];
  sent = [];
  conversation.voiceEnabled = false;
  conversation.start = async options => { started.push(options); };
  conversation.canReplay = () => false;
  try {
    const render = harness(Companion);
    find(render(), node => node.props.id === 'message-input').props.onChange({ target: { value: '  A typed message  ' } });
    find(render(), node => node.props.id === 'text-composer').props.onSubmit(submitEvent);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, ['A typed message']);
    const suggestion = { text: 'はい。', reading: 'はい。', meaning: '是的。' };
    conversation.messages = [{ id: 'reply', turnId: 'turn', role: 'assistant', content: '元気ですか？' }];
    conversation.replySuggestions = { type: 'reply.suggestions', messageId: 'reply', turnId: 'turn', status: 'ready', suggestions: [suggestion] };
    const recommendations = find(render(), node => node.props.value?.messageId === 'reply');
    await recommendations.props.onSend(suggestion.text);
    assert.deepEqual(sent, ['A typed message', suggestion.text]);
    assert.deepEqual(started, []);
  } finally {
    Object.assign(conversation, originalConversation);
  }
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
  const recommendations = find(rendered, node => node.props.value?.messageId === 'reply');
  assert.equal(recommendations.props.readOnly, true);
  assert.equal(recommendations.props.learningLanguage, undefined, 'stored references infer their own language');
  assert.equal(recommendations.props.value.meaningLanguage, 'ja');
  assert.deepEqual(recommendations.props.value.suggestions, [suggestion]);
  assert.equal(find(rendered, node => node.type === 'span' && text(node) === '何が好きですか？').props.lang, 'ja');
  conversation.messages = [];
});

test('saved Chinese reply meanings remain visible in history with only two options', () => {
  const suggestions = [
    { text: 'はい。', reading: 'はい。', romaji: 'Hai.', meaning: '是的。' },
    { text: 'いいえ。', reading: 'いいえ。', romaji: 'Iie.', meaning: '不是。' },
    { text: 'わかりません。', reading: 'わかりません。', meaning: '我不知道。' },
  ];
  for (const next of ['ja', 'zh-CN', 'en']) {
    locale = next;
    conversation.messages = [{ id: 'reply', role: 'assistant', content: 'よく眠りますか？', replySuggestions: suggestions, replySuggestionsLanguage: 'zh-CN' }];
    const tree = harness(Companion)();
    const message = find(tree, nodeType('Message'));
    const rendered = harness(message.type, message.props)();
    const recommendations = find(rendered, node => node.props.value?.messageId === 'reply');
    assert.equal(recommendations.props.readOnly, true);
    assert.equal(recommendations.props.value.meaningLanguage, 'zh-CN');
    assert.deepEqual(recommendations.props.value.suggestions, suggestions);
  }
  conversation.messages = [];
});

test('each AI message owns its reply suggestions inside the scrolling conversation', () => {
  const options = [
    { text: 'はい。', reading: 'はい。', meaning: '是的。' },
    { text: 'いいえ。', reading: 'いいえ。', meaning: '不是。' },
  ];
  const older = { id: 'older', turnId: 'older-turn', role: 'assistant', content: '元気ですか？', replySuggestions: options, replySuggestionsLanguage: 'zh-CN' };
  const latest = { ...older, id: 'latest', turnId: 'latest-turn', content: 'よく眠りますか？' };
  conversation.messages = [older, { id: 'user', role: 'user', content: 'はい。' }, latest];
  conversation.replySuggestions = { type: 'reply.suggestions', messageId: latest.id, turnId: latest.turnId, status: 'ready', suggestions: options, meaningLanguage: 'zh-CN' };
  try {
    const tree = harness(Companion)();
    const content = find(tree, node => node.props.className === 'conversation-content');
    for (const [message, readOnly] of [[older, true], [latest, false]]) {
      const element = find(content, node => nodeType('Message')(node) && node.props.message.id === message.id);
      const rendered = harness(element.type, element.props)();
      const recommendations = find(rendered, node => node.props.value?.messageId === message.id);
      assert.ok(recommendations, 'recommendations belong to their AI message');
      assert.equal(recommendations.props.readOnly === true, readOnly);
      assert.equal(recommendations.props.value.meaningLanguage, 'zh-CN');
    }
    const panel = find(tree, node => node.props.className === 'conversation-panel');
    assert.ok(!children(panel).some(node => node.props?.value?.type === 'reply.suggestions'), 'no detached suggestions below chat');
    conversation.replySuggestions = null;
    const afterSend = harness(Companion)();
    const previous = find(afterSend, node => nodeType('Message')(node) && node.props.message.id === latest.id);
    const saved = find(harness(previous.type, previous.props)(), node => node.props.value?.messageId === latest.id);
    assert.equal(saved.props.readOnly, true, 'the previous recommendations remain after sending the next turn');
  } finally {
    conversation.messages = [];
    conversation.replySuggestions = null;
  }
});

test('the conversation control and message input share one composer row', () => {
  for (const active of [false, true]) {
    conversation.active = active;
    const tree = harness(Companion)();
    const row = find(tree, node => node.props.className === 'composer-row');
    assert.ok(row);
    assert.ok(find(row, node => node.type === 'textarea' && node.props.id === 'message-input'));
    assert.ok(find(row, buttonText(t(active ? 'companion.endConversation' : 'companion.startConversation'))));
    assert.ok(find(row, node => node.props['aria-label'] === t('companion.sendMessage')));
  }
  conversation.active = true;
});
