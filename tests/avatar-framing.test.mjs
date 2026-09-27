import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DEFAULT_AVATAR_FRAMING, getAvatarCameraDistance, getAvatarFraming, parseAvatarFraming } from '../src/lib/avatar-framing.ts';

function assertFits(size, aspect) {
  const distance = getAvatarCameraDistance(size, 27, aspect);
  const center = new THREE.Vector3(0.4, 1.1, -0.3);
  const camera = new THREE.PerspectiveCamera(27, aspect, 0.01, 1000);
  camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        // Check the closest corners at both extremes of the existing idle bob.
        for (const bob of [-0.0018, 0.0018]) {
          const point = center.clone().add(new THREE.Vector3(x * size.x / 2, y * size.y / 2 + bob * size.y, z * size.z / 2));
          const projected = point.project(camera);
          assert.ok(Math.abs(projected.x) <= 1 / 1.1 + 1e-10, `horizontal crop at aspect ${aspect}`);
          assert.ok(Math.abs(projected.y) <= 1 / 1.1 + 1e-10, `vertical crop at aspect ${aspect}`);
          assert.ok(projected.z > -1 && projected.z < 1, 'point outside clipping planes');
        }
      }
    }
  }
  assert.ok(center.clone().project(camera).distanceTo(new THREE.Vector3(0, 0, center.clone().project(camera).z)) < 1e-10);
  return distance;
}

test('full body retains padding across desktop, mobile, and short landscape canvases', () => {
  for (const aspect of [1.5, 0.5, 0.3, 4]) {
    assertFits({ x: 0.6, y: 1.7, z: 0.3 }, aspect);
  }
});

test('fit also covers wide models and the nearest surface of deep models', () => {
  assertFits({ x: 2.4, y: 1.7, z: 0.3 }, 0.5);
  assertFits({ x: 0.6, y: 1.7, z: 2 }, 1.5);
});

test('resizing a wide model into a narrow canvas increases camera distance', () => {
  const size = { x: 1.4, y: 1.7, z: 0.3 };
  const wideDistance = assertFits(size, 2);
  const narrowDistance = assertFits(size, 0.4);
  assert.ok(narrowDistance > wideDistance);
});

test('zoom raises the focus and magnifies continuously without cropping the head', () => {
  const size = { x: 0.6, y: 1.7, z: 0.3 };
  for (const aspect of [0.5, 0.8, 1.5, 4]) {
    let previousDistance = Infinity;
    for (const framing of [0, 0.25, DEFAULT_AVATAR_FRAMING, 1]) {
      const { distance, centerOffsetY } = getAvatarFraming(size, 27, aspect, framing);
      assert.ok(distance < previousDistance);
      previousDistance = distance;
      if (framing === 0) {
        assert.equal(distance, getAvatarCameraDistance(size, 27, aspect));
        assert.equal(centerOffsetY, 0);
      }
      const camera = new THREE.PerspectiveCamera(27, aspect, 0.01, 50);
      camera.position.set(0, size.y / 2 + centerOffsetY, distance);
      camera.lookAt(0, size.y / 2 + centerOffsetY, 0);
      camera.updateMatrixWorld(true);
      // A head-width region from neck to hair top, including idle movement.
      for (const x of [-0.14, 0.14]) {
        for (const y of [size.y * 0.85, size.y]) {
          for (const bob of [-0.0018, 0.0018]) {
            const point = new THREE.Vector3(x, y + size.y * bob, size.z / 2).project(camera);
            assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1, `cropped head at aspect ${aspect}, zoom ${framing}`);
            assert.ok(point.z > -1 && point.z < 1);
          }
        }
      }
    }
  }
});

test('framing falls back safely for invalid saved values and preserves full-body zero', () => {
  for (const value of [null, '', ' ', 'NaN', 'Infinity', 'oops', '-1', '1.1']) {
    assert.equal(parseAvatarFraming(value), DEFAULT_AVATAR_FRAMING);
  }
  assert.equal(parseAvatarFraming('0'), 0);
  assert.equal(parseAvatarFraming('0.7'), 0.7);
  assert.equal(parseAvatarFraming('1'), 1);
});
