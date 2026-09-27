/** A sentence and its audible progress, shared by streaming and replay. */
export interface PlaybackCaption {
  turnId: string;
  sentenceId: string;
  text: string;
  visibleCharacters: number;
  status: 'playing' | 'ended';
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Keep combining marks and emoji sequences together when revealing text. */
export function captionCharacters(text: string): string[] {
  return Array.from(segmenter.segment(text), part => part.segment);
}
