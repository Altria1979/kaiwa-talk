'use client';

import { useState } from 'react';
import type { ConversationRecording } from '../hooks/use-conversation';
import { useI18n } from '../i18n/provider';
import { downloadConversationAudio } from '../lib/download-conversation-audio';
import { Icon } from './icon';

export function ConversationAudioExport({ recording }: { recording: ConversationRecording }) {
  const { t, formatNumber } = useI18n();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const ready = recording.status === 'ready';
  const megabytes = ready && recording.blob.size >= 1024 * 1024;
  const fileSize = ready ? formatNumber(recording.blob.size / (megabytes ? 1024 * 1024 : 1024), { maximumFractionDigits: 1 }) : '';
  const description = recording.status === 'finalizing' ? 'companion.audioPreparing'
    : recording.status === 'unavailable' ? 'companion.audioUnsupported'
      : recording.status === 'failed' ? 'companion.audioFailed'
        : recording.status === 'empty' ? 'companion.audioEmpty' : 'companion.audioExportHint';

  const download = () => {
    if (recording.status !== 'ready') return;
    try { downloadConversationAudio(recording); setDownloadFailed(false); }
    catch { setDownloadFailed(true); }
  };

  return <section className="conversation-audio-export" aria-label={t('companion.conversationAudio')}>
    <div className="audio-export-copy">
      <strong>{t('companion.conversationAudio')}{ready && <span className="audio-export-format">{recording.extension.toUpperCase()} · {t(megabytes ? 'companion.audioMegabytes' : 'companion.audioKilobytes', { size: fileSize })}</span>}</strong>
      <p role="status">{t(description)}</p>
      {downloadFailed && <p role="alert">{t('companion.audioDownloadFailed')}</p>}
    </div>
    <button type="button" className="secondary-button" disabled={!ready} onClick={download}>
      <Icon name="download" size={16} />{t(recording.status === 'finalizing' ? 'companion.audioPreparingButton' : 'companion.exportAudio')}
    </button>
  </section>;
}
