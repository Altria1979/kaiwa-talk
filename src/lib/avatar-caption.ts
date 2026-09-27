/** Place a DOM caption below the projected head, within the character canvas. */
export function getAvatarCaptionPosition(
  anchor: { x: number; y: number; z: number },
  viewport: { width: number; height: number },
  caption: { width: number; height: number },
): { x: number; y: number } | null {
  const margin = 8;
  if (![anchor.x, anchor.y, anchor.z, viewport.width, viewport.height, caption.width, caption.height].every(Number.isFinite)
    || anchor.z < -1 || anchor.z > 1 || viewport.width <= 0 || viewport.height <= 0
    || caption.width > viewport.width - margin * 2 || caption.height > viewport.height - margin * 2) return null;
  const headY = (1 - anchor.y) * viewport.height / 2;
  const y = Math.max(margin, Math.min(headY + 12, viewport.height - margin - caption.height));
  // If the head is too low, hiding is preferable to covering the face.
  if (headY < 0 || headY > viewport.height || y < headY + 4) return null;
  const halfWidth = caption.width / 2;
  return {
    x: Math.max(margin + halfWidth, Math.min((anchor.x + 1) * viewport.width / 2, viewport.width - margin - halfWidth)),
    y,
  };
}
