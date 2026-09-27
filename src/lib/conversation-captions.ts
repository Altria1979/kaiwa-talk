import type { ChatMessage } from '../../shared/protocol';

export function selectCurrentCaptions(messages: ChatMessage[], pendingTranscript: string): {
  user: ChatMessage | null;
  assistant: ChatMessage | null;
  userText: string;
  pending: boolean;
} {
  if (pendingTranscript.trim()) {
    return { user: null, assistant: null, userText: pendingTranscript, pending: true };
  }
  const user = messages.findLast(message => message.role === 'user') ?? null;
  const assistant = user ? messages.findLast(message =>
    message.role === 'assistant' && message.sessionId === user.sessionId && message.turnId === user.turnId) ?? null : null;
  return { user, assistant, userText: user?.content ?? '', pending: false };
}
