import type { ErrorDescriptor } from './app-errors.js';
import type { SpeechSegment } from './speech-policy.js';
import type { AvatarEmotion } from './avatar-emotion.js';

export type ConversationState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface Settings {
  characterName: string;
  persona: string;
  learningLanguage: string;
  supportLanguage: string;
  japaneseLevel: 'beginner' | 'intermediate' | 'advanced';
  voice: string;
  vadSilenceMs: number;
  avatarUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  characterName: 'VRoid Avatar A',
  persona: '優しく、辛抱強く、好奇心旺盛な日本語の会話パートナー。友達のように自然に話します。',
  learningLanguage: '日本語',
  supportLanguage: '日本語',
  japaneseLevel: 'beginner',
  voice: 'Cherry',
  vadSilenceMs: 1600,
  avatarUrl: '/models/default.vrm',
};

export interface LearningReview {
  language?: 'ja';
  topic: string;
  expressions: { text: string; meaning: string }[];
  improvement: string;
  memorySuggestions: string[];
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  endedAt: string | null;
  review: LearningReview | null;
}

export interface ReplySuggestion {
  text: string;
  reading: string;
  meaning: string;
  romaji?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  spokenContent: string;
  interrupted: boolean;
  delivery: 'text' | 'voice';
  translation: string | null;
  translationLanguage?: 'ja';
  createdAt: string;
  replySuggestions?: ReplySuggestion[];
  replySuggestionsLanguage?: 'ja';
}

export interface MemoryRecord {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceStatus {
  ready: boolean;
  missing: string[];
  credentialSource: 'browser' | 'none';
  region: string | null;
  models: { chat: string; asr: string; tts: string };
  asrLanguage: 'ja';
  activeSessionId: string | null;
}

export interface BrowserBailianCredentials {
  apiKey: string;
  apiHost?: string;
}

export type ClientEvent =
  | { type: 'start'; sessionId?: string; resume?: boolean; voice: boolean; credentials?: BrowserBailianCredentials }
  | { type: 'end' }
  | { type: 'audio'; audio: string; streamId: string }
  | { type: 'speech.accept'; streamId: string; segmentId: number }
  | { type: 'speech.reset'; streamId: string; beforeMs: number }
  | { type: 'text'; text: string }
  | { type: 'cancel'; turnId?: string }
  | { type: 'voice.stop' }
  | { type: 'played'; turnId: string; sentenceId: string };

export type ServerEvent =
  | { type: 'session.started'; session: SessionRecord; voice: boolean; asrStreamId?: string; resumed?: boolean; messages?: ChatMessage[] }
  | { type: 'session.ended'; session: SessionRecord }
  | { type: 'state'; state: ConversationState }
  | ({ type: 'transcript'; text: string; final: boolean } & SpeechSegment)
  | ({ type: 'speech.started'; turnId: string | null } & SpeechSegment)
  | { type: 'message'; message: ChatMessage }
  | { type: 'reply.start'; turnId: string; message: ChatMessage }
  | { type: 'avatar.emotion'; turnId: string; messageId: string; emotion: AvatarEmotion }
  | { type: 'reply.delta'; turnId: string; delta: string }
  | { type: 'reply.done'; turnId: string; message: ChatMessage }
  | { type: 'reply.suggestions'; turnId: string; messageId: string; status: 'loading' | 'ready' | 'unavailable'; suggestions: ReplySuggestion[] }
  | { type: 'audio.sentence'; turnId: string; sentenceId: string; text: string }
  | { type: 'audio'; turnId: string; sentenceId: string; audio: string; sampleRate: 24000 }
  | { type: 'audio.end'; turnId: string; sentenceId: string; text: string }
  | { type: 'turn.done'; turnId: string }
  | { type: 'turn.cancelled'; turnId: string }
  | ({ type: 'error'; source: 'config' | 'asr' | 'tts' | 'chat' | 'session'; message: string; recoverable: boolean } & Pick<ErrorDescriptor, 'errorCode' | 'errorParams'>);

export const MAX_MODEL_BYTES = 30 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 4000;
