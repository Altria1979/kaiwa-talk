'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { captionCharacters, type PlaybackCaption } from '../lib/playback-captions';

/** Keyed by sentence and playback phase so a later sentence cannot inherit an old fade. */
export function AvatarSpeechCaption({ caption }: { caption: PlaybackCaption }) {
  const textHost = useRef<HTMLSpanElement>(null);
  const [visibility, setVisibility] = useState<'visible' | 'fading' | 'hidden'>('visible');
  const characters = useMemo(() => captionCharacters(caption.text), [caption.text]);
  const text = characters.slice(0, caption.visibleCharacters).join('');

  useEffect(() => {
    const node = textHost.current;
    if (!node) return;
    const followText = () => { node.scrollTop = node.scrollHeight; };
    followText();
    const observer = new ResizeObserver(followText);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    if (caption.status !== 'ended') return;
    const fade = setTimeout(() => setVisibility('fading'), 2000);
    const hide = setTimeout(() => setVisibility('hidden'), 2200);
    return () => { clearTimeout(fade); clearTimeout(hide); };
  }, [caption.status]);

  if (!text || visibility === 'hidden') return null;
  return <div className="avatar-speech-caption" data-state={caption.status} data-fading={visibility === 'fading'}>
    <span className="avatar-speech-text" ref={textHost}>{text}</span>
  </div>;
}
