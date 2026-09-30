'use client';

import { useId, useState } from 'react';
import type { ReplySuggestionsState, SuggestionSpeech } from '../hooks/use-conversation';
import { Icon } from './icon';
import { isJapaneseSuggestion, ReadingControls, ReplyReading, type ReadingControlsProps } from './reading-aids';
import { useI18n } from '../i18n/provider';

interface BaseProps {
  value: ReplySuggestionsState;
  learningLanguage?: string;
  readingPreferences: ReadingControlsProps;
}

type Props = BaseProps & ({ readOnly: true } | {
  readOnly?: false;
  busy: boolean;
  speech: SuggestionSpeech | null;
  onListen: (index: number) => Promise<void>;
  onSend: (text: string) => Promise<void>;
});

export function ReplySuggestions(props: Props) {
  const { value, learningLanguage, readingPreferences } = props;
  const { t, formatNumber } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const optionsId = useId();
  const japanese = learningLanguage === undefined ? undefined : /日语|日文|日本語|japanese|\bja\b/i.test(learningLanguage);

  return <section className={`reply-suggestions${props.readOnly ? ' is-readonly' : ''}`} aria-label={t('controls.aiReplies')}>
    <div className="reply-suggestions-header">
      <h3><Icon name="spark" size={15} />{t('controls.aiReplies')}</h3>
      {!props.readOnly && <div className="reply-suggestions-tools">
        {japanese && <ReadingControls {...readingPreferences} />}
        {value.status === 'ready' && <button type="button" className="reply-suggestions-toggle" aria-expanded={expanded} aria-controls={optionsId} onClick={() => setExpanded(current => !current)}>{t(expanded ? 'controls.close' : 'controls.open')}</button>}
      </div>}
    </div>
    {value.status !== 'ready' ? <p className="reply-suggestions-status" role="status">{t(value.status === 'loading' ? 'controls.repliesLoading' : 'controls.repliesEmpty')}</p> : (props.readOnly || expanded) && <div id={optionsId} className="reply-suggestions-content">
      <ol className="reply-options">
        {value.suggestions.slice(0, 2).map((suggestion, index) => {
          const playback = !props.readOnly && props.speech?.messageId === value.messageId && props.speech.index === index ? props.speech.status : null;
          const isJapanese = japanese ?? isJapaneseSuggestion(suggestion);
          return <li key={suggestion.text} className="reply-option">
            <span className="reply-option-number" aria-hidden="true">{formatNumber(index + 1)}</span>
            <div className="reply-option-body">
              <div className="reply-option-copy">
                <p className="reply-option-text" lang={isJapanese ? 'ja' : undefined}>{suggestion.text}</p>
                <div className="reply-option-details">
                  <ReplyReading suggestion={suggestion} japanese={isJapanese} {...readingPreferences} />
                  <p className="reply-option-meaning" lang={value.meaningLanguage ?? 'ja'}>{suggestion.meaning}</p>
                </div>
              </div>
              {!props.readOnly && <div className="reply-option-actions">
                <button type="button" className="suggestion-listen" disabled={props.busy} aria-pressed={!!playback} aria-label={t(playback === 'loading' ? 'controls.cancelSample' : playback ? 'controls.stopSample' : 'controls.listenSampleLabel', { text: suggestion.text })} onClick={() => void props.onListen(index)}><Icon name={playback ? 'pause' : 'volume'} size={14} />{t(playback === 'loading' ? 'controls.preparing' : playback ? 'controls.stop' : 'controls.listenSample')}</button>
                <button type="button" disabled={props.busy} aria-label={t('controls.sendReplyLabel', { text: suggestion.text })} onClick={() => void props.onSend(suggestion.text)}><Icon name="send" size={13} />{t('controls.send')}</button>
              </div>}
            </div>
          </li>;
        })}
      </ol>
      {!props.readOnly && props.speech && <p className="reply-sample-hint" role="status">{t(props.speech.status === 'loading' ? 'controls.samplePreparingHint' : 'controls.samplePlayingHint')}</p>}
    </div>}
  </section>;
}
