import { useI18n } from '../i18n/provider';
import { Icon } from './icon';

export function TranscriptPreview({ text, recognizing }: { text: string; recognizing: boolean }) {
  const { t } = useI18n();
  if (!text && !recognizing) return null;

  return <article className="message user-message transcript-preview">
    <div className="message-meta"><span>{t('companion.you')}</span>{recognizing ? <span className="listening-dot" /> : <Icon name="mic" size={13} />}</div>
    <div className="message-bubble" role="status" aria-live="polite" aria-atomic="true">
      {/* Interim ASR may change words or languages; only the final result is readable text. */}
      <p>{recognizing ? t('companion.recognizing') : text}</p>
    </div>
  </article>;
}
