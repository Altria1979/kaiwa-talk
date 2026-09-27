'use client';

import { useId, useState } from 'react';
import type { ReplySuggestionsState, SuggestionSpeech } from '../hooks/use-conversation';
import type { VadStatus } from '../lib/browser-vad';
import { Icon } from './icon';
import { ReadingControls, ReplyReading, type ReadingControlsProps } from './reading-aids';
import { useI18n } from '../i18n/provider';

interface Props {
  value: ReplySuggestionsState;
  learningLanguage: string;
  readingPreferences: ReadingControlsProps;
  characterName: string;
  voiceEnabled: boolean;
  muted: boolean;
  userSpeaking: boolean;
  vadStatus: VadStatus;
  busy: boolean;
  speech: SuggestionSpeech | null;
  onListen: (index: number) => Promise<void>;
  onPractice: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
}

export function ReplySuggestions({ value, learningLanguage, readingPreferences, characterName, voiceEnabled, muted, userSpeaking, vadStatus, busy, speech, onListen, onPractice, onSend }: Props) {
  const { t, formatNumber } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const optionsId = useId();
  const japanese = /日语|日文|日本語|japanese|\bja\b/i.test(learningLanguage);
  const practicing = japanese && selected !== null && value.status === 'ready';

  return <section className={`reply-suggestions${practicing ? ' is-practicing' : ''}`} aria-label={t('controls.aiReplies')}>
    <div className="reply-suggestions-header">
      <h3><Icon name={practicing ? 'mic' : 'spark'} size={15} />{t(practicing ? 'controls.readPractice' : 'controls.aiReplies')}</h3>
      <div className="reply-suggestions-tools">
      {japanese && <ReadingControls {...readingPreferences} />}
      {practicing ? <button type="button" className="reply-suggestions-toggle" aria-controls={optionsId} onClick={() => setSelected(null)}>{t('controls.chooseAgain')}</button>
        : value.status === 'ready' && <button type="button" className="reply-suggestions-toggle" aria-expanded={expanded} aria-controls={optionsId} onClick={() => setExpanded(current => !current)}>{t(expanded ? 'controls.close' : 'controls.open')}</button>}
      </div>
    </div>
    {value.status !== 'ready' ? <p className="reply-suggestions-status" role="status">{t(value.status === 'loading' ? 'controls.repliesLoading' : 'controls.repliesEmpty')}</p> : expanded && <div id={optionsId} className="reply-suggestions-content">
      <ol className="reply-options">
        {value.suggestions.map((suggestion, index) => {
          if (practicing && selected !== index) return null;
          const playback = speech?.messageId === value.messageId && speech.index === index ? speech.status : null;
          return <li key={suggestion.text} className={`reply-option ${selected === index ? 'is-selected' : ''}`}>
          <span className="reply-option-number" aria-hidden="true">{formatNumber(index + 1)}</span>
          <div className="reply-option-body">
            <div className="reply-option-copy">
              <p className="reply-option-text" lang={japanese ? 'ja' : undefined}>{suggestion.text}</p>
              <ReplyReading suggestion={suggestion} japanese={japanese} {...readingPreferences} />
            </div>
            <p className="reply-option-meaning" lang="ja">{suggestion.meaning}</p>
            <div className="reply-option-actions">
              <button type="button" className="suggestion-listen" disabled={busy} aria-pressed={!!playback} aria-label={t(playback === 'loading' ? 'controls.cancelSample' : playback ? 'controls.stopSample' : 'controls.listenSampleLabel', { text: suggestion.text })} onClick={() => void onListen(index)}><Icon name={playback ? 'pause' : 'volume'} size={14} />{t(playback === 'loading' ? 'controls.preparing' : playback ? 'controls.stop' : 'controls.listenSample')}</button>
              {japanese && <button type="button" disabled={busy} aria-pressed={selected === index} onClick={() => { setSelected(index); void onPractice(); }}><Icon name="mic" size={13} />{t(selected === index && voiceEnabled && !muted ? userSpeaking ? 'controls.listening' : 'controls.pleaseRead' : 'controls.readAloud')}</button>}
              <button type="button" disabled={busy} aria-label={t('controls.sendReplyLabel', { text: suggestion.text })} onClick={() => void onSend(suggestion.text)}><Icon name="send" size={13} />{t('controls.send')}</button>
            </div>
          </div>
        </li>;
        })}
      </ol>
      <p className="reply-practice-hint" role="status">{t(speech ? speech.status === 'loading' ? 'controls.samplePreparingHint' : 'controls.samplePlayingHint'
        : !japanese ? 'controls.nonJapaneseHint'
        : practicing && voiceEnabled && !muted ? userSpeaking ? 'controls.practiceListeningHint' : 'controls.practiceReadyHint'
        : voiceEnabled && !muted
          ? userSpeaking ? 'controls.listeningHint'
            : vadStatus === 'unavailable' ? 'controls.unavailableHint'
              : 'controls.responseHint'
          : voiceEnabled ? 'controls.unmuteHint' : 'controls.enableVoiceHint', { characterName })}</p>
    </div>}
  </section>;
}
