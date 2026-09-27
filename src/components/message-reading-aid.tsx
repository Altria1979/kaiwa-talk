'use client';

import { useEffect, useState } from 'react';
import type { ChatMessage, MessageReadingAid as ReadingAid } from '../../shared/protocol';
import { api } from '../lib/api';
import { useI18n } from '../i18n/provider';

export function MessageReadingAid({ message, autoLoad, streaming, showKana, onReady }: {
  message: ChatMessage;
  autoLoad: boolean;
  streaming: boolean;
  showKana: boolean;
  onReady?: (messageId: string, content: string, aid: ReadingAid) => void;
}) {
  const { locale, t } = useI18n();
  const [requested, setRequested] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ content: string; aid?: ReadingAid; failed?: boolean } | null>(null);
  const shouldLoad = autoLoad || requested;
  const { id, content, readingAid: savedAid } = message;

  useEffect(() => {
    if (streaming || !content.trim() || savedAid || !shouldLoad) return;
    const controller = new AbortController();
    // Keep an already requested aid loading when the learner sends the next turn.
    queueMicrotask(() => {
      if (!controller.signal.aborted) { setRequested(true); setResult(null); }
    });
    void api.readingAid(id, controller.signal).then(({ readingAid }) => {
      if (!controller.signal.aborted) {
        setResult({ content, aid: readingAid });
        onReady?.(id, content, readingAid);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ content, failed: true });
    });
    return () => controller.abort();
  }, [id, content, savedAid, streaming, shouldLoad, retry, onReady]);

  if (streaming || !content.trim()) return null;
  const current = result?.content === content ? result : null;
  const aid = savedAid ?? current?.aid;
  if (aid) return <div className="message-reading-aid">
    <p className="message-chinese" lang="zh-CN"><span lang={locale}>{t('companion.chineseTranslation')}</span>{aid.translation}</p>
    {showKana && aid.reading && <p className="message-kana" lang="ja"><span lang={locale}>{t('controls.kana')}</span>{aid.reading}</p>}
  </div>;
  return <div className="message-aid-status">
    {current?.failed ? <><span role="status">{t('companion.readingAidFailed')}</span><button type="button" onClick={() => setRetry(value => value + 1)}>{t('companion.retry')}</button></>
      : shouldLoad ? <span role="status">{t('companion.readingAidLoading')}</span>
        : <button type="button" onClick={() => setRequested(true)}>{t('companion.showReadingAid')}</button>}
  </div>;
}
