'use client';

import { useId, useState } from 'react';
import type { ReplySuggestionsState, SuggestionSpeech } from '../hooks/use-conversation';
import type { VadStatus } from '../lib/browser-vad';
import { Icon } from './icon';
import { ReadingControls, ReplyReading, type ReadingControlsProps } from './reading-aids';
import { useI18n } from '../i18n/provider';

interface BaseProps {
  value: ReplySuggestionsState;
  learningLanguage?: string;
  readingPreferences: ReadingControlsProps;
}

type Props = BaseProps & ({ readOnly: true } | {
  readOnly?: false;
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
});

export function ReplySuggestions(props: Props) {
  const { value, learningLanguage, readingPreferences } = props;
  const { t, formatNumber } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const optionsId = useId();
  const japanese = learningLanguage === undefined ? undefined : /日语|日文|日本語|japanese|\bja\b/i.test(learningLanguage);
  const practicing = !props.readOnly && japanese && selected !== null && value.status === 'ready';

  return <section className={`reply-suggestions${props.readOnly ? ' is-readonly' : practicing ? ' is-practicing' : ''}`} aria-label={t('controls.aiReplies')}>
    <div className="reply-suggestions-header">
      <h3><Icon name={practicing ? 'mic' : 'spark'} size={15} />{t(practicing ? 'controls.readPractice' : 'controls.aiReplies')}</h3>
      {!props.readOnly && <div className="reply-suggestions-tools">
        {japanese && <ReadingControls {...readingPreferences} />}
        {practicing ? <button type="button" className="reply-suggestions-toggle" aria-controls={optionsId} onClick={() => setSelected(null)}>{t('controls.chooseAgain')}</button>
          : value.status === 'ready' && <button type="button" className="reply-suggestions-toggle" aria-expanded={expanded} aria-controls={optionsId} onClick={() => setExpanded(current => !current)}>{t(expanded ? 'controls.close' : 'controls.open')}</button>}
      </div>}
    </div>
    {value.status !== 'ready' ? <p className="reply-suggestions-status" role="status">{t(value.status === 'loading' ? 'controls.repliesLoading' : 'controls.repliesEmpty')}</p> : (props.readOnly || expanded) && <div id={optionsId} className="reply-suggestions-content">
      <ol className="reply-options">
        {value.suggestions.slice(0, 2).map((suggestion, index) => {
          const playback = !props.readOnly && props.speech?.messageId === value.messageId && props.speech.index === index ? props.speech.status : null;
          return <li key={suggestion.text} className={`reply-option ${practicing && selected === index ? 'is-selected' : ''}`}>
            <span className="reply-option-number" aria-hidden="true">{formatNumber(index + 1)}</span>
            <div className="reply-option-body">
              <div className="reply-option-copy">
                <p className="reply-option-text" lang={(japanese ?? Boolean(suggestion.romaji)) ? 'ja' : undefined}>{suggestion.text}</p>
                <ReplyReading suggestion={suggestion} japanese={japanese} {...readingPreferences} />
              </div>
              <p className="reply-option-meaning" lang={value.meaningLanguage ?? 'ja'}>{suggestion.meaning}</p>
              {!props.readOnly && <div className="reply-option-actions">
                <button type="button" className="suggestion-listen" disabled={props.busy} aria-pressed={!!playback} aria-label={t(playback === 'loading' ? 'controls.cancelSample' : playback ? 'controls.stopSample' : 'controls.listenSampleLabel', { text: suggestion.text })} onClick={() => void props.onListen(index)}><Icon name={playback ? 'pause' : 'volume'} size={14} />{t(playback === 'loading' ? 'controls.preparing' : playback ? 'controls.stop' : 'controls.listenSample')}</button>
                {japanese && <button type="button" disabled={props.busy} aria-pressed={selected === index} onClick={() => { setSelected(index); void props.onPractice(); }}><Icon name="mic" size={13} />{t(selected === index && props.voiceEnabled && !props.muted ? props.userSpeaking ? 'controls.listening' : 'controls.pleaseRead' : 'controls.readAloud')}</button>}
                <button type="button" disabled={props.busy} aria-label={t('controls.sendReplyLabel', { text: suggestion.text })} onClick={() => void props.onSend(suggestion.text)}><Icon name="send" size={13} />{t('controls.send')}</button>
              </div>}
            </div>
          </li>;
        })}
      </ol>
      {!props.readOnly && <p className="reply-practice-hint" role="status">{t(props.speech ? props.speech.status === 'loading' ? 'controls.samplePreparingHint' : 'controls.samplePlayingHint'
        : !japanese ? 'controls.nonJapaneseHint'
        : practicing && props.voiceEnabled && !props.muted ? props.userSpeaking ? 'controls.practiceListeningHint' : 'controls.practiceReadyHint'
        : props.voiceEnabled && !props.muted
          ? props.userSpeaking ? 'controls.listeningHint'
            : props.vadStatus === 'unavailable' ? 'controls.unavailableHint'
              : 'controls.responseHint'
          : props.voiceEnabled ? 'controls.unmuteHint' : 'controls.enableVoiceHint', { characterName: props.characterName })}</p>}
    </div>}
  </section>;
}
