import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AvatarCamera, AvatarTapGesture } from '../src/lib/avatar-camera.ts';
import { getAvatarFraming } from '../src/lib/avatar-framing.ts';

function fixture() {
  const camera = new THREE.PerspectiveCamera(27, 1.2, 0.01, 50);
  const controls = new OrbitControls(camera);
  const view = new AvatarCamera(camera, controls);
  const size = new THREE.Vector3(0.6, 1.7, 0.3);
  const center = new THREE.Vector3(0.2, 0.85, -0.1);
  view.setSubject(size, center, 0.8);
  return { camera, controls, view, size, center };
}

function settle(view, framing = 0.8, widening = 0) {
  for (let frame = 0; frame < 240; frame++) view.update(framing, widening);
}

function assertVector(actual, expected) {
  assert.ok(actual.distanceTo(expected) < 1e-9, `${actual.toArray()} differs from ${expected.toArray()}`);
}

test('initial and action views retain automatic framing until the camera is moved', () => {
  const { camera, controls, view, size, center } = fixture();
  const framing = getAvatarFraming(size, camera.fov, camera.aspect, 0.8);
  assertVector(controls.target, center.clone().add(new THREE.Vector3(0, framing.centerOffsetY, 0)));
  assert.equal(camera.position.z, center.z + framing.distance);
  controls.dispatchEvent({ type: 'start' });
  // A plain model tap must not disable later action framing.
  view.update(0.8, 0.7);
  controls.dispatchEvent({ type: 'end' });
  assert.ok(camera.position.z > center.z + framing.distance);
  view.update(0.8, 0);
  assert.ok(Math.abs(camera.position.z - center.z - framing.distance) < 1e-9);
});

test('an orbit keeps the composed view when actions widen and return to idle', () => {
  const { camera, controls, view } = fixture();
  controls.dispatchEvent({ type: 'start' });
  controls.rotateLeft(Math.PI * 1.25);
  controls.dispatchEvent({ type: 'end' });
  settle(view);
  const position = camera.position.clone();
  const target = controls.target.clone();
  settle(view, 0.8, 1);
  settle(view, 0.8, 0);
  assertVector(camera.position, position);
  assertVector(controls.target, target);
});

test('desktop default and reset match one zoom-in step without shifting the target', () => {
  const previous = fixture();
  previous.view.zoom(true);
  settle(previous.view);
  const { camera, controls, view } = fixture();
  view.resize(camera.aspect, 0.8, 0, 0.8);
  assertVector(camera.position, previous.camera.position);
  assertVector(controls.target, previous.controls.target);
  view.rotate(true);
  view.zoom(true);
  view.reset(0.8);
  settle(view);
  assertVector(camera.position, previous.camera.position);
  assertVector(controls.target, previous.controls.target);
  view.update(0.8, 1);
  assert.ok(controls.getDistance() > previous.controls.getDistance());
  view.update(0.8);
  assertVector(camera.position, previous.camera.position);
});

test('desktop zoom preserves full-body framing and mobile restores the original default', () => {
  const { camera, controls, view, size } = fixture();
  const mobilePosition = camera.position.clone();
  view.resize(camera.aspect, 0.8, 0, 0.8);
  view.reset(0);
  const fullBody = getAvatarFraming(size, camera.fov, camera.aspect, 0);
  assert.ok(Math.abs(controls.getDistance() - fullBody.distance) < 1e-9);
  view.resize(camera.aspect, 0.8, 0, 1);
  assertVector(camera.position, mobilePosition);
  view.resize(camera.aspect, 0.8, 0, 0.8);
  view.zoom(true);
  const manualPosition = camera.position.clone();
  view.resize(camera.aspect, 0.8, 0, 1);
  assertVector(camera.position, manualPosition);
  view.reset(0.8);
  assertVector(camera.position, mobilePosition);
});

test('resize preserves the user orbit, zoom, and pan while updating the projection', () => {
  const { camera, controls, view } = fixture();
  view.rotate(true);
  view.zoom(true);
  settle(view);
  const offset = new THREE.Vector3(0.1, 0.2, 0);
  camera.position.add(offset);
  controls.target.add(offset);
  view.update(0.8);
  const position = camera.position.clone();
  const target = controls.target.clone();
  const projection = camera.projectionMatrix.clone();
  view.resize(0.45, 0.8, 1);
  assertVector(camera.position, position);
  assertVector(controls.target, target);
  assert.equal(camera.aspect, 0.45);
  assert.notDeepEqual(camera.projectionMatrix.elements, projection.elements);
});

test('reset clears pending inertia, restores the front view, and resumes automatic framing', () => {
  const { camera, controls, view, center } = fixture();
  view.rotate(true);
  view.zoom(true);
  view.reset(0.8);
  const position = camera.position.clone();
  assert.ok(Math.abs(position.x - center.x) < 1e-9);
  assert.ok(Math.abs(position.y - controls.target.y) < 1e-9);
  settle(view);
  assertVector(camera.position, position);
  view.update(0.8, 1);
  assert.ok(camera.position.z > position.z);
  view.update(0.8, 0);
  assertVector(camera.position, position);
});

test('framing changes and model replacement apply new front views after user input', () => {
  const { camera, controls, view } = fixture();
  view.rotate(false);
  settle(view);
  view.reset(0);
  const fullBodyDistance = controls.getDistance();
  view.reset(1);
  assert.ok(controls.getDistance() < fullBodyDistance);
  view.rotate(true);
  const center = new THREE.Vector3(-2, 1, 3);
  view.setSubject(new THREE.Vector3(1, 2, 0.4), center, 0.8);
  settle(view);
  assert.ok(Math.abs(camera.position.x - center.x) < 1e-9);
  assert.equal(controls.target.z, center.z);
});

test('zoom and vertical orbit stay bounded while horizontal orbit allows a full revolution', () => {
  const { camera, controls, view } = fixture();
  view.setReducedMotion(true);
  for (let i = 0; i < 100; i++) view.zoom(true);
  assert.ok(Math.abs(controls.getDistance() - controls.minDistance) < 1e-9);
  for (let i = 0; i < 100; i++) view.zoom(false);
  assert.ok(Math.abs(controls.getDistance() - controls.maxDistance) < 1e-9);
  controls.rotateUp(Math.PI * 2);
  assert.ok(Math.abs(controls.getPolarAngle() - controls.minPolarAngle) < 1e-9);
  controls.rotateUp(-Math.PI * 4);
  assert.ok(Math.abs(controls.getPolarAngle() - controls.maxPolarAngle) < 1e-9);
  const position = camera.position.clone();
  for (let i = 0; i < 12; i++) view.rotate(true);
  assertVector(camera.position, position);
  view.update(0.8, 1);
  assertVector(camera.position, position);
});

test('reduced motion disables residual camera animation and can be switched back', () => {
  const { camera, controls, view } = fixture();
  view.setReducedMotion(true);
  view.rotate(true);
  const position = camera.position.clone();
  settle(view);
  assertVector(camera.position, position);
  assert.equal(controls.enableDamping, false);
  view.setReducedMotion(false);
  assert.equal(controls.enableDamping, true);
});

function sample(overrides = {}) {
  return { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 100, isPrimary: true, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides };
}

test('a stationary model tap remains accepted but dragging back to the start does not', () => {
  const gesture = new AvatarTapGesture();
  gesture.down(sample());
  gesture.move(sample({ clientX: 103 }));
  assert.equal(gesture.up(sample({ timeStamp: 200 })), true);
  gesture.down(sample());
  gesture.move(sample({ clientX: 130 }));
  gesture.move(sample());
  assert.equal(gesture.up(sample({ timeStamp: 200 })), false);
});

test('a two-finger gesture cannot become a tap in either release order', () => {
  for (const primaryFirst of [false, true]) {
    const gesture = new AvatarTapGesture();
    const primary = sample();
    const secondary = sample({ pointerId: 2, isPrimary: false });
    gesture.down(primary);
    gesture.down(secondary);
    assert.equal(gesture.up(primaryFirst ? primary : secondary), false);
    assert.equal(gesture.up(primaryFirst ? secondary : primary), false);
    gesture.down(primary);
    assert.equal(gesture.up(sample({ timeStamp: 200 })), true, 'the next single-finger tap recovers');
  }
});

test('pointer cancellation, capture loss, and modified pan gestures cannot trigger a model tap', () => {
  const gesture = new AvatarTapGesture();
  gesture.down(sample());
  gesture.cancel();
  assert.equal(gesture.up(sample({ timeStamp: 200 })), false);
  for (const options of [{ button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    gesture.down(sample(options));
    assert.equal(gesture.up(sample({ ...options, timeStamp: 200 })), false);
  }
});
