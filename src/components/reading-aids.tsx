'use client';

import type { ReplySuggestion } from '../../shared/protocol';
import { useI18n } from '../i18n/provider';

export interface ReadingControlsProps {
  showKana: boolean;
  setShowKana: (visible: boolean) => void;
}

export function ReadingControls({ showKana, setShowKana }: ReadingControlsProps) {
  const { t } = useI18n();
  return <div className="reading-controls" role="group" aria-label={t('controls.readingDisplay')}>
    <label className="reading-switch">
      <input type="checkbox" role="switch" aria-label={t('controls.showKana')} checked={showKana} onChange={event => setShowKana(event.target.checked)} />
      <span className="reading-switch-track" aria-hidden="true" /><span>{t('controls.kana')}</span>
    </label>
  </div>;
}

// Historical records only identify the explanation language; infer Japanese
// from the saved sentence when its learning language is no longer available.
export function isJapaneseSuggestion(suggestion: ReplySuggestion): boolean {
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  return Boolean(suggestion.romaji) || kana.test(suggestion.text)
    || (/\p{Script=Han}/u.test(suggestion.text) && kana.test(suggestion.reading));
}

export function ReplyReading({ suggestion, japanese, showKana }: {
  suggestion: ReplySuggestion;
  japanese?: boolean;
  showKana: boolean;
}) {
  const { locale, t } = useI18n();
  const isJapanese = japanese ?? isJapaneseSuggestion(suggestion);
  return (!isJapanese || showKana) && <p className="reply-option-reading" lang={isJapanese ? 'ja' : undefined}><span lang={locale}>{t(isJapanese ? 'controls.kana' : 'controls.reading')}</span>{suggestion.reading}</p>;
}
