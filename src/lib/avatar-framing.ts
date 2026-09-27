export const AVATAR_BOB_RATIO = 0.0018;
export const DEFAULT_AVATAR_FRAMING = 0.85;
export const AVATAR_FRAMING_STORAGE_KEY = 'avatar-a.framing.v1';

export function parseAvatarFraming(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_AVATAR_FRAMING;
  const framing = Number(value);
  return Number.isFinite(framing) && framing >= 0 && framing <= 1 ? framing : DEFAULT_AVATAR_FRAMING;
}

/** Fit the entire box from its center, including its nearest face and idle movement. */
export function getAvatarCameraDistance(size: { x: number; y: number; z: number }, verticalFov: number, aspect: number, bobHeight = size.y) {
  const verticalTangent = Math.tan(verticalFov * Math.PI / 360);
  const horizontalTangent = verticalTangent * aspect;
  const halfHeight = size.y / 2 + bobHeight * AVATAR_BOB_RATIO;
  const halfWidth = size.x / 2;
  return size.z / 2 + Math.max(halfHeight / verticalTangent, halfWidth / horizontalTangent) * 1.1;
}

/** Crop upwards from full body to bust, keeping the model's top inside the frame. */
export function getAvatarFraming(size: { x: number; y: number; z: number }, verticalFov: number, aspect: number, framing: number) {
  const amount = Number.isFinite(framing) ? Math.min(1, Math.max(0, framing)) : DEFAULT_AVATAR_FRAMING;
  const croppedHeight = size.y * 0.68 * amount;
  const visibleSize = { x: size.x * (1 - 0.45 * amount), y: size.y - croppedHeight, z: size.z };
  return {
    distance: getAvatarCameraDistance(visibleSize, verticalFov, aspect, size.y),
    centerOffsetY: croppedHeight / 2,
  };
}
