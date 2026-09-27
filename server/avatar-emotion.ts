import { isAvatarEmotion, type AvatarEmotion } from '../shared/avatar-emotion.js';

const PREFIX = '[[emotion';
const HEADER_LIMIT = 128;
const LEADING_WHITESPACE_LIMIT = 128;

/** Removes only the reserved first control line, before any reply consumer sees it. */
export class AvatarEmotionDecoder {
  emotion: AvatarEmotion = 'neutral';
  private state: 'prefix' | 'header' | 'discard' | 'body' = 'prefix';
  private leading = '';
  private buffer = '';

  push(chunk: string): string {
    if (this.state === 'body') return chunk;
    for (let index = 0; index < chunk.length; index++) {
      const character = chunk[index];
      if (this.state === 'prefix') {
        if (!this.buffer && /\s/u.test(character)) {
          // Keep ordinary replies intact, but never let unlimited padding bypass
          // control-line detection or require an unbounded pending buffer.
          if (this.leading.length >= LEADING_WHITESPACE_LIMIT) throw new Error('Reply has excessive leading whitespace');
          this.leading += character;
          continue;
        }
        this.buffer += character;
        if (!PREFIX.startsWith(this.buffer)) {
          const body = this.leading + this.buffer + chunk.slice(index + 1);
          this.leading = '';
          this.buffer = '';
          this.state = 'body';
          return body;
        }
        if (this.buffer === PREFIX) {
          this.leading = '';
          this.state = 'header';
        }
      } else if (character === '\n') {
        if (this.state === 'header') {
          const value = /^\[\[emotion:([^\]\r\n]+)\]\]\r?$/.exec(this.buffer)?.[1];
          if (isAvatarEmotion(value)) this.emotion = value;
        }
        this.buffer = '';
        this.state = 'body';
        return chunk.slice(index + 1);
      } else if (this.state === 'header') {
        if (this.buffer.length < HEADER_LIMIT) this.buffer += character;
        else {
          this.buffer = '';
          this.state = 'discard';
        }
      }
    }
    return '';
  }

  finish(): void {
    // A partial prefix or unterminated control line is never reply text.
    this.buffer = '';
    this.leading = '';
    this.state = 'body';
  }
}
