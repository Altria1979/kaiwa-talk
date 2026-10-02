import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { registerHooks } from 'node:module';
import * as React from 'react';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';
import { companionMessages } from '../src/i18n/messages/companion.ts';
import { controlsMessages } from '../src/i18n/messages/controls.ts';
import { commonMessages } from '../src/i18n/messages/common.ts';

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
const t = (key, params = {}) => (companionMessages[locale][key] ?? controlsMessages[locale][key] ?? commonMessages[locale][key]).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
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
const readingPreferences = { showKana: true, setShowKana(value) { readingPreferences.showKana = value; } };
mock.module('../src/hooks/use-reading-preferences.ts', { exports: { useReadingPreferences: () => ({ ...readingPreferences }) } });
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
const dataRequests = [];
mock.module('../src/lib/api.ts', { exports: { api: {
  status: async () => (dataRequests.push('status'), { ready: credentialsSnapshot !== null, credentialSource: credentialsSnapshot ? 'browser' : 'none', missing: credentialsSnapshot ? [] : ['BAILIAN_API_KEY'], region: null, models: { chat: 'chat-model', asr: 'asr-model', tts: 'tts-model' } }),
  settings: async () => { dataRequests.push('settings'); return DEFAULT_SETTINGS; },
  sessions: async () => { dataRequests.push('sessions'); return []; },
  memories: async () => { dataRequests.push('memories'); return []; },
  saveSettings: async value => { savedSettings = value; return value; },
} } });
for (const [path, names] of [
  ['reading-aids', ['ReadingControls', 'ReplyReading']],
  ['avatar-stage', ['AvatarStage']],
  ['avatar-controls', ['AvatarControls']],
  ['icon', ['Icon']],
  ['reply-suggestions', ['ReplySuggestions']],
  ['language-switcher', ['LanguageSwitcher']],
]) mock.module(`../src/components/${path}.tsx`, { exports: Object.fromEntries(names.map(name => [name, () => null])) });
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/companion.module.css')) return { format: 'module', source: 'export default { shell: "shell" };', shortCircuit: true };
  return nextLoad(url, context);
} });
const { Companion } = await import('../src/components/companion.tsx');
const { ConversationAudioExport } = await import('../src/components/conversation-audio-export.tsx');
const { AvatarStage } = await import('../src/components/avatar-stage.tsx');
const { ReadingControls } = await import('../src/components/reading-aids.tsx');

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
const buttonLabel = expected => node => node.type === 'button' && node.props['aria-label'] === expected;
const messageInput = node => node.type === 'textarea' && node.props.id === 'message-input';
const submitEvent = { preventDefault() {} };
const settle = () => new Promise(resolve => setImmediate(resolve));

function openMessageInput(render) {
  const tree = render();
  const existing = find(tree, messageInput);
  if (existing) return existing;
  const toggle = find(tree, buttonLabel(t('companion.typeMessage')));
  assert.ok(toggle, 'voice mode offers an explicit text input toggle');
  toggle.props.onClick();
  const input = find(render(), messageInput);
  assert.ok(input, 'the toggle opens the text input');
  return input;
}

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
    find(tree, node => node.type === 'button' && node.props['aria-label'] === t('controls.settings')).props.onClick();
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

function panel() {
  const render = harness(Companion);
  const tree = render();
  find(tree, node => node.type === 'button' && node.props['aria-label'] === t('controls.settings')).props.onClick();
  const panelElement = find(render(), nodeType('SettingsPanel'));
  return { root: render, element: panelElement, render: harness(panelElement.type, panelElement.props) };
}

test('appearance stays built in and settings cannot restore an old custom avatar in any locale', async () => {
  const originalLocale = locale;
  try {
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const view = panel();
      const tree = view.render({ ...view.element.props, active: false, settings: {
        ...DEFAULT_SETTINGS, characterName: 'My companion', avatarUrl: '/api/avatars/old-custom.vrm',
      } });
      const appearance = find(tree, node => node.props.className === 'avatar-setting');
      assert.equal(text(find(appearance, node => node.type === 'strong')), t('companion.defaultAvatar'));
      assert.ok(text(appearance).includes(t('companion.builtInAvatar')));
      assert.equal(find(appearance, node => node.type === 'button'), undefined);
      assert.equal(find(tree, node => node.type === 'input' && node.props.type === 'file'), undefined);
      find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(savedSettings.avatarUrl, DEFAULT_SETTINGS.avatarUrl);
      assert.equal(savedSettings.characterName, 'My companion');
    }
  } finally {
    locale = originalLocale;
  }
});

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

test('ordinary text sends normally and selected replies use automatic reading without enabling the microphone', async () => {
  const originalConversation = { ...conversation };
  const started = [];
  const suggested = [];
  sent = [];
  conversation.voiceEnabled = false;
  conversation.start = async options => { started.push(options); };
  conversation.sendSuggestion = async (messageId, index) => { suggested.push({ messageId, index }); };
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
    await recommendations.props.onSend(0);
    assert.deepEqual(suggested, [{ messageId: 'reply', index: 0 }]);
    assert.deepEqual(sent, ['A typed message']);
    assert.deepEqual(started, []);
  } finally {
    Object.assign(conversation, originalConversation);
  }
});

test('settings drafts survive every UI locale with Japanese practice fixed and no language fields', async () => {
  locale = 'ja';
  const view = panel('settings');
  let tree = view.render({ ...view.element.props, settings: { ...DEFAULT_SETTINGS, learningLanguage: '英語', supportLanguage: '中文' } });
  const nameInput = find(tree, node => node.type === 'input' && node.props.value === DEFAULT_SETTINGS.characterName);
  nameInput.props.onChange({ target: { value: 'Draft partner' } });
  for (const next of ['en', 'zh-CN', 'ja']) {
    locale = next;
    tree = view.render();
    assert.ok(find(tree, node => node.type === 'input' && node.props.value === 'Draft partner'));
    const preferences = find(tree, node => node.props.className === 'settings-section' && text(node).includes(t('companion.practicePreferences')));
    assert.deepEqual(children(preferences).filter(node => node.type === 'label').map(node => text(children(node)[0])), [t('companion.practiceLevel')]);
    assert.equal(find(preferences, node => node.type === 'input' && node.props.readOnly), undefined);
    assert.equal(find(preferences, node => node.type === 'select' && ![DEFAULT_SETTINGS.japaneseLevel, DEFAULT_SETTINGS.vadSilenceMs].includes(node.props.value)), undefined);
    assert.ok(text(preferences).includes(t('companion.voiceLanguageHelp')));
    assert.ok(text(preferences).includes(t('companion.explanationHelp')));
  }
  find(view.render(), node => node.type === 'form').props.onSubmit(submitEvent);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(savedSettings.characterName, 'Draft partner');
  assert.equal(savedSettings.learningLanguage, '日本語');
  assert.equal(savedSettings.supportLanguage, '日本語');
  // The already-visible notice translates from its key after the async save.
  locale = 'en';
  assert.equal(text(find(view.root(), node => node.props.className === 'toast')), t('companion.settingsSavedNotice'));
  locale = 'zh-CN';
  assert.equal(text(find(view.root(), node => node.props.className === 'toast')), t('companion.settingsSavedNotice'));
});

test('page initialization and settings refresh only fetch status and settings', async () => {
  dataRequests.length = 0;
  const render = harness(Companion);
  render();
  const cleanup = render.runEffects();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(dataRequests, ['status', 'settings']);
    find(render(), node => node.type === 'button' && node.props['aria-label'] === t('controls.settings')).props.onClick();
    await find(render(), nodeType('SettingsPanel')).props.onRefresh();
    assert.deepEqual(dataRequests, ['status', 'settings', 'status', 'settings']);
  } finally {
    cleanup();
  }
});

test('completed learning reviews keep expressions and advice without memory actions in every locale', () => {
  const original = conversation.session;
  const review = {
    language: 'ja', topic: '庭の会話',
    expressions: [{ text: 'いい天気ですね。', meaning: '晴れた日のあいさつです。' }],
    improvement: '少しゆっくり話してみましょう。',
    memorySuggestions: ['コーヒーが好きです。'],
  };
  conversation.session = { ...session, endedAt: session.createdAt, review };
  try {
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const element = find(harness(Companion)(), nodeType('Review'));
      const tree = harness(element.type, element.props)();
      assert.ok(text(tree).includes(review.topic));
      assert.ok(text(tree).includes(review.expressions[0].text));
      assert.ok(text(tree).includes(review.improvement));
      assert.equal(text(tree).includes(review.memorySuggestions[0]), false);
      assert.equal(find(tree, node => node.type === 'button'), undefined);
    }
  } finally {
    conversation.session = original;
    locale = 'ja';
  }
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

test('saved Chinese reply meanings remain visible in the conversation with only two options', () => {
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

test('voice conversations start with the input collapsed and retain their call controls in every locale', () => {
  const original = { ...conversation };
  const originalLocale = locale;
  Object.assign(conversation, { active: true, voiceEnabled: true, state: 'speaking', muted: false });
  try {
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const tree = harness(Companion)();
      assert.equal(find(tree, messageInput), undefined);
      assert.equal(find(tree, node => node.props.id === 'text-composer').props.hidden, true);
      const toggle = find(tree, buttonLabel(t('companion.typeMessage')));
      assert.ok(toggle);
      assert.equal(toggle.props['aria-expanded'], false);
      assert.ok(find(tree, buttonText(t('companion.endConversation'))));
      assert.equal(Boolean(find(tree, buttonLabel(t('companion.mute'))).props.disabled), false);
      assert.equal(Boolean(find(tree, buttonLabel(t('companion.stopReply'))).props.disabled), false);
    }
  } finally {
    Object.assign(conversation, original);
    locale = originalLocale;
  }
});

test('the voice text drawer preserves its draft when closed and clears it after a successful send', async () => {
  const original = { ...conversation };
  Object.assign(conversation, { active: true, voiceEnabled: true });
  sent = [];
  try {
    const render = harness(Companion);
    openMessageInput(render).props.onChange({ target: { value: '  A voice-session draft  ' } });
    let tree = render();
    const expanded = find(tree, buttonLabel(t('companion.hideInput')));
    assert.equal(expanded.props['aria-expanded'], true);
    assert.ok(find(tree, node => node.props.id === expanded.props['aria-controls']));
    find(tree, buttonLabel(t('companion.hideInput'))).props.onClick();
    assert.equal(find(render(), messageInput), undefined);
    assert.equal(openMessageInput(render).props.value, '  A voice-session draft  ');
    find(render(), node => node.props.id === 'text-composer').props.onSubmit(submitEvent);
    await settle();
    assert.deepEqual(sent, ['A voice-session draft']);
    tree = render();
    assert.equal(find(tree, messageInput), undefined);
    assert.equal(find(tree, buttonLabel(t('companion.typeMessage'))).props['aria-expanded'], false);
    assert.equal(openMessageInput(render).props.value, '');
  } finally {
    Object.assign(conversation, original);
  }
});

test('opening the voice input focuses it and closing it returns focus to its toggle', () => {
  const original = { ...conversation };
  Object.assign(conversation, { active: true, voiceEnabled: true });
  let focused;
  let cleanup;
  try {
    const render = harness(Companion);
    const toggle = find(render(), buttonLabel(t('companion.typeMessage')));
    toggle.props.ref.current = { focus() { focused = 'toggle'; } };
    const input = openMessageInput(render);
    input.props.ref.current = { focus() { focused = 'input'; } };
    cleanup = render.runEffects();
    assert.equal(focused, 'input');
    find(render(), buttonLabel(t('companion.hideInput'))).props.onClick();
    assert.equal(focused, 'toggle');
    assert.equal(find(render(), messageInput), undefined);
  } finally {
    cleanup?.();
    Object.assign(conversation, original);
  }
});

test('a rejected text send leaves the voice drawer open and its draft available for retry', async () => {
  const original = { ...conversation };
  let attempts = 0;
  sent = [];
  Object.assign(conversation, {
    active: true, voiceEnabled: true,
    sendText: async value => {
      if (++attempts === 1) throw new Error('Text delivery failed');
      sent.push(value);
    },
  });
  try {
    const render = harness(Companion);
    openMessageInput(render).props.onChange({ target: { value: 'Keep my draft' } });
    find(render(), node => node.props.id === 'text-composer').props.onSubmit(submitEvent);
    await settle();
    const failedTree = render();
    assert.equal(find(failedTree, messageInput).props.value, 'Keep my draft');
    assert.equal(find(failedTree, buttonLabel(t('companion.hideInput'))).props['aria-expanded'], true);
    assert.equal(find(failedTree, buttonLabel(t('companion.sendMessage'))).props.disabled, false);
    assert.match(text(find(failedTree, node => node.props.role === 'alert')), /Text delivery failed/);
    find(failedTree, node => node.props.id === 'text-composer').props.onSubmit(submitEvent);
    await settle();
    assert.deepEqual(sent, ['Keep my draft']);
    assert.equal(find(render(), messageInput), undefined);
    assert.equal(find(render(), node => node.props.role === 'alert'), undefined);
  } finally {
    Object.assign(conversation, original);
  }
});

test('text-only conversations keep their composer visible after sending and offer voice startup', async () => {
  const original = { ...conversation };
  Object.assign(conversation, { active: true, voiceEnabled: false });
  sent = [];
  try {
    const render = harness(Companion);
    let tree = render();
    assert.ok(find(tree, messageInput));
    assert.equal(find(tree, buttonLabel(t('companion.typeMessage'))), undefined);
    assert.ok(find(tree, buttonText(t('companion.enableVoice'))));
    assert.ok(find(tree, buttonText(t('companion.endConversation'))));
    find(tree, messageInput).props.onChange({ target: { value: 'A typed conversation' } });
    find(render(), node => node.props.id === 'text-composer').props.onSubmit(submitEvent);
    await settle();
    assert.deepEqual(sent, ['A typed conversation']);
    tree = render();
    assert.equal(find(tree, messageInput).props.value, '');
  } finally {
    Object.assign(conversation, original);
  }
});

test('composer keyboard shortcuts preserve Shift+Enter and IME input and close the voice drawer on Escape', async () => {
  const original = { ...conversation };
  Object.assign(conversation, { active: true, voiceEnabled: true });
  sent = [];
  try {
    const render = harness(Companion);
    openMessageInput(render).props.onChange({ target: { value: 'こんにちは' } });
    for (const options of [{ shiftKey: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
      let prevented = false;
      find(render(), messageInput).props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() { prevented = true; }, ...options });
      await settle();
      assert.equal(prevented, false, 'newline and composition confirmation remain native input actions');
      assert.deepEqual(sent, []);
      assert.equal(find(render(), messageInput).props.value, 'こんにちは');
    }
    find(render(), messageInput).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: true }, preventDefault() { assert.fail('composition Escape must remain native'); } });
    assert.ok(find(render(), messageInput), 'Escape dismissing IME composition keeps the drawer open');
    let escaped = false;
    find(render(), messageInput).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false }, preventDefault() { escaped = true; } });
    assert.equal(escaped, true);
    assert.equal(find(render(), messageInput), undefined);
    assert.equal(openMessageInput(render).props.value, 'こんにちは');
    let entered = false;
    find(render(), messageInput).props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() { entered = true; } });
    await settle();
    assert.equal(entered, true);
    assert.deepEqual(sent, ['こんにちは']);
    assert.equal(find(render(), messageInput), undefined);
  } finally {
    Object.assign(conversation, original);
  }
});

test('welcome composer and avatar settings keep the draft and saved framing across panel changes', () => {
  const original = { ...conversation };
  const previousStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = { setItem: (key, value) => stored.set(key, value) };
  Object.assign(conversation, { active: false, session: null, messages: [], pendingTranscript: '' });
  locale = 'zh-CN';
  try {
    const render = harness(Companion);
    let tree = render();
    assert.equal(tree.props['data-welcome'], true);
    assert.equal(find(tree, nodeType('Modal')).props.open, false);
    assert.equal(find(tree, node => node.props.id === 'message-input').props.placeholder, t('companion.landingPlaceholder'));
    assert.equal(find(tree, node => node.props['aria-label'] === t('companion.mute')), undefined);
    find(tree, node => node.props.id === 'message-input').props.onChange({ target: { value: 'A garden draft' } });
    const settingsButton = find(render(), node => node.type === 'button' && node.props['aria-label'] === t('controls.settings'));
    assert.equal(settingsButton.props['aria-haspopup'], 'dialog');
    settingsButton.props.onClick();
    assert.ok(find(render(), nodeType('SettingsPanel')));
    find(render(), nodeType('Modal')).props.onClose();
    assert.equal(find(render(), node => node.props.id === 'message-input').props.value, 'A garden draft');
    const gear = find(render(), node => node.type === 'button' && node.props['aria-label'] === t('controls.avatarSettings'));
    assert.equal(gear.props['aria-haspopup'], 'dialog');
    gear.props.onClick();
    tree = render();
    const modal = find(tree, nodeType('Modal'));
    assert.equal(modal.props.open, true);
    assert.equal(modal.props.title, t('controls.avatarSettings'));
    find(tree, node => node.props.id === 'avatar-framing').props.onChange({ target: { value: '0' } });
    assert.equal(stored.get('avatar-a.framing.v1'), '0');
    find(render(), buttonText(t('companion.practiceSettings'))).props.onClick();
    assert.ok(find(render(), nodeType('SettingsPanel')));
    find(render(), nodeType('Modal')).props.onClose();
    tree = render();
    assert.equal(find(tree, nodeType('Modal')).props.open, false);
    assert.equal(find(tree, node => node.props.id === 'message-input').props.value, 'A garden draft');
    assert.equal(find(tree, node => node.props.framing !== undefined).props.framing, 0);
    conversation.active = true;
    conversation.session = session;
    tree = render();
    assert.equal(tree.props['data-welcome'], false);
    assert.equal(openMessageInput(render).props.placeholder, t('companion.messagePlaceholder'));
  } finally {
    Object.assign(conversation, original);
    globalThis.localStorage = previousStorage;
    locale = 'ja';
  }
});

test('mobile character collapse keeps its avatar reconciliation position and the conversation draft', () => {
  const original = { ...conversation };
  const originalLocale = locale;
  Object.assign(conversation, { active: true, voiceEnabled: true });
  function avatarPath(node) {
    if (!React.isValidElement(node)) return undefined;
    const identity = { type: node.type, key: node.key };
    if (node.type === AvatarStage) return [identity];
    for (const child of children(node)) {
      const path = avatarPath(child);
      if (path) return [identity, ...path];
    }
  }
  try {
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const render = harness(Companion);
      openMessageInput(render).props.onChange({ target: { value: 'Keep this mobile draft' } });
      let tree = render();
      const initialPath = avatarPath(tree);
      const initialAvatar = find(tree, node => node.type === AvatarStage);
      assert.ok(initialPath, 'the initial scene contains an avatar');
      for (const collapsed of [true, false, true, false]) {
        const toggle = find(tree, buttonLabel(t(collapsed ? 'companion.collapseCharacter' : 'companion.expandCharacter')));
        assert.equal(toggle.props['aria-expanded'], collapsed);
        assert.equal(find(tree, node => node.props.id === toggle.props['aria-controls']).props.id, 'character-stage');
        toggle.props.onClick();
        tree = render();
        assert.equal(tree.props['data-stage-collapsed'], collapsed);
        assert.equal(find(tree, buttonLabel(t(collapsed ? 'companion.expandCharacter' : 'companion.collapseCharacter'))).props['aria-expanded'], !collapsed);
        assert.deepEqual(avatarPath(tree), initialPath, 'stable ancestor types and keys preserve the mounted avatar');
        const avatar = find(tree, node => node.type === AvatarStage);
        assert.equal(avatar.props.avatarUrl, initialAvatar.props.avatarUrl);
        assert.equal(avatar.props.framing, initialAvatar.props.framing);
        assert.equal(find(tree, messageInput).props.value, 'Keep this mobile draft');
        assert.equal(find(tree, buttonLabel(t('companion.hideInput'))).props['aria-expanded'], true);
      }
    }
  } finally {
    Object.assign(conversation, original);
    locale = originalLocale;
  }
});

test('mobile header opens practice and character settings without losing the draft in every locale', () => {
  const original = { ...conversation };
  const originalLocale = locale;
  Object.assign(conversation, { active: true, voiceEnabled: false });
  try {
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      const render = harness(Companion);
      find(render(), messageInput).props.onChange({ target: { value: 'Draft before settings' } });
      const header = find(render(), node => node.props.className === 'mobile-header');
      assert.equal(text(find(header, node => node.type === 'h1')), t('common.title').split(' · ')[0]);
      assert.equal(text(find(header, node => node.type === 'p')), t('companion.mobileSubtitle'));
      for (const [label, title] of [['controls.settings', 'companion.practiceSettings'], ['controls.avatarSettings', 'controls.avatarSettings']]) {
        const button = find(header, buttonLabel(t(label)));
        assert.equal(button.props['aria-haspopup'], 'dialog');
        button.props.onClick();
        const tree = render();
        const modal = find(tree, nodeType('Modal'));
        assert.equal(modal.props.open, true);
        assert.equal(modal.props.title, t(title));
        if (label === 'controls.settings') assert.ok(find(tree, nodeType('SettingsPanel')));
        else assert.ok(find(tree, node => node.props.id === 'avatar-framing'));
        modal.props.onClose();
        assert.equal(find(render(), nodeType('Modal')).props.open, false);
        assert.equal(find(render(), messageInput).props.value, 'Draft before settings');
      }
    }
  } finally {
    Object.assign(conversation, original);
    locale = originalLocale;
  }
});

test('conversation heading kana switch shares its preference with messages and practice settings', () => {
  const original = { ...conversation };
  const originalLocale = locale;
  const originalKana = readingPreferences.showKana;
  Object.assign(conversation, {
    active: true, voiceEnabled: false, canReplay: () => false,
    messages: [{ id: 'mobile-kana-message', turnId: 'mobile-kana-turn', role: 'assistant', content: '今日は何をしましたか？' }],
  });
  try {
    for (const next of ['ja', 'zh-CN', 'en']) {
      locale = next;
      readingPreferences.showKana = true;
      const render = harness(Companion);
      for (const showKana of [false, true]) {
        const heading = find(render(), node => node.props.className === 'mobile-conversation-heading');
        assert.equal(text(find(heading, node => node.type === 'h2')), t('companion.conversationHeading'));
        const controls = find(heading, node => node.type === ReadingControls);
        assert.equal(controls.props.showKana, !showKana);
        assert.equal(controls.props.setShowKana, readingPreferences.setShowKana);
        controls.props.setShowKana(showKana);
        const tree = render();
        assert.equal(find(find(tree, node => node.props.className === 'mobile-conversation-heading'), node => node.type === ReadingControls).props.showKana, showKana);
        assert.equal(find(tree, nodeType('Message')).props.readingPreferences.showKana, showKana);
        find(find(tree, node => node.props.className === 'mobile-header'), buttonLabel(t('controls.settings'))).props.onClick();
        const settings = find(render(), nodeType('SettingsPanel'));
        const settingsControls = find(harness(settings.type, settings.props)(), node => node.type === ReadingControls);
        assert.equal(settingsControls.props.showKana, showKana);
        assert.equal(settingsControls.props.setShowKana, readingPreferences.setShowKana);
        find(render(), nodeType('Modal')).props.onClose();
      }
    }
  } finally {
    Object.assign(conversation, original);
    readingPreferences.showKana = originalKana;
    locale = originalLocale;
  }
});

test('switching modal content recovers lost focus without stealing focus during locale changes', () => {
  const originalDocument = globalThis.document;
  const outside = {};
  const control = {};
  const document = { activeElement: outside };
  globalThis.document = document;
  let focused = 0;
  const heading = { focus() { focused++; document.activeElement = heading; } };
  const dialog = {
    open: false,
    showModal() { this.open = true; document.activeElement = control; },
    close() { this.open = false; },
    contains: element => element === heading || element === control,
  };
  try {
    const element = find(harness(Companion)(), nodeType('Modal'));
    const props = { ...element.props, open: true, title: 'Character settings' };
    const render = harness(element.type, props);
    const tree = render();
    tree.props.ref.current = dialog;
    find(tree, node => node.type === 'h2').props.ref.current = heading;
    render.runEffects();
    assert.equal(document.activeElement, control, 'native initial focus is retained');
    document.activeElement = outside;
    render({ ...props, title: 'Practice settings' });
    render.runEffects();
    assert.equal(document.activeElement, heading);
    assert.equal(focused, 1);
    document.activeElement = control;
    render({ ...props, title: '练习设置' });
    render.runEffects();
    assert.equal(document.activeElement, control);
    assert.equal(focused, 1, 'translating the title does not move focus within the dialog');
  } finally {
    globalThis.document = originalDocument;
  }
});
