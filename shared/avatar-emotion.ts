export const AVATAR_EMOTIONS = ['neutral', 'happy', 'relaxed', 'sad', 'angry', 'surprised'] as const;

export type AvatarEmotion = typeof AVATAR_EMOTIONS[number];

export function isAvatarEmotion(value: unknown): value is AvatarEmotion {
  return typeof value === 'string' && (AVATAR_EMOTIONS as readonly string[]).includes(value);
}
