import type { ConversationRecording } from '../hooks/use-conversation';

export function downloadConversationAudio(recording: Extract<ConversationRecording, { status: 'ready' }>): void {
  const date = recording.createdAt.replace(/[^0-9TZ-]/g, '-');
  const id = recording.sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
  const url = URL.createObjectURL(recording.blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `kaiwa-talk-${date}-${id}.${recording.extension}`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Keep the Blob available while the browser begins saving the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
