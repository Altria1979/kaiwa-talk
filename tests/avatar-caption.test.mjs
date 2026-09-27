import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { getAvatarCaptionPosition } from '../src/lib/avatar-caption.ts';
import { getAvatarFraming } from '../src/lib/avatar-framing.ts';

test('mouth captions stay below the head and inside desktop/mobile canvases at every framing', () => {
  const size = { x: 0.6, y: 1.7, z: 0.3 };
  for (const viewport of [{ width: 420, height: 468 }, { width: 350, height: 270 }, { width: 420, height: 220 }]) {
    for (const framing of [0, 0.85, 1]) {
      const camera = new THREE.PerspectiveCamera(27, viewport.width / viewport.height, 0.01, 50);
      const { distance, centerOffsetY } = getAvatarFraming(size, camera.fov, camera.aspect, framing);
      camera.position.set(0, size.y / 2 + centerOffsetY, distance);
      camera.lookAt(0, size.y / 2 + centerOffsetY, 0);
      camera.updateMatrixWorld(true);
      const anchor = new THREE.Vector3(0, size.y * 0.85, 0).project(camera);
      const caption = { width: Math.min(300, viewport.width - 24), height: 76 };
      const position = getAvatarCaptionPosition(anchor, viewport, caption);
      assert.ok(position, `caption hidden at ${JSON.stringify({ viewport, framing })}`);
      assert.ok(position.y >= (1 - anchor.y) * viewport.height / 2 + 4);
      assert.ok(position.y + caption.height <= viewport.height - 8);
      assert.ok(position.x - caption.width / 2 >= 8);
      assert.ok(position.x + caption.width / 2 <= viewport.width - 8);
    }
  }
});

test('caption edges are constrained and invalid/low anchors cannot cover the face', () => {
  const viewport = { width: 300, height: 260 };
  const caption = { width: 260, height: 76 };
  assert.deepEqual(getAvatarCaptionPosition({ x: -1, y: 0.5, z: 0 }, viewport, caption), { x: 138, y: 77 });
  assert.deepEqual(getAvatarCaptionPosition({ x: 1, y: 0.5, z: 0 }, viewport, caption), { x: 162, y: 77 });
  for (const anchor of [{ x: 0, y: -0.9, z: 0 }, { x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }]) {
    assert.equal(getAvatarCaptionPosition(anchor, viewport, caption), null);
  }
  assert.equal(getAvatarCaptionPosition({ x: 0, y: 0, z: 0 }, { width: 0, height: 0 }, caption), null);
});
