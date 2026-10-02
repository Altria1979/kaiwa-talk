'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { DEFAULT_SETTINGS, MAX_TEXT_LENGTH, type ChatMessage, type LearningReview, type ServiceStatus, type Settings } from '../../shared/protocol';
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
import { AvatarStage } from './avatar-stage';
import { AvatarControls } from './avatar-controls';
import { Icon } from './icon';
import { ReplySuggestions } from './reply-suggestions';
import { TranscriptPreview } from './transcript-preview';
import { ConversationAudioExport } from './conversation-audio-export';
import { BailianSettings } from './bailian-settings';
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
  const [panel, setPanel] = useState<'settings' | 'avatar' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<CompanionMessageKey | null>(null);
  const [input, setInput] = useState('');
  const [textExpanded, setTextExpanded] = useState(false);
  const [stageCollapsed, setStageCollapsed] = useState(false);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const textToggle = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState<string | null>(null);
  const statusRequest = useRef(0);
  const active = conversation.active;
  const voiceActive = active && conversation.voiceEnabled;
  const showInput = !voiceActive || textExpanded;
  const welcome = !active && !conversation.session && !conversation.messages.length && !conversation.pendingTranscript;
  const { chatScroll, chatContent, onScroll, showLatest, scrollToLatest } = useConversationScroll({
    enabled: !welcome,
    sessionId: conversation.session?.id,
    latestUserMessageId: conversation.messages.findLast(message => message.role === 'user')?.id,
    recognizing: Boolean(conversation.pendingTranscript),
  });
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

  useEffect(() => {
    if (textExpanded) messageInput.current?.focus();
  }, [textExpanded]);

  const hideInput = () => {
    setTextExpanded(false);
    textToggle.current?.focus();
  };

  const startVoice = () => perform(async () => {
    await conversation.start({ voice: true, sessionId: conversation.session?.endedAt ? undefined : conversation.session?.id });
    setTextExpanded(false);
  });

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
    const result = await Promise.allSettled([refreshStatus(), api.settings()]);
    if (result[0].status === 'rejected') setError(result[0].reason);
    else setError(null);
    if (result[1].status === 'fulfilled') setSettings(result[1].value);
  }, [refreshStatus]);

  useEffect(() => {
    let disposed = false;
    const requests = statusRequest;
    void Promise.allSettled([refreshStatus(), api.settings()]).then(result => {
      if (disposed) return;
      if (result[0].status === 'rejected') setError(result[0].reason);
      if (result[1].status === 'fulfilled') setSettings(result[1].value);
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
      if (voiceActive || startVoice) hideInput();
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
  const renderReview = (review: LearningReview) => review.language !== 'ja' ? <p className="review-pending">{t('companion.reviewUnavailable')}</p> : <Review review={review} />;

  const startButton = <button type="button" className="primary-button" onClick={() => void startVoice()} disabled={!ready || busy}><Icon name="mic" size={18} />{busy ? t('companion.connecting') : active ? t('companion.enableVoice') : t('companion.startConversation')}</button>;
  const textComposer = <form id="text-composer" className="composer" onSubmit={submit} hidden={!showInput}>
    <label className="sr-only" htmlFor="message-input">{t('companion.messageInput')}</label>
    {showInput && <textarea ref={messageInput} id="message-input" value={input} maxLength={MAX_TEXT_LENGTH} onChange={(event) => setInput(event.target.value)} placeholder={t(welcome ? 'companion.landingPlaceholder' : 'companion.messagePlaceholder')} rows={1} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && voiceActive) { event.preventDefault(); hideInput(); }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendText(input); }
    }} />}
    <button className="send-button" type="submit" aria-label={t('companion.sendMessage')} disabled={!input.trim() || !ready || busy}><Icon name="send" size={18} /></button>
  </form>;

  return <div className={styles.shell} data-welcome={welcome} data-stage-collapsed={stageCollapsed}>
    <main className="workspace">
      <header className="mobile-header">
        <button type="button" className="icon-button" aria-label={t('controls.avatarSettings')} aria-haspopup="dialog" onClick={() => setPanel('avatar')}><Icon name="spark" size={23} /></button>
        <div><h1>{t('common.title').split(' · ')[0]}</h1><p>{t('companion.mobileSubtitle')}</p></div>
        <button type="button" className="icon-button" aria-label={t('controls.settings')} aria-haspopup="dialog" onClick={() => setPanel('settings')}><Icon name="settings" size={24} /></button>
      </header>
      {!ready && <div className="config-banner" role="status"><Icon name="info" size={18} /><span>{t(!status ? 'companion.serviceConnecting' : status.credentialSource === 'none' ? 'companion.apiKeyRequired' : 'companion.serviceSetup')}</span><button onClick={() => setPanel('settings')}>{t('companion.openSettings')}<Icon name="arrow" size={15} /></button></div>}
      {!panel && errorBanner}

      <div className="chat-layout">
        <section className="conversation-panel" aria-label={t('companion.currentConversation')}>
          <div className="mobile-conversation-heading"><h2>{t('companion.conversationHeading')}</h2><ReadingControls {...readingPreferences} /></div>
          <div className="conversation-body">
            <div className="conversation-scroll" ref={chatScroll} tabIndex={0} aria-label={t('companion.conversationMessages')} onScroll={onScroll}>
              <div className="conversation-content" ref={chatContent}>
                {conversation.messages.map(message => renderMessage(message, message.id === latestAssistantId))}
                <TranscriptPreview text={conversation.pendingTranscript} recognizing={Boolean(conversation.transcript)} />
                {!conversation.messages.length && !conversation.pendingTranscript && <div className="conversation-empty">
                  <div className="garden-heading"><Icon name="leaf" size={26} /><span>{t('companion.gardenEyebrow')}</span></div>
                  <h2>{t('companion.emptyHeading')}</h2>
                  <p>{t('companion.emptyDescription')}</p>
                  <div className="welcome-actions">{welcome && startButton}<span className="garden-note">{t(!active ? 'companion.gardenNote' : !voiceActive ? 'companion.textConversation' : conversation.muted ? 'companion.muted' : 'companion.voiceStarting')}</span></div>
                  <span className="topic-prompt">{t('companion.topicPrompt')}</span>
                  <div className="conversation-starters">{[{ id: 'greeting', label: t('companion.starterGreeting'), text: 'こんにちは！' }, { id: 'introduction', label: t('companion.starterIntroduction'), text: '日本語で自己紹介を練習したいです。' }, { id: 'cafe', label: t('companion.starterCafe'), text: 'カフェで注文する練習をしましょう。' }].map(starter => <button key={starter.id} disabled={!ready || busy} onClick={() => void sendText(starter.text, true)}>{starter.label}<Icon name="arrow" size={13} /></button>)}</div>
                  {welcome && <div className="welcome-composer">{textComposer}</div>}
                </div>}
                {conversation.session?.review && renderReview(conversation.session.review)}
                {conversation.session?.endedAt && !conversation.session.review && <p className="review-pending" role="status"><Icon name="spark" size={15} />{t('companion.reviewPending')}</p>}
              </div>
            </div>
            {showLatest && conversation.messages.length > 0 && <button className="latest-message" aria-label={t('companion.latestMessage')} onClick={scrollToLatest}>{t('companion.latestMessageButton')}</button>}
          </div>
          {!welcome && <div className="conversation-footer" data-voice={voiceActive}>
            {conversation.recording && conversation.recording.sessionId === conversation.session?.id && <ConversationAudioExport key={conversation.recording.sessionId} recording={conversation.recording} />}
            <div className="composer-row">
              {textComposer}
              <div className="conversation-controls">
                {active && <div className="conversation-status" role="status" data-state={conversation.muted ? 'muted' : conversation.state}>
                  <span className="voice-indicator" aria-hidden="true"><i /><i /><i /></span>
                  <span>{statusLabel}</span>
                </div>}
                {!voiceActive && <div className="conversation-start">{startButton}</div>}
                <div className="composer-secondary-controls">
                  {voiceActive && <>
                    <button type="button" className={`round-control voice-control ${conversation.muted ? 'is-muted' : ''}`} aria-label={conversation.muted ? t('companion.unmute') : t('companion.mute')} title={conversation.muted ? t('companion.unmute') : t('companion.mute')} aria-pressed={conversation.muted} onClick={conversation.toggleMute}><Icon name={conversation.muted ? 'mic-off' : 'mic'} size={18} /></button>
                    <button ref={textToggle} type="button" className="text-input-toggle" aria-label={t(textExpanded ? 'companion.hideInput' : 'companion.typeMessage')} aria-expanded={textExpanded} aria-controls="text-composer" onClick={() => textExpanded ? hideInput() : setTextExpanded(true)}><Icon name="keyboard" size={18} /><span>{t(textExpanded ? 'companion.hideInput' : 'companion.typeMessage')}</span>{!textExpanded && input.trim() && <span className="draft-dot" role="img" aria-label={t('companion.draftSaved')} />}</button>
                  </>}
                  {active && ['thinking', 'speaking'].includes(conversation.state) && <button type="button" className="round-control interrupt-control" aria-label={t('companion.stopReply')} title={t('companion.stopReply')} onClick={conversation.cancel}><Icon name="pause" size={15} /></button>}
                  {active && <button type="button" className="end-call" aria-label={t('companion.endConversation')} title={t('companion.endConversation')} onClick={() => void perform(conversation.end)} disabled={busy}><Icon name="stop" size={14} /><span>{t('companion.endConversation')}</span></button>}
                </div>
              </div>
              {showInput && <span className="composer-hint">{t('companion.composerHint')}</span>}
            </div>
          </div>}
          {welcome && <div className="mobile-welcome-dock">
            <button type="button" className="round-control" aria-label={t('companion.typeMessage')} onClick={() => messageInput.current?.focus()}><Icon name="keyboard" size={23} /></button>
            <div className="mobile-start-voice">{startButton}<span>{t(busy ? 'companion.connecting' : 'companion.startConversation')}</span></div>
            <button type="button" className="round-control" aria-label={t('companion.practiceSettings')} aria-haspopup="dialog" onClick={() => setPanel('settings')}><Icon name="settings" size={22} /></button>
          </div>}

        </section>

        <aside className="companion-stage" aria-label={t('companion.virtualPartner')}>
          <div className="character-stage" id="character-stage">
            <AvatarStage avatarUrl={DEFAULT_SETTINGS.avatarUrl} state={conversation.state} audioLevelRef={conversation.audioLevelRef} name={settings.characterName} framing={avatarFraming} caption={conversation.playbackCaption}
              emotion={avatarEmotionMode === 'auto' ? conversation.avatarEmotion : avatarEmotionMode}
              command={avatarCommand} onCapabilities={updateAvatarCapabilities} />
          </div>
          <div className="mobile-stage-footer">
            <div className="practice-badge"><span>{t('companion.dailyPractice')}</span><strong>{t(`companion.level.${settings.japaneseLevel}`)}</strong></div>
            <button type="button" className="stage-collapse" aria-label={t(stageCollapsed ? 'companion.expandCharacter' : 'companion.collapseCharacter')} aria-expanded={!stageCollapsed} aria-controls="character-stage" onClick={() => setStageCollapsed(value => !value)}><Icon name="chevron" size={20} /></button>
          </div>
          <div className="workspace-tools">
            <button type="button" className="icon-button" aria-label={t('controls.avatarSettings')} title={t('controls.avatarSettings')} aria-haspopup="dialog" onClick={() => setPanel('avatar')}><Icon name="spark" size={22} /></button>
            <button type="button" className="workspace-settings" aria-label={t('controls.settings')} title={t('controls.settings')} aria-haspopup="dialog" onClick={() => setPanel('settings')}><Icon name="settings" size={20} /><span>{t('controls.settings')}</span></button>
          </div>
        </aside>
      </div>
      {welcome && <p className="landing-signoff">{t('companion.landingSignoff')}</p>}
    </main>

    <Modal open={panel !== null} onClose={() => setPanel(null)} title={t(panel === 'avatar' ? 'controls.avatarSettings' : 'companion.practiceSettings')}>
      {panel && errorBanner}
      {panel === 'avatar' && (
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
      )}
      {panel === 'settings' && <SettingsPanel readingPreferences={readingPreferences} settings={settings} status={status} active={active} onSave={async (value) => { const saved = await api.saveSettings(value); setSettings(saved); setNotice('companion.settingsSavedNotice'); }} onRefresh={refreshData} />}
    </Modal>
    {notice && <div className="toast" role="status"><Icon name="check" size={17} />{t(notice)}</div>}
  </div>;
}

function Message({ message, name, translation, translating, canReplay, onTranslate, onReplay, children, readingPreferences, autoLoadAid, streaming, onReadingAid }: { readingPreferences: ReadingControlsProps; children?: ReactNode; message: ChatMessage; name: string; translation: string | null; translating: boolean; canReplay: boolean; onTranslate: () => void; onReplay: (slow?: boolean) => void; autoLoadAid: boolean; streaming: boolean; onReadingAid: (messageId: string, content: string, aid: NonNullable<ChatMessage['readingAid']>) => void }) {
  const { t } = useI18n();
  const isAssistant = message.role === 'assistant';
  return <article className={`message ${isAssistant ? 'assistant-message' : 'user-message'}`}>
    <div className="message-meta">{isAssistant && <span className="message-avatar" aria-hidden="true"><Image src="/violet-avatar.png" alt="" width={36} height={36} unoptimized /></span>}<span>{isAssistant ? name : t('companion.you')}</span>{message.interrupted && <small>{t('companion.interrupted')}</small>}{message.delivery === 'voice' && !isAssistant && <Icon name="mic" size={12} />}</div>
    <div className="message-bubble"><p>{message.content || '…'}</p>{isAssistant && <MessageReadingAid message={message} autoLoad={autoLoadAid} streaming={streaming} showKana={readingPreferences.showKana} onReady={onReadingAid} />}{translation && <div className="message-translation"><Icon name="translate" size={13} /><span lang="ja">{translation}</span></div>}</div>
    <div className="message-footer">
      {isAssistant && message.content && <div className="message-actions"><button onClick={() => onReplay()} disabled={!canReplay} title={canReplay ? t('companion.replayTitle') : t('companion.replayUnavailable')}><Icon name="volume" size={14} />{t('companion.replay')}</button><button onClick={() => onReplay(true)} disabled={!canReplay}><Icon name="slow" size={14} />{t('companion.listenSlowly')}</button><button onClick={onTranslate} disabled={translating || !!translation}><Icon name="translate" size={14} />{translating ? t('companion.preparingExplanation') : translation ? t('companion.explained') : t('companion.explainJapanese')}</button></div>}
      {children}
    </div>
  </article>;
}

function Review({ review }: { review: LearningReview }) {
  const { t, formatNumber } = useI18n();
  return <section className="learning-review" aria-label={t('companion.learningReview')}>
    <div className="review-title"><Icon name="spark" size={18} /><h3>{t('companion.reviewHeading')}</h3></div>
    <p className="review-topic" lang="ja">{review.topic}</p>
    <h4>{t('companion.reusableExpressions')}</h4>
    <ol>{review.expressions.slice(0, 3).map((expression, index) => <li key={`${expression.text}-${index}`}>
      <span>{formatNumber(index + 1, { minimumIntegerDigits: 2 })}</span>
      <div><strong>{expression.text}</strong><p lang="ja">{expression.meaning}</p></div>
    </li>)}</ol>
    <div className="improvement"><span>{t('companion.improvementTip')}</span><p lang="ja">{review.improvement}</p></div>
  </section>;
}

function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
    // Switching panels can unmount the focused control while the dialog stays open.
    if (open && dialog.current?.open && !dialog.current.contains(document.activeElement)) heading.current?.focus();
  }, [open, title]);
  return <dialog ref={dialog} className="panel-dialog" aria-labelledby={titleId} onCancel={onClose} onClick={(event) => { if (event.target === dialog.current) { const bounds = dialog.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}><div className="panel-header"><div><h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2></div><LanguageSwitcher /><button className="icon-button" aria-label={t('companion.closePanel')} onClick={onClose}><Icon name="close" size={22} /></button></div><div className="panel-body">{children}</div></dialog>;
}

function SettingsPanel({ settings, status, active, onSave, onRefresh, readingPreferences }: { readingPreferences: ReadingControlsProps; settings: Settings; status: ServiceStatus | null; active: boolean; onSave: (settings: Settings) => Promise<void>; onRefresh: () => Promise<void> }) {
  const { t, formatError, formatNumber } = useI18n();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => { setDraft((current) => ({ ...current, [key]: value })); setSaved(false); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await onSave({ ...draft, learningLanguage: DEFAULT_SETTINGS.learningLanguage, supportLanguage: DEFAULT_SETTINGS.supportLanguage, avatarUrl: DEFAULT_SETTINGS.avatarUrl }); setSaved(true); } catch (cause) { setError(cause); } finally { setBusy(false); }
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
    <div className="settings-section">
      <h3><span>{formatNumber(1, { minimumIntegerDigits: 2 })}</span>{t('companion.partnerAppearance')}</h3>
      <div className="avatar-setting">
        <span className="avatar-setting-symbol">A</span>
        <div><strong>{t('companion.defaultAvatar')}</strong><p>{t('companion.builtInAvatar')}</p></div>
      </div>
      <p className="field-help">{t('companion.avatarHelp')}</p>
    </div>
    <div className="settings-section"><h3><span>{formatNumber(2, { minimumIntegerDigits: 2 })}</span>{t('companion.partnerProfile')}</h3><label className="field">{t('companion.name')}<input required maxLength={30} value={draft.characterName} onChange={(event) => set('characterName', event.target.value)} /></label><label className="field">{t('companion.personality')}<textarea required maxLength={1000} rows={3} value={draft.persona} onChange={(event) => set('persona', event.target.value)} /></label></div>
    <div className="settings-section"><h3><span>{formatNumber(3, { minimumIntegerDigits: 2 })}</span>{t('companion.practicePreferences')}</h3><p className="field-help">{t('companion.voiceLanguageHelp')}</p><p className="field-help">{t('companion.explanationHelp')}</p><label className="field">{t('companion.practiceLevel')}<select value={draft.japaneseLevel} onChange={(event) => set('japaneseLevel', event.target.value as Settings['japaneseLevel'])}><option value="beginner">{t('companion.beginner')}</option><option value="intermediate">{t('companion.intermediate')}</option><option value="advanced">{t('companion.advanced')}</option></select></label><div className="field-grid"><label className="field">{t('companion.voiceType')}<input required maxLength={80} value={draft.voice} onChange={(event) => set('voice', event.target.value)} /><span className="field-help">{t('companion.voiceHelp')}</span></label><label className="field">{t('companion.silenceWait')}<select value={draft.vadSilenceMs} onChange={(event) => set('vadSilenceMs', Number(event.target.value))}>{[600, 800, 1200, 1600, 2000, 3000].map((value) => <option key={value} value={value}>{t('companion.seconds', { value: formatNumber(value / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}{value === 1600 ? t('companion.defaultSuffix') : ''}</option>)}</select><span className="field-help">{t('companion.silenceHelp')}</span></label></div></div>
    {active && <p className="inline-info">{t('companion.endBeforeSettings')}</p>}
    <div className="panel-save"><span>{saved ? t('companion.settingsSaved') : t('companion.localStorageHelp')}</span><button className="primary-button" disabled={busy || active}><Icon name={saved ? 'check' : 'arrow'} size={17} />{busy ? t('companion.savingProgress') : t('companion.saveSettings')}</button></div>
  </form></>;
}
