'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ScrollPosition = { top: number; height: number; viewport: number };
type ConversationScrollOptions = {
  enabled?: boolean;
  sessionId?: string;
  latestUserMessageId?: string;
  recognizing: boolean;
};

const positionOf = (node: HTMLDivElement): ScrollPosition => ({ top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight });
const atBottom = ({ top, height, viewport }: ScrollPosition) => height - top - viewport < 64;

export function useConversationScroll({ enabled = true, sessionId, latestUserMessageId, recognizing }: ConversationScrollOptions) {
  const chatScroll = useRef<HTMLDivElement>(null);
  const chatContent = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const position = useRef<ScrollPosition | null>(null);
  const previousTurn = useRef({ sessionId, latestUserMessageId, recognizing: false });
  const [showLatest, setShowLatest] = useState(false);

  const scrollToLatest = useCallback(() => {
    if (!enabled) return;
    followLatest.current = true;
    const node = chatScroll.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
      // The page can also scroll (especially after focusing the composer).
      // Honor its scroll padding so a short latest message clears the fixed nav.
      chatContent.current?.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      node.scrollTop = node.scrollHeight;
      position.current = positionOf(node);
    }
    setShowLatest(false);
  }, [enabled]);

  const onScroll = useCallback(() => {
    const node = chatScroll.current;
    if (!node) return;
    const next = positionOf(node);
    const previous = position.current;
    const resized = previous && (next.height !== previous.height || next.viewport !== previous.viewport);
    // Layout can clamp or anchor scrollTop before ResizeObserver runs. Only a
    // move up with unchanged dimensions counts as a reader leaving the bottom.
    if (previous && !resized && next.top < previous.top - 1) followLatest.current = false;
    else if (previous && !resized && next.top > previous.top + 1 && atBottom(next)) followLatest.current = true;
    position.current = next;
    if (followLatest.current && resized) scrollToLatest();
    else setShowLatest(!followLatest.current);
  }, [scrollToLatest]);

  useEffect(() => {
    const node = chatScroll.current;
    const content = chatContent.current;
    if (!node || !content) return;
    let disposed = false;
    let touchY: number | undefined;
    // Preserve explicit upward input even if a resize arrives before its scroll
    // event. Scrollbar dragging is detected by onScroll's position comparison.
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) followLatest.current = false; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target === node && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) followLatest.current = false;
    };
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (touchY !== undefined && nextY !== undefined && nextY > touchY) followLatest.current = false;
      touchY = nextY;
    };
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      const next = positionOf(node);
      if (followLatest.current) scrollToLatest();
      else {
        position.current = next;
        setShowLatest(next.height - next.top - next.viewport > 1);
      }
    });
    observer.observe(node);
    observer.observe(content);
    return () => {
      disposed = true;
      observer.disconnect();
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
    };
  }, [scrollToLatest]);

  useEffect(() => {
    const previous = previousTurn.current;
    previousTurn.current = { sessionId, latestUserMessageId, recognizing };
    if (sessionId === previous.sessionId && latestUserMessageId === previous.latestUserMessageId && (!recognizing || previous.recognizing)) return;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) scrollToLatest(); });
    return () => { disposed = true; };
  }, [sessionId, latestUserMessageId, recognizing, scrollToLatest]);

  return { chatScroll, chatContent, onScroll, showLatest, scrollToLatest };
}
