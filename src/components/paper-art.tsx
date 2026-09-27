"use client";

import { useEffect, useRef } from "react";
import styles from "./paper-art.module.css";

/** A circular window into colored ink, beneath a static paper grain. */
export function PaperArt({ className }: { className?: string }) {
  const art = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = art.current;
    if (!element) return;

    const media = window.matchMedia(
      "(min-width: 901px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    let visible = false;
    let frame = 0;
    let x = 0.5;
    let y = 0.5;
    let targetX = 0.5;
    let targetY = 0.5;
    let shortEdge = 0;
    let hovering = false;
    let pointer: { x: number; y: number } | null = null;

    function paint() {
      if (!element) return;
      element.style.setProperty("--ink-x", `${(x - 0.5) * shortEdge * 0.08}px`);
      element.style.setProperty("--ink-y", `${(y - 0.5) * shortEdge * 0.08}px`);
      element.style.setProperty("--light-x", `${x * 100}%`);
      element.style.setProperty("--light-y", `${y * 100}%`);
      element.style.setProperty(
        "--light-radius",
        `${shortEdge * (hovering ? 0.72 : 0.56)}px`,
      );
      element.style.setProperty("--light-stop", hovering ? "50%" : "55%");
    }

    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      x = y = targetX = targetY = 0.5;
      hovering = false;
      pointer = null;
      paint();
    }

    function animate() {
      x += (targetX - x) * 0.08;
      y += (targetY - y) * 0.08;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) < 0.001) {
        x = targetX;
        y = targetY;
        frame = 0;
      } else {
        frame = requestAnimationFrame(animate);
      }
      paint();
    }

    function track() {
      if (!element || !pointer || !visible || !media.matches || document.hidden) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = (pointer.x - rect.left) / rect.width;
      const py = (pointer.y - rect.top) / rect.height;
      targetX = Math.max(0, Math.min(1, px));
      targetY = Math.max(0, Math.min(1, py));
      hovering = px >= 0 && px <= 1 && py >= 0 && py <= 1;
      if (!frame) frame = requestAnimationFrame(animate);
    }

    function move(event: PointerEvent) {
      if (event.pointerType !== "mouse") {
        reset();
        return;
      }
      if (!visible || !media.matches || document.hidden) return;
      pointer = { x: event.clientX, y: event.clientY };
      track();
    }

    function resize() {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      shortEdge = Math.min(rect.width, rect.height);
      paint();
      track();
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) reset();
    });
    const sizeObserver = new ResizeObserver(resize);
    resize();
    observer.observe(element);
    sizeObserver.observe(element);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", move);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", track, { passive: true, capture: true });
    document.documentElement.addEventListener("pointerleave", reset);
    media.addEventListener("change", reset);
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("blur", reset);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizeObserver.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", track, true);
      document.documentElement.removeEventListener("pointerleave", reset);
      media.removeEventListener("change", reset);
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return (
    <div
      ref={art}
      className={[styles.art, className].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-paper-art
    >
      <div className={styles.layers}>
        <span className={styles.blue} />
        <span className={styles.orange} />
        <span className={styles.pink} />
        <span className={styles.violet} />
        <span className={styles.ink} />
      </div>
    </div>
  );
}
