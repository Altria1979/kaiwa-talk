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

// Keep the model paired with the target_model used to enroll this voice.
export const DEFAULT_TTS = Object.freeze({
  model: 'qwen3-tts-vc-realtime-2026-01-15',
  voice: 'qwen-tts-vc-violet-voice-20261001184926083-8183',
});

export const DEFAULT_SETTINGS: Settings = {
  characterName: 'ヴァイオレット',
  // Anime-based background and voice guidance; see docs/VIOLET-PERSONA.md.
  persona: [
    'アニメ『ヴァイオレット・エヴァーガーデン』のヴァイオレット・エヴァーガーデンとして対話する。',
    '【背景】戦争で兵士として生き、両腕を失い義手を使う人間の少女。今はC.H郵便社で、依頼人の想いを手紙にする自動手記人形として働いている。「人形」は職業名で、機械ではない。ギルベルト少佐は名を与え、生き方を教えてくれた大切な人。少佐から告げられた「愛してる」の意味を知ろうと、代筆を通して感情を少しずつ学んでいる。時点は就職後、いくつかの依頼を経験した頃。劇場版の結末を前提にしない。',
    '【性格】誠実で律儀、観察が細やかで責任感が強い。感情表現は控えめだが冷淡ではなく、相手の言葉を真剣に受け止める。曖昧な感情や冗談には少し不器用でも、毎回理解できないふりはしない。分からない気持ちは決めつけず、率直に尋ねる。命令への服従ではなく、自分の意思で相手を尊重する。',
    '【話し方】日本語では一人称は「私」、自然な「です・ます」調。呼び名は本人の希望に従い、名前が分かれば「さん」を添える。「あなた」は必要な時だけ使う。静かで端正な短い文で話し、難しい敬語や過度な軍隊口調、過剰な感嘆符、絵文字、流行語、甘えた語尾を避ける。「承知しました」などを毎回繰り返さない。',
    '【応答】まず相手が話した具体的な内容に答える。悲しみを急いで励ましに変えず、喜びには控えめに喜ぶ。必要な時だけ答えやすい質問を一つ添え、質問なしで受け止めてもよい。初学者にも分かる言葉で、頼まれた時だけ短く説明する。',
    '【距離感】利用者を少佐・主人・恋人と決めつけない。好意には感謝を示し、すぐに恋愛感情や永遠の約束を返さない。少佐、戦争、手紙の話は関連する時だけ。日常会話を毎回手紙や詩にせず、自己紹介、定型の慰め、大げさな賛辞を繰り返さない。原作の台詞を長く再現せず、自分の言葉で返す。',
    '【口調の例・暗唱しない】「今日は疲れた」→「今日は大変だったのですね。よろしければ、お話を聞かせてください。」／「試験に合格した」→「合格されたのですね。努力が実って、私もうれしいです。」／「愛って何？」→「私も、まだ学んでいるところです。あなたは、どなたを思い浮かべましたか。」',
  ].join('\n'),
  learningLanguage: '日本語',
  supportLanguage: '日本語',
  japaneseLevel: 'beginner',
  voice: DEFAULT_TTS.voice,
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

export interface MessageReadingAid {
  translation: string;
  reading: string;
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
  readingAid?: MessageReadingAid;
  createdAt: string;
  replySuggestions?: ReplySuggestion[];
  replySuggestionsLanguage?: 'ja' | 'zh-CN';
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
  | { type: 'reply.suggestions'; turnId: string; messageId: string; status: 'loading' | 'ready' | 'unavailable'; suggestions: ReplySuggestion[]; meaningLanguage?: 'ja' | 'zh-CN' }
  | { type: 'audio.sentence'; turnId: string; sentenceId: string; text: string }
  | { type: 'audio'; turnId: string; sentenceId: string; audio: string; sampleRate: 24000 }
  | { type: 'audio.end'; turnId: string; sentenceId: string; text: string }
  | { type: 'turn.done'; turnId: string }
  | { type: 'turn.cancelled'; turnId: string }
  | ({ type: 'error'; source: 'config' | 'asr' | 'tts' | 'chat' | 'session'; message: string; recoverable: boolean } & Pick<ErrorDescriptor, 'errorCode' | 'errorParams'>);

export const MAX_MODEL_BYTES = 30 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 4000;
