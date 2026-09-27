'use client';

import type { ReplySuggestion } from '../../shared/protocol';
import { getSuggestionRomaji } from '../../shared/japanese-reading';
import { useI18n } from '../i18n/provider';

export interface ReadingControlsProps {
  showKana: boolean;
  showRomaji: boolean;
  setShowKana: (visible: boolean) => void;
  setShowRomaji: (visible: boolean) => void;
}

export function ReadingControls({ showKana, showRomaji, setShowKana, setShowRomaji }: ReadingControlsProps) {
  const { t } = useI18n();
  return <div className="reading-controls" role="group" aria-label={t('controls.readingDisplay')}>
    <label className="reading-switch">
      <input type="checkbox" role="switch" aria-label={t('controls.showKana')} checked={showKana} onChange={event => setShowKana(event.target.checked)} />
      <span className="reading-switch-track" aria-hidden="true" /><span>{t('controls.kana')}</span>
    </label>
    <label className="reading-switch">
      <input type="checkbox" role="switch" aria-label={t('controls.showRomaji')} checked={showRomaji} onChange={event => setShowRomaji(event.target.checked)} />
      <span className="reading-switch-track" aria-hidden="true" /><span>{t('controls.romaji')}</span>
    </label>
  </div>;
}

export function ReplyReading({ suggestion, japanese, showKana, showRomaji }: {
  suggestion: ReplySuggestion;
  // Historical records only identify the explanation language; infer Japanese
  // from the saved sentence when its learning language is no longer available.
  japanese?: boolean;
  showKana: boolean;
  showRomaji: boolean;
}) {
  const { locale, t } = useI18n();
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const isJapanese = japanese ?? (Boolean(suggestion.romaji) || kana.test(suggestion.text)
    || (/\p{Script=Han}/u.test(suggestion.text) && kana.test(suggestion.reading)));
  const romaji = isJapanese && showRomaji ? getSuggestionRomaji(suggestion) : '';
  return <>
    {romaji && <p className="reply-option-romaji" lang="ja-Latn"><span lang={locale}>{t('controls.romaji')}</span>{romaji}</p>}
    {(!isJapanese || showKana) && <p className="reply-option-reading" lang={isJapanese ? 'ja' : undefined}><span lang={locale}>{t(isJapanese ? 'controls.kana' : 'controls.reading')}</span>{suggestion.reading}</p>}
  </>;
}
