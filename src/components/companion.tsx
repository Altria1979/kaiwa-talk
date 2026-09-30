'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, MAX_TEXT_LENGTH, type ChatMessage, type LearningReview, type MemoryRecord, type ServiceStatus, type SessionRecord, type Settings } from '../../shared/protocol';
import { api } from '../lib/api';
import { subscribeBrowserCredentials } from '../lib/bailian-credentials';
import { AVATAR_FRAMING_STORAGE_KEY, DEFAULT_AVATAR_FRAMING, parseAvatarFraming } from '../lib/avatar-framing';
import type { AvatarEmotion } from '../../shared/avatar-emotion';
import type { AvatarCapabilities, AvatarCommand } from '../lib/avatar-animation';
import { useConversation } from '../hooks/use-conversation';
import { useConversationScroll } from '../hooks/use-conversation-scroll';
import { useReadingPreferences } from '../hooks/use-reading-preferences';
import { ReadingControls, type ReadingControlsProps } from './reading-aids';
import { MessageReadingAid } from './message-reading-aid';
import { AvatarStage, validateAvatarFile } from './avatar-stage';
import { AvatarControls } from './avatar-controls';
import { Icon } from './icon';
import { ReplySuggestions } from './reply-suggestions';
import { TranscriptPreview } from './transcript-preview';
import { ConversationAudioExport } from './conversation-audio-export';
import { BailianSettings } from './bailian-settings';
import { PaperNavigation, type Panel } from './paper-navigation';
import { useI18n } from '../i18n/provider';
import { LanguageSwitcher } from './language-switcher';
import type { CompanionMessageKey } from '../i18n/messages/companion';
import styles from './companion.module.css';

export function Companion() {
  const { t, formatError, formatNumber } = useI18n();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const readingPreferences = useReadingPreferences();
  const [avatarFraming, setAvatarFraming] = useState(DEFAULT_AVATAR_FRAMING);
  const [avatarEmotionMode, setAvatarEmotionMode] = useState<AvatarEmotion | 'auto'>('neutral');
  const [avatarCommand, setAvatarCommand] = useState<AvatarCommand | null>(null);
  const [avatarCapabilities, setAvatarCapabilities] = useState<AvatarCapabilities>({ ready: false, actions: [], emotions: [], interactions: [] });
  const avatarRequest = useRef(0);
  const updateAvatarCapabilities = useCallback((capabilities: AvatarCapabilities) => {
    setAvatarCapabilities(capabilities);
    if (!capabilities.ready) setAvatarCommand(null);
  }, []);
  const conversation = useConversation({ vadSilenceMs: settings.vadSilenceMs });
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<CompanionMessageKey | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const statusRequest = useRef(0);
  const { chatScroll, chatContent, onScroll, showLatest, scrollToLatest } = useConversationScroll({
    sessionId: conversation.session?.id,
    latestUserMessageId: conversation.messages.findLast(message => message.role === 'user')?.id,
    recognizing: Boolean(conversation.pendingTranscript),
  });
  const active = conversation.active;
  // A running session owns its credentials even if another tab clears storage.
  const ready = active || status?.ready === true;

  useEffect(() => {
    let disposed = false;
    // Read after hydration so the server and first browser render agree.
    queueMicrotask(() => {
      if (disposed) return;
      try { setAvatarFraming(parseAvatarFraming(localStorage.getItem(AVATAR_FRAMING_STORAGE_KEY))); } catch { /* Storage is optional; the control still works. */ }
    });
    return () => { disposed = true; };
  }, []);

  const changeAvatarFraming = (value: number) => {
    setAvatarFraming(value);
    try { localStorage.setItem(AVATAR_FRAMING_STORAGE_KEY, String(value)); } catch { /* Keep the selection for this page when storage is unavailable. */ }
  };

  const refreshStatus = useCallback(async () => {
    const requestId = ++statusRequest.current;
    try {
      const next = await api.status();
      if (requestId === statusRequest.current) setStatus(next);
    } catch (cause) {
      if (requestId === statusRequest.current) setStatus(null);
      throw cause;
    }
  }, []);

  const refreshData = useCallback(async () => {
    const result = await Promise.allSettled([refreshStatus(), api.settings(), api.sessions(), api.memories()]);
    if (result[0].status === 'rejected') setError(result[0].reason);
    else setError(null);
    if (result[1].status === 'fulfilled') setSettings(result[1].value);
    if (result[2].status === 'fulfilled') setSessions(result[2].value);
    if (result[3].status === 'fulfilled') setMemories(result[3].value);
  }, [refreshStatus]);

  useEffect(() => {
    let disposed = false;
    const requests = statusRequest;
    void Promise.allSettled([refreshStatus(), api.settings(), api.sessions(), api.memories()]).then(result => {
      if (disposed) return;
      if (result[0].status === 'rejected') setError(result[0].reason);
      if (result[1].status === 'fulfilled') setSettings(result[1].value);
      if (result[2].status === 'fulfilled') setSessions(result[2].value);
      if (result[3].status === 'fulfilled') setMemories(result[3].value);
    });
    return () => { disposed = true; ++requests.current; };
  }, [refreshStatus]);
  useEffect(() => {
    const timer = setInterval(() => { void refreshStatus().catch(() => {}); }, 10000);
    const unsubscribe = subscribeBrowserCredentials(() => {
      setStatus(null);
      setError(null);
      void refreshStatus().catch((cause: unknown) => setError(cause));
    });
    return () => { clearInterval(timer); unsubscribe(); };
  }, [refreshStatus]);
  useEffect(() => {
    if (conversation.session) void api.sessions().then(setSessions).catch(() => {});
  }, [conversation.session]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [notice]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const sendText = async (text: string, startVoice = false) => {
    if (!text.trim() || busy || !ready) return;
    await perform(async () => {
      if (startVoice) await conversation.start({ voice: true, sessionId: conversation.session?.endedAt ? undefined : conversation.session?.id });
      await conversation.sendText(text.trim());
      scrollToLatest();
      setInput('');
      composer.current?.focus();
    });
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void sendText(input); };
  const translate = async (message: ChatMessage) => {
    if (translating) return;
    setTranslating(message.id);
    try {
      const result = await api.translate(message.id);
      setTranslations((current) => ({ ...current, [message.id]: result.translation }));
    } catch (cause) { setError(cause); } finally { setTranslating(null); }
  };
  const saveSuggestion = async (content: string) => {
    const memory = await api.addMemory(content);
    setMemories((current) => [memory, ...current]);
    setNotice('companion.memorySaved');
  };
  const displayError = error ? formatError(error) : conversation.error ? formatError(conversation.error, conversation.errorDetails) : '';
  const listeningLabel = conversation.muted ? t('companion.muted') : conversation.voiceEnabled ? t('companion.state.listening') : t('companion.textConversation');
  const statusLabel = active ? conversation.state === 'listening' ? listeningLabel : t(`companion.state.${conversation.state}`) : conversation.session ? t('companion.state.idle') : '';
  const errorBanner = displayError && <div className="error-banner" role="alert"><Icon name="info" size={18} /><span>{displayError}</span><button className="icon-button" aria-label={t('companion.dismissError')} onClick={() => { setError(null); conversation.clearError(); }}><Icon name="close" size={16} /></button></div>;
  const latestAssistantId = conversation.messages.findLast(message => message.role === 'assistant')?.id;
  const renderMessage = (message: ChatMessage, autoLoadAid = false) => {
    const currentSuggestions = active && conversation.replySuggestions?.messageId === message.id ? conversation.replySuggestions : null;
    const savedSuggestions = message.replySuggestions?.length ? {
      type: 'reply.suggestions' as const, turnId: message.turnId, messageId: message.id,
      status: 'ready' as const, suggestions: message.replySuggestions, meaningLanguage: message.replySuggestionsLanguage,
    } : null;
    return <Message
      key={message.id}
      readingPreferences={readingPreferences}
      message={message}
      autoLoadAid={autoLoadAid}
      streaming={message.id === conversation.streamingMessageId}
      onReadingAid={conversation.setMessageReadingAid}
      name={settings.characterName}
      translation={translations[message.id] ?? (message.translationLanguage === 'ja' ? message.translation : null)}
      translating={translating === message.id}
      canReplay={active && !busy && conversation.canReplay(message.turnId)}
      onTranslate={() => void translate(message)}
      onReplay={(slow) => void perform(() => conversation.replay(message.turnId, slow))}
    >
      {message.role === 'assistant' && (currentSuggestions ? <ReplySuggestions
        key={message.id}
        value={currentSuggestions}
        learningLanguage={settings.learningLanguage}
        readingPreferences={readingPreferences}
        busy={busy}
        speech={conversation.suggestionSpeech}
        onListen={(index) => conversation.listenSuggestion(message.id, index)}
        onSend={async (index) => {
          if (busy || !ready) return;
          await perform(async () => {
            const sending = conversation.sendSuggestion(message.id, index);
            scrollToLatest();
            setInput('');
            composer.current?.focus();
            await sending;
          });
        }}
      /> : savedSuggestions && <ReplySuggestions
        key={message.id}
        readOnly
        value={savedSuggestions}
        readingPreferences={readingPreferences}
      />)}
    </Message>;
  };
  const renderReview = (review: LearningReview) => review.language !== 'ja' ? <p className="review-pending">{t('companion.reviewUnavailable')}</p> : <Review review={review} memories={memories} onSave={async (content) => {
    try { await saveSuggestion(content); } catch (cause) { setError(cause); throw cause; }
  }} />;

  return <div className={styles.shell}>
    <PaperNavigation panel={panel} onChange={(next) => { setPanel(next); if (next === 'history' || next === 'memories') void refreshData(); }} />
    <main className="workspace">
      {!ready && <div className="config-banner" role="status"><Icon name="info" size={18} /><span>{t(!status ? 'companion.serviceConnecting' : status.credentialSource === 'none' ? 'companion.apiKeyRequired' : 'companion.serviceSetup')}</span><button onClick={() => setPanel('settings')}>{t('companion.openSettings')}<Icon name="arrow" size={15} /></button></div>}
      {!panel && errorBanner}

      <div className="chat-layout">
        <section className="conversation-panel" aria-label={t('companion.currentConversation')}>
          <div className="conversation-body">
            <div className="conversation-scroll" ref={chatScroll} tabIndex={0} aria-label={t('companion.conversationMessages')} onScroll={onScroll}>
              <div className="conversation-content" ref={chatContent}>
                {conversation.messages.map(message => renderMessage(message, message.id === latestAssistantId))}
                <TranscriptPreview text={conversation.pendingTranscript} recognizing={Boolean(conversation.transcript)} />
                {!conversation.messages.length && !conversation.pendingTranscript && <div className="conversation-empty">
                  <span className="conversation-empty-symbol" aria-hidden="true"><Icon name="mic" size={32} /></span>
                  <h2>{t('companion.emptyHeading')}</h2>
                  <p>{t('companion.emptyDescription')}</p>
                  <div className="conversation-starters">{[{ id: 'greeting', label: t('companion.starterGreeting'), text: 'こんにちは！' }, { id: 'introduction', label: t('companion.starterIntroduction'), text: '日本語で自己紹介を練習したいです。' }, { id: 'cafe', label: t('companion.starterCafe'), text: 'カフェで注文する練習をしましょう。' }].map(starter => <button key={starter.id} disabled={!ready || busy} onClick={() => void sendText(starter.text, true)}>{starter.label}<Icon name="arrow" size={13} /></button>)}</div>
                </div>}
                {conversation.session?.review && renderReview(conversation.session.review)}
                {conversation.session?.endedAt && !conversation.session.review && <p className="review-pending" role="status"><Icon name="spark" size={15} />{t('companion.reviewPending')}</p>}
              </div>
            </div>
            {showLatest && <button className="latest-message" aria-label={t('companion.latestMessage')} onClick={scrollToLatest}>{t('companion.latestMessageButton')}</button>}
          </div>
          <div className="conversation-footer">
            {conversation.recording && conversation.recording.sessionId === conversation.session?.id && <ConversationAudioExport key={conversation.recording.sessionId} recording={conversation.recording} />}
            <div className="composer-row">
              <div className="conversation-start">
                {active && conversation.voiceEnabled ? <button type="button" className="primary-button end-button" onClick={() => void perform(conversation.end)} disabled={busy}><Icon name="stop" size={14} />{t('companion.endConversation')}</button> : <button type="button" className="primary-button" onClick={() => void perform(() => conversation.start({ voice: true, sessionId: conversation.session?.endedAt ? undefined : conversation.session?.id }))} disabled={!ready || busy}><Icon name="mic" size={16} />{busy ? t('companion.connecting') : active ? t('companion.enableVoice') : t('companion.startConversation')}</button>}
              </div>
              <form id="text-composer" className="composer" onSubmit={submit}>
                <label className="sr-only" htmlFor="message-input">{t('companion.messageInput')}</label>
                <textarea ref={composer} id="message-input" value={input} maxLength={MAX_TEXT_LENGTH} onChange={(event) => setInput(event.target.value)} placeholder={t('companion.messagePlaceholder')} rows={1} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendText(input); } }} />
                <button className="send-button" type="submit" aria-label={t('companion.sendMessage')} disabled={!input.trim() || !ready || busy}><Icon name="send" size={18} /></button>
              </form>
              <div className="composer-secondary-controls">
                <button type="button" className={`round-control ${conversation.muted ? 'is-muted' : ''}`} aria-label={conversation.muted ? t('companion.unmute') : t('companion.mute')} title={conversation.muted ? t('companion.unmute') : t('companion.mute')} aria-pressed={conversation.muted} disabled={!active || !conversation.voiceEnabled} onClick={conversation.toggleMute}><Icon name={conversation.muted ? 'mic-off' : 'mic'} size={18} /></button>
                <button type="button" className="round-control" aria-label={t('companion.stopReply')} title={t('companion.stopReply')} disabled={!active || !['thinking', 'speaking'].includes(conversation.state)} onClick={conversation.cancel}><Icon name="pause" size={15} /></button>
                {active && !conversation.voiceEnabled && <button type="button" className="text-button" onClick={() => void perform(conversation.end)} disabled={busy}>{t('companion.endConversation')}</button>}
              </div>
            </div>
            <span className="composer-hint">{t('companion.composerHint')}</span>
          </div>
        </section>

        <aside className="companion-stage" aria-label={t('companion.virtualPartner')}>
          <div className="stage-heading"><h2>{settings.characterName}</h2><span className={`presence-badge state-${conversation.state}`} role="status"><i />{statusLabel || t('companion.practiceTogether')}</span></div>
          <div className="character-stage">
            <div className="scene-wash" aria-hidden="true" />
            <AvatarStage avatarUrl={settings.avatarUrl} state={conversation.state} audioLevelRef={conversation.audioLevelRef} name={settings.characterName} framing={avatarFraming} caption={conversation.playbackCaption}
              emotion={avatarEmotionMode === 'auto' ? conversation.avatarEmotion : avatarEmotionMode}
              command={avatarCommand} onCapabilities={updateAvatarCapabilities} />
          </div>
          <details className="avatar-settings">
            <summary><Icon name="settings" size={16} /><span>{t('controls.avatarSettings')}</span><Icon name="chevron" size={16} /></summary>
            <div className="avatar-settings-content">
              <AvatarControls capabilities={avatarCapabilities} emotionMode={avatarEmotionMode} onEmotionChange={setAvatarEmotionMode}
                onAction={(action) => setAvatarCommand({ id: ++avatarRequest.current, kind: 'action', action })}
                onInteraction={(target) => setAvatarCommand({ id: ++avatarRequest.current, kind: 'interaction', target })} />
              <div className="avatar-size-control">
                <div className="avatar-size-heading"><label htmlFor="avatar-framing">{t('companion.avatarSize')}</label><button className="text-button" type="button" onClick={() => changeAvatarFraming(DEFAULT_AVATAR_FRAMING)}>{t('companion.reset')}</button></div>
                <input id="avatar-framing" type="range" min={0} max={100} step={1} value={Math.round(avatarFraming * 100)} aria-valuetext={avatarFraming === 0 ? t('companion.fullBody') : avatarFraming === 1 ? t('companion.bust') : t('companion.framingValue', { percent: formatNumber(avatarFraming, { style: 'percent' }) })} onChange={(event) => changeAvatarFraming(Number(event.target.value) / 100)} />
                <div className="avatar-size-labels" aria-hidden="true"><span>{t('companion.fullBody')}</span><span>{t('companion.bust')}</span></div>
              </div>
              <button className="text-button companion-settings" onClick={() => setPanel('settings')}>{t('companion.practiceSettings')}<Icon name="arrow" size={14} /></button>
            </div>
          </details>
        </aside>
      </div>
    </main>

    <Modal open={panel !== null} onClose={() => setPanel(null)} title={panel === 'settings' ? t('companion.practiceSettings') : panel === 'history' ? t('companion.history') : t('companion.memoriesTitle')}>
      {panel && errorBanner}
      {panel === 'settings' && <SettingsPanel readingPreferences={readingPreferences} settings={settings} status={status} active={active} onSave={async (value) => { const saved = await api.saveSettings(value); setSettings(saved); setNotice('companion.settingsSavedNotice'); }} onAvatar={async (file) => { await validateAvatarFile(file); const result = await api.uploadAvatar(file); setSettings((current) => ({ ...current, avatarUrl: result.avatarUrl })); setNotice('companion.avatarChanged'); }} onRefresh={refreshData} />}
      {panel === 'history' && <HistoryPanel sessions={sessions} currentSession={conversation.session} currentMessages={conversation.messages} renderMessage={renderMessage} renderReview={renderReview} onSelectHistory={conversation.clearAvatarEmotion} />}
      {panel === 'memories' && <MemoryPanel memories={memories} onChange={setMemories} />}
    </Modal>
    {notice && <div className="toast" role="status"><Icon name="check" size={17} />{t(notice)}</div>}
  </div>;
}

function HistoryPanel({ sessions, currentSession, currentMessages, renderMessage, renderReview, onSelectHistory }: {
  sessions: SessionRecord[];
  currentSession: SessionRecord | null;
  currentMessages: ChatMessage[];
  renderMessage: (message: ChatMessage) => ReactNode;
  renderReview: (review: LearningReview) => ReactNode;
  onSelectHistory: () => void;
}) {
  const { t, formatDate, formatError } = useI18n();
  const formatSessionTitle = (date: string) => t('companion.sessionTitle', { date: formatDate(date, { month: 'long', day: 'numeric' }) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ session: SessionRecord; messages: ChatMessage[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const isCurrent = selectedId !== null && selectedId === currentSession?.id;
  useEffect(() => {
    if (!selectedId || isCurrent) return;
    let disposed = false;
    void api.session(selectedId).then(result => {
      if (!disposed) setLoaded(result);
    }).catch(cause => { if (!disposed) setError(cause); });
    return () => { disposed = true; };
  }, [selectedId, isCurrent, retry]);
  const select = (id: string | null) => { if (id !== null && id !== selectedId) onSelectHistory(); setSelectedId(id); setLoaded(null); setError(null); };
  const session = isCurrent ? currentSession : loaded?.session.id === selectedId ? loaded.session : null;
  const messages = isCurrent ? currentMessages : loaded?.messages ?? [];

  if (selectedId) return <div className="history-detail">
    <div className="history-detail-heading"><button className="text-button" onClick={() => select(null)}>{t('companion.backToList')}</button>{session && <span>{isCurrent ? t('companion.thisConversation') : formatSessionTitle(session.createdAt)}</span>}</div>
    {error ? <div className="form-error" role="alert"><p>{formatError(error)}</p><button className="text-button" onClick={() => { setError(null); setRetry(value => value + 1); }}>{t('companion.retry')}</button></div> : session ? <HistoryMessages key={selectedId} session={session} messages={messages} renderMessage={renderMessage} renderReview={renderReview} /> : <p role="status" className="panel-intro">{t('companion.loading')}</p>}
  </div>;

  const previous = sessions.filter(session => session.id !== currentSession?.id);
  return <div className="history-list">
    {currentSession && <button className="history-item current" onClick={() => select(currentSession.id)}><span className="history-symbol"><Icon name="headphones" size={21} /></span><span className="history-item-content"><strong>{t('companion.thisConversation')}</strong><small>{currentSession.endedAt ? t('companion.state.idle') : t('companion.inConversation')} · {formatDate(currentSession.createdAt)}</small></span><Icon name="chevron" size={18} /></button>}
    {previous.map(session => <button key={session.id} className="history-item" onClick={() => select(session.id)}><span className="history-symbol"><Icon name={session.review ? 'spark' : 'history'} size={21} /></span><span className="history-item-content"><strong>{formatSessionTitle(session.createdAt)}</strong><small>{formatDate(session.createdAt)}{session.review ? t('companion.reviewAvailable') : ''}</small></span><Icon name="chevron" size={18} /></button>)}
    {!currentSession && previous.length === 0 && <p className="panel-empty">{t('companion.noHistory')}</p>}
  </div>;
}

function HistoryMessages({ session, messages, renderMessage, renderReview }: {
  session: SessionRecord;
  messages: ChatMessage[];
  renderMessage: (message: ChatMessage) => ReactNode;
  renderReview: (review: LearningReview) => ReactNode;
}) {
  const { t } = useI18n();
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, session.review]);
  return <div className="chat-scroll" ref={scroll} onScroll={() => { const node = scroll.current; if (node) nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
    {messages.length ? messages.map(message => renderMessage(message)) : <p className="panel-empty">{t('companion.noMessages')}</p>}
    {session.review && renderReview(session.review)}
    {session.endedAt && !session.review && <p className="review-pending" role="status">{t('companion.reviewPending')}</p>}
  </div>;
}

function Message({ message, name, translation, translating, canReplay, onTranslate, onReplay, children, readingPreferences, autoLoadAid, streaming, onReadingAid }: { readingPreferences: ReadingControlsProps; children?: ReactNode; message: ChatMessage; name: string; translation: string | null; translating: boolean; canReplay: boolean; onTranslate: () => void; onReplay: (slow?: boolean) => void; autoLoadAid: boolean; streaming: boolean; onReadingAid: (messageId: string, content: string, aid: NonNullable<ChatMessage['readingAid']>) => void }) {
  const { t } = useI18n();
  const isAssistant = message.role === 'assistant';
  return <article className={`message ${isAssistant ? 'assistant-message' : 'user-message'}`}>
    <div className="message-meta">{isAssistant && <span className="message-avatar">A</span>}<span>{isAssistant ? name : t('companion.you')}</span>{message.interrupted && <small>{t('companion.interrupted')}</small>}{message.delivery === 'voice' && !isAssistant && <Icon name="mic" size={12} />}</div>
    <div className="message-bubble"><p>{message.content || '…'}</p>{isAssistant && <MessageReadingAid message={message} autoLoad={autoLoadAid} streaming={streaming} showKana={readingPreferences.showKana} onReady={onReadingAid} />}{translation && <div className="message-translation"><Icon name="translate" size={13} /><span lang="ja">{translation}</span></div>}</div>
    {isAssistant && message.content && <div className="message-actions"><button onClick={() => onReplay()} disabled={!canReplay} title={canReplay ? t('companion.replayTitle') : t('companion.replayUnavailable')}><Icon name="volume" size={14} />{t('companion.replay')}</button><button onClick={() => onReplay(true)} disabled={!canReplay}><Icon name="slow" size={14} />{t('companion.listenSlowly')}</button><button onClick={onTranslate} disabled={translating || !!translation}><Icon name="translate" size={14} />{translating ? t('companion.preparingExplanation') : translation ? t('companion.explained') : t('companion.explainJapanese')}</button></div>}
    {children}
  </article>;
}

function Review({ review, memories, onSave }: { review: LearningReview; memories: MemoryRecord[]; onSave: (content: string) => Promise<void> }) {
  const { t, formatNumber } = useI18n();
  const [saving, setSaving] = useState<string | null>(null);
  return <section className="learning-review" aria-label={t('companion.learningReview')}><div className="review-title"><Icon name="spark" size={18} /><h3>{t('companion.reviewHeading')}</h3></div><p className="review-topic" lang="ja">{review.topic}</p><h4>{t('companion.reusableExpressions')}</h4><ol>{review.expressions.slice(0, 3).map((expression, index) => <li key={`${expression.text}-${index}`}><span>{formatNumber(index + 1, { minimumIntegerDigits: 2 })}</span><div><strong>{expression.text}</strong><p lang="ja">{expression.meaning}</p></div></li>)}</ol><div className="improvement"><span>{t('companion.improvementTip')}</span><p lang="ja">{review.improvement}</p></div>{review.memorySuggestions.length > 0 && <div className="memory-suggestions"><h4>{t('companion.rememberPrompt')}</h4>{review.memorySuggestions.map((suggestion) => { const saved = memories.some((memory) => memory.content === suggestion); return <div key={suggestion}><p lang="ja">{suggestion}</p><button disabled={saved || saving === suggestion} className="text-button" onClick={() => { setSaving(suggestion); void onSave(suggestion).catch(() => {}).finally(() => setSaving(null)); }}><Icon name={saved ? 'check' : 'plus'} size={14} />{saved ? t('companion.saved') : saving === suggestion ? t('companion.saving') : t('companion.remember')}</button></div>; })}</div>}</section>;
}

function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  return <dialog ref={dialog} className="panel-dialog" aria-labelledby={titleId} onCancel={onClose} onClick={(event) => { if (event.target === dialog.current) { const bounds = dialog.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}><div className="panel-header"><div><h2 id={titleId}>{title}</h2></div><LanguageSwitcher /><button className="icon-button" aria-label={t('companion.closePanel')} onClick={onClose}><Icon name="close" size={22} /></button></div><div className="panel-body">{children}</div></dialog>;
}

function SettingsPanel({ settings, status, active, onSave, onAvatar, onRefresh, readingPreferences }: { readingPreferences: ReadingControlsProps; settings: Settings; status: ServiceStatus | null; active: boolean; onSave: (settings: Settings) => Promise<void>; onAvatar: (file: File) => Promise<void>; onRefresh: () => Promise<void> }) {
  const { t, formatError, formatNumber } = useI18n();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [modelName, setModelName] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => { setDraft((current) => ({ ...current, [key]: value })); setSaved(false); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await onSave({ ...draft, supportLanguage: '日本語', avatarUrl: settings.avatarUrl }); setSaved(true); } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  return <>
    <section className="reading-settings" aria-labelledby="reading-settings-title">
      <h3 id="reading-settings-title">{t('companion.readingDisplay')}</h3>
      <p className="field-help">{t('companion.readingDescription')}</p>
      <ReadingControls {...readingPreferences} />
      <p className="field-help">{t('companion.readingPersistence')}</p>
    </section>
    <BailianSettings status={status} active={active} onRefresh={onRefresh} />
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
    {Boolean(error) && <p className="form-error" role="alert">{formatError(error)}</p>}
    <div className="settings-section"><h3><span>{formatNumber(1, { minimumIntegerDigits: 2 })}</span>{t('companion.partnerAppearance')}</h3><div className="avatar-setting"><span className="avatar-setting-symbol">A</span><div><strong>{modelName || (settings.avatarUrl === '/models/default.vrm' ? t('companion.defaultAvatar') : t('companion.customAvatar'))}</strong><p>{t('companion.avatarRequirements')}</p></div><button type="button" className="secondary-button" disabled={uploading || active} onClick={() => upload.current?.click()}><Icon name="upload" size={16} />{uploading ? t('companion.loading') : t('companion.change')}</button><input ref={upload} type="file" accept=".vrm" className="sr-only" aria-label={t('companion.uploadAvatar')} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setUploading(true); setError(null); void onAvatar(file).then(() => setModelName(file.name)).catch((cause: unknown) => setError(cause)).finally(() => setUploading(false)); }} /></div><p className="field-help">{t('companion.avatarHelp')}</p></div>
    <div className="settings-section"><h3><span>{formatNumber(2, { minimumIntegerDigits: 2 })}</span>{t('companion.partnerProfile')}</h3><label className="field">{t('companion.name')}<input required maxLength={30} value={draft.characterName} onChange={(event) => set('characterName', event.target.value)} /></label><label className="field">{t('companion.personality')}<textarea required maxLength={1000} rows={3} value={draft.persona} onChange={(event) => set('persona', event.target.value)} /></label></div>
    <div className="settings-section"><h3><span>{formatNumber(3, { minimumIntegerDigits: 2 })}</span>{t('companion.practicePreferences')}</h3><p className="field-help">{t('companion.voiceLanguageHelp')}</p><div className="field-grid"><label className="field">{t('companion.learningLanguage')}<select value={draft.learningLanguage} onChange={(event) => set('learningLanguage', event.target.value)}><option value="日本語">{t('companion.language.japanese')}</option><option value="英語">{t('companion.language.english')}</option><option value="韓国語">{t('companion.language.korean')}</option><option value="フランス語">{t('companion.language.french')}</option><option value="ドイツ語">{t('companion.language.german')}</option><option value="スペイン語">{t('companion.language.spanish')}</option></select></label><label className="field">{t('companion.explanationLanguage')}<input value={t('companion.language.japanese')} readOnly /><span className="field-help">{t('companion.explanationHelp')}</span></label></div><label className="field">{t('companion.practiceLevel')}<select value={draft.japaneseLevel} onChange={(event) => set('japaneseLevel', event.target.value as Settings['japaneseLevel'])}><option value="beginner">{t('companion.beginner')}</option><option value="intermediate">{t('companion.intermediate')}</option><option value="advanced">{t('companion.advanced')}</option></select></label><div className="field-grid"><label className="field">{t('companion.voiceType')}<input required maxLength={80} value={draft.voice} onChange={(event) => set('voice', event.target.value)} /><span className="field-help">{t('companion.voiceHelp')}</span></label><label className="field">{t('companion.silenceWait')}<select value={draft.vadSilenceMs} onChange={(event) => set('vadSilenceMs', Number(event.target.value))}>{[600, 800, 1200, 1600, 2000, 3000].map((value) => <option key={value} value={value}>{t('companion.seconds', { value: formatNumber(value / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}{value === 1600 ? t('companion.defaultSuffix') : ''}</option>)}</select><span className="field-help">{t('companion.silenceHelp')}</span></label></div></div>
    {active && <p className="inline-info">{t('companion.endBeforeSettings')}</p>}
    <div className="panel-save"><span>{saved ? t('companion.settingsSaved') : t('companion.localStorageHelp')}</span><button className="primary-button" disabled={busy || uploading || active}><Icon name={saved ? 'check' : 'arrow'} size={17} />{busy ? t('companion.savingProgress') : t('companion.saveSettings')}</button></div>
  </form></>;
}

function MemoryPanel({ memories, onChange }: { memories: MemoryRecord[]; onChange: (memories: MemoryRecord[]) => void }) {
  const { t, formatDate, formatError } = useI18n();
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (cause) { setError(cause); } finally { setBusy(false); } };
  return <div className="memories-panel"><p className="panel-intro">{t('companion.memoryIntro')}<br />{t('companion.memoryIntroPersistence')}</p>{Boolean(error) && <p className="form-error" role="alert">{formatError(error)}</p>}<form className="memory-form" onSubmit={(event) => { event.preventDefault(); if (!content.trim()) return; void action(async () => { const memory = await api.addMemory(content.trim()); onChange([memory, ...memories]); setContent(''); }); }}><label className="field" htmlFor="new-memory">{t('companion.newMemory')}<textarea id="new-memory" maxLength={1000} rows={3} placeholder={t('companion.memoryPlaceholder')} value={content} onChange={(event) => setContent(event.target.value)} /></label><button className="secondary-button" disabled={busy || !content.trim()}><Icon name="plus" size={16} />{t('companion.addMemory')}</button></form>{memories.length === 0 && <div className="panel-empty"><Icon name="memory" size={32} /><h3>{t('companion.memoryEmptyHeading')}</h3><p>{t('companion.memoryEmptyDescription')}</p></div>}<div className="memory-list">{memories.map((memory) => <div className="memory-item" key={memory.id}>{editing === memory.id ? <form onSubmit={(event) => { event.preventDefault(); if (!editContent.trim()) return; void action(async () => { const updated = await api.updateMemory(memory.id, editContent.trim()); onChange(memories.map((item) => item.id === updated.id ? updated : item)); setEditing(null); }); }}><textarea aria-label={t('companion.editMemory')} maxLength={1000} rows={3} value={editContent} onChange={(event) => setEditContent(event.target.value)} /><div className="memory-edit-actions"><button type="button" className="text-button" onClick={() => setEditing(null)}>{t('companion.cancel')}</button><button className="secondary-button" disabled={busy || !editContent.trim()}>{t('companion.save')}</button></div></form> : <><div className="memory-content"><Icon name="memory" size={17} /><p>{memory.content}</p></div><div className="memory-item-footer"><span>{formatDate(memory.updatedAt)}</span><div><button className="icon-button" aria-label={t('companion.editMemoryLabel', { content: memory.content })} disabled={busy} onClick={() => { setEditing(memory.id); setEditContent(memory.content); }}><Icon name="edit" size={16} /></button><button className="icon-button delete-button" aria-label={t('companion.deleteMemoryLabel', { content: memory.content })} disabled={busy} onClick={() => void action(async () => { await api.deleteMemory(memory.id); onChange(memories.filter((item) => item.id !== memory.id)); })}><Icon name="trash" size={16} /></button></div></div></>}</div>)}</div></div>;
}
